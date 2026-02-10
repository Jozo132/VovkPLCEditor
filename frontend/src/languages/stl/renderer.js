import {CanvasCodeEditor} from '../CanvasCodeEditor.js'
import {RendererModule} from '../types.js'
import {Popup} from '../../editor/UI/Elements/components/popup.js'

// De-duplicating logger to avoid spam
const createDedupLogger = () => {
    const recentLogs = new Map()
    const DEDUPE_WINDOW = 1000

    return (prefix, data) => {
        const key = prefix + JSON.stringify(data)
        const now = Date.now()
        const recent = recentLogs.get(key)

        if (recent && now - recent.lastTime < DEDUPE_WINDOW) {
            recent.count++
            return
        }

        if (recent && recent.count > 1) {
            console.log(`${prefix} (repeated ${recent.count} times)`)
        }

        console.log(prefix, data)
        recentLogs.set(key, {count: 1, lastTime: now})

        if (recentLogs.size > 100) {
            const cutoff = now - DEDUPE_WINDOW * 2
            for (const [k, v] of recentLogs.entries()) {
                if (v.lastTime < cutoff) recentLogs.delete(k)
            }
        }
    }
}
const dlog = createDedupLogger()

// STL address regex: I0.0, Q0.0, M0.0, T0, C0, etc. and PLCASM style X0.0, Y0.0
const ADDRESS_REGEX = /^(?:([IQMTCSXY])(\d+)(?:\.(\d+))?|(\d+)\.(\d+))$/i
const ADDRESS_LOCATION_MAP = {
    I: 'input',
    Q: 'output',
    M: 'marker',
    T: 'timer',
    C: 'counter',
    S: 'system',
    X: 'input',
    Y: 'output',
}
const LOCATION_COLORS = {
    input: '#89d185',
    output: '#d68d5e',
    marker: '#c586c0',
    memory: '#c586c0',
    counter: '#dcdcaa',
    timer: '#ce9178',
    system: '#4fc1ff',
}
const TYPE_COLORS = {
    bit: '#569cd6',
    byte: '#4ec9b0',
    int: '#b5cea8',
    dint: '#dcdcaa',
    real: '#ce9178',
}

// STL Keywords for syntax highlighting
const STL_KEYWORDS = {
    // Bit Logic
    bitLogic: ['A', 'AN', 'O', 'ON', 'X', 'XN', 'NOT', 'SET', 'CLR', 'CLEAR'],
    // Assign/Set/Reset
    assign: ['S', 'R'],
    // Edge Detection
    edge: ['FP', 'FN'],
    // Timers
    timer: ['TON', 'TOF', 'TP'],
    // Counters
    counter: ['CTU', 'CTD', 'CTUD'],
    // Load/Transfer
    loadTransfer: ['L', 'T', 'LD', 'LDN', 'ST'],
    // Math
    math: ['+I', '-I', '*I', '/I', 'MOD', 'NEG', 'ABS', 'INC', 'DEC'],
    // Compare
    compare: ['==I', '<>I', '>I', '>=I', '<I', '<=I'],
    // Jumps
    jump: ['JU', 'JC', 'JCN', 'JMP', 'JMPC', 'JMPCN'],
    // Call/Return
    callReturn: ['CALL', 'BE', 'BEC', 'BEU', 'RET'],
    // IEC IL aliases
    iecAliases: ['AND', 'ANDN', 'OR', 'ORN', 'XOR', 'XORN'],
    // Network/NOP
    other: ['NETWORK', 'NOP'],
}

// Build a flat set for quick lookup
const ALL_STL_KEYWORDS = new Set([
    ...STL_KEYWORDS.bitLogic,
    ...STL_KEYWORDS.assign,
    ...STL_KEYWORDS.edge,
    ...STL_KEYWORDS.timer,
    ...STL_KEYWORDS.counter,
    ...STL_KEYWORDS.loadTransfer,
    ...STL_KEYWORDS.math,
    ...STL_KEYWORDS.compare,
    ...STL_KEYWORDS.jump,
    ...STL_KEYWORDS.callReturn,
    ...STL_KEYWORDS.iecAliases,
    ...STL_KEYWORDS.other,
])

/** @type { RendererModule } */
export const stlRenderer = {
    id: 'stl',

    render(editor, block, ctx) {
        if (block.type !== 'stl') return
        
        // Ensure props exists
        if (!block.props) block.props = {}
        const {div, id, type, name, props} = block

        if (!div) throw new Error('Block div not found')
        const block_container = div.querySelector('.plc-program-block-code')
        if (!block_container) throw new Error('Block code not found')

        // If loaded from JSON, props.text_editor might be a plain object
        if (props.text_editor && !(props.text_editor instanceof CanvasCodeEditor)) {
            if (props.text_editor.dispose) props.text_editor.dispose()
            props.text_editor = null
        }

        if (!props.text_editor) {
            const resolveEntryInfo = entry => {
                let fullType = entry.type || 'byte'
                let addressStr = ''

                const lookupName = entry.originalName || entry.name

                if (lookupName && editor.project && editor.project.symbols) {
                    const symbol = editor.project.symbols.find(s => s.name === lookupName)
                    if (symbol) {
                        fullType = symbol.type
                        const addr = symbol.address
                        const loc = symbol.location || 'marker'
                        // Map location to prefix - support both Siemens and PLCASM style
                        const prefixMap = {input: 'I', output: 'Q', marker: 'M', system: 'S', counter: 'C', timer: 'T'}
                        const prefix = prefixMap[loc] || 'M'
                        if (fullType === 'bit') {
                            const byte = Math.floor(addr)
                            const bit = Math.round((addr - byte) * 10)
                            addressStr = `${prefix}${byte}.${bit}`
                        } else {
                            addressStr = `${prefix}${addr}`
                        }
                    } else {
                        addressStr = lookupName
                    }
                } else {
                    addressStr = lookupName || entry.name
                }
                return {addressStr, fullType}
            }

            // Update block size based on line count
            const updateBlockSize = () => {
                const lineCount = (block.code || '').split('\n').length
                const lineHeight = 19
                const padding = 16
                const minHeight = 200
                const maxHeight = 600
                const calculatedHeight = Math.min(maxHeight, Math.max(minHeight, lineCount * lineHeight + padding))
                block_container.style.height = calculatedHeight + 'px'
            }

            const handlePreviewAction = async (entry, actionName) => {
                // ============================================================
                // LIVE PATCHING: Timer presets and embedded constants
                // ============================================================
                if (entry?.isTimerPT && entry?.bytecode_offset !== undefined && typeof entry.presetValue === 'number') {
                    if (actionName !== 'edit') return

                    if (!editor.device_manager?.connected) {
                        new Popup({
                            title: 'Connection Required',
                            description: 'Device must be connected to edit timer presets',
                            buttons: [{text: 'OK', value: 'ok', background: '#dc3545', color: 'white'}],
                        })
                        return
                    }

                    try {
                        const patcher = editor.program_patcher
                        if (!patcher) {
                            new Popup({
                                title: 'Error',
                                description: 'Live patcher not available',
                                buttons: [{text: 'OK', value: 'ok', background: '#dc3545', color: 'white'}],
                            })
                            return
                        }

                        // Detect if using IEC time format (T#...) or raw format (#...)
                        const isIecFormat = entry.originalName && entry.originalName.toUpperCase().startsWith('T#')
                        let currentInput = isIecFormat ? entry.originalName : entry.presetValue

                        await Popup.form({
                            title: isIecFormat ? `Edit ${entry.originalName}` : `Edit #${entry.presetValue}`,
                            description: isIecFormat ? 'Enter new timer preset (e.g. T#5s, T#500ms)' : `Enter new timer preset (milliseconds)`,
                            inputs: [{
                                    type: isIecFormat ? 'text' : 'number',
                                    name: 'value',
                                    label: isIecFormat ? 'Preset' : 'Preset (ms)',
                                    value: currentInput,
                                },
                                {
                                    type: 'text',
                                    name: 'error',
                                    label: ' ',
                                    readonly: true,
                                    value: '',
                                    margin: '0',
                                }
                            ],
                            buttons: [{text: 'Write', value: 'confirm'}, {text: 'Cancel', value: 'cancel'}],
                            verify: async (states) => {
                                states.error.value = ''
                                states.value.clearError()

                                let newValue = 0
                                let newToken = ''
                                const inputValue = states.value.value

                                try {
                                    const strVal = String(inputValue).trim()
                                    if (!strVal) throw new Error("Value cannot be empty")

                                    if (isIecFormat) {
                                        if (strVal.toUpperCase().startsWith('T#')) {
                                            if (!/^T#(\d+(?:ms|s|m|h|d))+$/i.test(strVal)) throw new Error("Invalid format.")
                                            const content = strVal.substring(2)
                                            const partRegex = /(\d+)(ms|s|m|h|d)/gi
                                            let totalMs = 0
                                            let pMatch
                                            while ((pMatch = partRegex.exec(content))) {
                                                const val = parseInt(pMatch[1], 10)
                                                const unit = pMatch[2].toLowerCase()
                                                if (unit === 's') totalMs += val * 1000
                                                else if (unit === 'm') totalMs += val * 60000
                                                else if (unit === 'h') totalMs += val * 3600000
                                                else if (unit === 'd') totalMs += val * 86400000
                                                else totalMs += val
                                            }
                                            newValue = totalMs
                                            newToken = strVal
                                        } else {
                                            const simple = parseInt(strVal, 10)
                                            if (isNaN(simple)) throw new Error("Invalid format")
                                            newValue = simple
                                            newToken = `#${newValue}`
                                        }
                                    } else {
                                        newValue = parseInt(strVal, 10)
                                        newToken = `#${newValue}`
                                    }

                                    if (isNaN(newValue) || newValue < 0 || newValue > 4294967295) throw new Error("Value out of valid range")

                                    const patchResult = await patcher.patchConstant(entry.bytecode_offset, newValue)

                                    if (patchResult.success) {
                                        // Update source code localized
                                        if (entry.start !== undefined && entry.end !== undefined) {
                                            block.code = block.code.substring(0, entry.start) + newToken + block.code.substring(entry.end)
                                        }
                                        
                                        // Force UI refresh
                                        const textEditor = block.props?.text_editor
                                        if (textEditor?.setValue) {
                                            block.cached_checksum = null // Invalidate cache
                                            block.cached_timer_refs = null
                                            textEditor.setValue(block.code)
                                        }
                                        
                                        if (editor.project_manager?.checkAndSave) editor.project_manager.checkAndSave()
                                        
                                        // Trigger recompile to update maps
                                        setTimeout(async () => {
                                            if (editor.window_manager?.handleCompile) await editor.window_manager.handleCompile({silent: true})
                                        }, 100)
                                        return true
                                    } else {
                                        throw new Error(`Write Failed: ${patchResult.message}`)
                                    }
                                } catch (e) {
                                    states.error.value = e.message
                                    states.value.setError()
                                    return false
                                }
                            }
                        })
                    } catch (err) {
                        new Popup({title: 'Error', description: err.message, buttons: [{text: 'OK', value: 'ok'}]})
                    }
                    return
                }

                // ============================================================
                // MEMORY WRITES: Runtime variables (I/O, markers, timers)
                // ============================================================
                if (!editor.window_manager?.isMonitoringActive?.()) return
                const connection = editor.device_manager?.connection
                if (!connection) return

                const {addressStr, fullType} = resolveEntryInfo(entry) // Uses local helper
                const addrMatch = ADDRESS_REGEX.exec(addressStr)
                if (!addrMatch) return

                let prefix = '', byteStr = '', bitStr = ''
                if (addrMatch[1]) {
                    prefix = addrMatch[1].toUpperCase()
                    byteStr = addrMatch[2]
                    bitStr = addrMatch[3] // Group 3 is bit
                } else {
                    byteStr = addrMatch[4]
                    bitStr = addrMatch[5] // Group 5 is bit
                }
                
                // Important: handle bitStr correctly. null if undefined.
                const bitIndex = bitStr ? Number.parseInt(bitStr, 10) : null
                const byteOffset = Number.parseInt(byteStr, 10)
                
                const prefixLocationMap = {C: 'counter', T: 'timer', X: 'input', Y: 'output', M: 'marker', S: 'system', I: 'input', Q: 'output'}
                const location = prefixLocationMap[prefix] || 'marker'
                
                const offsets = editor.project.offsets || {}
                const region = offsets[location] || {offset: 0}
                const structSize = (prefix === 'T') ? 9 : (prefix === 'C') ? 5 : 1
                const absAddress = region.offset + (byteOffset * structSize)

                // For bits in STL, we need to be careful. 'bitIndex' comes from address (M0.1).
                // Or if fullType is bit but no dot in address (e.g. named bool symbol), we might need symbol address info.
                // The resolveEntryInfo handles symbol.address -> byte.bit string. So addrMatch should have it.
                
                const isBit = bitIndex !== null || fullType === 'bit'

                try {
                    if (isBit && bitIndex !== null) {
                        const mask = 1 << bitIndex
                        let val = 0
                        if (actionName === 'set') val = mask
                        else if (actionName === 'reset') val = 0
                        else if (actionName === 'toggle') {
                            const live = editor.live_symbol_values?.get(entry.name) || editor.live_symbol_values?.get(addressStr)
                            // entry.name might be M0.1, or MySymbol. addressStr is M0.1
                            let currentOn = false
                            if (live) {
                                currentOn = (live.value === true || live.value === 1 || live.text === 'ON' || live.value === mask)
                                // If live.value is the whole byte, check bit
                                if (typeof live.value === 'number' && live.value > 1) {
                                    currentOn = ((live.value & mask) !== 0)
                                }
                            }
                            val = currentOn ? 0 : mask
                        }
                        await connection.writeMemoryAreaMasked(absAddress, [val], [mask])
                    } else if (actionName === 'edit') {
                        let currentVal = 0
                        const liveEntry = editor.live_symbol_values?.get(entry.name) || editor.live_symbol_values?.get(addressStr)
                        if (liveEntry && typeof liveEntry.value !== 'undefined') currentVal = liveEntry.value

                        const formResult = await Popup.form({
                            title: `Edit ${addressStr}`,
                            description: `Enter new value for ${addressStr} (${fullType})`,
                            inputs: [{type: 'text', name: 'value', label: 'Value', value: String(currentVal)}],
                            buttons: [{text: 'Write', value: 'confirm'}, {text: 'Cancel', value: 'cancel'}],
                        })

                        if (formResult && typeof formResult.value !== 'undefined') {
                            const num = Number(formResult.value)
                            if (!isNaN(num)) {
                                let size = 1
                                if (['u16', 'i16', 'int', 'word'].includes(fullType)) size = 2
                                if (['u32', 'i32', 'dint', 'real', 'float', 'dword'].includes(fullType)) size = 4
                                const data = []
                                let val = BigInt(Math.floor(num))
                                for (let i = 0; i < size; i++) {
                                    data.push(Number(val & 0xffn))
                                    val >>= 8n
                                }
                                await connection.writeMemoryArea(absAddress, data)
                            }
                        }
                    }
                    if (editor.window_manager.updateLiveMonitorState) editor.window_manager.updateLiveMonitorState()
                } catch (e) {
                    console.error('Failed to write memory:', e)
                    new Popup({title: 'Error', description: 'Failed to write: ' + e.message, buttons: [{text: 'OK', value: 'ok'}]})
                }
            }


            const text_editor = new CanvasCodeEditor(block_container, {
                value: block.code,
                language: 'stl',
                font: '14px Consolas, monospace',
                readOnly: !!editor.edit_locked,
                onPreviewAction: (entry, action) => handlePreviewAction(entry, action),
                onPreviewContextMenu: (entry, event) => {
                    if (entry?.isTimerStorage) {
                        return // No menu for timer internal storage
                    }

                    // Handle timer constant presets (T#...)
                    if (entry?.type === 'time_const' || (entry?.isTimerPT && typeof entry.presetValue === 'number')) {
                        if (entry.bytecode_offset === undefined) return // Cannot edit if not linked to bytecode
                        if (!editor.device_manager?.connected) return

                        const items = [{label: 'Edit Preset...', name: 'edit', icon: 'edit', type: 'item'}]
                        const contextMenu = editor.context_manager
                        if (contextMenu && typeof contextMenu.show === 'function') {
                            contextMenu.show(event, items, async actionName => {
                                await handlePreviewAction(entry, actionName)
                            })
                        }
                        return
                    }

                     // Handle TON instruction pill (which represents Timer Output Bit)
                     // or normal memory variables
                    if (!editor.window_manager?.isMonitoringActive?.()) return
                    
                    const {addressStr, fullType} = resolveEntryInfo(entry)
                    const addrMatch = ADDRESS_REGEX.exec(addressStr)
                    if (!addrMatch) return // Should fit regex

                    // Parse bit info
                    let bitIndex = null
                    if (addrMatch[1]) {
                        if (addrMatch[3]) bitIndex = parseInt(addrMatch[3], 10)
                    } else {
                        if (addrMatch[5]) bitIndex = parseInt(addrMatch[5], 10)
                    }
                    const isBit = bitIndex !== null || fullType === 'bit' || entry.isTimerOutput

                    const items = []
                    const connection = editor.device_manager?.connection
                    if (!connection) return

                    if (isBit) {
                        items.push({label: 'Set (1)', name: 'set', icon: 'check', type: 'item'})
                        items.push({label: 'Reset (0)', name: 'reset', icon: 'close', type: 'item'})
                        items.push({label: 'Toggle', name: 'toggle', icon: 'symbol-event', type: 'item'})
                    } else {
                        items.push({label: 'Edit Value...', name: 'edit', icon: 'edit', type: 'item'})
                    }

                    const contextMenu = editor.context_manager
                    if (contextMenu && typeof contextMenu.show === 'function') {
                        contextMenu.show(event, items, async action => {
                            await handlePreviewAction(entry, action)
                        })
                    }
                },
                previewEntriesProvider: (currentCode) => {
                    // Only show pills when monitoring is active AND device is connected
                    const isMonitoring = editor.window_manager?.isMonitoringActive?.()
                    const isConnected = editor.device_manager?.connected
                    if (!isMonitoring || !isConnected) {
                        return []
                    }

                    // Ensure Asm Cache which contains Timer Refs with bytecode offsets
                    if (typeof editor._ensureAsmCache === 'function') {
                         const cache = editor._buildSymbolCache ? editor._buildSymbolCache() : {signature: '', map: null, details: null}
                         editor._ensureAsmCache(block, cache.signature, cache.map, cache.details)
                    }
                    const cachedTimerRefs = block.cached_timer_refs || []
                    
                    // Helper to find cached ref overlapping this range
                    const findCachedRef = (start, end) => {
                         // Simple strict overlap check
                         return cachedTimerRefs.find(r => r.start <= end && r.end >= start)
                    }

                    // Match timer constant presets with patchable constants from LivePatcher
                    if (editor.program_patcher?.patchableConstants && cachedTimerRefs.length > 0) {
                        const patchableMap = new Map()
                        for (const [offset, constant] of editor.program_patcher.patchableConstants) {
                            if (constant.flags & 0x10 && constant.timer_address !== undefined) {
                                patchableMap.set(constant.timer_address, constant)
                            }
                        }
                        for (const timerRef of cachedTimerRefs) {
                            if (timerRef.isTimerPT && !timerRef.isPresetAddress && typeof timerRef.presetValue === 'number') {
                                if (timerRef.storageAddress !== -1) {
                                    const patchable = patchableMap.get(timerRef.storageAddress)
                                    if (patchable && patchable.current_value === timerRef.presetValue) {
                                        timerRef.bytecode_offset = patchable.bytecode_offset
                                        timerRef.patchable_type = patchable.operand_type
                                        timerRef.timer_address = patchable.timer_address
                                    }
                                }
                            }
                        }
                    }

                    const entries = []
                    const codeToScan = currentCode || block.code || ''
                    const lines = codeToScan.split('\n')
                    let currentOffset = 0

                    lines.forEach(line => {
                        // Handle comments: strip everything after //
                        const commentIndex = line.indexOf('//')
                        let contentToScan = line
                        if (commentIndex !== -1) {
                            contentToScan = line.substring(0, commentIndex)
                        }

                        // 1. Special Handling for TON instructions to capture Presets and Bit Status
                        // Pattern: TON <Instance>, <Preset>
                        // Example: TON T0, T#250ms
                        const tonRegex = /^\s*(TON)\s+([A-Za-z0-9_]+)\s*(?:,|\s)\s*([A-Za-z0-9_#]+)/i
                        const tonMatch = tonRegex.exec(contentToScan)
                        
                        let tonTimerName = null
                        let tonPresetValue = null

                        if (tonMatch) {
                            const instr = tonMatch[1] // "TON"
                            const timerName = tonMatch[2]
                            const presetToken = tonMatch[3]
                            const colInstr = line.indexOf(instr)
                            tonTimerName = timerName

                            // Parse Preset if it is a constant
                            if (presetToken.toUpperCase().startsWith('T#')) {
                                try {
                                    const content = presetToken.substring(2)
                                    const partRegex = /(\d+)(ms|s|m|h|d)/gi
                                    let totalMs = 0
                                    let pMatch
                                    while ((pMatch = partRegex.exec(content))) {
                                        const val = parseInt(pMatch[1], 10)
                                        const unit = pMatch[2].toLowerCase()
                                        if (unit === 's') totalMs += val * 1000
                                        else if (unit === 'm') totalMs += val * 60000
                                        else if (unit === 'h') totalMs += val * 3600000
                                        else if (unit === 'd') totalMs += val * 86400000
                                        else totalMs += val
                                    }
                                    if (totalMs > 0) {
                                       tonPresetValue = totalMs
                                    }
                                } catch (e) {}
                            }
                            
                            // Add a pill for the TON instruction itself (Timer Output Bit)
                            if (colInstr !== -1) {
                                entries.push({
                                    start: currentOffset + colInstr,
                                    end: currentOffset + colInstr + instr.length,
                                    name: timerName, // Use timer name to lookup value
                                    originalName: instr,
                                    type: 'bit',
                                    location: 'timer', // It is a timer
                                    isTimerOutput: true, // Mark as output bit
                                    presetValue: tonPresetValue
                                })
                            }
                        }

                        // 2. Generic Token Scan
                        const tokenRegex = /(?:T#[\w\d]+|[%A-Za-z0-9_][A-Za-z0-9_.]*)/g
                        let match
                        
                        while ((match = tokenRegex.exec(contentToScan)) !== null) {
                            const word = match[0]
                            const column = match.index
                            
                            // Check for T# time literal
                            if (word.toUpperCase().startsWith('T#')) {
                                // Already handled in loop logic or standalone
                                // Parse time value for pill
                                let totalMs = 0
                                try {
                                    const content = word.substring(2)
                                    const partRegex = /(\d+)(ms|s|m|h|d)/gi
                                    let pMatch
                                    while ((pMatch = partRegex.exec(content))) {
                                        const val = parseInt(pMatch[1], 10)
                                        const unit = pMatch[2].toLowerCase()
                                        if (unit === 's') totalMs += val * 1000
                                        else if (unit === 'm') totalMs += val * 60000
                                        else if (unit === 'h') totalMs += val * 3600000
                                        else if (unit === 'd') totalMs += val * 86400000
                                        else totalMs += val // ms
                                    }
                                } catch (e) {}

                                if (totalMs > 0) {
                                    const absStart = currentOffset + column
                                    const absEnd = absStart + word.length
                                    const cached = findCachedRef(absStart, absEnd)

                                    entries.push({
                                        start: absStart,
                                        end: absEnd,
                                        name: word,
                                        type: 'time_const',
                                        value: totalMs,
                                        originalName: word,
                                        isTimerPT: true,
                                        presetValue: totalMs,
                                        bytecode_offset: cached?.bytecode_offset, 
                                        timer_address: cached?.timer_address,
                                        patchable_type: cached?.patchable_type
                                    })
                                }
                                continue
                            }

                            // Check if it is a keyword -> Ignore
                            if (ALL_STL_KEYWORDS.has(word.toUpperCase())) {
                                continue
                            }
                            
                            // Filter out plain numbers that are not addresses
                            if (/^\d+$/.test(word)) continue

                            // Infer Context (Bit vs Word)
                            // Look at the strict preceding token (word) in the line
                            const preStr = contentToScan.substring(0, column).trimEnd()
                            const lastSpace = preStr.lastIndexOf(' ')
                            const prevWord = lastSpace === -1 ? preStr : preStr.substring(lastSpace + 1)
                            
                            // Boolean opcodes imply BIT usage
                            const BIT_OPCODES = new Set(['A', 'AN', 'O', 'ON', 'X', 'XN', '=', 'S', 'R', 'NOT'])
                            let inferredType = 'unknown'
                            if (BIT_OPCODES.has(prevWord.toUpperCase())) {
                                inferredType = 'bit'
                            }

                            // Check if symbol
                            const symbol = editor.project?.symbols?.find(s => s.name === word)
                            if (symbol) {
                                // Is this our TON Timer instance?
                                const isTonInstance = (tonTimerName === word)
                                
                                entries.push({
                                    start: currentOffset + column,
                                    end: currentOffset + column + word.length,
                                    name: symbol.name,
                                    originalName: word,
                                    type: inferredType === 'bit' ? 'bit' : symbol.type,
                                    location: symbol.location || 'marker',
                                    isTonInstance: isTonInstance,
                                    presetValue: isTonInstance ? tonPresetValue : undefined
                                })
                                continue
                            }

                            // Check if address
                            const matchAddr = ADDRESS_REGEX.exec(word)
                            if (matchAddr) {
                                const typeChar = (matchAddr[1] || '').toUpperCase()
                                const loc = ADDRESS_LOCATION_MAP[typeChar] || 'marker'
                                const byteNum = parseInt(matchAddr[2] || matchAddr[4], 10)
                                
                                // Address with dot implies bit (X0.0) -> group 3 or 5 is present
                                const isExplicitBit = !!(matchAddr[3] || matchAddr[5])
                                
                                // Is this our TON Timer instance?
                                const isTonInstance = (tonTimerName === word)
                                
                                // Determine type: timers used as TON instance are u32 (elapsed time)
                                let type = 'address'
                                if (isExplicitBit || inferredType === 'bit') {
                                    type = 'bit'
                                } else if (loc === 'timer' && isTonInstance) {
                                    type = 'u32' // Timer elapsed time is 32-bit
                                }
                                
                                // Calculate absolute address for timers/counters
                                let absoluteAddress = undefined
                                if (loc === 'timer' || loc === 'counter') {
                                    const offsets = editor.project?.offsets || {}
                                    const baseOffset = offsets[loc]?.offset || 0
                                    const structSize = (loc === 'timer') ? 9 : 5
                                    absoluteAddress = baseOffset + (byteNum * structSize)
                                }

                                entries.push({
                                    start: currentOffset + column,
                                    end: currentOffset + column + word.length,
                                    name: word.toUpperCase(),
                                    originalName: word,
                                    type: type,
                                    location: loc,
                                    isTonInstance: isTonInstance,
                                    presetValue: isTonInstance ? tonPresetValue : undefined,
                                    absoluteAddress: absoluteAddress
                                })
                            }
                        }
                        currentOffset += line.length + 1 // +1 for newline
                    })
                    
                    return entries
                },
                previewValueProvider: (entry) => {
                    // Helper to format time with auto-scaling units
                    const formatTime = ms => {
                        const totalSec = Math.floor(ms / 1000)
                        const d = Math.floor(totalSec / 86400)
                        const h = Math.floor((totalSec % 86400) / 3600)
                        const m = Math.floor((totalSec % 3600) / 60)
                        const s = totalSec % 60
                        const mil = ms % 1000

                        const milStr = mil.toString().padStart(3, '0')
                        const sStr = s.toString().padStart(2, '0')
                        const mStr = m.toString().padStart(2, '0')
                        const hStr = h.toString().padStart(2, '0')

                        if (d > 0) return `${d}d ${hStr}:${mStr}:${sStr}`
                        if (h > 0) return `${h}:${mStr}:${sStr}`
                        if (m > 0) return `${m}:${sStr}`
                        if (s > 0) return `${s}.${milStr}s`
                        return `${mil}ms`
                    }

                    // Always show static time constant pills (matches ASM behavior)
                    if (entry.type === 'time_const') {
                        return { 
                            text: formatTime(entry.value), 
                            className: 'u32 timer' 
                        }
                    }

                    if (!editor.window_manager?.isMonitoringActive?.() || !editor.device_manager?.connected) {
                        return null
                    }

                    // Look up live value - first by name, then by absoluteAddress for timers
                    let liveEntry = editor.live_symbol_values?.get(entry.name)
                    
                    // For timer instances, we need the u32 elapsed time value, not the byte-sized address ref
                    // The address refs (e.g., 'T6') are stored with type 'byte', but timer storage refs 
                    // (e.g., 'tim_storage_M192') are stored with type 'u32'. We need the u32 one.
                    if (entry.absoluteAddress !== undefined && entry.location === 'timer' && entry.isTonInstance) {
                        // Always look up by absoluteAddress and type u32/dint for timer elapsed time
                        const timerLiveEntry = [...editor.live_symbol_values.values()].find(
                            l => l.absoluteAddress === entry.absoluteAddress && (l.type === 'u32' || l.type === 'dint')
                        )
                        if (timerLiveEntry) {
                            liveEntry = timerLiveEntry
                        }
                    }
                    
                    if (!liveEntry) return null

                    let previewText = typeof liveEntry.text === 'string' ? liveEntry.text : 
                                     typeof liveEntry.value !== 'undefined' ? String(liveEntry.value) : '-'
                    
                    let className = ''
                    const fullType = entry.type || (liveEntry.type)

                    // Timer/Counter output handling
                    if (entry.location === 'timer') {
                         const et = typeof liveEntry.value === 'number' ? liveEntry.value : 0
                         const pt = typeof entry.presetValue === 'number' ? entry.presetValue : 0

                         if (entry.isTimerOutput) {
                             // TON Instruction Pill: Show ON/OFF
                             const isOn = (pt > 0 && et >= pt)
                             previewText = isOn ? 'ON' : 'OFF'
                             className = `${isOn ? 'on' : 'off'} bit`
                         } else if (entry.isTonInstance) {
                             // TON Instance (T0): Show Remaining Time until ON
                             // Remaining = PT - ET (how much longer until timer fires)
                             const remaining = Math.max(0, pt - et)
                             previewText = formatTime(remaining)
                             className = 'u32 timer' // force timer style
                         } else if (typeof liveEntry.value === 'number') {
                             // Just a timer usage (e.g. L T0)
                             if (fullType === 'bit') {
                                 // Used as bit (A T0) -> Show ON/OFF
                             } else {
                                 // Used as value (L T0) -> Show ET
                                 previewText = formatTime(liveEntry.value)
                                 className = 'u32 timer'
                             }
                         }
                    }

                    if (fullType === 'bit' || liveEntry.type === 'bit' || previewText === 'ON' || previewText === 'OFF') {
                        // Ensure text is ON/OFF
                        if (previewText === 'true') previewText = 'ON'
                        if (previewText === 'false') previewText = 'OFF'
                        
                        const isOn = (previewText === 'ON' || liveEntry.value === true || liveEntry.value === 1)
                        // If we haven't set previewText to ON/OFF yet (e.g. from liveEntry.value number)
                        if (previewText !== 'ON' && previewText !== 'OFF') {
                             previewText = isOn ? 'ON' : 'OFF'
                        }

                        // Strict check: if it is numbers, don't show ON/OFF unless type is explicitly bit
                        // For isTimerOutput we already set text to ON/OFF with class
                        if (fullType === 'bit' || previewText === 'ON' || previewText === 'OFF') {
                             const isReallyOn = (previewText === 'ON')
                             className = `${isReallyOn ? 'on' : 'off'} bit`
                        }
                    } else {
                        // Default number style
                         if (!className) className = 'u32'
                    }

                    return {
                        text: previewText,
                        className: className
                    }
                },
                blockId: block.id,
                editorId: editor._nav_id,
                programId: block.programId,
                onLintHover: payload => {
                    if (editor.window_manager?.setProblemHover) {
                        editor.window_manager.setProblemHover(payload)
                    }
                },
                onGoToDefinition: payload => {
                    if (payload?.type === 'symbol' && editor.window_manager?.focusSymbolByName) {
                        editor.window_manager.focusSymbolByName(payload.name)
                    }
                },
                onRenameSymbol: (symbolName, event) => {
                    const ctx = editor.context_manager
                    if (!ctx || typeof ctx.show !== 'function') return
                    ctx.show(event, [{ type: 'item', name: 'rename', label: 'Rename Symbol', icon: 'edit' }], async (action) => {
                        if (action !== 'rename') return
                        const result = await Popup.form({
                            title: 'Rename Symbol',
                            description: `Rename "${symbolName}" across the entire project`,
                            inputs: [{ type: 'text', name: 'newName', label: 'New Name', value: symbolName }],
                            buttons: [{ text: 'Rename', value: 'rename', background: '#007bff', color: 'white' }, { text: 'Cancel', value: 'cancel' }],
                        })
                        if (!result || !result.newName || result.newName === symbolName) return
                        const res = editor.renameSymbol(symbolName, result.newName)
                        if (!res.success) {
                            new Popup({ title: 'Rename Failed', description: res.message, buttons: [{ text: 'OK', value: 'ok' }] })
                        } else {
                            text_editor.setValue(block.code)
                        }
                    })
                },
                symbolProvider: type => {
                    if (type === 'label') {
                        const matches = block.code.matchAll(/^\s*([A-Za-z_]\w+):/gm)
                        return [...matches].map(m => ({name: m[1], type: 'Label'}))
                    }
                    if (!editor.project || !editor.project.symbols) return []

                    let symbols = editor.project.symbols
                    if (type === 'bit_symbol') {
                        symbols = symbols.filter(s => s.type === 'bit')
                    }

                    return symbols.map(s => ({name: s.name, type: s.type}))
                },
                hoverProvider: word => {
                    if (word) {
                        // Check if it's an STL keyword
                        const upperWord = word.toUpperCase()
                        if (ALL_STL_KEYWORDS.has(upperWord)) {
                            let category = ''
                            let description = ''
                            
                            if (STL_KEYWORDS.bitLogic.includes(upperWord)) {
                                category = 'Bit Logic'
                                const descriptions = {
                                    'A': 'AND - Combine with AND',
                                    'AN': 'AND NOT - Combine with AND NOT',
                                    'O': 'OR - Combine with OR',
                                    'ON': 'OR NOT - Combine with OR NOT',
                                    'X': 'XOR - Exclusive OR',
                                    'XN': 'XOR NOT - Exclusive OR NOT',
                                    'NOT': 'Negate RLO',
                                    'SET': 'Set RLO to 1',
                                    'CLR': 'Clear RLO to 0',
                                    'CLEAR': 'Clear RLO to 0',
                                }
                                description = descriptions[upperWord] || ''
                            } else if (STL_KEYWORDS.assign.includes(upperWord)) {
                                category = 'Assign'
                                description = upperWord === 'S' ? 'Set bit if RLO=1' : 'Reset bit if RLO=1'
                            } else if (STL_KEYWORDS.edge.includes(upperWord)) {
                                category = 'Edge Detection'
                                description = upperWord === 'FP' ? 'Positive edge (rising)' : 'Negative edge (falling)'
                            } else if (STL_KEYWORDS.timer.includes(upperWord)) {
                                category = 'Timer'
                                const descriptions = {
                                    'TON': 'Timer ON delay',
                                    'TOF': 'Timer OFF delay',
                                    'TP': 'Timer Pulse',
                                }
                                description = descriptions[upperWord] || ''
                            } else if (STL_KEYWORDS.counter.includes(upperWord)) {
                                category = 'Counter'
                                const descriptions = {
                                    'CTU': 'Counter Up',
                                    'CTD': 'Counter Down',
                                    'CTUD': 'Counter Up/Down',
                                }
                                description = descriptions[upperWord] || ''
                            } else if (STL_KEYWORDS.jump.includes(upperWord)) {
                                category = 'Jump'
                                const descriptions = {
                                    'JU': 'Jump Unconditional',
                                    'JC': 'Jump if RLO=1',
                                    'JCN': 'Jump if RLO=0',
                                    'JMP': 'Jump (IEC)',
                                    'JMPC': 'Jump if true (IEC)',
                                    'JMPCN': 'Jump if false (IEC)',
                                }
                                description = descriptions[upperWord] || ''
                            } else if (STL_KEYWORDS.callReturn.includes(upperWord)) {
                                category = 'Call/Return'
                                const descriptions = {
                                    'CALL': 'Call subroutine',
                                    'BE': 'Block End (return)',
                                    'BEC': 'Block End Conditional',
                                    'BEU': 'Block End Unconditional',
                                    'RET': 'Return',
                                }
                                description = descriptions[upperWord] || ''
                            }

                            return `
                                <div class="cce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                                    <span style="color:#569cd6; font-weight: bold;">${upperWord}</span>
                                    <span style="color:#9cdcfe; margin-left: auto;">${category}</span>
                                </div>
                                <div class="cce-hover-desc">
                                    <div style="color:#bbb">${description}</div>
                                </div>
                            `
                        }

                        // Check if it's an address
                        const addrMatch = ADDRESS_REGEX.exec(word)
                        if (addrMatch) {
                            let prefix = '',
                                byteStr = '',
                                bitStr = ''
                            if (addrMatch[1]) {
                                prefix = addrMatch[1].toUpperCase()
                                byteStr = addrMatch[2]
                                bitStr = addrMatch[3]
                            } else {
                                byteStr = addrMatch[4]
                                bitStr = addrMatch[5]
                            }

                            const byteValue = Number.parseInt(byteStr, 10)
                            if (Number.isFinite(byteValue)) {
                                const byte = Math.max(0, byteValue)
                                const bitRaw = bitStr
                                const bitValue = typeof bitRaw === 'undefined' ? null : Number.parseInt(bitRaw, 10)
                                const bit = Number.isFinite(bitValue) ? Math.max(0, Math.min(bitValue, 7)) : null
                                const location = prefix ? ADDRESS_LOCATION_MAP[prefix] || 'marker' : 'memory'
                                const addressLabel = bit !== null ? `${byte}.${bit}` : `${byte}`
                                const canonicalName = `${prefix}${byte}${bit !== null ? '.' + bit : ''}`
                                const type = bit !== null ? 'bit' : 'byte'
                                const liveEntry = editor.live_symbol_values?.get(canonicalName)
                                const valueText = liveEntry ? (typeof liveEntry.text === 'string' ? liveEntry.text : typeof liveEntry.value !== 'undefined' ? String(liveEntry.value) : '-') : '-'
                                const locColor = LOCATION_COLORS[location] || '#cccccc'
                                const typeColor = TYPE_COLORS[type] || '#808080'

                                let valueColor = '#b5cea8'
                                if (type === 'bit' && (valueText === 'ON' || valueText === 'OFF')) {
                                    valueColor = valueText === 'ON' ? '#1fba5f' : 'rgba(200, 200, 200, 0.5)'
                                }

                                return `
                                    <div class="cce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                                        <span style="color:#4daafc">${prefix}${addressLabel}</span>
                                        <span style="color:${typeColor}; margin-left: auto; font-weight: bold;">${type === 'bit' ? 'Bit' : 'Byte'}</span>
                                    </div>
                                    <div class="cce-hover-desc">
                                        <div><span style="color:#bbb">Location:</span> <span style="color:${locColor}">${location}</span></div>
                                        <div><span style="color:#bbb">Address:</span> <span style="color:#b5cea8">${prefix}${addressLabel}</span></div>
                                        <div><span style="color:#bbb">Value:</span> <span style="color:${valueColor}">${valueText}</span></div>
                                    </div>
                                `
                            }
                        }
                    }

                    // Check labels
                    if (word) {
                        const labelMatches = block.code.matchAll(/^\s*([A-Za-z_]\w+):/gm)
                        const labels = []
                        for (const match of labelMatches) {
                            labels.push({name: match[1], index: match.index || 0})
                        }
                        const label = labels.find(l => l.name === word)
                        if (label) {
                            const before = block.code.slice(0, label.index)
                            const line = before.split('\n').length + 1
                            return `
                                <div class="cce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                                    <span style="color:#4daafc">${label.name}</span>
                                    <span style="color:#9cdcfe; margin-left: auto; font-weight: bold;">Label</span>
                                </div>
                                <div class="cce-hover-desc">
                                    <div><span style="color:#bbb">Defined at:</span> <span style="color:#b5cea8">Ln ${line}</span></div>
                                </div>
                            `
                        }
                    }

                    // Check symbols
                    if (!editor.project || !editor.project.symbols) return null
                    const sym = editor.project.symbols.find(s => s.name === word)
                    if (sym) {
                        let addr = sym.address
                        if (sym.type === 'bit') addr = (parseFloat(addr) || 0).toFixed(1)

                        const locColor = LOCATION_COLORS[sym.location] || '#cccccc'
                        const typeColor = TYPE_COLORS[sym.type] || '#808080'

                        return `
                            <div class="cce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                                <span style="color:#4daafc">${sym.name}</span>
                                <span style="color:${typeColor}; margin-left: auto; font-weight: bold;">${sym.type}</span>
                            </div>
                            <div class="cce-hover-desc">
                                <div><span style="color:#bbb">Location:</span> <span style="color:${locColor}">${sym.location}</span></div>
                                <div><span style="color:#bbb">Address:</span> <span style="color:#b5cea8">${addr}</span></div>
                                ${sym.comment ? `<div style="margin-top:4px; font-style: italic; color:#6a9955">// ${sym.comment}</div>` : ''}
                            </div>
                        `
                    }
                    return null
                },
                lintProvider: async () => {
                    if (!block.id || !editor.lintBlock) return []
                    return await editor.lintBlock(block.id)
                },
                onScroll: pos => {
                    block.scrollTop = pos.top
                    block.scrollLeft = pos.left
                },
                onChange: value => {
                    block.code = value
                    updateBlockSize()
                },
            })

            props.text_editor = text_editor
            if (typeof text_editor.setReadOnly === 'function') {
                text_editor.setReadOnly(!!editor.edit_locked)
            }
            if (typeof text_editor.setScroll === 'function') {
                requestAnimationFrame(() => {
                    const hasTop = typeof block.scrollTop === 'number'
                    const hasLeft = typeof block.scrollLeft === 'number'
                    if (hasTop || hasLeft) {
                        text_editor.setScroll({
                            top: hasTop ? block.scrollTop : undefined,
                            left: hasLeft ? block.scrollLeft : undefined,
                        })
                    }
                })
            }
            setTimeout(updateBlockSize, 400)
        }
    },
}

export default stlRenderer
