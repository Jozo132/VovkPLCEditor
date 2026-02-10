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

// IEC 61131-3 Structured Text address patterns
const ADDRESS_REGEX = /^(?:%?([IQMCT])([XBWD]?)(\d+)(?:\.(\d+))?|([A-Za-z_][A-Za-z0-9_]*))$/i
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

// IEC 61131-3 Structured Text Keywords
const ST_KEYWORDS = {
    // Control flow
    controlFlow: ['IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF', 'CASE', 'OF', 'END_CASE'],
    // Loops
    loops: ['FOR', 'TO', 'BY', 'DO', 'END_FOR', 'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT', 'EXIT', 'RETURN'],
    // Variable declarations
    declarations: ['VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_GLOBAL', 'END_VAR', 'AT', 'CONSTANT', 'RETAIN'],
    // Types
    types: ['BOOL', 'BYTE', 'WORD', 'DWORD', 'LWORD', 'SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT', 'REAL', 'LREAL', 'TIME', 'DATE', 'TOD', 'DT', 'STRING', 'WSTRING', 'ARRAY', 'STRUCT', 'END_STRUCT'],
    // Boolean
    boolean: ['TRUE', 'FALSE', 'AND', 'OR', 'XOR', 'NOT', 'MOD'],
    // Function blocks
    functionBlocks: ['FUNCTION', 'END_FUNCTION', 'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK', 'PROGRAM', 'END_PROGRAM'],
    // Timer/Counter
    timerCounter: ['TON', 'TOF', 'TP', 'CTU', 'CTD', 'CTUD', 'R_TRIG', 'F_TRIG'],
}

// Build a flat set for quick lookup
const ALL_ST_KEYWORDS = new Set([
    ...ST_KEYWORDS.controlFlow,
    ...ST_KEYWORDS.loops,
    ...ST_KEYWORDS.declarations,
    ...ST_KEYWORDS.types,
    ...ST_KEYWORDS.boolean,
    ...ST_KEYWORDS.functionBlocks,
    ...ST_KEYWORDS.timerCounter,
])

/** @type { RendererModule } */
export const stRenderer = {
    id: 'st',

    render(editor, block, ctx) {
        if (block.type !== 'st') return
        
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
                        // IEC 61131-3 style prefixes
                        const prefixMap = {input: '%I', output: '%Q', marker: '%M', system: '%S', counter: '%C', timer: '%T'}
                        const prefix = prefixMap[loc] || '%M'
                        if (fullType === 'bit' || fullType === 'BOOL') {
                            const byte = Math.floor(addr)
                            const bit = Math.round((addr - byte) * 10)
                            addressStr = `${prefix}X${byte}.${bit}`
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
                
                // Parse IEC address format %IX0.0, %QW10, etc.
                const iecMatch = /^%?([IQMSCT])([XBWD]?)(\d+)(?:\.(\d+))?$/i.exec(addressStr)
                if (!iecMatch && !editor.project?.symbols?.find(s => s.name === entry.name)) return

                let prefix = '', sizeQual = '', byteOffset = 0, bitIndex = null
                
                if (iecMatch) {
                    prefix = iecMatch[1].toUpperCase()
                    sizeQual = (iecMatch[2] || '').toUpperCase()
                    byteOffset = Number.parseInt(iecMatch[3], 10)
                    bitIndex = iecMatch[4] ? Number.parseInt(iecMatch[4], 10) : null
                } else {
                    // Symbol lookup
                    const symbol = editor.project.symbols.find(s => s.name === entry.name)
                    if (symbol) {
                        const loc = symbol.location || 'marker'
                        const prefixMap = {input: 'I', output: 'Q', marker: 'M', system: 'S', counter: 'C', timer: 'T'}
                        prefix = prefixMap[loc] || 'M'
                        byteOffset = Math.floor(symbol.address)
                        if (symbol.type === 'bit' || symbol.type === 'BOOL') {
                            bitIndex = Math.round((symbol.address - byteOffset) * 10)
                        }
                    }
                }

                const prefixLocationMap = {C: 'counter', T: 'timer', I: 'input', Q: 'output', M: 'marker', S: 'system'}
                const location = prefixLocationMap[prefix] || 'marker'
                
                const offsets = editor.project.offsets || {}
                const region = offsets[location] || {offset: 0}
                const structSize = (prefix === 'T') ? 9 : (prefix === 'C') ? 5 : 1
                const absAddress = region.offset + (byteOffset * structSize)

                const isBit = bitIndex !== null || sizeQual === 'X' || fullType === 'bit' || fullType === 'BOOL'

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
                                if (['INT', 'UINT', 'WORD'].includes(fullType.toUpperCase()) || sizeQual === 'W') size = 2
                                if (['DINT', 'UDINT', 'REAL', 'DWORD'].includes(fullType.toUpperCase()) || sizeQual === 'D') size = 4
                                if (['LINT', 'ULINT', 'LREAL', 'LWORD'].includes(fullType.toUpperCase())) size = 8
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
                language: 'st',
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
                    if (!editor.project || !editor.project.symbols) return []
                    let symbols = editor.project.symbols
                    if (type === 'bit_symbol') symbols = symbols.filter(s => s.type === 'bit')
                    return symbols.map(s => ({name: s.name, type: s.type}))
                },
                hoverProvider: word => {
                    if (!word) return null
                    // IEC address hover (%IX0.0, %QW10, etc.)
                    const iecMatch = /^%?([IQMSCT])([XBWD]?)(\d+)(?:\.(\d+))?$/i.exec(word)
                    if (iecMatch) {
                        const prefix = iecMatch[1].toUpperCase()
                        const sizeQual = (iecMatch[2] || '').toUpperCase()
                        const byteValue = Number.parseInt(iecMatch[3], 10)
                        const bitValue = iecMatch[4] ? Number.parseInt(iecMatch[4], 10) : null
                        const prefixLocationMap = {I: 'input', Q: 'output', M: 'marker', S: 'system', C: 'counter', T: 'timer'}
                        const location = prefixLocationMap[prefix] || 'marker'
                        let type = 'byte'
                        if (sizeQual === 'X' || bitValue !== null) type = 'BOOL'
                        else if (sizeQual === 'W') type = 'INT'
                        else if (sizeQual === 'D') type = 'DINT'
                        const addressLabel = bitValue !== null ? `${byteValue}.${bitValue}` : `${byteValue}`
                        const canonicalName = `%${prefix}${sizeQual}${addressLabel}`
                        const liveEntry = editor.live_symbol_values?.get(word) || editor.live_symbol_values?.get(canonicalName)
                        const valueText = liveEntry ? (typeof liveEntry.text === 'string' ? liveEntry.text : typeof liveEntry.value !== 'undefined' ? String(liveEntry.value) : '-') : '-'
                        const locColor = LOCATION_COLORS[location] || '#cccccc'
                        const typeColor = TYPE_COLORS[type === 'BOOL' ? 'bit' : type === 'INT' ? 'int' : type === 'DINT' ? 'dint' : 'byte'] || '#808080'
                        return `
                            <div class="cce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                                <span style="color:#4daafc">${word}</span>
                                <span style="color:${typeColor}; margin-left: auto; font-weight: bold;">${type}</span>
                            </div>
                            <div class="cce-hover-desc">
                                <div><span style="color:#bbb">Location:</span> <span style="color:${locColor}">${location}</span></div>
                                <div><span style="color:#bbb">Value:</span> <span style="color:#b5cea8">${valueText}</span></div>
                            </div>
                        `
                    }
                    // Symbol hover
                    if (!editor.project || !editor.project.symbols) return null
                    const sym = editor.project.symbols.find(s => s.name === word)
                    if (sym) {
                        let addr = sym.address
                        if (sym.type === 'bit' || sym.type === 'BOOL') addr = (parseFloat(addr) || 0).toFixed(1)
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
                    
                    // Parse IEC address or symbol
                    const iecMatch = /^%?([IQMSCT])([XBWD]?)(\d+)(?:\.(\d+))?$/i.exec(addressStr)
                    let bitIndex = null
                    let sizeQual = ''
                    
                    if (iecMatch) {
                        sizeQual = (iecMatch[2] || '').toUpperCase()
                        bitIndex = iecMatch[4] ? parseInt(iecMatch[4], 10) : null
                    }
                    
                    const isBit = bitIndex !== null || sizeQual === 'X' || fullType === 'bit' || fullType === 'BOOL'

                    const items = []
                    const connection = editor.device_manager?.connection
                    if (!connection) return

                    if (isBit) {
                        items.push({label: 'Set (TRUE)', name: 'set', icon: 'check', type: 'item'})
                        items.push({label: 'Reset (FALSE)', name: 'reset', icon: 'close', type: 'item'})
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
                        // Handle comments: strip (* ... *) and // style
                        let contentToScan = line
                        // Remove (* ... *) comments (may span multiple lines but we handle per-line)
                        contentToScan = contentToScan.replace(/\(\*.*?\*\)/g, '')
                        // Remove // comments
                        const commentIndex = contentToScan.indexOf('//')
                        if (commentIndex !== -1) {
                            contentToScan = contentToScan.substring(0, commentIndex)
                        }

                        // Scan for symbols/addresses (identifiers)
                        const tokenRegex = /\b(%?[A-Za-z_][A-Za-z0-9_%\.]*)\b/g
                        let match
                        
                        while ((match = tokenRegex.exec(contentToScan)) !== null) {
                            const word = match[0]
                            const column = match.index
                            
                            // Skip keywords (case insensitive)
                            if (ALL_ST_KEYWORDS.has(word.toUpperCase())) {
                                continue
                            }

                            // Check if it's an IEC address pattern (%IX0.0, %QW10, etc.)
                            const iecMatch = /^%?([IQMSCT])([XBWD]?)(\d+)(?:\.(\d+))?$/i.exec(word)
                            if (iecMatch) {
                                const prefix = iecMatch[1].toUpperCase()
                                const sizeQual = (iecMatch[2] || '').toUpperCase()
                                const bitIndex = iecMatch[4] ? parseInt(iecMatch[4], 10) : null
                                
                                const prefixLocationMap = {I: 'input', Q: 'output', M: 'marker', S: 'system', C: 'counter', T: 'timer'}
                                const location = prefixLocationMap[prefix] || 'marker'
                                
                                let inferredType = 'byte'
                                if (sizeQual === 'X' || bitIndex !== null) inferredType = 'bit'
                                else if (sizeQual === 'W') inferredType = 'INT'
                                else if (sizeQual === 'D') inferredType = 'DINT'
                                
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
                    if (entry?.type === 'bit' || entry?.type === 'BOOL' || live.type === 'bit') {
                        const isOn = live.value === true || live.value === 1 || text === 'ON'
                        text = isOn ? 'ON' : 'OFF'
                        className = `${isOn ? 'on' : 'off'} bit`
                    } else if (live.type) {
                        className = live.type
                    }
                    return {text, className}
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

export default stRenderer
