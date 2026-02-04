import { VovkPLCEditor } from "../../editor/Editor.js"
import { PLC_Symbol } from "../../utils/types.js"
import { RendererModule } from "../types.js"
import { resolveBlockState } from "./evaluator.js"
import { PLC_Ladder, PLC_LadderBlock, PLC_LadderNode, PLC_LadderConnection, toGraph, isFunctionBlock, isMathBlock, isCompareBlock, isMoveBlock, isUnaryMathBlock, isIncDecBlock, getFunctionBlockLabel, migrateLadderBlock } from "./language.js"
import { getSymbolValue, setSymbolBit } from "../BlockLogic.js"
import { ensureOffsets } from "../../utils/offsets.js"
import { readTypedValue } from "../../utils/tools.js"
import { Popup } from "../../editor/UI/Elements/components/popup.js"
import { MiniCodeEditor } from "../MiniCodeEditor.js"
import { getIconType } from "../../editor/UI/Elements/components/icons.js"


// ============================================================================
// CONNECTION PATH ROUTING SYSTEM
// ============================================================================

// Debug flag for connection routing logs - set to true to enable verbose logging
const DEBUG_CONNECTION_ROUTING = false

/**
 * @typedef {Object} ConnectionPath
 * @property {string} srcId - Source block ID
 * @property {string} destId - Destination block ID
 * @property {Array<{x: number, y: number, offsetX?: number, offsetY?: number}>} points - Path points in grid coordinates with optional pixel offsets
 * @property {string} svgPath - SVG path string for rendering
 * @property {number} [hOffset] - Horizontal line offset (fraction of block height, for vertical spacing)
 * @property {number} [vOffset] - Vertical line offset (fraction of block width, for horizontal spacing)
 * @property {number} [cornerX] - X position where the connection turns from horizontal to vertical (grid units)
 */

/**
 * @typedef {Object} ConnectionPathCache
 * @property {string} hash - Hash of blocks and connections for cache invalidation
 * @property {ConnectionPath[]} paths - Computed paths
 * @property {Array<{x1: number, y1: number, x2: number, y2: number, srcId: string, destId: string}>} segments - All line segments for collision detection
 */

/** @type {Map<string, ConnectionPathCache>} */
const connectionPathCache = new Map()

/**
 * Compute a hash of the ladder's blocks and connections for cache invalidation
 * @param {PLC_Ladder} ladder 
 * @returns {string}
 */
function computeLadderHash(ladder) {
  const blocks = ladder.nodes || []
  const connections = ladder.connections || []
  
  const blockStr = blocks.map(b => `${b.id}:${b.x},${b.y}`).sort().join('|')
  const connStr = connections.map(c => {
    if (c.from && c.to) return `${c.from.id}->${c.to.id}`
    if (c.sources && c.destinations) {
      return c.sources.sort().join(',') + '=>' + c.destinations.sort().join(',')
    }
    return ''
  }).sort().join('|')
  
  return `${blockStr}::${connStr}`
}

/**
 * Build a grid occupancy map for routing
 * @param {PLC_LadderBlock[]} blocks 
 * @returns {Set<string>} Set of "x,y" strings for occupied cells
 */
function buildOccupancyMap(blocks) {
  const occupied = new Set()
  for (const b of blocks) {
    occupied.add(`${b.x},${b.y}`)
  }
  return occupied
}

/**
 * Check if a point collides with existing line segments
 * @param {number} x 
 * @param {number} y 
 * @param {Array<{x1: number, y1: number, x2: number, y2: number}>} segments 
 * @param {number} tolerance
 * @returns {boolean}
 */
function pointCollidesWithSegments(x, y, segments, tolerance = 0.05) {
  for (const seg of segments) {
    // Check if point is on this segment
    if (seg.x1 === seg.x2) {
      // Vertical segment
      if (Math.abs(x - seg.x1) < tolerance) {
        const minY = Math.min(seg.y1, seg.y2)
        const maxY = Math.max(seg.y1, seg.y2)
        if (y > minY + tolerance && y < maxY - tolerance) {
          return true
        }
      }
    } else if (seg.y1 === seg.y2) {
      // Horizontal segment
      if (Math.abs(y - seg.y1) < tolerance) {
        const minX = Math.min(seg.x1, seg.x2)
        const maxX = Math.max(seg.x1, seg.x2)
        if (x > minX + tolerance && x < maxX - tolerance) {
          return true
        }
      }
    }
  }
  return false
}

/**
 * Check if two line segments intersect (properly cross, not just touch at endpoint)
 * @param {{x1: number, y1: number, x2: number, y2: number}} seg1 
 * @param {{x1: number, y1: number, x2: number, y2: number}} seg2 
 * @returns {boolean}
 */
function segmentsIntersect(seg1, seg2) {
  // Both must be axis-aligned
  const seg1Horiz = seg1.y1 === seg1.y2
  const seg1Vert = seg1.x1 === seg1.x2
  const seg2Horiz = seg2.y1 === seg2.y2
  const seg2Vert = seg2.x1 === seg2.x2
  
  if (seg1Horiz && seg2Vert) {
    // seg1 horizontal, seg2 vertical
    const y = seg1.y1
    const x = seg2.x1
    const minX1 = Math.min(seg1.x1, seg1.x2)
    const maxX1 = Math.max(seg1.x1, seg1.x2)
    const minY2 = Math.min(seg2.y1, seg2.y2)
    const maxY2 = Math.max(seg2.y1, seg2.y2)
    // Strictly inside (not at endpoints)
    return x > minX1 && x < maxX1 && y > minY2 && y < maxY2
  }
  
  if (seg1Vert && seg2Horiz) {
    // seg1 vertical, seg2 horizontal
    const x = seg1.x1
    const y = seg2.y1
    const minY1 = Math.min(seg1.y1, seg1.y2)
    const maxY1 = Math.max(seg1.y1, seg1.y2)
    const minX2 = Math.min(seg2.x1, seg2.x2)
    const maxX2 = Math.max(seg2.x1, seg2.x2)
    return y > minY1 && y < maxY1 && x > minX2 && x < maxX2
  }
  
  // Same orientation - check for overlap on same line
  if (seg1Horiz && seg2Horiz && seg1.y1 === seg2.y1) {
    const min1 = Math.min(seg1.x1, seg1.x2)
    const max1 = Math.max(seg1.x1, seg1.x2)
    const min2 = Math.min(seg2.x1, seg2.x2)
    const max2 = Math.max(seg2.x1, seg2.x2)
    // Overlap check (not just touching at single point)
    return max1 > min2 && max2 > min1 && !(max1 === min2 || max2 === min1)
  }
  
  if (seg1Vert && seg2Vert && seg1.x1 === seg2.x1) {
    const min1 = Math.min(seg1.y1, seg1.y2)
    const max1 = Math.max(seg1.y1, seg1.y2)
    const min2 = Math.min(seg2.y1, seg2.y2)
    const max2 = Math.max(seg2.y1, seg2.y2)
    return max1 > min2 && max2 > min1 && !(max1 === min2 || max2 === min1)
  }
  
  return false
}

/**
 * Convert path points to SVG path string and segment list
 * @param {Array<{x: number, y: number}>} points 
 * @param {number} blockWidth 
 * @param {number} blockHeight 
 * @returns {{svgPath: string, segments: Array<{x1: number, y1: number, x2: number, y2: number}>}}
 */
function pointsToSvgPath(points, blockWidth, blockHeight) {
  if (points.length < 2) return { svgPath: '', segments: [] }
  
  const segments = []
  let svgPath = `M ${points[0].x * blockWidth + blockWidth} ${points[0].y * blockHeight + blockHeight / 2}`
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    
    // Convert to pixel coordinates
    const prevPixelX = prev.x * blockWidth + blockWidth
    const prevPixelY = prev.y * blockHeight + blockHeight / 2
    const currPixelX = i === points.length - 1 
      ? curr.x * blockWidth  // Last point connects to left side of dest
      : curr.x * blockWidth + blockWidth
    const currPixelY = curr.y * blockHeight + blockHeight / 2
    
    // Use relative movements for cleaner SVG
    if (prevPixelY === currPixelY) {
      // Horizontal
      svgPath += ` h ${currPixelX - prevPixelX}`
    } else if (prevPixelX === currPixelX) {
      // Vertical
      svgPath += ` v ${currPixelY - prevPixelY}`
    } else {
      // Diagonal (shouldn't happen but handle gracefully)
      svgPath += ` L ${currPixelX} ${currPixelY}`
    }
    
    // Add segment in grid coordinates for collision detection
    segments.push({
      x1: prev.x + 1, // +1 because we start from right side of block
      y1: prev.y,
      x2: i === points.length - 1 ? curr.x : curr.x + 1,
      y2: curr.y
    })
  }
  
  return { svgPath, segments }
}

/**
 * Route a single connection from source to destination
 * Uses L-shaped routing: horizontal first at source row, then vertical to dest row
 * @param {PLC_LadderBlock} srcBlock 
 * @param {PLC_LadderBlock} destBlock 
 * @param {Set<string>} occupiedCells 
 * @param {Array<{x1: number, y1: number, x2: number, y2: number, srcId: string, destId: string}>} existingSegments 
 * @param {number} hOffset - Horizontal line vertical offset (fraction of block height, e.g., 0.1 = 10% of block height)
 * @param {number} vOffset - Vertical line horizontal offset (fraction of block width)
 * @returns {{points: Array<{x: number, y: number}>, segments: Array<{x1: number, y1: number, x2: number, y2: number}>, hOffset: number, vOffset: number} | null}
 */
function routeConnection(srcBlock, destBlock, occupiedCells, existingSegments, hOffset = 0, vOffset = 0) {
  const srcX = srcBlock.x
  const srcY = srcBlock.y
  const destX = destBlock.x
  const destY = destBlock.y
  
  // Destination must be to the right of source
  if (destX <= srcX) return null
  
  // Check if blocks are in horizontal path
  const hasBlockInHorizontalPath = () => {
    for (let x = srcX + 1; x < destX; x++) {
      if (occupiedCells.has(`${x},${srcY}`)) return true
    }
    return false
  }
  
  // Check if blocks are in vertical path
  const hasBlockInVerticalPath = (x, y1, y2) => {
    const minY = Math.min(y1, y2)
    const maxY = Math.max(y1, y2)
    for (let y = minY + 1; y < maxY; y++) {
      if (occupiedCells.has(`${x},${y}`)) return true
    }
    return false
  }
  
  // Simple L-shaped path: horizontal at srcY, then vertical to destY
  if (srcY === destY) {
    // Same row - direct horizontal connection
    // Check for blocks in path
    if (hasBlockInHorizontalPath()) return null
    
    // Create simple 2-point path
    const points = [
      { x: srcX, y: srcY },
      { x: destX, y: destY }
    ]
    
    // Create segment (with offset for collision detection)
    // Y coordinates are at row center (y + 0.5) plus any offset
    const segments = [{
      x1: srcX + 1,
      y1: srcY + 0.5 + hOffset,
      x2: destX,
      y2: destY + 0.5 + hOffset
    }]
    
    return { points, segments, hOffset, vOffset }
  }
  
  // Cross-row connection - L-shaped path
  // Route: srcX,srcY -> destX,srcY -> destX,destY
  
  // Check for blocks in horizontal path
  if (hasBlockInHorizontalPath()) return null
  
  // Check for blocks in vertical path
  if (hasBlockInVerticalPath(destX, srcY, destY)) return null
  
  // Create L-shaped path
  const points = [
    { x: srcX, y: srcY },
    { x: destX, y: srcY },  // Corner point
    { x: destX, y: destY }
  ]
  
  // Create segments with offsets
  // Y coordinates for horizontal segment at row center (y + 0.5)
  // Vertical segment goes from source row center to dest row center
  const segments = [
    {
      x1: srcX + 1,
      y1: srcY + 0.5 + hOffset,
      x2: destX + vOffset,
      y2: srcY + 0.5 + hOffset
    },
    {
      x1: destX + vOffset,
      y1: srcY + 0.5 + hOffset,
      x2: destX + vOffset,
      y2: destY + 0.5
    }
  ]
  
  return { points, segments, hOffset, vOffset }
}

/**
 * Compute connection paths for a ladder with cascading corners to avoid overlaps
 * Uses iterative approach: render default, find conflicts, push away, repeat
 * @param {VovkPLCEditor} editor 
 * @param {PLC_Ladder} ladder 
 * @returns {ConnectionPathCache}
 */
function computeConnectionPaths(editor, ladder) {
  const ladderId = ladder.id || 'unknown'
  const hash = computeLadderHash(ladder)
  
  // Check cache
  const cached = connectionPathCache.get(ladderId)
  if (cached && cached.hash === hash) {
    return cached
  }
  
  const { ladder_block_width, ladder_block_height } = editor.properties
  const blocks = ladder.nodes || []
  const connections = ladder.connections || []
  
  // Build occupancy map
  const occupiedCells = buildOccupancyMap(blocks)
  
  // Get all connection pairs
  /** @type {Array<{srcId: string, destId: string, srcBlock: PLC_LadderBlock, destBlock: PLC_LadderBlock, cornerX?: number}>} */
  const pairs = []
  
  for (const conn of connections) {
    if (conn.from && conn.to) {
      const srcBlock = blocks.find(b => b.id === conn.from.id)
      const destBlock = blocks.find(b => b.id === conn.to.id)
      if (srcBlock && destBlock) {
        pairs.push({ srcId: conn.from.id, destId: conn.to.id, srcBlock, destBlock })
      }
    } else if (conn.sources && conn.destinations) {
      for (const srcId of conn.sources) {
        for (const destId of conn.destinations) {
          const srcBlock = blocks.find(b => b.id === srcId)
          const destBlock = blocks.find(b => b.id === destId)
          if (srcBlock && destBlock) {
            pairs.push({ srcId, destId, srcBlock, destBlock })
          }
        }
      }
    }
  }
  
  // Separate same-row and cross-row connections
  const sameRowPairs = pairs.filter(p => p.srcBlock.y === p.destBlock.y)
  const crossRowPairs = pairs.filter(p => p.srcBlock.y !== p.destBlock.y)
  
  // Route connections
  /** @type {ConnectionPath[]} */
  const paths = []
  /** @type {Array<{x1: number, y1: number, x2: number, y2: number, srcId: string, destId: string}>} */
  const allSegments = []
  
  // First route same-row connections (simple horizontal lines)
  for (const pair of sameRowPairs) {
    const srcX = pair.srcBlock.x
    const srcY = pair.srcBlock.y
    const destX = pair.destBlock.x
    
    if (destX <= srcX) continue // Invalid
    
    // Check for blocks in path
    let blocked = false
    for (let x = srcX + 1; x < destX; x++) {
      if (occupiedCells.has(`${x},${srcY}`)) {
        blocked = true
        break
      }
    }
    if (blocked) continue
    
    const points = [{ x: srcX, y: srcY }, { x: destX, y: srcY }]
    const segments = [{
      x1: srcX + 1,
      y1: srcY + 0.5,
      x2: destX,
      y2: srcY + 0.5,
      srcId: pair.srcId,
      destId: pair.destId
    }]
    
    paths.push({
      srcId: pair.srcId,
      destId: pair.destId,
      points,
      svgPath: '',
      hOffset: 0,
      vOffset: 0
    })
    
    allSegments.push(...segments)
  }
  
  // STEP 1: Initialize all cross-row connections with default cornerX = destX
  for (const pair of crossRowPairs) {
    const srcX = pair.srcBlock.x
    const destX = pair.destBlock.x
    
    if (destX <= srcX) continue // Invalid
    
    pair.cornerX = destX // Start with ideal position
  }
  
  // STEP 2: Group and space connections evenly
  // Group ALL connections that share vertical space, then space them evenly
  const validPairs = crossRowPairs.filter(p => p.cornerX !== undefined)
  
  // Helper to get vertical range of a pair
  const getVerticalRange = (pair) => {
    const minY = Math.min(pair.srcBlock.y, pair.destBlock.y)
    const maxY = Math.max(pair.srcBlock.y, pair.destBlock.y)
    return { minY, maxY }
  }
  
  // Helper to check if two pairs' vertical segments overlap or touch
  const verticalRangesOverlapOrTouch = (pairA, pairB) => {
    const rangeA = getVerticalRange(pairA)
    const rangeB = getVerticalRange(pairB)
    // Touch or overlap: not completely separate
    return !(rangeA.maxY < rangeB.minY || rangeB.maxY < rangeA.minY)
  }
  
  // Helper to check if two pairs could conflict horizontally
  // They only conflict if their cornerX zones overlap AND destX values are close
  // CornerX can range from srcX+1 to destX, so check if those ranges intersect
  const horizontalRangesOverlap = (pairA, pairB) => {
    const leftA = pairA.srcBlock.x + 1
    const rightA = pairA.destBlock.x
    const leftB = pairB.srcBlock.x + 1
    const rightB = pairB.destBlock.x
    
    // Also require destX values to be within 1 cell of each other
    // Otherwise they won't actually compete for the same cornerX positions
    const destXClose = Math.abs(pairA.destBlock.x - pairB.destBlock.x) <= 1
    
    // Overlap if one range contains or intersects the other
    const rangesOverlap = !(rightA < leftB || rightB < leftA)
    
    return rangesOverlap && destXClose
  }
  
  // Build a set of blocks that have incoming connections (their input terminals have wires)
  const blocksWithIncomingConnection = new Set()
  for (const p of pairs) {
    blocksWithIncomingConnection.add(`${p.destBlock.x},${p.destBlock.y}`)
  }
  
  // Helper to check if a cornerX position hits a block for a given pair
  const cornerHitsBlock = (pair, cx) => {
    const srcX = pair.srcBlock.x
    const srcY = pair.srcBlock.y
    const destX = pair.destBlock.x
    const destY = pair.destBlock.y
    const minY = Math.min(srcY, destY)
    const maxY = Math.max(srcY, destY)
    const col = Math.floor(cx)
    
    // Check horizontal path on srcY (from srcX+1 up to and including floor(cx))
    // But don't check beyond destX-1 since destX column has the destination block on destY
    const hCheckEnd = Math.min(Math.floor(cx), destX)
    for (let x = srcX + 1; x <= hCheckEnd; x++) {
      // Skip the destination column - the dest block is at destY not srcY
      if (x === destX) continue
      if (occupiedCells.has(`${x},${srcY}`)) {
        return true
      }
    }
    
    // Special case: if vertical wire is at destX column, check if there's another block
    // at (destX, srcY) that would have its terminal touched by the wire
    if (col === destX) {
      if (occupiedCells.has(`${destX},${srcY}`)) {
        return true
      }
      // If there's a connected block at destX column on srcY row, avoid its input wire too
      if (blocksWithIncomingConnection.has(`${destX},${srcY}`)) {
        return true
      }
    }
    
    // Check vertical path (from minY+1 to maxY-1, not including endpoints)
    // Only check adjacency on INTERMEDIATE rows - not srcY or destY
    for (let y = minY + 1; y < maxY; y++) {
      if (occupiedCells.has(`${col},${y}`)) {
        return true
      }
      // Also check adjacent cells to avoid touching their connection terminals
      // A block at (col-1, y) has its right terminal at col, so avoid
      // A block at (col+1, y) has its left terminal at col+1, so avoid if wire is close to right edge
      // Only check if wire is actually close to the adjacent cell
      const fracPart = cx - col
      if (fracPart < 0.25 && occupiedCells.has(`${col - 1},${y}`)) {
        return true // Wire close to left edge, would touch block on left
      }
      if (fracPart > 0.75 && occupiedCells.has(`${col + 1},${y}`)) {
        return true // Wire close to right edge, would touch block on right
      }
    }
    
    // Also check adjacency at destY for the vertical wire position
    // Only check when wire is actually close to the adjacent cell's edge
    if (col !== destX) {
      const fracPart = cx - col
      if (fracPart < 0.25 && occupiedCells.has(`${col - 1},${destY}`)) {
        return true
      }
      if (fracPart > 0.75 && occupiedCells.has(`${col + 1},${destY}`)) {
        return true
      }
    }
    
    // Check horizontal path on destY (from cornerX to destX-1)
    // This is for L-shaped paths where corner is before dest
    if (cx < destX) {
      const hDestStart = Math.ceil(cx)
      for (let x = hDestStart; x < destX; x++) {
        if (occupiedCells.has(`${x},${destY}`)) {
          return true
        }
      }
    }
    
    return false
  }
  
  // Build groups of connections with overlapping/touching vertical ranges
  // Using Union-Find to group transitively connected pairs
  const pairIndex = new Map()
  validPairs.forEach((p, i) => pairIndex.set(p, i))
  
  const parent = new Array(validPairs.length)
  for (let i = 0; i < validPairs.length; i++) parent[i] = i
  
  const find = (x) => {
    if (parent[x] !== x) parent[x] = find(parent[x])
    return parent[x]
  }
  
  const union = (x, y) => {
    const px = find(x), py = find(y)
    if (px !== py) parent[px] = py
  }
  
  // Union all pairs that have overlapping vertical AND horizontal ranges
  // Both must overlap for connections to potentially conflict
  for (let i = 0; i < validPairs.length; i++) {
    for (let j = i + 1; j < validPairs.length; j++) {
      if (verticalRangesOverlapOrTouch(validPairs[i], validPairs[j]) && 
          horizontalRangesOverlap(validPairs[i], validPairs[j])) {
        union(i, j)
      }
    }
  }
  
  // Build groups from Union-Find result
  const groupMap = new Map()
  for (let i = 0; i < validPairs.length; i++) {
    const root = find(i)
    if (!groupMap.has(root)) groupMap.set(root, [])
    groupMap.get(root).push(validPairs[i])
  }
  
  // Process each group
  for (const [root, group] of groupMap) {
    // For single connections, still check for block conflicts
    if (group.length === 1) {
      const pair = group[0]
      let targetX = pair.cornerX
      const pairLimit = pair.srcBlock.x + 1
      const pairDestX = pair.destBlock.x
      
      if (DEBUG_CONNECTION_ROUTING) {
        console.log(`=== Single connection: src(${pair.srcBlock.x},${pair.srcBlock.y}) -> dest(${pair.destBlock.x},${pair.destBlock.y}) ===`)
        console.log(`  initial cornerX = ${targetX}, pairLimit = ${pairLimit}, pairDestX = ${pairDestX}`)
      }
      
      // Check for block conflicts - search for ANY valid position in range
      if (cornerHitsBlock(pair, targetX)) {
        if (DEBUG_CONNECTION_ROUTING) console.log(`  -> conflict at ${targetX}, searching...`)
        // Try positions from pairLimit to pairDestX in 0.1 increments
        // Collect all valid positions and pick the one closest to targetX
        const validPositions = []
        for (let tryX = pairLimit; tryX <= pairDestX; tryX += 0.1) {
          if (!cornerHitsBlock(pair, tryX)) {
            validPositions.push(tryX)
          }
        }
        
        if (validPositions.length > 0) {
          // Pick the valid position closest to the original targetX
          let bestX = validPositions[0]
          let bestDist = Math.abs(validPositions[0] - targetX)
          for (const vx of validPositions) {
            const dist = Math.abs(vx - targetX)
            if (dist < bestDist) {
              bestDist = dist
              bestX = vx
            }
          }
          targetX = bestX
          if (DEBUG_CONNECTION_ROUTING) console.log(`  -> found valid: ${targetX} (from ${validPositions.length} candidates)`)
        } else {
          // No valid position found, clamp to pairLimit as fallback
          targetX = pairLimit
          if (DEBUG_CONNECTION_ROUTING) console.log(`  -> no valid position, using pairLimit: ${targetX}`)
        }
        pair.cornerX = targetX
      } else {
        if (DEBUG_CONNECTION_ROUTING) console.log(`  -> no conflict, keeping ${targetX}`)
      }
      continue
    }
    
    // Determine dominant direction: UP (srcY > destY) or DOWN (srcY < destY)
    let upCount = 0, downCount = 0
    for (const pair of group) {
      if (pair.srcBlock.y > pair.destBlock.y) upCount++
      else if (pair.srcBlock.y < pair.destBlock.y) downCount++
    }
    const goingUp = upCount >= downCount
    
    // Sort by srcY ascending
    group.sort((a, b) => {
      if (a.srcBlock.y !== b.srcBlock.y) return a.srcBlock.y - b.srcBlock.y
      return b.destBlock.x - a.destBlock.x
    })
    
    if (DEBUG_CONNECTION_ROUTING) {
      console.log('=== Processing conflict group ===')
      console.log('Group size:', group.length, 'Direction:', goingUp ? 'UP' : 'DOWN')
      console.log('Connections in group:')
      group.forEach((p, i) => {
        console.log(`  [${i}] src(${p.srcBlock.x},${p.srcBlock.y}) -> dest(${p.destBlock.x},${p.destBlock.y})`)
      })
    }
    
    // Find the anchor (rightmost destination X among the group)
    const anchorX = Math.max(...group.map(p => p.destBlock.x))
    if (DEBUG_CONNECTION_ROUTING) console.log('anchorX (rightmost destX):', anchorX)
    
    // Find the left limit - right edge of source block (srcX + 1)
    // Use MAXIMUM of all srcX + 1 (rightmost source's right edge)
    let leftLimit = 0
    for (const pair of group) {
      leftLimit = Math.max(leftLimit, pair.srcBlock.x + 1)
    }
    if (DEBUG_CONNECTION_ROUTING) console.log('leftLimit (max srcX + 1):', leftLimit)
    
    // Calculate available space and spacing
    const availableSpace = anchorX - leftLimit
    const numConnections = group.length
    
    let spacing = 0
    if (numConnections > 1) {
      // Calculate even spacing, but cap at 1.0 (don't spread more than 1 cell apart)
      spacing = Math.min(1.0, availableSpace / (numConnections - 1))
    }
    if (DEBUG_CONNECTION_ROUTING) {
      console.log('availableSpace:', availableSpace)
      console.log('numConnections:', numConnections)
      console.log('spacing (capped at 1.0):', spacing)
    }
    
    // Distribute corners based on direction
    // Both are right-aligned (starting from anchorX), but UP reverses the index
    if (DEBUG_CONNECTION_ROUTING) console.log('Distributing corners:')
    
    // Track positions already assigned in this group to avoid overlaps
    const usedPositions = []
    
    for (let i = 0; i < group.length; i++) {
      const pair = group[i]
      let targetX
      
      if (goingUp) {
        // Going UP: right-aligned but top sources get leftmost (reverse index)
        const reverseI = group.length - 1 - i
        targetX = anchorX - (reverseI * spacing)
        if (DEBUG_CONNECTION_ROUTING) console.log(`  [${i}] initial targetX = ${anchorX} - (${reverseI} * ${spacing}) = ${targetX}`)
      } else {
        // Going DOWN: right-aligned, top sources get rightmost
        targetX = anchorX - (i * spacing)
        if (DEBUG_CONNECTION_ROUTING) console.log(`  [${i}] initial targetX = ${anchorX} - (${i} * ${spacing}) = ${targetX}`)
      }
      
      // Enforce per-pair limit (can't go left of own srcX + 1, right edge of source)
      const pairLimit = pair.srcBlock.x + 1
      if (targetX < pairLimit) {
        if (DEBUG_CONNECTION_ROUTING) console.log(`    -> clamped to pairLimit: ${pairLimit}`)
        targetX = pairLimit
      }
      
      // Enforce pair's own destX limit (corner can't be past own destination)
      const pairDestX = pair.destBlock.x
      if (targetX > pairDestX) {
        if (DEBUG_CONNECTION_ROUTING) console.log(`    -> clamped to pair destX: ${pairDestX}`)
        targetX = pairDestX
      }
      
      // Helper to check if position is too close to an already-used position
      const tooCloseToUsed = (x) => {
        for (const used of usedPositions) {
          if (Math.abs(x - used) < 0.15) return true
        }
        return false
      }
      
      // Check for block conflicts OR position already used - search for valid position
      if (cornerHitsBlock(pair, targetX) || tooCloseToUsed(targetX)) {
        const reason = cornerHitsBlock(pair, targetX) ? 'block conflict' : 'too close to used'
        if (DEBUG_CONNECTION_ROUTING) console.log(`    -> ${reason} at ${targetX}, searching for valid position...`)
        
        // Try positions from pairLimit to pairDestX in 0.1 increments
        // Collect all valid positions (no block conflict AND not too close to used)
        const validPositions = []
        // Also collect positions that only have block conflict (no overlap with used wires)
        const blockConflictOnly = []
        
        for (let tryX = pairLimit; tryX <= pairDestX; tryX += 0.1) {
          const hasBlockConflict = cornerHitsBlock(pair, tryX)
          const hasUsedConflict = tooCloseToUsed(tryX)
          
          if (!hasBlockConflict && !hasUsedConflict) {
            validPositions.push(tryX)
          } else if (hasBlockConflict && !hasUsedConflict) {
            // Block conflict but at least no wire overlap
            blockConflictOnly.push(tryX)
          }
        }
        
        if (validPositions.length > 0) {
          // Pick the valid position closest to the original targetX
          let bestX = validPositions[0]
          let bestDist = Math.abs(validPositions[0] - targetX)
          for (const vx of validPositions) {
            const dist = Math.abs(vx - targetX)
            if (dist < bestDist) {
              bestDist = dist
              bestX = vx
            }
          }
          targetX = bestX
          if (DEBUG_CONNECTION_ROUTING) console.log(`    -> found valid position: ${targetX} (from ${validPositions.length} candidates)`)
        } else if (blockConflictOnly.length > 0) {
          // Fallback: accept block conflict but avoid wire overlap
          let bestX = blockConflictOnly[0]
          let bestDist = Math.abs(blockConflictOnly[0] - targetX)
          for (const vx of blockConflictOnly) {
            const dist = Math.abs(vx - targetX)
            if (dist < bestDist) {
              bestDist = dist
              bestX = vx
            }
          }
          targetX = bestX
          if (DEBUG_CONNECTION_ROUTING) console.log(`    -> fallback to block-conflict position: ${targetX} (avoids wire overlap)`)
        } else {
          // Last resort: use pairLimit even if it overlaps
          targetX = pairLimit
          if (DEBUG_CONNECTION_ROUTING) console.log(`    -> no position found, using pairLimit: ${targetX}`)
        }
      }
      
      if (DEBUG_CONNECTION_ROUTING) console.log(`  [${i}] FINAL cornerX = ${targetX}`)
      pair.cornerX = targetX
      usedPositions.push(targetX)
    }
    if (DEBUG_CONNECTION_ROUTING) console.log('=================================')
  }
  
  // STEP 3: Build final paths and segments
  for (const pair of validPairs) {
    const srcX = pair.srcBlock.x
    const srcY = pair.srcBlock.y
    const destX = pair.destBlock.x
    const destY = pair.destBlock.y
    const cornerX = pair.cornerX
    
    const points = [
      { x: srcX, y: srcY },
      { x: cornerX, y: srcY },
      { x: cornerX, y: destY }
    ]
    
    // Create segments
    const hSeg = {
      x1: srcX + 1,
      y1: srcY + 0.5,
      x2: cornerX,
      y2: srcY + 0.5,
      srcId: pair.srcId,
      destId: pair.destId
    }
    
    const vSeg = {
      x1: cornerX,
      y1: srcY + 0.5,
      x2: cornerX,
      y2: destY + 0.5,
      srcId: pair.srcId,
      destId: pair.destId
    }
    
    const segments = [hSeg, vSeg]
    
    // Final horizontal segment from corner to dest (if corner isn't at destX)
    if (Math.abs(cornerX - destX) > 0.01) {
      segments.push({
        x1: cornerX,
        y1: destY + 0.5,
        x2: destX,
        y2: destY + 0.5,
        srcId: pair.srcId,
        destId: pair.destId
      })
    }
    
    paths.push({
      srcId: pair.srcId,
      destId: pair.destId,
      points,
      svgPath: '',
      hOffset: 0,
      vOffset: 0,
      cornerX
    })
    
    allSegments.push(...segments)
  }
  
  // Cache result
  const cacheEntry = { hash, paths, segments: allSegments }
  connectionPathCache.set(ladderId, cacheEntry)
  
  return cacheEntry
}

/**
 * Get cached connection segments for path validation
 * @param {VovkPLCEditor} editor 
 * @param {PLC_Ladder} ladder 
 * @returns {{horizontalSegments: Array<{y: number, minX: number, maxX: number, srcId: string, destId: string}>, verticalSegments: Array<{x: number, minY: number, maxY: number, srcId: string, destId: string}>}}
 */
function getConnectionSegments(editor, ladder) {
  const cache = computeConnectionPaths(editor, ladder)
  
  const horizontalSegments = []
  const verticalSegments = []
  
  for (const seg of cache.segments) {
    if (seg.y1 === seg.y2) {
      // Horizontal segment
      horizontalSegments.push({
        y: seg.y1,
        minX: Math.min(seg.x1, seg.x2),
        maxX: Math.max(seg.x1, seg.x2),
        srcId: seg.srcId,
        destId: seg.destId
      })
    } else if (seg.x1 === seg.x2) {
      // Vertical segment
      verticalSegments.push({
        x: seg.x1,
        minY: Math.min(seg.y1, seg.y2),
        maxY: Math.max(seg.y1, seg.y2),
        srcId: seg.srcId,
        destId: seg.destId
      })
    }
  }
  
  return { horizontalSegments, verticalSegments }
}

/**
 * Check if a proposed connection path is clear (no blocks or crossing existing connections)
 * For use in connection handle validation
 * @param {PLC_LadderBlock} sourceBlock 
 * @param {PLC_LadderBlock} destBlock 
 * @param {PLC_LadderBlock[]} blocks 
 * @param {{horizontalSegments: Array, verticalSegments: Array}} segments 
 * @returns {boolean}
 */
function isConnectionPathClear(sourceBlock, destBlock, blocks, segments) {
  const srcX = sourceBlock.x
  const srcY = sourceBlock.y
  const destX = destBlock.x
  const destY = destBlock.y
  
  // Destination must be strictly to the right
  if (destX <= srcX) return false
  
  // Check for blocks in horizontal path at source row
  for (const blk of blocks) {
    if (blk.id === sourceBlock.id || blk.id === destBlock.id) continue
    if (blk.y === srcY && blk.x > srcX && blk.x < destX) {
      return false
    }
  }
  
  // Check if horizontal segment crosses any vertical connection lines
  for (const vseg of segments.verticalSegments) {
    if (vseg.x <= srcX || vseg.x >= destX) continue
    if (srcY < vseg.minY || srcY > vseg.maxY) continue
    if (vseg.srcId === sourceBlock.id || vseg.destId === sourceBlock.id) continue
    if (vseg.srcId === destBlock.id || vseg.destId === destBlock.id) continue
    return false
  }
  
  // For cross-row, check vertical path at dest column
  if (srcY !== destY) {
    const minY = Math.min(srcY, destY)
    const maxY = Math.max(srcY, destY)
    
    for (const blk of blocks) {
      if (blk.id === sourceBlock.id || blk.id === destBlock.id) continue
      if (blk.x === destX && blk.y > minY && blk.y < maxY) {
        return false
      }
    }
    
    // Check if our vertical segment at destX would overlap with existing vertical segments
    // This prevents "short-circuit" where two connections share the same vertical path
    for (const vseg of segments.verticalSegments) {
      if (vseg.x !== destX) continue
      // Skip segments that start/end at the destination (they share an endpoint at destBlock)
      if (vseg.destId === destBlock.id) continue
      // Skip segments from our source
      if (vseg.srcId === sourceBlock.id) continue
      // Check if vertical ranges overlap (not just touch at endpoints)
      const overlap = Math.max(minY, vseg.minY) < Math.min(maxY, vseg.maxY)
      if (overlap) {
        return false
      }
    }
  }
  
  // Function to check if segments interleave
  const segmentsInterleave = (a1, a2, b1, b2) => {
    const aMin = Math.min(a1, a2)
    const aMax = Math.max(a1, a2)
    const bMin = Math.min(b1, b2)
    const bMax = Math.max(b1, b2)
    return (aMin < bMin && bMin < aMax && aMax < bMax) ||
           (bMin < aMin && aMin < bMax && bMax < aMax)
  }
  
  // Check horizontal segment interleaving
  if (srcY === destY) {
    for (const seg of segments.horizontalSegments) {
      if (seg.y !== srcY) continue
      if (seg.srcId === sourceBlock.id || seg.destId === sourceBlock.id) continue
      if (seg.srcId === destBlock.id || seg.destId === destBlock.id) continue
      if (segmentsInterleave(srcX, destX, seg.minX, seg.maxX)) {
        return false
      }
    }
    return true
  }
  
  // Cross-row: check horizontal segment at source row
  for (const seg of segments.horizontalSegments) {
    if (seg.y === srcY) {
      if (seg.srcId === sourceBlock.id || seg.destId === sourceBlock.id) continue
      if (seg.srcId === destBlock.id || seg.destId === destBlock.id) continue
      if (segmentsInterleave(srcX, destX, seg.minX, seg.maxX)) {
        return false
      }
    }
  }
  
  // Check vertical segment crossing horizontal connections
  const minY = Math.min(srcY, destY)
  const maxY = Math.max(srcY, destY)
  for (const seg of segments.horizontalSegments) {
    if (seg.y > minY && seg.y < maxY) {
      if (destX > seg.minX && destX < seg.maxX) {
        return false
      }
    }
  }
  
  return true
}

/**
 * Find connections at a clicked point and return the connection pairs that pass through
 * @param {VovkPLCEditor} editor 
 * @param {PLC_Ladder} ladder 
 * @param {number} clickX - Click X in grid coordinates (fractional)
 * @param {number} clickY - Click Y in grid coordinates (fractional)
 * @returns {{pairs: Array<{srcId: string, destId: string}>} | null}
 */
function findConnectionAtPoint(editor, ladder, clickX, clickY) {
  const cache = computeConnectionPaths(editor, ladder)
  const { ladder_block_width, ladder_block_height } = editor.properties
  
  // Hit tolerance in grid units (how close to the line we need to be)
  // 0.05 means within 5% of a block height/width from the line
  const hitTolerance = 0.05
  
  // Find all segments that the click is on
  /** @type {Array<{srcId: string, destId: string}>} */
  const matchingPairs = []
  
  for (const seg of cache.segments) {
    const isHorizontal = Math.abs(seg.y1 - seg.y2) < 0.01
    const isVertical = Math.abs(seg.x1 - seg.x2) < 0.01
    
    if (isHorizontal) {
      const segY = seg.y1
      const minX = Math.min(seg.x1, seg.x2)
      const maxX = Math.max(seg.x1, seg.x2)
      
      // Check if click is on this horizontal segment
      if (Math.abs(clickY - segY) < hitTolerance && clickX >= minX - hitTolerance && clickX <= maxX + hitTolerance) {
        // Add this pair if not already added
        const exists = matchingPairs.some(p => p.srcId === seg.srcId && p.destId === seg.destId)
        if (!exists) {
          matchingPairs.push({ srcId: seg.srcId, destId: seg.destId })
        }
      }
    } else if (isVertical) {
      const segX = seg.x1
      const minY = Math.min(seg.y1, seg.y2)
      const maxY = Math.max(seg.y1, seg.y2)
      
      // Check if click is on this vertical segment
      if (Math.abs(clickX - segX) < hitTolerance && clickY >= minY - hitTolerance && clickY <= maxY + hitTolerance) {
        // Add this pair if not already added
        const exists = matchingPairs.some(p => p.srcId === seg.srcId && p.destId === seg.destId)
        if (!exists) {
          matchingPairs.push({ srcId: seg.srcId, destId: seg.destId })
        }
      }
    }
  }
  
  if (matchingPairs.length === 0) return null
  
  return { pairs: matchingPairs }
}

// ============================================================================
// END CONNECTION PATH ROUTING SYSTEM
// ============================================================================


/**
 * Ensures ladder is in correct format and provides backward-compatible accessors.
 * Call this at the start of render functions to ensure ladder.blocks works as alias for ladder.nodes.
 * @param {PLC_Ladder} ladder 
 */
function ensureLadderFormat(ladder) {
  // Migrate to new format if needed
  migrateLadderBlock(ladder)
  
  // Create backward-compatible 'blocks' alias if not present
  // This allows existing code to use ladder.blocks while data is stored in ladder.nodes
  if (!ladder.blocks && ladder.nodes) {
    Object.defineProperty(ladder, 'blocks', {
      get() { return this.nodes },
      set(val) { this.nodes = val },
      configurable: true,
      enumerable: false
    })
  }
}

/**
 * Expand grouped connections to legacy format for rendering compatibility.
 * Creates individual { from: {id}, to: {id} } connections from grouped { sources, destinations } connections.
 * @param {PLC_Ladder} ladder 
 * @returns {{ from: { id: string }, to: { id: string }, state?: any }[]}
 */
function getLegacyConnections(ladder) {
  const connections = ladder.connections || []
  const legacy = []
  
  for (const conn of connections) {
    // Check if already in legacy format
    if (conn.from && conn.to) {
      legacy.push(conn)
      continue
    }
    
    // Expand grouped format to individual connections
    const sources = conn.sources || []
    const destinations = conn.destinations || []
    
    for (const srcId of sources) {
      for (const destId of destinations) {
        legacy.push({
          id: `${srcId}_to_${destId}`,
          from: { id: srcId },
          to: { id: destId },
          state: conn.state
        })
      }
    }
  }
  
  return legacy
}

/**
 * Auto-connect adjacent blocks based on their positions.
 * Connects block A to block B if B is directly to the right of A (same row).
 * ONLY ADDS connections - never removes existing ones.
 * @param {PLC_Ladder} ladder 
 */
export function connectTouchingBlocks(ladder) {
  ensureLadderFormat(ladder)
  const nodes = ladder.nodes || []
  if (nodes.length === 0) return
  
  // Get existing connection pairs
  const existingPairs = new Set()
  for (const conn of ladder.connections || []) {
    if (conn.from && conn.to) {
      // Legacy format
      existingPairs.add(`${conn.from.id}->${conn.to.id}`)
    } else if (conn.sources && conn.destinations) {
      // New grouped format
      for (const src of conn.sources) {
        for (const dest of conn.destinations) {
          existingPairs.add(`${src}->${dest}`)
        }
      }
    }
  }

  // Only add new connections for adjacent nodes
  for (const node of nodes) {
    const x = node.x + 1
    const neighbors_right = nodes.filter(n => n.x === x && n.y === node.y)
    for (const neighbor of neighbors_right) {
      const pairKey = `${node.id}->${neighbor.id}`
      if (!existingPairs.has(pairKey)) {
        // Add in new grouped format (single source, single destination)
        ladder.connections.push({
          id: `conn_${node.id}_${neighbor.id}`,
          sources: [node.id],
          destinations: [neighbor.id]
        })
        existingPairs.add(pairKey)
      }
    }
  }
}

/**
 * Connect a newly added block to adjacent blocks, and split any existing connections
 * that pass through this block's position.
 * @param {PLC_Ladder} ladder 
 * @param {object} newBlock - The newly added block with x, y, id properties
 */
export function connectNewBlock(ladder, newBlock) {
  ensureLadderFormat(ladder)
  const nodes = ladder.nodes || []
  const connections = ladder.connections || []
  
  const newX = newBlock.x
  const newY = newBlock.y
  const newId = newBlock.id
  
  // Find adjacent blocks (left and right neighbors on the same row)
  const leftNeighbor = nodes.find(n => n.x === newX - 1 && n.y === newY && n.id !== newId)
  const rightNeighbor = nodes.find(n => n.x === newX + 1 && n.y === newY && n.id !== newId)
  
  // Collect all source->destination pairs that need to be split
  // These are pairs where source is left of newX and destination is right of newX on the same row
  const pairsToSplit = [] // { srcId, destId, connIndex }
  const connectionsToRemove = new Set() // indices of connections to fully remove
  
  for (let i = 0; i < connections.length; i++) {
    const conn = connections[i]
    if (conn.sources && conn.destinations) {
      // New grouped format - check each source->destination pair
      for (const srcId of conn.sources) {
        for (const destId of conn.destinations) {
          const srcNode = nodes.find(n => n.id === srcId)
          const destNode = nodes.find(n => n.id === destId)
          if (srcNode && destNode && srcNode.y === newY && destNode.y === newY) {
            if (srcNode.x < newX && destNode.x > newX) {
              pairsToSplit.push({ srcId, destId, connIndex: i })
            }
          }
        }
      }
    } else if (conn.from && conn.to) {
      // Legacy format
      const srcNode = nodes.find(n => n.id === conn.from.id)
      const destNode = nodes.find(n => n.id === conn.to.id)
      if (srcNode && destNode && srcNode.y === newY && destNode.y === newY) {
        if (srcNode.x < newX && destNode.x > newX) {
          pairsToSplit.push({ srcId: conn.from.id, destId: conn.to.id, connIndex: i, legacy: true })
          connectionsToRemove.add(i) // Legacy connections are removed entirely
        }
      }
    }
  }
  
  // Process pairs to split - for grouped connections, we need to carefully handle them
  const addedPairs = new Set()
  const modifiedConnections = new Map() // connIndex -> { removedDests: Set, removedSrcs: Set }
  
  for (const { srcId, destId, connIndex, legacy } of pairsToSplit) {
    if (legacy) {
      // Legacy connections are handled by full removal (already added to connectionsToRemove)
    } else {
      // Track which pairs to remove from this grouped connection
      if (!modifiedConnections.has(connIndex)) {
        modifiedConnections.set(connIndex, { pairs: [] })
      }
      modifiedConnections.get(connIndex).pairs.push({ srcId, destId })
    }
    
    // Add connection from source to new block (if not already added)
    const pair1 = `${srcId}->${newId}`
    if (!addedPairs.has(pair1)) {
      connections.push({
        id: `conn_${srcId}_${newId}_${Date.now()}`,
        sources: [srcId],
        destinations: [newId]
      })
      addedPairs.add(pair1)
    }
    
    // Add connection from new block to destination (if not already added)
    const pair2 = `${newId}->${destId}`
    if (!addedPairs.has(pair2)) {
      connections.push({
        id: `conn_${newId}_${destId}_${Date.now()}`,
        sources: [newId],
        destinations: [destId]
      })
      addedPairs.add(pair2)
    }
  }
  
  // Now modify grouped connections - remove split pairs and handle empty arrays
  for (const [connIndex, { pairs }] of modifiedConnections) {
    const conn = connections[connIndex]
    if (!conn || !conn.sources || !conn.destinations) continue
    
    // Build a set of pairs to remove
    const pairsToRemoveFromConn = new Set(pairs.map(p => `${p.srcId}->${p.destId}`))
    
    // Rebuild the connection without the split pairs
    // For simplicity, if ANY pairs were removed, convert to simple individual connections
    const remainingPairs = []
    for (const srcId of conn.sources) {
      for (const destId of conn.destinations) {
        const pairKey = `${srcId}->${destId}`
        if (!pairsToRemoveFromConn.has(pairKey)) {
          remainingPairs.push({ srcId, destId })
        }
      }
    }
    
    if (remainingPairs.length === 0) {
      // All pairs were split, remove the connection entirely
      connectionsToRemove.add(connIndex)
    } else {
      // Update connection with remaining pairs
      // Convert to simple source->destinations format for remaining pairs
      const newSources = [...new Set(remainingPairs.map(p => p.srcId))]
      const newDests = [...new Set(remainingPairs.map(p => p.destId))]
      conn.sources = newSources
      conn.destinations = newDests
    }
  }
  
  // Remove connections (in reverse order to preserve indices)
  const indicesToRemove = [...connectionsToRemove].sort((a, b) => b - a)
  for (const idx of indicesToRemove) {
    connections.splice(idx, 1)
  }
  
  // If no connections were split, connect to adjacent blocks if they exist
  if (pairsToSplit.length === 0) {
    // Get existing connection pairs to avoid duplicates
    const existingPairs = new Set()
    for (const conn of connections) {
      if (conn.from && conn.to) {
        existingPairs.add(`${conn.from.id}->${conn.to.id}`)
      } else if (conn.sources && conn.destinations) {
        for (const src of conn.sources) {
          for (const dest of conn.destinations) {
            existingPairs.add(`${src}->${dest}`)
          }
        }
      }
    }
    
    // Connect left neighbor -> new block
    if (leftNeighbor) {
      const pairKey = `${leftNeighbor.id}->${newId}`
      if (!existingPairs.has(pairKey)) {
        connections.push({
          id: `conn_${leftNeighbor.id}_${newId}`,
          sources: [leftNeighbor.id],
          destinations: [newId]
        })
        existingPairs.add(pairKey)
      }
    }
    
    // Connect new block -> right neighbor
    if (rightNeighbor) {
      const pairKey = `${newId}->${rightNeighbor.id}`
      if (!existingPairs.has(pairKey)) {
        connections.push({
          id: `conn_${newId}_${rightNeighbor.id}`,
          sources: [newId],
          destinations: [rightNeighbor.id]
        })
        existingPairs.add(pairKey)
      }
    }
  }
}


/** @typedef */
const memory_locations = [
  { short: 'S', name: 'system', label: 'System' },
  { short: 'C', name: 'counter', label: 'Counter' },
  { short: 'T', name: 'timer', label: 'Timer' },
  { short: 'X', name: 'input', label: 'Input' },
  { short: 'Y', name: 'output', label: 'Output' },
  { short: 'K', name: 'system', label: 'System' },  // K now maps to system
  { short: 'M', name: 'marker', label: 'Marker' },
  { short: 'M', name: 'memory', label: 'Marker' },
]

/** @type { PLC_Symbol[] } */
const system_symbols = [
  { name: 'P_100ms', location: 'system', type: 'bit', address: 2.0, initial_value: 0, comment: '100ms pulse' },
  { name: 'P_200ms', location: 'system', type: 'bit', address: 2.1, initial_value: 0, comment: '200ms pulse' },
  { name: 'P_300ms', location: 'system', type: 'bit', address: 2.2, initial_value: 0, comment: '300ms pulse' },
  { name: 'P_500ms', location: 'system', type: 'bit', address: 2.3, initial_value: 0, comment: '500ms pulse' },
  { name: 'P_1s', location: 'system', type: 'bit', address: 2.4, initial_value: 0, comment: '1 second pulse' },
  { name: 'P_2s', location: 'system', type: 'bit', address: 2.5, initial_value: 0, comment: '2 second pulse' },
  { name: 'P_5s', location: 'system', type: 'bit', address: 2.6, initial_value: 0, comment: '5 second pulse' },
  { name: 'P_10s', location: 'system', type: 'bit', address: 2.7, initial_value: 0, comment: '10 second pulse' },
  { name: 'P_30s', location: 'system', type: 'bit', address: 3.0, initial_value: 0, comment: '30 second pulse' },
  { name: 'P_1min', location: 'system', type: 'bit', address: 3.1, initial_value: 0, comment: '1 minute pulse' },
  { name: 'P_2min', location: 'system', type: 'bit', address: 3.2, initial_value: 0, comment: '2 minute pulse' },
  { name: 'P_5min', location: 'system', type: 'bit', address: 3.3, initial_value: 0, comment: '5 minute pulse' },
  { name: 'P_10min', location: 'system', type: 'bit', address: 3.4, initial_value: 0, comment: '10 minute pulse' },
  { name: 'P_15min', location: 'system', type: 'bit', address: 3.5, initial_value: 0, comment: '15 minute pulse' },
  { name: 'P_30min', location: 'system', type: 'bit', address: 3.6, initial_value: 0, comment: '30 minute pulse' },
  { name: 'P_1hr', location: 'system', type: 'bit', address: 3.7, initial_value: 0, comment: '1 hour pulse' },
  { name: 'P_2hr', location: 'system', type: 'bit', address: 4.0, initial_value: 0, comment: '2 hour pulse' },
  { name: 'P_3hr', location: 'system', type: 'bit', address: 4.1, initial_value: 0, comment: '3 hour pulse' },
  { name: 'P_4hr', location: 'system', type: 'bit', address: 4.2, initial_value: 0, comment: '4 hour pulse' },
  { name: 'P_5hr', location: 'system', type: 'bit', address: 4.3, initial_value: 0, comment: '5 hour pulse' },
  { name: 'P_6hr', location: 'system', type: 'bit', address: 4.4, initial_value: 0, comment: '6 hour pulse' },
  { name: 'P_12hr', location: 'system', type: 'bit', address: 4.5, initial_value: 0, comment: '12 hour pulse' },
  { name: 'P_1day', location: 'system', type: 'bit', address: 4.6, initial_value: 0, comment: '1 day pulse' },

  { name: 'S_100ms', location: 'system', type: 'bit', address: 5.0, initial_value: 0, comment: '100ms square wave' },
  { name: 'S_200ms', location: 'system', type: 'bit', address: 5.1, initial_value: 0, comment: '200ms square wave' },
  { name: 'S_300ms', location: 'system', type: 'bit', address: 5.2, initial_value: 0, comment: '300ms square wave' },
  { name: 'S_500ms', location: 'system', type: 'bit', address: 5.3, initial_value: 0, comment: '500ms square wave' },
  { name: 'S_1s', location: 'system', type: 'bit', address: 5.4, initial_value: 0, comment: '1 second square wave' },
  { name: 'S_2s', location: 'system', type: 'bit', address: 5.5, initial_value: 0, comment: '2 second square wave' },
  { name: 'S_5s', location: 'system', type: 'bit', address: 5.6, initial_value: 0, comment: '5 second square wave' },
  { name: 'S_10s', location: 'system', type: 'bit', address: 5.7, initial_value: 0, comment: '10 second square wave' },
  { name: 'S_30s', location: 'system', type: 'bit', address: 6.0, initial_value: 0, comment: '30 second square wave' },
  { name: 'S_1min', location: 'system', type: 'bit', address: 6.1, initial_value: 0, comment: '1 minute square wave' },
  { name: 'S_2min', location: 'system', type: 'bit', address: 6.2, initial_value: 0, comment: '2 minute square wave' },
  { name: 'S_5min', location: 'system', type: 'bit', address: 6.3, initial_value: 0, comment: '5 minute square wave' },
  { name: 'S_10min', location: 'system', type: 'bit', address: 6.4, initial_value: 0, comment: '10 minute square wave' },
  { name: 'S_15min', location: 'system', type: 'bit', address: 6.5, initial_value: 0, comment: '15 minute square wave' },
  { name: 'S_30min', location: 'system', type: 'bit', address: 6.6, initial_value: 0, comment: '30 minute square wave' },
  { name: 'S_1hr', location: 'system', type: 'bit', address: 6.7, initial_value: 0, comment: '1 hour square wave' },

  { name: 'elapsed_days', location: 'system', type: 'byte', address: 8.0, initial_value: 0, comment: 'Elapsed days' },
  { name: 'elapsed_hours', location: 'system', type: 'byte', address: 9.0, initial_value: 0, comment: 'Elapsed hours' },
  { name: 'elapsed_minutes', location: 'system', type: 'byte', address: 10.0, initial_value: 0, comment: 'Elapsed minutes' },
  { name: 'elapsed_seconds', location: 'system', type: 'byte', address: 11.0, initial_value: 0, comment: 'Elapsed seconds' },

  { name: 'system_uptime', location: 'system', type: 'dint', address: 12.0, initial_value: 0, comment: 'System uptime in seconds' },
]


/**
 * Parse address string like X0.0, Y0.0, M10.5, MW14, MD0 into a synthetic symbol object
 * @param {string} addressStr 
 * @returns {PLC_Symbol | null}
 */
const parseAddressToSymbol = (addressStr) => {
  if (!addressStr || typeof addressStr !== 'string') return null

  const trimmed = addressStr.trim()

  // Map letter to location
  const locationMap = {
    'K': 'system',
    'C': 'counter',
    'T': 'timer',
    'X': 'input',
    'Y': 'output',
    'S': 'system',
    'M': 'marker'
  }

  // Pattern 1: Typed address - Letter + Type + Number (e.g., MW14, MD0, MB5, MR8)
  // Type suffixes: B=byte, W=word(2), D=dword(4), R=real(4)
  const typedMatch = trimmed.match(/^([kKcCtTxXyYsSmM])([bBwWdDrR])([0-9]+)$/i)
  if (typedMatch) {
    const code = typedMatch[1].toUpperCase()
    const typeCode = typedMatch[2].toUpperCase()
    const val = parseFloat(typedMatch[3])

    const location = locationMap[code] || 'marker'

    // Map type code to type
    const typeCodeMap = {
      'B': 'u8',   // Byte
      'W': 'i16',  // Word (16-bit signed int, standard for PLC)
      'D': 'i32',  // Double word (32-bit signed int)
      'R': 'f32'   // Real (32-bit float)
    }
    const type = typeCodeMap[typeCode] || 'i16'

    return {
      name: addressStr,
      location,
      type,
      address: val,
      initial_value: 0,
      comment: `Direct address ${addressStr}`
    }
  }

  // Pattern 2: Simple address - Letter + Number (e.g., X0.0, Y0, M100.2)
  const simpleMatch = trimmed.match(/^([kKcCtTxXyYsSmM])([0-9]+(?:\.[0-9]+)?)$/i)
  if (simpleMatch) {
    const code = simpleMatch[1].toUpperCase()
    const valStr = simpleMatch[2]
    const val = parseFloat(valStr)

    const location = locationMap[code] || 'marker'
    const hasBit = valStr.includes('.')

    // Determine type based on location:
    // - Timers store u32 elapsed time values (4 bytes)
    // - Counters store u16 count values (2 bytes)
    // - Others use bit or byte based on address format
    let type = hasBit ? 'bit' : 'byte'
    if (location === 'timer') {
      type = 'u32' // Timers are 4-byte elapsed time values
    } else if (location === 'counter') {
      type = 'u16' // Counters are 2-byte count values
    }

    return {
      name: addressStr,
      location,
      type,
      address: val,
      initial_value: 0,
      comment: `Direct address ${addressStr}`
    }
  }

  return null
}

/**
 * Resolve block state with symbol lookup
 * @param {VovkPLCEditor} editor
 * @param {PLC_LadderBlock} block
 * @returns {PLC_LadderBlock}
 */
const getBlockState = (editor, block) => {
  if (!block.state) {
    // First try to find symbol by name in system symbols or project symbols
    let symbol = system_symbols.find(symbol => symbol.name === block.symbol)
      || editor.project?.symbols?.find(symbol => symbol.name === block.symbol)

    // If not found, try to parse as direct address (e.g., X0.0, Y0.0, M10.5)
    if (!symbol && block.symbol) {
      symbol = parseAddressToSymbol(block.symbol)
    }

    block.state = { active: false, powered: false, powered_input: false, evaluated: false, symbol, terminated_input: false, terminated_output: false }
  }
  return block
}


/** @type {(editor: VovkPLCEditor, like: 'symbol' | 'highlight', ctx: CanvasRenderingContext2D , block: PLC_LadderBlock) => void} */
const draw_contact = (editor, like, ctx, block) => {
  // input state: the left side of the contact (green when true)
  // output state: the right side of the contact (green when true)
  // value: the inner state of the contact (green when true)
  const { ladder_block_width, ladder_block_height, style } = editor.properties
  const { line_width, highlight_width, color, highlight_color, highlight_sim_color, font, font_color, font_error_color } = style
  block = getBlockState(editor, block)
  if (!block.state) return // Block state not found, skip
  const { x, y, type, inverted, trigger, state } = block
  const symbol = state?.symbol
  let value = symbol ? !!getSymbolValue(editor, symbol) : false
  if (inverted) value = !value

  const x0 = x * ladder_block_width
  const y0 = y * ladder_block_height
  const x1 = x0 + ladder_block_width
  const y1 = y0 + ladder_block_height

  const x_mid = x0 + ladder_block_width / 2
  const y_mid = y0 + ladder_block_height / 2

  const cl = x0 + ladder_block_width * 2 / 5
  const cr = x0 + ladder_block_width * 3 / 5
  const ct = y0 + ladder_block_height * 1 / 3
  const cb = y0 + ladder_block_height * 2 / 3

  // console.log(`Drawing contact: ${block.symbol} at ${x}, ${y}`)

  //        Symbol Name
  //   --------|   |--------
  //      Location Address


  // Draw thick highlight line for the contact to symbolize the input state
  if (like === 'highlight') {
    // Use cyan for simulation, lime green for device/serial mode
    const isSimulation = editor.window_manager.active_device === 'simulation'
    const activeColor = isSimulation ? '#00ffff' : '#32cd32'
    ctx.strokeStyle = activeColor
    ctx.lineWidth = highlight_width
    ctx.beginPath()

    // For contacts: powered means the contact is receiving input power AND is active (closed)
    // So if powered is true, we draw both input and output wires
    const isPowered = !!state?.powered

    // Input side (left)
    if (isPowered || state?.terminated_input) {
      if (state?.terminated_input) {
        ctx.moveTo(x0 + 1, y_mid - 12)
        ctx.lineTo(x0 + 1, y_mid + 12)
      }
      if (isPowered) {
        ctx.moveTo(x0, y_mid)
        ctx.lineTo(cl, y_mid)
      }
    }

    // Output side (right) - draw if contact is powered (active and has input power)
    // trigger is only momentary if explicitly set to something other than 'normal'
    const momentary = block.trigger && block.trigger !== 'normal'
    if (isPowered && !momentary) {
      ctx.moveTo(cr, y_mid)
      ctx.lineTo(x1, y_mid)
    }

    // Inner contact box - draw if contact value is true (active)
    if (value) {
      ctx.fillStyle = ctx.strokeStyle
      // Draw box inside the contact
      if (isPowered) {
        ctx.roundRect(cl, ct, cr - cl, cb - ct, 2)
        ctx.fillRect(cl - 1, ct - 1, cr - cl + 2, cb - ct + 2)
      } else {
        ctx.fillRect(cl - 1, ct, cr - cl + 2, cb - ct)
      }
    }
    ctx.stroke()
    return
  }

  if (like === 'symbol') {
    ctx.strokeStyle = color
    ctx.lineWidth = line_width

    // Draw horizontal line from the left side of the contact
    ctx.beginPath()
    if (state?.terminated_input) {
      ctx.moveTo(x0 + 1, y_mid - 8)
      ctx.lineTo(x0 + 1, y_mid + 8)
    }
    ctx.moveTo(x0, y_mid)
    ctx.lineTo(cl, y_mid)
    ctx.moveTo(cr, y_mid)
    ctx.lineTo(x1, y_mid)

    // Draw vertical line for the contact
    if (inverted) {
      ctx.moveTo(cl, ct)
      ctx.lineTo(cl, cb)
      ctx.moveTo(cl, cb - 1)
      ctx.lineTo(cr, ct + 1)
      ctx.moveTo(cr, ct)
      ctx.lineTo(cr, cb)
    } else {
      ctx.moveTo(cl, ct)
      ctx.lineTo(cl, cb)
      ctx.moveTo(cr, ct)
      ctx.lineTo(cr, cb)
    }
    if (trigger !== 'normal') {
      ctx.moveTo(x_mid, ct)
      ctx.lineTo(x_mid, cb)
      if (trigger === 'rising' || trigger === 'change') {
        ctx.moveTo(x_mid - 4, ct + 4)
        ctx.lineTo(x_mid, ct)
        ctx.lineTo(x_mid + 4, ct + 4)
      }
      if (trigger === 'falling' || trigger === 'change') {
        ctx.moveTo(x_mid - 4, cb - 4)
        ctx.lineTo(x_mid, cb)
        ctx.lineTo(x_mid + 4, cb - 4)
      }
    }
    ctx.stroke()

    const short_location = symbol ? memory_locations.find(loc => loc.name === symbol.location)?.short || '?' : '?'

    // Draw the symbol name
    if (symbol) ctx.fillStyle = font_color
    else ctx.fillStyle = font_error_color
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (editor.device_manager.connected && symbol && (symbol.type === 'bit' || symbol.type === 'bool')) {
      const val = !!getSymbolValue(editor, symbol)

      const symWidth = ctx.measureText(block.symbol).width
      const pillGap = 5
      const pillHeight = 14
      const pillFontSize = 10
      ctx.save()
      ctx.font = 'bold ' + pillFontSize + 'px Arial'
      const pillText = val ? 'ON' : 'OFF'
      const pillWidth = ctx.measureText(pillText).width + 8

      const totalW = symWidth + pillGap + pillWidth
      const startX = x_mid - (totalW / 2)

      // Draw Symbol
      ctx.textAlign = 'left'
      ctx.fillText(block.symbol, startX, ct - 13)

      // Draw Pill
      const px = startX + symWidth + pillGap
      const py = ct - 13 - (pillHeight / 2)

      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(px, py, pillWidth, pillHeight, 3)
      } else {
        ctx.rect(px, py, pillWidth, pillHeight)
      }
      ctx.fillStyle = '#3a3a3a'
      ctx.fill()
      ctx.strokeStyle = val ? '#1fba5f' : '#555'
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.fillStyle = val ? '#1fba5f' : 'rgba(200, 200, 200, 0.5)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(pillText, px + pillWidth / 2, py + pillHeight / 2 + 1)

      ctx.restore()
    } else {
      ctx.fillText(block.symbol, x_mid, ct - 13)
    }

    if (symbol) ctx.fillText(`${short_location}${symbol.address.toFixed(1)}`, x_mid, cb + 13)
    return
  }

  throw new Error(`Invalid style: ${style}`)
}


/** @type {(editor: VovkPLCEditor, like: 'symbol' | 'highlight', ctx: CanvasRenderingContext2D, block: PLC_LadderBlock) => void} */
const draw_coil = (editor, like, ctx, block) => {
  // input state: the left side of the contact (green when true)
  // output state: the right side of the contact is equal to the input state
  // value: the inner state of the contact (green when true)
  const { ladder_block_width, ladder_block_height, style } = editor.properties
  const { line_width, highlight_width, color, highlight_color, highlight_sim_color, font, font_color, font_error_color } = style
  block = getBlockState(editor, block)
  if (!block.state) return // Block state not found, skip
  const { x, y, type, inverted, trigger, state } = block
  const symbol = state?.symbol
  let value = symbol ? !!getSymbolValue(editor, symbol) : false
  if (inverted) value = !value

  const x0 = x * ladder_block_width
  const y0 = y * ladder_block_height
  const x1 = x0 + ladder_block_width
  const y1 = y0 + ladder_block_height

  const x_mid = x0 + ladder_block_width / 2
  const y_mid = y0 + ladder_block_height / 2

  const cl = x0 + ladder_block_width * 2 / 5
  const cr = x0 + ladder_block_width * 3 / 5
  const ct = y0 + ladder_block_height * 1 / 3
  const cb = y0 + ladder_block_height * 2 / 3

  // console.log(`Drawing coil: ${block.symbol} at ${x}, ${y}`)

  //        Symbol Name
  //   ---------O--------
  //      Location Address

  // The coil is a circle 

  // Draw thick highlight line for the coil to symbolize the output state
  if (like === 'highlight') {
    // Use cyan for simulation, lime green for device/serial mode
    const isSimulation = editor.window_manager.active_device === 'simulation'
    const activeColor = isSimulation ? '#00ffff' : '#32cd32'
    ctx.strokeStyle = activeColor
    ctx.lineWidth = highlight_width
    ctx.beginPath()
    if (state?.powered) {
      ctx.moveTo(x0, y_mid)
      ctx.lineTo(cl, y_mid)
      ctx.moveTo(cr, y_mid)
      ctx.lineTo(x1, y_mid)
    }
    if (value) {
      ctx.fillStyle = ctx.strokeStyle
      // Draw circle inside the coil
      ctx.arc(x_mid, y_mid, (cr - cl) / 2, 0, Math.PI * 2)
      ctx.fill()
    }
    if (state?.terminated_output) {
      ctx.moveTo(x1 - 2, y_mid - 12)
      ctx.lineTo(x1 - 2, y_mid + 12)
    }
    if (state?.powered) {
      ctx.stroke()
    }
    return
  }

  if (like === 'symbol') {
    ctx.strokeStyle = color
    ctx.lineWidth = line_width

    // Draw horizontal line from the left side of the contact
    ctx.beginPath()

    ctx.moveTo(x0, y_mid)
    ctx.lineTo(cl, y_mid)
    ctx.moveTo(cr, y_mid)
    ctx.lineTo(x1, y_mid)

    // Draw circle for the coil
    ctx.arc(x_mid, y_mid, (cr - cl) / 2, 0, Math.PI * 2)

    // Draw slash for inverted coil
    if (inverted) {
      const slashOffset = (cr - cl) / 2 * 0.7 // Slightly inside the circle
      ctx.moveTo(x_mid - slashOffset, y_mid + slashOffset)
      ctx.lineTo(x_mid + slashOffset, y_mid - slashOffset)
    }

    if (state?.terminated_output) {
      ctx.moveTo(x1 - 2, y_mid - 8)
      ctx.lineTo(x1 - 2, y_mid + 8)
    }

    ctx.stroke()


    const short_location = symbol ? memory_locations.find(loc => loc.name === symbol.location)?.short || '?' : '?'

    // Draw the symbol name
    if (symbol) ctx.fillStyle = font_color
    else ctx.fillStyle = font_error_color
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (editor.device_manager.connected && symbol && (symbol.type === 'bit' || symbol.type === 'bool')) {
      const val = !!getSymbolValue(editor, symbol)

      const symWidth = ctx.measureText(block.symbol).width
      const pillGap = 5
      const pillHeight = 14
      const pillFontSize = 10
      ctx.save()
      ctx.font = 'bold ' + pillFontSize + 'px Arial'
      const pillText = val ? 'ON' : 'OFF'
      const pillWidth = ctx.measureText(pillText).width + 8

      const totalW = symWidth + pillGap + pillWidth
      const startX = x_mid - (totalW / 2)

      // Draw Symbol
      ctx.textAlign = 'left'
      ctx.fillText(block.symbol, startX, ct - 13)

      // Draw Pill
      const px = startX + symWidth + pillGap
      const py = ct - 13 - (pillHeight / 2)

      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(px, py, pillWidth, pillHeight, 3)
      } else {
        ctx.rect(px, py, pillWidth, pillHeight)
      }
      ctx.fillStyle = '#3a3a3a'
      ctx.fill()
      ctx.strokeStyle = val ? '#1fba5f' : '#555'
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.fillStyle = val ? '#1fba5f' : 'rgba(200, 200, 200, 0.5)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(pillText, px + pillWidth / 2, py + pillHeight / 2 + 1)

      ctx.restore()
    } else {
      ctx.fillText(block.symbol, x_mid, ct - 13)
    }

    if (symbol) ctx.fillText(`${short_location}${symbol.address.toFixed(1)}`, x_mid, cb + 13)

    ctx.fillStyle = color
    ctx.font = '18px Arial Black'
    if (type === 'coil_set') ctx.fillText('S', x_mid, y_mid + 1)
    if (type === 'coil_rset') ctx.fillText('R', x_mid, y_mid + 1)
    return
  }

  throw new Error(`Invalid style: ${style}`)
}


/** @type {(editor: VovkPLCEditor, like: 'symbol' | 'highlight', ctx: CanvasRenderingContext2D, block: PLC_LadderBlock) => void} */
const draw_function_block = (editor, like, ctx, block) => {
  const { ladder_block_width, ladder_block_height, style } = editor.properties
  const { line_width, highlight_width, color, highlight_color, highlight_sim_color, font, font_color, font_error_color } = style
  block = getBlockState(editor, block)
  if (!block.state) return // Block state not found, skip
  const { x, y, type, state, dataType, in1, in2, out } = block

  const x0 = x * ladder_block_width
  const y0 = y * ladder_block_height
  const x1 = x0 + ladder_block_width
  const y1 = y0 + ladder_block_height

  const x_mid = x0 + ladder_block_width / 2
  const y_mid = y0 + ladder_block_height / 2

  // Box dimensions (similar to timer/counter)
  const boxLeft = x0 + 8
  const boxRight = x1 - 8
  const boxTop = y0 + 12
  const boxBottom = y1 - 8
  const boxWidth = boxRight - boxLeft
  const boxHeight = boxBottom - boxTop

  // Get operation block label
  const fbLabel = getFunctionBlockLabel(type)
  const isUnary = isUnaryMathBlock(type)
  const isMove = isMoveBlock(type)
  const isCompare = isCompareBlock(type)
  const isIncDec = isIncDecBlock(type)

  // Input/output states
  const inputPowered = !!state?.powered_input
  const blockPowered = !!state?.powered

  if (like === 'highlight') {
    // Draw solid background first to cover any transparent areas
    ctx.fillStyle = '#2a2a2a'
    ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight)

    // Use cyan for simulation, lime green for device/serial mode
    const isSimulation = editor.window_manager.active_device === 'simulation'
    const activeColor = isSimulation ? '#00ffff' : '#32cd32' // cyan : lime green

    // Draw input wire highlight when input is powered
    if (inputPowered) {
      ctx.strokeStyle = activeColor
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.moveTo(x0, y_mid)
      ctx.lineTo(boxLeft, y_mid)
      ctx.stroke()
    }

    // Draw left border of block (input indicator) when block is powered
    if (blockPowered) {
      ctx.strokeStyle = activeColor
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(boxLeft - 2, boxTop - 2)
      ctx.lineTo(boxLeft - 2, boxBottom + 2)
      ctx.stroke()
    }

    // For operation blocks, output is active when block is powered (pass-through)
    // Compare blocks may have different output logic based on comparison result
    const outputOn = isCompare ? !!state?.active : blockPowered

    // Draw output wire highlight when output is on
    if (outputOn) {
      ctx.strokeStyle = activeColor
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.moveTo(boxRight, y_mid)
      ctx.lineTo(x1, y_mid)
      ctx.stroke()
    }

    // Draw terminated output indicator (only when output is on)
    if (state?.terminated_output && outputOn) {
      ctx.strokeStyle = activeColor
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.moveTo(x1 - 2, y_mid - 12)
      ctx.lineTo(x1 - 2, y_mid + 12)
      ctx.stroke()
    }

    // Draw box border highlight when output is on
    if (outputOn) {
      ctx.strokeStyle = activeColor
      ctx.lineWidth = 6
      ctx.beginPath()
      // Right edge
      ctx.moveTo(boxRight + 2, boxTop - 2)
      ctx.lineTo(boxRight + 2, boxBottom + 2)
      // Top edge
      ctx.moveTo(boxLeft - 4, boxTop - 4)
      ctx.lineTo(boxRight + 4, boxTop - 4)
      // Bottom edge
      ctx.moveTo(boxLeft - 4, boxBottom + 4)
      ctx.lineTo(boxRight + 4, boxBottom + 4)
      ctx.stroke()
    }
    return
  }

  if (like === 'symbol') {
    // Draw solid background first
    ctx.fillStyle = '#2a2a2a'
    ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight)

    // Draw input line
    ctx.strokeStyle = color
    ctx.lineWidth = line_width
    ctx.beginPath()
    ctx.moveTo(x0, y_mid)
    ctx.lineTo(boxLeft, y_mid)
    ctx.stroke()

    // Draw output line
    ctx.beginPath()
    ctx.moveTo(boxRight, y_mid)
    ctx.lineTo(x1, y_mid)
    ctx.stroke()

    // Draw box outline
    ctx.strokeRect(boxLeft, boxTop, boxWidth, boxHeight)

    // Draw operation label at top left
    ctx.fillStyle = font_color
    ctx.font = 'bold 10px Arial'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(fbLabel, boxLeft + 3, boxTop + 2)

    // Draw data type at top right
    const dtLabel = (dataType || 'I16').toUpperCase()
    ctx.font = '9px Arial'
    ctx.textAlign = 'right'
    ctx.fillText(dtLabel, boxRight - 3, boxTop + 3)

    // Draw separator line (moved higher)
    ctx.beginPath()
    ctx.moveTo(boxLeft + 4, boxTop + 16)
    ctx.lineTo(boxRight - 4, boxTop + 16)
    ctx.stroke()

    // Draw parameters section (moved higher)
    ctx.font = '9px Arial'
    ctx.textAlign = 'left'
    const paramY = boxTop + 22

    // Determine output address for live value display
    let outputAddress = ''
    
    // For compare operations: show condition symbol
    if (isCompare) {
      const condSymbols = {
        'fb_cmp_eq': '==',
        'fb_cmp_neq': '<>',
        'fb_cmp_gt': '>',
        'fb_cmp_lt': '<',
        'fb_cmp_gte': '>=',
        'fb_cmp_lte': '<=',
      }
      ctx.textAlign = 'center'
      ctx.font = 'bold 12px Arial'
      ctx.fillText(condSymbols[type] || '?', x_mid, paramY + 2)
      
      // Show operands
      ctx.font = '8px Arial'
      ctx.fillText(in1 || '?', x_mid, paramY + 12)
      ctx.fillText(in2 || '?', x_mid, paramY + 22)
      // Compare blocks don't have an output address, they set RLO
    } else if (isMove) {
      // MOVE: IN -> OUT
      ctx.textAlign = 'center'
      ctx.fillText('IN:', boxLeft + boxWidth * 0.3, paramY)
      ctx.fillText(in1 || '?', boxLeft + boxWidth * 0.3, paramY + 10)
      ctx.fillText('OUT:', boxLeft + boxWidth * 0.7, paramY)
      ctx.fillText(out || block.symbol || '?', boxLeft + boxWidth * 0.7, paramY + 10)
      outputAddress = out || block.symbol || ''
    } else if (isIncDec) {
      // INC/DEC: single address (read and write to same location)
      ctx.textAlign = 'center'
      ctx.fillText('ADDR:', x_mid, paramY)
      ctx.fillText(block.symbol || '?', x_mid, paramY + 10)
      outputAddress = block.symbol || ''
    } else if (isUnary) {
      // Unary (NEG, ABS): IN -> OUT
      ctx.textAlign = 'center'
      ctx.fillText('IN:', boxLeft + boxWidth * 0.3, paramY)
      ctx.fillText(in1 || '?', boxLeft + boxWidth * 0.3, paramY + 10)
      ctx.fillText('OUT:', boxLeft + boxWidth * 0.7, paramY)
      ctx.fillText(out || block.symbol || '?', boxLeft + boxWidth * 0.7, paramY + 10)
      outputAddress = out || block.symbol || ''
    } else {
      // Binary math: IN1 op IN2 -> OUT
      ctx.textAlign = 'center'
      const col1 = boxLeft + boxWidth * 0.25
      const col2 = boxLeft + boxWidth * 0.5
      const col3 = boxLeft + boxWidth * 0.75
      ctx.fillText('IN1', col1, paramY)
      ctx.fillText(in1 || '?', col1, paramY + 10)
      ctx.fillText('IN2', col2, paramY)
      ctx.fillText(in2 || '?', col2, paramY + 10)
      ctx.fillText('OUT', col3, paramY)
      ctx.fillText(out || block.symbol || '?', col3, paramY + 10)
      outputAddress = out || block.symbol || ''
    }

    // Draw live value preview at the bottom when connected
    if (editor.device_manager.connected && outputAddress) {
      const isSimulation = editor.window_manager.active_device === 'simulation'
      const activeColor = isSimulation ? '#00ffff' : '#32cd32'
      
      // Try to get the live value for the output address
      const liveValues = editor.live_symbol_values
      let liveValue = null
      
      // First try live_symbol_values (populated by code monitor)
      if (liveValues) {
        // Try to find by address name (Map key) - try both exact and case-insensitive
        let liveEntry = liveValues.get(outputAddress)
        if (!liveEntry) {
          liveEntry = liveValues.get(outputAddress.toUpperCase())
        }
        if (!liveEntry) {
          liveEntry = liveValues.get(outputAddress.toLowerCase())
        }
        if (liveEntry && liveEntry.value !== undefined) {
          liveValue = liveEntry.value
        }
      }

      // Fallback: read directly from editor.memory using the parsed address
      if (liveValue === null && editor.memory && editor.memory.length > 0) {
        const parsedSymbol = parseAddressToSymbol(outputAddress)
        if (parsedSymbol) {
          const offsets = ensureOffsets(editor.project?.offsets || {})
          const locationKey = parsedSymbol.location === 'memory' ? 'marker' : parsedSymbol.location
          const baseOffset = offsets[locationKey]?.offset || 0
          const byteAddr = Math.floor(parsedSymbol.address)
          const absoluteAddr = baseOffset + byteAddr

          // Determine actual type from block's dataType
          const effectiveType = dataType || parsedSymbol.type || 'i16'
          
          // Get device endianness (default to little-endian if unknown)
          const isLittleEndian = editor.device_manager?.deviceInfo?.isLittleEndian ?? true
          
          if (absoluteAddr >= 0 && absoluteAddr < editor.memory.length) {
            const view = new DataView(editor.memory.buffer, editor.memory.byteOffset, editor.memory.byteLength)
            liveValue = readTypedValue(view, absoluteAddr, effectiveType, isLittleEndian)
          }
        }
      }

      // Draw the value pill at the bottom
      const pillY = boxBottom - 10
      ctx.font = 'bold 11px Arial'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      
      if (liveValue !== null) {
        // Format the value based on data type
        let displayValue = ''
        if (dataType === 'f32' || dataType === 'f64') {
          displayValue = typeof liveValue === 'number' ? liveValue.toFixed(2) : String(liveValue)
        } else {
          displayValue = String(liveValue)
        }
        
        // Draw pill background - auto-size to fit content
        const textWidth = ctx.measureText(displayValue).width
        const pillPadding = 8
        const pillWidth = textWidth + pillPadding * 2
        const pillHeight = 14
        const pillX = x_mid - pillWidth / 2
        
        ctx.fillStyle = blockPowered ? activeColor : '#444'
        ctx.beginPath()
        ctx.roundRect(pillX, pillY - pillHeight / 2, pillWidth, pillHeight, 3)
        ctx.fill()
        
        // Draw value text
        ctx.fillStyle = blockPowered ? '#000' : '#ddd'
        ctx.fillText(displayValue, x_mid, pillY)
      } else {
        // No live value available - show placeholder
        ctx.fillStyle = '#666'
        ctx.fillText('---', x_mid, pillY)
      }
    }

    // Draw terminated output indicator (vertical line at end)
    if (state?.terminated_output) {
      ctx.strokeStyle = color
      ctx.lineWidth = line_width
      ctx.beginPath()
      ctx.moveTo(x1 - 2, y_mid - 8)
      ctx.lineTo(x1 - 2, y_mid + 8)
      ctx.stroke()
    }

    return
  }

  throw new Error(`Invalid style: ${style}`)
}


/** @type {(editor: VovkPLCEditor, like: 'symbol' | 'highlight', ctx: CanvasRenderingContext2D, block: PLC_LadderBlock) => void} */
const draw_timer = (editor, like, ctx, block) => {
  const { ladder_block_width, ladder_block_height, style } = editor.properties
  const { line_width, highlight_width, color, highlight_color, highlight_sim_color, font, font_color, font_error_color } = style
  block = getBlockState(editor, block)
  if (!block.state) return // Block state not found, skip
  const { x, y, type, state } = block
  const symbol = state?.symbol

  // Handle backward compatibility: preset can be number or T# string
  let presetStr = block.preset || 'T#1s'
  let presetMs = 1000
  if (typeof presetStr === 'number') {
    presetMs = presetStr
    presetStr = formatTimeDuration(presetMs)
  } else {
    const presetParsed = parseTimeDuration(presetStr)
    presetMs = presetParsed.valid ? presetParsed.ms : 1000
  }

  const x0 = x * ladder_block_width
  const y0 = y * ladder_block_height
  const x1 = x0 + ladder_block_width
  const y1 = y0 + ladder_block_height

  const x_mid = x0 + ladder_block_width / 2
  const y_mid = y0 + ladder_block_height / 2

  // Timer box dimensions
  const boxLeft = x0 + 8
  const boxRight = x1 - 8
  const boxTop = y0 + 12
  const boxBottom = y1 - 12
  const boxWidth = boxRight - boxLeft
  const boxHeight = boxBottom - boxTop

  // Get timer label
  const timerLabels = {
    'timer_ton': 'TON',
    'timer_tof': 'TOF',
    'timer_tp': 'TP'
  }
  const timerLabel = timerLabels[type] || 'TMR'

  // Get current elapsed time and calculate done state
  // For timers, we need to read the u32/dint elapsed time from live_symbol_values,
  // not just the byte value from getSymbolValue (which only reads 1 byte)
  let elapsed = 0
  let done = false
  let remaining = presetMs
  let liveInputOn = false  // Live IN state from timer flags (IN_OLD bit)
  let running = false      // RUNNING flag from timer
  let flagsAddress = 0
  if (symbol) {
    // Calculate the absolute address for the timer
    // Timer memory layout: 9 bytes per timer (same as WindowManager normalizeAddress)
    // [0..3] ET (u32), [4..7] StartTime (u32), [8] Flags
    // Flags: Bit 0 = Q, Bit 1 = RUNNING, Bit 2 = IN_OLD
    const offsets = ensureOffsets(editor.project?.offsets || {})
    const timerOffset = offsets.timer?.offset || 704
    const absoluteAddress = timerOffset + Math.floor(symbol.address) * 9 // Timers are 9 bytes per unit
    flagsAddress = absoluteAddress + 8 // Flags byte is at offset 8

    // Look up live value by absoluteAddress and type u32/dint (same as STL/ASM renderers)
    const liveValues = editor.live_symbol_values
    if (liveValues) {
      // First try by symbol name
      let liveEntry = liveValues.get(symbol.name)

      // For timer instances, we need the u32 elapsed time value
      // The timer storage is stored with type 'u32' or 'dint'
      if (!liveEntry || liveEntry.type === 'byte') {
        // Search by absolute address and type
        const timerLiveEntry = [...liveValues.values()].find(
          l => l.absoluteAddress === absoluteAddress && (l.type === 'u32' || l.type === 'dint')
        )
        if (timerLiveEntry) {
          liveEntry = timerLiveEntry
        }
      }

      if (liveEntry && typeof liveEntry.value === 'number') {
        elapsed = liveEntry.value
        done = elapsed >= presetMs
        // Calculate remaining time (countdown) - same as STL/ASM renderers
        remaining = Math.max(0, presetMs - elapsed)
      }

      // Read the timer flags byte to get live IN state
      // Try to find the flags entry by absolute address
      const flagsEntry = [...liveValues.values()].find(
        l => l.absoluteAddress === flagsAddress && l.type === 'byte'
      )
      if (flagsEntry && typeof flagsEntry.value === 'number') {
        const flags = flagsEntry.value
        liveInputOn = !!(flags & 0x04)  // Bit 2 = IN_OLD
        running = !!(flags & 0x02)       // Bit 1 = RUNNING
      }
    }

    // Always try to read from editor.memory as fallback for flags
    if (!liveInputOn && editor.memory && editor.memory.length > flagsAddress) {
      const flags = editor.memory[flagsAddress]
      liveInputOn = !!(flags & 0x04)  // Bit 2 = IN_OLD
      running = !!(flags & 0x02)       // Bit 1 = RUNNING
    }
  }

  // Timer output (Q) state varies by type:
  // TON: Q = done (ON when elapsed >= preset)
  // TOF: Q = !done (ON while timer is holding after input off, OFF when elapsed >= preset)
  // TP: Q = running AND !done (ON only while pulse is active, OFF when idle or elapsed >= preset)
  const isTOF = type === 'timer_tof'
  const isTP = type === 'timer_tp'
  // For TP: output is ON only when actually running (elapsed > 0) AND not done yet
  // When TP is idle (elapsed=0), output should be OFF
  const tpOutputOn = isTP ? (elapsed > 0 && !done) : false
  const tofOutputOn = isTOF ? !done : false
  const tonOutputOn = (!isTOF && !isTP) ? done : false
  const outputOn = tpOutputOn || tofOutputOn || tonOutputOn

  // Use live input state from timer memory (IN_OLD flag) if available, 
  // otherwise fall back to evaluator state (powered = inputPowered for timers)
  // Use live input state from timer memory (IN_OLD flag) if available, 
  // otherwise fall back to evaluator state (powered = inputPowered for timers)
  const inputPowered = liveInputOn || !!state?.powered_input
  const blockPowered = !!state?.powered

  // Debug: log what we have
  // console.log(`Timer ${symbol?.name}: liveInputOn=${liveInputOn}, powered=${state?.powered}, powered_input=${state?.powered_input}, inputPowered=${inputPowered}`)

  if (like === 'highlight') {
    // Draw solid background first
    ctx.fillStyle = '#2a2a2a'
    ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight)

    // Use cyan for simulation, lime green for device/serial mode
    const isSimulation = editor.window_manager.active_device === 'simulation'
    const activeColor = isSimulation ? '#00ffff' : '#32cd32' // cyan : lime green

    if (inputPowered) {
      // Draw input connection wire highlight (from left edge of cell to box)
      ctx.strokeStyle = activeColor
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.moveTo(x0, y_mid)
      ctx.lineTo(boxLeft, y_mid)
      ctx.stroke()

    }

    // Draw left border of timer box (input indicator)
    if (blockPowered) {
      ctx.beginPath()
      ctx.lineWidth = 6
      ctx.moveTo(boxLeft - 2, boxTop - 2)
      ctx.lineTo(boxLeft - 2, boxBottom + 2)
      ctx.stroke()
    }

    // Draw output section separately
    if (outputOn) {
      ctx.strokeStyle = activeColor
      ctx.lineWidth = 8
      ctx.beginPath()
      // Draw output wire highlight
      ctx.moveTo(boxRight, y_mid)
      ctx.lineTo(x1, y_mid)
      ctx.stroke()
    }
    if (state?.terminated_output && outputOn) {
      ctx.beginPath()
      ctx.lineWidth = 8
      ctx.moveTo(x1 - 2, y_mid - 12)
      ctx.lineTo(x1 - 2, y_mid + 12)
      ctx.stroke()
    }

    // Check if timer is running (for progress bar)
    const isRunning = elapsed > 0 && !done

    // Draw top, right, bottom edges of border based on OUTPUT state
    // For TOF when running: don't draw top/bottom (they'll be replaced by progress bar)
    if (outputOn) {
      ctx.strokeStyle = activeColor
      ctx.lineWidth = 6
      ctx.beginPath()

      ctx.moveTo(boxRight + 2, boxTop - 2)
      ctx.lineTo(boxRight + 2, boxBottom + 2)

      const outset = 4
      if (isTOF && isRunning) {
        // TOF running: only draw right edge, top/bottom will be progress bars
        ctx.moveTo(boxRight + outset, boxTop - outset)
        ctx.lineTo(boxRight + outset, boxBottom + outset)
      } else if (!isTP) {
        // Normal: draw top, right, bottom edges
        // Top edge
        ctx.moveTo(boxLeft - outset, boxTop - outset)
        ctx.lineTo(boxRight + outset, boxTop - outset)
        // Bottom edge
        ctx.moveTo(boxLeft - outset, boxBottom + outset)
        ctx.lineTo(boxRight + outset, boxBottom + outset)
      }
      ctx.stroke()
    }

    // Draw progress bar on top and bottom edges of the timer block
    // Show bars when timer is actively counting (elapsed > 0 and not finished)
    if (isRunning) {
      const progress = Math.min(elapsed / presetMs, 1)
      const barHeight = 4
      const barInset = -5 // Inset from box edges

      ctx.fillStyle = activeColor

      const progressWidth = (boxWidth - barInset * 2)
      if (isTOF) {
        // TOF: bar shrinks from right to left (shows remaining time)
        const remainingProgress = progress
        const remainingOffset = progressWidth * (remainingProgress)
        const progressWidthNormal = progressWidth - remainingOffset
        // Top edge bar (from left, shrinking width)
        ctx.fillRect(boxLeft + barInset + remainingOffset, boxTop - barHeight - 2, progressWidthNormal, barHeight)
        // Bottom edge bar (from left, shrinking width)
        ctx.fillRect(boxLeft + barInset + remainingOffset, boxBottom + 2, progressWidthNormal, barHeight)
      } else {
        // TON/TP: bar grows from left to right
        const progressWidthNormal = progressWidth * progress
        // Top edge bar
        ctx.fillRect(boxLeft + barInset, boxTop - barHeight - 2, progressWidthNormal, barHeight)
        // Bottom edge bar
        ctx.fillRect(boxLeft + barInset, boxBottom + 2, progressWidthNormal, barHeight)
      }
    }
    return
  }

  if (like === 'symbol') {
    // Draw solid background first
    ctx.fillStyle = '#2a2a2a'
    ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight)

    // Determine active color based on mode: cyan for simulation, lime green for device
    const isSimulation = editor.window_manager.active_device === 'simulation'
    const activeColor = isSimulation ? '#00ffff' : '#32cd32' // cyan : lime green
    const activeOnColor = isSimulation ? '#00ffff' : '#32cd32'
    const activeOffColor = '#c04040'
    const runningColor = isSimulation ? '#00cccc' : '#f0a020' // slightly dimmer cyan or orange

    ctx.strokeStyle = color
    ctx.lineWidth = line_width

    // Draw input/output horizontal lines
    ctx.beginPath()
    ctx.moveTo(x0, y_mid)
    ctx.lineTo(boxLeft, y_mid)
    ctx.moveTo(boxRight, y_mid)
    ctx.lineTo(x1, y_mid)

    // Draw timer box
    ctx.rect(boxLeft, boxTop, boxWidth, boxHeight)

    if (state?.terminated_output) {
      ctx.moveTo(x1 - 2, y_mid - 8)
      ctx.lineTo(x1 - 2, y_mid + 8)
    }
    ctx.stroke()

    // Draw timer type label at top
    ctx.fillStyle = font_color
    ctx.font = 'bold 11px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(timerLabel, x_mid, boxTop + 2)

    // Draw symbol name below timer type
    if (symbol) ctx.fillStyle = font_color
    else ctx.fillStyle = font_error_color
    ctx.font = '10px Arial'
    ctx.textBaseline = 'middle'
    ctx.fillText(block.symbol || '???', x_mid, boxTop + 18)

    // Draw preset time (PT) - show the T# string directly
    ctx.fillStyle = font_color
    ctx.font = '9px Arial'
    ctx.textAlign = 'left'
    ctx.fillText('PT:', boxLeft + 3, boxBottom - 16)
    ctx.textAlign = 'right'
    ctx.fillText(presetStr, boxRight - 3, boxBottom - 16)

    // Draw remaining time (countdown) or elapsed time display
    ctx.textAlign = 'left'
    ctx.fillText('ET:', boxLeft + 3, boxBottom - 5)
    ctx.textAlign = 'right'
    if (editor.device_manager.connected) {
      // For TOF/TP: show preset time when done (output OFF), remaining when running
      // For TON: show remaining time (countdown)
      const displayTime = (isTOF || isTP) && done ? presetMs : remaining
      // For TOF/TP: use normal color when idle (done), running color when active
      // For TON: use green when done, running color when active
      const etColor = (isTOF || isTP)
        ? (done ? font_color : runningColor)  // TOF/TP: normal when idle, running when active
        : (done ? activeOnColor : (elapsed > 0 ? runningColor : font_color))  // TON: green when done
      ctx.fillStyle = etColor
      ctx.fillText(formatTime(displayTime), boxRight - 3, boxBottom - 5)
    } else {
      ctx.fillStyle = '#666'
      ctx.fillText('---', boxRight - 3, boxBottom - 5)
    }

    // Draw Q (output) indicator with ON/OFF state (TOF/TP is inverted)
    ctx.textAlign = 'right'
    ctx.font = 'bold 10px Arial'
    if (editor.device_manager.connected) {
      ctx.fillStyle = outputOn ? activeOnColor : activeOffColor
      ctx.fillText(outputOn ? 'ON' : 'OFF', boxRight - 3, y_mid)
    } else {
      ctx.fillStyle = '#666'
      ctx.fillText('Q', boxRight - 3, y_mid)
    }

    return
  }

  throw new Error(`Invalid style: ${style}`)
}

/**
 * Format time in milliseconds to a readable string (matches STL/ASM pill format)
 * @param {number} ms - Time in milliseconds
 * @returns {string}
 */
function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const mil = ms % 1000

  const milStr = mil.toString().padStart(3, '0')
  const sStr = s.toString().padStart(2, '0')
  const mStr = m.toString().padStart(2, '0')
  const hStr = h.toString().padStart(2, '0')

  if (d > 0) return `${d}d ${hStr}:${mStr}:${sStr}`
  if (h > 0) return `${h}:${mStr}:${sStr}`
  if (m > 0) return `${m}:${sStr}`
  if (s > 0) return `${s}.${milStr}s`
  return `${mil}ms`
}


const draw_counter = (editor, like, ctx, block) => {
  const { ladder_block_width, ladder_block_height, style } = editor.properties
  const { line_width, highlight_width, color, highlight_color, highlight_sim_color, font, font_color, font_error_color } = style
  block = getBlockState(editor, block)
  if (!block.state) return // Block state not found, skip
  const { x, y, type, state } = block
  const symbol = state?.symbol

  const presetValue = typeof block.preset === 'number' ? block.preset : 10

  const x0 = x * ladder_block_width
  const y0 = y * ladder_block_height
  const x1 = x0 + ladder_block_width
  const y1 = y0 + ladder_block_height

  const x_mid = x0 + ladder_block_width / 2
  const y_mid = y0 + ladder_block_height / 2

  // Counter box dimensions
  const boxLeft = x0 + 8
  const boxRight = x1 - 8
  const boxTop = y0 + 12
  const boxBottom = y1 - 12
  const boxWidth = boxRight - boxLeft
  const boxHeight = boxBottom - boxTop

  // Get counter label (support old and new type names)
  const counterLabels = {
    'counter_u': 'CTU',
    'counter_d': 'CTD',
    'counter_ctu': 'CTU',
    'counter_ctd': 'CTD',
    'counter_ctud': 'CTUD'
  }
  const counterLabel = counterLabels[type] || 'CTR'

  // Get current count value and calculate done state
  let currentCount = 0
  let done = false
  if (symbol) {
    // Calculate the absolute address for the counter
    const offsets = ensureOffsets(editor.project?.offsets || {})
    const counterOffset = offsets.counter?.offset || 768
    const absoluteAddress = counterOffset + Math.floor(symbol.address) * 5 // Counters are 5 bytes per unit (4 bytes count + 1 byte flags)

    // Look up live value
    const liveValues = editor.live_symbol_values
    if (liveValues) {
      let liveEntry = liveValues.get(symbol.name)

      // For counter instances, we need the i32 count value
      if (!liveEntry || liveEntry.type === 'byte') {
        const counterLiveEntry = [...liveValues.values()].find(
          l => l.absoluteAddress === absoluteAddress && (l.type === 'i32' || l.type === 'dint')
        )
        if (counterLiveEntry) {
          liveEntry = counterLiveEntry
        }
      }

      if (liveEntry && typeof liveEntry.value === 'number') {
        currentCount = liveEntry.value
        // CTU: done when count >= preset
        // CTD: done when count <= 0
        // CTUD: done when count >= preset
        if (type === 'counter_d' || type === 'counter_ctd') {
          done = currentCount <= 0
        } else {
          done = currentCount >= presetValue
        }
      }
    }
  }

  if (like === 'highlight') {
    // Draw solid background first
    ctx.fillStyle = '#2a2a2a'
    ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight)

    // Use cyan for simulation, lime green for device/serial mode
    const isSimulation = editor.window_manager.active_device === 'simulation'
    const activeColor = isSimulation ? '#00ffff' : '#32cd32'
    ctx.strokeStyle = activeColor
    ctx.lineWidth = highlight_width
    ctx.beginPath()
    if (state?.powered) {
      // Draw input line highlight
      ctx.moveTo(x0, y_mid)
      ctx.lineTo(boxLeft, y_mid)
      // Draw output line highlight when done (Q = ON)
      if (done) {
        ctx.moveTo(boxRight, y_mid)
        ctx.lineTo(x1, y_mid)
      }
    }
    if (state?.terminated_output && done) {
      ctx.moveTo(x1 - 2, y_mid - 12)
      ctx.lineTo(x1 - 2, y_mid + 12)
    }
    ctx.stroke()

    // Draw active border outline when counter is done
    if (done) {
      ctx.strokeStyle = activeColor
      ctx.lineWidth = 4
      ctx.strokeRect(boxLeft - 2, boxTop - 2, boxWidth + 4, boxHeight + 4)
    }

    // Draw progress bar highlight (only for CTU/CTUD, not CTD)
    if (state?.powered && currentCount > 0 && !done && type !== 'counter_d' && type !== 'counter_ctd') {
      const progress = Math.min(currentCount / presetValue, 1)
      const progressWidth = (boxWidth - 4) * progress
      ctx.fillStyle = activeColor
      ctx.globalAlpha = 0.3
      ctx.fillRect(boxLeft + 2, boxBottom - 8, progressWidth, 4)
      ctx.globalAlpha = 1.0
    }
    return
  }

  if (like === 'symbol') {
    // Draw solid background first
    ctx.fillStyle = '#2a2a2a'
    ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight)

    const isSimulation = editor.window_manager.active_device === 'simulation'
    const activeOnColor = isSimulation ? '#00ffff' : '#32cd32'
    const activeOffColor = '#c04040'
    const countingColor = isSimulation ? '#00cccc' : '#f0a020'

    ctx.strokeStyle = color
    ctx.lineWidth = line_width

    // Draw input/output horizontal lines
    ctx.beginPath()
    ctx.moveTo(x0, y_mid)
    ctx.lineTo(boxLeft, y_mid)
    ctx.moveTo(boxRight, y_mid)
    ctx.lineTo(x1, y_mid)

    // Draw counter box
    ctx.rect(boxLeft, boxTop, boxWidth, boxHeight)

    if (state?.terminated_output) {
      ctx.moveTo(x1 - 2, y_mid - 8)
      ctx.lineTo(x1 - 2, y_mid + 8)
    }
    ctx.stroke()

    // Draw counter type label at top
    ctx.fillStyle = font_color
    ctx.font = 'bold 11px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(counterLabel, x_mid, boxTop + 2)

    // Draw symbol name below counter type
    if (symbol) ctx.fillStyle = font_color
    else ctx.fillStyle = font_error_color
    ctx.font = '10px Arial'
    ctx.textBaseline = 'middle'
    ctx.fillText(block.symbol || '???', x_mid, boxTop + 18)

    // Draw preset value (PV)
    ctx.fillStyle = font_color
    ctx.font = '9px Arial'
    ctx.textAlign = 'left'
    ctx.fillText('PV:', boxLeft + 3, boxBottom - 16)
    ctx.textAlign = 'right'
    ctx.fillText(String(presetValue), boxRight - 3, boxBottom - 16)

    // Draw current count (CV)
    ctx.textAlign = 'left'
    ctx.fillText('CV:', boxLeft + 3, boxBottom - 5)
    ctx.textAlign = 'right'
    if (editor.device_manager.connected) {
      ctx.fillStyle = done ? activeOnColor : (currentCount > 0 ? countingColor : font_color)
      ctx.fillText(String(currentCount), boxRight - 3, boxBottom - 5)
    } else {
      ctx.fillStyle = '#666'
      ctx.fillText('---', boxRight - 3, boxBottom - 5)
    }

    // Draw Q (output) indicator with ON/OFF state
    ctx.textAlign = 'right'
    ctx.font = 'bold 10px Arial'
    if (editor.device_manager.connected) {
      ctx.fillStyle = done ? activeOnColor : activeOffColor
      ctx.fillText(done ? 'ON' : 'OFF', boxRight - 3, y_mid)
    } else {
      ctx.fillStyle = '#666'
      ctx.fillText('Q', boxRight - 3, y_mid)
    }

    return
  }

  throw new Error(`Invalid style: ${style}`)
}


// Draw links between blocks

/** @typedef {{ from: PLC_LadderBlock , to: PLC_LadderBlock, powered: boolean }} LadderLink */

/**
 * Draw a connection using cached routed path
 * @param {VovkPLCEditor} editor 
 * @param {'symbol' | 'highlight'} like 
 * @param {CanvasRenderingContext2D} ctx 
 * @param {LadderLink} link 
 * @param {ConnectionPath} [routedPath] - Optional pre-computed path
 */
const draw_connection = (editor, like, ctx, link, routedPath) => {
  const { ladder_block_width, ladder_block_height, style } = editor.properties
  const { line_width, highlight_width, color } = style
  const { from, to, powered } = link
  
  // Calculate pixel coordinates
  const x0 = from.x * ladder_block_width + ladder_block_width  // Right side of source
  const y0 = from.y * ladder_block_height + ladder_block_height / 2
  const x1 = to.x * ladder_block_width  // Left side of dest
  const y1 = to.y * ladder_block_height + ladder_block_height / 2

  // Skip if blocks are touching (no wire needed)
  if (x0 >= x1 && from.y === to.y) return
  
  const isCrossRow = from.y !== to.y
  
  // Get corner X position from routed path, or default to dest X
  const cornerXGrid = routedPath?.cornerX ?? to.x
  const cornerX = cornerXGrid * ladder_block_width
  
  if (like === 'highlight') {
    if (powered) {
      const isSimulation = editor.window_manager.active_device === 'simulation'
      const activeColor = isSimulation ? '#00ffff' : '#32cd32'
      ctx.strokeStyle = activeColor
      ctx.lineWidth = highlight_width
      ctx.beginPath()
      
      if (isCrossRow) {
        // Path: horizontal to corner, vertical to dest row, then horizontal to dest
        ctx.moveTo(x0, y0)
        ctx.lineTo(cornerX, y0)
        ctx.lineTo(cornerX, y1)
        if (Math.abs(cornerX - x1) > 1) {
          ctx.lineTo(x1, y1)
        }
      } else {
        // Same row: straight horizontal line
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
      }
      ctx.stroke()
    }
    return
  }

  if (like === 'symbol') {
    ctx.strokeStyle = color
    ctx.lineWidth = line_width
    ctx.beginPath()
    
    if (isCrossRow) {
      // Path: horizontal to corner, vertical to dest row, then horizontal to dest
      ctx.moveTo(x0, y0)
      ctx.lineTo(cornerX, y0)
      ctx.lineTo(cornerX, y1)
      if (Math.abs(cornerX - x1) > 1) {
        ctx.lineTo(x1, y1)
      }
    } else {
      // Same row: straight horizontal
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
    }
    ctx.stroke()
    return
  }

  throw new Error(`Invalid style: ${style}`)
}

/** @type {(editor: VovkPLCEditor, ladder: PLC_Ladder) => { from: { id: string }, to: { id: string }, state?: any }[]} */
const evaluate_ladder = (editor, ladder) => {
  ensureLadderFormat(ladder)
  const blocks = ladder.nodes || []
  const connections = getLegacyConnections(ladder)
  
  // Reset the state of all blocks and connections
  const blockHasInputConnection = (block) => connections.some(connection => connection.to.id === block.id)

  // Helper function to get timer elapsed time from live_symbol_values (same as STL/ASM)
  const getTimerElapsed = (block) => {
    if (!['timer_ton', 'timer_tof', 'timer_tp'].includes(block.type)) return 0
    const symbol = block.state?.symbol
    if (!symbol) return 0

    // Calculate the absolute address for the timer
    // Timer memory layout: 9 bytes per timer (same as WindowManager normalizeAddress)
    const offsets = ensureOffsets(editor.project?.offsets || {})
    const timerOffset = offsets.timer?.offset || 704
    const absoluteAddress = timerOffset + Math.floor(symbol.address) * 9 // Timers are 9 bytes per unit

    // Look up live value by absoluteAddress and type u32/dint
    const liveValues = editor.live_symbol_values
    if (liveValues) {
      let liveEntry = liveValues.get(symbol.name)
      if (!liveEntry || liveEntry.type === 'byte') {
        const timerLiveEntry = [...liveValues.values()].find(
          l => l.absoluteAddress === absoluteAddress && (l.type === 'u32' || l.type === 'dint')
        )
        if (timerLiveEntry) {
          liveEntry = timerLiveEntry
        }
      }
      if (liveEntry && typeof liveEntry.value === 'number') {
        return liveEntry.value
      }
    }
    return 0
  }

  // Helper function to get timer's Q (done) output state
  const getTimerDone = (block) => {
    if (!['timer_ton', 'timer_tof', 'timer_tp'].includes(block.type)) return false

    // Get preset value
    let presetMs = 1000
    const presetStr = block.preset || 'T#1s'
    if (typeof presetStr === 'number') {
      presetMs = presetStr
    } else {
      const presetParsed = parseTimeDuration(presetStr)
      presetMs = presetParsed.valid ? presetParsed.ms : 1000
    }

    // Get elapsed value from live_symbol_values
    const elapsed = getTimerElapsed(block)
    return elapsed >= presetMs
  }

  // Helper function to get counter's Q (done) output state
  const getCounterDone = (block) => {
    if (!['counter_u', 'counter_d', 'counter_ctu', 'counter_ctd', 'counter_ctud'].includes(block.type)) return false

    const presetValue = typeof block.preset === 'number' ? block.preset : 10
    const symbol = block.state?.symbol

    if (!symbol) return false

    // Get current count from live values
    const liveValues = editor.live_symbol_values
    if (!liveValues) return false

    let currentCount = 0
    const offsets = ensureOffsets(editor.project?.offsets || {})
    const counterOffset = offsets.counter?.offset || 768
    const absoluteAddress = counterOffset + Math.floor(symbol.address) * 5

    let liveEntry = liveValues.get(symbol.name)
    if (!liveEntry || liveEntry.type === 'byte') {
      const counterLiveEntry = [...liveValues.values()].find(
        l => l.absoluteAddress === absoluteAddress && (l.type === 'i32' || l.type === 'dint')
      )
      if (counterLiveEntry) {
        liveEntry = counterLiveEntry
      }
    }

    if (liveEntry && typeof liveEntry.value === 'number') {
      currentCount = liveEntry.value
    }

    // CTU: done when count >= preset
    // CTD: done when count <= 0
    if (block.type === 'counter_d' || block.type === 'counter_ctd') {
      return currentCount <= 0
    }
    return currentCount >= presetValue
  }

  blocks.forEach(block => {
    block = getBlockState(editor, block)
    if (!block.state) return // Block state not found, skip
    const { state, inverted } = block
    const symbol = state.symbol
    let active = symbol ? !!getSymbolValue(editor, symbol) : false
    if (inverted) active = !active
    state.active = active // The actual state of the block
    // All blocks that have no input are powered by the power rail
    // state.powered = !blockHasInputConnection(block)
    state.powered = block.type === 'contact' && block.x === 0
    state.evaluated = false
    block.state.terminated_input = false
    block.state.terminated_output = false
    // Calculate and store timer/counter done state and elapsed time
    block.state.timerElapsed = getTimerElapsed(block)
    block.state.timerDone = getTimerDone(block)
    block.state.counterDone = getCounterDone(block)
  })
  connections.forEach(con => {
    con.state = con.state || {
      powered: false,
      evaluated: false
    }
    con.state.powered = false
    con.state.evaluated = false
  })

  // const starting_blocks = blocks.filter(block => !blockHasInputConnection(block))
  const starting_blocks = blocks.filter(block => block.type === 'contact' && block.x === 0)
  starting_blocks.forEach(block => {
    if (!block.state) return // Block state not found, skip
    block.state.terminated_input = true
  })
  const ending_blocks = blocks.filter(block => !connections.some(con => con.from.id === block.id))
  ending_blocks.forEach(block => {
    // if (!block.state) throw new Error(`Block state not found: ${block.symbol}`)
    if (!block.state) return // Block state not found, skip
    block.state.terminated_output = true
  })

  /** @type {(block: PLC_LadderBlock, first: boolean, inputPowered: boolean) => void} */
  const evaluate_powered_block = (block, first, inputPowered = false) => {
    // if (!block.state) throw new Error(`Block state not found: ${block.symbol}`)
    if (!block.state) return // Block state not found, skip
    if (block.state.evaluated) return
    const { state } = block
    const isContact = block.type === 'contact'
    const isCoil = ['coil', 'coil_set', 'coil_rset'].includes(block.type)
    const isTimer = ['timer_ton', 'timer_tof', 'timer_tp'].includes(block.type)
    const isTOF = block.type === 'timer_tof'
    const isTP = block.type === 'timer_tp'
    const isCounter = ['counter_u', 'counter_d', 'counter_ctu', 'counter_ctd', 'counter_ctud'].includes(block.type)
    const isFB = isFunctionBlock(block.type)
    const isCompareFB = isCompareBlock(block.type)

    // Track the input power state for this block
    state.powered_input = inputPowered
    if (first && isContact && block.x === 0) {
      state.powered_input = true
      inputPowered = true
    }

    const pass_through = isCoil && !first
    // For TOF: output is ON when NOT done (timer still running after input off)
    // For TP: output is ON when running (elapsed > 0) AND NOT done
    // For TON: output is ON when done (timer finished)
    const timerOutputOn = isTP
      ? (state.timerElapsed > 0 && !state.timerDone)  // TP: ON only while pulse active
      : (isTOF ? !state.timerDone : state.timerDone)  // TOF: !done, TON: done
    const timer_pass_through = isTimer && !first && timerOutputOn
    const counter_pass_through = isCounter && !first && state.counterDone
    const fb_pass_through = isFB && !first && inputPowered

    // For timers/coils/operation blocks: powered = received input power
    // For contacts: powered = input power AND contact is active (closed)
    if (isTimer || isCoil || isCounter || isFB) {
      state.powered = inputPowered
    } else if (isContact) {
      state.powered = inputPowered && state.active
    } else {
      state.powered = isContact || pass_through || timer_pass_through || counter_pass_through || fb_pass_through
    }

    if (isCoil && first) return
    if (isTimer && first) return
    if (isCounter && first) return
    if (isFB && first) return
    const momentary = block.trigger !== 'normal'
    // For timers: propagate power based on Q output state
    // For counters: only propagate power if done (Q output is true)
    // For contacts: propagate if active AND received input power
    // For operation blocks: pass through input power (compare blocks may differ)
    const contactOutputPowered = isContact && state.active && inputPowered
    const fbOutputPowered = isFB && inputPowered  // Operation blocks pass through power when input is powered
    const shouldPropagate = isTimer ? timerOutputOn : isCounter ? state.counterDone : isFB ? fbOutputPowered : (isContact ? contactOutputPowered : ((!momentary && state.active) || pass_through))
    if (shouldPropagate || (isCoil && inputPowered)) {
      state.evaluated = true
      const outgoing_connections = connections.filter(con => con.from.id === block.id)
      outgoing_connections.forEach(con => {
        if (!con.state) throw new Error(`Connection state not found: ${con.from.id} -> ${con.to.id}`)
        const to_block = blocks.find(block => block.id === con.to.id)
        // if (!to_block) throw new Error(`Block not found: ${con.to.id}`)
        if (!to_block) return // Block not found, skip
        // Calculate output power to pass to next block
        let outputPower = false
        if (isContact) outputPower = inputPowered && state.active
        else if (isCoil) outputPower = inputPowered
        else if (isTimer) outputPower = timerOutputOn
        else if (isCounter) outputPower = state.counterDone
        else if (isFB) outputPower = isCompareFB ? state.active : inputPowered  // Compare uses comparison result, others pass through
        else outputPower = true
        con.state.powered = outputPower
        con.state.evaluated = true
        evaluate_powered_block(to_block, false, outputPower)
      })
    }
  }

  starting_blocks.forEach(block => {
    evaluate_powered_block(block, true, true)
  })

  // Special handling for TOF and TP timers: they need to propagate power even when input is OFF
  // TOF holds the output ON after input turns off
  // TP holds output ON for full pulse duration after rising edge trigger
  // We need to start a second evaluation from these timers that have their output ON
  // but weren't reached by the normal power chain
  const holdingTimers = blocks.filter(block => block.type === 'timer_tof' || block.type === 'timer_tp')
  holdingTimers.forEach(timerBlock => {
    if (!timerBlock.state) return
    // Check if timer output is ON
    // TOF: ON when !done (still holding)
    // TP: ON when elapsed > 0 AND !done (pulse active)
    const isTP = timerBlock.type === 'timer_tp'
    const timerOutputOn = isTP
      ? (timerBlock.state.timerElapsed > 0 && !timerBlock.state.timerDone)
      : !timerBlock.state.timerDone
    if (timerOutputOn && !timerBlock.state.evaluated) {
      // Timer is active but wasn't evaluated - propagate power from it
      timerBlock.state.powered = true
      timerBlock.state.evaluated = true
      const outgoing_connections = connections.filter(con => con.from.id === timerBlock.id)
      outgoing_connections.forEach(con => {
        if (!con.state) return
        const to_block = blocks.find(b => b.id === con.to.id)
        if (!to_block) return
        con.state.powered = true
        con.state.evaluated = true
        evaluate_powered_block(to_block, false, true)
      })
    }
  })
  
  return connections
}




/** @type { RendererModule } */
export const ladderRenderer = {
  id: 'ladder',

  render(editor, block) {
    if (block.type !== 'ladder') return
    
    // Ensure ladder is in correct format with backward-compatible accessors
    ensureLadderFormat(block)
    
    // Initialize arrays if not present
    block.nodes = block.nodes || []
    block.connections = block.connections || []

    // For backward compatibility, also expose 'blocks' alias
    const blocks = block.nodes
    const connections = getLegacyConnections(block)
    
    const { div, props } = block
    const ladderId = block.id

    // Add Context Menu to Header for viewing compiled code (STL/PLCASM)
    const block_header = div && div.querySelector('.plc-program-block-header')
    if (block_header) {
      block_header.oncontextmenu = (e) => {
        e.preventDefault()
        e.stopImmediatePropagation()

        const items = [
          { label: 'View Logic as Ladder Graph', name: 'view_graph', icon: 'json', type: 'item' },
          { label: 'View Logic as STL', name: 'view_stl', icon: 'code', type: 'item' },
          { label: 'View Logic as PLCASM', name: 'view_asm', icon: 'server', type: 'item' }
        ]

        /**
         * Pretty prints JSON with smart formatting:
         * - Objects with only simple properties (null, boolean, number, string) are printed on one line
         * - Arrays of simple values are printed on one line
         * - Complex objects/arrays are expanded to multiple lines
         * @param {any} obj - The object to stringify
         * @param {number} indent - Current indentation level
         * @returns {string} - Formatted JSON string
         */
        const smartStringify = (obj, indent = 0) => {
          const spaces = '  '.repeat(indent)
          const nextSpaces = '  '.repeat(indent + 1)
          
          if (obj === null) return 'null'
          if (obj === undefined) return 'undefined'
          if (typeof obj === 'boolean' || typeof obj === 'number') return String(obj)
          if (typeof obj === 'string') return JSON.stringify(obj)
          
          // Check if value is simple (not an object/array)
          const isSimple = v => v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string'
          
          if (Array.isArray(obj)) {
            if (obj.length === 0) return '[]'
            // Check if all elements are simple
            const allSimple = obj.every(isSimple)
            if (allSimple) {
              return '[' + obj.map(v => v === undefined ? 'null' : JSON.stringify(v)).join(', ') + ']'
            }
            // Complex array - expand
            const items = obj.map(v => nextSpaces + smartStringify(v, indent + 1))
            return '[\n' + items.join(',\n') + '\n' + spaces + ']'
          }
          
          if (typeof obj === 'object') {
            const keys = Object.keys(obj)
            if (keys.length === 0) return '{}'
            // Check if all values are simple
            const allSimple = keys.every(k => isSimple(obj[k]))
            if (allSimple) {
              const pairs = keys.map(k => JSON.stringify(k) + ': ' + (obj[k] === undefined ? 'null' : JSON.stringify(obj[k])))
              return '{ ' + pairs.join(', ') + ' }'
            }
            // Special case: connection objects with sources/destinations arrays of simple values
            const isConnection = keys.length === 2 && keys.includes('sources') && keys.includes('destinations') &&
                Array.isArray(obj.sources) && Array.isArray(obj.destinations) &&
                obj.sources.every(isSimple) && obj.destinations.every(isSimple)
            if (isConnection) {
              const srcArr = '[' + obj.sources.map(v => JSON.stringify(v)).join(', ') + ']'
              const dstArr = '[' + obj.destinations.map(v => JSON.stringify(v)).join(', ') + ']'
              return '{ "sources": ' + srcArr + ', "destinations": ' + dstArr + ' }'
            }
            // Complex object - expand
            const pairs = keys.map(k => nextSpaces + JSON.stringify(k) + ': ' + smartStringify(obj[k], indent + 1))
            return '{\n' + pairs.join(',\n') + '\n' + spaces + '}'
          }
          
          return String(obj)
        }

        if (editor.context_manager) {
          editor.context_manager.show(e, items, async (action) => {
            try {
              // 1. Convert Ladder to Graph format
              const graph = toGraph(block)

              let finalOutput = ''
              let titleSuffix = ''

              if (action === 'view_graph') {
                finalOutput = smartStringify(graph)
                titleSuffix = 'Ladder Graph'
              } else {
                if (!editor.runtime || !editor.runtime.compileLadder) {
                  throw new Error("Runtime compiler not available")
                }

                // 2. Compile Graph to STL
                // The runtime expects graph JSON string
                const graphJson = JSON.stringify(graph)
                const ladderResult = await editor.runtime.compileLadder(graphJson)

                if (!ladderResult || typeof ladderResult.output !== 'string') {
                  throw new Error('Ladder compilation failed to produce STL')
                }

                finalOutput = ladderResult.output
                titleSuffix = 'STL'

                // 3. If PLCASM requested, compile STL to ASM
                if (action === 'view_asm') {
                  if (!editor.runtime.compileSTL) {
                    throw new Error('STL compiler not available')
                  }
                  const asmResult = await editor.runtime.compileSTL(finalOutput)
                  if (!asmResult || typeof asmResult.output !== 'string') {
                    throw new Error('STL compilation failed to produce PLCASM')
                  }
                  finalOutput = asmResult.output
                  titleSuffix = 'PLCASM'
                }
              }

              // 4. Show Popup with MiniCodeEditor for syntax highlighting
              const container = document.createElement('div')
              Object.assign(container.style, {
                width: '100%',
                height: '500px',
                position: 'relative'
              })

              // Determine language for syntax highlighting
              const editorLanguage = action === 'view_graph' ? 'json' : (action === 'view_asm' ? 'asm' : 'stl')

              new Popup({
                title: `Compiled ${titleSuffix} (${block.name})`,
                width: '900px',
                content: container,
                buttons: [{ text: 'Close', value: 'close' }]
              })

              // Create MiniCodeEditor after popup is in DOM
              new MiniCodeEditor(container, {
                value: finalOutput,
                language: editorLanguage,
                readOnly: true,
                preview: true // Disable squiggly lines and diagnostic tooltips
              })

            } catch (err) {
              console.error(err)
              new Popup({
                title: 'Compilation Failed',
                description: err.message,
                buttons: [{ text: 'OK', value: 'ok' }]
              })
            }
          })
        }
      }
    }

    const scale = 1.4
    const ladder_block_width = editor.properties.ladder_block_width || 120
    const ladder_block_height = editor.properties.ladder_block_height || 80
    const ladder_blocks_per_row = editor.properties.ladder_blocks_per_row || 7
    const style = editor.properties.style || {
      background_color_alt: '#333',
      background_color_online: '#444',
      background_color_edit: '#666',
      color: '#000',
      highlight_color: '#32cd32', // lime green for device mode
      highlight_sim_color: '#00ffff', // cyan for simulation mode
      grid_color: '#FFF4',
      select_highlight_color: '#7AF',
      select_color: 'rgba(68, 85, 102, 0.6)',  // Semi-transparent to show errors underneath
      hover_color: '#456',
      font: '16px Consolas',
      font_color: '#DDD',
      font_error_color: '#FCC',
      line_width: 3,
      highlight_width: 8,
    }

    // Initialize canvas if not already present
    if (!props.ctx) {
      if (!div) throw new Error('Block div not found')
      const block_container = div.querySelector('.plc-program-block-code')
      if (!block_container) throw new Error('Block code not found')
      
      // Ensure container is positioned for tooltip
      if (getComputedStyle(block_container).position === 'static') {
        block_container.style.position = 'relative'
      }
      
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 600

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas context not found')
      props.ctx = ctx
      props.canvas = canvas
      block_container.appendChild(canvas)
      
      // Create diagnostic tooltip element
      const diagTooltip = document.createElement('div')
      diagTooltip.className = 'ladder-diag-tooltip'
      diagTooltip.style.cssText = `
        position: absolute;
        display: none;
        background: #252526;
        border: 1px solid #454545;
        border-radius: 4px;
        padding: 6px 10px;
        color: #ccc;
        font-size: 12px;
        font-family: monospace;
        max-width: 300px;
        z-index: 1000;
        pointer-events: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        white-space: pre-wrap;
        word-break: break-word;
      `
      block_container.appendChild(diagTooltip)
      props.diagTooltip = diagTooltip

      // API functions for problem panel integration
      props.setHoverHighlightCell = (cell) => {
        props.hoverHighlightCell = cell
        ladderRenderer.render(editor, block)
      }
      
      props.clearHoverHighlightCell = () => {
        props.hoverHighlightCell = null
        ladderRenderer.render(editor, block)
      }
      
      props.selectCell = (x, y) => {
        // Set the ladder selection to this cell
        editor.ladder_selection = {
          ladder_id: ladderId,
          program_id: block.program_id || null,
          origin: { x, y },
          selection: [{ type: 'block', x, y }]
        }
        ladderRenderer.render(editor, block)
        // Focus the canvas so ESC and blur events work
        canvas.focus()
      }

      // Initialize event handlers (only once)
      initializeEventHandlers(editor, block, canvas, style)

      // Initialize live monitoring system
      initializeLiveMonitoring(editor, block, canvas)
    }

    const { ctx, canvas } = props
    if (!ctx) throw new Error('Canvas context not found')

    const {
      background_color_online,
      background_color_edit,
      grid_color,
      select_color,
      select_highlight_color,
    } = style

    const live = editor.device_manager.connected && !!editor.window_manager?.isMonitoringActive?.()
    const edit = !live

    // Check if so that we can reuse the same variable logic
    /* 
       Logic:
       Live Mode = Connected AND Monitoring Active
       Edit Mode = Not Live (So if connected but monitoring is OFF, it is Edit Mode)
    */
    const hasSelection = editor.ladder_selection?.ladder_id === ladderId
    const selection = hasSelection ? (editor.ladder_selection?.selection || []) : []

    const minX = ladder_blocks_per_row
    const minY = 2
    
    // Calculate max positions from blocks
    const blockMaxX = blocks.length > 0 ? Math.max(...blocks.map(b => b.x)) : 0
    const blockMaxY = blocks.length > 0 ? Math.max(...blocks.map(b => b.y)) : 0
    
    // In edit mode, always add a free column/row if any block is at the border
    // This allows the grid to auto-expand as items are moved
    let max_x = Math.max(minX, blockMaxX)
    let max_y = Math.max(minY, blockMaxY)
    
    if (edit) {
      // If any block is at the current max position, add one more column/row
      const hasBlockAtMaxX = blocks.some(b => b.x === max_x)
      const hasBlockAtMaxY = blocks.some(b => b.y === max_y)
      if (hasBlockAtMaxX) max_x += 1
      if (hasBlockAtMaxY) max_y += 1
    }

    const width = Math.max(max_x + 1, ladder_blocks_per_row) * ladder_block_width
    const height = (max_y + 1) * ladder_block_height
    canvas.style.width = (width / scale) + 'px'
    canvas.style.height = (height / scale) + 'px'
    canvas.width = width
    canvas.height = height

    // Canvas fill background
    ctx.fillStyle = live ? background_color_online : background_color_edit
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw selection highlight
    if (hasSelection) {
      ctx.fillStyle = select_color
      for (const sel of selection) {
        if (sel.type === 'block') {
          const { x, y } = sel
          ctx.fillRect(x * ladder_block_width, y * ladder_block_height, ladder_block_width, ladder_block_height)
        }
        if (sel.type === 'area') {
          const { x, y, width: w, height: h } = sel
          ctx.fillRect(x * ladder_block_width, y * ladder_block_height, w * ladder_block_width, h * ladder_block_height)
        }
      }
    }

    // Draw diagnostic highlights (errors/warnings from linting) - drawn AFTER selection so they're visible
    const diagnostics = props.diagnostics || []
    if (diagnostics.length > 0) {
      // Group diagnostics by cell position, prioritizing errors over warnings
      const cellDiagMap = new Map() // key: "x,y", value: { hasError: bool, hasWarning: bool }
      
      for (const diag of diagnostics) {
        let cellX = diag.fallbackCellX ?? 0
        let cellY = diag.fallbackCellY ?? 0
        
        // Resolve position from token if available
        if (diag.token) {
          const token = diag.token
          // Check if token is a connection reference (c[index])
          const connMatch = token.match(/^c\[(\d+)\]$/)
          if (connMatch) {
            // Connection - we can't highlight connections directly, skip or use fallback
            continue
          } else {
            // Token is a node ID - find the node's current position
            const node = blocks.find(n => n.id === token)
            if (node) {
              cellX = node.x
              cellY = node.y
            }
          }
        }
        
        const key = `${cellX},${cellY}`
        if (!cellDiagMap.has(key)) {
          cellDiagMap.set(key, { cellX, cellY, hasError: false, hasWarning: false })
        }
        const cell = cellDiagMap.get(key)
        if (diag.type === 'error') cell.hasError = true
        else cell.hasWarning = true
      }
      
      // Draw each cell only once - error style takes priority over warning
      for (const cell of cellDiagMap.values()) {
        const { cellX, cellY, hasError } = cell
        // If cell has error, show error style; otherwise show warning style
        const isError = hasError
        
        // Draw semi-transparent red/yellow background for problem cells
        ctx.fillStyle = isError ? 'rgba(255, 80, 80, 0.35)' : 'rgba(255, 200, 0, 0.3)'
        ctx.fillRect(cellX * ladder_block_width, cellY * ladder_block_height, ladder_block_width, ladder_block_height)
        
        // Draw border
        ctx.strokeStyle = isError ? '#f44' : '#cc0'
        ctx.lineWidth = 2
        ctx.setLineDash([])
        ctx.strokeRect(cellX * ladder_block_width + 1, cellY * ladder_block_height + 1, ladder_block_width - 2, ladder_block_height - 2)
      }
    }

    // Draw problem hover highlight (from problem panel)
    const hoverCell = props.hoverHighlightCell
    if (hoverCell && typeof hoverCell.x === 'number' && typeof hoverCell.y === 'number') {
      const { x: hoverX, y: hoverY } = hoverCell
      ctx.fillStyle = 'rgba(100, 150, 255, 0.3)'
      ctx.fillRect(hoverX * ladder_block_width, hoverY * ladder_block_height, ladder_block_width, ladder_block_height)
      ctx.strokeStyle = '#68f'
      ctx.lineWidth = 3
      ctx.setLineDash([])
      ctx.strokeRect(hoverX * ladder_block_width + 1, hoverY * ladder_block_height + 1, ladder_block_width - 2, ladder_block_height - 2)
    }

    // Draw grid
    ctx.strokeStyle = grid_color
    ctx.lineWidth = 0.5
    ctx.setLineDash([5, 5])
    ctx.lineDashOffset = 2.5
    ctx.beginPath()
    for (let x = 1; x < Math.max(max_x + 1, ladder_blocks_per_row); x++) {
      ctx.moveTo(x * ladder_block_width, 0)
      ctx.lineTo(x * ladder_block_width, canvas.height)
    }
    for (let y = 1; y < max_y + 1; y++) {
      ctx.moveTo(0, y * ladder_block_height)
      ctx.lineTo(canvas.width, y * ladder_block_height)
    }
    ctx.stroke()

    // Check if this ladder has a selection and highlight the origin (primary selected cell)
    if (hasSelection && selection.length > 0) {
      const origin = editor.ladder_selection?.origin || { x: 0, y: 0 }
      ctx.strokeStyle = select_highlight_color
      ctx.lineWidth = 3
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.strokeRect(origin.x * ladder_block_width, origin.y * ladder_block_height, ladder_block_width, ladder_block_height)
      ctx.stroke()
    }

    ctx.setLineDash([])

    // Draw the ladder blocks and connections
    const evaluatedConnections = evaluate_ladder(editor, block)

    // Draw the ladder highlights (for live values)
    blocks.forEach(b => {
      if (live) {
        // Only draw highlights if we are live (connected AND monitoring active)
        if (b.type === 'contact') draw_contact(editor, 'highlight', ctx, b)
        if (['coil', 'coil_set', 'coil_rset'].includes(b.type)) draw_coil(editor, 'highlight', ctx, b)
        if (['timer_ton', 'timer_tof', 'timer_tp'].includes(b.type)) draw_timer(editor, 'highlight', ctx, b)
        if (['counter_u', 'counter_d', 'counter_ctu', 'counter_ctd', 'counter_ctud'].includes(b.type)) draw_counter(editor, 'highlight', ctx, b)
        if (isFunctionBlock(b.type)) draw_function_block(editor, 'highlight', ctx, b)
      }
    })

    /** @type { LadderLink[] } */
    const links = []
    evaluatedConnections.forEach(con => {
      // Prevent regenerating IDs for existing connections
      if (!con.id) con.id = editor._generateID()

      const from = blocks.find(b => b.id === con.from.id)
      const to = blocks.find(b => b.id === con.to.id)
      if (from && to) links.push({ from, to, powered: !!con.state?.powered })
    })

    // Get computed connection paths
    const pathCache = computeConnectionPaths(editor, block)
    const pathMap = new Map()
    for (const path of pathCache.paths) {
      pathMap.set(`${path.srcId}->${path.destId}`, path)
    }

    links.forEach(link => {
      if (live) {
        const routedPath = pathMap.get(`${link.from.id}->${link.to.id}`)
        draw_connection(editor, 'highlight', ctx, link, routedPath)
      }
    })

    // Draw the ladder symbols
    blocks.forEach(b => {
      if (b.type === 'contact') draw_contact(editor, 'symbol', ctx, b)
      if (['coil', 'coil_set', 'coil_rset'].includes(b.type)) draw_coil(editor, 'symbol', ctx, b)
      if (['timer_ton', 'timer_tof', 'timer_tp'].includes(b.type)) draw_timer(editor, 'symbol', ctx, b)
      if (['counter_u', 'counter_d', 'counter_ctu', 'counter_ctd', 'counter_ctud'].includes(b.type)) draw_counter(editor, 'symbol', ctx, b)
      if (isFunctionBlock(b.type)) draw_function_block(editor, 'symbol', ctx, b)
    })
    links.forEach(link => {
      const routedPath = pathMap.get(`${link.from.id}->${link.to.id}`)
      draw_connection(editor, 'symbol', ctx, link, routedPath)
    })
    
    // Draw hovered connection highlights in edit mode (before selected, so selected shows on top)
    if (edit) {
      const connState = editor.ladder_connection_state?.[ladderId]
      if (connState && connState.hovered_connections?.length > 0) {
        ctx.save()
        ctx.strokeStyle = '#88c8ff' // Hover light blue
        ctx.lineWidth = 3
        ctx.setLineDash([])
        
        for (const pair of connState.hovered_connections) {
          // Skip if this connection is already selected (will be drawn with selection style)
          const isSelected = connState.selected_connections?.some(
            s => s.srcId === pair.srcId && s.destId === pair.destId
          )
          if (isSelected) continue
          
          const routedPath = pathMap.get(`${pair.srcId}->${pair.destId}`)
          const link = links.find(l => l.from.id === pair.srcId && l.to.id === pair.destId)
          if (link) {
            const { from, to } = link
            const x0 = from.x * ladder_block_width + ladder_block_width
            const y0 = from.y * ladder_block_height + ladder_block_height / 2
            const x1 = to.x * ladder_block_width
            const y1 = to.y * ladder_block_height + ladder_block_height / 2
            const isCrossRow = from.y !== to.y
            
            const cornerXGrid = routedPath?.cornerX ?? to.x
            const cornerX = cornerXGrid * ladder_block_width
            
            ctx.beginPath()
            if (isCrossRow) {
              ctx.moveTo(x0, y0)
              ctx.lineTo(cornerX, y0)
              ctx.lineTo(cornerX, y1)
              if (Math.abs(cornerX - x1) > 1) {
                ctx.lineTo(x1, y1)
              }
            } else {
              ctx.moveTo(x0, y0)
              ctx.lineTo(x1, y1)
            }
            ctx.stroke()
          }
        }
        
        ctx.restore()
      }
    }
    
    // Draw selected connection highlights in edit mode
    if (edit) {
      const connState = editor.ladder_connection_state?.[ladderId]
      if (connState && connState.selected_connections?.length > 0) {
        ctx.save()
        ctx.strokeStyle = '#4a9eff' // Selection blue
        ctx.lineWidth = 4
        ctx.setLineDash([6, 4])
        
        for (const pair of connState.selected_connections) {
          const routedPath = pathMap.get(`${pair.srcId}->${pair.destId}`)
          const link = links.find(l => l.from.id === pair.srcId && l.to.id === pair.destId)
          if (link) {
            // Draw the selection highlight using same logic as draw_connection
            const { from, to } = link
            const x0 = from.x * ladder_block_width + ladder_block_width
            const y0 = from.y * ladder_block_height + ladder_block_height / 2
            const x1 = to.x * ladder_block_width
            const y1 = to.y * ladder_block_height + ladder_block_height / 2
            const isCrossRow = from.y !== to.y
            
            // Get corner X position from routed path, or default to dest X
            const cornerXGrid = routedPath?.cornerX ?? to.x
            const cornerX = cornerXGrid * ladder_block_width
            
            ctx.beginPath()
            if (isCrossRow) {
              ctx.moveTo(x0, y0)
              ctx.lineTo(cornerX, y0)
              ctx.lineTo(cornerX, y1)
              if (Math.abs(cornerX - x1) > 1) {
                ctx.lineTo(x1, y1)
              }
            } else {
              ctx.moveTo(x0, y0)
              ctx.lineTo(x1, y1)
            }
            ctx.stroke()
          }
        }
        
        ctx.restore()
      }
    }
    
    // Draw connection handles and wire in edit mode
    if (edit) {
      const connState = editor.ladder_connection_state?.[ladderId]
      if (connState) {
        const hover_x = connState.hover_x
        const hover_y = connState.hover_y
        const handleRadius = 8
        
        // Get the origin (primary selected) block to show connection handles on it
        // Only if the selection belongs to THIS ladder and there's an actual selection
        const selectionBelongsToThisLadder = editor.ladder_selection?.ladder_id === ladderId
        const hasSelection = selectionBelongsToThisLadder && editor.ladder_selection?.selection?.length > 0
        const origin = hasSelection ? editor.ladder_selection?.origin : null
        const originBlock = origin 
          ? blocks.find(b => b.x === origin.x && b.y === origin.y)
          : null
        
        // Only show connection handles when dragging (for drop targets) or on origin block
        const isDragging = connState.dragging_wire
        const startBlock = connState.wire_start_block
        const startSide = connState.wire_start_side
        
        // Draw handles on origin (primary selected) block
        if (originBlock && !isDragging) {
          const b = originBlock
          const x0 = b.x * ladder_block_width
          const y_mid = b.y * ladder_block_height + ladder_block_height / 2
          const x1 = x0 + ladder_block_width
          
          // Draw left handle (input)
          ctx.beginPath()
          ctx.arc(x0, y_mid, handleRadius, 0, Math.PI * 2)
          ctx.fillStyle = '#2196F3'
          ctx.fill()
          ctx.strokeStyle = '#FFF'
          ctx.lineWidth = 2
          ctx.stroke()
          
          // Draw right handle (output)
          ctx.beginPath()
          ctx.arc(x1, y_mid, handleRadius, 0, Math.PI * 2)
          ctx.fillStyle = '#2196F3'
          ctx.fill()
          ctx.strokeStyle = '#FFF'
          ctx.lineWidth = 2
          ctx.stroke()
        }
        
        // When dragging, show drop target handles on valid blocks
        if (isDragging && startBlock) {
          const snappedBlock = connState.snapped_block
          
          // Build a set of existing connections from/to the start block
          const existingConnections = new Set()
          const connections = block.connections || []
          for (const conn of connections) {
            if (conn.sources && conn.destinations) {
              if (conn.sources.includes(startBlock.id)) {
                conn.destinations.forEach(d => existingConnections.add(d))
              }
              if (conn.destinations.includes(startBlock.id)) {
                conn.sources.forEach(s => existingConnections.add(s))
              }
            } else if (conn.from && conn.to) {
              if (conn.from.id === startBlock.id) existingConnections.add(conn.to.id)
              if (conn.to.id === startBlock.id) existingConnections.add(conn.from.id)
            }
          }
          
          // Use centralized connection segments from path routing system
          const segments = getConnectionSegments(editor, block)
          
          blocks.forEach(b => {
            // Skip the origin block
            if (b.id === startBlock.id) return
            
            // Skip blocks already connected to the origin
            if (existingConnections.has(b.id)) return
            
            const x0 = b.x * ladder_block_width
            const y_mid = b.y * ladder_block_height + ladder_block_height / 2
            const x1 = x0 + ladder_block_width
            
            const isSnapped = snappedBlock && b.id === snappedBlock.id
            const handleSize = isSnapped ? handleRadius * 1.5 : handleRadius
            
            // When dragging from RIGHT side: startBlock is SOURCE, looking for DESTINATIONS to the right
            if (startSide === 'right' && b.x > startBlock.x) {
              // Check if path from startBlock (source) to b (dest) is clear
              if (!isConnectionPathClear(startBlock, b, blocks, segments)) return
              
              // Show left-side handle (input side) of destination
              ctx.beginPath()
              ctx.arc(x0, y_mid, handleSize, 0, Math.PI * 2)
              ctx.fillStyle = isSnapped ? '#8BC34A' : '#4CAF50'
              ctx.fill()
              ctx.strokeStyle = '#FFF'
              ctx.lineWidth = isSnapped ? 3 : 2
              ctx.stroke()
            }
            
            // When dragging from LEFT side: startBlock is DESTINATION, looking for SOURCES to the left
            if (startSide === 'left' && b.x < startBlock.x) {
              // Check if path from b (source) to startBlock (dest) is clear
              if (!isConnectionPathClear(b, startBlock, blocks, segments)) return
              
              // Show right-side handle (output side) of source
              ctx.beginPath()
              ctx.arc(x1, y_mid, handleSize, 0, Math.PI * 2)
              ctx.fillStyle = isSnapped ? '#8BC34A' : '#4CAF50'
              ctx.fill()
              ctx.strokeStyle = '#FFF'
              ctx.lineWidth = isSnapped ? 3 : 2
              ctx.stroke()
            }
          })
        }
        
        // Draw the connection wire being dragged
        if (connState.dragging_wire && connState.wire_start_block) {
          const startBlock = connState.wire_start_block
          const startSide = connState.wire_start_side
          const isSnapped = !!connState.snapped_block
          
          const startX = startSide === 'left' 
            ? startBlock.x * ladder_block_width 
            : (startBlock.x + 1) * ladder_block_width
          const startY = startBlock.y * ladder_block_height + ladder_block_height / 2
          
          const endX = connState.wire_end_x
          const endY = connState.wire_end_y
          
          // Draw line (solid when snapped, dashed otherwise)
          ctx.beginPath()
          if (!isSnapped) {
            ctx.setLineDash([8, 4])
          }
          ctx.strokeStyle = isSnapped ? '#4CAF50' : '#2196F3'
          ctx.lineWidth = 3
          ctx.moveTo(startX, startY)
          ctx.lineTo(endX, endY)
          ctx.stroke()
          ctx.setLineDash([])
          
          // Draw circle at the end (only if not snapped, since snapped shows handle)
          if (!isSnapped) {
            ctx.beginPath()
            ctx.arc(endX, endY, 6, 0, Math.PI * 2)
            ctx.fillStyle = '#2196F3'
            ctx.fill()
          }
        }
      }
    }
  }
}


/**
 * Initialize mouse and touch event handlers for ladder canvas
 * @param {VovkPLCEditor} editor
 * @param {any} ladder
 * @param {HTMLCanvasElement} canvas
 * @param {any} style
 */
function initializeEventHandlers(editor, ladder, canvas, style) {
  const ladderId = ladder.id

  // Helper to get current scale and block dimensions
  const getScale = () => 1.4
  const getBlockWidth = () => editor.properties.ladder_block_width || 120
  const getBlockHeight = () => editor.properties.ladder_block_height || 80

  // Initialize ladder_selection on editor if not present
  if (!editor.ladder_selection) {
    editor.ladder_selection = {
      ladder_id: null,
      program_id: null,
      origin: { x: 0, y: 0 },
      selection: []
    }
  }
  
  // Initialize connection wire state on editor for this ladder
  if (!editor.ladder_connection_state) {
    editor.ladder_connection_state = {}
  }
  editor.ladder_connection_state[ladderId] = {
    hover_x: -1,
    hover_y: -1,
    dragging_wire: false,
    wire_start_block: null,
    wire_start_side: null, // 'left' or 'right'
    wire_end_x: 0,
    wire_end_y: 0,
    snapped_block: null,
    // Selected connection pairs: array of {srcId, destId}
    selected_connections: [],
    // Flag to prevent click handler after connection selection
    just_selected_connection: false
  }
  const connState = editor.ladder_connection_state[ladderId]

  // Register this ladder's re-render callback for cross-ladder selection updates
  if (!editor.ladder_render_registry) {
    editor.ladder_render_registry = {}
  }
  editor.ladder_render_registry[ladderId] = () => ladderRenderer.render(editor, ladder)

  // Debounced lint trigger for ladder changes
  let lintTimer = null
  const triggerLint = () => {
    if (lintTimer) clearTimeout(lintTimer)
    lintTimer = setTimeout(() => {
      if (editor.lintProject && typeof editor.lintProject === 'function') {
        editor.lintProject()
      }
    }, 300)
  }

  let is_dragging = false
  let is_moving = false
  let moving_elements = []
  let moving_original_positions = [] // Store original positions for ESC cancel
  let moving_original_selection = null // Store original selection for ESC cancel
  let was_dragging = false
  let was_dragging_wire = false
  let operation_cancelled = false // Flag to ignore mouse until released after ESC cancel
  let start_x = 0
  let start_y = 0
  let end_x = 0
  let end_y = 0
  let temp_x = 0
  let temp_y = 0
  let move_offset_x = 0 // Offset from cursor to origin when drag started
  let move_offset_y = 0

  /** @type { PLC_Symbol | undefined } */
  let selected_for_toggle = undefined

  const resolveSymbol = (name) => {
    if (!name) return undefined
    return system_symbols.find(s => s.name === name) || editor.project?.symbols?.find(s => s.name === name)
  }

  /** @param { MouseEvent } event */
  const onMouseDown = (event) => {
    const rect = canvas.getBoundingClientRect()

    // Right click opens context menu, if no selection is chosen, select the block below the cursor
    if (event.button === 2) {
      const start_x = Math.floor(event.clientX - rect.left)
      const start_y = Math.floor(event.clientY - rect.top)
      const x_raw = start_x * getScale() / getBlockWidth()
      const y_raw = start_y * getScale() / getBlockHeight()
      const x = Math.floor(x_raw)
      const y = Math.floor(y_raw)

      const selected = editor.ladder_selection?.ladder_id === ladderId ? editor.ladder_selection.selection : []
      const element_is_not_selected = !selected.find(sel => sel.type === 'block' && sel.x === x && sel.y === y)
      if (selected.length === 0 || element_is_not_selected) {
        const block = ladder.blocks.find(b => b.x === x && b.y === y)
        if (block) {
          editor.ladder_selection = {
            ladder_id: ladderId,
            program_id: ladder.program_id || '',
            origin: { x, y },
            selection: [{ type: 'block', x, y }]
          }
        }
      }
      return
    }

    if (event.button !== 0) return
    event.preventDefault()
    
    start_x = Math.floor(event.clientX - rect.left)
    start_y = Math.floor(event.clientY - rect.top)
    end_x = start_x
    end_y = start_y

    const x_raw = start_x * getScale() / getBlockWidth()
    const y_raw = start_y * getScale() / getBlockHeight()
    const x = Math.floor(x_raw)
    const y = Math.floor(y_raw)
    
    // Check if clicking on a connection handle (left/right edge of block)
    const live = editor.device_manager.connected && !!editor.window_manager?.isMonitoringActive?.()
    const edit = !live
    
    // Mouse position in canvas coordinates (scaled)
    const mouseCanvasX = start_x * getScale()
    const mouseCanvasY = start_y * getScale()
    
    if (edit) {
      // Only allow wire drag from the first selected block (where handles are visible)
      const selected = editor.ladder_selection?.ladder_id === ladderId ? editor.ladder_selection.selection : []
      const firstSelectedBlock = selected.length > 0 
        ? ladder.blocks.find(b => b.x === selected[0].x && b.y === selected[0].y)
        : null
      
      if (firstSelectedBlock) {
        const block = firstSelectedBlock
        const blockWidth = getBlockWidth()
        const blockHeight = getBlockHeight()
        
        // Calculate handle positions in canvas coordinates (scaled)
        const leftHandleX = block.x * blockWidth
        const rightHandleX = (block.x + 1) * blockWidth
        const handleY = block.y * blockHeight + blockHeight / 2
        
        const handleRadius = 8 // pixels in canvas space
        const clickRadius = handleRadius * 2 // detection radius
        
        // Check left handle
        const distToLeftHandle = Math.sqrt((mouseCanvasX - leftHandleX) ** 2 + (mouseCanvasY - handleY) ** 2)
        // Check right handle
        const distToRightHandle = Math.sqrt((mouseCanvasX - rightHandleX) ** 2 + (mouseCanvasY - handleY) ** 2)
        
        if (distToLeftHandle < clickRadius) {
          // Start dragging from left handle
          connState.dragging_wire = true
          connState.wire_start_block = block
          connState.wire_start_side = 'left'
          connState.wire_end_x = mouseCanvasX
          connState.wire_end_y = mouseCanvasY
          connState.snapped_block = null
          ladderRenderer.render(editor, ladder)
          return
        }
        
        if (distToRightHandle < clickRadius) {
          // Start dragging from right handle
          connState.dragging_wire = true
          connState.wire_start_block = block
          connState.wire_start_side = 'right'
          connState.wire_end_x = mouseCanvasX
          connState.wire_end_y = mouseCanvasY
          connState.snapped_block = null
          ladderRenderer.render(editor, ladder)
          return
        }
      }
      
      // Check if clicking on a connection line
      const clickGridX = mouseCanvasX / getBlockWidth()
      const clickGridY = mouseCanvasY / getBlockHeight()
      const connectionHit = findConnectionAtPoint(editor, ladder, clickGridX, clickGridY)
      
      if (connectionHit && connectionHit.pairs.length > 0) {
        const ctrl = event.ctrlKey || event.metaKey
        const shift = event.shiftKey
        
        // If SHIFT or CTRL is held and there are selected cells, don't select connections
        const hasCellSelection = editor.ladder_selection?.ladder_id === ladderId && 
                                  editor.ladder_selection.selection?.length > 0
        if ((shift || ctrl) && hasCellSelection) {
          // Skip connection selection when adding to cell selection
        } else {
        // Get current selection
        const currentSelection = connState.selected_connections || []
        
        if (ctrl) {
          // CTRL+CLICK: Toggle selection (add if not selected, remove if selected)
          const newSelection = [...currentSelection]
          for (const pair of connectionHit.pairs) {
            const idx = newSelection.findIndex(p => p.srcId === pair.srcId && p.destId === pair.destId)
            if (idx >= 0) {
              newSelection.splice(idx, 1) // Remove if exists
            } else {
              newSelection.push(pair) // Add if not exists
            }
          }
          connState.selected_connections = newSelection
        } else if (shift) {
          // SHIFT+CLICK: Add to selection (only if not already selected)
          const newSelection = [...currentSelection]
          for (const pair of connectionHit.pairs) {
            const exists = newSelection.some(p => p.srcId === pair.srcId && p.destId === pair.destId)
            if (!exists) {
              newSelection.push(pair)
            }
          }
          connState.selected_connections = newSelection
        } else {
          // Regular click: Replace selection
          connState.selected_connections = connectionHit.pairs
        }
        
        connState.just_selected_connection = true
        // Clear block selection when selecting connections
        if (editor.ladder_selection?.ladder_id === ladderId) {
          editor.ladder_selection.selection = []
        }
        ladderRenderer.render(editor, ladder)
        return
        }
      }
      
      // If SHIFT/CTRL is held and connections are selected, don't allow cell selection
      // (user is trying to add to connection selection but missed the wire)
      const hasConnectionSelection = connState.selected_connections?.length > 0
      const ctrl = event.ctrlKey || event.metaKey
      const shift = event.shiftKey
      if ((ctrl || shift) && hasConnectionSelection) {
        // Don't proceed to cell selection - just return
        return
      }
    }
    
    // Clear connection selection when clicking elsewhere
    connState.selected_connections = []
    
    is_dragging = true

    const distance_from_block_center_x = Math.abs(2 * (Math.abs(x_raw - x) - 0.5))
    const distance_from_block_center_y = Math.abs(2 * (Math.abs(y_raw - y) - 0.5))
    const distance_from_block_center = Math.sqrt(distance_from_block_center_x ** 2 + distance_from_block_center_y ** 2)
    const near_center = distance_from_block_center <= 0.5

    const ctrl = event.ctrlKey
    const shift = event.shiftKey
    const ctrl_or_shift = ctrl || shift

    const selected = editor.ladder_selection?.ladder_id === ladderId ? editor.ladder_selection.selection : []
    const exists = selected.find(sel =>
      (sel.type === 'block' && sel.x === x && sel.y === y) ||
      (sel.type === 'area' && x >= sel.x && x < sel.x + sel.width && y >= sel.y && y < sel.y + sel.height)
    )

    let click_move = false
    if (!ctrl_or_shift && near_center && !exists) {
      // Select current block and start moving it
      const block = ladder.blocks.find(b => b.x === x && b.y === y)
      if (block) {
        editor.ladder_selection = {
          ladder_id: ladderId,
          program_id: ladder.program_id || '',
          origin: { x, y },
          selection: [{ type: 'block', x, y }]
        }
        click_move = true
      }
    }

    if (exists || click_move) {
      is_moving = true
      const elements = [...new Set(editor.ladder_selection.selection.map(sel => {
        if (sel.type === 'block') {
          return ladder.blocks.find(b => b.x === sel.x && b.y === sel.y)
        }
        if (sel.type === 'area') {
          return ladder.blocks.filter(b => b.x >= sel.x && b.x < sel.x + sel.width && b.y >= sel.y && b.y < sel.y + sel.height)
        }
        return null
      }).flat().filter(Boolean))]
      moving_elements = elements
      // Store original positions for ESC cancel
      moving_original_positions = elements.map(b => ({ id: b.id, x: b.x, y: b.y }))
      moving_original_selection = JSON.parse(JSON.stringify(editor.ladder_selection))
      // Store the offset from click position to origin - this offset is preserved during entire drag
      move_offset_x = editor.ladder_selection.origin.x - x
      move_offset_y = editor.ladder_selection.origin.y - y
    }
  }

  /** @param { MouseEvent } event */
  const onMove = (event) => {
    event.preventDefault()
    
    // If operation was cancelled by ESC, ignore all mouse movement until released
    if (operation_cancelled) return
    
    const rect = canvas.getBoundingClientRect()
    const mouseX = Math.floor(event.clientX - rect.left)
    const mouseY = Math.floor(event.clientY - rect.top)
    
    // Always track hover position for connection handles (even when not dragging)
    const live = editor.device_manager.connected && !!editor.window_manager?.isMonitoringActive?.()
    const edit = !live
    
    // Handle diagnostic tooltip
    const diagTooltip = ladder.props?.diagTooltip
    if (diagTooltip) {
      const diagnostics = ladder.props?.diagnostics || []
      const nodes = ladder.nodes || ladder.blocks || []
      const blockWidth = getBlockWidth()
      const blockHeight = getBlockHeight()
      const cellX = Math.floor(mouseX * getScale() / blockWidth)
      const cellY = Math.floor(mouseY * getScale() / blockHeight)
      
      // Find diagnostics at this cell - resolve token positions
      const cellDiags = diagnostics.filter(d => {
        let diagX = d.fallbackCellX ?? 0
        let diagY = d.fallbackCellY ?? 0
        
        if (d.token && !d.token.match(/^c\[\d+\]$/)) {
          // Token is a node ID - find current position
          const node = nodes.find(n => n.id === d.token)
          if (node) {
            diagX = node.x
            diagY = node.y
          }
        }
        
        return diagX === cellX && diagY === cellY
      })
      
      if (cellDiags.length > 0) {
        // Sort diagnostics: errors first, then warnings
        cellDiags.sort((a, b) => {
          if (a.type === 'error' && b.type !== 'error') return -1
          if (a.type !== 'error' && b.type === 'error') return 1
          return 0
        })
        
        // Build tooltip content
        const messages = cellDiags.map(d => {
          const icon = d.type === 'error' ? '⛔' : '⚠️'
          return `${icon} ${d.message}`
        }).join('\n')
        
        diagTooltip.textContent = messages
        diagTooltip.style.display = 'block'
        diagTooltip.style.left = (mouseX + 10) + 'px'
        diagTooltip.style.top = (mouseY + 10) + 'px'
      } else {
        diagTooltip.style.display = 'none'
      }
    }
    
    if (edit) {
      const hover_x_raw = mouseX * getScale() / getBlockWidth()
      const hover_y_raw = mouseY * getScale() / getBlockHeight()
      connState.hover_x = hover_x_raw
      connState.hover_y = hover_y_raw
      
      // Detect hovered connections (only when not dragging wire or blocks)
      if (!connState.dragging_wire && !is_dragging && !is_moving) {
        const clickGridX = (mouseX * getScale()) / getBlockWidth()
        const clickGridY = (mouseY * getScale()) / getBlockHeight()
        const connectionHit = findConnectionAtPoint(editor, ladder, clickGridX, clickGridY)
        connState.hovered_connections = connectionHit?.pairs || []
      } else {
        connState.hovered_connections = []
      }
      
      // If dragging a connection wire, update the end position with snapping
      if (connState.dragging_wire) {
        const rawEndX = mouseX * getScale()
        const rawEndY = mouseY * getScale()
        
        // Check for snapping to valid target handles
        const startBlock = connState.wire_start_block
        const startSide = connState.wire_start_side
        const snapDistance = 20 // Distance in pixels to snap
        
        let snappedX = rawEndX
        let snappedY = rawEndY
        let snappedBlock = null
        
        // Find the closest valid target handle
        // Wire coordinates are in canvas space (after * getScale()), 
        // and canvas uses ladder_block_width/height directly
        const blockWidth = getBlockWidth()
        const blockHeight = getBlockHeight()
        
        // Build a set of existing connections from/to the start block
        const existingConnections = new Set()
        const connections = ladder.connections || []
        for (const conn of connections) {
          if (conn.sources && conn.destinations) {
            if (conn.sources.includes(startBlock.id)) {
              conn.destinations.forEach(d => existingConnections.add(d))
            }
            if (conn.destinations.includes(startBlock.id)) {
              conn.sources.forEach(s => existingConnections.add(s))
            }
          } else if (conn.from && conn.to) {
            if (conn.from.id === startBlock.id) existingConnections.add(conn.to.id)
            if (conn.to.id === startBlock.id) existingConnections.add(conn.from.id)
          }
        }
        
        // Use centralized connection segments from path routing system
        const segments = getConnectionSegments(editor, ladder)
        
        ladder.blocks.forEach(b => {
          if (b.id === startBlock.id) return
          
          // Skip blocks already connected to the origin
          if (existingConnections.has(b.id)) return
          
          const y_mid = b.y * blockHeight + blockHeight / 2
          
          // When dragging from RIGHT side: startBlock is SOURCE, looking for DESTINATIONS to the right
          if (startSide === 'right' && b.x > startBlock.x) {
            if (!isConnectionPathClear(startBlock, b, ladder.blocks, segments)) return
            
            const targetX = b.x * blockWidth
            const dist = Math.sqrt((rawEndX - targetX) ** 2 + (rawEndY - y_mid) ** 2)
            if (dist < snapDistance) {
              snappedX = targetX
              snappedY = y_mid
              snappedBlock = b
            }
          }
          
          // When dragging from LEFT side: startBlock is DESTINATION, looking for SOURCES to the left
          if (startSide === 'left' && b.x < startBlock.x) {
            if (!isConnectionPathClear(b, startBlock, ladder.blocks, segments)) return
            
            const targetX = (b.x + 1) * blockWidth
            const dist = Math.sqrt((rawEndX - targetX) ** 2 + (rawEndY - y_mid) ** 2)
            if (dist < snapDistance) {
              snappedX = targetX
              snappedY = y_mid
              snappedBlock = b
            }
          }
        })
        
        connState.wire_end_x = snappedX
        connState.wire_end_y = snappedY
        connState.snapped_block = snappedBlock
        canvas.style.cursor = snappedBlock ? 'pointer' : 'default'
        ladderRenderer.render(editor, ladder)
        return
      }
      
      // Check if hovering over connection handles of the origin block
      const selection = editor.ladder_selection
      const hasSelection = selection && selection.ladder_id === ladderId && selection.selection?.length > 0 && selection.origin
      let hoveringHandle = false
      
      if (hasSelection) {
        const originX = selection.origin.x
        const originY = selection.origin.y
        const originBlock = ladder.blocks.find(b => b.x === originX && b.y === originY)
        
        if (originBlock) {
          const blockWidth = getBlockWidth()
          const blockHeight = getBlockHeight()
          
          // Mouse position in canvas coordinates (scaled)
          const mouseCanvasX = mouseX * getScale()
          const mouseCanvasY = mouseY * getScale()
          
          const leftHandleX = originX * blockWidth
          const rightHandleX = (originX + 1) * blockWidth
          const handleY = originY * blockHeight + blockHeight / 2
          
          const handleRadius = 8 // pixels in canvas space
          const hoverRadius = handleRadius * 2 // detection radius
          
          const distToLeftHandle = Math.sqrt((mouseCanvasX - leftHandleX) ** 2 + (mouseCanvasY - handleY) ** 2)
          const distToRightHandle = Math.sqrt((mouseCanvasX - rightHandleX) ** 2 + (mouseCanvasY - handleY) ** 2)
          
          if (distToLeftHandle < hoverRadius || distToRightHandle < hoverRadius) {
            hoveringHandle = true
          }
        }
      }
      
      // Check if hovering over a connection
      const hoveringConnection = connState.hovered_connections?.length > 0
      
      canvas.style.cursor = (hoveringHandle || hoveringConnection) ? 'pointer' : 'default'
      
      // Trigger redraw to show/hide connection handles
      ladderRenderer.render(editor, ladder)
    }
    
    if (!is_dragging) return

    end_x = mouseX
    end_y = mouseY

    const distance_x = Math.abs(end_x - start_x)
    const distance_y = Math.abs(end_y - start_y)
    const distance = Math.sqrt(distance_x ** 2 + distance_y ** 2)
    if (distance < 10) return // Don't start dragging until the distance is greater than 10

    if (is_moving) {
      // Move the selection - always compute absolute target position
      // Calculate current cursor cell position
      const cursor_x_block = Math.floor(end_x * getScale() / getBlockWidth())
      const cursor_y_block = Math.floor(end_y * getScale() / getBlockHeight())
      
      // Target origin = cursor + offset (offset was computed at drag start)
      let target_origin_x = cursor_x_block + move_offset_x
      let target_origin_y = cursor_y_block + move_offset_y
      
      // Calculate the bounds of all moving elements to prevent moving into negative
      let minX = Infinity, minY = Infinity
      for (const b of moving_elements) {
        if (!b) continue
        if (b.x < minX) minX = b.x
        if (b.y < minY) minY = b.y
      }
      
      // Calculate how far min element is from current origin
      const current_origin_x = editor.ladder_selection.origin.x
      const current_origin_y = editor.ladder_selection.origin.y
      const minOffsetX = minX - current_origin_x
      const minOffsetY = minY - current_origin_y
      
      // Clamp target origin so no element goes into negative
      // minElement's new position = target_origin + minOffset >= 0
      // target_origin >= -minOffset
      if (target_origin_x + minOffsetX < 0) {
        target_origin_x = -minOffsetX
      }
      if (target_origin_y + minOffsetY < 0) {
        target_origin_y = -minOffsetY
      }
      
      // Calculate delta from current to target
      let dx = target_origin_x - current_origin_x
      let dy = target_origin_y - current_origin_y
      
      // Skip if no movement
      if (dx === 0 && dy === 0) return

      // Check if the new positions would overlap with any non-moving blocks
      const movingIds = new Set(moving_elements.filter(b => b).map(b => b.id))
      const nonMovingBlocks = ladder.blocks.filter(b => !movingIds.has(b.id))
      
      // Calculate proposed new positions for all moving elements
      const proposedPositions = moving_elements.filter(b => b).map(b => ({
        id: b.id,
        x: b.x + dx,
        y: b.y + dy
      }))
      
      // Check for collisions with non-moving blocks
      const hasCollision = proposedPositions.some(pos => 
        nonMovingBlocks.some(b => b.x === pos.x && b.y === pos.y)
      )
      
      // If there's a collision, don't apply the move
      if (hasCollision) return
      
      // Check connection constraints - connections cannot go backwards
      // If a moving block connects TO a non-moving block, moving block must stay to the left (X < target X)
      // If a non-moving block connects TO a moving block, moving block must stay to the right (X > source X)
      const legacyConns = getLegacyConnections(ladder)
      const hasConnectionViolation = proposedPositions.some(pos => {
        // Find connections where this moving block is the source (connects TO something)
        const outgoingToNonMoving = legacyConns.filter(c => 
          c.from.id === pos.id && !movingIds.has(c.to.id)
        )
        // Moving block must have X < target's X (stay to the left)
        for (const conn of outgoingToNonMoving) {
          const targetBlock = nonMovingBlocks.find(b => b.id === conn.to.id)
          if (targetBlock && pos.x >= targetBlock.x) return true
        }
        
        // Find connections where this moving block is the target (something connects TO it)
        const incomingFromNonMoving = legacyConns.filter(c => 
          c.to.id === pos.id && !movingIds.has(c.from.id)
        )
        // Moving block must have X > source's X (stay to the right)
        for (const conn of incomingFromNonMoving) {
          const sourceBlock = nonMovingBlocks.find(b => b.id === conn.from.id)
          if (sourceBlock && pos.x <= sourceBlock.x) return true
        }
        
        return false
      })
      
      // If connection constraint is violated, don't apply the move
      if (hasConnectionViolation) return

      const selected = editor.ladder_selection?.ladder_id === ladderId ? editor.ladder_selection.selection : []
      for (const sel of selected) {
        if (sel.type === 'block') {
          sel.x += dx
          sel.y += dy
        }
        if (sel.type === 'area') {
          sel.x += dx
          sel.y += dy
        }
      }
      editor.ladder_selection.origin.x += dx
      editor.ladder_selection.origin.y += dy

      moving_elements.forEach(b => {
        if (!b) return
        b.x += dx
        b.y += dy
      })
      // Trigger redraw after moving elements
      ladderRenderer.render(editor, ladder)
      return
    }

    // Calculate selection area - support dragging in any direction
    const cellStartX = Math.floor(start_x * getScale() / getBlockWidth())
    const cellStartY = Math.floor(start_y * getScale() / getBlockHeight())
    const cellEndX = Math.floor(end_x * getScale() / getBlockWidth())
    const cellEndY = Math.floor(end_y * getScale() / getBlockHeight())
    
    // Normalize to get top-left corner and dimensions
    const x = Math.min(cellStartX, cellEndX)
    const y = Math.min(cellStartY, cellEndY)
    const width = Math.abs(cellEndX - cellStartX) + 1
    const height = Math.abs(cellEndY - cellStartY) + 1

    // Update selection area - origin is always where the drag started (primary selection cell)
    const ctrl = event.ctrlKey
    const shift = event.shiftKey
    const ctrl_or_shift = ctrl || shift
    
    // If SHIFT is held and there are selected connections, don't modify cell selection
    const hasConnectionSelection = connState.selected_connections?.length > 0
    if (ctrl_or_shift && hasConnectionSelection) {
      // Skip cell selection when adding to connection selection
      return
    }
    
    if (ctrl_or_shift && editor.ladder_selection?.ladder_id === ladderId) {
      const exists = editor.ladder_selection.selection.find(sel => sel.type === 'area' && sel.x === x && sel.y === y)
      if (exists && exists.type === 'area') {
        exists.width = width
        exists.height = height
      } else {
        // Keep origin at the starting cell, not normalized top-left
        editor.ladder_selection.selection.push({ type: 'area', x, y, width, height })
      }
      // Update cursor to current drag end position
      editor.ladder_selection.cursor = { x: cellEndX, y: cellEndY }
    } else {
      // Capture previous ladder ID before changing selection
      const prevLadderId = editor.ladder_selection?.ladder_id
      // Set new selection first
      editor.ladder_selection = {
        ladder_id: ladderId,
        program_id: ladder.program_id || '',
        origin: { x: cellStartX, y: cellStartY }, // Origin is where drag started
        cursor: { x: cellEndX, y: cellEndY }, // Cursor is where drag ended
        selection: [{ type: 'area', x, y, width, height }]
      }
      // Now re-render the previous ladder to clear its selection (after selection changed)
      if (prevLadderId && prevLadderId !== ladderId && editor.ladder_render_registry?.[prevLadderId]) {
        editor.ladder_render_registry[prevLadderId]()
      }
    }
    // Trigger redraw to show selection area
    ladderRenderer.render(editor, ladder)
  }

  const onRelease = () => {
    // Handle connection wire drop
    if (connState.dragging_wire) {
      const startBlock = connState.wire_start_block
      const startSide = connState.wire_start_side
      const snappedBlock = connState.snapped_block
      
      // Only use snapped block - this ensures we only connect to valid targets
      // The snapping logic already validates: same row, not already connected, no crossing
      let targetBlock = snappedBlock
      let targetSide = null
      
      if (snappedBlock) {
        // Determine target side based on start side
        targetSide = startSide === 'right' ? 'left' : 'right'
      }
      // No fallback - if not snapped to a valid target, don't create connection
      
      if (targetBlock && targetBlock.id !== startBlock.id) {
        // Determine which block is source and which is destination based on drag direction
        let fromBlock, toBlock
        
        if (startSide === 'right') {
          // Dragging from right side: startBlock is source, targetBlock is destination
          fromBlock = startBlock
          toBlock = targetBlock
        } else {
          // Dragging from left side: targetBlock is source, startBlock is destination
          fromBlock = targetBlock
          toBlock = startBlock
        }
        
        // Destination must be strictly to the right of source (power flows left to right)
        const validDirection = fromBlock && toBlock && (toBlock.x > fromBlock.x)
        
        if (validDirection) {
          // Check if connection already exists (handle both formats)
          const legacyConns = getLegacyConnections(ladder)
          const exists = legacyConns.some(c => 
            c.from.id === fromBlock.id && c.to.id === toBlock.id
          )
          
          if (!exists) {
            // Create new connection in grouped format
            ladder.connections.push({
              id: editor._generateID(),
              sources: [fromBlock.id],
              destinations: [toBlock.id]
            })
          }
        }
      }
      
      // Reset connection wire state
      connState.dragging_wire = false
      connState.wire_start_block = null
      connState.wire_start_side = null
      connState.snapped_block = null
      was_dragging_wire = true
      canvas.style.cursor = 'default'
      ladderRenderer.render(editor, ladder)
      triggerLint() // Trigger lint after wire connection
      return
    }
    
    is_dragging = false
    was_dragging = true

    // Reset cancelled flag on mouse release
    if (operation_cancelled) {
      operation_cancelled = false
      return // Don't do anything else after a cancelled operation
    }

    // Update after moving blocks (no auto-connect on move)
    if (is_moving) {
      is_moving = false
      // Trigger redraw after moving blocks
      ladderRenderer.render(editor, ladder)
      triggerLint() // Trigger lint after moving blocks
      moving_elements = []
      moving_original_positions = [] // Clear saved positions on successful move
      moving_original_selection = null
    }
  }

  /** @param { MouseEvent } event */
  const onClick = (event) => {
    // Focus the canvas to ensure keyboard shortcuts work
    canvas.focus()

    // Prevent click event after wire drag
    if (was_dragging_wire) {
      was_dragging_wire = false
      return
    }
    
    // Skip click handler if we just selected a connection
    if (connState.just_selected_connection) {
      connState.just_selected_connection = false
      return
    }

    if (was_dragging) {
      was_dragging = false
      const distance_x = Math.abs(end_x - start_x)
      const distance_y = Math.abs(end_y - start_y)
      const distance = Math.sqrt(distance_x ** 2 + distance_y ** 2)
      if (distance > 10) return // Prevent click event after dragging
    }

    const scale = getScale()
    const x = Math.floor(event.offsetX * scale / getBlockWidth())
    const y = Math.floor(event.offsetY * scale / getBlockHeight())

    const live = editor.device_manager.connected && !!editor.window_manager?.isMonitoringActive?.()

    // Pill click is read-only in live mode - no toggle on single click
    // Double-click opens context menu instead (handled in onDblClick)

    const ctrl = event.ctrlKey
    const shift = event.shiftKey
    
    // If SHIFT is held and there are selected connections, don't modify cell selection
    const hasConnectionSelection = connState.selected_connections?.length > 0
    if ((shift || ctrl) && hasConnectionSelection) {
      // Skip cell selection when adding to connection selection
      ladderRenderer.render(editor, ladder)
      return
    }
    
    if (shift && editor.ladder_selection?.ladder_id === ladderId) {
      // SHIFT+click: Extend selection from origin to clicked cell
      const origin = editor.ladder_selection.origin || { x, y }
      const minX = Math.min(origin.x, x)
      const maxX = Math.max(origin.x, x)
      const minY = Math.min(origin.y, y)
      const maxY = Math.max(origin.y, y)
      const width = maxX - minX + 1
      const height = maxY - minY + 1
      
      editor.ladder_selection.selection = [{ type: 'area', x: minX, y: minY, width, height }]
      // Set cursor to clicked position
      editor.ladder_selection.cursor = { x, y }
    } else if (ctrl && editor.ladder_selection?.ladder_id === ladderId) {
      // CTRL+click: Toggle individual block in selection
      const exists = editor.ladder_selection.selection.some(sel => sel.type === 'block' && sel.x === x && sel.y === y)
      if (exists) {
        // Remove selected block
        editor.ladder_selection.selection = editor.ladder_selection.selection.filter(sel => !(sel.type === 'block' && sel.x === x && sel.y === y))
      } else {
        editor.ladder_selection.selection.push({ type: 'block', x, y })
      }
    } else {
      // Normal click: Start new selection at clicked cell
      // Clear connection selection when starting a new cell selection
      connState.selected_connections = []
      
      editor.ladder_selection = {
        ladder_id: ladderId,
        program_id: ladder.program_id || '',
        origin: { x, y },
        cursor: { x, y }, // Cursor starts at origin
        selection: [{ type: 'block', x, y }]
      }
    }
    // Trigger redraw to show selection
    ladderRenderer.render(editor, ladder)
  }

  /** @param { MouseEvent } event */
  const onDblClick = (event) => {
    const live = editor.device_manager.connected && !!editor.window_manager?.isMonitoringActive?.()
    const scale = getScale()
    const x = Math.floor(event.offsetX * scale / getBlockWidth())
    const y = Math.floor(event.offsetY * scale / getBlockHeight())
    const block = ladder.blocks.find(b => b.x === x && b.y === y)

    if (live) {
      // Live Mode: Open context menu on double-click (like right-click)
      if (block) {
        // Dispatch a contextmenu event to trigger the context menu
        const contextEvent = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          button: 2
        })
        canvas.dispatchEvent(contextEvent)
      }
    } else {
      // Edit Mode: Open Symbol Prompt
      if (block) {
        const isTimer = ['timer_ton', 'timer_tof', 'timer_tp'].includes(block.type)
        const isCounter = ['counter_u', 'counter_d', 'counter_ctu', 'counter_ctd', 'counter_ctud'].includes(block.type)
        const isFB = isFunctionBlock(block.type)
        if (isTimer) {
          promptForTimerParameters(editor, block, ladder)
        } else if (isCounter) {
          promptForCounterParameters(editor, block, ladder)
        } else if (isFB) {
          promptForFunctionBlockParameters(editor, block, ladder)
        } else {
          promptForSymbol(editor, block, ladder)
        }
      }
    }
  }

  // Mouse event listeners
  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMove)
  canvas.addEventListener('mouseup', onRelease)
  canvas.addEventListener('click', onClick)
  canvas.addEventListener('dblclick', onDblClick)
  
  // Reset hover state when mouse leaves canvas
  canvas.addEventListener('mouseleave', () => {
    connState.hover_x = -1
    connState.hover_y = -1
    if (connState.dragging_wire) {
      // Cancel wire drag if mouse leaves canvas
      connState.dragging_wire = false
      connState.wire_start_block = null
      connState.wire_start_side = null
    }
    // Hide diagnostic tooltip
    const diagTooltip = ladder.props?.diagTooltip
    if (diagTooltip) {
      diagTooltip.style.display = 'none'
    }
    ladderRenderer.render(editor, ladder)
  })

  // Touch event handlers
  let last_touched = {}

  canvas.addEventListener('touchstart', event => {
    const live = editor.device_manager.connected && !!editor.window_manager?.isMonitoringActive?.()
    const edit = !live
    if (!edit) return
    const touch = event.touches[0]
    last_touched = {
      clientX: touch.clientX,
      clientY: touch.clientY
    }
    const mouse_event = new MouseEvent('mousedown', last_touched)
    onMouseDown(mouse_event)
  })

  canvas.addEventListener('touchmove', event => {
    const live = editor.device_manager.connected && !!editor.window_manager?.isMonitoringActive?.()
    const edit = !live
    if (!edit) return
    if (!is_dragging) return
    event.preventDefault()
    const touch = event.touches[0]
    last_touched = {
      clientX: touch.clientX,
      clientY: touch.clientY
    }
    const mouse_event = new MouseEvent('mousemove', last_touched)
    onMove(mouse_event)
  })

  canvas.addEventListener('touchend', event => {
    const live = editor.device_manager.connected && !!editor.window_manager?.isMonitoringActive?.()
    const edit = !live
    if (!edit) return
    event.preventDefault()
    last_touched = {}
    // onRelease handles is_moving and re-render (no auto-connect on move)
    onRelease()
    was_dragging = false
  })

  // Context menu integration
  if (editor.context_manager) {
    let contextMenuX = 0
    let contextMenuY = 0

    // @ts-ignore - canvas type and menu return type are compatible at runtime
    editor.context_manager.addListener({
      // @ts-ignore
      target: canvas,
      // @ts-ignore
      onOpen: (event) => {
        const rect = canvas.getBoundingClientRect()
        contextMenuX = Math.floor((event.clientX - rect.left) * getScale() / getBlockWidth())
        contextMenuY = Math.floor((event.clientY - rect.top) * getScale() / getBlockHeight())

        const selected = editor.ladder_selection?.ladder_id === ladderId ? editor.ladder_selection.selection : []
        const live = editor.device_manager.connected && !!editor.window_manager?.isMonitoringActive?.()
        const edit = !live

        // Check if there's already a block at this position
        const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
        const has_element = blockAtPosition || ladder.blocks.find(b => selected.find(sel => sel.type === 'block' && sel.x === b.x && sel.y === b.y))
          || ladder.blocks.find(b => selected.find(sel => sel.type === 'area' && sel.x <= b.x && sel.x + sel.width > b.x && sel.y <= b.y && sel.y + sel.height > b.y))

        const state = has_element?.state
        const symbol = state?.symbol
        selected_for_toggle = symbol

        // Build menu items
        const menuItems = []

        // Live mode toggle options (only if there's a symbol)
        if (live && typeof symbol !== 'undefined') {
          menuItems.push(
            { type: 'item', name: 'toggle', label: 'Toggle' },
            { type: 'item', name: 'set_on', label: 'Set ON' },
            { type: 'item', name: 'set_off', label: 'Set OFF' },
            { type: 'separator' }
          )
        }

        // Add Focus to canvas so shortcuts work immediately after right click interaction
        canvas.focus()

        // Edit mode: Insert submenu (only if no block at position)
        if (edit && !blockAtPosition) {
          menuItems.push(
            {
              type: 'submenu', name: 'insert', label: 'Insert', items: [
                {
                  type: 'submenu', name: 'insert_contacts', label: 'Contacts', className: `plc-icon ${getIconType('ladder-contact')}`, items: [
                    { type: 'item', name: 'insert_contact', label: 'Contact (NO)' },
                    { type: 'item', name: 'insert_contact_nc', label: 'Contact (NC)' },
                    { type: 'item', name: 'insert_contact_rising', label: 'Rising Edge (P)' },
                    { type: 'item', name: 'insert_contact_falling', label: 'Falling Edge (N)' },
                  ]
                },
                {
                  type: 'submenu', name: 'insert_coils', label: 'Coils', className: `plc-icon ${getIconType('ladder-coil')}`, items: [
                    { type: 'item', name: 'insert_coil', label: 'Coil (=)' },
                    { type: 'item', name: 'insert_coil_inverted', label: 'Inverted Coil (/)' },
                    { type: 'item', name: 'insert_coil_set', label: 'Set Coil (S)' },
                    { type: 'item', name: 'insert_coil_reset', label: 'Reset Coil (R)' },
                  ]
                },
                {
                  type: 'submenu', name: 'insert_timers', label: 'Timers', className: `plc-icon ${getIconType('ladder-timer')}`, items: [
                    { type: 'item', name: 'insert_timer_ton', label: 'TON (On Delay)' },
                    { type: 'item', name: 'insert_timer_tof', label: 'TOF (Off Delay)' },
                    { type: 'item', name: 'insert_timer_tp', label: 'TP (Pulse)' },
                  ]
                },
                {
                  type: 'submenu', name: 'insert_counters', label: 'Counters', className: `plc-icon ${getIconType('ladder-counter')}`, items: [
                    { type: 'item', name: 'insert_counter_u', label: 'CTU (Count Up)' },
                    { type: 'item', name: 'insert_counter_d', label: 'CTD (Count Down)' },
                  ]
                },
                {
                  type: 'submenu', name: 'insert_math', label: 'Math Operations', className: `plc-icon ${getIconType('ladder-math')}`, items: [
                    { type: 'item', name: 'insert_fb_add', label: 'ADD (Addition)' },
                    { type: 'item', name: 'insert_fb_sub', label: 'SUB (Subtraction)' },
                    { type: 'item', name: 'insert_fb_mul', label: 'MUL (Multiply)' },
                    { type: 'item', name: 'insert_fb_div', label: 'DIV (Divide)' },
                    { type: 'item', name: 'insert_fb_mod', label: 'MOD (Modulo)' },
                    { type: 'separator' },
                    { type: 'item', name: 'insert_fb_neg', label: 'NEG (Negate)' },
                    { type: 'item', name: 'insert_fb_abs', label: 'ABS (Absolute)' },
                    { type: 'item', name: 'insert_fb_inc', label: 'INC (Increment)' },
                    { type: 'item', name: 'insert_fb_dec', label: 'DEC (Decrement)' },
                  ]
                },
                {
                  type: 'submenu', name: 'insert_compare', label: 'Compare Operations', className: `plc-icon ${getIconType('ladder-compare')}`, items: [
                    { type: 'item', name: 'insert_fb_cmp_eq', label: 'EQ (Equal)' },
                    { type: 'item', name: 'insert_fb_cmp_neq', label: 'NEQ (Not Equal)' },
                    { type: 'item', name: 'insert_fb_cmp_gt', label: 'GT (Greater Than)' },
                    { type: 'item', name: 'insert_fb_cmp_lt', label: 'LT (Less Than)' },
                    { type: 'item', name: 'insert_fb_cmp_gte', label: 'GTE (Greater or Equal)' },
                    { type: 'item', name: 'insert_fb_cmp_lte', label: 'LTE (Less or Equal)' },
                  ]
                },
                {
                  type: 'submenu', name: 'insert_move', label: 'Move/Transfer', className: `plc-icon ${getIconType('ladder-move')}`, items: [
                    { type: 'item', name: 'insert_fb_move', label: 'MOVE (Transfer)' },
                  ]
                },
              ]
            },
            { type: 'separator' }
          )
        }

        // Edit mode: Modify existing block
        if (edit && blockAtPosition) {
          const isCoil = blockAtPosition.type === 'coil' || blockAtPosition.type === 'coil_set' || blockAtPosition.type === 'coil_rset'
          const isContact = blockAtPosition.type === 'contact'
          const isTimer = blockAtPosition.type === 'timer_ton' || blockAtPosition.type === 'timer_tof' || blockAtPosition.type === 'timer_tp'
          const isCounter = ['counter_u', 'counter_d', 'counter_ctu', 'counter_ctd', 'counter_ctud'].includes(blockAtPosition.type)
          const isFB = isFunctionBlock(blockAtPosition.type)

          // Show different edit option based on block type
          if (isTimer) {
            const timerTypeLabels = {
              'timer_ton': 'TON',
              'timer_tof': 'TOF',
              'timer_tp': 'TP'
            }
            const timerLabel = timerTypeLabels[blockAtPosition.type] || 'Timer'
            menuItems.push(
              { type: 'item', name: 'edit_timer', label: `Edit ${timerLabel}...` }
            )
          } else if (isCounter) {
            const counterTypeLabels = {
              'counter_u': 'CTU',
              'counter_d': 'CTD',
              'counter_ctu': 'CTU',
              'counter_ctd': 'CTD',
              'counter_ctud': 'CTUD'
            }
            const counterLabel = counterTypeLabels[blockAtPosition.type] || 'Counter'
            menuItems.push(
              { type: 'item', name: 'edit_counter', label: `Edit ${counterLabel}...` }
            )
          } else if (isFB) {
            const fbLabel = getFunctionBlockLabel(blockAtPosition.type)
            menuItems.push(
              { type: 'item', name: 'edit_function_block', label: `Edit ${fbLabel}...` }
            )
          } else {
            menuItems.push(
              { type: 'item', name: 'edit_symbol', label: 'Edit Symbol...' }
            )
          }

          // Contact-specific options
          if (isContact) {
            menuItems.push(
              { type: 'item', name: 'toggle_inverted', label: blockAtPosition.inverted ? 'Make Normal (NO)' : 'Make Inverted (NC)' },
              {
                type: 'submenu', name: 'change_trigger', label: 'Trigger Type', items: [
                  { type: 'item', name: 'trigger_normal', label: 'Normal', className: blockAtPosition.trigger === 'normal' ? 'selected' : '' },
                  { type: 'item', name: 'trigger_rising', label: 'Rising Edge', className: blockAtPosition.trigger === 'rising' ? 'selected' : '' },
                  { type: 'item', name: 'trigger_falling', label: 'Falling Edge', className: blockAtPosition.trigger === 'falling' ? 'selected' : '' },
                  { type: 'item', name: 'trigger_change', label: 'Any Change', className: blockAtPosition.trigger === 'change' ? 'selected' : '' },
                ]
              }
            )
          }

          // Coil-specific options
          if (isCoil) {
            menuItems.push(
              { type: 'item', name: 'toggle_inverted', label: blockAtPosition.inverted ? 'Make Normal' : 'Make Inverted (/)' },
              {
                type: 'submenu', name: 'change_coil_type', label: 'Coil Type', items: [
                  { type: 'item', name: 'coil_type_assign', label: 'Assign (=)', className: blockAtPosition.type === 'coil' ? 'selected' : '' },
                  { type: 'item', name: 'coil_type_set', label: 'Set (S)', className: blockAtPosition.type === 'coil_set' ? 'selected' : '' },
                  { type: 'item', name: 'coil_type_reset', label: 'Reset (R)', className: blockAtPosition.type === 'coil_rset' ? 'selected' : '' },
                ]
              }
            )
          }

          // Timer-specific options
          if (isTimer) {
            menuItems.push(
              {
                type: 'submenu', name: 'change_timer_type', label: 'Timer Type', items: [
                  { type: 'item', name: 'timer_type_ton', label: 'TON (On Delay)', className: blockAtPosition.type === 'timer_ton' ? 'selected' : '' },
                  { type: 'item', name: 'timer_type_tof', label: 'TOF (Off Delay)', className: blockAtPosition.type === 'timer_tof' ? 'selected' : '' },
                  { type: 'item', name: 'timer_type_tp', label: 'TP (Pulse)', className: blockAtPosition.type === 'timer_tp' ? 'selected' : '' },
                ]
              }
            )
          }

          // Counter-specific options
          if (isCounter) {
            menuItems.push(
              {
                type: 'submenu', name: 'change_counter_type', label: 'Counter Type', items: [
                  { type: 'item', name: 'counter_type_ctu', label: 'CTU (Count Up)', className: (blockAtPosition.type === 'counter_u' || blockAtPosition.type === 'counter_ctu') ? 'selected' : '' },
                  { type: 'item', name: 'counter_type_ctd', label: 'CTD (Count Down)', className: (blockAtPosition.type === 'counter_d' || blockAtPosition.type === 'counter_ctd') ? 'selected' : '' },
                ]
              }
            )
          }

          menuItems.push({ type: 'separator' })
        }

        // Edit mode: Delete, Cut, Copy, Paste
        if (edit && (selected.length > 0 || blockAtPosition)) {
          menuItems.push(
            { type: 'item', name: 'delete', label: 'Delete', className: `plc-icon ${getIconType('delete')}` },
            { type: 'separator' },
            { type: 'item', name: 'cut', label: 'Cut', className: `plc-icon ${getIconType('cut')}` },
            { type: 'item', name: 'copy', label: 'Copy', className: `plc-icon ${getIconType('copy')}` }
          )
        }

        if (edit) {
          menuItems.push({ type: 'item', name: 'paste', label: 'Paste', className: `plc-icon ${getIconType('paste')}` })
        }

        menuItems.push(
          { type: 'separator' },
          { type: 'item', name: 'properties', label: 'Properties' }
        )

        return menuItems
      },
      onClose: (selected_action) => {
        const modify = ['toggle', 'set_on', 'set_off'].includes(selected_action)
        if (modify && typeof selected_for_toggle !== 'undefined') {
          const value = !!getSymbolValue(editor, selected_for_toggle)
          const new_value = selected_action === 'toggle' ? !value : selected_action === 'set_on' ? true : selected_action === 'set_off' ? false : value
          setSymbolBit(editor, selected_for_toggle, new_value)
        }

        // Handle insert actions
        if (selected_action?.startsWith('insert_')) {
          /** @type {any} */
          const newBlock = {
            id: editor._generateID(),
            x: contextMenuX,
            y: contextMenuY,
            type: 'contact',
            inverted: false,
            trigger: 'normal',
            symbol: '',
            preset: 1000 // Default preset for timers/counters
          }

          if (selected_action === 'insert_contact') {
            newBlock.type = 'contact'
            newBlock.inverted = false
          } else if (selected_action === 'insert_contact_nc') {
            newBlock.type = 'contact'
            newBlock.inverted = true
          } else if (selected_action === 'insert_contact_rising') {
            newBlock.type = 'contact'
            newBlock.inverted = false
            newBlock.trigger = 'rising'
          } else if (selected_action === 'insert_contact_falling') {
            newBlock.type = 'contact'
            newBlock.inverted = false
            newBlock.trigger = 'falling'
          } else if (selected_action === 'insert_coil') {
            newBlock.type = 'coil'
          } else if (selected_action === 'insert_coil_inverted') {
            newBlock.type = 'coil'
            newBlock.inverted = true
          } else if (selected_action === 'insert_coil_set') {
            newBlock.type = 'coil_set'
          } else if (selected_action === 'insert_coil_reset') {
            newBlock.type = 'coil_rset'
          } else if (selected_action === 'insert_timer_ton') {
            newBlock.type = 'timer_ton'
          } else if (selected_action === 'insert_timer_tof') {
            newBlock.type = 'timer_tof'
          } else if (selected_action === 'insert_timer_tp') {
            newBlock.type = 'timer_tp'
          } else if (selected_action === 'insert_counter_u') {
            newBlock.type = 'counter_u'
          } else if (selected_action === 'insert_counter_d') {
            newBlock.type = 'counter_d'
          } else if (selected_action === 'insert_fb_add') {
            newBlock.type = 'fb_add'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_sub') {
            newBlock.type = 'fb_sub'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_mul') {
            newBlock.type = 'fb_mul'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_div') {
            newBlock.type = 'fb_div'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_mod') {
            newBlock.type = 'fb_mod'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_neg') {
            newBlock.type = 'fb_neg'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_abs') {
            newBlock.type = 'fb_abs'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_inc') {
            newBlock.type = 'fb_inc'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_dec') {
            newBlock.type = 'fb_dec'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_cmp_eq') {
            newBlock.type = 'fb_cmp_eq'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_cmp_neq') {
            newBlock.type = 'fb_cmp_neq'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_cmp_gt') {
            newBlock.type = 'fb_cmp_gt'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_cmp_lt') {
            newBlock.type = 'fb_cmp_lt'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_cmp_gte') {
            newBlock.type = 'fb_cmp_gte'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_cmp_lte') {
            newBlock.type = 'fb_cmp_lte'
            newBlock.dataType = 'i16'
          } else if (selected_action === 'insert_fb_move') {
            newBlock.type = 'fb_move'
            newBlock.dataType = 'i16'
          }

          ladder.nodes.push(newBlock)
          
          // Auto-connect the new block to adjacent blocks and split existing connections
          connectNewBlock(ladder, newBlock)

          // Select the new block
          editor.ladder_selection = {
            ladder_id: ladderId,
            program_id: ladder.program_id || '',
            origin: { x: contextMenuX, y: contextMenuY },
            selection: [{ type: 'block', x: contextMenuX, y: contextMenuY }]
          }

          // Prompt for symbol/parameters based on block type
          const isTimerBlock = ['timer_ton', 'timer_tof', 'timer_tp'].includes(newBlock.type)
          const isCounterBlock = ['counter_u', 'counter_d', 'counter_ctu', 'counter_ctd', 'counter_ctud'].includes(newBlock.type)
          const isFB = isFunctionBlock(newBlock.type)
          if (isTimerBlock) {
            // @ts-ignore - newBlock type is correct at runtime
            promptForTimerParameters(editor, newBlock, ladder)
          } else if (isCounterBlock) {
            // @ts-ignore - newBlock type is correct at runtime
            promptForCounterParameters(editor, newBlock, ladder)
          } else if (isFB) {
            // @ts-ignore - newBlock type is correct at runtime
            promptForFunctionBlockParameters(editor, newBlock, ladder)
          } else {
            // @ts-ignore - newBlock type is correct at runtime
            promptForSymbol(editor, newBlock, ladder)
          }
        }

        // Handle trigger change
        if (selected_action?.startsWith('trigger_')) {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            const trigger = selected_action.replace('trigger_', '')
            // @ts-ignore
            blockAtPosition.trigger = trigger
          }
        }

        // Handle coil type change
        if (selected_action?.startsWith('coil_type_')) {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            if (selected_action === 'coil_type_assign') {
              blockAtPosition.type = 'coil'
            } else if (selected_action === 'coil_type_set') {
              blockAtPosition.type = 'coil_set'
            } else if (selected_action === 'coil_type_reset') {
              blockAtPosition.type = 'coil_rset'
            }
          }
        }

        // Handle timer type change
        if (selected_action?.startsWith('timer_type_')) {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            if (selected_action === 'timer_type_ton') {
              blockAtPosition.type = 'timer_ton'
            } else if (selected_action === 'timer_type_tof') {
              blockAtPosition.type = 'timer_tof'
            } else if (selected_action === 'timer_type_tp') {
              blockAtPosition.type = 'timer_tp'
            }
          }
        }

        // Handle counter type change
        if (selected_action?.startsWith('counter_type_')) {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            if (selected_action === 'counter_type_ctu') {
              blockAtPosition.type = 'counter_u'
            } else if (selected_action === 'counter_type_ctd') {
              blockAtPosition.type = 'counter_d'
            }
          }
        }

        // Handle edit timer parameters
        if (selected_action === 'edit_timer') {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            promptForTimerParameters(editor, blockAtPosition, ladder)
          }
        }

        // Handle edit counter parameters
        if (selected_action === 'edit_counter') {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            promptForCounterParameters(editor, blockAtPosition, ladder)
          }
        }

        // Handle edit operation block parameters
        if (selected_action === 'edit_function_block') {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            promptForFunctionBlockParameters(editor, blockAtPosition, ladder)
          }
        }

        // Handle toggle inverted (for contacts and coils)
        if (selected_action === 'toggle_inverted') {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            blockAtPosition.inverted = !blockAtPosition.inverted
          }
        }

        // Handle edit symbol
        if (selected_action === 'edit_symbol') {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            promptForSymbol(editor, blockAtPosition, ladder)
          }
        }

        // Handle delete action
        if (selected_action === 'delete') {
          deleteSelection(editor, ladder, contextMenuX, contextMenuY)
        }

        // Handle copy action
        if (selected_action === 'copy') {
          copySelection(editor, ladder, contextMenuX, contextMenuY)
        }

        // Handle cut action
        if (selected_action === 'cut') {
          copySelection(editor, ladder, contextMenuX, contextMenuY)
          deleteSelection(editor, ladder, contextMenuX, contextMenuY)
        }

        // Handle paste action
        if (selected_action === 'paste') {
          pasteSelection(editor, ladder, contextMenuX, contextMenuY)
        }

        // Trigger redraw after any context menu action
        ladderRenderer.render(editor, ladder)
        
        // Trigger linting for structural changes (insert, delete, paste, cut, edit, toggle)
        const structuralActions = [
          'insert_contact', 'insert_contact_n', 'insert_contact_p', 'insert_contact_np',
          'insert_coil', 'insert_coil_set', 'insert_coil_rset',
          'insert_timer_ton', 'insert_timer_tof', 'insert_timer_tp',
          'insert_counter_ctu', 'insert_counter_ctd', 'insert_counter_ctud',
          'insert_fb_add', 'insert_fb_sub', 'insert_fb_mul', 'insert_fb_div', 'insert_fb_mod',
          'insert_fb_cmp_eq', 'insert_fb_cmp_neq', 'insert_fb_cmp_gt', 'insert_fb_cmp_lt', 
          'insert_fb_cmp_gte', 'insert_fb_cmp_lte', 'insert_fb_move',
          'delete', 'cut', 'paste', 'toggle_inverted', 'edit_symbol', 'edit_function_block'
        ]
        if (structuralActions.includes(selected_action)) {
          triggerLint()
        }
      }
    })
  }

  // Keyboard shortcuts
  canvas.tabIndex = 0 // Allow focus
  canvas.style.outline = 'none' // Remove outline

  canvas.addEventListener('blur', () => {
    // Clear selection on focus lost (click outside)
    if (editor.ladder_selection?.ladder_id === ladderId && editor.ladder_selection.selection.length > 0) {
      editor.ladder_selection.selection = []
      editor.ladder_selection.origin = { x: 0, y: 0 } // Reset origin
      ladderRenderer.render(editor, ladder)
    }
  })

  canvas.addEventListener('keydown', (e) => {
    const live = editor.device_manager.connected && !!editor.window_manager?.isMonitoringActive?.()
    const ctrl = e.ctrlKey || e.metaKey
    const shift = e.shiftKey
    const key = e.key.toLowerCase()

    // Handle Escape - cancel operations in priority order
    if (key === 'escape') {
      // If dragging a wire, cancel only the wire drag
      if (connState.dragging_wire) {
        connState.dragging_wire = false
        connState.wire_start_block = null
        connState.wire_start_side = null
        connState.snapped_block = null
        was_dragging_wire = true // Prevent selection on mouse release
        operation_cancelled = true // Ignore mouse until released
        canvas.style.cursor = 'default' // Reset cursor
        ladderRenderer.render(editor, ladder)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // If moving blocks, cancel and restore original positions
      if (is_moving && moving_original_positions.length > 0) {
        // Restore block positions
        for (const orig of moving_original_positions) {
          const block = ladder.blocks.find(b => b.id === orig.id)
          if (block) {
            block.x = orig.x
            block.y = orig.y
          }
        }
        // Restore selection
        if (moving_original_selection) {
          editor.ladder_selection = moving_original_selection
        }
        // Reset move state
        is_moving = false
        is_dragging = false
        moving_elements = []
        moving_original_positions = []
        moving_original_selection = null
        was_dragging = true // Prevent click from selecting
        operation_cancelled = true // Ignore mouse until released
        ladderRenderer.render(editor, ladder)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // Clear connection selection on ESC
      if (connState.selected_connections && connState.selected_connections.length > 0) {
        connState.selected_connections = []
        ladderRenderer.render(editor, ladder)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // Otherwise, deselect everything
      if (editor.ladder_selection?.ladder_id === ladderId) {
        editor.ladder_selection.selection = []
        editor.ladder_selection.origin = { x: 0, y: 0 }
        ladderRenderer.render(editor, ladder)
      }
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // Handle Arrow Keys for selection movement/expansion
    const isArrowKey = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)
    if (isArrowKey && editor.ladder_selection?.ladder_id === ladderId) {
      e.preventDefault()
      e.stopPropagation()
      
      const dx = key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 : 0
      const dy = key === 'arrowup' ? -1 : key === 'arrowdown' ? 1 : 0
      
      const selection = editor.ladder_selection.selection || []
      const origin = editor.ladder_selection.origin || { x: 0, y: 0 }
      
      if (ctrl && !shift && !live) {
        // CTRL + Arrow: Move selected blocks
        const selected = selection.filter(s => s.type === 'block' || s.type === 'area')
        if (selected.length === 0) return
        
        // Collect all blocks to move
        const blocksToMove = []
        const positions = new Set()
        for (const sel of selected) {
          if (sel.type === 'block') {
            const block = ladder.blocks.find(b => b.x === sel.x && b.y === sel.y)
            if (block) {
              blocksToMove.push(block)
              positions.add(`${sel.x},${sel.y}`)
            }
          } else if (sel.type === 'area') {
            for (let bx = sel.x; bx < sel.x + sel.width; bx++) {
              for (let by = sel.y; by < sel.y + sel.height; by++) {
                const block = ladder.blocks.find(b => b.x === bx && b.y === by)
                if (block && !positions.has(`${bx},${by}`)) {
                  blocksToMove.push(block)
                  positions.add(`${bx},${by}`)
                }
              }
            }
          }
        }
        
        if (blocksToMove.length === 0) return
        
        // Check boundaries
        const canMoveBounds = blocksToMove.every(b => {
          const newX = b.x + dx
          const newY = b.y + dy
          return newX >= 0 && newY >= 0
        })
        
        if (!canMoveBounds) return
        
        // Check for collisions with non-moving blocks
        const movingIds = new Set(blocksToMove.map(b => b.id))
        const nonMovingBlocks = ladder.blocks.filter(b => !movingIds.has(b.id))
        
        const proposedPositions = blocksToMove.map(b => ({
          id: b.id,
          x: b.x + dx,
          y: b.y + dy
        }))
        
        const hasCollision = proposedPositions.some(pos => 
          nonMovingBlocks.some(b => b.x === pos.x && b.y === pos.y)
        )
        
        if (hasCollision) return
        
        // Check connection constraints - connections cannot go backwards
        const legacyConns = getLegacyConnections(ladder)
        const hasConnectionViolation = proposedPositions.some(pos => {
          // Find connections where this moving block is the source (connects TO something)
          const outgoingToNonMoving = legacyConns.filter(c => 
            c.from.id === pos.id && !movingIds.has(c.to.id)
          )
          for (const conn of outgoingToNonMoving) {
            const targetBlock = nonMovingBlocks.find(b => b.id === conn.to.id)
            if (targetBlock && pos.x >= targetBlock.x) return true
          }
          
          // Find connections where this moving block is the target (something connects TO it)
          const incomingFromNonMoving = legacyConns.filter(c => 
            c.to.id === pos.id && !movingIds.has(c.from.id)
          )
          for (const conn of incomingFromNonMoving) {
            const sourceBlock = nonMovingBlocks.find(b => b.id === conn.from.id)
            if (sourceBlock && pos.x <= sourceBlock.x) return true
          }
          
          return false
        })
        
        if (hasConnectionViolation) return
        
        // Move blocks
        blocksToMove.forEach(b => {
          b.x += dx
          b.y += dy
        })
        // Move selection
        for (const sel of selected) {
          sel.x += dx
          sel.y += dy
        }
        editor.ladder_selection.origin.x += dx
        editor.ladder_selection.origin.y += dy
        // No auto-connect on move - connections are only made when adding new elements
        ladderRenderer.render(editor, ladder)
        triggerLint()
      } else if (shift && !ctrl) {
        // SHIFT + Arrow: Move virtual cursor to expand/change selection box
        // Selection is always the box between origin and cursor
        
        // Get current cursor position - use stored cursor if available
        let cursor = editor.ladder_selection.cursor 
          ? { ...editor.ladder_selection.cursor }
          : { x: origin.x, y: origin.y }
        
        // Move cursor
        cursor.x += dx
        cursor.y += dy
        
        // Clamp cursor to valid range
        cursor.x = Math.max(0, cursor.x)
        cursor.y = Math.max(0, cursor.y)
        
        // Create selection box between origin and cursor
        const minX = Math.min(origin.x, cursor.x)
        const maxX = Math.max(origin.x, cursor.x)
        const minY = Math.min(origin.y, cursor.y)
        const maxY = Math.max(origin.y, cursor.y)
        const width = maxX - minX + 1
        const height = maxY - minY + 1
        
        editor.ladder_selection.selection = [{ type: 'area', x: minX, y: minY, width, height }]
        // Store cursor position for next SHIFT+arrow
        editor.ladder_selection.cursor = cursor
        ladderRenderer.render(editor, ladder)
      } else if (!ctrl && !shift) {
        // Plain Arrow: Move selection cursor (single cell)
        let newX = origin.x + dx
        let newY = origin.y + dy
        
        // Clamp to valid range
        newX = Math.max(0, newX)
        newY = Math.max(0, newY)
        
        editor.ladder_selection = {
          ladder_id: ladderId,
          program_id: ladder.program_id || '',
          origin: { x: newX, y: newY },
          selection: [{ type: 'block', x: newX, y: newY }]
        }
        ladderRenderer.render(editor, ladder)
      }
      return
    }

    if (live) {
      // Live Mode Hotkeys for Toggle/Set
      const selection = editor.ladder_selection?.selection || []
      // Only toggle if single block selected and on this ladder
      if (editor.ladder_selection?.ladder_id === ladderId && selection.length === 1 && selection[0].type === 'block') {
        const { x, y } = selection[0]
        const block = ladder.blocks.find(b => b.x === x && b.y === y)
        if (block && block.symbol) {
          const symbol = getBlockState(editor, block).state?.symbol
          if (symbol && (symbol.type === 'bit' || symbol.type === 'bool')) {
            const val = !!getSymbolValue(editor, symbol)
            let newValue = val
            let handled = false

            if (key === '1') { newValue = true; handled = true }
            if (key === '0') { newValue = false; handled = true }
            if (key === 'enter' || key === ' ') { newValue = !val; handled = true }

            if (handled) {
              setSymbolBit(editor, symbol, newValue)
              ladderRenderer.render(editor, ladder)
              e.preventDefault()
            }
          }
        }
      }
      return // Don't allow editing shortcuts in live mode
    }

    if (key === 'delete' || key === 'backspace') {
      // Check if we have selected connections to delete
      const connState = editor.ladder_connection_state?.[ladderId]
      if (connState && connState.selected_connections?.length > 0) {
        // Delete selected connections
        deleteSelectedConnections(editor, ladder, connState.selected_connections)
        connState.selected_connections = []
        ladderRenderer.render(editor, ladder)
        triggerLint()
        e.preventDefault()
        return
      }
      
      // Otherwise delete selected blocks
      deleteSelection(editor, ladder)
      ladderRenderer.render(editor, ladder)
      triggerLint()
      e.preventDefault()
    }

    if (ctrl && key === 'c') {
      const origin = editor.ladder_selection?.origin || { x: 0, y: 0 }
      copySelection(editor, ladder, origin.x, origin.y)
      e.preventDefault()
    }

    if (ctrl && key === 'x') {
      const origin = editor.ladder_selection?.origin || { x: 0, y: 0 }
      copySelection(editor, ladder, origin.x, origin.y)
      deleteSelection(editor, ladder)
      ladderRenderer.render(editor, ladder)
      triggerLint()
      e.preventDefault()
    }

    if (ctrl && key === 'v') {
      const origin = editor.ladder_selection?.origin || { x: 0, y: 0 }
      pasteSelection(editor, ladder, origin.x, origin.y)
      ladderRenderer.render(editor, ladder)
      triggerLint()
      e.preventDefault()
    }
  })
}


/**
 * Copy selected ladder blocks to clipboard
 * @param {VovkPLCEditor} editor
 * @param {PLC_Ladder} ladder
 * @param {number} contextX
 * @param {number} contextY
 */
function copySelection(editor, ladder, contextX, contextY) {
  ensureLadderFormat(ladder)
  const nodes = ladder.nodes || []
  const sel = editor.ladder_selection?.selection || []
  const origin = editor.ladder_selection?.origin || { x: contextX, y: contextY }
  const originX = origin.x
  const originY = origin.y

  /** @type {PLC_LadderNode[]} */
  const blocksToCopy = []

  // Collect blocks from selection
  sel.forEach(s => {
    if (s.type === 'block') {
      const block = nodes.find(b => b.x === s.x && b.y === s.y)
      if (block && !blocksToCopy.find(b => b.id === block.id)) {
        blocksToCopy.push(block)
      }
    }
    if (s.type === 'area') {
      const areaBlocks = nodes.filter(b => b.x >= s.x && b.x < s.x + s.width && b.y >= s.y && b.y < s.y + s.height)
      areaBlocks.forEach(block => {
        if (!blocksToCopy.find(b => b.id === block.id)) {
          blocksToCopy.push(block)
        }
      })
    }
  })

  // If no selection, use block at context menu position
  if (blocksToCopy.length === 0) {
    const blockAtPosition = nodes.find(b => b.x === contextX && b.y === contextY)
    if (blockAtPosition) {
      blocksToCopy.push(blockAtPosition)
    }
  }

  if (blocksToCopy.length === 0) return

  // Create copies with relative positions
  const copiedBlocks = blocksToCopy.map(block => {
    const copy = { ...block }
    delete copy.state
    copy.x -= originX
    copy.y -= originY
    return copy
  })

  // Find connections between copied blocks (use legacy format for clipboard compatibility)
  const blockIds = new Set(blocksToCopy.map(b => b.id))
  const legacyConnections = getLegacyConnections(ladder)
  const copiedConnections = legacyConnections
    .filter(c => blockIds.has(c.from.id) && blockIds.has(c.to.id))
    .map(c => ({ ...c }))

  // Store in editor clipboard
  editor.ladder_clipboard = {
    blocks: copiedBlocks,
    connections: copiedConnections,
    ladder_id: ladder.id
  }
}

/**
 * Paste ladder blocks from clipboard
 * @param {VovkPLCEditor} editor
 * @param {PLC_Ladder} ladder
 * @param {number} pasteX
 * @param {number} pasteY
 */
function pasteSelection(editor, ladder, pasteX, pasteY) {
  const clipboard = editor.ladder_clipboard
  if (!clipboard || !clipboard.blocks || clipboard.blocks.length === 0) {
    console.log('No ladder blocks in clipboard')
    return
  }

  // Create new blocks with new IDs and adjusted positions
  const idMap = new Map() // old id -> new id
  const newBlocks = clipboard.blocks.map(block => {
    const newId = editor._generateID()
    idMap.set(block.id, newId)
    return {
      ...block,
      id: newId,
      x: block.x + pasteX,
      y: block.y + pasteY,
      state: undefined
    }
  })

  // Create new connections in the new grouped format
  // First, convert clipboard's legacy connections to new format
  const connectionPairs = clipboard.connections.map(conn => ({
    from: idMap.get(conn.from?.id),
    to: idMap.get(conn.to?.id)
  })).filter(c => c.from && c.to)
  
  // Group connections by source -> destinations pattern
  const sourceToDestinations = new Map()
  for (const { from, to } of connectionPairs) {
    if (!sourceToDestinations.has(from)) sourceToDestinations.set(from, new Set())
    sourceToDestinations.get(from).add(to)
  }
  
  // Create grouped connections
  const newConnections = []
  for (const [source, destinations] of sourceToDestinations) {
    newConnections.push({
      id: editor._generateID(),
      sources: [source],
      destinations: [...destinations]
    })
  }

  // Add to ladder
  newBlocks.forEach(block => ladder.nodes.push(block))
  newConnections.forEach(conn => ladder.connections.push(conn))

  // Auto-connect each pasted block to adjacent existing blocks and split existing connections
  // Sort by x position (left to right) to ensure proper connection ordering
  const sortedBlocks = [...newBlocks].sort((a, b) => a.x - b.x)
  for (const block of sortedBlocks) {
    connectNewBlock(ladder, block)
  }

  // Select the pasted blocks
  editor.ladder_selection = {
    ladder_id: ladder.id,
    program_id: ladder.program_id || '',
    origin: { x: pasteX, y: pasteY },
    selection: newBlocks.map(b => ({ type: 'block', x: b.x, y: b.y }))
  }
}

/**
 * Delete selected ladder blocks
 * @param {VovkPLCEditor} editor
 * @param {PLC_Ladder} ladder
 * @param {number} [contextX]
 * @param {number} [contextY]
 */
function deleteSelection(editor, ladder, contextX, contextY) {
  ensureLadderFormat(ladder)
  const nodes = ladder.nodes || []
  
  /** @type {PLC_LadderNode[]} */
  const blocksToDelete = []

  // First check if there's a block at the context menu position
  if (typeof contextX === 'number' && typeof contextY === 'number') {
    const blockAtPosition = nodes.find(b => b.x === contextX && b.y === contextY)
    if (blockAtPosition) {
      blocksToDelete.push(blockAtPosition)
    }
  }

  // Also collect selected blocks
  const sel = editor.ladder_selection?.selection || []
  sel.forEach(s => {
    if (s.type === 'block') {
      const block = nodes.find(b => b.x === s.x && b.y === s.y)
      if (block && !blocksToDelete.includes(block)) blocksToDelete.push(block)
    }
    if (s.type === 'area') {
      const areaBlocks = nodes.filter(b => b.x >= s.x && b.x < s.x + s.width && b.y >= s.y && b.y < s.y + s.height)
      areaBlocks.forEach(block => {
        if (!blocksToDelete.includes(block)) blocksToDelete.push(block)
      })
    }
  })

  // Delete the blocks and their connections
  blocksToDelete.forEach(block => {
    const idx = ladder.nodes.indexOf(block)
    if (idx >= 0) {
      ladder.nodes.splice(idx, 1)
      // Remove connections involving this block (handle both legacy and new format)
      ladder.connections = ladder.connections.filter(c => {
        // Legacy format
        if (c.from && c.to) {
          return c.from.id !== block.id && c.to.id !== block.id
        }
        // New grouped format - remove block from sources/destinations
        if (c.sources || c.destinations) {
          const sources = (c.sources || []).filter(id => id !== block.id)
          const destinations = (c.destinations || []).filter(id => id !== block.id)
          c.sources = sources
          c.destinations = destinations
          // Remove connection if either array is empty
          return sources.length > 0 && destinations.length > 0
        }
        return true
      })
    }
  })

  if (editor.ladder_selection && blocksToDelete.length > 0) {
    editor.ladder_selection.selection = []
  }
}

/**
 * Delete selected connection pairs from the ladder
 * @param {VovkPLCEditor} editor 
 * @param {PLC_Ladder} ladder 
 * @param {Array<{srcId: string, destId: string}>} pairs - Connection pairs to delete
 */
function deleteSelectedConnections(editor, ladder, pairs) {
  if (!pairs || pairs.length === 0) return
  
  // Create a set for quick lookup
  const pairsToDelete = new Set(pairs.map(p => `${p.srcId}->${p.destId}`))
  
  // Filter connections
  ladder.connections = ladder.connections.filter(c => {
    // Legacy format: { from: {id}, to: {id} }
    if (c.from && c.to) {
      const key = `${c.from.id}->${c.to.id}`
      return !pairsToDelete.has(key)
    }
    
    // New grouped format: { sources: [], destinations: [] }
    if (c.sources && c.destinations) {
      // Remove individual pairs from grouped connection
      const remainingSources = new Set(c.sources)
      const remainingDests = new Set(c.destinations)
      
      for (const pair of pairs) {
        if (c.sources.includes(pair.srcId) && c.destinations.includes(pair.destId)) {
          // This grouped connection contains this pair
          // For simplicity, we'll convert to individual connections and filter
          // TODO: More sophisticated handling for partial group removal
        }
      }
      
      // For now, remove entire grouped connection if any pair matches
      for (const srcId of c.sources) {
        for (const destId of c.destinations) {
          if (pairsToDelete.has(`${srcId}->${destId}`)) {
            // Remove this specific pair from the group
            // If it results in empty arrays, remove the whole connection
          }
        }
      }
      
      // Simple approach: expand to legacy, filter, and keep
      const expanded = []
      for (const srcId of c.sources) {
        for (const destId of c.destinations) {
          const key = `${srcId}->${destId}`
          if (!pairsToDelete.has(key)) {
            expanded.push({ srcId, destId })
          }
        }
      }
      
      if (expanded.length === 0) {
        return false // Remove entire connection
      }
      
      // Rebuild the grouped connection with remaining pairs
      const newSources = [...new Set(expanded.map(e => e.srcId))]
      const newDests = [...new Set(expanded.map(e => e.destId))]
      c.sources = newSources
      c.destinations = newDests
      return true
    }
    
    return true
  })
  
  // Invalidate path cache since connections changed
  connectionPathCache.delete(ladder.id || 'unknown')
}

/**
 * Initialize live monitoring for ladder canvas - handles memory listeners and visibility
 * @param {VovkPLCEditor} editor
 * @param {any} ladder
 * @param {HTMLCanvasElement} canvas
 */
function initializeLiveMonitoring(editor, ladder, canvas) {
  const ladderId = ladder.id
  const props = ladder.props

  // Store monitoring state in props
  props._liveMonitor = {
    isVisible: true,
    wasConnected: false,
    registeredAddresses: new Map(), // Map<address, { size, callback }>
    updateTimer: null,
    lastSymbolsHash: null
  }

  const monitor = props._liveMonitor

  /**
   * Get all symbols used by ladder blocks and their memory addresses
   */
  const collectSymbolAddresses = () => {
    const addresses = new Map() // Map<baseAddress, { size, symbols: Set<symbol> }>
    const offsets = ensureOffsets(editor.project?.offsets || {})

    // Type size mapping
    const typeSizes = {
      bit: 1, bool: 1, byte: 1, u8: 1, i8: 1,
      int: 2, u16: 2, i16: 2, word: 2,
      dint: 4, u32: 4, i32: 4, real: 4, float: 4, f32: 4, dword: 4,
      u64: 8, i64: 8, f64: 8, lword: 8
    }

    // Map dataType to symbol type for operation blocks
    const dataTypeToSymbolType = {
      'i8': 'i8', 'u8': 'u8', 'i16': 'i16', 'u16': 'u16',
      'i32': 'i32', 'u32': 'u32', 'i64': 'i64', 'u64': 'u64',
      'f32': 'f32', 'f64': 'f64'
    }

    /**
     * Add an address to the monitoring map
     * @param {string} addressName - The name/address string (e.g., "MW14", "M10")
     * @param {string} [typeOverride] - Optional type override
     */
    const addAddressToMap = (addressName, typeOverride) => {
      if (!addressName) return

      // Find symbol from project or system symbols, or parse as direct address
      let symbol = system_symbols.find(s => s.name === addressName)
        || editor.project?.symbols?.find(s => s.name === addressName)

      // If not found, try to parse as direct address (e.g., X0.0, Y0.0, MW14)
      if (!symbol) {
        symbol = parseAddressToSymbol(addressName)
      }

      if (!symbol) return

      // Override type if specified (for operation blocks with dataType)
      if (typeOverride && symbol) {
        symbol = { ...symbol, type: typeOverride }
      }

      // Calculate absolute address
      const locationKey = symbol.location === 'memory' ? 'marker' : symbol.location
      const baseOffset = offsets[locationKey]?.offset || 0
      const addrVal = parseFloat(String(symbol.address)) || 0
      const byteAddr = Math.floor(addrVal)
      const absoluteAddr = baseOffset + byteAddr

      // Determine size based on type
      const size = typeSizes[symbol.type || 'bit'] || 1

      // Group nearby addresses for efficient fetching
      if (!addresses.has(absoluteAddr)) {
        addresses.set(absoluteAddr, { size, symbols: new Set() })
      }
      const entry = addresses.get(absoluteAddr)
      entry.size = Math.max(entry.size, size)
      entry.symbols.add(addressName)
    }

    const blocks = ladder.blocks || []
    for (const block of blocks) {
      // For regular blocks, collect the main symbol
      if (block.symbol) {
        addAddressToMap(block.symbol)
      }

      // For operation blocks (function blocks), also collect in1, in2, out addresses
      if (isFunctionBlock(block.type)) {
        const symbolType = dataTypeToSymbolType[block.dataType] || 'i16'
        
        // Collect output address
        if (block.out) {
          addAddressToMap(block.out, symbolType)
        }
        // Collect input addresses (for display purposes)
        if (block.in1) {
          addAddressToMap(block.in1, symbolType)
        }
        if (block.in2) {
          addAddressToMap(block.in2, symbolType)
        }
        // For INC/DEC, the address is in block.symbol (already collected above)
      }
    }

    return addresses
  }

  /**
   * Create a hash of current symbols for change detection
   */
  const getSymbolsHash = () => {
    const blocks = ladder.blocks || []
    const symbols = []
    for (const b of blocks) {
      if (b.symbol) symbols.push(b.symbol)
      // Include operation block addresses in hash
      if (isFunctionBlock(b.type)) {
        if (b.out) symbols.push(b.out)
        if (b.in1) symbols.push(b.in1)
        if (b.in2) symbols.push(b.in2)
      }
    }
    return symbols.sort().join('|')
  }

  /**
   * Register memory listeners with DataFetcher
   */
  const registerMemoryListeners = () => {
    // @ts-ignore - data_fetcher exists at runtime
    if (!editor.data_fetcher) return
    if (!monitor.isVisible) return

    // Unregister old listeners first
    unregisterMemoryListeners()

    const addresses = collectSymbolAddresses()
    if (addresses.size === 0) return

    // Register each address range with a callback that updates editor.memory
    for (const [addr, entry] of addresses) {
      const listenerId = `ladder-${ladderId}-${addr}`

      // Create callback that updates editor.memory and triggers re-render
      const onMemoryChange = (data) => {
        // Only process if visible and connected
        if (!monitor.isVisible) return
        if (!editor.device_manager?.connected) return
        if (!editor.window_manager?.isMonitoringActive?.()) return

        // Update editor.memory with the fetched data
        if (data && editor.memory) {
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
          for (let i = 0; i < bytes.length && (addr + i) < editor.memory.length; i++) {
            editor.memory[addr + i] = bytes[i]
          }
        }

        // Clear block state caches so values are re-read
        const blocks = ladder.blocks || []
        for (const block of blocks) {
          if (block.state) {
            block.state = undefined
          }
        }

        // Request re-render
        ladderRenderer.render(editor, ladder)
      }

      // @ts-ignore - data_fetcher exists at runtime
      editor.data_fetcher.register(listenerId, addr, entry.size, onMemoryChange)
      monitor.registeredAddresses.set(addr, { size: entry.size, callback: onMemoryChange, listenerId })
    }

    monitor.lastSymbolsHash = getSymbolsHash()
  }

  /**
   * Unregister all memory listeners
   */
  const unregisterMemoryListeners = () => {
    // @ts-ignore - data_fetcher exists at runtime
    if (!editor.data_fetcher) return

    for (const [addr, entry] of monitor.registeredAddresses) {
      // @ts-ignore - data_fetcher exists at runtime
      editor.data_fetcher.unregister(entry.listenerId, addr, entry.size, entry.callback)
    }
    monitor.registeredAddresses.clear()
  }

  /**
   * Update monitoring state based on connection and visibility
   */
  const updateMonitoringState = () => {
    const isConnected = !!editor.device_manager?.connected
    const isMonitoring = !!editor.window_manager?.isMonitoringActive?.()
    const shouldMonitor = isConnected && isMonitoring && monitor.isVisible

    // Check if symbols changed
    const currentHash = getSymbolsHash()
    const symbolsChanged = currentHash !== monitor.lastSymbolsHash

    if (shouldMonitor) {
      // Re-register if connection state changed or symbols changed
      if (!monitor.wasConnected || symbolsChanged) {
        registerMemoryListeners()
        // Trigger initial render when going online
        ladderRenderer.render(editor, ladder)
      }
    } else {
      // Unregister when not monitoring
      if (monitor.wasConnected || monitor.registeredAddresses.size > 0) {
        unregisterMemoryListeners()
        // Re-render to show offline state
        if (monitor.isVisible) {
          ladderRenderer.render(editor, ladder)
        }
      }
    }

    monitor.wasConnected = shouldMonitor
  }

  // Set up IntersectionObserver to detect visibility
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const wasVisible = monitor.isVisible
      monitor.isVisible = entry.isIntersecting

      if (monitor.isVisible && !wasVisible) {
        // Became visible - restart monitoring
        updateMonitoringState()
      } else if (!monitor.isVisible && wasVisible) {
        // Became hidden - stop monitoring
        unregisterMemoryListeners()
      }
    }
  }, { threshold: 0.1 })

  // @ts-ignore - canvas is valid for IntersectionObserver
  observer.observe(canvas)

  // Set up periodic check for connection/monitoring state changes
  monitor.updateTimer = setInterval(() => {
    if (monitor.isVisible) {
      updateMonitoringState()
    }
  }, 500)

  // Store cleanup function in props
  props._cleanupLiveMonitor = () => {
    observer.disconnect()
    if (monitor.updateTimer) {
      clearInterval(monitor.updateTimer)
      monitor.updateTimer = null
    }
    unregisterMemoryListeners()
  }

  // Initial state update
  updateMonitoringState()
}


/**
 * Create an autocomplete provider function for symbols
 * @param {VovkPLCEditor} editor
 * @param {string[]} [filterLocations] - Optional filter for symbol locations (e.g. ['input', 'output', 'marker'])
 * @returns {() => {value: string, label: string}[]}
 */
const createSymbolAutocomplete = (editor, filterLocations = null) => {
  return () => {
    const symbols = editor.project?.symbols || []
    const filtered = filterLocations 
      ? symbols.filter(s => filterLocations.includes(s.location))
      : symbols
    return filtered.map(s => ({
      value: s.name,
      label: `${s.location} ${s.type}`
    }))
  }
}

/**
 * Lookup a direct address and return the corresponding symbol name if found
 * Address formats: X0.0, Y0.0, M10.5, MW14, MD0, etc.
 * @param {VovkPLCEditor} editor
 * @param {string} addressOrSymbol - The address string to lookup
 * @returns {string} - Symbol name if found, otherwise original input
 */
const resolveAddressToSymbol = (editor, addressOrSymbol) => {
  if (!addressOrSymbol || typeof addressOrSymbol !== 'string') return addressOrSymbol
  
  const trimmed = addressOrSymbol.trim()
  const symbols = editor.project?.symbols || []
  
  // First check if it's already a symbol name (not a direct address)
  const existingSymbol = symbols.find(s => s.name === trimmed)
  if (existingSymbol) return trimmed
  
  // Parse as direct address
  const parsed = parseAddressToSymbol(trimmed)
  if (!parsed) return trimmed
  
  // Map location codes
  const locationMap = {
    'K': 'system',
    'C': 'counter', 
    'T': 'timer',
    'X': 'input',
    'Y': 'output',
    'S': 'system',
    'M': 'marker'
  }
  
  // Try to find a matching symbol by location and address
  const matchingSymbol = symbols.find(s => {
    if (s.location !== parsed.location) return false
    
    // Compare addresses - handle both bit and byte addresses
    const parsedAddr = parsed.address
    const symbolAddr = s.address
    
    // For bit addresses (e.g. M0.1), the address contains both byte and bit
    if (parsed.type === 'bit') {
      // Exact match needed for bit addresses
      return Math.abs(symbolAddr - parsedAddr) < 0.001
    }
    
    // For typed addresses (MB, MW, MD, MR), match on byte offset
    return Math.floor(symbolAddr) === Math.floor(parsedAddr)
  })
  
  return matchingSymbol ? matchingSymbol.name : trimmed
}

/**
 * Prompt user to enter a symbol name for a ladder block
 * @param {VovkPLCEditor} editor
 * @param {PLC_LadderBlock} block
 * @param {any} ladder - The ladder block to re-render after symbol change
 */
async function promptForSymbol(editor, block, ladder) {
  const symbols = editor.project?.symbols || []
  const blockTypeLabels = {
    'contact': 'Contact',
    'coil': 'Coil',
    'coil_set': 'Coil (Set)',
    'coil_rset': 'Coil (Reset)',
    'timer_ton': 'Timer TON',
    'timer_tof': 'Timer TOF',
    'timer_tp': 'Timer TP',
    'counter_u': 'Counter CTU',
    'counter_d': 'Counter CTD',
    'counter_ctu': 'Counter CTU',
    'counter_ctd': 'Counter CTD',
    'counter_ctud': 'Counter CTUD'
  }
  const blockTypeLabel = blockTypeLabels[block.type] || block.type
  const currentSymbol = block.symbol || ''
  
  // All symbols for autocomplete - no filtering to ensure symbols show up
  const autocomplete = createSymbolAutocomplete(editor, null)

  const result = await Popup.form({
    title: `Edit ${blockTypeLabel}`,
    description: 'Enter symbol name or direct address (e.g. X0.0, Y0.0, M10.5)',
    inputs: [
      {
        name: 'symbol',
        label: 'Symbol / Address',
        type: 'text',
        value: currentSymbol,
        placeholder: 'e.g. Start_Button or X0.0',
        autocomplete
      }
    ],
    buttons: [
      { text: 'OK', value: 'ok' },
      { text: 'Cancel', value: 'cancel' }
    ]
  })

  if (result && result.symbol !== undefined) {
    // Auto-resolve hardcoded address to symbol if match found
    const resolvedSymbol = resolveAddressToSymbol(editor, result.symbol.trim())
    block.symbol = resolvedSymbol
    // Clear cached state so it gets re-resolved
    block.state = undefined
    // Re-render the ladder
    if (ladder) {
      ladderRenderer.render(editor, ladder)
    }
    // Trigger linting
    if (editor.lintProject && typeof editor.lintProject === 'function') {
      editor.lintProject()
    }
  }
}


/**
 * Parse T# time duration syntax to milliseconds
 * Supports formats like: T#1ms, T#500ms, T#1s, T#1.5s, T#1m, T#1m30s, T#1h, T#1h30m, T#2h15m30s
 * @param {string} input - The time string in T# format
 * @returns {{ valid: boolean, ms: number, error?: string }}
 */
function parseTimeDuration(input) {
  if (!input || typeof input !== 'string') {
    return { valid: false, ms: 0, error: 'Empty input' }
  }

  let str = input.trim().toUpperCase()

  // Check for T# prefix (optional for convenience)
  if (str.startsWith('T#')) {
    str = str.substring(2)
  }

  if (!str) {
    return { valid: false, ms: 0, error: 'Empty duration' }
  }

  // Pattern to match time components: number followed by unit (h, m, s, ms)
  const pattern = /^(\d+(?:\.\d+)?)(MS|S|M|H)(.*)$/i
  let remaining = str
  let totalMs = 0
  let hasMatch = false

  while (remaining.length > 0) {
    const match = remaining.match(pattern)
    if (!match) {
      if (remaining.length > 0) {
        return { valid: false, ms: 0, error: `Invalid format: "${remaining}"` }
      }
      break
    }

    hasMatch = true
    const value = parseFloat(match[1])
    const unit = match[2].toUpperCase()
    remaining = match[3]

    switch (unit) {
      case 'MS':
        totalMs += value
        break
      case 'S':
        totalMs += value * 1000
        break
      case 'M':
        totalMs += value * 60000
        break
      case 'H':
        totalMs += value * 3600000
        break
      default:
        return { valid: false, ms: 0, error: `Unknown unit: ${unit}` }
    }
  }

  if (!hasMatch) {
    return { valid: false, ms: 0, error: 'No valid time components found' }
  }

  if (totalMs < 1) {
    return { valid: false, ms: 0, error: 'Duration must be at least 1ms' }
  }

  return { valid: true, ms: Math.round(totalMs) }
}

/**
 * Format milliseconds to T# time duration syntax
 * @param {number} ms - Time in milliseconds
 * @returns {string}
 */
function formatTimeDuration(ms) {
  if (ms < 1000) {
    return `T#${ms}ms`
  }

  const hours = Math.floor(ms / 3600000)
  ms %= 3600000
  const minutes = Math.floor(ms / 60000)
  ms %= 60000
  const seconds = Math.floor(ms / 1000)
  const milliseconds = ms % 1000

  let result = 'T#'
  if (hours > 0) result += `${hours}h`
  if (minutes > 0) result += `${minutes}m`
  if (seconds > 0) result += `${seconds}s`
  if (milliseconds > 0) result += `${milliseconds}ms`

  return result || 'T#0ms'
}

/**
 * Prompt user to enter timer parameters
 * @param {VovkPLCEditor} editor
 * @param {PLC_LadderBlock} block
 * @param {any} ladder - The ladder block to re-render after parameter change
 */
async function promptForTimerParameters(editor, block, ladder) {
  const timerTypeLabels = {
    'timer_ton': 'TON (On Delay)',
    'timer_tof': 'TOF (Off Delay)',
    'timer_tp': 'TP (Pulse)'
  }
  const timerTypeLabel = timerTypeLabels[block.type] || 'Timer'
  const currentSymbol = block.symbol || ''

  // Handle backward compatibility: convert number to T# string if needed
  let currentPreset = block.preset
  if (typeof currentPreset === 'number') {
    currentPreset = formatTimeDuration(currentPreset)
  } else if (!currentPreset) {
    currentPreset = 'T#1s'
  }

  const result = await Popup.form({
    title: `Edit ${timerTypeLabel}`,
    description: 'Use T#<value><unit> format (e.g. T#1s, T#500ms, T#1m30s)',
    inputs: [
      {
        name: 'symbol',
        label: 'Timer Symbol',
        type: 'text',
        value: currentSymbol,
        placeholder: 'e.g. Timer_1 or T0',
        autocomplete: createSymbolAutocomplete(editor, ['timer'])
      },
      {
        name: 'preset',
        label: 'Preset Time (PT)',
        type: 'text',
        value: currentPreset,
        placeholder: 'e.g. T#1s, T#500ms, T#1m30s'
      }
    ],
    verify: values => {
      const preset = values.preset
      const parsed = parseTimeDuration(preset.value)
      if (!parsed.valid) {
        return preset.setError(parsed.error || 'Invalid time format')
      }
      preset.clearError()
      return true
    },
    buttons: [
      { text: 'OK', value: 'ok' },
      { text: 'Cancel', value: 'cancel' }
    ]
  })

  if (result && result.symbol !== undefined) {
    // Auto-resolve hardcoded address to symbol if match found
    const resolvedSymbol = resolveAddressToSymbol(editor, result.symbol.trim())
    block.symbol = resolvedSymbol
    // Store the T# string directly (ensure it has T# prefix)
    let presetStr = result.preset.trim()
    if (!presetStr.toUpperCase().startsWith('T#')) {
      presetStr = 'T#' + presetStr
    }
    block.preset = presetStr

    // Clear cached state so it gets re-resolved
    block.state = undefined
    // Re-render the ladder
    if (ladder) {
      ladderRenderer.render(editor, ladder)
    }
    // Trigger linting
    if (editor.lintProject && typeof editor.lintProject === 'function') {
      editor.lintProject()
    }
  }
}

async function promptForCounterParameters(editor, block, ladder) {
  const counterTypeLabels = {
    'counter_u': 'CTU (Count Up)',
    'counter_d': 'CTD (Count Down)',
    'counter_ctu': 'CTU (Count Up)',
    'counter_ctd': 'CTD (Count Down)',
    'counter_ctud': 'CTUD (Up/Down)'
  }
  const counterTypeLabel = counterTypeLabels[block.type] || 'Counter'
  const currentSymbol = block.symbol || ''
  const currentPreset = block.preset || 10

  const result = await Popup.form({
    title: `Edit ${counterTypeLabel}`,
    description: 'Configure counter symbol and preset value',
    inputs: [
      {
        name: 'symbol',
        label: 'Counter Symbol',
        type: 'text',
        value: currentSymbol,
        placeholder: 'e.g. Counter_1 or C0',
        autocomplete: createSymbolAutocomplete(editor, ['counter'])
      },
      {
        name: 'preset',
        label: 'Preset Value (PV)',
        type: 'number',
        value: currentPreset,
        placeholder: 'e.g. 10'
      }
    ],
    verify: values => {
      const preset = values.preset
      const num = parseInt(preset.value)
      if (isNaN(num) || num < 0) {
        return preset.setError('Preset must be a non-negative integer')
      }
      preset.clearError()
      return true
    },
    buttons: [
      { text: 'OK', value: 'ok' },
      { text: 'Cancel', value: 'cancel' }
    ]
  })

  if (result && result.symbol !== undefined) {
    // Auto-resolve hardcoded address to symbol if match found
    const resolvedSymbol = resolveAddressToSymbol(editor, result.symbol.trim())
    block.symbol = resolvedSymbol
    block.preset = parseInt(result.preset) || 10

    // Clear cached state so it gets re-resolved
    block.state = undefined
    // Re-render the ladder
    if (ladder) {
      ladderRenderer.render(editor, ladder)
    }
    // Trigger linting
    if (editor.lintProject && typeof editor.lintProject === 'function') {
      editor.lintProject()
    }
  }
}

/**
 * Prompt user to enter operation block parameters (math, move, compare)
 * @param {VovkPLCEditor} editor
 * @param {PLC_LadderBlock} block
 * @param {any} ladder - The ladder block to re-render after parameter change
 */
async function promptForFunctionBlockParameters(editor, block, ladder) {
  const fbLabel = getFunctionBlockLabel(block.type)
  const isUnary = isUnaryMathBlock(block.type)
  const isMove = isMoveBlock(block.type)
  const isCompare = isCompareBlock(block.type)
  const isMath = isMathBlock(block.type)
  const isIncDec = isIncDecBlock(block.type)

  const currentDataType = block.dataType || 'i16'
  const currentIn1 = block.in1 || ''
  const currentIn2 = block.in2 || ''
  const currentOut = block.out || block.symbol || ''
  
  // Autocomplete for memory/marker symbols
  const memoryAutocomplete = createSymbolAutocomplete(editor, ['marker', 'memory'])

  // Build inputs based on block type
  const inputs = [
    {
      name: 'dataType',
      label: 'Data Type',
      type: 'select',
      value: currentDataType,
      options: [
        { value: 'u8', label: 'U8 (Byte)' },
        { value: 'u16', label: 'U16 (Word)' },
        { value: 'u32', label: 'U32 (DWord)' },
        { value: 'i8', label: 'I8 (Signed Byte)' },
        { value: 'i16', label: 'I16 (INT)' },
        { value: 'i32', label: 'I32 (DINT)' },
        { value: 'f32', label: 'F32 (REAL)' },
        { value: 'f64', label: 'F64 (LREAL)' },
      ]
    }
  ]

  // INC/DEC only need a single address parameter
  if (isIncDec) {
    inputs.push({
      name: 'address',
      label: 'Address',
      type: 'text',
      value: block.symbol || '',
      placeholder: 'e.g. MB0, MW2, MD4, MR8',
      autocomplete: memoryAutocomplete
    })
  } else {
    inputs.push({
      name: 'in1',
      label: isMove ? 'Source (IN)' : 'Input 1 (IN1)',
      type: 'text',
      value: currentIn1,
      placeholder: 'e.g. MW0, #100, MD4',
      autocomplete: memoryAutocomplete
    })

    // Add IN2 for binary operations
    if (!isUnary && !isMove) {
      inputs.push({
        name: 'in2',
        label: 'Input 2 (IN2)',
        type: 'text',
        value: currentIn2,
        placeholder: 'e.g. MW2, #50',
        autocomplete: memoryAutocomplete
      })
    }

    // Add output for math and move (not for compare - it sets RLO)
    if (isMath || isMove) {
      inputs.push({
        name: 'out',
        label: 'Output (OUT)',
        type: 'text',
        value: currentOut,
        placeholder: 'e.g. MW10, MD8',
        autocomplete: memoryAutocomplete
      })
    }
  }

  let description = ''
  if (isIncDec) {
    description = `${fbLabel} the value at the specified address by 1 when RLO is true`
  } else if (isCompare) {
    description = 'Compare operation sets RLO (Result of Logic Operation) based on comparison result'
  } else if (isMove) {
    description = 'Move value from source to destination when RLO is true'
  } else if (isUnary) {
    description = `Apply ${fbLabel} operation to input and store result when RLO is true`
  } else {
    description = `Perform ${fbLabel} operation (IN1 ${fbLabel} IN2 -> OUT) when RLO is true`
  }

  const result = await Popup.form({
    title: `Edit ${fbLabel} Operation`,
    description,
    inputs,
    verify: values => {
      if (isIncDec) {
        // INC/DEC only needs address
        if (!values.address.value.trim()) {
          return values.address.setError('Address is required')
        }
        values.address.clearError()
        return true
      }
      
      // Basic validation - at least IN1 is required
      if (!values.in1.value.trim()) {
        return values.in1.setError('Input 1 is required')
      }
      values.in1.clearError()
      
      // IN2 required for binary ops
      if (!isUnary && !isMove && values.in2 && !values.in2.value.trim()) {
        return values.in2.setError('Input 2 is required')
      }
      if (values.in2) values.in2.clearError()
      
      // Output required for math/move
      if ((isMath || isMove) && values.out && !values.out.value.trim()) {
        return values.out.setError('Output is required')
      }
      if (values.out) values.out.clearError()
      
      return true
    },
    buttons: [
      { text: 'OK', value: 'ok' },
      { text: 'Cancel', value: 'cancel' }
    ]
  })

  if (result) {
    block.dataType = result.dataType || 'i16'
    
    if (isIncDec) {
      // INC/DEC uses symbol as the address - auto-resolve to symbol if match found
      block.symbol = resolveAddressToSymbol(editor, result.address?.trim() || '')
      // Clear any legacy in1/out fields
      delete block.in1
      delete block.out
    } else {
      // Auto-resolve hardcoded addresses to symbols if matches found
      block.in1 = resolveAddressToSymbol(editor, result.in1?.trim() || '')
      if (!isUnary && !isMove) {
        block.in2 = resolveAddressToSymbol(editor, result.in2?.trim() || '')
      }
      if (isMath || isMove) {
        const resolvedOut = resolveAddressToSymbol(editor, result.out?.trim() || '')
        block.out = resolvedOut
        block.symbol = resolvedOut // Use output as symbol for display
      }
    }

    // Clear cached state so it gets re-resolved
    block.state = undefined
    // Re-render the ladder
    if (ladder) {
      ladderRenderer.render(editor, ladder)
    }
    // Trigger linting
    if (editor.lintProject && typeof editor.lintProject === 'function') {
      editor.lintProject()
    }
  }
}

export default ladderRenderer
