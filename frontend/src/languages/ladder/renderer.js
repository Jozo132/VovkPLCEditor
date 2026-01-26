import { VovkPLCEditor } from "../../editor/Editor.js"
import { PLC_Symbol } from "../../utils/types.js"
import { RendererModule } from "../types.js"
import { resolveBlockState } from "./evaluator.js"
import { PLC_Ladder, PLC_LadderBlock, PLC_LadderNode, PLC_LadderConnection, toGraph, isFunctionBlock, isMathBlock, isCompareBlock, isMoveBlock, isUnaryMathBlock, isIncDecBlock, getFunctionBlockLabel, migrateLadderBlock } from "./language.js"
import { getSymbolValue, setSymbolBit } from "../BlockLogic.js"
import { ensureOffsets } from "../../utils/offsets.js"
import { Popup } from "../../editor/UI/Elements/components/popup.js"


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


/** @typedef */
const memory_locations = [
  { short: 'K', name: 'control', label: 'Control' },
  { short: 'C', name: 'counter', label: 'Counter' },
  { short: 'T', name: 'timer', label: 'Timer' },
  { short: 'X', name: 'input', label: 'Input' },
  { short: 'Y', name: 'output', label: 'Output' },
  { short: 'S', name: 'system', label: 'System' },
  { short: 'M', name: 'marker', label: 'Marker' },
  { short: 'M', name: 'memory', label: 'Marker' },
]

/** @type { PLC_Symbol[] } */
const system_symbols = [
  { name: 'P_100ms', location: 'control', type: 'bit', address: 2.0, initial_value: 0, comment: '100ms pulse' },
  { name: 'P_200ms', location: 'control', type: 'bit', address: 2.1, initial_value: 0, comment: '200ms pulse' },
  { name: 'P_300ms', location: 'control', type: 'bit', address: 2.2, initial_value: 0, comment: '300ms pulse' },
  { name: 'P_500ms', location: 'control', type: 'bit', address: 2.3, initial_value: 0, comment: '500ms pulse' },
  { name: 'P_1s', location: 'control', type: 'bit', address: 2.4, initial_value: 0, comment: '1 second pulse' },
  { name: 'P_2s', location: 'control', type: 'bit', address: 2.5, initial_value: 0, comment: '2 second pulse' },
  { name: 'P_5s', location: 'control', type: 'bit', address: 2.6, initial_value: 0, comment: '5 second pulse' },
  { name: 'P_10s', location: 'control', type: 'bit', address: 2.7, initial_value: 0, comment: '10 second pulse' },
  { name: 'P_30s', location: 'control', type: 'bit', address: 3.0, initial_value: 0, comment: '30 second pulse' },
  { name: 'P_1min', location: 'control', type: 'bit', address: 3.1, initial_value: 0, comment: '1 minute pulse' },
  { name: 'P_2min', location: 'control', type: 'bit', address: 3.2, initial_value: 0, comment: '2 minute pulse' },
  { name: 'P_5min', location: 'control', type: 'bit', address: 3.3, initial_value: 0, comment: '5 minute pulse' },
  { name: 'P_10min', location: 'control', type: 'bit', address: 3.4, initial_value: 0, comment: '10 minute pulse' },
  { name: 'P_15min', location: 'control', type: 'bit', address: 3.5, initial_value: 0, comment: '15 minute pulse' },
  { name: 'P_30min', location: 'control', type: 'bit', address: 3.6, initial_value: 0, comment: '30 minute pulse' },
  { name: 'P_1hr', location: 'control', type: 'bit', address: 3.7, initial_value: 0, comment: '1 hour pulse' },
  { name: 'P_2hr', location: 'control', type: 'bit', address: 4.0, initial_value: 0, comment: '2 hour pulse' },
  { name: 'P_3hr', location: 'control', type: 'bit', address: 4.1, initial_value: 0, comment: '3 hour pulse' },
  { name: 'P_4hr', location: 'control', type: 'bit', address: 4.2, initial_value: 0, comment: '4 hour pulse' },
  { name: 'P_5hr', location: 'control', type: 'bit', address: 4.3, initial_value: 0, comment: '5 hour pulse' },
  { name: 'P_6hr', location: 'control', type: 'bit', address: 4.4, initial_value: 0, comment: '6 hour pulse' },
  { name: 'P_12hr', location: 'control', type: 'bit', address: 4.5, initial_value: 0, comment: '12 hour pulse' },
  { name: 'P_1day', location: 'control', type: 'bit', address: 4.6, initial_value: 0, comment: '1 day pulse' },

  { name: 'S_100ms', location: 'control', type: 'bit', address: 5.0, initial_value: 0, comment: '100ms square wave' },
  { name: 'S_200ms', location: 'control', type: 'bit', address: 5.1, initial_value: 0, comment: '200ms square wave' },
  { name: 'S_300ms', location: 'control', type: 'bit', address: 5.2, initial_value: 0, comment: '300ms square wave' },
  { name: 'S_500ms', location: 'control', type: 'bit', address: 5.3, initial_value: 0, comment: '500ms square wave' },
  { name: 'S_1s', location: 'control', type: 'bit', address: 5.4, initial_value: 0, comment: '1 second square wave' },
  { name: 'S_2s', location: 'control', type: 'bit', address: 5.5, initial_value: 0, comment: '2 second square wave' },
  { name: 'S_5s', location: 'control', type: 'bit', address: 5.6, initial_value: 0, comment: '5 second square wave' },
  { name: 'S_10s', location: 'control', type: 'bit', address: 5.7, initial_value: 0, comment: '10 second square wave' },
  { name: 'S_30s', location: 'control', type: 'bit', address: 6.0, initial_value: 0, comment: '30 second square wave' },
  { name: 'S_1min', location: 'control', type: 'bit', address: 6.1, initial_value: 0, comment: '1 minute square wave' },
  { name: 'S_2min', location: 'control', type: 'bit', address: 6.2, initial_value: 0, comment: '2 minute square wave' },
  { name: 'S_5min', location: 'control', type: 'bit', address: 6.3, initial_value: 0, comment: '5 minute square wave' },
  { name: 'S_10min', location: 'control', type: 'bit', address: 6.4, initial_value: 0, comment: '10 minute square wave' },
  { name: 'S_15min', location: 'control', type: 'bit', address: 6.5, initial_value: 0, comment: '15 minute square wave' },
  { name: 'S_30min', location: 'control', type: 'bit', address: 6.6, initial_value: 0, comment: '30 minute square wave' },
  { name: 'S_1hr', location: 'control', type: 'bit', address: 6.7, initial_value: 0, comment: '1 hour square wave' },

  { name: 'elapsed_days', location: 'control', type: 'byte', address: 8.0, initial_value: 0, comment: 'Elapsed days' },
  { name: 'elapsed_hours', location: 'control', type: 'byte', address: 9.0, initial_value: 0, comment: 'Elapsed hours' },
  { name: 'elapsed_minutes', location: 'control', type: 'byte', address: 10.0, initial_value: 0, comment: 'Elapsed minutes' },
  { name: 'elapsed_seconds', location: 'control', type: 'byte', address: 11.0, initial_value: 0, comment: 'Elapsed seconds' },

  { name: 'system_uptime', location: 'control', type: 'dint', address: 12.0, initial_value: 0, comment: 'System uptime in seconds' },
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
    'K': 'control',
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
          
          if (absoluteAddr >= 0 && absoluteAddr < editor.memory.length) {
            const view = new DataView(editor.memory.buffer, editor.memory.byteOffset, editor.memory.byteLength)
            try {
              switch (effectiveType) {
                case 'i8':
                  liveValue = view.getInt8(absoluteAddr)
                  break
                case 'u8':
                  liveValue = view.getUint8(absoluteAddr)
                  break
                case 'i16':
                  if (absoluteAddr + 2 <= editor.memory.length)
                    liveValue = view.getInt16(absoluteAddr, true)
                  break
                case 'u16':
                  if (absoluteAddr + 2 <= editor.memory.length)
                    liveValue = view.getUint16(absoluteAddr, true)
                  break
                case 'i32':
                  if (absoluteAddr + 4 <= editor.memory.length)
                    liveValue = view.getInt32(absoluteAddr, true)
                  break
                case 'u32':
                  if (absoluteAddr + 4 <= editor.memory.length)
                    liveValue = view.getUint32(absoluteAddr, true)
                  break
                case 'f32':
                  if (absoluteAddr + 4 <= editor.memory.length)
                    liveValue = view.getFloat32(absoluteAddr, true)
                  break
                case 'f64':
                  if (absoluteAddr + 8 <= editor.memory.length)
                    liveValue = view.getFloat64(absoluteAddr, true)
                  break
                default:
                  // Default to i16 for word operations
                  if (absoluteAddr + 2 <= editor.memory.length)
                    liveValue = view.getInt16(absoluteAddr, true)
              }
            } catch (e) {
              // Ignore read errors
            }
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
/** @type {(editor: VovkPLCEditor, like: 'symbol' | 'highlight', ctx: CanvasRenderingContext2D , link: LadderLink) => void} */
const draw_connection = (editor, like, ctx, link) => {
  // Draw a connection line from the output of the from block to the input of the to block
  // If the target block is bellow the source block, draw the vertical line first
  // If the target block is above the source block, draw the horizontal line first
  // If the target block is to the right, just draw a straight line
  const { ladder_block_width, ladder_block_height, style } = editor.properties
  const { line_width, highlight_width, highlight_color, highlight_sim_color, color } = style
  const { from, to, powered } = link
  const x0 = from.x * ladder_block_width + ladder_block_width
  const y0 = from.y * ladder_block_height + ladder_block_height / 2
  const x1 = to.x * ladder_block_width
  const y1 = to.y * ladder_block_height + ladder_block_height / 2

  const x_direction = x0 < x1 ? 1 : x0 > x1 ? -1 : 0
  const y_direction = y0 < y1 ? 1 : y0 > y1 ? -1 : 0
  if (x_direction === 0 && y_direction === 0) return // elements are touching, no need to draw a connection
  if (like === 'highlight') {
    if (powered) {
      // Use cyan for simulation, lime green for device/serial mode
      const isSimulation = editor.window_manager.active_device === 'simulation'
      const activeColor = isSimulation ? '#00ffff' : '#32cd32'
      ctx.strokeStyle = activeColor
      ctx.lineWidth = highlight_width
      ctx.beginPath()
      if (x_direction === 0) {
        if (y_direction > 0) ctx.moveTo(x0, y0 - 4)
        if (y_direction < 0) ctx.moveTo(x0, y0 + 4)
      } else {
        ctx.moveTo(x0, y0)
      }
      if (x_direction > 0) ctx.lineTo(x1, y0)
      if (y_direction > 0) ctx.lineTo(x1, y1 + 4)
      if (y_direction < 0) ctx.lineTo(x1, y1 - 4)
      ctx.stroke()
    }
    return
  }

  if (like === 'symbol') {
    ctx.strokeStyle = color
    ctx.lineWidth = line_width
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    // if (y0 < y1) ctx.lineTo(x0, y1)
    // if (y0 > y1)
    ctx.lineTo(x1, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    return
  }

  throw new Error(`Invalid style: ${style}`)
}

/** @type {(editor: VovkPLCEditor, ladder: PLC_Ladder) => void} */
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
          { label: 'View Logic as Graph', name: 'view_graph', icon: 'json', type: 'item' },
          { label: 'View Logic as STL', name: 'view_stl', icon: 'code', type: 'item' },
          { label: 'View Logic as PLCASM', name: 'view_asm', icon: 'server', type: 'item' }
        ]

        if (editor.context_manager) {
          editor.context_manager.show(e, items, async (action) => {
            try {
              // 1. Convert Ladder to Graph format
              const graph = toGraph(block)

              let finalOutput = ''
              let titleSuffix = ''

              if (action === 'view_graph') {
                finalOutput = JSON.stringify(graph, null, 2)
                titleSuffix = 'Graph'
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
                  const asmResult = await editor.runtime.compile(finalOutput, { language: 'stl' })
                  if (!asmResult || typeof asmResult.output !== 'string') {
                    throw new Error('STL compilation failed to produce PLCASM')
                  }
                  finalOutput = asmResult.output
                  titleSuffix = 'PLCASM'
                }
              }

              // 4. Show Popup
              const pre = document.createElement('pre')
              Object.assign(pre.style, {
                margin: '0', padding: '10px', background: '#1e1e1e',
                color: '#d4d4d4', overflow: 'auto', maxHeight: '600px',
                whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace', fontSize: '12px'
              })
              pre.textContent = finalOutput

              new Popup({
                title: `Compiled ${titleSuffix} (${block.name})`,
                width: '600px',
                content: pre,
                buttons: [{ text: 'Close', value: 'close' }]
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
      select_color: '#456',
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
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 600

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas context not found')
      props.ctx = ctx
      props.canvas = canvas
      block_container.appendChild(canvas)

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

    // Check if this ladder has a selection and highlight the first selected block origin
    if (hasSelection && selection.length > 0) {
      const first_block = selection.find(s => s.type === 'block' || s.type === 'area')
      if (first_block) {
        const { x, y } = first_block
        ctx.strokeStyle = select_highlight_color
        ctx.lineWidth = 3
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.strokeRect(x * ladder_block_width, y * ladder_block_height, ladder_block_width, ladder_block_height)
        ctx.stroke()
      }
    }

    ctx.setLineDash([])

    // Draw the ladder blocks and connections
    evaluate_ladder(editor, block)

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
    connections.forEach(con => {
      // Prevent regenerating IDs for existing connections
      if (!con.id) con.id = editor._generateID()

      const from = blocks.find(b => b.id === con.from.id)
      const to = blocks.find(b => b.id === con.to.id)
      if (from && to) links.push({ from, to, powered: !!con.state?.powered })
    })

    links.forEach(link => {
      if (live) {
        draw_connection(editor, 'highlight', ctx, link)
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
      draw_connection(editor, 'symbol', ctx, link)
    })
    
    // Draw connection handles and wire in edit mode
    if (edit) {
      const connState = editor.ladder_connection_state?.[ladderId]
      if (connState) {
        const hover_x = connState.hover_x
        const hover_y = connState.hover_y
        const handleRadius = 8
        
        // Get the first selected block (if any) to show connection handles only on it
        const firstSelectedBlock = selection.length > 0 
          ? blocks.find(b => b.x === selection[0].x && b.y === selection[0].y)
          : null
        
        // Only show connection handles when dragging (for drop targets) or on first selected block
        const isDragging = connState.dragging_wire
        const startBlock = connState.wire_start_block
        const startSide = connState.wire_start_side
        
        // Draw handles on first selected block
        if (firstSelectedBlock && !isDragging) {
          const b = firstSelectedBlock
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
          
          blocks.forEach(b => {
            // Skip the source block
            if (b.id === startBlock.id) return
            
            const x0 = b.x * ladder_block_width
            const y_mid = b.y * ladder_block_height + ladder_block_height / 2
            const x1 = x0 + ladder_block_width
            
            const isSnapped = snappedBlock && b.id === snappedBlock.id
            const handleSize = isSnapped ? handleRadius * 1.5 : handleRadius
            
            // Determine which handle to show based on drag direction
            // If dragging from right, left side of blocks to the right is valid
            if (startSide === 'right' && b.x > startBlock.x) {
              ctx.beginPath()
              ctx.arc(x0, y_mid, handleSize, 0, Math.PI * 2)
              ctx.fillStyle = isSnapped ? '#8BC34A' : '#4CAF50'
              ctx.fill()
              ctx.strokeStyle = '#FFF'
              ctx.lineWidth = isSnapped ? 3 : 2
              ctx.stroke()
            }
            // If dragging from left, right side of blocks to the left is valid
            if (startSide === 'left' && b.x < startBlock.x) {
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
    snapped_block: null
  }
  const connState = editor.ladder_connection_state[ladderId]

  let is_dragging = false
  let is_moving = false
  let moving_elements = []
  let was_dragging = false
  let was_dragging_wire = false
  let start_x = 0
  let start_y = 0
  let end_x = 0
  let end_y = 0
  let temp_x = 0
  let temp_y = 0

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
    
    if (edit) {
      // Only allow wire drag from the first selected block (where handles are visible)
      const selected = editor.ladder_selection?.ladder_id === ladderId ? editor.ladder_selection.selection : []
      const firstSelectedBlock = selected.length > 0 
        ? ladder.blocks.find(b => b.x === selected[0].x && b.y === selected[0].y)
        : null
      
      if (firstSelectedBlock && firstSelectedBlock.x === x && firstSelectedBlock.y === y) {
        const block = firstSelectedBlock
        const x_in_cell = x_raw - x
        const y_in_cell = y_raw - y
        const handleRadius = 0.15 // Radius of connection handle in cell units
        const handleY = 0.5 // Y position of handle in cell (middle)
        
        // Check left handle (at x=0, y=0.5)
        const distToLeftHandle = Math.sqrt((x_in_cell - 0) ** 2 + (y_in_cell - handleY) ** 2)
        // Check right handle (at x=1, y=0.5)
        const distToRightHandle = Math.sqrt((x_in_cell - 1) ** 2 + (y_in_cell - handleY) ** 2)
        
        if (distToLeftHandle < handleRadius * 2) {
          // Start dragging from left handle
          connState.dragging_wire = true
          connState.wire_start_block = block
          connState.wire_start_side = 'left'
          connState.wire_end_x = start_x * getScale()
          connState.wire_end_y = start_y * getScale()
          connState.snapped_block = null
          ladderRenderer.render(editor, ladder)
          return
        }
        
        if (distToRightHandle < handleRadius * 2) {
          // Start dragging from right handle
          connState.dragging_wire = true
          connState.wire_start_block = block
          connState.wire_start_side = 'right'
          connState.wire_end_x = start_x * getScale()
          connState.wire_end_y = start_y * getScale()
          connState.snapped_block = null
          ladderRenderer.render(editor, ladder)
          return
        }
      }
    }
    
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
      temp_x = x
      temp_y = y
    }
  }

  /** @param { MouseEvent } event */
  const onMove = (event) => {
    event.preventDefault()
    
    const rect = canvas.getBoundingClientRect()
    const mouseX = Math.floor(event.clientX - rect.left)
    const mouseY = Math.floor(event.clientY - rect.top)
    
    // Always track hover position for connection handles (even when not dragging)
    const live = editor.device_manager.connected && !!editor.window_manager?.isMonitoringActive?.()
    const edit = !live
    
    if (edit) {
      const hover_x_raw = mouseX * getScale() / getBlockWidth()
      const hover_y_raw = mouseY * getScale() / getBlockHeight()
      connState.hover_x = hover_x_raw
      connState.hover_y = hover_y_raw
      
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
        
        ladder.blocks.forEach(b => {
          if (b.id === startBlock.id) return
          
          const y_mid = b.y * blockHeight + blockHeight / 2
          
          // Check if this is a valid target based on drag direction
          let targetX = null
          if (startSide === 'right' && b.x > startBlock.x) {
            // Valid target: left side of blocks to the right
            targetX = b.x * blockWidth
          } else if (startSide === 'left' && b.x < startBlock.x) {
            // Valid target: right side of blocks to the left
            targetX = (b.x + 1) * blockWidth
          }
          
          if (targetX !== null) {
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
        ladderRenderer.render(editor, ladder)
        return
      }
      
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
      // Move the selection
      // Calculate current cursor cell position
      const cursor_x_block = Math.floor(end_x * getScale() / getBlockWidth())
      const cursor_y_block = Math.floor(end_y * getScale() / getBlockHeight())
      
      const start_cell_x = temp_x
      const start_cell_y = temp_y
    
      const current_origin_x = editor.ladder_selection.origin.x
      const current_origin_y = editor.ladder_selection.origin.y
      
      // Let me try a cleaner approach: always compute from start
      const total_dx = cursor_x_block - start_cell_x
      const total_dy = cursor_y_block - start_cell_y
      
      // How much have we already moved?
      const already_dx = current_origin_x - start_cell_x
      const already_dy = current_origin_y - start_cell_y
      
      // How much more do we need to move?
      let dx = total_dx - already_dx
      let dy = total_dy - already_dy
      
      // Clamp target to valid range
      let target_x = current_origin_x + dx
      let target_y = current_origin_y + dy
      if (target_x < 0) {
        dx = -current_origin_x
        target_x = 0
      }
      if (target_y < 0) {
        dy = -current_origin_y
        target_y = 0
      }
      
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

    const x = Math.floor(start_x * getScale() / getBlockWidth())
    const y = Math.floor(start_y * getScale() / getBlockHeight())
    const width = Math.max(Math.round(1 + (end_x - start_x) * getScale() / getBlockWidth()), 1)
    const height = Math.max(Math.round(1 + (end_y - start_y) * getScale() / getBlockHeight()), 1)

    // Update selection area
    const ctrl = event.ctrlKey
    const shift = event.shiftKey
    const ctrl_or_shift = ctrl || shift
    if (ctrl_or_shift && editor.ladder_selection?.ladder_id === ladderId) {
      const exists = editor.ladder_selection.selection.find(sel => sel.type === 'area' && sel.x === x && sel.y === y)
      if (exists && exists.type === 'area') {
        exists.width = width
        exists.height = height
      } else {
        if (editor.ladder_selection.origin.x > x) editor.ladder_selection.origin.x = x
        if (editor.ladder_selection.origin.y > y) editor.ladder_selection.origin.y = y
        editor.ladder_selection.selection.push({ type: 'area', x, y, width, height })
      }
    } else {
      editor.ladder_selection = {
        ladder_id: ladderId,
        program_id: ladder.program_id || '',
        origin: { x, y },
        selection: [{ type: 'area', x, y, width, height }]
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
      
      // Use snapped block if available, otherwise find target block under cursor
      let targetBlock = snappedBlock
      let targetSide = null
      
      if (snappedBlock) {
        // Determine target side based on start side
        targetSide = startSide === 'right' ? 'left' : 'right'
      } else {
        // Find target block under cursor (fallback)
        const cursor_x = connState.wire_end_x / getBlockWidth()
        const cursor_y = connState.wire_end_y / getBlockHeight()
        const target_x = Math.floor(cursor_x)
        const target_y = Math.floor(cursor_y)
        targetBlock = ladder.blocks.find(b => b.x === target_x && b.y === target_y)
        
        if (targetBlock) {
          const x_in_cell = cursor_x - target_x
          targetSide = x_in_cell < 0.5 ? 'left' : 'right'
        }
      }
      
      if (targetBlock && targetBlock.id !== startBlock.id) {
        // Valid connection: right side of source -> left side of target
        // Or: left side of source -> right side of target (but target must be to the left)
        let fromBlock, toBlock
        if (startSide === 'right' && targetSide === 'left') {
          // Normal forward connection
          fromBlock = startBlock
          toBlock = targetBlock
        } else if (startSide === 'left' && targetSide === 'right') {
          // Backward direction - swap to make it forward
          fromBlock = targetBlock
          toBlock = startBlock
        }
        
        if (fromBlock && toBlock && fromBlock.x < toBlock.x) {
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
      ladderRenderer.render(editor, ladder)
      return
    }
    
    is_dragging = false
    was_dragging = true

    // Update connections after moving blocks
    if (is_moving) {
      is_moving = false
      connectTouchingBlocks(ladder)
      // Trigger redraw to show new connections
      ladderRenderer.render(editor, ladder)
      moving_elements = []
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
    const ctrl_or_shift = ctrl || shift
    if (ctrl_or_shift && editor.ladder_selection?.ladder_id === ladderId) {
      const exists = editor.ladder_selection.selection.some(sel => sel.type === 'block' && sel.x === x && sel.y === y)
      if (exists) {
        if (ctrl) {
          // Remove selected block
          editor.ladder_selection.selection = editor.ladder_selection.selection.filter(sel => !(sel.type === 'block' && sel.x === x && sel.y === y))
        }
      } else {
        if (editor.ladder_selection.origin.x > x) editor.ladder_selection.origin.x = x
        if (editor.ladder_selection.origin.y > y) editor.ladder_selection.origin.y = y
        editor.ladder_selection.selection.push({ type: 'block', x, y })
      }
    } else {
      if (editor.ladder_selection?.selection?.[0]?.type === 'area') {
        // Deselect the area selection first
        editor.ladder_selection = {
          ladder_id: ladderId,
          program_id: ladder.program_id || '',
          origin: { x, y },
          selection: []
        }
      } else {
        editor.ladder_selection = {
          ladder_id: ladderId,
          program_id: ladder.program_id || '',
          origin: { x, y },
          selection: [{ type: 'block', x, y }]
        }
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
    // onRelease already handles is_moving, connectTouchingBlocks, and re-render
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
                  type: 'submenu', name: 'insert_contacts', label: 'Contacts', items: [
                    { type: 'item', name: 'insert_contact', label: 'Contact (NO)' },
                    { type: 'item', name: 'insert_contact_nc', label: 'Contact (NC)' },
                    { type: 'item', name: 'insert_contact_rising', label: 'Rising Edge (P)' },
                    { type: 'item', name: 'insert_contact_falling', label: 'Falling Edge (N)' },
                  ]
                },
                {
                  type: 'submenu', name: 'insert_coils', label: 'Coils', items: [
                    { type: 'item', name: 'insert_coil', label: 'Coil (=)' },
                    { type: 'item', name: 'insert_coil_inverted', label: 'Inverted Coil (/)' },
                    { type: 'item', name: 'insert_coil_set', label: 'Set Coil (S)' },
                    { type: 'item', name: 'insert_coil_reset', label: 'Reset Coil (R)' },
                  ]
                },
                {
                  type: 'submenu', name: 'insert_timers', label: 'Timers', items: [
                    { type: 'item', name: 'insert_timer_ton', label: 'TON (On Delay)' },
                    { type: 'item', name: 'insert_timer_tof', label: 'TOF (Off Delay)' },
                    { type: 'item', name: 'insert_timer_tp', label: 'TP (Pulse)' },
                  ]
                },
                {
                  type: 'submenu', name: 'insert_counters', label: 'Counters', items: [
                    { type: 'item', name: 'insert_counter_u', label: 'CTU (Count Up)' },
                    { type: 'item', name: 'insert_counter_d', label: 'CTD (Count Down)' },
                  ]
                },
                {
                  type: 'submenu', name: 'insert_math', label: 'Math Operations', items: [
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
                  type: 'submenu', name: 'insert_compare', label: 'Compare Operations', items: [
                    { type: 'item', name: 'insert_fb_cmp_eq', label: 'EQ (Equal)' },
                    { type: 'item', name: 'insert_fb_cmp_neq', label: 'NEQ (Not Equal)' },
                    { type: 'item', name: 'insert_fb_cmp_gt', label: 'GT (Greater Than)' },
                    { type: 'item', name: 'insert_fb_cmp_lt', label: 'LT (Less Than)' },
                    { type: 'item', name: 'insert_fb_cmp_gte', label: 'GTE (Greater or Equal)' },
                    { type: 'item', name: 'insert_fb_cmp_lte', label: 'LTE (Less or Equal)' },
                  ]
                },
                {
                  type: 'submenu', name: 'insert_move', label: 'Move/Transfer', items: [
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
            { type: 'item', name: 'delete', label: 'Delete' },
            { type: 'separator' },
            { type: 'item', name: 'cut', label: 'Cut' },
            { type: 'item', name: 'copy', label: 'Copy' }
          )
        }

        if (edit) {
          menuItems.push({ type: 'item', name: 'paste', label: 'Paste' })
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
    const key = e.key.toLowerCase()

    // Handle Escape (Always) to deselect
    if (key === 'escape') {
      if (editor.ladder_selection?.ladder_id === ladderId) {
        editor.ladder_selection.selection = []
        editor.ladder_selection.origin = { x: 0, y: 0 }
        ladderRenderer.render(editor, ladder)
      }
      e.preventDefault()
      e.stopPropagation()
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
      // If we are editing text (like prompt), don't delete block?
      // Since prompt is a separate DOM element usually, this event typically won't fire on canvas if prompt has focus.
      deleteSelection(editor, ladder)
      ladderRenderer.render(editor, ladder)
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
      e.preventDefault()
    }

    if (ctrl && key === 'v') {
      const origin = editor.ladder_selection?.origin || { x: 0, y: 0 }
      pasteSelection(editor, ladder, origin.x, origin.y)
      ladderRenderer.render(editor, ladder)
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

  // Auto-connect touching blocks
  connectTouchingBlocks(ladder)

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

  const result = await Popup.form({
    title: `Edit ${blockTypeLabel}`,
    description: 'Enter symbol name or direct address (e.g. X0.0, Y0.0, M10.5)',
    inputs: [
      {
        name: 'symbol',
        label: 'Symbol / Address',
        type: 'text',
        value: currentSymbol,
        placeholder: 'e.g. Start_Button or X0.0'
      }
    ],
    buttons: [
      { text: 'OK', value: 'ok' },
      { text: 'Cancel', value: 'cancel' }
    ]
  })

  if (result && result.symbol !== undefined) {
    block.symbol = result.symbol.trim()
    // Clear cached state so it gets re-resolved
    block.state = undefined
    // Re-render the ladder
    if (ladder) {
      ladderRenderer.render(editor, ladder)
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
        placeholder: 'e.g. Timer_1 or T0'
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
    block.symbol = result.symbol.trim()
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
        placeholder: 'e.g. Counter_1 or C0'
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
    block.symbol = result.symbol.trim()
    block.preset = parseInt(result.preset) || 10

    // Clear cached state so it gets re-resolved
    block.state = undefined
    // Re-render the ladder
    if (ladder) {
      ladderRenderer.render(editor, ladder)
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
      placeholder: 'e.g. MB0, MW2, MD4, MR8'
    })
  } else {
    inputs.push({
      name: 'in1',
      label: isMove ? 'Source (IN)' : 'Input 1 (IN1)',
      type: 'text',
      value: currentIn1,
      placeholder: 'e.g. MW0, #100, MD4'
    })

    // Add IN2 for binary operations
    if (!isUnary && !isMove) {
      inputs.push({
        name: 'in2',
        label: 'Input 2 (IN2)',
        type: 'text',
        value: currentIn2,
        placeholder: 'e.g. MW2, #50'
      })
    }

    // Add output for math and move (not for compare - it sets RLO)
    if (isMath || isMove) {
      inputs.push({
        name: 'out',
        label: 'Output (OUT)',
        type: 'text',
        value: currentOut,
        placeholder: 'e.g. MW10, MD8'
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
      // INC/DEC uses symbol as the address
      block.symbol = result.address?.trim() || ''
      // Clear any legacy in1/out fields
      delete block.in1
      delete block.out
    } else {
      block.in1 = result.in1?.trim() || ''
      if (!isUnary && !isMove) {
        block.in2 = result.in2?.trim() || ''
      }
      if (isMath || isMove) {
        block.out = result.out?.trim() || ''
        block.symbol = result.out?.trim() || '' // Use output as symbol for display
      }
    }

    // Clear cached state so it gets re-resolved
    block.state = undefined
    // Re-render the ladder
    if (ladder) {
      ladderRenderer.render(editor, ladder)
    }
  }
}

export default ladderRenderer
