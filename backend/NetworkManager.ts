/**
 * @file NetworkManager.ts
 * @description Manages TCP socket connections to PLC devices on the local network.
 * Provides broadcast discovery, TCP probing, connect, disconnect, read, and write operations.
 * Each connection maintains a read buffer identical to SerialManager's model so the
 * frontend SocketNetworkConnection driver can use the same command-response pattern.
 */

import net from 'node:net'
import dgram from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { buildProgramInfoCommand } from './plc-protocol.ts'

export interface NetworkTarget {
    host: string
    port: number
    protocol?: 'tcp' | 'udp'
}

export interface ScanResult {
    host: string
    port: number
    reachable: boolean
    responseTime?: number
    info?: string
}

interface ManagedConnection {
    socket: net.Socket
    host: string
    port: number
    readBuffer: number[]
    maxBufferSize: number
}

export default class NetworkManager {
    private connections: Map<string, ManagedConnection> = new Map()
    private connecting: Set<string> = new Set()
    private maxBufferSize = 32 * 1024
    private discoverySession = randomBytes(16).toString('hex')
    private discoverySequence = 0

    async discoverPlcs(localAddress: string, port = 19617, timeoutMs = 1500): Promise<Array<{ host: string, port: number, uid: string, info: string }>> {
        if (net.isIP(localAddress) !== 4) throw new Error('Invalid local IPv4 address')
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid discovery port')
        if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) throw new Error('Invalid discovery timeout')
        const iface = Object.values(networkInterfaces()).flat().find(address => address?.family === 'IPv4' && address.address === localAddress)
        if (!iface) throw new Error('Network interface is unavailable')
        const ip = localAddress.split('.').map(Number)
        const mask = iface.netmask.split('.').map(Number)
        const broadcast = ip.map((octet, index) => octet | (255 ^ mask[index])).join('.')
        const request = { magic: 'VOVKPLC_DISCOVER', version: 1, session: this.discoverySession, id: ++this.discoverySequence, nonce: randomBytes(16).toString('hex') }
        const results = new Map<string, { host: string, port: number, uid: string, info: string }>()
        return new Promise((resolve, reject) => {
            const socket = dgram.createSocket('udp4')
            let finished = false
            const finish = (error?: Error) => {
                if (finished) return
                finished = true
                clearTimeout(timer)
                try { socket.close() } catch {}
                if (error) reject(error)
                else resolve([...results.values()])
            }
            const timer = setTimeout(() => finish(), timeoutMs)
            socket.on('error', finish)
            socket.on('message', (message, remote) => {
                if (message.length > 4096) return
                try {
                    const reply = JSON.parse(message.toString('utf8'))
                    if (reply.magic !== 'VOVKPLC_DEVICE' || reply.version !== 1 || reply.session !== request.session || reply.id !== request.id || reply.nonce !== request.nonce) return
                    if (typeof reply.uid !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(reply.uid)) return
                    if (!Number.isInteger(reply.port) || reply.port < 1 || reply.port > 65535) return
                    if (typeof reply.info !== 'string' || !/^\[VovkPLCRuntime,[^\]\r\n]*\]$/.test(reply.info) || reply.info.slice(1, -1).split(',').length < 15) return
                    const result = { host: remote.address, port: reply.port, uid: reply.uid, info: reply.info }
                    results.set(`${reply.uid}:${remote.address}:${reply.port}`, result)
                } catch {}
            })
            socket.bind(0, localAddress, () => {
                try {
                    socket.setBroadcast(true)
                    socket.send(Buffer.from(JSON.stringify(request)), port, broadcast, error => { if (error) finish(error) })
                } catch (error) { finish(error as Error) }
            })
        })
    }

    private connectionKey(host: string, port: number): string {
        return `${host}:${port}`
    }

    /**
     * Scan a range of IPs on a specific port using TCP connect probing.
     * Returns which hosts responded within the timeout.
     */
    async scanNetwork(
        baseIp: string,
        port: number,
        startHost: number = 1,
        endHost: number = 254,
        timeoutMs: number = 500,
        onProgress?: (scanned: number, total: number) => void,
        localAddress?: string
    ): Promise<ScanResult[]> {
        // Extract the base subnet (e.g., "192.168.1" from "192.168.1.0")
        const parts = baseIp.split('.')
        if (net.isIP(baseIp) !== 4) throw new Error('Invalid IPv4 address')
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
        if (!Number.isInteger(startHost) || !Number.isInteger(endHost) || startHost < 1 || endHost > 254 || startHost > endHost) throw new Error('Invalid host range')
        if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) throw new Error('Invalid probe timeout')
        const subnet = parts.slice(0, 3).join('.')

        const total = endHost - startHost + 1
        let scanned = 0
        const results: ScanResult[] = []

        // Probe in batches to avoid opening too many sockets at once
        const batchSize = 32
        for (let i = startHost; i <= endHost; i += batchSize) {
            const batch: Promise<ScanResult>[] = []
            for (let j = i; j < i + batchSize && j <= endHost; j++) {
                const host = `${subnet}.${j}`
                batch.push(this.probeHost(host, port, timeoutMs, localAddress))
            }
            const batchResults = await Promise.all(batch)
            for (const result of batchResults) {
                results.push(result)
                scanned++
            }
            onProgress?.(scanned, total)
        }

        return results
    }

    /**
     * Probe a single host:port with TCP connect
     */
    probeHost(host: string, port: number, timeoutMs: number = 1000, localAddress?: string): Promise<ScanResult> {
        if (net.isIP(host) !== 4) throw new Error('Invalid IPv4 address')
        if (localAddress && net.isIP(localAddress) !== 4) throw new Error('Invalid local IPv4 address')
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
        if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) throw new Error('Invalid probe timeout')
        return new Promise((resolve) => {
            const start = Date.now()
            const socket = new net.Socket()
            let response = ''
            let finished = false

            const finish = (info?: string) => {
                if (finished) return
                finished = true
                clearTimeout(timer)
                socket.removeAllListeners()
                socket.destroy()
                resolve(info ? { host, port, reachable: true, responseTime: Date.now() - start, info } : { host, port, reachable: false })
            }

            const timer = setTimeout(() => finish(), timeoutMs)
            socket.on('connect', () => socket.write(`${buildProgramInfoCommand()}\n`))
            socket.on('data', chunk => {
                response += chunk.toString('utf8')
                if (response.length > 8192) return finish()
                const match = response.match(/\[VovkPLCRuntime,[^\]\r\n]*\]/)
                if (match && match[0].slice(1, -1).split(',').length >= 15) finish(match[0])
            })
            socket.on('error', () => finish())
            socket.on('close', () => finish())
            socket.connect({ port, host, localAddress })
        })
    }

    /**
     * Open a TCP connection to a PLC device
     */
    async connect(
        target: NetworkTarget,
        callbacks?: {
            onData?: (key: string, data: number[]) => void
            onClose?: (key: string, err?: Error) => void
            onError?: (key: string, err: Error) => void
        }
    ): Promise<string> {
        const { host, port } = target
        if (net.isIP(host) !== 4) throw new Error('Invalid IPv4 address')
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
        const key = this.connectionKey(host, port)

        if (this.connections.has(key) || this.connecting.has(key)) {
            throw new Error(`Already connected to ${key}`)
        }

        this.connecting.add(key)
        return new Promise<string>((resolve, reject) => {
            const socket = new net.Socket()
            const timeoutMs = 10000

            const managed: ManagedConnection = {
                socket,
                host,
                port,
                readBuffer: [],
                maxBufferSize: this.maxBufferSize,
            }

            const connectTimeout = setTimeout(() => {
                socket.destroy()
                reject(new Error(`Connection to ${key} timed out`))
            }, timeoutMs)

            socket.on('connect', () => {
                clearTimeout(connectTimeout)
                this.connections.set(key, managed)
                resolve(key)
            })

            socket.on('data', (chunk: Buffer) => {
                managed.readBuffer = managed.readBuffer.concat(Array.from(chunk)).slice(-managed.maxBufferSize)
                callbacks?.onData?.(key, Array.from(chunk))
            })

            socket.on('close', () => {
                if (this.connections.get(key) === managed) this.connections.delete(key)
                callbacks?.onClose?.(key)
            })

            socket.on('error', (err: Error) => {
                clearTimeout(connectTimeout)
                if (!this.connections.has(key)) {
                    // Connection was never established
                    reject(new Error(`Failed to connect to ${key}: ${err.message}`))
                } else {
                    callbacks?.onError?.(key, err)
                }
            })

            socket.connect(port, host)
        }).finally(() => this.connecting.delete(key))
    }

    /**
     * Disconnect from a device
     */
    async disconnect(key: string): Promise<void> {
        const managed = this.connections.get(key)
        if (!managed) {
            throw new Error(`No connection to ${key}`)
        }

        return new Promise<void>((resolve) => {
            const finish = () => {
                clearTimeout(timer)
                if (this.connections.get(key) === managed) this.connections.delete(key)
                resolve()
            }
            const timer = setTimeout(finish, 2000)
            managed.socket.once('close', () => {
                finish()
            })
            managed.socket.destroy()
        })
    }

    /**
     * Write data to a connected device
     */
    async write(key: string, data: string | number[]): Promise<void> {
        const managed = this.connections.get(key)
        if (!managed) {
            throw new Error(`No connection to ${key}`)
        }

        const buffer = typeof data === 'string'
            ? Buffer.from(data, 'utf-8')
            : Buffer.from(data)

        return new Promise<void>((resolve, reject) => {
            const ok = managed.socket.write(buffer, (err) => {
                if (err) reject(new Error(`Write error on ${key}: ${err.message}`))
                else resolve()
            })
            if (!ok) {
                // Back-pressure: wait for drain
                managed.socket.once('drain', () => resolve())
            }
        })
    }

    /**
     * Read available bytes from the internal buffer
     */
    read(key: string, maxBytes?: number): number[] {
        const managed = this.connections.get(key)
        if (!managed) {
            throw new Error(`No connection to ${key}`)
        }

        if (maxBytes !== undefined && maxBytes > 0) {
            return managed.readBuffer.splice(0, maxBytes)
        }
        const data = [...managed.readBuffer]
        managed.readBuffer.length = 0
        return data
    }

    /**
     * Check how many bytes are available in the read buffer
     */
    availableBytes(key: string): number {
        const managed = this.connections.get(key)
        if (!managed) return 0
        return managed.readBuffer.length
    }

    /**
     * Check if a connection is active
     */
    isConnected(key: string): boolean {
        const managed = this.connections.get(key)
        return managed?.socket?.readable ?? false
    }

    /**
     * Get list of active connections
     */
    getActiveConnections(): string[] {
        return [...this.connections.keys()]
    }

    /**
     * Send a UDP broadcast for device discovery
     */
    async udpDiscover(
        broadcastAddress: string,
        port: number,
        message: string | Buffer,
        timeoutMs: number = 3000
    ): Promise<Array<{ host: string, port: number, response: number[] }>> {
        return new Promise((resolve) => {
            const results: Array<{ host: string, port: number, response: number[] }> = []
            const client = dgram.createSocket('udp4')

            client.on('error', () => {
                client.close()
                resolve(results)
            })

            client.on('message', (msg, rinfo) => {
                results.push({
                    host: rinfo.address,
                    port: rinfo.port,
                    response: Array.from(msg),
                })
            })

            client.bind(() => {
                client.setBroadcast(true)
                const buf = typeof message === 'string' ? Buffer.from(message) : message
                client.send(buf, 0, buf.length, port, broadcastAddress, (err) => {
                    if (err) {
                        client.close()
                        resolve(results)
                    }
                })
            })

            setTimeout(() => {
                client.close()
                resolve(results)
            }, timeoutMs)
        })
    }

    /**
     * Close all connections (cleanup)
     */
    async closeAll(): Promise<void> {
        const keys = [...this.connections.keys()]
        for (const key of keys) {
            try {
                await this.disconnect(key)
            } catch {
                // Ignore errors during cleanup
            }
        }
    }
}
