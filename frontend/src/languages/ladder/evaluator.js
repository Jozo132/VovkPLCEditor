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
   */
  const propagate = (block, first) => {
    if (!block.state || block.state.evaluated) return
    const isCoil = ['coil', 'coil_set', 'coil_rset'].includes(block.type)
    const isTimer = ['timer_ton', 'timer_tof', 'timer_tp'].includes(block.type)
    const passThrough = (isCoil || isTimer) && !first
    if (passThrough || block.type === 'contact') {
      if (!first) block.state.powered = true
      if (block.state.active || passThrough) {
        block.state.evaluated = true
        const outs = connections.filter(c => c.from.id === block.id)
        outs.forEach(c => {
          if (!c.state) throw new Error('Connection state not resolved')
          c.state.powered = true
          c.state.evaluated = true
          const next = blocks.find(b => b.id === c.to.id)
          if (next) propagate(next, false)
        })
      }
    }
  }

  startBlocks.forEach(b => propagate(b, true))
}