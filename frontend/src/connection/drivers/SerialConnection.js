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
        this._commandQueue = [];
        this._commandRunning = false;
        this._commandQueueLimit = 50;
        this._commandTimeoutMs = 8000;
        
        this.serial.onDisconnect = (err) => {
            if (this.onDisconnected) this.onDisconnected(err);
        };
    }

    async connect(port = null) {
        const options = { baudRate: this.baudrate }
        if (port) options.port = port
        await this.serial.begin(options);
        return true;
    }

    async disconnect() {
        this._clearCommandQueue();
        await this.serial.end();
    }

    async reboot() {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.plcReset();
            await this.serial.write(command + "\n");
        }, { label: 'reboot' });
    }

    async run() {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.programRun();
            await this.serial.write(command + "\n");
        }, { label: 'run' });
    }

    async stop() {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.programStop();
            await this.serial.write(command + "\n");
        }, { label: 'stop' });
    }

    async monitor() {
        return this._enqueueCommand(async () => {
            const command = "PM"; // TODO: implement checksum if required
            const cmdHex = this.plc.stringToHex(command);
            const checksum = this.plc.crc8(this.plc.parseHex(cmdHex)).toString(16).padStart(2, '0');
            await this.serial.write(command + checksum.toUpperCase() + "\n");
        }, { label: 'monitor' });
    }

    async downloadProgram(bytecode) {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.programDownload(bytecode);
            await this.writeChunked(command + "\n");
            
            // Wait for response
            await this._readResponseLine(12000);
            
            // Flush any remaining data in the buffer to prevent offset issues
            await new Promise(resolve => setTimeout(resolve, 100));
            while (this.serial.available()) {
                this.serial.readAll();
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }, { label: 'downloadProgram', timeoutMs: 12000 });
    }

    async writeChunked(data, chunkSize = 64, delay = 5) {
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.substring(i, i + chunkSize);
            await this.serial.write(chunk);
            if (delay > 0) await new Promise(r => setTimeout(r, delay));
        }
    }

    async uploadProgram() {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.programUpload();
            await this.serial.write(command + "\n");
            
            const line = await this._readResponseLine(12000);
            let raw = line.trim();
            if (raw.startsWith('OK')) {
                raw = raw.substring(2).trim();
            }
            const hex = this.plc.parseHex(raw);
            const buffer = new Uint8Array(hex);
            return buffer;
        }, { label: 'uploadProgram', timeoutMs: 12000 });
    }

    async readMemory(address, size) {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.memoryRead(address, size);
            await this.serial.write(command + "\n");
            
            // Wait for the full line (including potential large data payload)
            const line = await this._readResponseLine(8000);
            let raw = line.trim();
            if (raw.startsWith('OK')) {
                raw = raw.substring(2).trim();
            }
            const hex = this.plc.parseHex(raw);
            const buffer = new Uint8Array(hex);
            return buffer;
        }, { label: 'readMemory' });
    }

    async writeMemory(address, data) {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.memoryWrite(address, data);
            await this.serial.write(command + "\n");
            await this._readResponseLine(); // Wait for OK
        }, { label: 'writeMemory' });
    }

    async formatMemory(address, size, value) {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.memoryFormat(address, size, value);
            await this.serial.write(command + "\n");
            await this._readResponseLine(); // Wait for OK
        }, { label: 'formatMemory' });
    }

    async writeMemoryArea(address, data) {
        return this.writeMemory(address, data);
    }

    async writeMemoryAreaMasked(address, data, mask) {
        return this._enqueueCommand(async () => {
             const command = this.plc.buildCommand.memoryWriteMask(address, data, mask);
             await this.serial.write(command + "\n");
             await this._readResponseLine(); // Wait for OK
        }, { label: 'writeMemoryAreaMasked' });
    }

    async getInfo(initial = false) {
        return this._enqueueCommand(async () => {
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
                if (raw.startsWith("[") && raw.endsWith("]")) { // '[VovkPLCRuntime,WASM,0,1,0,324,2025-03-16 19:16:44,1024,104857,104857,0,16,16,16,32,16,48,16,64,16,Simulator]'
                    const content = raw.substring(1, raw.length - 1)
                    const parts = content.split(",")
                    const base = {
                        header: parts[0],
                        arch: parts[1],
                        version: `${parts[2]}.${parts[3]}.${parts[4]} Build ${parts[5]}`,
                        date: parts[6],
                        stack: +parts[7],
                        memory: +parts[8],
                        program: +parts[9],
                    }
                    if (parts.length >= 21) {
                        return {
                            ...base,
                            control_offset: +parts[10],
                            control_size: +parts[11],
                            input_offset: +parts[12],
                            input_size: +parts[13],
                            output_offset: +parts[14],
                            output_size: +parts[15],
                            system_offset: +parts[16],
                            system_size: +parts[17],
                            marker_offset: +parts[18],
                            marker_size: +parts[19],
                            device: parts[20]
                        }
                    }
                    return {
                        ...base,
                        input_offset: +parts[10],
                        input_size: +parts[11],
                        output_offset: +parts[12],
                        output_size: +parts[13],
                        device: parts[14]
                    }
                }
            }

            console.error(`Invalid info response:`, raw)
        }, { label: 'getInfo', timeoutMs: 12000 });
    }

    async getHealth() {
        return this._enqueueCommand(async () => {
            const command = "PH"
            const cmdHex = this.plc.stringToHex(command)
            const checksum = this.plc.crc8(this.plc.parseHex(cmdHex)).toString(16).padStart(2, '0')
            await this.serial.write(command + checksum.toUpperCase() + "\n")
            
            const line = await this._readResponseLine()
            let raw = line.trim()
            if (!raw) throw new Error("Invalid health response")
            if (!raw.startsWith('PH')) {
                const idx = raw.indexOf('PH')
                if (idx >= 0) raw = raw.slice(idx)
            }
            if (raw.startsWith('PH')) raw = raw.slice(2)
            const hex = raw.replace(/[^0-9a-fA-F]/g, '')
            if (hex.length < 48) throw new Error("Invalid health response")
            const parseU32 = (offset) => parseInt(hex.slice(offset, offset + 8), 16) >>> 0
            return {
                last_cycle_time_us: parseU32(0),
                min_cycle_time_us: parseU32(8),
                max_cycle_time_us: parseU32(16),
                ram_free: parseU32(24),
                min_ram_free: parseU32(32),
                max_ram_free: parseU32(40),
            }
        }, { label: 'getHealth' });
    }

    async resetHealth() {
        return this._enqueueCommand(async () => {
            const command = "RH"
            const cmdHex = this.plc.stringToHex(command)
            const checksum = this.plc.crc8(this.plc.parseHex(cmdHex)).toString(16).padStart(2, '0')
            await this.serial.write(command + checksum.toUpperCase() + "\n")
            
            await this._readResponseLine()
        }, { label: 'resetHealth' });
    }

    async _waitForReply(timeout = 1000) {
        const start = Date.now();
        while (!this.serial.available()) {
            if (Date.now() - start > timeout) return false
            await new Promise(r => setTimeout(r, 10));
        }
        return true;
    }

    async _readResponseLine(timeout = 5000) {
        const start = Date.now();
        while (true) {
            const line = this.serial.readLine();
            if (line !== null) return line;
            if (Date.now() - start > timeout) throw new Error("Timeout waiting for response line");
            await new Promise(r => setTimeout(r, 10));
        }
    }

    _enqueueCommand(handler, options = {}) {
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : this._commandTimeoutMs;
        const label = options.label || 'command';
        return new Promise((resolve, reject) => {
            if (this._commandQueue.length >= this._commandQueueLimit) {
                reject(new Error('Serial command queue full'));
                return;
            }
            this._commandQueue.push({ handler, resolve, reject, timeoutMs, label });
            this._drainCommandQueue();
        });
    }

    async _drainCommandQueue() {
        if (this._commandRunning) return;
        this._commandRunning = true;
        while (this._commandQueue.length) {
            const item = this._commandQueue.shift();
            if (!item) continue;
            try {
                const result = await this._withTimeout(
                    Promise.resolve().then(item.handler),
                    item.timeoutMs,
                    item.label
                );
                item.resolve(result);
            } catch (err) {
                item.reject(err);
            }
        }
        this._commandRunning = false;
    }

    _withTimeout(promise, timeoutMs, label) {
        if (!timeoutMs || timeoutMs <= 0) return promise;
        let timer = null;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(`Serial command timed out (${label})`));
            }, timeoutMs);
        });
        return Promise.race([promise, timeout]).finally(() => {
            if (timer) clearTimeout(timer);
        });
    }

    _clearCommandQueue() {
        if (!this._commandQueue.length) return;
        const err = new Error('Serial command queue cleared');
        while (this._commandQueue.length) {
            const item = this._commandQueue.shift();
            if (item && typeof item.reject === 'function') {
                item.reject(err);
            }
        }
    }
}
