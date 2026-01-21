import { PLC_ContextState, PLC_Symbol } from "../../utils/types.js"
import { LanguageModule } from "../types.js"
import { evaluateLadder } from "./evaluator.js"


/** @typedef { 'contact' | 'coil' | 'coil_set' | 'coil_rset' | 'timer_ton' | 'timer_tof' | 'timer_tp' | 'counter_u' | 'counter_d' } PLC_Ladder_Block_Type * @type { PLC_Ladder_Block_Type } */
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
    // Add preset for counters (support old type names)
    if (['counter_u', 'counter_d', 'counter_ctu', 'counter_ctd', 'counter_ctud'].includes(block.type)) {
        // @ts-ignore
        element.preset = block.preset || 10
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
        const disconnectedCounters = blocks.filter(b => b.type === 'counter_u' || b.type === 'counter_d' || b.type === 'counter_ctu' || b.type === 'counter_ctd' || b.type === 'counter_ctud')
        
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
        if (disconnectedCounters.length > 0) {
            errors.push({
                message: `${disconnectedCounters.length} counter(s) not connected to any input: ${disconnectedCounters.map(b => b.symbol).join(', ')}`,
                type: 'error',
                blockIds: disconnectedCounters.map(b => b.id)
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
        const counters = disconnectedBlocks.filter(b => b.type === 'counter_u' || b.type === 'counter_d' || b.type === 'counter_ctu' || b.type === 'counter_ctd' || b.type === 'counter_ctud')
        
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
        if (counters.length > 0) {
            errors.push({
                message: `${counters.length} counter(s) not connected: ${counters.map(b => b.symbol).join(', ')}`,
                type: 'error',
                blockIds: counters.map(b => b.id)
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
    // Find timers/counters that have no incoming connections
    const outputsWithoutInputs = connectedBlocks.filter(b =>
        (b.type === 'timer_ton' || b.type === 'timer_tof' || b.type === 'timer_tp' ||
         b.type === 'counter_u' || b.type === 'counter_d' ||
         b.type === 'counter_ctu' || b.type === 'counter_ctd' || b.type === 'counter_ctud') &&
        (!reverseMap.has(b.id) || reverseMap.get(b.id).length === 0)
    )
    if (coilsWithoutInputs.length > 0) {
        errors.push({
            message: `${coilsWithoutInputs.length} coil(s) have no input path: ${coilsWithoutInputs.map(b => b.symbol).join(', ')}`,
            type: 'error',
            blockIds: coilsWithoutInputs.map(b => b.id)
        })
    }
    if (outputsWithoutInputs.length > 0) {
        errors.push({
            message: `${outputsWithoutInputs.length} timer/counter(s) have no input path: ${outputsWithoutInputs.map(b => b.symbol).join(', ')}`,
            type: 'error',
            blockIds: outputsWithoutInputs.map(b => b.id)
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

        // ========================================================================
        // BACKWARD TRAVERSAL ALGORITHM
        // Build expression tree by walking backward from outputs (coils) to inputs
        // This naturally creates the correct nested AND/OR structure
        // ========================================================================
        
        /**
         * Recursively build expression from a block backward to its inputs
         * @param {string} blockId - Current block ID
         * @param {Set<string>} visited - Visited blocks (cycle prevention)
         * @returns {object|object[]|null} - Expression element(s)
         */
        const buildExprBackward = (blockId, visited = new Set()) => {
            if (visited.has(blockId)) return null // Cycle prevention
            visited.add(blockId)
            
            const block = blocks.find(b => b.id === blockId)
            if (!block) return null
            
            const inputs = reverseMap.get(blockId) || []
            const element = blockToElement(block)
            
            // No inputs = start block (left rail contact)
            if (inputs.length === 0) {
                return element
            }
            
            // Single input = AND chain (series connection)
            if (inputs.length === 1) {
                const inputExpr = buildExprBackward(inputs[0], new Set(visited))
                if (!inputExpr) return element
                
                // Flatten: if inputExpr is an array, spread it; otherwise wrap
                const inputElements = Array.isArray(inputExpr) ? inputExpr : [inputExpr]
                return [...inputElements, element]
            }
            
            // Multiple inputs = OR (parallel branches merging here)
            // Each input path becomes a branch
            const branches = []
            for (const inputId of inputs) {
                const branchExpr = buildExprBackward(inputId, new Set(visited))
                if (branchExpr) {
                    // Normalize to array of elements
                    const branchElements = Array.isArray(branchExpr) ? branchExpr : [branchExpr]
                    branches.push({ elements: branchElements })
                }
            }
            
            if (branches.length === 0) return element
            if (branches.length === 1) {
                // Single valid branch - just AND with current element
                return [...branches[0].elements, element]
            }
            
            // Multiple branches - create OR, then AND with current element
            const orBlock = { type: 'or', branches }
            return [orBlock, element]
        }
        
        // Find all coils (outputs) in this network
        const networkCoils = connectedBlocks.filter(b => 
            network.has(b.id) && 
            (b.type === 'coil' || b.type === 'coil_set' || b.type === 'coil_rset' ||
             b.type === 'timer_ton' || b.type === 'timer_tof' || b.type === 'timer_tp' ||
             b.type === 'counter_u' || b.type === 'counter_d' ||
             b.type === 'counter_ctu' || b.type === 'counter_ctd' || b.type === 'counter_ctud')
        )
        
        // Group coils that share the same input(s) - parallel coils
        // Key: sorted input IDs joined, Value: array of coils
        const coilGroups = new Map()
        for (const coil of networkCoils) {
            const inputs = reverseMap.get(coil.id) || []
            const key = inputs.slice().sort().join(',')
            if (!coilGroups.has(key)) coilGroups.set(key, [])
            coilGroups.get(key).push(coil)
        }
        
        for (const [inputKey, coils] of coilGroups) {
            // Build the condition expression backward from the first coil's inputs
            // (All coils in group share the same inputs)
            const inputs = reverseMap.get(coils[0].id) || []
            
            let conditionElements = []
            
            if (inputs.length === 0) {
                // Coils with no inputs - unconditional (error case, but handle gracefully)
                conditionElements = []
            } else if (inputs.length === 1) {
                // Single input to coils
                const expr = buildExprBackward(inputs[0], new Set())
                if (expr) {
                    conditionElements = Array.isArray(expr) ? expr : [expr]
                }
            } else {
                // Multiple inputs to coils = OR of all input paths
                const branches = []
                for (const inputId of inputs) {
                    const branchExpr = buildExprBackward(inputId, new Set())
                    if (branchExpr) {
                        const branchElements = Array.isArray(branchExpr) ? branchExpr : [branchExpr]
                        branches.push({ elements: branchElements })
                    }
                }
                if (branches.length === 1) {
                    conditionElements = branches[0].elements
                } else if (branches.length > 1) {
                    conditionElements = [{ type: 'or', branches }]
                }
            }
            
            // Add ALL coils in this group as output elements
            for (const coil of coils) {
                conditionElements.push(blockToElement(coil))
            }
            
            rungs.push({
                comment: ladder.comment || ladder.name,
                elements: conditionElements
            })
        }
        
        // Mark all nodes in network as visited
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
