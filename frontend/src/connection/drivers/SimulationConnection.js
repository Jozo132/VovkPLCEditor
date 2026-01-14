import ConnectionBase from "../ConnectionBase.js";
import { PLCEditor } from "../../utils/types.js";
import { ensureOffsets } from "../../utils/offsets.js";

export default class SimulationConnection extends ConnectionBase {
    deviceInfo = null
    _runTimer = null
    _runIntervalMs = 200
    editor

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
                normalized.control.offset,
                normalized.input.offset,
                normalized.output.offset,
                normalized.system.offset,
                normalized.marker.offset
            )
        }
        this._startRunLoop()
    }
    async disconnect() {
        this._stopRunLoop()
    }

    async getInfo() {
        return this.plc.printInfo()
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
