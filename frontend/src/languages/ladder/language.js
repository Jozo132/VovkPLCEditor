import { PLC_ContextState, PLC_Symbol } from "../../utils/types.js"
import { LanguageModule } from "../types.js"
import { evaluateLadder } from "./evaluator.js"


/** @typedef { 'contact' | 'coil' | 'coil_set' | 'coil_rset' | 'timer_ton' | 'timer_tof' | 'timer_tp' | 'counter_u' | 'counter_d' | 'fb_move' | 'fb_add' | 'fb_sub' | 'fb_mul' | 'fb_div' | 'fb_mod' | 'fb_neg' | 'fb_abs' | 'fb_inc' | 'fb_dec' | 'fb_cmp_eq' | 'fb_cmp_neq' | 'fb_cmp_gt' | 'fb_cmp_lt' | 'fb_cmp_gte' | 'fb_cmp_lte' } PLC_Ladder_Block_Type * @type { PLC_Ladder_Block_Type } */
export let PLC_Ladder_Block_Type

/** @typedef { 'normal' | 'rising' | 'falling' | 'change' } PLC_Trigger_Type * @type { PLC_Trigger_Type } */
export let PLC_Trigger_Type

/** @typedef { 'i16' | 'i32' | 'i64' | 'u8' | 'u16' | 'u32' | 'u64' | 'f32' | 'f64' } PLC_DataType * @type { PLC_DataType } */
export let PLC_DataType

/**
 * @typedef {{ 
 *      id: string, 
 *      x: number, 
 *      y: number, 
 *      type: PLC_Ladder_Block_Type, 
 *      inverted: boolean, 
 *      trigger: PLC_Trigger_Type, 
 *      symbol: string, 
 *      preset?: number | string,
 *      dataType?: PLC_DataType,
 *      in1?: string,
 *      in2?: string,
 *      out?: string,
 *      state?: { active: boolean, powered: boolean, powered_input: boolean, terminated_input: boolean, terminated_output: boolean, evaluated: boolean, symbol?: PLC_Symbol } 
 * }} PLC_LadderNode * @type { PLC_LadderNode }
**/
export let PLC_LadderNode

// Legacy alias for backwards compatibility
/** @typedef { PLC_LadderNode } PLC_LadderBlock */
export let PLC_LadderBlock

/**
 * New grouped connection format - any source activates all destinations
 * Also includes optional legacy fields for backward compatibility during migration
 * @typedef {{ 
 *      id?: string, 
 *      sources?: string[],
 *      destinations?: string[],
 *      from?: { id: string, offset?: number },
 *      to?: { id: string, offset?: number },
 *      state?: { powered: boolean, evaluated: boolean } 
 * }} PLC_LadderConnection * @type { PLC_LadderConnection }
**/
export let PLC_LadderConnection

/**
 * Legacy 1-to-1 connection format (for migration)
 * @typedef {{ 
 *      id?: string, 
 *      from: { id: string, offset?: number }, 
 *      to: { id: string, offset?: number }, 
 *      state?: { powered: boolean, evaluated: boolean } 
 * }} PLC_LadderConnectionLegacy
**/

/**
 * @typedef {{ 
 *      id?: string, 
 *      type: 'ladder', 
 *      name: string, 
 *      comment: string, 
 *      nodes?: PLC_LadderNode[], 
 *      blocks?: PLC_LadderNode[],
 *      connections: PLC_LadderConnection[], 
 *      div?: Element, 
 *      ctx?: CanvasRenderingContext2D, 
 *      mode?: PLC_ContextState,
 *      program_id?: string,
 *      cached_asm?: string,
 *      cached_checksum?: string,
 *      cached_symbols_checksum?: string,
 *      cached_asm_map?: any,
 *      cached_symbol_refs?: any,
 *      programId?: string
 * }} PLC_Ladder * @type { PLC_Ladder }
**/
export let PLC_Ladder

/**
 * Migrate legacy ladder block format to new format.
 * - Renames 'blocks' to 'nodes'
 * - Converts 1-to-1 connections ({ from: {id}, to: {id} }) to grouped format ({ sources: [], destinations: [] })
 * - Groups connections that share sources or destinations into single connections
 * @param {Object} ladder - The ladder block (may be legacy or new format)
 * @returns {PLC_Ladder} - The migrated ladder block
 */
export function migrateLadderBlock(ladder) {
    // Handle nodes/blocks naming
    if (ladder.blocks && !ladder.nodes) {
        ladder.nodes = ladder.blocks
        delete ladder.blocks
    }
    
    // If no connections, initialize empty array
    if (!ladder.connections) {
        ladder.connections = []
        return ladder
    }
    
    // Check if already in new format (has sources/destinations)
    if (ladder.connections.length > 0 && ladder.connections[0].sources) {
        return ladder // Already migrated
    }
    
    // Convert legacy 1-to-1 connections to new grouped format
    // Group connections by their connectivity pattern
    const legacyConnections = ladder.connections
    
    // Build adjacency maps to find groupable connections
    // Key insight: connections can be grouped if they form a "cross" pattern
    // where multiple sources all connect to the same set of destinations
    
    // First pass: collect all unique source->destination pairs
    /** @type {Map<string, Set<string>>} */
    const sourceToDestinations = new Map()
    /** @type {Map<string, Set<string>>} */
    const destinationToSources = new Map()
    
    for (const conn of legacyConnections) {
        const fromId = conn.from?.id
        const toId = conn.to?.id
        if (!fromId || !toId) continue
        
        if (!sourceToDestinations.has(fromId)) {
            sourceToDestinations.set(fromId, new Set())
        }
        sourceToDestinations.get(fromId).add(toId)
        
        if (!destinationToSources.has(toId)) {
            destinationToSources.set(toId, new Set())
        }
        destinationToSources.get(toId).add(fromId)
    }
    
    // Second pass: find groups of connections that can be merged
    // Two connections can be merged if:
    // - They share a source and can be combined into one source with multiple destinations
    // - They share destinations (all sources connect to all destinations - the cross pattern)
    
    const newConnections = []
    const processedPairs = new Set()
    
    // Group by finding cliques: sets of sources that all connect to the same set of destinations
    for (const [source, dests] of sourceToDestinations.entries()) {
        const destKey = [...dests].sort().join(',')
        
        // Find all sources that have the exact same destination set
        const sourcesWithSameDests = []
        for (const [s, d] of sourceToDestinations.entries()) {
            const key = [...d].sort().join(',')
            if (key === destKey) {
                sourcesWithSameDests.push(s)
            }
        }
        
        // Create a connection group key
        const groupKey = sourcesWithSameDests.sort().join('|') + '->' + destKey
        if (processedPairs.has(groupKey)) continue
        processedPairs.add(groupKey)
        
        // Create the grouped connection
        newConnections.push({
            id: `conn_${newConnections.length}`,
            sources: sourcesWithSameDests.sort(),
            destinations: [...dests].sort()
        })
    }
    
    ladder.connections = newConnections
    return ladder
}

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
/**
 * Check if a block type is an operation block (math, move, compare)
 * @param {string} type 
 * @returns {boolean}
 */
export function isFunctionBlock(type) {
    return type?.startsWith('fb_')
}

/**
 * Check if a block type is a math operation block
 * @param {string} type 
 * @returns {boolean}
 */
export function isMathBlock(type) {
    return ['fb_add', 'fb_sub', 'fb_mul', 'fb_div', 'fb_mod', 'fb_neg', 'fb_abs', 'fb_inc', 'fb_dec'].includes(type)
}

/**
 * Check if a block type is a compare operation block
 * @param {string} type 
 * @returns {boolean}
 */
export function isCompareBlock(type) {
    return ['fb_cmp_eq', 'fb_cmp_neq', 'fb_cmp_gt', 'fb_cmp_lt', 'fb_cmp_gte', 'fb_cmp_lte'].includes(type)
}

/**
 * Check if a block type is a move/transfer operation block
 * @param {string} type 
 * @returns {boolean}
 */
export function isMoveBlock(type) {
    return type === 'fb_move'
}

/**
 * Check if a math operation is unary (only needs one input)
 * @param {string} type 
 * @returns {boolean}
 */
export function isUnaryMathBlock(type) {
    return ['fb_neg', 'fb_abs', 'fb_inc', 'fb_dec'].includes(type)
}

/**
 * Check if block type is an increment/decrement operation
 * INC/DEC blocks read from and write to the same address
 * @param {string} type 
 * @returns {boolean}
 */
export function isIncDecBlock(type) {
    return ['fb_inc', 'fb_dec'].includes(type)
}

/**
 * Get the display label for an operation block type
 * @param {string} type 
 * @returns {string}
 */
export function getFunctionBlockLabel(type) {
    const labels = {
        'fb_move': 'MOVE',
        'fb_add': 'ADD',
        'fb_sub': 'SUB',
        'fb_mul': 'MUL',
        'fb_div': 'DIV',
        'fb_mod': 'MOD',
        'fb_neg': 'NEG',
        'fb_abs': 'ABS',
        'fb_inc': 'INC',
        'fb_dec': 'DEC',
        'fb_cmp_eq': 'EQ',
        'fb_cmp_neq': 'NEQ',
        'fb_cmp_gt': 'GT',
        'fb_cmp_lt': 'LT',
        'fb_cmp_gte': 'GTE',
        'fb_cmp_lte': 'LTE',
    }
    return labels[type] || type.replace('fb_', '').toUpperCase()
}

/**
 * Map operation block type to Network IR element type
 * @param {string} type 
 * @returns {string}
 */
function mapFunctionBlockToIRType(type) {
    const mapping = {
        'fb_move': 'move',
        'fb_add': 'math_add',
        'fb_sub': 'math_sub',
        'fb_mul': 'math_mul',
        'fb_div': 'math_div',
        'fb_mod': 'math_mod',
        'fb_neg': 'math_neg',
        'fb_abs': 'math_abs',
        'fb_inc': 'inc',
        'fb_dec': 'dec',
        'fb_cmp_eq': 'compare_eq',
        'fb_cmp_neq': 'compare_neq',
        'fb_cmp_gt': 'compare_gt',
        'fb_cmp_lt': 'compare_lt',
        'fb_cmp_gte': 'compare_gte',
        'fb_cmp_lte': 'compare_lte',
    }
    return mapping[type] || type
}

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
    // Handle operation blocks (math, move, compare)
    if (isFunctionBlock(block.type)) {
        element.type = mapFunctionBlockToIRType(block.type)
        // @ts-ignore
        element.dataType = block.dataType || 'i16'
        
        // INC/DEC: use single address parameter (reads and writes to same location)
        if (isIncDecBlock(block.type)) {
            // @ts-ignore
            element.address = block.symbol || ''
        } else {
            // @ts-ignore
            element.in1 = block.in1 || ''
            if (!isUnaryMathBlock(block.type) && !isMoveBlock(block.type)) {
                // @ts-ignore
                element.in2 = block.in2 || ''
            }
            // Output for math and move operations (not for compare - compare sets RLO)
            if (isMathBlock(block.type) || isMoveBlock(block.type)) {
                // @ts-ignore
                element.out = block.out || block.symbol || ''
            }
        }
    }
    return element
}

/**
 * Converts a node to the graph format expected by the runtime
 * @param {PLC_LadderNode} node 
 * @returns {Object}
 */
function nodeToGraphElement(node) {
    const element = {
        id: node.id,
        x: node.x,
        y: node.y,
        type: node.type,
        symbol: node.symbol,
        inverted: node.inverted || false,
    }
    
    // Only add trigger for contacts
    if (node.type === 'contact') {
        element.trigger = node.trigger || 'normal'
    }
    
    // Add preset for timers
    if (['timer_ton', 'timer_tof', 'timer_tp'].includes(node.type)) {
        element.preset = node.preset || 'T#1s'
    }
    
    // Add preset for counters
    if (['counter_u', 'counter_d', 'counter_ctu', 'counter_ctd', 'counter_ctud'].includes(node.type)) {
        element.preset = node.preset || 10
    }
    
    // Handle function blocks
    if (isFunctionBlock(node.type)) {
        element.dataType = node.dataType || 'i16'
        
        if (isIncDecBlock(node.type)) {
            // INC/DEC use single address
            element.address = node.symbol || ''
        } else {
            element.in1 = node.in1 || ''
            if (!isUnaryMathBlock(node.type) && !isMoveBlock(node.type)) {
                element.in2 = node.in2 || ''
            }
            if (isMathBlock(node.type) || isMoveBlock(node.type)) {
                element.out = node.out || node.symbol || ''
            }
        }
    }
    
    return element
}

/**
 * Serializes the ladder block as a graph structure for the runtime compiler.
 * The runtime will handle all the IR conversion, STL generation, and PLCASM compilation.
 * 
 * @param {PLC_Ladder} ladder - The editor's ladder block
 * @returns {{ nodes: Object[], connections: Object[], comment: string }}
 */
function serializeLadderGraph(ladder) {
    // Apply migration to ensure new format
    migrateLadderBlock(ladder)
    
    const nodes = (ladder.nodes || []).map(nodeToGraphElement)
    const connections = (ladder.connections || []).map(conn => ({
        sources: conn.sources || [],
        destinations: conn.destinations || []
    }))
    
    return {
        comment: ladder.comment || ladder.name || '',
        nodes,
        connections
    }
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
     * Compiles the ladder block to a graph JSON format wrapped in markers.
     * The actual transpilation (graph -> STL -> PLCASM) is done by the runtime.
     * 
     * @param {PLC_Ladder} block - The ladder block to compile
     * @returns {string} - The graph JSON wrapped in markers for later transpilation
     */
    compile(block) {
        if (block.type !== 'ladder') throw new Error('Invalid block type for ladder compilation')
        
        const graph = serializeLadderGraph(block)
        const graphJson = JSON.stringify(graph)
        
        // Return the graph JSON wrapped in markers
        // The ProjectManager will handle the actual transpilation via runtime
        return `// ladder_graph_start\n${graphJson}\n// ladder_graph_end\n`
    },

    toString(block) {
        return block.name + ' (' + block.type + ')'
    },
}

/**
 * Serializes a PLC_Ladder block to graph format.
 * Exported for direct use when needed outside the compile flow.
 * @param {PLC_Ladder} block 
 * @returns {{ nodes: Object[], connections: Object[], comment: string }}
 */
export function toGraph(block) {
    if (block.type !== 'ladder') throw new Error('Invalid block type for ladder conversion')
    return serializeLadderGraph(block)
}

export default ladderLanguage

