import ConnectionBase from "../ConnectionBase.js";
import { PLCEditor } from "../../utils/types.js";

export default class SimulationConnection extends ConnectionBase {
    deviceInfo = null
    _runTimer = null
    _runIntervalMs = 50

    /**
     * @param { PLCEditor } editor - The PLC editor instance
     */
    constructor(editor) {
        super();
        this.plc = editor.runtime; // Use the inherited runtime from the editor
    }

    async connect() {
        await this.plc.initialize();
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

    async formatMemory(address, size, value) {
        const data = Array(size).fill(value);
        return this.writeMemory(address, data);
    }

    async monitor() {
        // Implement monitoring logic if applicable
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
