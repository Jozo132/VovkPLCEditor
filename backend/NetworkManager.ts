/**
 * @file NetworkManager.ts
 * @description Manages TCP socket connections to PLC devices on the local network.
 * Provides scan (via port probing), connect, disconnect, read, and write operations.
 * Each connection maintains a read buffer identical to SerialManager's model so the
 * frontend SocketNetworkConnection driver can use the same command-response pattern.
 */

import net from 'node:net'
import dgram from 'node:dgram'

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
    private maxBufferSize = 32 * 1024

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
        onProgress?: (scanned: number, total: number) => void
    ): Promise<ScanResult[]> {
        // Extract the base subnet (e.g., "192.168.1" from "192.168.1.0")
        const parts = baseIp.split('.')
        if (parts.length !== 4) throw new Error('Invalid base IP address')
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
                batch.push(this.probeHost(host, port, timeoutMs))
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
    private probeHost(host: string, port: number, timeoutMs: number): Promise<ScanResult> {
        return new Promise((resolve) => {
            const start = Date.now()
            const socket = new net.Socket()

            const cleanup = () => {
                socket.removeAllListeners()
                socket.destroy()
            }

            socket.setTimeout(timeoutMs)

            socket.on('connect', () => {
                const responseTime = Date.now() - start
                cleanup()
                resolve({ host, port, reachable: true, responseTime })
            })

            socket.on('timeout', () => {
                cleanup()
                resolve({ host, port, reachable: false })
            })

            socket.on('error', () => {
                cleanup()
                resolve({ host, port, reachable: false })
            })

            socket.connect(port, host)
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
        const key = this.connectionKey(host, port)

        if (this.connections.has(key)) {
            throw new Error(`Already connected to ${key}`)
        }

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
                for (let i = 0; i < chunk.length; i++) {
                    managed.readBuffer.push(chunk[i])
                    if (managed.readBuffer.length > managed.maxBufferSize) {
                        managed.readBuffer.shift()
                    }
                }
                callbacks?.onData?.(key, Array.from(chunk))
            })

            socket.on('close', () => {
                this.connections.delete(key)
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
        })
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
            managed.socket.once('close', () => {
                this.connections.delete(key)
                resolve()
            })
            managed.socket.destroy()
            // Safety timeout in case close event doesn't fire
            setTimeout(() => {
                this.connections.delete(key)
                resolve()
            }, 2000)
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
