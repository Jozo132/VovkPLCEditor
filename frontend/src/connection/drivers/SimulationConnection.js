import ConnectionBase from "../ConnectionBase.js";
import { PLCEditor } from "../../utils/types.js";
import { ensureOffsets } from "../../utils/offsets.js";

/** @typedef { import('../../wasm/VovkPLC.js').default } VovkPLC_class */

export default class SimulationConnection extends ConnectionBase {
    deviceInfo = null
    _runTimer = null
    _runIntervalMs = 200
    editor
    onDisconnected = null

    /** @type { VovkPLC_class } */
    plc

    /**
     * @param { PLCEditor } editor - The PLC editor instance
     */
    constructor(editor) {
        super();
        this.editor = editor
        this.plc = /** @type { VovkPLC_class } */ (editor.runtime) // Simulation always uses local WASM, not worker
    }

    async connect() {
        await this.plc.initialize();
        const offsets = this.editor?.project?.offsets
        if (offsets && typeof this.plc.setRuntimeOffsets === 'function') {
            const normalized = ensureOffsets(offsets)
            await this.plc.setRuntimeOffsets(
                normalized.system.offset,
                normalized.input.offset,
                normalized.output.offset,
                normalized.marker.offset
            )
        }
        this._startRunLoop()
    }
    async disconnect() {
        this._stopRunLoop()
    }

    async getInfo() {
        const info = this.plc.printInfo()
        // If printInfo returns valid object data, use it
        if (info && typeof info === 'object' && info.arch) {
            return info
        }
        // Fallback: try to use cached runtime info from editor
        const cachedInfo = this.editor?.runtime_info
        if (cachedInfo && typeof cachedInfo === 'object' && cachedInfo.arch) {
            return cachedInfo
        }
        // Last resort: provide default simulator info using project offsets
        const offsets = this.editor?.project?.offsets
        const normalized = offsets ? ensureOffsets(offsets) : null
        const now = new Date()
        const dateStr = now.toISOString().replace('T', ' ').substring(0, 19)
        return {
            header: 'VovkPLCRuntime',
            arch: 'WASM',
            version: '0.1.0',
            date: dateStr,
            device: 'Simulator',
            stack: 1024,
            memory: this.plc.memory_size || 32768,
            program: this.plc.program_size || 32768,
            system_offset: normalized?.system?.offset ?? 0,
            system_size: normalized?.system?.size ?? 64,
            input_offset: normalized?.input?.offset ?? 64,
            input_size: normalized?.input?.size ?? 64,
            output_offset: normalized?.output?.offset ?? 128,
            output_size: normalized?.output?.size ?? 64,
            marker_offset: normalized?.marker?.offset ?? 192,
            marker_size: normalized?.marker?.size ?? 256,
            timer_offset: normalized?.timer?.offset ?? 0,
            timer_count: 0,
            timer_struct_size: 9,
            counter_offset: normalized?.counter?.offset ?? 0,
            counter_count: 0,
            counter_struct_size: 5,
            flags: 1, // WASM is always little-endian
            isLittleEndian: true,
            db_table_offset: typeof this.plc.dbGetTableOffset === 'function' ? this.plc.dbGetTableOffset() : 0,
            db_slot_count: typeof this.plc.dbGetSlotCount === 'function' ? this.plc.dbGetSlotCount() : 0,
            db_entry_size: 6,
        }
    }

    async reboot() {
        // Optionally reset memory or re-initialize
        await this.connect();
    }

    async run() {
        return this.plc.run();
    }

    async stop() {
        this._stopRunLoop()
    }

    async downloadProgram(bytecode) {
        // Use downloadBytecodeHex which writes hex directly to WASM memory,
        // bypassing streamIn/streamRead which stops at null bytes (0x00).
        if (this.plc.downloadBytecodeHex) {
            return this.plc.downloadBytecodeHex(bytecode)
        }
        // Fallback to stream-based download for older WASM builds
        return this.plc.downloadBytecode(bytecode);
    }

    async uploadProgram() {
        return this.plc.extractProgram();
    }

    async readMemory(address, size) {
        return this.plc.readMemoryArea(address, size);
    }

    async writeMemory(address, data) {
        return this.plc.writeMemoryArea(address, data);
    }

    async writeMemoryArea(address, data) {
        return this.writeMemory(address, data);
    }

    async writeMemoryAreaMasked(address, data, mask) {
        return this.plc.writeMemoryAreaMasked(address, data, mask);
    }

    async formatMemory(address, size, value) {
        const data = Array(size).fill(value);
        return this.writeMemory(address, data);
    }

    async monitor() {
        // Implement monitoring logic if applicable
    }

    async getSymbolList() {
        // Simulator doesn't have device symbols - return empty array
        return []
    }

    async getTransportInfo() {
        // Simulator doesn't have physical transports - return empty array
        return []
    }

    async getDataBlockInfo() {
        // Use high-level DB API when available
        if (typeof this.plc.dbGetSlotCount === 'function') {
            try {
                const slots = this.plc.dbGetSlotCount()
                const active = this.plc.dbGetActiveCount()
                const table_offset = this.plc.dbGetTableOffset()
                const free_space = this.plc.dbGetFreeSpace()
                const lowest_address = this.plc.dbGetLowestAddress()
                const activeEntries = this.plc.dbGetActiveEntries()
                const entries = activeEntries.map(e => ({ db: e.db_number, offset: e.offset, size: e.size }))
                return { slots, active, table_offset, free_space, lowest_address, entries }
            } catch (e) {
                console.warn('[SimulationConnection] DB high-level API error, falling back:', e)
            }
        }
        // Fallback: no DB support in this WASM build
        return { slots: 0, active: 0, table_offset: 0, free_space: 0, lowest_address: 0, entries: [] }
    }

    /**
     * Declare a DataBlock in the simulator runtime
     * @param {number} dbNumber - DB number (1-based)
     * @param {number} size - Size in bytes
     * @returns {Promise<number>} Slot index on success, -1 on failure
     */
    async declareDataBlock(dbNumber, size) {
        if (typeof this.plc.dbDeclare !== 'function') throw new Error('dbDeclare not available')
        return this.plc.dbDeclare(dbNumber, size)
    }

    /**
     * Remove a DataBlock from the simulator runtime
     * @param {number} dbNumber - DB number to remove
     * @returns {Promise<boolean>} True on success
     */
    async removeDataBlock(dbNumber) {
        if (typeof this.plc.dbRemove !== 'function') throw new Error('dbRemove not available')
        return this.plc.dbRemove(dbNumber)
    }

    /**
     * Compact all DataBlocks (pack them tightly against the lookup table)
     * @returns {Promise<number>} New lowest allocated address
     */
    async compactDataBlocks() {
        if (typeof this.plc.dbCompact !== 'function') throw new Error('dbCompact not available')
        return this.plc.dbCompact()
    }

    /**
     * Clear all DataBlock entries
     * @returns {Promise<void>}
     */
    async formatDataBlocks() {
        if (typeof this.plc.dbFormat !== 'function') throw new Error('dbFormat not available')
        this.plc.dbFormat()
    }

    /**
     * Read an entire DataBlock's raw data
     * @param {number} dbNumber - DB number to read
     * @returns {Promise<{ data: Uint8Array, offset: number, size: number }>}
     */
    async readDataBlock(dbNumber) {
        if (typeof this.plc.dbReadAll !== 'function') throw new Error('dbReadAll not available')
        return this.plc.dbReadAll(dbNumber)
    }

    /**
     * Read a typed value from a DataBlock
     * @param {number} dbNumber - DB number
     * @param {number} dbOffset - Byte offset within the DB
     * @param {'u8'|'i8'|'u16'|'i16'|'u32'|'i32'|'f32'|'f64'} type - Data type
     * @returns {Promise<number>}
     */
    async readDataBlockValue(dbNumber, dbOffset, type = 'u8') {
        if (typeof this.plc.dbRead !== 'function') throw new Error('dbRead not available')
        return this.plc.dbRead(dbNumber, dbOffset, type)
    }

    /**
     * Write a typed value to a DataBlock
     * @param {number} dbNumber - DB number
     * @param {number} dbOffset - Byte offset within the DB
     * @param {number} value - Value to write
     * @param {'u8'|'i8'|'u16'|'i16'|'u32'|'i32'|'f32'|'f64'} type - Data type
     * @returns {Promise<void>}
     */
    async writeDataBlockValue(dbNumber, dbOffset, value, type = 'u8') {
        if (typeof this.plc.dbWrite !== 'function') throw new Error('dbWrite not available')
        this.plc.dbWrite(dbNumber, dbOffset, value, type)
    }

    /**
     * Read a named field from a DataBlock using compiler metadata
     * @param {number} dbNumber - DB number
     * @param {string} fieldName - Field name
     * @returns {Promise<number>}
     */
    async readDataBlockField(dbNumber, fieldName) {
        if (typeof this.plc.dbReadField !== 'function') throw new Error('dbReadField not available')
        return this.plc.dbReadField(dbNumber, fieldName)
    }

    /**
     * Write a named field to a DataBlock using compiler metadata
     * @param {number} dbNumber - DB number
     * @param {string} fieldName - Field name
     * @param {number} value - Value to write
     * @returns {Promise<void>}
     */
    async writeDataBlockField(dbNumber, fieldName, value) {
        if (typeof this.plc.dbWriteField !== 'function') throw new Error('dbWriteField not available')
        this.plc.dbWriteField(dbNumber, fieldName, value)
    }

    /**
     * Read all fields of a DataBlock as key-value pairs
     * @param {number} dbNumber - DB number
     * @returns {Promise<Record<string, number>>}
     */
    async readDataBlockFields(dbNumber) {
        if (typeof this.plc.dbReadFields !== 'function') throw new Error('dbReadFields not available')
        return this.plc.dbReadFields(dbNumber)
    }

    /**
     * Write multiple fields to a DataBlock
     * @param {number} dbNumber - DB number
     * @param {Record<string, number>} values - Field name -> value map
     * @returns {Promise<void>}
     */
    async writeDataBlockFields(dbNumber, values) {
        if (typeof this.plc.dbWriteFields !== 'function') throw new Error('dbWriteFields not available')
        this.plc.dbWriteFields(dbNumber, values)
    }

    /**
     * Get all compiler-declared DataBlock definitions (available after compilation)
     * @returns {Promise<Array<{ db_number: number, alias: string, totalSize: number, computedOffset: number, fields: Array<{ name: string, typeName: string, typeSize: number, offset: number, hasDefault: boolean, defaultValue: number }> }>>}
     */
    async getDataBlockDeclarations() {
        if (typeof this.plc.dbGetAllDecls !== 'function') throw new Error('dbGetAllDecls not available')
        return this.plc.dbGetAllDecls()
    }

    async getHealth() {
        if (!this.plc || typeof this.plc.getDeviceHealth !== 'function') {
            throw new Error("Device health not supported")
        }
        return this.plc.getDeviceHealth()
    }

    async resetHealth() {
        if (!this.plc || typeof this.plc.resetDeviceHealth !== 'function') {
            throw new Error("Device health not supported")
        }
        return this.plc.resetDeviceHealth()
    }

    _startRunLoop() {
        if (this._runTimer) return
        this._runTimer = setInterval(() => {
            try {
                this.plc.run()
            } catch (e) {
                // Ignore transient simulation errors
            }
        }, this._runIntervalMs)
    }

    _stopRunLoop() {
        if (this._runTimer) {
            clearInterval(this._runTimer)
            this._runTimer = null
        }
    }
}
