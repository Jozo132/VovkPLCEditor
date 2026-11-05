import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { ensureOffsets, deviceLayoutMismatch } from '../src/utils/offsets.js'
import DataFetcher from '../src/editor/DataFetcher.js'

const source = await readFile(new URL('../src/editor/ProjectManager.js', import.meta.url), 'utf8')
const module = new SourceTextModule(source)
await module.link(specifier => {
    const exports = specifier.includes('offsets.js') ? { ensureOffsets } :
        specifier.includes('types.js') ? { PLC_Program: class {}, PLC_Project: class {}, PLC_Symbol: class {}, PLCEditor: class {} } :
        specifier.includes('ladder/language.js') ? { PLC_Ladder: class {}, toGraph: () => ({}), smartStringify: JSON.stringify } :
        specifier.includes('stl/language.js') ? { PLC_STL: class {} } : { PLC_Assembly: class {} }
    return new SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    })
})
await module.evaluate()

const offsets = () => ({
    system: { offset: 0, size: 256 }, input: { offset: 256, size: 64 },
    output: { offset: 320, size: 64 }, marker: { offset: 384, size: 256 },
    timer: { offset: 640, size: 144 }, counter: { offset: 784, size: 80 }
})

test('compile synchronizes compiler offsets before compiling and updates timer areas', async () => {
    const calls = []
    const runtime = {
        setRuntimeOffsets: async (...values) => calls.push(['offsets', ...values]),
        setSilent: async () => {},
        compileProject: async () => {
            calls.push(['compile'])
            return { output: { memory_map: { S: [0, 256], X: [256, 64], Y: [320, 64], M: [384, 256], T: [640, 9], C: [649, 5] }, flash: { used: 1 } }, bytecode: 'FF' }
        }
    }
    const editor = { runtime, project: { offsets: offsets() } }
    const manager = new module.namespace.default(editor)
    manager.checkAndSave = () => {}
    manager.buildProjectText = () => 'project'
    const result = await manager.compile()
    assert.deepEqual(calls, [['offsets', 0, 256, 320, 384], ['compile']])
    assert.equal(result.output, 'FF')
    assert.deepEqual(editor.project.offsets.timer, { offset: 640, size: 9 })
    assert.deepEqual(editor.project.offsets.counter, { offset: 649, size: 5 })
})

test('compile rejects a conflicting compiler layout', async () => {
    const runtime = {
        setRuntimeOffsets: async () => {}, setSilent: async () => {},
        compileProject: async () => ({ output: { memory_map: { S: [0, 64] } }, bytecode: 'FF' })
    }
    const manager = new module.namespace.default({ runtime, project: { offsets: offsets() } })
    manager.checkAndSave = () => {}
    manager.buildProjectText = () => 'project'
    await assert.rejects(manager.compile(), /S memory layout does not match/)
})

test('device layout check rejects mismatched or unavailable fixed areas', () => {
    const projectOffsets = offsets()
    const device = Object.fromEntries(['system', 'input', 'output', 'marker'].flatMap(key => [
        [`${key}_offset`, projectOffsets[key].offset], [`${key}_size`, projectOffsets[key].size]
    ]))
    assert.equal(deviceLayoutMismatch(projectOffsets, device), null)
    assert.match(deviceLayoutMismatch(projectOffsets, { ...device, marker_offset: 192 }), /marker/)
    assert.match(deviceLayoutMismatch(projectOffsets, { ...device, output_size: undefined }), /unavailable/)
})

test('monitoring resolves direct and named addresses against current offsets', () => {
    const project = { offsets: offsets(), symbols: [
        { name: 'flag', location: 'memory', address: '0.1', type: 'bit' },
        { name: 'timer', location: 'timer', address: '2', type: 'byte' },
        { name: 'counter', location: 'counter', address: '3.2', type: 'bit' }
    ] }
    const fetcher = new DataFetcher({ project })
    assert.deepEqual(fetcher.resolve('M0.1'), { address: 384, size: 1, bit: 1, type: 'bit' })
    assert.deepEqual(fetcher.resolve('Q0.0'), { address: 320, size: 1, bit: 0, type: 'bit' })
    assert.deepEqual(fetcher.resolve('I0.0'), { address: 256, size: 1, bit: 0, type: 'bit' })
    assert.deepEqual(fetcher.resolve('T2.1'), { address: 658, size: 1, bit: 1, type: 'bit' })
    assert.deepEqual(fetcher.resolve('flag'), { address: 384, size: 1, bit: 1, type: 'bit' })
    assert.deepEqual(fetcher.resolve('timer'), { address: 658, size: 1, bit: null, type: 'byte' })
    assert.deepEqual(fetcher.resolve('counter'), { address: 799, size: 1, bit: 2, type: 'bit' })
    project.offsets.marker.offset = 400
    assert.equal(fetcher.resolve('flag').address, 400)
})

test('simulation applies all compiled offsets before loading bytecode', async () => {
    const source = await readFile(new URL('../src/connection/drivers/SimulationConnection.js', import.meta.url), 'utf8')
    const simulationModule = new SourceTextModule(source)
    await simulationModule.link(specifier => {
        const exports = specifier.includes('offsets.js') ? { ensureOffsets } :
            specifier.includes('types.js') ? { PLCEditor: class {} } : { default: class {} }
        return new SyntheticModule(Object.keys(exports), function () {
            for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
        })
    })
    await simulationModule.evaluate()
    const calls = []
    const runtime = {
        wasm_exports: { setRuntimeOffsetsEx: (...values) => calls.push(['offsets', ...values]) },
        downloadBytecodeHex: bytecode => calls.push(['download', bytecode])
    }
    const connection = new simulationModule.namespace.default({ runtime, project: { offsets: offsets() } })
    await connection.downloadProgram('FF')
    assert.deepEqual(calls, [['offsets', 0, 256, 320, 384, 640, 784], ['download', 'FF']])
    delete runtime.wasm_exports.setRuntimeOffsetsEx
    await assert.rejects(connection.downloadProgram('FF'), /configuration is unavailable/)
    assert.equal(calls.length, 2)
})

test('download refreshes and validates device configuration before writing', async () => {
    const source = await readFile(new URL('../src/editor/UI/WindowManager.js', import.meta.url), 'utf8')
    const start = source.indexOf('    async handleDownload() {')
    const end = source.indexOf('\n    /**', start)
    assert.ok(start >= 0 && end > start)
    const method = source.slice(start, end)
    const Harness = new Function('deviceLayoutMismatch', 'Popup', `return class {
        #editor
        constructor(editor) { this.#editor = editor; this.messages = [] }
        async handleCompile() { return true }
        logToConsole(message) { this.messages.push(message) }
        setConsoleTab() {}
        showLoading() {}
        hideLoading() {}
        ${method}
    }`)(deviceLayoutMismatch, { confirm: async () => true })

    const projectOffsets = offsets()
    const info = Object.fromEntries(['system', 'input', 'output', 'marker'].flatMap(key => [
        [`${key}_offset`, projectOffsets[key].offset], [`${key}_size`, projectOffsets[key].size]
    ]))
    const calls = []
    let response = info
    let failConfiguration = false
    const connection = {
        getInfo: async () => { calls.push('info'); return response },
        configureTCOffsets: async (timer, counter) => {
            calls.push(['configure', timer, counter])
            if (failConfiguration) throw new Error('bad acknowledgement')
        },
        downloadProgram: async bytecode => calls.push(['download', bytecode])
    }
    const editor = {
        project: { offsets: projectOffsets, compiledBytecode: 'FF', compiledSize: 1 },
        device_manager: { connected: true, options: { target: 'serial' }, connection }
    }
    const manager = new Harness(editor)
    await manager.handleDownload()
    assert.deepEqual(calls, ['info', ['configure', 640, 784], ['download', 'FF'], 'info'])
    calls.length = 0
    response = { ...info, marker_offset: 192 }
    await manager.handleDownload()
    assert.deepEqual(calls, ['info'])
    assert.match(manager.messages.at(-1), /Upload aborted: marker/)
    calls.length = 0
    response = info
    failConfiguration = true
    await manager.handleDownload()
    assert.deepEqual(calls, ['info', ['configure', 640, 784]])
    assert.ok(manager.messages.some(message => message.includes('Upload failed: bad acknowledgement')))
    for (const target of ['socket-serial', 'ethernet']) {
        editor.device_manager.options.target = target
        calls.length = 0
        failConfiguration = false
        response = { ...info, marker_offset: 192 }
        await manager.handleDownload()
        assert.deepEqual(calls, ['info'])
        response = info
        calls.length = 0
        await manager.handleDownload()
        assert.deepEqual(calls, ['info', ['configure', 640, 784], ['download', 'FF'], 'info'])
    }
})

test('ladder monitoring collects current direct and timer addresses', async () => {
    const source = await readFile(new URL('../src/languages/ladder/renderer.js', import.meta.url), 'utf8')
    const parserStart = source.indexOf('const parseAddressToSymbol = ')
    const parserEnd = source.indexOf('\n\n/**', parserStart)
    const collectorStart = source.indexOf('  const collectSymbolAddresses = ')
    const collectorEnd = source.indexOf('\n\n  /**', collectorStart)
    assert.ok(parserStart >= 0 && parserEnd > parserStart && collectorStart >= 0 && collectorEnd > collectorStart)
    const collect = new Function('editor', 'ladder', 'ensureOffsets', 'system_symbols', 'isFunctionBlock', `
        ${source.slice(parserStart, parserEnd)}
        ${source.slice(collectorStart, collectorEnd)}
        return collectSymbolAddresses()
    `)
    const editor = { project: { offsets: offsets(), symbols: [] } }
    const ladder = { blocks: ['I0.0', 'Q0.0', 'M0.1', 'T2', 'C3'].map(symbol => ({ symbol })) }
    assert.deepEqual([...collect(editor, ladder, ensureOffsets, [], () => false).keys()], [256, 320, 384, 658, 799])
    editor.project.offsets.marker.offset = 400
    assert.ok(collect(editor, ladder, ensureOffsets, [], () => false).has(400))
})