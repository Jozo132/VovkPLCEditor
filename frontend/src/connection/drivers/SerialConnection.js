import ConnectionBase from "../ConnectionBase.js";
import Serial from "./tools/serial.js";
import VovkPLC from "../../wasm/VovkPLC.js";

export default class SerialConnection extends ConnectionBase {
    constructor(baudrate = 115200, debug = false) {
        super();
        this.debug = debug;
        this.baudrate = baudrate;
        this.serial = new Serial(4096, debug); // buffer size
        this.plc = new VovkPLC(); // only used for buildCommand and crc8
    }

    async connect() {
        await this.serial.begin({ baudRate: this.baudrate });
        return true;
    }

    async disconnect() {
        await this.serial.end();
    }

    async reboot() {
        const command = this.plc.buildCommand.plcReset();
        this.serial.write(command + "\n");
    }

    async run() {
        const command = this.plc.buildCommand.programRun();
        this.serial.write(command + "\n");
    }

    async stop() {
        const command = this.plc.buildCommand.programStop();
        this.serial.write(command + "\n");
    }

    async monitor() {
        const command = "PM"; // TODO: implement checksum if required
        const cmdHex = this.plc.stringToHex(command);
        const checksum = this.plc.crc8(this.plc.parseHex(cmdHex)).toString(16).padStart(2, '0');
        this.serial.write(command + checksum.toUpperCase() + "\n");
    }

    async downloadProgram(bytecode) {
        const command = this.plc.buildCommand.programDownload(bytecode);
        await this.writeChunked(command + "\n");
    }

    async writeChunked(data, chunkSize = 64, delay = 5) {
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.substring(i, i + chunkSize);
            await this.serial.write(chunk);
            if (delay > 0) await new Promise(r => setTimeout(r, delay));
        }
    }

    async uploadProgram() {
        const command = this.plc.buildCommand.programUpload();
        this.serial.write(command + "\n");
        const available = await this._waitForReply();
        if (!available) throw new Error("No response from device");
        const line = this.serial.readLine() || "";
        const hex = this.plc.parseHex(line);
        const buffer = new Uint8Array(hex);
        return buffer;
    }

    async readMemory(address, size) {
        const command = this.plc.buildCommand.memoryRead(address, size);
        this.serial.write(command + "\n");
        const available = await this._waitForReply();
        if (!available) throw new Error("No response from device");
        const line = this.serial.readLine() || "";
        const hex = this.plc.parseHex(line);
        const buffer = new Uint8Array(hex);
        return buffer;
    }

    async writeMemory(address, data) {
        const command = this.plc.buildCommand.memoryWrite(address, data);
        this.serial.write(command + "\n");
        const available = await this._waitForReply();
        if (!available) throw new Error("No response from device");
    }

    async formatMemory(address, size, value) {
        const command = this.plc.buildCommand.memoryFormat(address, size, value);
        this.serial.write(command + "\n");
        const available = await this._waitForReply();
        if (!available) throw new Error("No response from device");
    }

    async getInfo(initial = false) {
        if (initial) {
            await this.serial.write('?');
            await this._waitForReply(5000);
            while (this.serial.available()) {
                this.serial.readAll();
                await this._waitForReply(100);
            }
        }
        const command = "PI";
        const cmdHex = this.plc.stringToHex(command);
        const checksum = this.plc.crc8(this.plc.parseHex(cmdHex)).toString(16).padStart(2, '0');
        await this.serial.write(command + checksum.toUpperCase() + "\n");

        const available = await this._waitForReply(5000);
        if (!available) throw new Error("No response from device");

        // Skip intro message
        let raw = null
        while (true) {
            const available = await this._waitForReply(50);
            if (!available) break;
            raw = this.serial.readLine();
            if (this.debug) console.log("Raw device info:", raw);
            if (raw === null || typeof raw === 'undefined') break
            raw = raw.trim();
            if (!raw) continue // Skip empty lines
            if (raw.startsWith('::')) continue // Skip intro message starting with '::...'
        }

        while (true) {
            if (!raw) break
            if (raw.startsWith('PLC INFO - ')) {
                if (this.debug) console.log("Device info:", raw);
                const parts = raw.split('PLC INFO - ')
                parts.shift()
                raw = parts.join('PLC INFO - ') // This should not happen, but just in case we will remove the first instance of 'PLC INFO - '
            }
            raw = raw.trim()
            if (raw.startsWith("[") && raw.endsWith("]")) { // '[VovkPLCRuntime,WASM,0,1,0,324,2025-03-16 19:16:44,1024,104857,104857,16,16,32,16,Simulator]'
                const content = raw.substring(1, raw.length - 1)
                const parts = content.split(",")
                const info = {
                    header: parts[0],
                    arch: parts[1],
                    version: `${parts[2]}.${parts[3]}.${parts[4]} Build ${parts[5]}`,
                    date: parts[6],
                    stack: +parts[7],
                    memory: +parts[8],
                    program: +parts[9],
                    input_offset: +parts[10],
                    input_size: +parts[11],
                    output_offset: +parts[12],
                    output_size: +parts[13],
                    device: parts[14]
                }
                return info
            }
        }

        console.error(`Invalid info response:`, raw)
    }

    async _waitForReply(timeout = 1000) {
        const start = Date.now();
        while (!this.serial.available()) {
            if (Date.now() - start > timeout) return false
            await new Promise(r => setTimeout(r, 10));
        }
        return true;
    }
}