import ConnectionBase from "./ConnectionBase.js";
import VovkPLC from "../wasm/VovkPLC.js"; // adjust path as needed

export default class SimulationConnection extends ConnectionBase {
    deviceInfo = null

    constructor(wasmPath = "/wasm/VovkPLC.wasm") {
        super();
        this.plc = new VovkPLC(wasmPath);
    }

    async connect() {
        await this.plc.initialize();
    }
    async disconnect() {
        // Optional: clear internal state if needed
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
        // No stop implementation in WASM simulation
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
}