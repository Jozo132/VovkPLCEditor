export default class ConnectionBase {
    /** @type { (error: Error) => void } */
    onDisconnected = null

    /** @type { () => Promise<boolean> } */
    async connect() { throw new Error("connect() not implemented"); }

    /** @type { () => Promise<void> } */
    async disconnect() { throw new Error("disconnect() not implemented"); }

    /** @type { () => Promise<any> } */
    async getInfo() { throw new Error("getInfo() not implemented"); }

    /** @type { () => Promise<{ last_cycle_time_us: number, max_cycle_time_us: number, ram_free: number, min_ram_free: number }> } */
    async getHealth() { throw new Error("getHealth() not implemented"); }

    /** @type { () => Promise<void> } */
    async resetHealth() { throw new Error("resetHealth() not implemented"); }

    /** @type { () => Promise<void> } */
    async reboot() { throw new Error("reboot() not implemented"); }

    /** @type { () => Promise<void> } */
    async run() { throw new Error("run() not implemented"); }

    /** @type { () => Promise<void> } */
    async stop() { throw new Error("stop() not implemented"); }

    /** @type { (bytecode: Uint8Array) => Promise<void> } */
    async downloadProgram(bytecode) { throw new Error("downloadProgram() not implemented"); }

    /** @type { () => Promise<string | Uint8Array> } */
    async uploadProgram() { throw new Error("uploadProgram() not implemented"); }

    /** @type { (address: number, size: number) => Promise<Uint8Array> } */
    async readMemory(address, size) { throw new Error("readMemory() not implemented"); }

    /** @type { (address: number, data: Uint8Array) => Promise<void> } */
    async writeMemory(address, data) { throw new Error("writeMemory() not implemented"); }

    /** @type { (address: number, size: number, value: number) => Promise<void> } */
    async formatMemory(address, size, value) { throw new Error("formatMemory() not implemented"); }

    /** @type { () => Promise<void> } */
    async monitor() { throw new Error("monitor() not implemented"); }
}
