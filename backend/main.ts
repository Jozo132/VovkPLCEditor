/**
 * @file main.ts
 * @description VovkPLC Editor backend server.
 * Hosts the frontend static files over HTTP with Express, and provides
 * Socket.IO namespaces for serial port access and network device communication.
 *
 * Socket.IO Namespaces:
 *   /serial   - Serial port management (list, open, close, write, read)
 *   /network  - TCP/UDP network device management (scan, connect, disconnect, write, read)
 *
 * Command-line arguments:
 *   --frontendonly  Disable server-side device access (serial/network). Useful for
 *                   hosting the frontend without local device access vulnerabilities.
 */

import 'dotenv/config'

const HOST = process.env.HOST || 'localhost'
const PORT = process.env.PORT ? +process.env.PORT || 3000 : 3000

// Parse command-line arguments
const args = process.argv.slice(2)
const FRONTEND_ONLY = args.includes('--frontendonly') || args.includes('--frontend-only')

if (FRONTEND_ONLY) {
    console.log('Running in FRONTEND-ONLY mode: server-side device access is DISABLED')
}

import express from 'express'
import bodyParser from 'body-parser'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { Server as SocketIOServer } from 'socket.io'

// Only import device managers if not in frontend-only mode
let SerialManager: any = null
let NetworkManager: any = null
let serialManager: any = null
let networkManager: any = null

// Import PLC protocol utilities for monitoring
import { buildMemoryReadCommand, parseMemoryResponse, crc8, type MemorySubscription } from './plc-protocol.ts'

// Helper for single-byte CRC8
function crc8Single(byte: number, initial = 0): number {
    return crc8(byte, initial)
}

// Simple async mutex for serial port access
class SerialMutex {
    private _locked = false
    private _queue: (() => void)[] = []
    
    async acquire(): Promise<void> {
        if (!this._locked) {
            this._locked = true
            return
        }
        await new Promise<void>(resolve => this._queue.push(resolve))
    }
    
    release(): void {
        if (this._queue.length > 0) {
            const next = this._queue.shift()!
            next()
        } else {
            this._locked = false
        }
    }
    
    /**
     * Force release - clears all waiting and unlocks immediately.
     * Use when the port is being forcibly closed/reopened.
     */
    forceRelease(): void {
        this._locked = false
        // Resolve all waiters immediately so they can detect port closure
        while (this._queue.length > 0) {
            const next = this._queue.shift()!
            next()
        }
    }
    
    get isLocked(): boolean {
        return this._locked
    }
}

// Per-port mutex to prevent race conditions between monitoring and direct commands
const portMutexes = new Map<string, SerialMutex>()

// Track which sockets have acquired mutex (for releasing after read)
const socketMutexHolds = new Map<string, Set<string>>() // socketId -> Set of portPaths

function getPortMutex(portPath: string): SerialMutex {
    if (!portMutexes.has(portPath)) {
        portMutexes.set(portPath, new SerialMutex())
    }
    return portMutexes.get(portPath)!
}

function trackMutexHold(socketId: string, portPath: string): void {
    if (!socketMutexHolds.has(socketId)) {
        socketMutexHolds.set(socketId, new Set())
    }
    socketMutexHolds.get(socketId)!.add(portPath)
}

function releaseMutexHold(socketId: string, portPath: string): boolean {
    const holds = socketMutexHolds.get(socketId)
    if (holds?.has(portPath)) {
        holds.delete(portPath)
        return true
    }
    return false
}

// Per-socket monitoring state
interface MonitoringState {
    portPath: string | null
    subscriptions: Map<string, MemorySubscription> // key: "address:size"
    intervalHandle: NodeJS.Timeout | null
    running: boolean
}
const socketMonitoringState = new Map<string, MonitoringState>()

if (!FRONTEND_ONLY) {
    SerialManager = (await import('./SerialManager.ts')).default
    NetworkManager = (await import('./NetworkManager.ts')).default
}

// ─── Express setup ──────────────────────────────────────────────────────────

const app = express()
const httpServer = createServer(app)

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
    next()
})

app.use(express.static('./frontend/src')) // For development
// app.use(express.static('./frontend/dist')) // For production

app.get('/favicon.ico', (req, res) => { res.status(204).end() })

// ─── API Endpoints ──────────────────────────────────────────────────────────

/**
 * GET /api/capabilities
 * Returns server capabilities - tells the frontend what features are available
 */
app.get('/api/capabilities', (req, res) => {
    res.json({
        localDeviceAccess: !FRONTEND_ONLY,
        serial: !FRONTEND_ONLY,
        network: !FRONTEND_ONLY,
        socketIO: {
            namespaces: FRONTEND_ONLY ? [] : ['/serial', '/network'],
        },
        version: '0.1.0',
    })
})

app.get('/api/network/interfaces', (req, res) => {
    if (FRONTEND_ONLY) return res.status(503).json({ ok: false, error: 'Network access disabled' })
    const interfaces = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
        (addresses || []).filter(address => address.family === 'IPv4' && !address.internal)
            .map(address => ({ name, address: address.address, netmask: address.netmask })))
    res.json({ ok: true, interfaces })
})

app.post('/api/network/probe', async (req, res) => {
    if (FRONTEND_ONLY || !networkManager) return res.status(503).json({ ok: false, error: 'Network access disabled' })
    try {
        const result = await networkManager.probeHost(req.body.host, Number(req.body.port), 1500, req.body.localAddress || undefined)
        res.json({ ok: true, result })
    } catch (error: any) {
        res.status(400).json({ ok: false, error: error.message })
    }
})

app.post('/api/network/scan', async (req, res) => {
    if (FRONTEND_ONLY || !networkManager) return res.status(503).json({ ok: false, error: 'Network access disabled' })
    try {
        const results = await networkManager.discoverPlcs(req.body.baseIp)
        res.json({ ok: true, results })
    } catch (error: any) {
        res.status(400).json({ ok: false, error: error.message })
    }
})

/**
 * GET /api/serial/ports
 * Lists available serial ports (avoids needing a Socket.IO connection for polling)
 */
app.get('/api/serial/ports', async (req, res) => {
    if (FRONTEND_ONLY || !serialManager) {
        res.status(503).json({ ok: false, error: 'Serial access disabled' })
        return
    }
    try {
        const ports = await serialManager.listPorts()
        res.json({ ok: true, ports })
    } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message })
    }
})

app.use((req, res) => {
    res.status(404).end()
})


// ─── Socket.IO setup ────────────────────────────────────────────────────────

const io = new SocketIOServer(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
    // Allow large binary payloads for program downloads
    maxHttpBufferSize: 1e7, // 10 MB
})


// ─── Serial Namespace (/serial) ─────────────────────────────────────────────

if (!FRONTEND_ONLY) {
    serialManager = new SerialManager()

    const serialNsp = io.of('/serial')

serialNsp.on('connection', (socket) => {
    console.log(`[Serial] Client connected: ${socket.id}`)

    // --- List available serial ports ---
    socket.on('list', async (callback) => {
        try {
            const ports = await serialManager.listPorts()
            callback({ ok: true, ports })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Open a serial port ---
    socket.on('open', async (options: { path: string, baudRate: number, dataBits?: number, stopBits?: number, parity?: string }, callback) => {
        try {
            // Stop any existing monitoring for this socket before opening new port
            const existingState = socketMonitoringState.get(socket.id)
            if (existingState) {
                existingState.running = false
                if (existingState.intervalHandle) {
                    clearInterval(existingState.intervalHandle)
                    existingState.intervalHandle = null
                }
                existingState.subscriptions.clear()
                existingState.portPath = null
            }
            
            // If port is already open (e.g., from a crashed/disconnected session), close it first
            if (serialManager.isPortOpen(options.path)) {
                console.log(`[Serial] Port ${options.path} already open, closing before reopening...`)
                
                // Stop ALL monitoring that uses this port (from any socket)
                for (const [_socketId, state] of socketMonitoringState) {
                    if (state.portPath === options.path) {
                        state.running = false
                        if (state.intervalHandle) {
                            clearInterval(state.intervalHandle)
                            state.intervalHandle = null
                        }
                        state.subscriptions.clear()
                        state.portPath = null
                    }
                }
                
                // Force release the mutex for this port to unblock any pending operations
                const mutex = portMutexes.get(options.path)
                if (mutex) {
                    console.log(`[Serial] Force releasing mutex for ${options.path}`)
                    mutex.forceRelease()
                }
                
                // Give async operations a moment to bail out
                await new Promise(r => setTimeout(r, 50))
                
                await serialManager.closePort(options.path)
            }
            
            await serialManager.openPort(
                {
                    path: options.path,
                    baudRate: options.baudRate,
                    dataBits: (options.dataBits as any) || 8,
                    stopBits: (options.stopBits as any) || 1,
                    parity: (options.parity as any) || 'none',
                },
                {
                    onData: (portPath, data) => {
                        // Check if subscription monitoring is active for this socket/port
                        // If so, suppress 'data' events - monitoring loop handles the data
                        const monitorState = socketMonitoringState.get(socket.id)
                        if (monitorState?.running && monitorState.portPath === portPath) {
                            // Monitoring is active - don't emit raw data events
                            // The monitoring loop will read and process the data
                            return
                        }
                        // Push incoming serial data to the client in real-time
                        socket.emit('data', { path: portPath, data })
                    },
                    onClose: (portPath, err) => {
                        socket.emit('closed', { path: portPath, error: err?.message })
                    },
                    onError: (portPath, err) => {
                        socket.emit('error', { path: portPath, error: err.message })
                    },
                }
            )
            callback({ ok: true })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Close a serial port ---
    socket.on('close', async (options: { path: string }, callback) => {
        try {
            // Stop monitoring for this port
            const state = socketMonitoringState.get(socket.id)
            if (state && state.portPath === options.path) {
                state.running = false
                if (state.intervalHandle) {
                    clearInterval(state.intervalHandle)
                    state.intervalHandle = null
                }
                state.subscriptions.clear()
                state.portPath = null
            }
            
            await serialManager.closePort(options.path)
            callback({ ok: true })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Write data to a serial port ---
    // Note: Regular write/read flow uses 'data' events, not explicit reads.
    // Mutex is only needed for atomic operations like get-health/reset-health
    // which do their own internal read/write cycle.
    socket.on('write', async (options: { path: string, data: string | number[] }, callback) => {
        try {
            await serialManager.writePort(options.path, options.data)
            callback({ ok: true })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Atomic serial command (acquires mutex, sends command, waits for response) ---
    // Use this for commands like getSymbolList, getTransportInfo that need atomic access
    socket.on('serial-command', async (options: { 
        path: string, 
        command: string,
        timeoutMs?: number
    }, callback) => {
        const mutex = getPortMutex(options.path)
        await mutex.acquire()
        try {
            const timeout = options.timeoutMs || 5000
            
            // Clear any pending data in buffer
            serialManager.readPort(options.path)
            
            // Send command
            await serialManager.writePort(options.path, options.command)
            
            // Wait for response (with timeout)
            let response = ''
            const startTime = Date.now()
            
            while (Date.now() - startTime < timeout) {
                await new Promise(r => setTimeout(r, 10))
                const available = serialManager.availableBytes(options.path)
                if (available > 0) {
                    const bytes = serialManager.readPort(options.path)
                    response += String.fromCharCode(...bytes)
                    if (response.includes('\n')) break
                }
            }
            
            callback({ ok: true, response })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        } finally {
            mutex.release()
        }
    })

    // --- Read buffered data from a serial port ---
    socket.on('read', (options: { path: string, maxBytes?: number }, callback) => {
        try {
            const data = serialManager.readPort(options.path, options.maxBytes)
            callback({ ok: true, data })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Check available bytes ---
    socket.on('available', (options: { path: string }, callback) => {
        try {
            const count = serialManager.availableBytes(options.path)
            callback({ ok: true, count })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Check if port is open ---
    socket.on('isOpen', (options: { path: string }, callback) => {
        callback({ ok: true, isOpen: serialManager.isPortOpen(options.path) })
    })

    // --- Get list of open ports ---
    socket.on('openPorts', (callback) => {
        callback({ ok: true, ports: serialManager.getOpenPorts() })
    })

    // --- Get device health (atomic operation, works alongside monitoring) ---
    socket.on('get-health', async (options: { path: string }, callback) => {
        const mutex = getPortMutex(options.path)
        await mutex.acquire()
        try {
            // Build PH command with checksum
            const cmd = 'PH'
            let checksum = 0
            for (const c of cmd) {
                checksum = crc8Single(c.charCodeAt(0), checksum)
            }
            const command = cmd + checksum.toString(16).padStart(2, '0').toUpperCase() + '\n'
            
            // Clear buffer and send command
            serialManager.readPort(options.path)
            await serialManager.writePort(options.path, command)
            
            // Wait for response
            let response = ''
            const startTime = Date.now()
            const timeout = 2000
            
            while (Date.now() - startTime < timeout) {
                await new Promise(r => setTimeout(r, 10))
                const available = serialManager.availableBytes(options.path)
                if (available > 0) {
                    const bytes = serialManager.readPort(options.path)
                    response += String.fromCharCode(...bytes)
                    if (response.includes('\n')) break
                }
            }
            
            // Parse response
            let raw = response.trim()
            if (!raw.startsWith('PH')) {
                const idx = raw.indexOf('PH')
                if (idx >= 0) raw = raw.slice(idx)
            }
            if (raw.startsWith('PH')) raw = raw.slice(2)
            const hex = raw.replace(/[^0-9a-fA-F]/g, '')
            
            if (hex.length < 48) {
                callback({ ok: false, error: 'Invalid health response' })
                return
            }
            
            const parseU32 = (offset: number) => parseInt(hex.slice(offset, offset + 8), 16) >>> 0
            callback({
                ok: true,
                health: {
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
            })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        } finally {
            mutex.release()
        }
    })

    // --- Reset device health (atomic operation) ---
    socket.on('reset-health', async (options: { path: string }, callback) => {
        const mutex = getPortMutex(options.path)
        await mutex.acquire()
        try {
            // Build RH command with checksum
            const cmd = 'RH'
            let checksum = 0
            for (const c of cmd) {
                checksum = crc8Single(c.charCodeAt(0), checksum)
            }
            const command = cmd + checksum.toString(16).padStart(2, '0').toUpperCase() + '\n'
            
            // Clear buffer and send command
            serialManager.readPort(options.path)
            await serialManager.writePort(options.path, command)
            
            // Wait for response
            const startTime = Date.now()
            const timeout = 1000
            while (Date.now() - startTime < timeout) {
                await new Promise(r => setTimeout(r, 10))
                const available = serialManager.availableBytes(options.path)
                if (available > 0) {
                    serialManager.readPort(options.path) // consume response
                    break
                }
            }
            
            callback({ ok: true })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        } finally {
            mutex.release()
        }
    })

    // ─── Memory Monitoring Subscriptions ────────────────────────────────────────

    // Initialize monitoring state for this socket
    socketMonitoringState.set(socket.id, {
        portPath: null,
        subscriptions: new Map(),
        intervalHandle: null,
        running: false
    })

    /**
     * Subscribe to memory monitoring
     * Client sends array of {address, size} regions to monitor
     * Backend will continuously read these and emit 'memory-data' events
     */
    socket.on('subscribe-monitor', (options: { 
        path: string, 
        regions: { address: number, size: number }[],
        intervalMs?: number 
    }, callback) => {
        const state = socketMonitoringState.get(socket.id)
        if (!state) {
            callback({ ok: false, error: 'Monitoring state not found' })
            return
        }

        // Validate port is open
        if (!serialManager.isPortOpen(options.path)) {
            callback({ ok: false, error: `Port ${options.path} is not open` })
            return
        }

        // Stop existing monitoring if running
        if (state.intervalHandle) {
            clearInterval(state.intervalHandle)
            state.intervalHandle = null
        }
        state.running = false

        // Clear old subscriptions and set new ones
        state.subscriptions.clear()
        state.portPath = options.path

        for (const region of options.regions) {
            const key = `${region.address}:${region.size}`
            state.subscriptions.set(key, {
                address: region.address,
                size: region.size,
                command: buildMemoryReadCommand(region.address, region.size)
            })
        }

        const intervalMs = options.intervalMs || 100

        // Start monitoring loop
        state.running = true
        let processingCycle = false
        const mutex = getPortMutex(options.path)

        const monitoringLoop = async () => {
            if (!state.running || processingCycle) return
            if (!serialManager.isPortOpen(options.path)) {
                state.running = false
                return
            }

            processingCycle = true
            const results: { address: number, size: number, data: number[] }[] = []

            for (const [_key, sub] of state.subscriptions) {
                if (!state.running) break

                // Acquire mutex to prevent race with direct frontend commands
                await mutex.acquire()
                
                // Check again after acquiring - might have been force released during wait
                if (!state.running || !serialManager.isPortOpen(options.path)) {
                    mutex.release()
                    break
                }
                
                try {
                    // Clear read buffer before sending command
                    serialManager.readPort(options.path)
                    
                    // Send memory read command
                    await serialManager.writePort(options.path, sub.command + '\n')
                    
                    // Wait for response (with timeout)
                    let response = ''
                    const startTime = Date.now()
                    const timeout = 500 // 500ms timeout per read
                    
                    while (Date.now() - startTime < timeout && state.running) {
                        await new Promise(r => setTimeout(r, 10))
                        if (!serialManager.isPortOpen(options.path)) break
                        const available = serialManager.availableBytes(options.path)
                        if (available > 0) {
                            const bytes = serialManager.readPort(options.path)
                            response += String.fromCharCode(...bytes)
                            if (response.includes('\n')) break
                        }
                    }
                    
                    // Parse response
                    const parsed = parseMemoryResponse(response)
                    if (parsed) {
                        results.push({
                            address: sub.address,
                            size: sub.size,
                            data: Array.from(parsed)
                        })
                    }
                } catch (err) {
                    // Skip failed reads, continue with next subscription
                    // console.warn('[Monitor] Read failed:', err)
                } finally {
                    mutex.release()
                }
            }

            // Emit all results in a single event
            if (results.length > 0 && state.running) {
                socket.emit('memory-data', { results })
            }

            processingCycle = false
        }

        state.intervalHandle = setInterval(monitoringLoop, intervalMs)

        // Run immediately
        monitoringLoop()

        console.log(`[Serial] Client ${socket.id} subscribed to ${options.regions.length} memory regions on ${options.path}`)
        callback({ ok: true, subscribedRegions: options.regions.length })
    })

    /**
     * Unsubscribe from memory monitoring
     */
    socket.on('unsubscribe-monitor', (callback) => {
        const state = socketMonitoringState.get(socket.id)
        if (state) {
            state.running = false
            if (state.intervalHandle) {
                clearInterval(state.intervalHandle)
                state.intervalHandle = null
            }
            state.subscriptions.clear()
            state.portPath = null
            console.log(`[Serial] Client ${socket.id} unsubscribed from memory monitoring`)
        }
        callback({ ok: true })
    })

    // Cleanup on disconnect
    socket.on('disconnect', () => {
        // Stop monitoring for this socket and get the port path
        const state = socketMonitoringState.get(socket.id)
        let monitoredPortPath: string | null = null
        if (state) {
            monitoredPortPath = state.portPath
            state.running = false
            if (state.intervalHandle) {
                clearInterval(state.intervalHandle)
            }
            socketMonitoringState.delete(socket.id)
        }
        
        // Force release the mutex for the monitored port to unblock any pending operations
        if (monitoredPortPath) {
            const mutex = portMutexes.get(monitoredPortPath)
            if (mutex && mutex.isLocked) {
                console.log(`[Serial] Force releasing mutex for ${monitoredPortPath} on disconnect`)
                mutex.forceRelease()
            }
        }
        
        // Release any other mutex holds this socket had
        const holds = socketMutexHolds.get(socket.id)
        if (holds) {
            for (const portPath of holds) {
                const mutex = portMutexes.get(portPath)
                if (mutex) {
                    mutex.release()
                }
            }
            socketMutexHolds.delete(socket.id)
        }
        
        console.log(`[Serial] Client disconnected: ${socket.id}`)
        // Note: We don't auto-close ports on disconnect - the port stays open
        // so the client can reconnect and resume. Explicit close is required.
    })
})


    // ─── Network Namespace (/network) ───────────────────────────────────────────

    networkManager = new NetworkManager()

    const networkNsp = io.of('/network')

networkNsp.on('connection', (socket) => {
    console.log(`[Network] Client connected: ${socket.id}`)
    const ownedConnections = new Set<string>()

    // --- Scan network for devices ---
    socket.on('scan', async (options: { baseIp: string, timeoutMs?: number }, callback) => {
        try {
            const results = await networkManager.discoverPlcs(options.baseIp, 19617, options.timeoutMs)
            callback({ ok: true, results })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- UDP broadcast discovery ---
    socket.on('discover', async (options: { baseIp: string, timeoutMs?: number }, callback) => {
        try {
            const results = await networkManager.discoverPlcs(options.baseIp, 19617, options.timeoutMs)
            callback({ ok: true, results })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Connect to a device ---
    socket.on('connect-device', async (options: { host: string, port: number }, callback) => {
        try {
            const key = await networkManager.connect(
                { host: options.host, port: options.port },
                {
                    onData: (connKey: string, data: number[]) => {
                        socket.emit('data', { key: connKey, data })
                    },
                    onClose: (connKey: string, err?: Error) => {
                        ownedConnections.delete(connKey)
                        socket.emit('closed', { key: connKey, error: err?.message })
                    },
                    onError: (connKey: string, err: Error) => {
                        socket.emit('error', { key: connKey, error: err.message })
                    },
                }
            )
            if (!socket.connected) {
                await networkManager.disconnect(key)
                return
            }
            ownedConnections.add(key)
            callback({ ok: true, key })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Disconnect from a device ---
    socket.on('disconnect-device', async (options: { key: string }, callback) => {
        try {
            if (!ownedConnections.has(options.key)) throw new Error('Connection is not owned by this client')
            await networkManager.disconnect(options.key)
            ownedConnections.delete(options.key)
            callback({ ok: true })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Write to a connected device ---
    socket.on('write', async (options: { key: string, data: string | number[] }, callback) => {
        try {
            if (!ownedConnections.has(options.key)) throw new Error('Connection is not owned by this client')
            await networkManager.write(options.key, options.data)
            callback({ ok: true })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Read buffered data from a connection ---
    socket.on('read', (options: { key: string, maxBytes?: number }, callback) => {
        try {
            if (!ownedConnections.has(options.key)) throw new Error('Connection is not owned by this client')
            const data = networkManager.read(options.key, options.maxBytes)
            callback({ ok: true, data })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Check available bytes ---
    socket.on('available', (options: { key: string }, callback) => {
        try {
            if (!ownedConnections.has(options.key)) throw new Error('Connection is not owned by this client')
            const count = networkManager.availableBytes(options.key)
            callback({ ok: true, count })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Check if connection is active ---
    socket.on('isConnected', (options: { key: string }, callback) => {
        callback({ ok: true, isConnected: ownedConnections.has(options.key) && networkManager.isConnected(options.key) })
    })

    // --- Get list of active connections ---
    socket.on('activeConnections', (callback) => {
        callback({ ok: true, connections: [...ownedConnections] })
    })

    socket.on('disconnect', () => {
        for (const key of ownedConnections) networkManager.disconnect(key).catch(() => {})
        ownedConnections.clear()
        console.log(`[Network] Client disconnected: ${socket.id}`)
    })
})

} // end if (!FRONTEND_ONLY)


// ─── Start server ────────────────────────────────────────────────────────────

httpServer.listen(PORT, HOST, () => {
    console.log(`VovkPLCEditor Server listening on http://${HOST}:${PORT}`)
    if (FRONTEND_ONLY) {
        console.log(`  Mode: FRONTEND-ONLY (no local device access)`)
    } else {
        console.log(`  Socket.IO namespaces: /serial, /network`)
    }
})

// Cleanup on process exit
const cleanup = async () => {
    console.log('\nShutting down...')
    if (serialManager) await serialManager.closeAll()
    if (networkManager) await networkManager.closeAll()
    io.close()
    httpServer.close()
    process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

