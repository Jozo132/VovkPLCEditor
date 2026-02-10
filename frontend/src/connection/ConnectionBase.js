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

    /**
     * Get DataBlock layout info from device
     * @returns { Promise<{ slots: number, active: number, table_offset: number, free_space: number, lowest_address: number, entries: Array<{ db: number, offset: number, size: number }> }> }
     */
    async getDataBlockInfo() { throw new Error("getDataBlockInfo() not implemented"); }

    /**
     * Declare a DataBlock on the device
     * @param {number} dbNumber - DB number (1-based)
     * @param {number} size - Size in bytes
     * @returns {Promise<number>} Slot index on success, -1 on failure
     */
    async declareDataBlock(dbNumber, size) { throw new Error("declareDataBlock() not implemented"); }

    /**
     * Remove a DataBlock from the device
     * @param {number} dbNumber - DB number to remove
     * @returns {Promise<boolean>} True on success
     */
    async removeDataBlock(dbNumber) { throw new Error("removeDataBlock() not implemented"); }

    /**
     * Compact all DataBlocks on the device
     * @returns {Promise<number>} New lowest allocated address
     */
    async compactDataBlocks() { throw new Error("compactDataBlocks() not implemented"); }

    /**
     * Clear all DataBlock entries on the device
     * @returns {Promise<void>}
     */
    async formatDataBlocks() { throw new Error("formatDataBlocks() not implemented"); }

    /**
     * Read an entire DataBlock's raw data
     * @param {number} dbNumber - DB number to read
     * @returns {Promise<{ data: Uint8Array, offset: number, size: number }>}
     */
    async readDataBlock(dbNumber) { throw new Error("readDataBlock() not implemented"); }

    /**
     * Read a typed value from a DataBlock
     * @param {number} dbNumber - DB number
     * @param {number} dbOffset - Byte offset within the DB
     * @param {'u8'|'i8'|'u16'|'i16'|'u32'|'i32'|'f32'|'f64'} type - Data type
     * @returns {Promise<number>}
     */
    async readDataBlockValue(dbNumber, dbOffset, type) { throw new Error("readDataBlockValue() not implemented"); }

    /**
     * Write a typed value to a DataBlock
     * @param {number} dbNumber - DB number
     * @param {number} dbOffset - Byte offset within the DB
     * @param {number} value - Value to write
     * @param {'u8'|'i8'|'u16'|'i16'|'u32'|'i32'|'f32'|'f64'} type - Data type
     * @returns {Promise<void>}
     */
    async writeDataBlockValue(dbNumber, dbOffset, value, type) { throw new Error("writeDataBlockValue() not implemented"); }

    /**
     * Read a named field from a DataBlock using compiler metadata
     * @param {number} dbNumber - DB number
     * @param {string} fieldName - Field name
     * @returns {Promise<number>}
     */
    async readDataBlockField(dbNumber, fieldName) { throw new Error("readDataBlockField() not implemented"); }

    /**
     * Write a named field to a DataBlock using compiler metadata
     * @param {number} dbNumber - DB number
     * @param {string} fieldName - Field name
     * @param {number} value - Value to write
     * @returns {Promise<void>}
     */
    async writeDataBlockField(dbNumber, fieldName, value) { throw new Error("writeDataBlockField() not implemented"); }

    /**
     * Read all fields of a DataBlock as key-value pairs
     * @param {number} dbNumber - DB number
     * @returns {Promise<Record<string, number>>}
     */
    async readDataBlockFields(dbNumber) { throw new Error("readDataBlockFields() not implemented"); }

    /**
     * Write multiple fields to a DataBlock
     * @param {number} dbNumber - DB number
     * @param {Record<string, number>} values - Field name -> value map
     * @returns {Promise<void>}
     */
    async writeDataBlockFields(dbNumber, values) { throw new Error("writeDataBlockFields() not implemented"); }

    /**
     * Get all compiler-declared DataBlock definitions (available after compilation)
     * @returns {Promise<Array<{ db_number: number, alias: string, totalSize: number, computedOffset: number, fields: Array<{ name: string, typeName: string, typeSize: number, offset: number, hasDefault: boolean, defaultValue: number }> }>>}
     */
    async getDataBlockDeclarations() { throw new Error("getDataBlockDeclarations() not implemented"); }
}
