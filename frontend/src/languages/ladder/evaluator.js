import { getSymbolValue } from "../BlockLogic.js"
import { VovkPLCEditor } from "../../editor/Editor.js"
import { PLCEditor } from "../../utils/types.js"
import { PLC_Ladder, PLC_LadderBlock } from "./language.js"


/**
 * Extract symbol reference and compute block state
 * @param {PLCEditor} editor
 * @param {PLC_LadderBlock} block
 * @returns {PLC_LadderBlock}
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
  const { blocks, connections } = ladder

  // Reset state
  blocks.forEach(block => {
    resolveBlockState(editor, block)
    if (!block.state) throw new Error('Block state not resolved')
    const symbol = block.state.symbol
    const inverted = block.inverted
    let value = symbol ? getSymbolValue(editor, symbol) : false
    if (inverted) value = !value

    Object.assign(block.state, {
      active: !!value,
      powered: block.type === 'contact' && block.x === 0,
      powered_input: false,
      evaluated: false,
      terminated_input: false,
      terminated_output: false
    })
  })

  connections.forEach(c => {
    c.state = { powered: false, evaluated: false }
  })

  const startBlocks = blocks.filter(b => b.type === 'contact' && b.x === 0)
  const endBlocks = blocks.filter(b => !connections.some(c => c.from.id === b.id)) // @ts-ignore
  startBlocks.forEach(b => b.state.terminated_input = true) // @ts-ignore
  endBlocks.forEach(b => b.state.terminated_output = true)

  /**
   * @param {PLC_LadderBlock} block
   * @param {boolean} first
   * @param {boolean} inputPowered - whether the input to this block is powered
   */
  const propagate = (block, first, inputPowered = false) => {
    if (!block.state || block.state.evaluated) return
    
    const isContact = block.type === 'contact'
    const isCoil = ['coil', 'coil_set', 'coil_rset'].includes(block.type)
    const isTimer = ['timer_ton', 'timer_tof', 'timer_tp'].includes(block.type)
    const isCounter = ['counter_u', 'counter_d', 'counter_ctu', 'counter_ctd', 'counter_ctud'].includes(block.type)
    
    // Track input power state for all blocks
    block.state.powered_input = inputPowered
    
    if (isContact) {
      // Contacts: powered means signal can pass through
      // For start contacts (x=0), they're always receiving power from left rail
      if (first && block.x === 0) {
        block.state.powered_input = true
        inputPowered = true
      }
      // Contact output is powered only if input is powered AND contact is active (closed)
      const outputPowered = block.state.powered_input && block.state.active
      block.state.powered = outputPowered
      
      if (block.state.active) {
        block.state.evaluated = true
        const outs = connections.filter(c => c.from.id === block.id)
        outs.forEach(c => {
          if (!c.state) throw new Error('Connection state not resolved')
          c.state.powered = outputPowered
          c.state.evaluated = true
          const next = blocks.find(b => b.id === c.to.id)
          // Pass the actual output power state to downstream blocks
          if (next) propagate(next, false, outputPowered)
        })
      }
    } else if (isCoil) {
      // Coils: receive power and set their output based on input
      block.state.powered = inputPowered
      block.state.evaluated = true
      
      // Coils pass through power to any connected blocks
      const outs = connections.filter(c => c.from.id === block.id)
      outs.forEach(c => {
        if (!c.state) throw new Error('Connection state not resolved')
        c.state.powered = inputPowered
        c.state.evaluated = true
        const next = blocks.find(b => b.id === c.to.id)
        if (next) propagate(next, false, inputPowered)
      })
    } else if (isTimer) {
      // Timers: input power controls the timer, output depends on timer state
      block.state.powered = inputPowered
      block.state.evaluated = true
      
      // Timer output state depends on timer type and internal state (done flag)
      // The actual output state is computed in the renderer based on memory
      // Here we just pass through that the timer was reached
      const outs = connections.filter(c => c.from.id === block.id)
      outs.forEach(c => {
        if (!c.state) throw new Error('Connection state not resolved')
        // For timers, output power depends on timer output state (active flag from symbol)
        // TON: output ON when done (active = done)
        // TOF: output ON when !done (need to invert in renderer)
        // TP: output ON when running (elapsed > 0 && !done)
        c.state.powered = block.state.active
        c.state.evaluated = true
        const next = blocks.find(b => b.id === c.to.id)
        if (next) propagate(next, false, block.state.active)
      })
    } else if (isCounter) {
      // Counters: similar to timers
      block.state.powered = inputPowered
      block.state.evaluated = true
      
      const outs = connections.filter(c => c.from.id === block.id)
      outs.forEach(c => {
        if (!c.state) throw new Error('Connection state not resolved')
        c.state.powered = block.state.active
        c.state.evaluated = true
        const next = blocks.find(b => b.id === c.to.id)
        if (next) propagate(next, false, block.state.active)
      })
    }
  }

  startBlocks.forEach(b => propagate(b, true, true))
}