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
 *      state?: { active: boolean, powered: boolean, powered_input: boolean, terminated_input: boolean, terminated_output: boolean, evaluated: boolean, symbol?: PLC_Symbol } 
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
        
        // Helper to check if a block is a coil type
        const isCoilType = (type) => type === 'coil' || type === 'coil_set' || type === 'coil_rset'
        
        // Helper to check if a block is a timer type
        const isTimerType = (type) => type === 'timer_ton' || type === 'timer_tof' || type === 'timer_tp'
        
        // Helper to check if a block is a counter type
        const isCounterType = (type) => type === 'counter_u' || type === 'counter_d' ||
            type === 'counter_ctu' || type === 'counter_ctd' || type === 'counter_ctud'
        
        // Helper to check if a coil has non-coil downstream connections
        const hasNonCoilDownstream = (blockId) => {
            const outgoing = adjacencyMap.get(blockId) || []
            return outgoing.some(targetId => {
                const target = blocks.find(b => b.id === targetId)
                return target && !isCoilType(target.type)
            })
        }
        
        // Helper to check if a coil has ANY downstream connections (coil or not)
        const hasAnyDownstream = (blockId) => {
            const outgoing = adjacencyMap.get(blockId) || []
            return outgoing.length > 0
        }
        
        // Find all terminal outputs in this network
        // - Coils are terminals if they have NO downstream, or ONLY coil downstream
        //   (coils with non-coil downstream are mid-chain with TAP - not terminals)
        // - Timers/counters are terminal only if they have NO outgoing connections
        const networkTerminals = connectedBlocks.filter(b => {
            if (!network.has(b.id)) return false
            
            // Coils are terminals unless they have non-coil downstream (TAP coils)
            // TAP coils are mid-chain and feed into other logic
            if (isCoilType(b.type)) {
                return !hasNonCoilDownstream(b.id)
            }
            
            // Timers and counters are terminal only if they have no outgoing connections
            if (isTimerType(b.type) || isCounterType(b.type)) {
                const outgoing = adjacencyMap.get(b.id) || []
                return outgoing.length === 0
            }
            
            return false
        })
        
        // ========================================================================
        // BACKWARD TRAVERSAL WITH MEMOIZATION
        // Build expression for each terminal by tracing backward from it.
        // Cache expressions for blocks to avoid redundant computation.
        // Each terminal gets its own condition based on what leads TO it.
        // NOTE: TAP is NOT used in backward traversal. TAP is only for forward
        // traversal when building a single chain through the network.
        // ========================================================================
        
        // Cache for block expressions (memoization)
        const exprCache = new Map()
        
        /**
         * Build expression backward from a block, with memoization
         * @param {string} blockId 
         * @param {Set<string>} pathVisited - Blocks visited in current path (cycle detection)
         * @returns {object[]|null}
         */
        const buildExprMemo = (blockId, pathVisited = new Set()) => {
            if (pathVisited.has(blockId)) return null // Cycle
            
            // Check cache first
            if (exprCache.has(blockId)) {
                return exprCache.get(blockId)
            }
            
            const block = blocks.find(b => b.id === blockId)
            if (!block || !network.has(blockId)) return null
            
            pathVisited.add(blockId)
            
            // Filter inputs: exclude terminal coils (those with no downstream)
            // Coils with ANY downstream pass logic through
            const inputs = (reverseMap.get(blockId) || []).filter(id => {
                if (!network.has(id)) return false
                const inputBlock = blocks.find(b => b.id === id)
                if (!inputBlock) return false
                // Coils pass logic only if they have downstream (not terminals)
                if (isCoilType(inputBlock.type)) {
                    return hasAnyDownstream(inputBlock.id)
                }
                return true
            })
            
            const element = blockToElement(block)
            
            // Check if this is a coil with non-coil downstream (needs TAP after it)
            // TAP is needed when coil output feeds into contacts/timers/counters
            const needsTap = isCoilType(block.type) && hasNonCoilDownstream(block.id)
            
            // Check if this is a pass-through coil (coil with coil-only downstream)
            // These should NOT be included in expressions - they just pass through
            const isPassThroughCoil = isCoilType(block.type) && hasAnyDownstream(block.id) && !hasNonCoilDownstream(block.id)
            
            let result
            if (inputs.length === 0) {
                // Start block
                if (isPassThroughCoil) {
                    result = [] // Pass-through coil with no inputs - empty
                } else {
                    result = needsTap ? [element, { type: 'tap' }] : [element]
                }
            } else if (inputs.length === 1) {
                // Single input - series (AND)
                const inputExpr = buildExprMemo(inputs[0], new Set(pathVisited))
                if (isPassThroughCoil) {
                    // Pass through - don't add this coil, just return input expression
                    result = inputExpr ? [...inputExpr] : []
                } else if (inputExpr) {
                    result = needsTap 
                        ? [...inputExpr, element, { type: 'tap' }]
                        : [...inputExpr, element]
                } else {
                    result = needsTap ? [element, { type: 'tap' }] : [element]
                }
            } else {
                // Multiple inputs - parallel (OR)
                // Sort inputs by position (Y ascending, then X ascending) for predictable execution order
                const sortedInputs = [...inputs].sort((a, b) => {
                    const blockA = blocks.find(bl => bl.id === a)
                    const blockB = blocks.find(bl => bl.id === b)
                    if (!blockA || !blockB) return 0
                    if (blockA.y !== blockB.y) return blockA.y - blockB.y
                    return blockA.x - blockB.x
                })
                
                const branches = []
                for (const inputId of sortedInputs) {
                    const branchExpr = buildExprMemo(inputId, new Set(pathVisited))
                    if (branchExpr && branchExpr.length > 0) {
                        branches.push({ elements: [...branchExpr] })
                    }
                }
                
                if (isPassThroughCoil) {
                    // Pass through - don't add this coil
                    if (branches.length === 0) {
                        result = []
                    } else if (branches.length === 1) {
                        result = [...branches[0].elements]
                    } else {
                        result = [{ type: 'or', branches }]
                    }
                } else if (branches.length === 0) {
                    result = needsTap ? [element, { type: 'tap' }] : [element]
                } else if (branches.length === 1) {
                    result = needsTap
                        ? [...branches[0].elements, element, { type: 'tap' }]
                        : [...branches[0].elements, element]
                } else {
                    result = needsTap
                        ? [{ type: 'or', branches }, element, { type: 'tap' }]
                        : [{ type: 'or', branches }, element]
                }
            }
            
            exprCache.set(blockId, result)
            pathVisited.delete(blockId)
            return result
        }
        
        // Build condition for each terminal and group by condition
        const terminalsByExpr = new Map()
        
        for (const terminal of networkTerminals) {
            const inputs = (reverseMap.get(terminal.id) || []).filter(id => network.has(id))
            
            let conditionExpr = []
            if (inputs.length === 0) {
                conditionExpr = []
            } else if (inputs.length === 1) {
                const expr = buildExprMemo(inputs[0], new Set())
                conditionExpr = expr ? [...expr] : []
            } else {
                // Multiple inputs to terminal - OR them
                const branches = []
                for (const inputId of inputs) {
                    const branchExpr = buildExprMemo(inputId, new Set())
                    if (branchExpr && branchExpr.length > 0) {
                        branches.push({ elements: [...branchExpr] })
                    }
                }
                if (branches.length === 1) {
                    conditionExpr = branches[0].elements
                } else if (branches.length > 1) {
                    conditionExpr = [{ type: 'or', branches }]
                }
            }
            
            // Serialize for grouping - include terminal type in key to separate coil/set/reset
            const key = JSON.stringify({ 
                condition: conditionExpr, 
                termType: terminal.type 
            }, (k, v) => {
                if (k === 'id' || k === 'symbol') return undefined
                return v
            })
            
            if (!terminalsByExpr.has(key)) {
                terminalsByExpr.set(key, { condition: conditionExpr, terminals: [] })
            }
            terminalsByExpr.get(key).terminals.push(terminal)
        }
        
        // Create rungs for each group
        for (const [key, group] of terminalsByExpr) {
            const rungElements = [...group.condition]
            
            // Sort terminals by position (Y ascending, then X ascending) for predictable execution order
            const sortedTerminals = [...group.terminals].sort((a, b) => {
                if (a.y !== b.y) return a.y - b.y
                return a.x - b.x
            })
            
            // Add all terminals in this group
            for (const terminal of sortedTerminals) {
                const termElement = blockToElement(terminal)
                rungElements.push(termElement)
            }
            
            if (rungElements.length > 0) {
                rungs.push({
                    comment: ladder.comment || ladder.name,
                    elements: rungElements
                })
            }
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
