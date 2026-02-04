import ConnectionBase from "../ConnectionBase.js";
import Serial from "./tools/serial.js";
import VovkPLC from "../../wasm/VovkPLC.js";

export default class SerialConnection extends ConnectionBase {
    constructor(baudrate = 115200, debug = false) {
        super();
        this.debug = debug;
        this.baudrate = baudrate;
        this.serial = new Serial(32 * 1024, debug); // buffer size
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

    /**
     * Configure Timer/Counter offsets on the device
     * @param {number} timerOffset - Timer memory area offset
     * @param {number} counterOffset - Counter memory area offset
     */
    async configureTCOffsets(timerOffset, counterOffset) {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.tcConfig(timerOffset, counterOffset);
            await this.serial.write(command + "\n");
            await this._readResponseLine(); // Wait for OK
        }, { label: 'configureTCOffsets' });
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
            if (this.debug) console.log("Sending info command:", command + checksum.toUpperCase());
            await this.serial.write(command + checksum.toUpperCase() + "\n");

            const available = await this._waitForReply(5000);
            if (!available) throw new Error("No response from device");

            // ESP32-C6 USB-CDC sends data in chunks with gaps, so we need to:
            // 1. Accumulate all incoming data
            // 2. Wait for complete info line (contains both '[' and ']')
            // 3. Use longer timeouts between chunks
            let accumulated = ''
            let infoLine = null
            const startTime = Date.now()
            const maxWaitTime = 8000 // Maximum time to wait for complete response
            
            while (Date.now() - startTime < maxWaitTime) {
                // Check if connection was closed
                if (!this.serial.isOpen) throw new Error('Connection closed');
                
                // Use longer timeout for ESP32-C6 compatibility (USB-CDC has variable latency)
                const hasData = await this._waitForReply(300);
                if (hasData) {
                    // Read all available data (not just one line) to handle chunked responses
                    const chunk = this.serial.readAll();
                    if (chunk) {
                        accumulated += chunk;
                        if (this.debug) console.log("Accumulated chunk:", chunk, "Total:", accumulated.length);
                    }
                }
                
                // Check if we have a complete info line in accumulated data
                // Look for a line that contains '[' and ends with ']' followed by newline or end
                const bracketStart = accumulated.indexOf('[');
                if (bracketStart >= 0) {
                    const bracketEnd = accumulated.indexOf(']', bracketStart);
                    if (bracketEnd >= 0) {
                        // Found complete bracketed content - extract the full line
                        // Find the start of this line (after previous newline)
                        let lineStart = accumulated.lastIndexOf('\n', bracketStart);
                        lineStart = lineStart >= 0 ? lineStart + 1 : 0;
                        // Find end of line (newline after bracket or end of string)
                        let lineEnd = accumulated.indexOf('\n', bracketEnd);
                        lineEnd = lineEnd >= 0 ? lineEnd : accumulated.length;
                        
                        infoLine = accumulated.substring(lineStart, lineEnd).trim();
                        if (this.debug) console.log("Found complete info line:", infoLine);
                        // Give a bit more time for any trailing data
                        await new Promise(r => setTimeout(r, 50));
                        break;
                    }
                }
                
                // If no data and we've been waiting a while, check if we should give up
                if (!hasData && Date.now() - startTime > 2000 && accumulated.length === 0) {
                    break; // No data at all after 2 seconds
                }
            }
            
            let raw = infoLine;

            if (!raw) {
                console.log("Remaining accumulated data:", accumulated);
                throw new Error("Invalid info response: no data or incomplete response");
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
                    if (parts.length >= 26) {
                        // New format with FLAGS: system, input, output, marker, timer, counter, flags, device
                        // Format: [header,arch,ver_maj,ver_min,ver_patch,build,date,stack,mem,prog,
                        //          sys_off,sys_size,in_off,in_size,out_off,out_size,mark_off,mark_size,
                        //          timer_off,timer_count,timer_struct,counter_off,counter_count,counter_struct,flags,device]
                        const flags = +parts[24]
                        const isLittleEndian = (flags & 0x01) === 1
                        return {
                            ...base,
                            system_offset: +parts[10],
                            system_size: +parts[11],
                            input_offset: +parts[12],
                            input_size: +parts[13],
                            output_offset: +parts[14],
                            output_size: +parts[15],
                            marker_offset: +parts[16],
                            marker_size: +parts[17],
                            timer_offset: +parts[18],
                            timer_count: +parts[19],
                            timer_struct_size: +parts[20],
                            counter_offset: +parts[21],
                            counter_count: +parts[22],
                            counter_struct_size: +parts[23],
                            flags,
                            isLittleEndian,
                            device: parts[25],
                            // Legacy compatibility aliases
                            control_offset: +parts[10],
                            control_size: +parts[11],
                        }
                    }
                    if (parts.length >= 25) {
                        // Previous format without FLAGS (backwards compatibility)
                        // Format: [header,arch,ver_maj,ver_min,ver_patch,build,date,stack,mem,prog,
                        //          sys_off,sys_size,in_off,in_size,out_off,out_size,mark_off,mark_size,
                        //          timer_off,timer_count,timer_struct,counter_off,counter_count,counter_struct,device]
                        return {
                            ...base,
                            system_offset: +parts[10],
                            system_size: +parts[11],
                            input_offset: +parts[12],
                            input_size: +parts[13],
                            output_offset: +parts[14],
                            output_size: +parts[15],
                            marker_offset: +parts[16],
                            marker_size: +parts[17],
                            timer_offset: +parts[18],
                            timer_count: +parts[19],
                            timer_struct_size: +parts[20],
                            counter_offset: +parts[21],
                            counter_count: +parts[22],
                            counter_struct_size: +parts[23],
                            flags: 0,
                            isLittleEndian: true, // Default to little-endian for legacy devices
                            device: parts[24],
                            // Legacy compatibility aliases
                            control_offset: +parts[10],
                            control_size: +parts[11],
                        }
                    }
                    if (parts.length >= 21) {
                        // Legacy format with control_offset naming (backwards compatibility)
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
                            device: parts[20],
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
            // Struct order from runtime-lib.h DeviceHealth:
            // 0-2: cycle, 3-5: ram_free, 6: total_ram, 7-9: period, 10-12: jitter
            return {
                last_cycle_time_us: parseU32(0),
                min_cycle_time_us: parseU32(8),
                max_cycle_time_us: parseU32(16),
                ram_free: parseU32(24),
                min_ram_free: parseU32(32),
                max_ram_free: parseU32(40),
                total_ram_size: parseU32(48),
                last_period_us: parseU32(56),
                min_period_us: parseU32(64),
                max_period_us: parseU32(72),
                last_jitter_us: parseU32(80),
                min_jitter_us: parseU32(88),
                max_jitter_us: parseU32(96),
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

    /**
     * Get symbol list from device
     * Request: SL<checksum>
     * Response: [PS,count,{name,area,address,bit,type,comment},...]
     * @returns {Promise<Array<{name: string, area: string, address: number, bit: number, type: string, comment: string}>>}
     */
    async getSymbolList() {
        return this._enqueueCommand(async () => {
            const command = "SL"
            const cmdHex = this.plc.stringToHex(command)
            const checksum = this.plc.crc8(this.plc.parseHex(cmdHex)).toString(16).padStart(2, '0')
            await this.serial.write(command + checksum.toUpperCase() + "\n")

            const line = await this._readResponseLine(8000)
            let raw = line.trim()
            if (!raw) return []
            
            // Response format: [PS,count,{name,area,address,bit,type,comment},...]
            if (raw.startsWith('[') && raw.endsWith(']')) {
                const content = raw.substring(1, raw.length - 1)
                
                // First, extract header (PS,count) before the first {
                const firstBrace = content.indexOf('{')
                if (firstBrace === -1) {
                    // No symbols, just header
                    const headerParts = content.split(',')
                    if (headerParts[0] !== 'PS') {
                        console.warn('Unexpected symbol list response header:', headerParts[0])
                        return []
                    }
                    return []
                }
                
                const headerPart = content.substring(0, firstBrace)
                const headerParts = headerPart.split(',').filter(p => p.trim())
                
                if (headerParts[0] !== 'PS') {
                    console.warn('Unexpected symbol list response header:', headerParts[0])
                    return []
                }
                
                const count = parseInt(headerParts[1], 10)
                if (count === 0 || isNaN(count)) return []
                
                // Extract all {...} groups
                const symbols = []
                const symbolRegex = /\{([^}]*)\}/g
                let match
                
                while ((match = symbolRegex.exec(content)) !== null) {
                    const innerContent = match[1]
                    // Split only the first 5 fields, the rest is comment (which may contain commas)
                    const parts = innerContent.split(',')
                    if (parts.length >= 5) {
                        // Join remaining parts as comment (in case comment contains commas)
                        const comment = parts.slice(5).join(',')
                        symbols.push({
                            name: parts[0] || '',
                            area: parts[1] || '',
                            address: parseInt(parts[2], 10) || 0,
                            bit: parseInt(parts[3], 10) || 0,
                            type: parts[4] || 'byte',
                            comment: comment
                        })
                    }
                }
                
                return symbols
            }
            
            return []
        }, { label: 'getSymbolList', timeoutMs: 8000 });
    }

    /**
     * Get transport/interface info from device
     * Request: TI<checksum>
     * Response: [TI,count,{type,name,isNetwork,requiresAuth,isConnected,config...},...]
     * Config for Serial: baudrate
     * Config for Network: ip,gateway,subnet,port,mac
     * @returns {Promise<Array<{type: number, name: string, isNetwork: boolean, requiresAuth: boolean, isConnected: boolean, baudrate?: number, ip?: string, gateway?: string, subnet?: string, port?: number, mac?: string}>>}
     */
    async getTransportInfo() {
        return this._enqueueCommand(async () => {
            const command = "TI"
            const cmdHex = this.plc.stringToHex(command)
            const checksum = this.plc.crc8(this.plc.parseHex(cmdHex)).toString(16).padStart(2, '0')
            await this.serial.write(command + checksum.toUpperCase() + "\n")

            const line = await this._readResponseLine(8000)
            let raw = line.trim()
            if (!raw) return []
            
            // Response format: [TI,count,{type,name,isNetwork,requiresAuth,isConnected,config...},...]
            if (raw.startsWith('[') && raw.endsWith(']')) {
                const content = raw.substring(1, raw.length - 1)
                
                // Extract header (TI,count) before the first {
                const firstBrace = content.indexOf('{')
                if (firstBrace === -1) {
                    // No transports, just header
                    const headerParts = content.split(',')
                    if (headerParts[0] !== 'TI') {
                        console.warn('Unexpected transport info response header:', headerParts[0])
                        return []
                    }
                    return []
                }
                
                const headerPart = content.substring(0, firstBrace)
                const headerParts = headerPart.split(',').filter(p => p.trim())
                
                if (headerParts[0] !== 'TI') {
                    console.warn('Unexpected transport info response header:', headerParts[0])
                    return []
                }
                
                const count = parseInt(headerParts[1], 10)
                if (count === 0 || isNaN(count)) return []
                
                // Extract all {...} groups
                const transports = []
                const transportRegex = /\{([^}]*)\}/g
                let match
                
                while ((match = transportRegex.exec(content)) !== null) {
                    const innerContent = match[1]
                    const parts = innerContent.split(',')
                    if (parts.length >= 5) {
                        const type = parseInt(parts[0], 10) || 0
                        const name = parts[1] || ''
                        const isNetwork = parts[2] === '1'
                        const requiresAuth = parts[3] === '1'
                        const isConnected = parts[4] === '1'
                        
                        const transport = {
                            type,
                            name,
                            isNetwork,
                            requiresAuth,
                            isConnected
                        }
                        
                        // Parse config based on transport type
                        if (!isNetwork && parts.length >= 6) {
                            // Serial config: baudrate
                            transport.baudrate = parseInt(parts[5], 10) || 0
                        } else if (isNetwork && parts.length >= 10) {
                            // Network config: ip, gateway, subnet, port, mac
                            transport.ip = parts[5] || ''
                            transport.gateway = parts[6] || ''
                            transport.subnet = parts[7] || ''
                            transport.port = parseInt(parts[8], 10) || 0
                            transport.mac = parts[9] || ''
                        }
                        
                        transports.push(transport)
                    }
                }
                
                return transports
            }
            
            return []
        }, { label: 'getTransportInfo', timeoutMs: 8000 });
    }

    async _waitForReply(timeout = 1000) {
        const start = Date.now();
        while (!this.serial.available()) {
            if (!this.serial.isOpen) return false; // Connection closed
            if (Date.now() - start > timeout) return false
            await new Promise(r => setTimeout(r, 10));
        }
        return true;
    }

    async _waitForCharacter(char, timeout = 5000) { // Without consuming the serial buffer
        const start = Date.now();
        while (true) {
            if (!this.serial.isOpen) throw new Error('Connection closed'); // Connection closed
            const available = this.serial.available();
            if (available) {
                const peeked = this.serial.peek(available); // number
                const expected = typeof char === 'string' ? char.charCodeAt(0) : char;
                if (peeked === expected) return true;
            }
            if (Date.now() - start > timeout) throw new Error(`Timeout waiting for character '${char}'`);
            await new Promise(r => setTimeout(r, 10));
        }
    }

    async _readResponseLine(timeout = 5000) {
        const start = Date.now();
        while (true) {
            if (!this.serial.isOpen) throw new Error('Connection closed'); // Connection closed
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
