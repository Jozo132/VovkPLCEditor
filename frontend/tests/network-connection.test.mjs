import assert from 'node:assert/strict'
import net from 'node:net'
import dgram from 'node:dgram'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import NetworkManager from '../../backend/NetworkManager.ts'
import { buildProgramInfoCommand } from '../../backend/plc-protocol.ts'
import VirtualPLC from '../../lib/VovkPLCRuntime/node/VirtualPLC.js'
import VirtualPLCServer from '../../lib/VovkPLCRuntime/node/VirtualPLCServer.js'

const info = '[VovkPLCRuntime,ESP32,1,0,0,1,date,64,1024,32768,0,256,256,64,device]'

test('backend discovers and probes real VirtualPLC instances', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vovk-discovery-'))
    const instances = []
    const servers = []
    try {
        for (const name of ['a', 'b']) instances.push(await new VirtualPLC(path.join(directory, name)).initialize())
        servers.push(await new VirtualPLCServer(instances[0], { host: '127.0.0.1', port: 0, discoveryPort: 0 }).start())
        servers.push(await new VirtualPLCServer(instances[1], { host: '127.0.0.2', port: 0, discoveryPort: servers[0].discoveryPort }).start())
        const manager = new NetworkManager()
        const results = await manager.discoverPlcs('127.0.0.1', servers[0].discoveryPort, 150)
        assert.deepEqual(new Set(results.map(result => result.uid)), new Set(instances.map(instance => instance.state.uid)))
        assert.deepEqual(new Set(results.map(result => result.host)), new Set(['127.0.0.1', '127.0.0.2']))
        for (const result of results) assert.equal((await manager.probeHost(result.host, result.port, 500)).info, result.info)
    } finally {
        for (const server of servers) await server.close()
        for (const instance of instances) instance.close()
        fs.rmSync(directory, { recursive: true, force: true })
    }
})

test('editor network driver programs and monitors a real VirtualPLC', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vovk-editor-network-'))
    let instance
    let server
    let connection
    try {
        instance = await new VirtualPLC(directory).initialize()
        server = await new VirtualPLCServer(instance, { host: '127.0.0.1', port: 0, discoveryPort: 0 }).start()
        const manager = new NetworkManager()
        const handlers = new Map()
        const socket = {
            connected: true,
            once(event, callback) { if (event === 'connect') queueMicrotask(callback) },
            on(event, callback) { handlers.set(event, callback) },
            emit(event, data, callback) {
                const action = async () => {
                    if (event === 'connect-device') {
                        const key = await manager.connect(data, { onData: (key, bytes) => handlers.get('data')({ key, data: bytes }) })
                        return { ok: true, key }
                    }
                    if (event === 'write') await manager.write(data.key, data.data)
                    if (event === 'disconnect-device') await manager.disconnect(data.key)
                    return { ok: true }
                }
                action().then(callback, error => callback({ ok: false, error: error.message }))
            },
            disconnect() { this.connected = false }
        }
        const moduleFrom = async relative => new SourceTextModule(await readFile(new URL(relative, import.meta.url), 'utf8'))
        const wasm = await moduleFrom('../src/wasm/VovkPLC.js')
        await wasm.link(() => { throw new Error('Unexpected import') })
        await wasm.evaluate()
        const base = await moduleFrom('../src/connection/ConnectionBase.js')
        await base.link(() => { throw new Error('Unexpected import') })
        await base.evaluate()
        const serial = await moduleFrom('../src/connection/drivers/SocketSerialConnection.js')
        await serial.link(specifier => {
            const exports = specifier.includes('ConnectionBase') ? { default: base.namespace.default } : specifier.includes('wasm') ? { default: wasm.namespace.default } : { default: class {} }
            return new SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value) })
        })
        await serial.evaluate()
        const network = await moduleFrom('../src/connection/drivers/SocketNetworkConnection.js')
        await network.link(specifier => {
            const exports = specifier.includes('socketSerial.js') ? { io: () => socket } : { default: serial.namespace.default }
            return new SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value) })
        })
        await network.evaluate()
        connection = new network.namespace.default()
        await connection.connect({ host: '127.0.0.1', port: server.port, serverUrl: 'http://localhost' })
        assert.equal((await connection.getInfo()).device, 'VirtualPLC')
        await connection.configureTCOffsets(500, 700)
        const program = instance.plc.compilePLCASM('ptr.const 192\nu8.const 42\nu8.move\nexit').output
        await connection.downloadProgram(program)
        await new Promise(resolve => setTimeout(resolve, 20))
        assert.equal((await connection.readMemory(192, 1))[0], 42)
        await assert.rejects(connection.writeMemory(0, [1]), /Memory write failed/)
        await assert.rejects(connection.readMemory(65536, 1), /Memory read failed/)
        assert.equal(Buffer.from(await connection.uploadProgram()).toString('hex').toUpperCase(), program)
        assert.equal((await connection.getDataBlockInfo()).slots, instance.plc.dbGetSlotCount())
        await connection.stop()
        assert.equal(instance.state.config.running, false)
        await connection.run()
        assert.equal(instance.state.config.running, true)
        const largeProgram = 'FF'.repeat(64535)
        await connection.downloadProgram(largeProgram)
        assert.equal(Buffer.from(await connection.uploadProgram()).toString('hex').toUpperCase(), largeProgram)
    } finally {
        await connection?.disconnect()
        await server?.close()
        instance?.close()
        fs.rmSync(directory, { recursive: true, force: true })
    }
})

test('broadcast discovery accepts only matching PLC replies and deduplicates them', async () => {
    const server = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    await new Promise(resolve => server.bind(0, '0.0.0.0', resolve))
    server.on('message', (data, remote) => {
        const request = JSON.parse(data.toString())
        const response = { ...request, magic: 'VOVKPLC_DEVICE', uid: 'plc-1', port: 2000, info }
        const send = value => server.send(Buffer.from(JSON.stringify(value)), remote.port, remote.address)
        send({ ...response, nonce: 'wrong' })
        send(response)
        send(response)
    })
    try {
        const results = await new NetworkManager().discoverPlcs('127.0.0.1', server.address().port, 150)
        assert.deepEqual(results, [{ host: '127.0.0.1', port: 2000, uid: 'plc-1', info }])
    } finally {
        server.close()
    }
})

test('network probe and scan require a complete PLC information response', async () => {
    const requests = []
    const sourceAddresses = []
    const server = net.createServer(socket => socket.once('data', data => {
        requests.push(data.toString())
        sourceAddresses.push(socket.remoteAddress)
        socket.write(info.slice(0, 20))
        socket.end(info.slice(20) + '\n')
    }))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
        const port = server.address().port
        const manager = new NetworkManager()
        assert.equal((await manager.probeHost('127.0.0.1', port, 500)).info, info)
        assert.equal((await manager.scanNetwork('127.0.0.1', port, 1, 1, 500))[0].reachable, true)
        assert.equal((await manager.probeHost('127.0.0.1', port, 500, '127.0.0.2')).reachable, true)
        assert.equal(sourceAddresses[2], '127.0.0.2')
        assert.deepEqual(requests, Array(3).fill(`${buildProgramInfoCommand()}\n`))
        assert.throws(() => manager.probeHost('not-an-ip', port), /IPv4/)
        await assert.rejects(manager.scanNetwork('127.0.0.1', port, 0, 255), /range/)
    } finally {
        await new Promise(resolve => server.close(resolve))
    }
})

test('network probe rejects unrelated TCP services', async () => {
    const server = net.createServer(socket => socket.once('data', () => socket.end('HTTP/1.1 400 Bad Request\n')))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
        assert.equal((await new NetworkManager().probeHost('127.0.0.1', server.address().port, 500)).reachable, false)
    } finally {
        await new Promise(resolve => server.close(resolve))
    }
})

test('network connections are exclusive and can reconnect after disconnect', async () => {
    const server = net.createServer()
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const manager = new NetworkManager()
    const target = { host: '127.0.0.1', port: server.address().port }
    try {
        const first = manager.connect(target)
        await assert.rejects(manager.connect(target), /Already connected/)
        const key = await first
        await manager.disconnect(key)
        assert.equal(await manager.connect(target), key)
        assert.equal(manager.isConnected(key), true)
        await manager.disconnect(key)
    } finally {
        await new Promise(resolve => server.close(resolve))
    }
})

test('network driver handles fragmented replies, disconnects, and timeouts', async () => {
    const handlers = new Map()
    let responseEnabled = true
    const socket = {
        connected: true,
        once(event, callback) { if (event === 'connect') queueMicrotask(callback) },
        on(event, callback) { handlers.set(event, callback) },
        emit(event, data, callback) {
            if (event === 'connect-device') return callback({ ok: true, key: '127.0.0.1:2000' })
            if (event === 'write') {
                if (responseEnabled) {
                    handlers.get('data')({ key: '127.0.0.1:2000', data: [...Buffer.from('OK ')] })
                    handlers.get('data')({ key: '127.0.0.1:2000', data: [...Buffer.from('value\n')] })
                }
                return callback({ ok: true })
            }
            callback({ ok: true })
        },
        disconnect() { this.connected = false }
    }
    const source = await readFile(new URL('../src/connection/drivers/SocketNetworkConnection.js', import.meta.url), 'utf8')
    const module = new SourceTextModule(source)
    await module.link(specifier => {
        const exports = specifier.includes('socketSerial.js') ? { io: () => socket } : {
            default: class { constructor() { this.onDisconnected = null } _clearCommandQueue() {} }
        }
        return new SyntheticModule(Object.keys(exports), function () {
            for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
        })
    })
    await module.evaluate()
    const connection = new module.namespace.default()
    await connection.connect({ host: '127.0.0.1', port: 2000, serverUrl: 'http://localhost' })
    assert.equal(connection.supportsSubscriptions, false)
    assert.equal(await connection.serial.command('PI\n', 100), 'OK value\n')
    responseEnabled = false
    await assert.rejects(connection.serial.command('PI\n', 30), /timed out/)
    assert.equal(connection.serial.isOpen, false)
    await connection.disconnect?.()
    await connection.serial.end()
    assert.equal(socket.connected, false)
})