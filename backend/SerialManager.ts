/**
 * @file SerialManager.ts
 * @description Manages serial port access on the backend via the `serialport` package.
 * Exposes methods that are called from Socket.IO event handlers to list, open,
 * close, write, and read serial ports. Each open port gets a read buffer so the
 * frontend can poll or stream data just like the Web Serial API in the browser.
 */

import { SerialPort } from 'serialport'

export interface SerialPortEntry {
    path: string
    manufacturer?: string
    serialNumber?: string
    pnpId?: string
    vendorId?: string
    productId?: string
}

export interface OpenPortOptions {
    path: string
    baudRate: number
    dataBits?: 5 | 6 | 7 | 8
    stopBits?: 1 | 1.5 | 2
    parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
}

interface ManagedPort {
    port: SerialPort
    path: string
    readBuffer: number[]
    maxBufferSize: number
    onData: ((chunk: Buffer) => void) | null
    onClose: ((err?: Error) => void) | null
    onError: ((err: Error) => void) | null
}

export default class SerialManager {
    private ports: Map<string, ManagedPort> = new Map()
    private maxBufferSize = 32 * 1024

    /**
     * List all available serial ports
     */
    async listPorts(): Promise<SerialPortEntry[]> {
        const portInfos = await SerialPort.list()
        return portInfos.map(p => ({
            path: p.path,
            manufacturer: p.manufacturer,
            serialNumber: p.serialNumber,
            pnpId: p.pnpId,
            vendorId: p.vendorId,
            productId: p.productId,
        }))
    }

    /**
     * Open a serial port. Returns immediately after the port is open.
     * Data received is buffered internally.
     */
    async openPort(
        options: OpenPortOptions,
        callbacks?: {
            onData?: (portPath: string, data: number[]) => void
            onClose?: (portPath: string, err?: Error) => void
            onError?: (portPath: string, err: Error) => void
        }
    ): Promise<void> {
        const { path, baudRate, dataBits = 8, stopBits = 1, parity = 'none' } = options

        if (this.ports.has(path)) {
            throw new Error(`Port ${path} is already open`)
        }

        return new Promise<void>((resolve, reject) => {
            const port = new SerialPort(
                { path, baudRate, dataBits, stopBits, parity, autoOpen: false },
            )

            const managed: ManagedPort = {
                port,
                path,
                readBuffer: [],
                maxBufferSize: this.maxBufferSize,
                onData: null,
                onClose: null,
                onError: null,
            }

            managed.onData = (chunk: Buffer) => {
                for (let i = 0; i < chunk.length; i++) {
                    managed.readBuffer.push(chunk[i])
                    if (managed.readBuffer.length > managed.maxBufferSize) {
                        managed.readBuffer.shift()
                    }
                }
                callbacks?.onData?.(path, Array.from(chunk))
            }

            managed.onClose = (err?: Error) => {
                this.ports.delete(path)
                callbacks?.onClose?.(path, err)
            }

            managed.onError = (err: Error) => {
                callbacks?.onError?.(path, err)
            }

            port.on('data', managed.onData)
            port.on('close', () => managed.onClose?.())
            port.on('error', (err) => managed.onError?.(err))

            port.open((err) => {
                if (err) {
                    reject(new Error(`Failed to open ${path}: ${err.message}`))
                    return
                }
                this.ports.set(path, managed)
                resolve()
            })
        })
    }

    /**
     * Close an open serial port
     */
    async closePort(path: string): Promise<void> {
        const managed = this.ports.get(path)
        if (!managed) {
            throw new Error(`Port ${path} is not open`)
        }

        return new Promise<void>((resolve, reject) => {
            managed.port.close((err) => {
                this.ports.delete(path)
                if (err) {
                    // If already closed, don't treat as error
                    if (err.message.includes('Port is not open')) {
                        resolve()
                        return
                    }
                    reject(new Error(`Failed to close ${path}: ${err.message}`))
                    return
                }
                resolve()
            })
        })
    }

    /**
     * Write data to an open serial port
     */
    async writePort(path: string, data: string | number[]): Promise<void> {
        const managed = this.ports.get(path)
        if (!managed) {
            throw new Error(`Port ${path} is not open`)
        }

        const buffer = typeof data === 'string'
            ? Buffer.from(data, 'utf-8')
            : Buffer.from(data)

        return new Promise<void>((resolve, reject) => {
            managed.port.write(buffer, (err) => {
                if (err) {
                    reject(new Error(`Write error on ${path}: ${err.message}`))
                    return
                }
                managed.port.drain((drainErr) => {
                    if (drainErr) {
                        reject(new Error(`Drain error on ${path}: ${drainErr.message}`))
                        return
                    }
                    resolve()
                })
            })
        })
    }

    /**
     * Read available bytes from the internal buffer
     */
    readPort(path: string, maxBytes?: number): number[] {
        const managed = this.ports.get(path)
        if (!managed) {
            throw new Error(`Port ${path} is not open`)
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
    availableBytes(path: string): number {
        const managed = this.ports.get(path)
        if (!managed) return 0
        return managed.readBuffer.length
    }

    /**
     * Check if a port is currently open
     */
    isPortOpen(path: string): boolean {
        const managed = this.ports.get(path)
        return managed?.port?.isOpen ?? false
    }

    /**
     * Get list of currently open ports
     */
    getOpenPorts(): string[] {
        return [...this.ports.keys()]
    }

    /**
     * Close all open ports (cleanup)
     */
    async closeAll(): Promise<void> {
        const paths = [...this.ports.keys()]
        for (const path of paths) {
            try {
                await this.closePort(path)
            } catch {
                // Ignore close errors during cleanup
            }
        }
    }
}
