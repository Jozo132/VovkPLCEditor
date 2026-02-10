import ConnectionBase from "../ConnectionBase.js";
import { PLCEditor } from "../../utils/types.js";
import { ensureOffsets } from "../../utils/offsets.js";

export default class SimulationConnection extends ConnectionBase {
    deviceInfo = null
    _runTimer = null
    _runIntervalMs = 200
    editor
    onDisconnected = null

    /**
     * @param { PLCEditor } editor - The PLC editor instance
     */
    constructor(editor) {
        super();
        this.editor = editor
        this.plc = editor.runtime; // Use the inherited runtime from the editor
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
            db_table_offset: 0,
            db_slot_count: 0,
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
        // Try to get DB info from WASM exports
        const exports = this.plc?.wasm_exports
        if (exports && typeof exports.db_getSlotCount === 'function') {
            const slots = exports.db_getSlotCount()
            const active = exports.db_getActiveCount()
            const table_offset = typeof exports.db_getTableOffset === 'function' ? exports.db_getTableOffset() : 0
            const free_space = typeof exports.db_getFreeSpace === 'function' ? exports.db_getFreeSpace() : 0
            const lowest_address = typeof exports.db_getLowestAddress === 'function' ? exports.db_getLowestAddress() : 0
            const entries = []
            for (let i = 0; i < slots; i++) {
                const db = exports.db_getEntryDB(i)
                if (db === 0) continue
                const offset = exports.db_getEntryOffset(i)
                const size = exports.db_getEntrySize(i)
                entries.push({ db, offset, size })
            }
            return { slots, active, table_offset, free_space, lowest_address, entries }
        }
        // Fallback: no DB support in this WASM build
        return { slots: 0, active: 0, table_offset: 0, free_space: 0, lowest_address: 0, entries: [] }
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
