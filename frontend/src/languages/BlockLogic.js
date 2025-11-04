import { PLCEditor, PLC_Symbol } from "../utils/types.js"

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
  const offset = editor.project.offsets[location].offset
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
  const { offset } = editor.project.offsets[symbol.location]
  const index = Math.floor(symbol.address)
  const bit = Math.round((symbol.address % 1) * 10) % 8
  const addr = offset + index
  const byte = editor.memory[addr]
  const updated = value ? (byte | (1 << bit)) : (byte & ~(1 << bit))
  editor.memory[addr] = updated
}
