import { PLCEditor, PLC_Symbol } from "../utils/types.js"
import { ensureOffsets } from "../utils/offsets.js"

/**
 * Get bit value from memory given a symbol
 * @param {PLCEditor} editor
 * @param {string | PLC_Symbol | undefined} symbol
 * @returns {number | boolean}
 */
export function getSymbolValue(editor, symbol) {
  if (typeof symbol === 'string') {
    symbol = editor.project.symbols.find(s => s.name === symbol)
  }
  if (!symbol) return false
  if (typeof symbol === 'string') return false
  const { location, address, type } = symbol
  const offsets = ensureOffsets(editor.project.offsets || {})
  const key = location === 'memory' ? 'marker' : location
  const offset = offsets[key]?.offset || 0
  const index = Math.floor(address)
  const bit = Math.round((address % 1) * 10) % 8
  const memoryByte = editor.memory[offset + index]
  return type === 'bit' ? ((memoryByte >> bit) & 1) : memoryByte
}

/**
 * Set bit value into memory for a symbol
 * @param {PLCEditor} editor
 * @param {PLC_Symbol} symbol
 * @param {boolean} value
 */
export function setSymbolBit(editor, symbol, value) {
  const offsets = ensureOffsets(editor.project.offsets || {})
  const key = symbol.location === 'memory' ? 'marker' : symbol.location
  const offset = offsets[key]?.offset || 0
  const index = Math.floor(symbol.address)
  const bit = Math.round((symbol.address % 1) * 10) % 8
  const addr = offset + index
  const byte = editor.memory[addr]
  const updated = value ? (byte | (1 << bit)) : (byte & ~(1 << bit))
  editor.memory[addr] = updated
}
