import { getSymbolValue } from "../BlockLogic.js"
import { VovkPLCEditor } from "../../editor/Editor.js"
import { PLCEditor } from "../../utils/types.js"
import { PLC_Ladder, PLC_LadderBlock, PLC_LadderNode, isFunctionBlock, isCompareBlock, migrateLadderBlock } from "./language.js"


/**
 * Extract symbol reference and compute block state
 * @param {PLCEditor} editor
 * @param {PLC_LadderNode} block
 * @returns {PLC_LadderNode}
 */
export function resolveBlockState(editor, block) {
  if (!block.state) {
    const symbol = editor.project.symbols.find(s => s.name === block.symbol)
    block.state = {
      active: false,
      powered: false,
      powered_input: false,
      evaluated: false,
      terminated_input: false,
      terminated_output: false,
      symbol,
    }
  }
  return block
}

/**
 * Evaluate ladder block logic and connections
 * @param {VovkPLCEditor} editor
 * @param {PLC_Ladder} ladder
 */
export function evaluateLadder(editor, ladder) {
  // Ensure ladder is in new format
  migrateLadderBlock(ladder)
  
  const nodes = ladder.nodes || []
  const connections = ladder.connections || []

  // Build adjacency maps for new connection format
  // For each source, find all destinations it can reach
  const forwardMap = new Map()  // nodeId -> Set of destination nodeIds
  const reverseMap = new Map()  // nodeId -> Set of source nodeIds
  
  for (const conn of connections) {
    const sources = conn.sources || []
    const destinations = conn.destinations || []
    
    for (const srcId of sources) {
      if (!forwardMap.has(srcId)) forwardMap.set(srcId, new Set())
      for (const destId of destinations) {
        forwardMap.get(srcId).add(destId)
      }
    }
    
    for (const destId of destinations) {
      if (!reverseMap.has(destId)) reverseMap.set(destId, new Set())
      for (const srcId of sources) {
        reverseMap.get(destId).add(srcId)
      }
    }
  }

  // Reset state
  nodes.forEach(node => {
    resolveBlockState(editor, node)
    if (!node.state) throw new Error('Node state not resolved')
    const symbol = node.state.symbol
    const inverted = node.inverted
    let value = symbol ? getSymbolValue(editor, symbol) : false
    if (inverted) value = !value

    Object.assign(node.state, {
      active: !!value,
      powered: node.type === 'contact' && node.x === 0,
      powered_input: false,
      evaluated: false,
      terminated_input: false,
      terminated_output: false
    })
  })

  // Reset connection states
  connections.forEach(c => {
    c.state = { powered: false, evaluated: false }
  })

  const startNodes = nodes.filter(n => n.type === 'contact' && n.x === 0)
  const endNodes = nodes.filter(n => !forwardMap.has(n.id) || forwardMap.get(n.id).size === 0)
  startNodes.forEach(n => n.state.terminated_input = true)
  endNodes.forEach(n => n.state.terminated_output = true)

  /**
   * @param {PLC_LadderNode} node
   * @param {boolean} first
   * @param {boolean} inputPowered - whether the input to this node is powered
   */
  const propagate = (node, first, inputPowered = false) => {
    if (!node.state || node.state.evaluated) return
    
    const isContact = node.type === 'contact'
    const isCoil = ['coil', 'coil_set', 'coil_rset'].includes(node.type)
    const isTimer = ['timer_ton', 'timer_tof', 'timer_tp'].includes(node.type)
    const isCounter = ['counter_u', 'counter_d', 'counter_ctu', 'counter_ctd', 'counter_ctud'].includes(node.type)
    const isFB = isFunctionBlock(node.type)
    const isCompareFB = isCompareBlock(node.type)
    
    // Track input power state for all nodes
    node.state.powered_input = inputPowered
    
    // Get downstream nodes
    const downstreamIds = forwardMap.get(node.id) || new Set()
    const getDownstreamNodes = () => [...downstreamIds].map(id => nodes.find(n => n.id === id)).filter(Boolean)
    
    if (isContact) {
      // Contacts: powered means signal can pass through
      // For start contacts (x=0), they're always receiving power from left rail
      if (first && node.x === 0) {
        node.state.powered_input = true
        inputPowered = true
      }
      // Contact output is powered only if input is powered AND contact is active (closed)
      const outputPowered = node.state.powered_input && node.state.active
      node.state.powered = outputPowered
      
      if (node.state.active) {
        node.state.evaluated = true
        getDownstreamNodes().forEach(next => {
          propagate(next, false, outputPowered)
        })
      }
    } else if (isCoil) {
      // Coils: receive power and set their output based on input
      node.state.powered = inputPowered
      node.state.evaluated = true
      
      // Coils pass through power to any connected nodes
      getDownstreamNodes().forEach(next => {
        propagate(next, false, inputPowered)
      })
    } else if (isTimer) {
      // Timers: input power controls the timer, output depends on timer state
      node.state.powered = inputPowered
      node.state.evaluated = true
      
      getDownstreamNodes().forEach(next => {
        propagate(next, false, node.state.active)
      })
    } else if (isCounter) {
      // Counters: similar to timers
      node.state.powered = inputPowered
      node.state.evaluated = true
      
      getDownstreamNodes().forEach(next => {
        propagate(next, false, node.state.active)
      })
    } else if (isFB) {
      // Operation blocks: math/move blocks consume RLO like coils
      // Compare blocks produce boolean output for logic chain
      node.state.powered = inputPowered
      node.state.evaluated = true
      
      const outputPower = isCompareFB ? node.state.active : inputPowered
      getDownstreamNodes().forEach(next => {
        propagate(next, false, outputPower)
      })
    }
  }

  startNodes.forEach(n => propagate(n, true, true))
}