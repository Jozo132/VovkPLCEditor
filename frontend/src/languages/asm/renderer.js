import {CanvasCodeEditor} from '../CanvasCodeEditor.js'
import {RendererModule} from '../types.js'
import {Popup} from '../../editor/UI/Elements/components/popup.js'
// import { resolveBlockState } from "./evaluator.js"

// De-duplicating logger to avoid spam
const createDedupLogger = () => {
    const recentLogs = new Map() // key -> { count, lastTime }
    const DEDUPE_WINDOW = 1000 // ms

    return (prefix, data) => {
        const key = prefix + JSON.stringify(data)
        const now = Date.now()
        const recent = recentLogs.get(key)

        if (recent && now - recent.lastTime < DEDUPE_WINDOW) {
            recent.count++
            return // Skip duplicate
        }

        if (recent && recent.count > 1) {
            console.log(`${prefix} (repeated ${recent.count} times)`)
        }

        console.log(prefix, data)
        recentLogs.set(key, {count: 1, lastTime: now})

        // Cleanup old entries
        if (recentLogs.size > 100) {
            const cutoff = now - DEDUPE_WINDOW * 2
            for (const [k, v] of recentLogs.entries()) {
                if (v.lastTime < cutoff) recentLogs.delete(k)
            }
        }
    }
}
const dlog = createDedupLogger()

const ADDRESS_REGEX = /^(?:([IQCTXYMS])(\d+)(?:\.(\d+))?|(\d+)\.(\d+))$/i
const ADDRESS_LOCATION_MAP = {
    I: 'input',
    Q: 'output',
    C: 'counter',
    T: 'timer',
    X: 'input',
    Y: 'output',
    M: 'marker',
    S: 'system',
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

/** @type { RendererModule } */
export const ladderRenderer = {
    id: 'asm',

    render(editor, block, ctx) {
        if (block.type !== 'asm') return
        
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

                // For timer refs with originalName, use that for lookup
                const lookupName = entry.originalName || entry.name

                if (lookupName && editor.project && editor.project.symbols) {
                    const symbol = editor.project.symbols.find(s => s.name === lookupName)
                    if (symbol) {
                        fullType = symbol.type
                        const addr = symbol.address
                        const loc = symbol.location || 'marker'
                        const prefixMap = {input: 'X', output: 'Y', marker: 'M', system: 'S', counter: 'C', timer: 'T'}
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

            const handlePreviewAction = async (entry, actionName, inlineValue) => {
                // ============================================================
                // LIVE PATCHING: Timer presets and embedded constants
                // Uses LivePatcher to modify and re-upload program bytecode
                // ============================================================
                if (entry?.isTimerPT && entry?.bytecode_offset !== undefined && typeof entry.presetValue === 'number') {
                    if (actionName !== 'edit' && actionName !== 'edit-confirm') return

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
                        // FIX: Ensure value matches the type expected by Popup.js (number for type: 'number')
                        let currentInput = isIecFormat ? entry.originalName : entry.presetValue

                        // Helper: parse and patch timer value from a string input
                        const parseAndPatchTimer = async (inputStr) => {
                            const strVal = String(inputStr).trim()
                            if (!strVal) throw new Error("Value cannot be empty")

                            let newValue = 0
                            let newToken = ''

                            if (isIecFormat) {
                                if (strVal.toUpperCase().startsWith('T#')) {
                                    if (!/^T#(\d+(?:ms|s|m|h|d))+$/i.test(strVal)) {
                                        throw new Error("Invalid format. Spaces are not allowed (e.g., T#45d3s)")
                                    }
                                    const content = strVal.substring(2)
                                    const partRegex = /(\d+)(ms|s|m|h|d)/gi
                                    let totalMs = 0
                                    let hasMatch = false
                                    let pMatch
                                    while ((pMatch = partRegex.exec(content))) {
                                        hasMatch = true
                                        const val = parseInt(pMatch[1], 10)
                                        const unit = pMatch[2].toLowerCase()
                                        if (unit === 's') totalMs += val * 1000
                                        else if (unit === 'm') totalMs += val * 60000
                                        else if (unit === 'h') totalMs += val * 3600000
                                        else if (unit === 'd') totalMs += val * 86400000
                                        else totalMs += val
                                    }
                                    newValue = hasMatch ? totalMs : (() => { const s = parseInt(content, 10); if (isNaN(s)) throw new Error("Invalid T# format"); return s })()
                                    newToken = strVal
                                } else if (strVal.startsWith('#')) {
                                    newValue = parseInt(strVal.substring(1), 10)
                                    newToken = strVal
                                } else {
                                    newValue = parseInt(strVal, 10)
                                    if (isNaN(newValue)) throw new Error("Invalid time format")
                                    newToken = `#${newValue}`
                                }
                            } else {
                                newValue = parseInt(strVal, 10)
                                newToken = `#${newValue}`
                            }

                            if (isNaN(newValue) || newValue < 0 || newValue > 4294967295) {
                                throw new Error("Value out of valid range")
                            }

                            const patchResult = await patcher.patchConstant(entry.bytecode_offset, newValue)
                            if (!patchResult.success) throw new Error(`Write Failed: ${patchResult.message}`)

                            // Update source code to match patched bytecode
                            const oldToken = entry.originalName || `#${entry.presetValue}`
                            console.log('[PATCH] Updating source:', { oldToken, newToken, entryStart: entry.start, entryEnd: entry.end })

                            if (entry.start !== undefined && entry.end !== undefined) {
                                block.code = block.code.substring(0, entry.start) + newToken + block.code.substring(entry.end)
                            } else {
                                block.code = block.code.replace(oldToken, newToken)
                            }

                            const textEditor = block.props?.text_editor
                            if (textEditor?.setValue) {
                                block.cached_checksum = null
                                block.cached_asm = null
                                block.cached_asm_map = null
                                block.cached_symbol_refs = null
                                block.cached_address_refs = null
                                block.cached_timer_refs = null
                                block.cached_symbols_checksum = null
                                textEditor.setValue(block.code)
                            }

                            if (editor.project_manager?.checkAndSave) {
                                editor.project_manager.checkAndSave()
                            }

                            setTimeout(async () => {
                                console.log('[PATCH] Recompiling to rebuild IR and symbol map...')
                                if (editor.window_manager?.handleCompile) {
                                    await editor.window_manager.handleCompile({ silent: true })
                                }
                            }, 100)
                        }

                        if (actionName === 'edit-confirm' && inlineValue !== undefined) {
                            // Inline edit — patch directly with the value from the overlay input
                            await parseAndPatchTimer(inlineValue)
                        } else {
                            // Popup form edit
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
                            buttons: [{
                                text: 'Write',
                                value: 'confirm'
                            }, {
                                text: 'Cancel',
                                value: 'cancel'
                            }, ],
                            verify: async (states) => {
                                states.error.value = ''
                                states.value.clearError()
                                try {
                                    await parseAndPatchTimer(states.value.value)
                                    return true
                                } catch (e) {
                                    states.error.value = e.message
                                    states.value.setError()
                                    return false
                                }
                            }
                        })
                        } // end else (popup form)
                    } catch (err) {
                        console.error('[ASM Renderer] Error patching constant:', err)
                        new Popup({
                            title: 'Error',
                            description: err.message || 'Unknown error',
                            buttons: [{text: 'OK', value: 'ok', background: '#dc3545', color: 'white'}],
                        })
                    }
                    return
                }

                // ============================================================
                // MEMORY WRITES: Runtime variables (I/O, markers, timers)
                // Uses direct memory access for variables in memory space
                // ============================================================
                if (!editor.window_manager?.isMonitoringActive?.()) return
                const connection = editor.device_manager?.connection
                if (!connection) return

                const {addressStr, fullType} = resolveEntryInfo(entry)

                const addrMatch = ADDRESS_REGEX.exec(addressStr)
                if (!addrMatch) return

                let prefix = '',
                    byteStr = '',
                    bitStr = ''
                if (addrMatch[1]) {
                    prefix = addrMatch[1].toUpperCase()
                    byteStr = addrMatch[2]
                    bitStr = addrMatch[3]
                } else {
                    byteStr = addrMatch[4]
                    bitStr = addrMatch[5] || null
                }

                const prefixLocationMap = {C: 'counter', T: 'timer', X: 'input', Y: 'output', M: 'marker', S: 'system'}
                const location = prefixLocationMap[prefix] || 'marker'
                const byteOffset = Number.parseInt(byteStr, 10)
                const bitIndex = bitStr ? Number.parseInt(bitStr, 10) : null
                const isBit = bitIndex !== null || fullType === 'bit'

                const offsets = editor.project.offsets || {}
                const region = offsets[location] || {offset: 0}
                // Timer (T) uses 9 bytes per unit, Counter (C) uses 5 bytes per unit
                const structSize = (prefix === 'T') ? 9 : (prefix === 'C') ? 5 : 1
                const absAddress = region.offset + (byteOffset * structSize)

                try {
                    // Helper: write a numeric value to the memory address
                    const writeMemoryValue = async (input) => {
                        let num = Number(input)
                        if (Number.isNaN(num)) throw new Error('Invalid number')
                        let size = 1
                        if (['u16', 'i16', 'int', 'word'].includes(fullType)) size = 2
                        if (['u32', 'i32', 'dint', 'real', 'float', 'dword'].includes(fullType)) size = 4
                        if (['u64', 'i64', 'lword'].includes(fullType)) size = 8

                        const isLittleEndian = editor.device_manager?.deviceInfo?.isLittleEndian ?? true
                        const buffer = new ArrayBuffer(size)
                        const view = new DataView(buffer)

                        if (['real', 'float', 'f32'].includes(fullType)) {
                            view.setFloat32(0, num, isLittleEndian)
                        } else if (['f64'].includes(fullType)) {
                            view.setFloat64(0, num, isLittleEndian)
                        } else if (['i16', 'int'].includes(fullType)) {
                            view.setInt16(0, num, isLittleEndian)
                        } else if (['u16', 'word'].includes(fullType)) {
                            view.setUint16(0, num, isLittleEndian)
                        } else if (['i32', 'dint'].includes(fullType)) {
                            view.setInt32(0, num, isLittleEndian)
                        } else if (['u32', 'dword'].includes(fullType)) {
                            view.setUint32(0, num, isLittleEndian)
                        } else if (['i64', 'lword'].includes(fullType)) {
                            view.setBigInt64(0, BigInt(Math.floor(num)), isLittleEndian)
                        } else if (['u64'].includes(fullType)) {
                            view.setBigUint64(0, BigInt(Math.floor(num)), isLittleEndian)
                        } else if (['i8'].includes(fullType)) {
                            view.setInt8(0, num)
                        } else {
                            view.setUint8(0, num & 0xFF)
                        }
                        
                        const data = Array.from(new Uint8Array(buffer))
                        await connection.writeMemoryArea(absAddress, data)
                    }

                    if (isBit && bitIndex !== null) {
                        const mask = 1 << bitIndex
                        let val = 0
                        if (actionName === 'set') val = mask
                        else if (actionName === 'reset') val = 0
                        else if (actionName === 'toggle') {
                            const live = editor.live_symbol_values?.get(entry.name) || editor.live_symbol_values?.get(addressStr)
                            const currentOn = live && (live.value === true || live.value === 1 || live.text === 'ON')
                            val = currentOn ? 0 : mask
                        }
                        await connection.writeMemoryAreaMasked(absAddress, [val], [mask])
                    } else if (actionName === 'edit-confirm' && inlineValue !== undefined) {
                        // Inline edit — write value directly from the overlay input
                        await writeMemoryValue(inlineValue)
                    } else if (actionName === 'edit') {
                        let currentVal = 0
                        const liveEntry = editor.live_symbol_values?.get(entry.name) || editor.live_symbol_values?.get(addressStr)
                        if (liveEntry && typeof liveEntry.value !== 'undefined') currentVal = liveEntry.value

                        const formResult = await Popup.form({
                            title: `Edit ${addressStr}`,
                            description: `Enter new value for ${addressStr} (${fullType})`,
                            inputs: [{type: 'text', name: 'value', label: 'Value', value: String(currentVal)}],
                            buttons: [
                                {text: 'Write', value: 'confirm'},
                                {text: 'Cancel', value: 'cancel'},
                            ],
                        })

                        if (formResult && typeof formResult.value !== 'undefined') {
                            await writeMemoryValue(formResult.value)
                        }
                    }
                    if (editor.window_manager.updateLiveMonitorState) editor.window_manager.updateLiveMonitorState()
                } catch (e) {
                    console.error('Failed to write memory:', e)
                    alert('Failed to write: ' + e.message)
                }
            }

            let text_editor

            // Preview providers
            const _previewEntriesProvider = () => {
                // Only show pills when monitoring is active AND device is connected
                const isMonitoring = editor.window_manager?.isMonitoringActive?.()
                const isConnected = editor.device_manager?.connected
                if (!isMonitoring || !isConnected) {
                    return []
                }

                // Validate cache against current code checksum
                const currentCode = block.code || ''
                const currentChecksum = editor._hashString?.(currentCode)?.toString() || null

                if (currentChecksum && currentChecksum !== block.cached_checksum) {
                    console.log('[PILLS] Cache invalidated - code changed!')
                    block.cached_checksum = null
                    block.cached_symbol_refs = null
                    block.cached_address_refs = null
                    block.cached_timer_refs = null
                    block.cached_asm = null
                    block.cached_asm_map = null
                }

                if (!block.cached_symbol_refs && typeof editor._buildSymbolCache === 'function' && typeof editor._ensureAsmCache === 'function') {
                    console.log('[PILLS] Rebuilding cache...')
                    const cache = editor._buildSymbolCache()
                    editor._ensureAsmCache(block, cache.signature, cache.map, cache.details)
                }
                if (typeof editor._ensureBlockAddressRefs === 'function') {
                    const {details} = editor._buildSymbolCache?.() || {}
                    editor._ensureBlockAddressRefs(block, null, details)
                }
                const symbolRefs = block.cached_symbol_refs || []
                const addressRefs = block.cached_address_refs || []
                const timerRefs = block.cached_timer_refs || []

                // Match timer constant presets with patchable constants from LivePatcher
                if (editor.program_patcher?.patchableConstants && timerRefs.length > 0) {
                    const patchableMap = new Map()

                    for (const [offset, constant] of editor.program_patcher.patchableConstants) {
                        if (constant.flags & 0x10 && constant.timer_address !== undefined) {
                            patchableMap.set(constant.timer_address, constant)
                        }
                    }

                    for (const timerRef of timerRefs) {
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

                const timerRanges = new Set(timerRefs.map(r => `${r.start}-${r.end}`))
                const filteredSymbols = symbolRefs.filter(r => !timerRanges.has(`${r.start}-${r.end}`))
                const filteredAddresses = addressRefs.filter(r => !timerRanges.has(`${r.start}-${r.end}`))

                timerRefs.forEach(r => {
                    if (r.isTimerStorage || r.isTimerOutput) {
                        r.nonInteractive = true
                    }
                })

                return [...timerRefs, ...filteredSymbols, ...filteredAddresses]
            }

            const _formatTime = ms => {
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

            const _previewValueProvider = entry => {
                // When offline, show constant preset values
                if (!editor.window_manager?.isMonitoringActive?.() || !editor.device_manager?.connected) {
                    if (entry?.isTimerPT && typeof entry.presetValue === 'number') {
                        return {text: _formatTime(entry.presetValue), className: 'u32 timer'}
                    }
                    return null
                }

                // When online (monitoring), show live values
                let live = editor.live_symbol_values?.get(entry?.name)
                if (!live && entry?.originalName) {
                    live = editor.live_symbol_values?.get(entry.originalName)
                }

                const result = (() => {
                    if (!live || typeof live.text !== 'string') return null

                    let className = ''
                    let text = live.text

                    // Timer output state (Q bit)
                    if (entry?.isTimerOutput) {
                        const isOn = live.value ? true : false
                        text = isOn ? 'ON' : 'OFF'
                        className = `${isOn ? 'on' : 'off'} bit timer-output`
                        return {text, className}
                    }

                    // Timer monitoring: show remaining/elapsed time
                    if (entry?.isTimerStorage || entry?.isTimerPT) {
                        let et = 0
                        let pt = 0
                        let hasPT = false
                        let hasET = false

                        if (entry.isTimerStorage) {
                            et = live.value || 0
                            hasET = true
                            if (typeof entry.presetValue === 'number') {
                                pt = entry.presetValue
                                hasPT = true
                            } else if (entry.presetAddress !== undefined) {
                                const ptLive = [...editor.live_symbol_values.values()].find(
                                    l => l.absoluteAddress === entry.presetAddress && (l.type === 'u32' || l.type === 'dint')
                                )
                                if (ptLive && typeof ptLive.value === 'number') {
                                    pt = ptLive.value
                                    hasPT = true
                                }
                            } else if (entry.presetName) {
                                const ptLive = editor.live_symbol_values?.get(entry.presetName)
                                if (ptLive && typeof ptLive.value === 'number') {
                                    pt = ptLive.value
                                    hasPT = true
                                }
                            }
                        } else if (entry.isTimerPT) {
                            if (entry.isPresetAddress) {
                                pt = live.value || 0
                                hasPT = true
                            } else {
                                pt = entry.presetValue || 0
                                hasPT = true
                            }

                            if (entry.storageAddress !== -1) {
                                const storageLive = [...editor.live_symbol_values.values()].find(l => l.absoluteAddress === entry.storageAddress && (l.type === 'u32' || l.type === 'dint'))
                                if (storageLive) {
                                    et = storageLive.value || 0
                                    hasET = true
                                }
                            }
                        }

                        if (entry.isTimerStorage) {
                            if (hasPT && hasET) {
                                const remaining = Math.max(0, Number(pt) - Number(et))
                                text = _formatTime(remaining)
                                className += ' timer'
                            } else if (hasET) {
                                text = _formatTime(et)
                                className += ' timer'
                            }
                        } else if (entry.isTimerPT) {
                            if (hasPT) {
                                text = _formatTime(pt)
                                className += ' timer'
                            }
                        }

                        if (entry.isTimerStorage && et > 0) {
                            className += ' active-timer'
                        }
                    }

                    if (entry?.type === 'bit' || live.type === 'bit') {
                        className += ` ${live.value ? 'on' : 'off'} bit`
                    } else if (!entry?.isTimerStorage && !entry?.isTimerPT && live.type) {
                        className += ` ${live.type}`
                    }
                    return {text, className}
                })()

                return result
            }

            const _onPreviewAction = (entry, action, value) => handlePreviewAction(entry, action, value)

            const _onPreviewContextMenu = (entry, event) => {
                // Block context menu for timer storage and timer output - they're read-only
                if (entry?.isTimerStorage || entry?.isTimerOutput) {
                    return
                }

                // Handle timer constant presets (bytecode patching)
                if (entry?.isTimerPT && !entry.isPresetAddress && typeof entry.presetValue === 'number' && entry.bytecode_offset !== undefined) {
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

                // Handle memory variables (addresses and timer storage)
                if (!editor.window_manager?.isMonitoringActive?.()) return
                const {addressStr, fullType} = resolveEntryInfo(entry)

                const addrMatch = ADDRESS_REGEX.exec(addressStr)
                if (!addrMatch) return

                let prefix = '',
                    byteStr = '',
                    bitStr = ''
                if (addrMatch[1]) {
                    prefix = addrMatch[1].toUpperCase()
                    byteStr = addrMatch[2]
                    bitStr = addrMatch[3]
                } else {
                    byteStr = addrMatch[4]
                    bitStr = addrMatch[5] || null
                }

                const bitIndex = bitStr ? Number.parseInt(bitStr, 10) : null
                const isBit = bitIndex !== null || fullType === 'bit'

                const items = []
                const connection = editor.device_manager?.connection
                if (!connection) return

                if (isBit && bitIndex !== null) {
                    items.push({label: 'Set (1)', name: 'set', icon: 'check', type: 'item'})
                    items.push({label: 'Reset (0)', name: 'reset', icon: 'close', type: 'item'})
                    items.push({label: 'Toggle', name: 'toggle', icon: 'symbol-event', type: 'item'})
                } else {
                    items.push({label: 'Edit Value...', name: 'edit', icon: 'edit', type: 'item'})
                }

                const contextMenu = editor.context_manager
                if (contextMenu && typeof contextMenu.show === 'function') {
                    contextMenu.show(event, items, async actionName => {
                        await handlePreviewAction(entry, actionName)
                    })
                }
            }

            const updateBlockSize = () => {
                    const lineCount = (block.code || '').split('\n').length
                    const lineHeight = 19
                    const padding = 16
                    const minHeight = 100
                    const maxHeight = 800
                    const calculatedHeight = Math.min(maxHeight, Math.max(minHeight, lineCount * lineHeight + padding))
                    block_container.style.height = calculatedHeight + 'px'
                }

            text_editor = new CanvasCodeEditor(block_container, {
                    language: 'asm',
                    value: block.code,
                    font: '14px Consolas, monospace',
                    readOnly: !!editor.edit_locked,
                    previewEntriesProvider: _previewEntriesProvider,
                    previewValueProvider: _previewValueProvider,
                    onPreviewAction: _onPreviewAction,
                    onPreviewContextMenu: _onPreviewContextMenu,
                    symbolProvider: type => {
                        if (type === 'label') {
                            const matches = block.code.matchAll(/^\s*([A-Za-z_]\w+):/gm)
                            return [...matches].map(m => ({name: m[1], type: 'Label'}))
                        }
                        if (type === 'type') {
                            return ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64', 'f32', 'f64'].map(t => ({name: t, type: 'type'}))
                        }
                        if (!editor.project || !editor.project.symbols) return []
                        let symbols = editor.project.symbols
                        if (type === 'bit_symbol') symbols = symbols.filter(s => s.type === 'bit')
                        return symbols.map(s => ({name: s.name, type: s.type}))
                    },
                    hoverProvider: word => {
                        if (word) {
                            const addrMatch = ADDRESS_REGEX.exec(word)
                            if (addrMatch) {
                                let prefix = '', byteStr = '', bitStr = ''
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
                                    const bitValue = typeof bitStr === 'undefined' ? null : Number.parseInt(bitStr, 10)
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
                    blockId: block.id,
                    onLintHover: payload => {
                        if (editor.window_manager?.setProblemHover) editor.window_manager.setProblemHover(payload)
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
            setTimeout(updateBlockSize, 100)
        }
    },
}

export default ladderRenderer
