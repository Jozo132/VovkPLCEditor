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
import { Server as SocketIOServer } from 'socket.io'

// Only import device managers if not in frontend-only mode
let SerialManager: any = null
let NetworkManager: any = null

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

let serialManager: InstanceType<typeof SerialManager> | null = null
let networkManager: InstanceType<typeof NetworkManager> | null = null

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
            await serialManager.closePort(options.path)
            callback({ ok: true })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Write data to a serial port ---
    socket.on('write', async (options: { path: string, data: string | number[] }, callback) => {
        try {
            await serialManager.writePort(options.path, options.data)
            callback({ ok: true })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
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

    // Cleanup on disconnect
    socket.on('disconnect', () => {
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

    // --- Scan network for devices ---
    socket.on('scan', async (options: { baseIp: string, port: number, startHost?: number, endHost?: number, timeoutMs?: number }, callback) => {
        try {
            const results = await networkManager.scanNetwork(
                options.baseIp,
                options.port,
                options.startHost,
                options.endHost,
                options.timeoutMs,
                (scanned, total) => {
                    socket.emit('scan-progress', { scanned, total })
                }
            )
            callback({ ok: true, results })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- UDP broadcast discovery ---
    socket.on('discover', async (options: { broadcastAddress: string, port: number, message: string, timeoutMs?: number }, callback) => {
        try {
            const results = await networkManager.udpDiscover(
                options.broadcastAddress,
                options.port,
                options.message,
                options.timeoutMs
            )
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
                    onData: (connKey, data) => {
                        socket.emit('data', { key: connKey, data })
                    },
                    onClose: (connKey, err) => {
                        socket.emit('closed', { key: connKey, error: err?.message })
                    },
                    onError: (connKey, err) => {
                        socket.emit('error', { key: connKey, error: err.message })
                    },
                }
            )
            callback({ ok: true, key })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Disconnect from a device ---
    socket.on('disconnect-device', async (options: { key: string }, callback) => {
        try {
            await networkManager.disconnect(options.key)
            callback({ ok: true })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Write to a connected device ---
    socket.on('write', async (options: { key: string, data: string | number[] }, callback) => {
        try {
            await networkManager.write(options.key, options.data)
            callback({ ok: true })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Read buffered data from a connection ---
    socket.on('read', (options: { key: string, maxBytes?: number }, callback) => {
        try {
            const data = networkManager.read(options.key, options.maxBytes)
            callback({ ok: true, data })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Check available bytes ---
    socket.on('available', (options: { key: string }, callback) => {
        try {
            const count = networkManager.availableBytes(options.key)
            callback({ ok: true, count })
        } catch (err: any) {
            callback({ ok: false, error: err.message })
        }
    })

    // --- Check if connection is active ---
    socket.on('isConnected', (options: { key: string }, callback) => {
        callback({ ok: true, isConnected: networkManager.isConnected(options.key) })
    })

    // --- Get list of active connections ---
    socket.on('activeConnections', (callback) => {
        callback({ ok: true, connections: networkManager.getActiveConnections() })
    })

    socket.on('disconnect', () => {
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

