import { io } from './tools/socketSerial.js'
import SocketSerialConnection from './SocketSerialConnection.js'

class SocketNetwork {
    constructor() {
        this.socket = null
        this.key = null
        this.isOpen = false
        this.buffer = ''
        this.pending = null
        this.closing = false
        this.onDisconnect = null
    }

    async begin({ host, port, serverUrl }) {
        this.socket = io(`${serverUrl || window.location.origin}/network`, { transports: ['websocket', 'polling'], reconnection: false })
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Network server connection timed out')), 10000)
                this.socket.once('connect', () => { clearTimeout(timer); resolve(true) })
                this.socket.once('connect_error', error => { clearTimeout(timer); reject(error) })
            })
            this.socket.on('data', message => {
                if (message.key !== this.key) return
                this.buffer += new TextDecoder().decode(new Uint8Array(message.data))
                if (this.buffer.length > 140000) return this._lost(new Error('Network response too large'))
                this._receive()
            })
            this.socket.on('closed', message => {
                if (message.key === this.key && !this.closing) this._lost(new Error(message.error || 'Device disconnected'))
            })
            this.socket.on('error', message => {
                if (message.key === this.key && !this.closing) this._lost(new Error(message.error || 'Network device error'))
            })
            this.socket.on('disconnect', reason => {
                if (!this.closing && this.isOpen) this._lost(new Error(`Network server disconnected: ${reason}`))
            })
            const result = await this._emit('connect-device', { host, port })
            if (!result.ok) throw new Error(result.error || 'Device connection failed')
            this.key = result.key
            this.isOpen = true
        } catch (error) {
            this.socket?.disconnect()
            this.socket = null
            throw error
        }
    }

    _emit(event, data) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Network ${event} timed out`)), 15000)
            this.socket.emit(event, data, result => { clearTimeout(timer); resolve(result) })
        })
    }

    _lost(error) {
        if (!this.isOpen) return
        this.isOpen = false
        this.pending?.reject(error)
        this.onDisconnect?.(error)
    }

    _receive() {
        if (!this.pending) return
        const end = this.buffer.indexOf('\n')
        if (end < 0) return
        const line = this.buffer.slice(0, end + 1)
        this.buffer = this.buffer.slice(end + 1)
        this.pending.resolve(line)
    }

    async command(command, timeoutMs = 5000) {
        if (!this.isOpen || !this.socket?.connected) throw new Error('Network device is not connected')
        this.buffer = ''
        let timer
        const response = new Promise((resolve, reject) => {
            const finish = callback => value => { clearTimeout(timer); this.pending = null; callback(value) }
            this.pending = { resolve: finish(resolve), reject: finish(reject) }
            timer = setTimeout(() => this._lost(new Error('Network device response timed out')), timeoutMs)
        })
        response.catch(() => {})
        try {
            const result = await this._emit('write', { key: this.key, data: command })
            if (!result.ok) throw new Error(result.error || 'Network write failed')
        } catch (error) {
            this.pending?.reject(error)
        }
        return response
    }

    async write(data) {
        const result = await this._emit('write', { key: this.key, data })
        if (!result.ok) throw new Error(result.error || 'Network write failed')
    }

    available() { return this.buffer.length }
    readAll() { const data = this.buffer; this.buffer = ''; return data }
    isSubscribed() { return false }

    async end() {
        this.closing = true
        this.pending?.reject(new Error('Network connection closed'))
        if (this.socket?.connected && this.key) {
            try { await this._emit('disconnect-device', { key: this.key }) } catch {}
        }
        this.socket?.disconnect()
        this.socket = null
        this.key = null
        this.isOpen = false
        this.buffer = ''
    }
}

export default class SocketNetworkConnection extends SocketSerialConnection {
    constructor(debug = false) {
        super(115200, debug)
        this.serial = /** @type {any} */ (new SocketNetwork())
        this.serial.onDisconnect = error => this.onDisconnected?.(error)
        this.supportsSubscriptions = false
    }

    async connect(options = null) {
        this._clearCommandQueue()
        if (!options) throw new Error('Network target is required')
        await this.serial.begin(options)
        return true
    }

    async getInfo() { return super.getInfo(false) }

    async readMemory(address, size) {
        return this._enqueueCommand(async () => {
            const response = (await this.serial.command(this.plc.buildCommand.memoryRead(address, size) + '\n', 8000)).trim()
            if (!/^OK(?: (?:[0-9a-fA-F]{2})*)?$/.test(response)) throw new Error(`Memory read failed: ${response}`)
            const bytes = this.plc.parseHex(response.slice(3))
            if (bytes.length !== size) throw new Error('Memory read returned an unexpected size')
            return new Uint8Array(bytes)
        }, { label: 'readMemory' })
    }

    async writeMemory(address, data) {
        return this._enqueueCommand(async () => {
            const response = (await this.serial.command(this.plc.buildCommand.memoryWrite(address, data) + '\n', 2000)).trim()
            if (response !== 'OK MEMORY WRITE') throw new Error(`Memory write failed: ${response}`)
        }, { label: 'writeMemory' })
    }

    async writeMemoryAreaMasked(address, data, mask) {
        return this._enqueueCommand(async () => {
            const response = (await this.serial.command(this.plc.buildCommand.memoryWriteMask(address, data, mask) + '\n', 2000)).trim()
            if (response !== 'OK MEMORY WRITE MASK') throw new Error(`Masked write failed: ${response}`)
        }, { label: 'writeMemoryAreaMasked' })
    }

    async formatMemory(address, size, value) {
        return this._enqueueCommand(async () => {
            const response = (await this.serial.command(this.plc.buildCommand.memoryFormat(address, size, value) + '\n', 2000)).trim()
            if (response !== 'OK MEMORY FORMAT') throw new Error(`Memory format failed: ${response}`)
        }, { label: 'formatMemory' })
    }

    async run() {
        return this._enqueueCommand(async () => {
            const response = (await this.serial.command(this.plc.buildCommand.programRun() + '\n', 5000)).trim()
            if (response !== 'OK PROGRAM RUN') throw new Error(`Run failed: ${response}`)
        }, { label: 'run' })
    }

    async stop() {
        return this._enqueueCommand(async () => {
            const response = (await this.serial.command(this.plc.buildCommand.programStop() + '\n', 5000)).trim()
            if (response !== 'OK PROGRAM STOP') throw new Error(`Stop failed: ${response}`)
        }, { label: 'stop' })
    }

    async getHealth() {
        return this._enqueueCommand(async () => {
            const command = 'PH'
            const checksum = this.plc.crc8(this.plc.parseHex(this.plc.stringToHex(command))).toString(16).padStart(2, '0').toUpperCase()
            const response = (await this.serial.command(command + checksum + '\n', 5000)).trim()
            const start = response.indexOf('PH')
            const hex = (start >= 0 ? response.slice(start + 2) : response).replace(/[^0-9a-fA-F]/g, '')
            if (hex.length < 48) throw new Error('Invalid health response')
            const names = ['last_cycle_time_us', 'min_cycle_time_us', 'max_cycle_time_us', 'ram_free', 'min_ram_free', 'max_ram_free', 'total_ram_size', 'last_period_us', 'min_period_us', 'max_period_us', 'last_jitter_us', 'min_jitter_us', 'max_jitter_us']
            return Object.fromEntries(names.map((name, index) => [name, parseInt(hex.slice(index * 8, index * 8 + 8), 16) >>> 0]))
        }, { label: 'getHealth' })
    }

    async resetHealth() {
        return this._enqueueCommand(async () => {
            const command = 'RH'
            const checksum = this.plc.crc8(this.plc.parseHex(this.plc.stringToHex(command))).toString(16).padStart(2, '0').toUpperCase()
            await this.serial.command(command + checksum + '\n', 5000)
        }, { label: 'resetHealth' })
    }
}