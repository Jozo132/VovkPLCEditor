import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { SourceTextModule, SyntheticModule } from 'node:vm'

const drivers = ['SerialConnection', 'SocketSerialConnection']
const info = '[VovkPLCRuntime,ESP32,0,1,0,1,date,64,1024,32768,0,1,2,3,device]'

for (const name of drivers) {
    test(`${name} handles unexpected and valid info responses`, async () => {
        const source = await readFile(new URL(`../src/connection/drivers/${name}.js`, import.meta.url), 'utf8')
        const module = new SourceTextModule(source)
        await module.link(() => new SyntheticModule(['default'], function () {
            this.setExport('default', class {})
        }))
        await module.evaluate()

        const connection = Object.create(module.namespace.default.prototype)
        connection.plc = { stringToHex: () => '', parseHex: () => [], crc8: () => 0 }
        connection._enqueueCommand = async handler => handler()
        connection._waitForReply = async () => true
        let response = `[TI,0] unexpected ${info} trailing output\n`
        connection.serial = {
            isOpen: true,
            write: async () => {},
            readAll: () => response,
            command: async () => response,
        }

        assert.equal((await connection.getInfo()).arch, 'ESP32')
        response = `PLC INFO - ${info}\n`
        assert.equal((await connection.getInfo()).arch, 'ESP32')
        response = '[TI,0]\n'
        connection._waitForReply = async () => { await new Promise(resolve => setTimeout(resolve, 10)); return true }
        if (name === 'SerialConnection') connection.serial.isOpen = false
        await assert.rejects(connection.getInfo(), /Connection closed|Invalid info response/)
    })

    test(`${name} requires acknowledgements for configuration and download`, async () => {
        const source = await readFile(new URL(`../src/connection/drivers/${name}.js`, import.meta.url), 'utf8')
        const module = new SourceTextModule(source)
        await module.link(() => new SyntheticModule(['default'], function () {
            this.setExport('default', class {})
        }))
        await module.evaluate()
        const connection = Object.create(module.namespace.default.prototype)
        connection.plc = { buildCommand: { tcConfig: () => 'TC', programDownload: () => 'PD' } }
        connection._enqueueCommand = async handler => handler()
        connection.writeChunked = async () => {}
        let response = 'OK TC CONFIG T=640 C=784'
        connection._readResponseLine = async () => response
        connection.serial = { write: async () => {}, command: async () => response, available: () => 0 }
        await connection.configureTCOffsets(640, 784)
        response = 'Invalid checksum'
        await assert.rejects(connection.configureTCOffsets(640, 784), /configuration failed/)
        response = 'PROGRAM DOWNLOAD COMPLETE'
        await connection.downloadProgram('FF')
        response = 'FLASH SAVE FAILED'
        await assert.rejects(connection.downloadProgram('FF'), /download failed/)
    })
}