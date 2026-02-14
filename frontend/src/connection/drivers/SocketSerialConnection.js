/**
 * @file SocketSerialConnection.js
 * @description Connection driver that communicates with a PLC device through
 * a serial port managed by the backend server via Socket.IO.
 *
 * This is functionally identical to SerialConnection.js but instead of using
 * the browser's Web Serial API (navigator.serial), it uses the backend's
 * /serial Socket.IO namespace which proxies to a real serial port via the
 * Node.js `serialport` package.
 *
 * This allows serial access from ANY browser, not just Chromium-based ones.
 */

import ConnectionBase from "../ConnectionBase.js"
import SocketSerial from "./tools/socketSerial.js"
import VovkPLC from "../../wasm/VovkPLC.js"

export default class SocketSerialConnection extends ConnectionBase {
    constructor(baudrate = 115200, debug = false) {
        super()
        this.debug = debug
        this.baudrate = baudrate
        this.serial = new SocketSerial(32 * 1024, debug)
        this.plc = new VovkPLC() // only used for buildCommand and crc8
        this._commandQueue = []
        this._commandRunning = false
        this._commandQueueLimit = 50
        this._commandTimeoutMs = 8000

        this.serial.onDisconnect = (err) => {
            if (this.onDisconnected) this.onDisconnected(err)
        }
    }

    async connect(portPathOrOptions = null) {
        // Reset command queue state on new connection
        this._clearCommandQueue()
        
        const options = { baudRate: this.baudrate }
        if (typeof portPathOrOptions === 'string') {
            options.path = portPathOrOptions
        } else if (portPathOrOptions && typeof portPathOrOptions === 'object') {
            if (portPathOrOptions.path) options.path = portPathOrOptions.path
            if (portPathOrOptions.serverUrl) options.serverUrl = portPathOrOptions.serverUrl
        }
        await this.serial.begin(options)
        return true
    }

    async disconnect() {
        this._clearCommandQueue()
        
        // Unsubscribe from monitoring before disconnecting
        if (this.serial?.isSubscribed?.()) {
            try {
                await this.serial.unsubscribeMemory()
            } catch {
                // Ignore errors
            }
        }
        
        await this.serial.end()
        this.onMemoryData = null
    }

    /**
     * List available serial ports on the backend server
     * @returns {Promise<Array<{path: string, manufacturer?: string, serialNumber?: string, vendorId?: string, productId?: string}>>}
     */
    async listPorts() {
        // Temporarily connect socket if not connected
        if (!this.serial.socket?.connected) {
            const { io } = await import('/socket.io/socket.io.esm.min.js')
            const serverUrl = window.location.origin
            const tempSocket = io(`${serverUrl}/serial`, {
                transports: ['websocket', 'polling'],
                reconnection: false,
            })
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    tempSocket.disconnect()
                    reject(new Error('Timeout listing ports'))
                }, 10000)

                tempSocket.on('connect', () => {
                    tempSocket.emit('list', (result) => {
                        clearTimeout(timeout)
                        tempSocket.disconnect()
                        if (result.ok) resolve(result.ports || [])
                        else reject(new Error(result.error || 'Failed to list ports'))
                    })
                })

                tempSocket.on('connect_error', (err) => {
                    clearTimeout(timeout)
                    tempSocket.disconnect()
                    reject(new Error(`Connection failed: ${err.message}`))
                })
            })
        }
        return this.serial.listPorts()
    }

    async reboot() {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.plcReset()
            await this.serial.write(command + "\n")
        }, { label: 'reboot' })
    }

    async run() {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.programRun()
            await this.serial.write(command + "\n")
        }, { label: 'run' })
    }

    async stop() {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.programStop()
            await this.serial.write(command + "\n")
        }, { label: 'stop' })
    }

    async monitor() {
        return this._enqueueCommand(async () => {
            const command = "PM"
            const cmdHex = this.plc.stringToHex(command)
            const checksum = this.plc.crc8(this.plc.parseHex(cmdHex)).toString(16).padStart(2, '0')
            await this.serial.write(command + checksum.toUpperCase() + "\n")
        }, { label: 'monitor' })
    }

    async downloadProgram(bytecode) {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.programDownload(bytecode)
            // For program download, temporarily pause monitoring using atomic command wrapper
            // Send entire command through atomic channel to ensure clean send/receive cycle
            const combinedData = command + "\n"
            const line = await this.serial.command(combinedData, 30000)

            // Flush remaining data
            await new Promise(resolve => setTimeout(resolve, 100))
            while (this.serial.available()) {
                this.serial.readAll()
                await new Promise(resolve => setTimeout(resolve, 50))
            }
        }, { label: 'downloadProgram', timeoutMs: 30000 })
    }

    async writeChunked(data, chunkSize = 64, delay = 5) {
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.substring(i, i + chunkSize)
            await this.serial.write(chunk)
            if (delay > 0) await new Promise(r => setTimeout(r, delay))
        }
    }

    async uploadProgram() {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.programUpload()
            // Use atomic command to avoid conflicts with monitoring
            const line = await this.serial.command(command + "\n", 30000)
            let raw = line.trim()
            if (raw.startsWith('OK')) {
                raw = raw.substring(2).trim()
            }
            const hex = this.plc.parseHex(raw)
            const buffer = new Uint8Array(hex)
            return buffer
        }, { label: 'uploadProgram', timeoutMs: 30000 })
    }

    async readMemory(address, size) {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.memoryRead(address, size)
            // Use atomic command to avoid conflicts with monitoring
            const line = await this.serial.command(command + "\n", 8000)
            let raw = line.trim()
            if (raw.startsWith('OK')) {
                raw = raw.substring(2).trim()
            }
            const hex = this.plc.parseHex(raw)
            const buffer = new Uint8Array(hex)
            return buffer
        }, { label: 'readMemory' })
    }

    async writeMemory(address, data) {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.memoryWrite(address, data)
            // Use atomic command to avoid conflicts with monitoring
            await this.serial.command(command + "\n", 2000)
        }, { label: 'writeMemory' })
    }

    async formatMemory(address, size, value) {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.memoryFormat(address, size, value)
            // Use atomic command to avoid conflicts with monitoring
            await this.serial.command(command + "\n", 2000)
        }, { label: 'formatMemory' })
    }

    async writeMemoryArea(address, data) {
        return this.writeMemory(address, data)
    }

    async writeMemoryAreaMasked(address, data, mask) {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.memoryWriteMask(address, data, mask)
            // Use atomic command to avoid conflicts with monitoring
            await this.serial.command(command + "\n", 2000)
        }, { label: 'writeMemoryAreaMasked' })
    }

    /**
     * Configure Timer/Counter offsets on the device
     * @param {number} timerOffset
     * @param {number} counterOffset
     */
    async configureTCOffsets(timerOffset, counterOffset) {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.tcConfig(timerOffset, counterOffset)
            // Use atomic command to avoid conflicts with monitoring
            await this.serial.command(command + "\n", 2000)
        }, { label: 'configureTCOffsets' })
    }

    async getInfo(initial = false) {
        return this._enqueueCommand(async () => {
            if (initial) {
                // Send initial query to wake up device (using atomic command)
                try {
                    await this.serial.command('?\n', 2000)
                } catch {
                    // Ignore timeout - device may not respond to '?'
                }
            }
            const command = "PI"
            const cmdHex = this.plc.stringToHex(command)
            const checksum = this.plc.crc8(this.plc.parseHex(cmdHex)).toString(16).padStart(2, '0')
            if (this.debug) console.log("Sending info command:", command + checksum.toUpperCase())
            
            // Use atomic command method to avoid conflicts with monitoring loop
            const accumulated = await this.serial.command(command + checksum.toUpperCase() + "\n", 8000)
            
            let infoLine = null
            const bracketStart = accumulated.indexOf('[')
            if (bracketStart >= 0) {
                const bracketEnd = accumulated.indexOf(']', bracketStart)
                if (bracketEnd >= 0) {
                    let lineStart = accumulated.lastIndexOf('\n', bracketStart)
                    lineStart = lineStart >= 0 ? lineStart + 1 : 0
                    let lineEnd = accumulated.indexOf('\n', bracketEnd)
                    lineEnd = lineEnd >= 0 ? lineEnd : accumulated.length

                    infoLine = accumulated.substring(lineStart, lineEnd).trim()
                    if (this.debug) console.log("Found complete info line:", infoLine)
                }
            }

            let raw = infoLine
            if (!raw) {
                console.log("Remaining accumulated data:", accumulated)
                throw new Error("Invalid info response: no data or incomplete response")
            }

            // Parse the info response - identical logic to SerialConnection
            while (true) {
                if (!raw) break
                if (raw.startsWith('PLC INFO - ')) {
                    const parts = raw.split('PLC INFO - ')
                    parts.shift()
                    raw = parts.join('PLC INFO - ')
                }
                raw = raw.trim()
                if (raw.startsWith("[") && raw.endsWith("]")) {
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
                    if (parts.length >= 29) {
                        const flags = parseInt(parts[27], 16) || 0
                        const isLittleEndian = (flags & 0x01) === 1
                        return {
                            ...base,
                            system_offset: +parts[10], system_size: +parts[11],
                            input_offset: +parts[12], input_size: +parts[13],
                            output_offset: +parts[14], output_size: +parts[15],
                            marker_offset: +parts[16], marker_size: +parts[17],
                            timer_offset: +parts[18], timer_count: +parts[19], timer_struct_size: +parts[20],
                            counter_offset: +parts[21], counter_count: +parts[22], counter_struct_size: +parts[23],
                            db_table_offset: +parts[24], db_slot_count: +parts[25], db_entry_size: +parts[26],
                            flags, isLittleEndian, device: parts[28],
                            control_offset: +parts[10], control_size: +parts[11],
                        }
                    }
                    if (parts.length >= 26) {
                        const flags = parseInt(parts[24], 16) || 0
                        const isLittleEndian = (flags & 0x01) === 1
                        return {
                            ...base,
                            system_offset: +parts[10], system_size: +parts[11],
                            input_offset: +parts[12], input_size: +parts[13],
                            output_offset: +parts[14], output_size: +parts[15],
                            marker_offset: +parts[16], marker_size: +parts[17],
                            timer_offset: +parts[18], timer_count: +parts[19], timer_struct_size: +parts[20],
                            counter_offset: +parts[21], counter_count: +parts[22], counter_struct_size: +parts[23],
                            flags, isLittleEndian, device: parts[25],
                            control_offset: +parts[10], control_size: +parts[11],
                        }
                    }
                    if (parts.length >= 25) {
                        return {
                            ...base,
                            system_offset: +parts[10], system_size: +parts[11],
                            input_offset: +parts[12], input_size: +parts[13],
                            output_offset: +parts[14], output_size: +parts[15],
                            marker_offset: +parts[16], marker_size: +parts[17],
                            timer_offset: +parts[18], timer_count: +parts[19], timer_struct_size: +parts[20],
                            counter_offset: +parts[21], counter_count: +parts[22], counter_struct_size: +parts[23],
                            flags: 0, isLittleEndian: true, device: parts[24],
                            control_offset: +parts[10], control_size: +parts[11],
                        }
                    }
                    if (parts.length >= 21) {
                        return {
                            ...base,
                            control_offset: +parts[10], control_size: +parts[11],
                            input_offset: +parts[12], input_size: +parts[13],
                            output_offset: +parts[14], output_size: +parts[15],
                            system_offset: +parts[16], system_size: +parts[17],
                            marker_offset: +parts[18], marker_size: +parts[19],
                            device: parts[20],
                        }
                    }
                    return {
                        ...base,
                        input_offset: +parts[10], input_size: +parts[11],
                        output_offset: +parts[12], output_size: +parts[13],
                        device: parts[14]
                    }
                }
            }

            console.error(`Invalid info response:`, raw)
        }, { label: 'getInfo', timeoutMs: 12000 })
    }

    async getHealth() {
        // Use backend's atomic get-health command to avoid race conditions with monitoring
        return new Promise((resolve, reject) => {
            if (!this.serial?.socket?.connected) {
                reject(new Error('Not connected'))
                return
            }
            this.serial.socket.emit('get-health', { path: this.serial.portPath }, (result) => {
                if (result.ok) {
                    resolve(result.health)
                } else {
                    reject(new Error(result.error || 'Failed to get health'))
                }
            })
        })
    }

    async resetHealth() {
        // Use backend's atomic reset-health command to avoid race conditions with monitoring
        return new Promise((resolve, reject) => {
            if (!this.serial?.socket?.connected) {
                reject(new Error('Not connected'))
                return
            }
            this.serial.socket.emit('reset-health', { path: this.serial.portPath }, (result) => {
                if (result.ok) {
                    resolve()
                } else {
                    reject(new Error(result.error || 'Failed to reset health'))
                }
            })
        })
    }

    async getSymbolList() {
        return this._enqueueCommand(async () => {
            const command = "SL"
            const cmdHex = this.plc.stringToHex(command)
            const checksum = this.plc.crc8(this.plc.parseHex(cmdHex)).toString(16).padStart(2, '0')
            
            // Use atomic command method to avoid conflicts with monitoring loop
            const line = await this.serial.command(command + checksum.toUpperCase() + "\n", 8000)
            let raw = line.trim()
            if (!raw) return []

            if (raw.startsWith('[') && raw.endsWith(']')) {
                const content = raw.substring(1, raw.length - 1)
                const firstBrace = content.indexOf('{')
                if (firstBrace === -1) return []

                const headerPart = content.substring(0, firstBrace)
                const headerParts = headerPart.split(',').filter(p => p.trim())
                if (headerParts[0] !== 'PS') return []

                const count = parseInt(headerParts[1], 10)
                if (count === 0 || isNaN(count)) return []

                const symbols = []
                const symbolRegex = /\{([^}]*)\}/g
                let match
                while ((match = symbolRegex.exec(content)) !== null) {
                    const parts = match[1].split(',')
                    if (parts.length >= 5) {
                        symbols.push({
                            name: parts[0] || '',
                            area: parts[1] || '',
                            address: parseInt(parts[2], 10) || 0,
                            bit: parseInt(parts[3], 10) || 0,
                            type: parts[4] || 'byte',
                            comment: parts.slice(5).join(',')
                        })
                    }
                }
                return symbols
            }
            return []
        }, { label: 'getSymbolList', timeoutMs: 8000 })
    }

    async getTransportInfo() {
        return this._enqueueCommand(async () => {
            const command = "TI"
            const cmdHex = this.plc.stringToHex(command)
            const checksum = this.plc.crc8(this.plc.parseHex(cmdHex)).toString(16).padStart(2, '0')
            
            // Use atomic command method to avoid conflicts with monitoring loop
            const line = await this.serial.command(command + checksum.toUpperCase() + "\n", 8000)
            let raw = line.trim()
            if (!raw) return []

            if (raw.startsWith('[') && raw.endsWith(']')) {
                const content = raw.substring(1, raw.length - 1)
                const firstBrace = content.indexOf('{')
                if (firstBrace === -1) return []

                const headerPart = content.substring(0, firstBrace)
                const headerParts = headerPart.split(',').filter(p => p.trim())
                if (headerParts[0] !== 'TI') return []

                const count = parseInt(headerParts[1], 10)
                if (count === 0 || isNaN(count)) return []

                const transports = []
                const transportRegex = /\{([^}]*)\}/g
                let match
                while ((match = transportRegex.exec(content)) !== null) {
                    const parts = match[1].split(',')
                    if (parts.length >= 5) {
                        const type = parseInt(parts[0], 10) || 0
                        const name = parts[1] || ''
                        const isNetwork = parts[2] === '1'
                        const requiresAuth = parts[3] === '1'
                        const isConnected = parts[4] === '1'
                        const transport = { type, name, isNetwork, requiresAuth, isConnected }
                        if (!isNetwork && parts.length >= 6) {
                            transport.baudrate = parseInt(parts[5], 10) || 0
                        } else if (isNetwork && parts.length >= 10) {
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
        }, { label: 'getTransportInfo', timeoutMs: 8000 })
    }

    async getDataBlockInfo() {
        return this._enqueueCommand(async () => {
            const command = this.plc.buildCommand.dbInfo()
            
            // Use atomic command method to avoid conflicts with monitoring loop
            const line = await this.serial.command(command + "\n", 5000)
            const raw = line.trim()
            if (!raw || !raw.startsWith('DA')) {
                return { slots: 0, active: 0, table_offset: 0, free_space: 0, lowest_address: 0, entries: [] }
            }

            const hex = raw.substring(2)
            const parseU16 = (offset) => parseInt(hex.slice(offset, offset + 4), 16) || 0

            const slots = parseU16(0)
            const active = parseU16(4)
            const table_offset = parseU16(8)
            const free_space = parseU16(12)
            const lowest_address = parseU16(16)

            const entries = []
            let pos = 20
            while (pos + 12 <= hex.length) {
                const db = parseU16(pos)
                const offset = parseU16(pos + 4)
                const size = parseU16(pos + 8)
                if (db !== 0) entries.push({ db, offset, size })
                pos += 12
            }

            return { slots, active, table_offset, free_space, lowest_address, entries }
        }, { label: 'getDataBlockInfo', timeoutMs: 5000 })
    }

    // ─── Internal command queue ─────────────────────────────────────────────

    async _waitForReply(timeout = 1000) {
        const start = Date.now()
        while (!this.serial.available()) {
            if (!this.serial.isOpen) return false
            if (Date.now() - start > timeout) return false
            await new Promise(r => setTimeout(r, 10))
        }
        return true
    }

    async _readResponseLine(timeout = 5000) {
        const start = Date.now()
        while (true) {
            if (!this.serial.isOpen) throw new Error('Connection closed')
            const line = this.serial.readLine()
            if (line !== null) return line
            if (Date.now() - start > timeout) throw new Error("Timeout waiting for response line")
            await new Promise(r => setTimeout(r, 10))
        }
    }

    _enqueueCommand(handler, options = {}) {
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : this._commandTimeoutMs
        const label = options.label || 'command'
        return new Promise((resolve, reject) => {
            if (this._commandQueue.length >= this._commandQueueLimit) {
                reject(new Error('Serial command queue full'))
                return
            }
            this._commandQueue.push({ handler, resolve, reject, timeoutMs, label })
            this._drainCommandQueue()
        })
    }

    // ─── Memory Monitoring Subscriptions ────────────────────────────────────────
    
    /**
     * Whether this connection supports subscription-based monitoring
     * (backend handles the polling loop instead of frontend)
     */
    supportsSubscriptions = true

    /** @type {((results: Array<{address: number, size: number, data: number[]}>) => void) | null} */
    onMemoryData = null

    /**
     * Subscribe to memory monitoring
     * Backend will continuously read these memory regions and push data via Socket.IO
     * @param {Array<{address: number, size: number}>} regions - Memory regions to monitor
     * @param {number} [intervalMs=100] - Backend polling interval
     * @returns {Promise<void>}
     */
    async subscribeMemory(regions, intervalMs = 100) {
        // Forward callback to socket
        this.serial.onMemoryData = (results) => {
            if (this.onMemoryData) {
                this.onMemoryData(results)
            }
        }
        await this.serial.subscribeMemory(regions, intervalMs)
    }

    /**
     * Unsubscribe from memory monitoring
     * @returns {Promise<void>}
     */
    async unsubscribeMemory() {
        this.serial.onMemoryData = null
        await this.serial.unsubscribeMemory()
    }

    /**
     * Check if currently subscribed to memory monitoring
     * @returns {boolean}
     */
    isSubscribed() {
        return this.serial.isSubscribed()
    }

    async _drainCommandQueue() {
        if (this._commandRunning) return
        this._commandRunning = true
        while (this._commandQueue.length) {
            const item = this._commandQueue.shift()
            if (!item) continue
            try {
                const result = await this._withTimeout(
                    Promise.resolve().then(item.handler),
                    item.timeoutMs,
                    item.label
                )
                item.resolve(result)
            } catch (err) {
                item.reject(err)
            }
        }
        this._commandRunning = false
    }

    _withTimeout(promise, timeoutMs, label) {
        if (!timeoutMs || timeoutMs <= 0) return promise
        let timer = null
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(`Serial command timed out (${label})`))
            }, timeoutMs)
        })
        return Promise.race([promise, timeout]).finally(() => {
            if (timer) clearTimeout(timer)
        })
    }

    _clearCommandQueue() {
        // Reset running flag - crucial for reconnect to work
        this._commandRunning = false
        if (!this._commandQueue.length) return
        const err = new Error('Serial command queue cleared')
        while (this._commandQueue.length) {
            const item = this._commandQueue.shift()
            if (item && typeof item.reject === 'function') {
                item.reject(err)
            }
        }
    }
}
