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
 * Set bit value into memory for a symbol - also writes to device if connected
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
  
  // Write to device if connected (Preferred)
  if (editor.device_manager?.connected && editor.device_manager?.connection) {
    const conn = editor.device_manager.connection
    // Try writeMemoryArea first, then writeMemory
    const method = conn.writeMemoryArea ? conn.writeMemoryArea.bind(conn) : (conn.writeMemory ? conn.writeMemory.bind(conn) : null)
    
    if (method) {
      // These methods are typically async in Connection drivers
      Promise.resolve(method(addr, [updated])).catch(err => {
        console.warn('Failed to write to device:', err)
      })
      return
    }
  }

  // Fallback: Write directly to runtime (e.g. WASM instance)
  // Check if runtime has the method and call it safely
  if (editor.runtime_ready && editor.runtime && typeof editor.runtime.writeMemoryArea === 'function') {
    try {
      const result = editor.runtime.writeMemoryArea(addr, [updated])
      // Handle if it happens to be a promise (though WASM imports usually aren't)
      if (result && typeof result.catch === 'function') {
        result.catch(err => {
          console.warn('Failed to write to runtime:', err)
        })
      }
    } catch (err) {
      console.warn('Failed to execute write on runtime:', err)
    }
  }
}
