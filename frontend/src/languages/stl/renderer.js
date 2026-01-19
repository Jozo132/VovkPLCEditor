import {MiniCodeEditor} from '../MiniCodeEditor.js'
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
const ADDRESS_REGEX = /^(?:([IQMTCSXYKMN])(\d+)(?:\.(\d+))?|(\d+)\.(\d+))$/i
const ADDRESS_LOCATION_MAP = {
    I: 'input',    // Siemens Input
    Q: 'output',   // Siemens Output
    M: 'marker',
    T: 'timer',
    C: 'counter',
    S: 'system',
    X: 'input',    // PLCASM Input
    Y: 'output',   // PLCASM Output  
    K: 'control',
    N: 'counter',  // Alternative counter notation
}
const LOCATION_COLORS = {
    input: '#89d185',
    output: '#d68d5e',
    marker: '#c586c0',
    memory: '#c586c0',
    control: '#4fc1ff',
    counter: '#dcdcaa',
    timer: '#ce9178',
    system: '#a0a0a0',
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
    math: ['+I', '-I', '*I', '/I', 'MOD', 'NEG', 'ABS'],
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
        const {div, id, type, name, props} = block

        if (!div) throw new Error('Block div not found')
        const block_container = div.querySelector('.plc-program-block-code')
        if (!block_container) throw new Error('Block code not found')

        // If loaded from JSON, props.text_editor might be a plain object
        if (props.text_editor && !(props.text_editor instanceof MiniCodeEditor)) {
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
                        const prefixMap = {input: 'I', output: 'Q', marker: 'M', system: 'S', control: 'K', counter: 'C', timer: 'T'}
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

            const text_editor = new MiniCodeEditor(block_container, {
                value: block.code,
                language: 'stl',  // Uses registered STL language from MiniCodeEditor
                readOnly: !!editor.edit_locked,
                previewProvider: (entries) => {
                    if (!entries || entries.length === 0) return []
                    
                    return entries.map(entry => {
                        if (!entry) return null
                        
                        // Handle timer entries (from _extractAsmTimerRefsFromCode)
                        if (entry.isTimerPT || entry.isTimerStorage) {
                            const {addressStr, fullType} = resolveEntryInfo(entry)
                            let previewText = ''
                            let valueColor = '#b5cea8'
                            let backgroundColor = 'rgba(206, 145, 120, 0.15)'

                            if (entry.isTimerPT) {
                                const liveEntry = editor.live_symbol_values?.get(entry.name)
                                previewText = liveEntry?.text ?? (typeof entry.presetValue === 'number' ? `${entry.presetValue}ms` : '-')
                                backgroundColor = 'rgba(206, 145, 120, 0.2)'
                            } else if (entry.isTimerStorage) {
                                const timerAddr = entry.name
                                const liveEntry = editor.live_symbol_values?.get(timerAddr)
                                if (liveEntry) {
                                    previewText = liveEntry.text ?? '-'
                                    valueColor = liveEntry.text === 'ON' ? '#1fba5f' : 'rgba(200, 200, 200, 0.6)'
                                } else {
                                    previewText = '-'
                                }
                            }

                            return {
                                text: previewText,
                                color: valueColor,
                                background: backgroundColor,
                                tooltip: entry.isTimerPT ? `Preset: ${previewText}` : `Timer ${entry.name}: ${previewText}`,
                                actions: entry.isTimerPT ? ['edit'] : undefined,
                            }
                        }

                        // Handle address entries
                        const {addressStr, fullType} = resolveEntryInfo(entry)
                        const liveEntry = editor.live_symbol_values?.get(entry.name)

                        let previewText = '-'
                        let valueColor = '#b5cea8'
                        let backgroundColor = 'transparent'

                        if (liveEntry) {
                            previewText = typeof liveEntry.text === 'string' ? liveEntry.text : 
                                         typeof liveEntry.value !== 'undefined' ? String(liveEntry.value) : '-'
                            
                            if (fullType === 'bit' && (previewText === 'ON' || previewText === 'OFF')) {
                                valueColor = previewText === 'ON' ? '#1fba5f' : 'rgba(200, 200, 200, 0.5)'
                            }
                        }

                        const locColor = LOCATION_COLORS[entry.location] || '#cccccc'
                        backgroundColor = locColor.replace(')', ', 0.15)').replace('rgb', 'rgba')
                        if (!backgroundColor.includes('rgba')) {
                            backgroundColor = `${locColor}26`
                        }

                        return {
                            text: previewText,
                            color: valueColor,
                            background: backgroundColor,
                            tooltip: `${addressStr} (${entry.location}): ${previewText}`,
                        }
                    }).filter(Boolean)
                },
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
                                <div class="mce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                                    <span style="color:#569cd6; font-weight: bold;">${upperWord}</span>
                                    <span style="color:#9cdcfe; margin-left: auto;">${category}</span>
                                </div>
                                <div class="mce-hover-desc">
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
                                    <div class="mce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                                        <span style="color:#4daafc">${prefix}${addressLabel}</span>
                                        <span style="color:${typeColor}; margin-left: auto; font-weight: bold;">${type === 'bit' ? 'Bit' : 'Byte'}</span>
                                    </div>
                                    <div class="mce-hover-desc">
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
                                <div class="mce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                                    <span style="color:#4daafc">${label.name}</span>
                                    <span style="color:#9cdcfe; margin-left: auto; font-weight: bold;">Label</span>
                                </div>
                                <div class="mce-hover-desc">
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
                            <div class="mce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                                <span style="color:#4daafc">${sym.name}</span>
                                <span style="color:${typeColor}; margin-left: auto; font-weight: bold;">${sym.type}</span>
                            </div>
                            <div class="mce-hover-desc">
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
