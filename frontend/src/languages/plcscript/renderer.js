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

// PLCScript address regex: similar to PLCASM style X0.0, Y0.0, M0, etc.
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

// PLCScript Keywords for syntax highlighting
const PLCSCRIPT_KEYWORDS = {
    // Control flow
    controlFlow: ['if', 'else', 'while', 'for', 'return', 'break', 'continue'],
    // Declarations
    declarations: ['let', 'const', 'function'],
    // Types
    types: ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64', 'f32', 'f64', 'bool', 'void'],
    // Operators
    operators: ['auto'],
}

// Build a flat set for quick lookup
const ALL_PLCSCRIPT_KEYWORDS = new Set([
    ...PLCSCRIPT_KEYWORDS.controlFlow,
    ...PLCSCRIPT_KEYWORDS.declarations,
    ...PLCSCRIPT_KEYWORDS.types,
    ...PLCSCRIPT_KEYWORDS.operators,
])

/** @type { RendererModule } */
export const plcscriptRenderer = {
    id: 'plcscript',

    render(editor, block, ctx) {
        if (block.type !== 'plcscript') return
        
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
                // Memory writes when monitoring
                if (!editor.window_manager?.isMonitoringActive?.()) return
                const connection = editor.device_manager?.connection
                if (!connection) return

                const {addressStr, fullType} = resolveEntryInfo(entry)
                const addrMatch = ADDRESS_REGEX.exec(addressStr)
                if (!addrMatch) return

                let prefix = '', byteStr = '', bitStr = ''
                if (addrMatch[1]) {
                    prefix = addrMatch[1].toUpperCase()
                    byteStr = addrMatch[2]
                    bitStr = addrMatch[3]
                } else {
                    byteStr = addrMatch[4]
                    bitStr = addrMatch[5]
                }
                
                const bitIndex = bitStr ? Number.parseInt(bitStr, 10) : null
                const byteOffset = Number.parseInt(byteStr, 10)
                
                const prefixLocationMap = {C: 'counter', T: 'timer', X: 'input', Y: 'output', M: 'marker', S: 'system'}
                const location = prefixLocationMap[prefix] || 'marker'
                
                const offsets = editor.project.offsets || {}
                const region = offsets[location] || {offset: 0}
                const structSize = (prefix === 'T') ? 9 : (prefix === 'C') ? 5 : 1
                const absAddress = region.offset + (byteOffset * structSize)

                const isBit = bitIndex !== null || fullType === 'bit'

                try {
                    if (isBit && bitIndex !== null) {
                        const mask = 1 << bitIndex
                        let val = 0
                        if (actionName === 'set') val = mask
                        else if (actionName === 'reset') val = 0
                        else if (actionName === 'toggle') {
                            const live = editor.live_symbol_values?.get(entry.name) || editor.live_symbol_values?.get(addressStr)
                            let currentOn = false
                            if (live) {
                                currentOn = (live.value === true || live.value === 1 || live.text === 'ON' || live.value === mask)
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
                                if (['u32', 'i32', 'dint', 'real', 'float', 'dword', 'f32'].includes(fullType)) size = 4
                                if (['u64', 'i64', 'f64'].includes(fullType)) size = 8
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
                language: 'plcscript',
                font: '14px Consolas, monospace',
                readOnly: !!editor.edit_locked,
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
                    if (!editor.project) return []
                    let items = []

                    // Add symbols
                    const symbols = editor.project.symbols || []
                    if (type === 'bit_symbol') {
                        items = symbols.filter(s => s.type === 'bit').map(s => ({name: s.name, type: s.type}))
                    } else {
                        items = symbols.map(s => ({name: s.name, type: s.type}))
                    }

                    // Add datablock fields (DB<n>.<field> and <alias>.<field>)
                    const datablocks = editor.project.datablocks || []
                    for (const db of datablocks) {
                        items.push({ name: `DB${db.id}`, type: 'DataBlock' })
                        if (db.name) items.push({ name: db.name, type: 'DataBlock' })
                        for (const field of (db.fields || [])) {
                            const fieldType = (field.type || 'BYTE').toUpperCase()
                            items.push({ name: `DB${db.id}.${field.name}`, type: fieldType })
                            if (db.name) items.push({ name: `${db.name}.${field.name}`, type: fieldType })
                        }
                    }

                    return items
                },
                hoverProvider: word => {
                    if (!word) return null
                    // Address hover (X0.0, Y1, M0, etc.)
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
                            const bit = bitStr ? Number.parseInt(bitStr, 10) : null
                            const location = prefix ? ADDRESS_LOCATION_MAP[prefix] || 'marker' : 'memory'
                            const addressLabel = bit !== null ? `${byteValue}.${bit}` : `${byteValue}`
                            const canonicalName = `${prefix}${byteValue}${bit !== null ? '.' + bit : ''}`
                            const type = bit !== null ? 'bit' : 'byte'
                            const liveEntry = editor.live_symbol_values?.get(canonicalName)
                            const valueText = liveEntry ? (typeof liveEntry.text === 'string' ? liveEntry.text : typeof liveEntry.value !== 'undefined' ? String(liveEntry.value) : '-') : '-'
                            const locColor = LOCATION_COLORS[location] || '#cccccc'
                            const typeColor = TYPE_COLORS[type] || '#808080'
                            return `
                                <div class="cce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                                    <span style="color:#4daafc">${prefix}${addressLabel}</span>
                                    <span style="color:${typeColor}; margin-left: auto; font-weight: bold;">${type === 'bit' ? 'Bit' : 'Byte'}</span>
                                </div>
                                <div class="cce-hover-desc">
                                    <div><span style="color:#bbb">Location:</span> <span style="color:${locColor}">${location}</span></div>
                                    <div><span style="color:#bbb">Address:</span> <span style="color:#b5cea8">${prefix}${addressLabel}</span></div>
                                    <div><span style="color:#bbb">Value:</span> <span style="color:#b5cea8">${valueText}</span></div>
                                </div>
                            `
                        }
                    }
                    // Symbol hover
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
                onPreviewAction: (entry, action) => handlePreviewAction(entry, action),
                onPreviewContextMenu: (entry, event) => {
                    if (!editor.window_manager?.isMonitoringActive?.()) return
                    
                    const {addressStr, fullType} = resolveEntryInfo(entry)
                    const addrMatch = ADDRESS_REGEX.exec(addressStr)
                    if (!addrMatch) return

                    let bitIndex = null
                    if (addrMatch[1]) {
                        if (addrMatch[3]) bitIndex = parseInt(addrMatch[3], 10)
                    } else {
                        if (addrMatch[5]) bitIndex = parseInt(addrMatch[5], 10)
                    }
                    const isBit = bitIndex !== null || fullType === 'bit'

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
                    const isMonitoring = editor.window_manager?.isMonitoringActive?.()
                    const isConnected = editor.device_manager?.connected
                    if (!isMonitoring || !isConnected) {
                        return []
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

                        // Scan for symbols/addresses (identifiers)
                        const tokenRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g
                        let match
                        
                        while ((match = tokenRegex.exec(contentToScan)) !== null) {
                            const word = match[0]
                            const column = match.index
                            
                            // Skip keywords
                            if (ALL_PLCSCRIPT_KEYWORDS.has(word.toLowerCase())) {
                                continue
                            }

                            // Check if it's a memory address pattern (e.g., M0, X1, Y2)
                            const addrMatch = ADDRESS_REGEX.exec(word)
                            if (addrMatch) {
                                let bitIndex = null
                                let prefix = ''
                                if (addrMatch[1]) {
                                    prefix = addrMatch[1].toUpperCase()
                                    if (addrMatch[3]) bitIndex = parseInt(addrMatch[3], 10)
                                }
                                
                                const location = ADDRESS_LOCATION_MAP[prefix] || 'marker'
                                const inferredType = bitIndex !== null ? 'bit' : 'byte'
                                
                                entries.push({
                                    start: currentOffset + column,
                                    end: currentOffset + column + word.length,
                                    name: word,
                                    type: inferredType,
                                    location: location
                                })
                            } else {
                                // Look up in project symbols
                                if (editor.project && editor.project.symbols) {
                                    const symbol = editor.project.symbols.find(s => s.name === word)
                                    if (symbol) {
                                        entries.push({
                                            start: currentOffset + column,
                                            end: currentOffset + column + word.length,
                                            name: word,
                                            type: symbol.type || 'unknown',
                                            location: symbol.location || 'marker'
                                        })
                                    }
                                }
                            }
                        }
                        
                        currentOffset += line.length + 1 // +1 for newline
                    })

                    // Resolve values from live monitor
                    for (const entry of entries) {
                        const live = editor.live_symbol_values?.get(entry.name)
                        if (live) {
                            entry.value = live.value
                            entry.text = live.text
                        }
                    }

                    return entries
                },
                previewValueProvider: entry => {
                    if (!editor.window_manager?.isMonitoringActive?.() || !editor.device_manager?.connected) return null
                    const live = editor.live_symbol_values?.get(entry?.name)
                    if (!live || typeof live.text !== 'string') return null
                    let className = ''
                    let text = live.text
                    if (entry?.type === 'bit' || live.type === 'bit') {
                        const isOn = live.value === true || live.value === 1 || text === 'ON'
                        text = isOn ? 'ON' : 'OFF'
                        className = `${isOn ? 'on' : 'off'} bit`
                    } else if (live.type) {
                        className = live.type
                    }
                    return {text, className}
                },
                blockId: block.id,
                editorId: editor._nav_id,
                programId: block.programId,
                onGoToDefinition: payload => {
                    if (payload?.type === 'symbol' && editor.window_manager?.focusSymbolByName) {
                        editor.window_manager.focusSymbolByName(payload.name)
                    } else if (payload?.type === 'datablock' && editor.window_manager?.focusDataBlockField) {
                        editor.window_manager.focusDataBlockField(payload.dbId, payload.fieldName)
                    }
                },
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
                onChange: (newValue) => {
                    block.code = newValue
                    block.cached_checksum = null
                    block.cached_asm = null
                    block.cached_asm_map = null
                    block.cached_symbol_refs = null
                    updateBlockSize()
                    if (editor.project_manager?.checkAndSave) {
                        editor.project_manager.checkAndSave()
                    }
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
        } else {
            // Editor exists, just update if needed
            if (props.text_editor.getValue() !== block.code) {
                props.text_editor.setValue(block.code)
            }
        }
    },
}

export default plcscriptRenderer
