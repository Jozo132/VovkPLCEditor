/**
 * @file socketSerial.js
 * @description Socket.IO-based serial transport that provides the same interface
 * as the Web Serial API wrapper (tools/serial.js). Instead of using navigator.serial,
 * it communicates with the backend's /serial Socket.IO namespace which proxies to
 * a real serial port via the `serialport` Node.js package.
 *
 * This allows serial port access from any browser (not just Chromium) since the
 * actual serial I/O happens server-side.
 */

import { io } from 'socket.io-client'

export default class SocketSerial {
    constructor(maxBufferLength = 32 * 1024, debug = false) {
        this.debug = debug
        /** @type {import('socket.io-client').Socket | null} */
        this.socket = null
        this.isOpen = false
        this.portPath = ''
        this._readBuffer = []
        this._maxBufferLength = maxBufferLength
        this._closing = false

        /** @type {((error: Error) => void) | null} */
        this.onDisconnect = null
    }

    /**
     * Connect to the backend Socket.IO /serial namespace and open a serial port.
     * @param {{
     *     baudRate: number,
     *     dataBits?: 7 | 8,
     *     stopBits?: 1 | 2,
     *     parity?: 'none' | 'even' | 'odd',
     *     path?: string,
     *     serverUrl?: string,
     * }} [openOptions]
     */
    async begin(openOptions = { baudRate: 115200 }) {
        if (this.isOpen) {
            throw new Error('Socket serial already open. Call end() first.')
        }

        const serverUrl = openOptions.serverUrl || window.location.origin
        const baudRate = openOptions.baudRate || 115200
        const dataBits = openOptions.dataBits || 8
        const stopBits = openOptions.stopBits || 1
        const parity = openOptions.parity || 'none'

        // Connect to the backend /serial namespace
        this.socket = io(`${serverUrl}/serial`, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        })

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Socket.IO connection timeout'))
            }, 10000)

            this.socket.on('connect', () => {
                clearTimeout(timeout)
                resolve()
            })

            this.socket.on('connect_error', (err) => {
                clearTimeout(timeout)
                reject(new Error(`Socket.IO connection failed: ${err.message}`))
            })
        })

        // If no path specified, let user choose from available ports
        let portPath = openOptions.path
        if (!portPath) {
            const ports = await this.listPorts()
            if (ports.length === 0) {
                throw new Error('No serial ports available on the server')
            }
            // Let the caller handle port selection - throw with available ports
            const portList = ports.map(p => `${p.path}${p.manufacturer ? ` (${p.manufacturer})` : ''}`).join(', ')
            throw new Error(`No port specified. Available ports: ${portList}`)
        }

        // Open the port on the backend
        const result = await this._emit('open', {
            path: portPath,
            baudRate,
            dataBits,
            stopBits,
            parity,
        })

        if (!result.ok) {
            throw new Error(result.error || 'Failed to open serial port')
        }

        this.portPath = portPath
        this.isOpen = true
        this._closing = false
        this._readBuffer = []

        // Listen for incoming serial data
        this.socket.on('data', (msg) => {
            if (msg.path !== this.portPath) return
            const data = msg.data // number[]
            for (const byte of data) {
                this._readBuffer.push(byte & 0xff)
                if (this._readBuffer.length > this._maxBufferLength) {
                    this._readBuffer.shift()
                }
            }
        })

        // Listen for port closure
        this.socket.on('closed', (msg) => {
            if (msg.path !== this.portPath) return
            if (!this._closing) {
                this.isOpen = false
                if (this.onDisconnect) {
                    this.onDisconnect(new Error(msg.error || 'Serial port closed'))
                }
            }
        })

        // Listen for errors
        this.socket.on('error', (msg) => {
            if (msg.path !== this.portPath) return
            if (!this._closing && this.onDisconnect) {
                this.onDisconnect(new Error(msg.error || 'Serial port error'))
            }
        })

        // Handle Socket.IO disconnect
        this.socket.on('disconnect', (reason) => {
            if (!this._closing && this.isOpen) {
                this.isOpen = false
                if (this.onDisconnect) {
                    this.onDisconnect(new Error(`Socket.IO disconnected: ${reason}`))
                }
            }
        })

        if (this.debug) console.log(`[SocketSerial] Opened ${portPath} at ${baudRate} baud`)
    }

    /**
     * List available serial ports on the server
     * @returns {Promise<Array<{path: string, manufacturer?: string, serialNumber?: string, vendorId?: string, productId?: string}>>}
     */
    async listPorts() {
        if (!this.socket?.connected) {
            throw new Error('Not connected to server')
        }
        const result = await this._emit('list')
        if (!result.ok) throw new Error(result.error || 'Failed to list ports')
        return result.ports || []
    }

    /**
     * Close the serial port
     */
    async end() {
        if (!this.isOpen || !this.socket) return
        this._closing = true

        try {
            if (this.socket.connected && this.portPath) {
                await this._emit('close', { path: this.portPath })
            }
        } catch {
            // Ignore close errors
        }

        this.isOpen = false
        this.socket.removeAllListeners()
        this.socket.disconnect()
        this.socket = null
        this.portPath = ''
        this._readBuffer = []
        this._closing = false
    }

    /**
     * Returns the number of bytes available in the receive buffer.
     * @return {number}
     */
    available() {
        return this._readBuffer.length
    }

    /**
     * Reads the oldest byte from the receive buffer.
     * @return {number} Next byte (0-255) or -1 if no data available.
     */
    read() {
        if (this._readBuffer.length === 0) return -1
        return this._readBuffer.shift() & 0xff
    }

    /**
     * Peeks at a byte in the buffer without removing it.
     * @param {number} offset
     * @return {number}
     */
    peek(offset = 0) {
        if (this._readBuffer.length === 0) return -1
        if (offset < 0 || offset >= this._readBuffer.length) return -2
        return this._readBuffer[offset] & 0xff
    }

    /**
     * Reads a complete line (delimited by \n) from the buffer, if available.
     * @return {string|null}
     */
    readLine() {
        const newlineIndex = this._readBuffer.indexOf(10) // ASCII '\n'
        if (newlineIndex === -1) return null
        const lineBytes = this._readBuffer.splice(0, newlineIndex + 1)
        return new TextDecoder().decode(new Uint8Array(lineBytes)).trim()
    }

    /**
     * Reads and returns all available buffered data as a string.
     * @return {string}
     */
    readAll() {
        const all = new TextDecoder().decode(new Uint8Array(this._readBuffer))
        this._readBuffer = []
        return all
    }

    /**
     * Writes data to the serial port via the backend.
     * @param {string|Uint8Array|ArrayBuffer|number} data
     * @return {Promise<void>}
     */
    async write(data) {
        if (!this.isOpen || !this.socket?.connected) {
            throw new Error('Cannot write: serial port is not open')
        }

        let payload
        if (typeof data === 'string') {
            payload = data
        } else if (data instanceof Uint8Array) {
            payload = Array.from(data)
        } else if (data instanceof ArrayBuffer) {
            payload = Array.from(new Uint8Array(data))
        } else if (typeof data === 'number') {
            if (data >= 0 && data < 256 && Number.isInteger(data)) {
                payload = [data]
            } else {
                payload = String(data)
            }
        } else {
            payload = String(data)
        }

        const result = await this._emit('write', { path: this.portPath, data: payload })
        if (!result.ok) {
            throw new Error(result.error || 'Write failed')
        }
    }

    /**
     * Emit a Socket.IO event and wait for the acknowledgment callback.
     * @param {string} event
     * @param {any} [data]
     * @returns {Promise<any>}
     */
    _emit(event, data) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Socket.IO event '${event}' timed out`))
            }, 15000)

            const args = data !== undefined ? [data] : []
            this.socket.emit(event, ...args, (response) => {
                clearTimeout(timeout)
                resolve(response)
            })
        })
    }
}
