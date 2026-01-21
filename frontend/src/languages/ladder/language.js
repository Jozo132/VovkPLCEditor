import { PLC_ContextState, PLC_Symbol } from "../../utils/types.js"
import { LanguageModule } from "../types.js"
import { evaluateLadder } from "./evaluator.js"


/** @typedef { 'contact' | 'coil' | 'coil_set' | 'coil_rset' | 'timer_ton' | 'timer_tof' | 'timer_tp' } PLC_Ladder_Block_Type * @type { PLC_Ladder_Block_Type } */
export let PLC_Ladder_Block_Type

/** @typedef { 'normal' | 'rising' | 'falling' | 'change' } PLC_Trigger_Type * @type { PLC_Trigger_Type } */
export let PLC_Trigger_Type

/**
 * @typedef {{ 
 *      id: string, 
 *      x: number, 
 *      y: number, 
 *      type: PLC_Ladder_Block_Type, 
 *      inverted: boolean, 
 *      trigger: PLC_Trigger_Type, 
 *      symbol: string, 
 *      preset?: number,
 *      state?: { active: boolean, powered: boolean, terminated_input: boolean, terminated_output: boolean, evaluated: boolean, symbol?: PLC_Symbol } 
 * }} PLC_LadderBlock * @type { PLC_LadderBlock }
**/
export let PLC_LadderBlock

/**
 * @typedef {{ 
 *      id?: string, 
 *      from: { id: string, offset?: number }, 
 *      to: { id: string, offset?: number }, 
 *      state?: { powered: boolean, evaluated: boolean } 
 * }} PLC_LadderConnection * @type { PLC_LadderConnection }
**/
export let PLC_LadderConnection

/**
 * @typedef {{ 
 *      id?: string, 
 *      type: 'ladder', 
 *      name: string, 
 *      comment: string, 
 *      blocks: PLC_LadderBlock[], 
 *      connections: PLC_LadderConnection[], 
 *      div?: Element, 
 *      ctx?: CanvasRenderingContext2D, 
 *      mode?: PLC_ContextState
 * }} PLC_Ladder * @type { PLC_Ladder }
**/
export let PLC_Ladder

/**
 * @typedef {{ 
 *   rungs: Array<{ comment?: string, elements: Array, branches?: Array }>,
 *   errors: Array<{ message: string, type: 'error' | 'warning', blockIds?: string[] }>
 * }} LadderIRResult
 */

/**
 * Converts a PLC_LadderBlock to the runtime's element format
 * @param {PLC_LadderBlock} block 
 * @returns {{ type: string, address: string, inverted?: boolean, trigger?: string, preset?: string }}
 */
function blockToElement(block) {
    const element = {
        type: block.type,
        address: block.symbol,
        inverted: block.inverted || false,
    }
    // Only add trigger for contacts
    if (block.type === 'contact') {
        // @ts-ignore
        element.trigger = block.trigger || 'normal'
    }
    // Add preset for timers (pass as T# string directly)
    if (['timer_ton', 'timer_tof', 'timer_tp'].includes(block.type)) {
        // @ts-ignore
        element.preset = block.preset || 'T#1s'
    }
    return element
}

/**
 * Converts editor's ladder structure to the runtime's IR LADDER JSON format.
 * The editor uses blocks with (x,y) coordinates and connections between them.
 * The runtime expects rungs with elements in series and optional parallel branches.
 * 
 * IMPORTANT: Only blocks that are actually connected via the connections array
 * are included. Disconnected blocks are skipped to prevent false logic.
 * 
 * @param {PLC_Ladder} ladder - The editor's ladder block
 * @returns {LadderIRResult}
 */
function ladderToIR(ladder) {
    let { blocks, connections } = ladder
    /** @type {Array<{ message: string, type: 'error' | 'warning', blockIds?: string[] }>} */
    const errors = []
    
    if (!blocks || blocks.length === 0) {
        console.log('[ladderToIR] No blocks')
        return { rungs: [], errors }
    }

    // Auto-connect adjacent blocks if no connections exist
    // This handles the case where connections haven't been explicitly created
    if (!connections || connections.length === 0) {
        connections = []
        for (const block of blocks) {
            const x = block.x + 1
            const neighbors_right = blocks.filter(b => b.x === x && b.y === block.y)
            for (const neighbor of neighbors_right) {
                connections.push({
                    id: `auto_${block.id}_${neighbor.id}`,
                    from: { id: block.id },
                    to: { id: neighbor.id }
                })
            }
        }
    }

    // If still no connections after auto-connect, report errors
    if (connections.length === 0) {
        // All blocks are disconnected
        const disconnectedContacts = blocks.filter(b => b.type === 'contact')
        const disconnectedCoils = blocks.filter(b => b.type === 'coil' || b.type === 'coil_set' || b.type === 'coil_rset')
        const disconnectedTimers = blocks.filter(b => b.type === 'timer_ton' || b.type === 'timer_tof' || b.type === 'timer_tp')
        
        if (disconnectedContacts.length > 0) {
            errors.push({
                message: `${disconnectedContacts.length} contact(s) not connected to any output: ${disconnectedContacts.map(b => b.symbol).join(', ')}`,
                type: 'error',
                blockIds: disconnectedContacts.map(b => b.id)
            })
        }
        if (disconnectedCoils.length > 0) {
            errors.push({
                message: `${disconnectedCoils.length} coil(s) not connected to any input: ${disconnectedCoils.map(b => b.symbol).join(', ')}`,
                type: 'error',
                blockIds: disconnectedCoils.map(b => b.id)
            })
        }
        if (disconnectedTimers.length > 0) {
            errors.push({
                message: `${disconnectedTimers.length} timer(s) not connected to any input: ${disconnectedTimers.map(b => b.symbol).join(', ')}`,
                type: 'error',
                blockIds: disconnectedTimers.map(b => b.id)
            })
        }
        return { rungs: [], errors }
    }

    // Build adjacency maps from connections
    const adjacencyMap = new Map() // block.id -> array of connected block ids (forward direction)
    const reverseMap = new Map()   // block.id -> array of blocks connecting TO this block
    
    for (const conn of connections) {
        if (!adjacencyMap.has(conn.from.id)) adjacencyMap.set(conn.from.id, [])
        adjacencyMap.get(conn.from.id).push(conn.to.id)
        
        if (!reverseMap.has(conn.to.id)) reverseMap.set(conn.to.id, [])
        reverseMap.get(conn.to.id).push(conn.from.id)
    }

    // Find blocks that are actually connected (appear in at least one connection)
    const connectedBlockIds = new Set()
    for (const conn of connections) {
        connectedBlockIds.add(conn.from.id)
        connectedBlockIds.add(conn.to.id)
    }

    // Find disconnected blocks and report them
    const disconnectedBlocks = blocks.filter(b => !connectedBlockIds.has(b.id))
    if (disconnectedBlocks.length > 0) {
        const contacts = disconnectedBlocks.filter(b => b.type === 'contact')
        const coils = disconnectedBlocks.filter(b => b.type === 'coil' || b.type === 'coil_set' || b.type === 'coil_rset')
        const timers = disconnectedBlocks.filter(b => b.type === 'timer_ton' || b.type === 'timer_tof' || b.type === 'timer_tp')
        
        if (contacts.length > 0) {
            errors.push({
                message: `${contacts.length} contact(s) not connected: ${contacts.map(b => b.symbol).join(', ')}`,
                type: 'error',
                blockIds: contacts.map(b => b.id)
            })
        }
        if (coils.length > 0) {
            errors.push({
                message: `${coils.length} coil(s) not connected: ${coils.map(b => b.symbol).join(', ')}`,
                type: 'error',
                blockIds: coils.map(b => b.id)
            })
        }
        if (timers.length > 0) {
            errors.push({
                message: `${timers.length} timer(s) not connected: ${timers.map(b => b.symbol).join(', ')}`,
                type: 'error',
                blockIds: timers.map(b => b.id)
            })
        }
    }

    // Filter to only connected blocks
    const connectedBlocks = blocks.filter(b => connectedBlockIds.has(b.id))
    
    if (connectedBlocks.length === 0) {
        return { rungs: [], errors }
    }

    // Find starting blocks: contacts that have outgoing connections but no incoming connections
    // These are the true "left rail" entry points
    const startBlocks = connectedBlocks.filter(b => 
        b.type === 'contact' && 
        adjacencyMap.has(b.id) &&  // Has outgoing connections
        (!reverseMap.has(b.id) || reverseMap.get(b.id).length === 0) // No incoming connections
    )

    // Find coils that have no incoming connections
    const coilsWithoutInputs = connectedBlocks.filter(b =>
        (b.type === 'coil' || b.type === 'coil_set' || b.type === 'coil_rset') &&
        (!reverseMap.has(b.id) || reverseMap.get(b.id).length === 0)
    )
    if (coilsWithoutInputs.length > 0) {
        errors.push({
            message: `${coilsWithoutInputs.length} coil(s) have no input path: ${coilsWithoutInputs.map(b => b.symbol).join(', ')}`,
            type: 'error',
            blockIds: coilsWithoutInputs.map(b => b.id)
        })
    }

    const rungs = []
    const visitedBlocks = new Set()
    const contactsWithoutCoils = []
    
    // Group start blocks by connected component (Network)
    // All start blocks that can reach the same set of nodes should be in one Rung
    const networks = [] // Array of Set<string> (block IDs)
    
    // Build undirected graph for connected components
    const undirectedAdj = new Map()
    for (const [id, neighbors] of adjacencyMap.entries()) {
        if (!undirectedAdj.has(id)) undirectedAdj.set(id, [])
        undirectedAdj.get(id).push(...neighbors)
        for (const n of neighbors) {
            if (!undirectedAdj.has(n)) undirectedAdj.set(n, [])
            undirectedAdj.get(n).push(id)
        }
    }

    const componentVisited = new Set()
    for (const startBlock of startBlocks) {
        if (componentVisited.has(startBlock.id)) continue
        
        // BFS to find all connected blocks in this network
        const network = new Set()
        const q = [startBlock.id]
        network.add(startBlock.id)
        componentVisited.add(startBlock.id)
        
        while (q.length > 0) {
            const curr = q.shift()
            const neighbors = undirectedAdj.get(curr) || []
            for (const n of neighbors) {
                if (!network.has(n)) {
                    network.add(n)
                    componentVisited.add(n)
                    q.push(n)
                }
            }
        }
        networks.push(network)
    }

    // Process each network as one Rung
    for (const network of networks) {
        // Find all start blocks in this network
        const netStartBlocks = startBlocks.filter(b => network.has(b.id))
        
        // Sort start blocks by Y coordinate (Visual order: Top to Bottom)
        netStartBlocks.sort((a, b) => a.y - b.y)
        
        if (netStartBlocks.length === 0) continue

        // Helper to find common successor for a subset of nodes (Partial Convergence)
        const findConvergence = (nodes) => {
            if (nodes.length < 2) return null
            
            // Build reachability map: NodeId -> Set of StartNode indices
            const reachMap = new Map() 
            
            for (let i = 0; i < nodes.length; i++) {
                const startNode = nodes[i]
                const q = [startNode.id]
                const visited = new Set([startNode.id])
                
                while (q.length > 0) {
                    const curr = q.shift()
                    
                    // Register reachability
                    if (curr !== startNode.id) {
                         if (!reachMap.has(curr)) reachMap.set(curr, new Set())
                         reachMap.get(curr).add(i)
                    } else if (nodes.length > 1 && nodes.some((n, idx) => idx !== i && n.id === curr)) {
                         if (!reachMap.has(curr)) reachMap.set(curr, new Set())
                         reachMap.get(curr).add(i)
                    }
                    
                    const neighbors = adjacencyMap.get(curr) || []
                    for (const next of neighbors) {
                        if (network.has(next) && !visited.has(next)) {
                            visited.add(next)
                            q.push(next)
                        }
                    }
                }
            }
            
            // Find candidates reachable by at least 2 start nodes
            const candidates = []
            for (const [id, sources] of reachMap.entries()) {
                if (sources.size >= 2) candidates.push(id)
            }
            
            if (candidates.length === 0) return null
            
            // Filter candidates to find the "Topologically First" ones
            const reachableFromOthers = new Set()
            for (const c1 of candidates) {
                const q = [c1]
                const v = new Set([c1])
                while (q.length > 0) {
                    const curr = q.shift()
                    const neighbors = adjacencyMap.get(curr) || []
                    for (const n of neighbors) {
                        if (candidates.includes(n) && !v.has(n)) {
                            reachableFromOthers.add(n)
                            v.add(n)
                            q.push(n)
                        } else if (!v.has(n) && network.has(n)) {
                            v.add(n)
                            q.push(n)
                        }
                    }
                }
            }
            
            const roots = candidates.filter(c => !reachableFromOthers.has(c))
            if (roots.length === 0) return null
            
            const mergeNodeId = roots[0]
            const sourceIndices = reachMap.get(mergeNodeId)
            
            return {
                node: blocks.find(b => b.id === mergeNodeId),
                sources: nodes.filter((_, i) => sourceIndices.has(i))
            }
        }

        const traceGraph = (currentNodes, stopNodeId = null) => {
            const result = []
            
            while (currentNodes.length > 0) {
                const uniqueIds = [...new Set(currentNodes.map(n => n.id))]
                currentNodes = uniqueIds.map(id => blocks.find(b => b.id === id))

                if (stopNodeId && currentNodes.some(n => n.id === stopNodeId)) {
                    return result
                }

                // 1. Check for Convergence (Partial or Full)
                if (currentNodes.length > 1) {
                    const convergence = findConvergence(currentNodes)
                    
                    if (convergence) {
                        const { node: mergeNode, sources: convergingNodes } = convergence
                        
                        const branches = convergingNodes.map(node => ({
                            elements: traceGraph([node], mergeNode.id)
                        }))
                        
                        result.push({
                            type: 'or',
                            branches: branches
                        })
                        
                        const remainingNodes = currentNodes.filter(n => !convergingNodes.includes(n))
                        if (!remainingNodes.some(n => n.id === mergeNode.id)) {
                            remainingNodes.push(mergeNode)
                        }
                        
                        remainingNodes.sort((a,b) => a.y - b.y)
                        currentNodes = remainingNodes
                        continue
                    }
                }
                
                // 2. Sequential Processing
                if (currentNodes.length === 1) {
                    const node = currentNodes[0]
                    if (stopNodeId && node.id === stopNodeId) return result
                    
                    result.push(blockToElement(node))
                    
                    const nextIds = adjacencyMap.get(node.id) || []
                    const nextBlocks = nextIds.map(id => blocks.find(b => b.id === id))
                    
                    currentNodes = nextBlocks
                
                } else {
                    // Disjoint paths (no convergence found EVER)
                     const branches = currentNodes.map(node => ({
                        elements: traceGraph([node], null)
                    }))
                    
                    result.push({
                        type: 'or',
                        branches: branches
                    })
                    
                    currentNodes = []
                }
            }
            return result
        }

        const mainElements = traceGraph(netStartBlocks, null)
        
        // Push the rung with just elements (nested structure handles the complexity)
        rungs.push({
            comment: ladder.comment || ladder.name,
            elements: mainElements
        })
        
        // Mark all nodes in network as visited to avoid errors
        for (const id of network) visitedBlocks.add(id)
    }

    // Report contacts that don't lead to coils
    if (contactsWithoutCoils.length > 0) {
        errors.push({
            message: `${contactsWithoutCoils.length} contact path(s) don't reach any output: ${contactsWithoutCoils.map(b => b.symbol).join(', ')}`,
            type: 'error',
            blockIds: contactsWithoutCoils.map(b => b.id)
        })
    }

    return { rungs, errors }
}

/** @type { LanguageModule } */
export const ladderLanguage = {
    id: 'ladder',
    name: 'Ladder Diagram',

    evaluate(editor, block) {
        if (block.type !== 'ladder') throw new Error('Invalid block type for ladder evaluation')
        evaluateLadder(editor, block)
    },

    /**
     * Compiles the ladder block to IR LADDER JSON format wrapped in markers.
     * The actual transpilation (LADDER JSON -> STL -> PLCASM) is done by the runtime.
     * 
     * @param {PLC_Ladder} block - The ladder block to compile
     * @returns {string} - The IR LADDER JSON wrapped in markers for later transpilation
     */
    compile(block) {
        if (block.type !== 'ladder') throw new Error('Invalid block type for ladder compilation')
        
        const irResult = ladderToIR(block)
        // Include errors in the JSON so they can be extracted during transpilation
        const ladderJson = JSON.stringify({ rungs: irResult.rungs, errors: irResult.errors })
        
        // Return the ladder JSON wrapped in markers (similar to STL blocks)
        // The ProjectManager will handle the actual transpilation via runtime
        return `// ladder_block_start\n${ladderJson}\n// ladder_block_end\n`
    },

    toString(block) {
        return block.name + ' (' + block.type + ')'
    },
}

/**
 * Converts a PLC_Ladder block to IR LADDER JSON format with error tracking.
 * Exported for direct use when needed outside the compile flow.
 * @param {PLC_Ladder} block 
 * @returns {LadderIRResult}
 */
export function toIR(block) {
    if (block.type !== 'ladder') throw new Error('Invalid block type for ladder conversion')
    return ladderToIR(block)
}

export default ladderLanguage
