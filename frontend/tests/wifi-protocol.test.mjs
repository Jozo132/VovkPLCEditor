import assert from 'node:assert/strict'
import test from 'node:test'
import ConnectionBase from '../src/connection/ConnectionBase.js'
import VovkPLC from '../src/wasm/VovkPLC.js'

const makeConnection = (replies) => {
    const connection = new ConnectionBase()
    const requests = []
    connection.plc = new VovkPLC()
    connection._enqueueCommand = async (handler) => handler()
    connection.serial = { command: async (request) => { requests.push(request); return replies.shift() } }
    return { connection, requests }
}

test('WiFi status exposes network names but no passwords', async () => {
    const { connection, requests } = makeConnection(['WG:1:192.168.1.2:436166C3A9,1:,0:,0'])
    const status = await connection.getWiFiStatus()
    assert.deepEqual(status, { connectedSlot: 1, ip: '192.168.1.2', networks: [
        { ssid: 'Caf\u00e9', hasPassword: true }, { ssid: '', hasPassword: false }, { ssid: '', hasPassword: false }
    ] })
    assert.equal(requests[0], `WG${connection.plc.crc8([87, 71]).toString(16).padStart(2, '0').toUpperCase()}\n`)
})

test('WiFi configuration uses checksummed UTF-8 bytes and preserves passwords', async () => {
    const { connection, requests } = makeConnection(['OK WIFI', 'OK WIFI'])
    await connection.configureWiFi(0, 'AP', 'secret', true)
    const bytes = [87, 67, 0, 2, 6, 1, 65, 80, ...new TextEncoder().encode('secret')]
    const hex = bytes.slice(2).map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
    assert.equal(requests[0], `WC${hex}${connection.plc.crc8(bytes).toString(16).padStart(2, '0').toUpperCase()}\n`)
    await connection.configureWiFi(0, 'AP', 'ignored', false)
    assert.match(requests[1], /^WC000200004150/)
    await assert.rejects(connection.configureWiFi(0, 'x'.repeat(33), '', true))
})

test('WiFi scan parses device results and handles failure', async () => {
    const { connection } = makeConnection(['OK WIFI SCAN', 'WR:2:4150,-42,1:,-70,0', 'OK WIFI SCAN', 'WR:-2'])
    assert.deepEqual(await connection.scanWiFi(), [
        { ssid: 'AP', rssi: -42, secured: true }, { ssid: '', rssi: -70, secured: false }
    ])
    await assert.rejects(connection.scanWiFi(), /scan failed/)
})

test('WiFi priority and forget commands use checksummed slot indices', async () => {
    const { connection, requests } = makeConnection(['OK WIFI', 'OK WIFI', 'ERR WIFI CONFIG'])
    await connection.moveWiFi(2, 0)
    await connection.forgetWiFi(1)
    const hex = (bytes) => bytes.map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
    assert.equal(requests[0], `WM0200${hex([connection.plc.crc8([87, 77, 2, 0])])}\n`)
    assert.equal(requests[1], `WF01${hex([connection.plc.crc8([87, 70, 1])])}\n`)
    await assert.rejects(connection.moveWiFi(0, 3), /Invalid WiFi priority/)
    await assert.rejects(connection.forgetWiFi(-1), /Invalid WiFi priority/)
    await assert.rejects(connection.forgetWiFi(0), /ERR WIFI CONFIG/)
})