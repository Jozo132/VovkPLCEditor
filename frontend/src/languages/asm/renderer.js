import { MiniCodeEditor } from "../MiniCodeEditor.js"
import { RendererModule } from "../types.js"
import { Popup } from "../../editor/UI/Elements/components/popup.js"
// import { resolveBlockState } from "./evaluator.js"

const ADDRESS_REGEX = /^(?:([CXYMS])(\d+)(?:\.(\d+))?|(\d+)\.(\d+))$/i
const ADDRESS_LOCATION_MAP = {
    C: 'control',
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
    control: '#4fc1ff',
    system: '#a0a0a0',
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
    const { div, id, type, name, props } = block

    if (!div) throw new Error('Block div not found')
    const block_container = div.querySelector('.plc-program-block-code')
    if (!block_container) throw new Error('Block code not found')
    
    // If loaded from JSON, props.text_editor might be a plain object
    if (props.text_editor && !(props.text_editor instanceof MiniCodeEditor)) {
        props.text_editor = null
    }

    if (!props.text_editor) {
      const resolveEntryInfo = (entry) => {
        let fullType = entry.type || 'byte'
        let addressStr = ''
        if (entry.name && editor.project && editor.project.symbols) {
            const symbol = editor.project.symbols.find(s => s.name === entry.name)
            if (symbol) {
                fullType = symbol.type
                const addr = symbol.address
                const loc = symbol.location || 'marker'
                const prefixMap = { input: 'X', output: 'Y', marker: 'M', system: 'S', control: 'C' }
                const prefix = prefixMap[loc] || 'M'
                if (fullType === 'bit') {
                     const byte = Math.floor(addr)
                     const bit = Math.round((addr - byte) * 10)
                     addressStr = `${prefix}${byte}.${bit}`
                } else {
                     addressStr = `${prefix}${addr}`
                }
            } else {
                addressStr = entry.name
            }
        } else {
            addressStr = entry.name
        }
        return { addressStr, fullType }
      }

      const handlePreviewAction = async (entry, actionName) => {
        if (!editor.window_manager?.isMonitoringActive?.()) return
        const connection = editor.device_manager?.connection
        if (!connection) return

        const { addressStr, fullType } = resolveEntryInfo(entry)

        const addrMatch = ADDRESS_REGEX.exec(addressStr)
        if (!addrMatch) return

        let prefix = '', byteStr = '', bitStr = ''
        if (addrMatch[1]) {
            prefix = addrMatch[1].toUpperCase()
            byteStr = addrMatch[2]
            bitStr = addrMatch[3]
        } else {
            byteStr = addrMatch[4]
            bitStr = addrMatch[5] || null
        }

        const prefixLocationMap = { 'C': 'control', 'X': 'input', 'Y': 'output', 'M': 'marker', 'S': 'system' }
        const location = prefixLocationMap[prefix] || 'marker'
        const byteOffset = Number.parseInt(byteStr, 10)
        const bitIndex = bitStr ? Number.parseInt(bitStr, 10) : null
        const isBit = bitIndex !== null || fullType === 'bit'
        
        const offsets = editor.project.offsets || {}
        const region = offsets[location] || { offset: 0 }
        const absAddress = region.offset + byteOffset

        try {
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
            } else if (actionName === 'edit') {
                 let currentVal = 0;
                 const liveEntry = editor.live_symbol_values?.get(entry.name) || editor.live_symbol_values?.get(addressStr);
                 if (liveEntry && typeof liveEntry.value !== 'undefined') currentVal = liveEntry.value;
                 
                 const formResult = await Popup.form({
                    title: `Edit ${addressStr}`,
                    description: `Enter new value for ${addressStr} (${fullType})`,
                    inputs: [
                        { type: 'text', name: 'value', label: 'Value', value: String(currentVal) }
                    ],
                    buttons: [
                        { text: 'Write', value: 'confirm' },
                        { text: 'Cancel', value: 'cancel' }
                    ]
                 })
                 
                 if (formResult && typeof formResult.value !== 'undefined') {
                     const input = formResult.value
                     let num = Number(input)
                     if (!Number.isNaN(num)) {
                         let size = 1
                         if (['u16', 'i16', 'int', 'word'].includes(fullType)) size = 2
                         if (['u32', 'i32', 'dint', 'real', 'float', 'dword'].includes(fullType)) size = 4
                         if (['u64', 'i64', 'lword'].includes(fullType)) size = 8
                         
                         const data = []
                         if (['real', 'float', 'f32'].includes(fullType)) {
                              const floatArr = new Float32Array([num])
                              const uintArr = new Uint8Array(floatArr.buffer)
                              for(let i=0; i<size; i++) data.push(uintArr[i])
                         } else if (['f64'].includes(fullType)) {
                              const floatArr = new Float64Array([num])
                              const uintArr = new Uint8Array(floatArr.buffer)
                              for(let i=0; i<size; i++) data.push(uintArr[i])
                         } else {
                             let val = BigInt(Math.floor(num))
                             for(let i=0; i<size; i++) {
                                 data.push(Number(val & 0xFFn))
                                 val >>= 8n
                             }
                         }
                         await connection.writeMemoryArea(absAddress, data)
                     }
                 }
            }
            if (editor.window_manager.updateLiveMonitorState) editor.window_manager.updateLiveMonitorState()
        } catch (e) {
            console.error('Failed to write memory:', e)
            alert('Failed to write: ' + e.message)
        }
      }

      const updateBlockSize = () => {
        const height = text_editor.getScrollHeight()
        const block_height = height > 800 ? 800 : height < 100 ? 100 : height // @ts-ignore
        block_container.style.height = `${block_height}px`
      }
      const text_editor = new MiniCodeEditor(block_container, {
        language: 'asm',
        value: block.code,
        font: '12px Consolas, monospace',
        editorId: editor._nav_id,
        programId: block.programId,
        readOnly: !!editor.edit_locked,
        blockId: block.id,
        previewEntriesProvider: () => {
            if (!block.cached_symbol_refs && typeof editor._buildSymbolCache === 'function' && typeof editor._ensureAsmCache === 'function') {
                const cache = editor._buildSymbolCache()
                editor._ensureAsmCache(block, cache.signature, cache.map, cache.details)
            }
            if (typeof editor._ensureBlockAddressRefs === 'function') {
                const { details } = editor._buildSymbolCache?.() || {}
                editor._ensureBlockAddressRefs(block, null, details)
            }
            const symbolRefs = block.cached_symbol_refs || []
            const addressRefs = block.cached_address_refs || []
            const timerRefs = block.cached_timer_refs || []
            
            // Avoid duplicate pills at same position
            const timerRanges = new Set(timerRefs.map(r => `${r.start}-${r.end}`))
            const filteredSymbols = symbolRefs.filter(r => !timerRanges.has(`${r.start}-${r.end}`))
            const filteredAddresses = addressRefs.filter(r => !timerRanges.has(`${r.start}-${r.end}`))
            
            return [...timerRefs, ...filteredSymbols, ...filteredAddresses]
        },
        previewValueProvider: entry => {
            if (!editor.window_manager?.isMonitoringActive?.()) return null
            const live = editor.live_symbol_values?.get(entry?.name)
            
            // For timers, we might not have the ref yet but we need to show SOMETHING 
            // if we are monitoring. However, if live doesn't exist, we fallback.
            if (!live || typeof live.text !== 'string') {
                 // Optimization: if it's a timer PT with constant value, we can at least show that
                 if (entry?.isTimerPT && typeof entry.presetValue === 'number') {
                     return { text: String(entry.presetValue), className: '' }
                 }
                 return null
            }
            
            let className = ''
            let text = live.text

            // Timer monitoring: show remaining time
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
                    } else if (entry.presetName) {
                        const ptLive = editor.live_symbol_values?.get(entry.presetName) || [...editor.live_symbol_values.values()].find(l => l.absoluteAddress === entry.storageAddress + 0 && l.type === 'u32'); // Dummy fallback
                        if (ptLive) {
                            pt = ptLive.value
                            hasPT = true
                        }
                    }
                } else if (entry.isTimerPT) {
                    pt = (typeof entry.presetValue === 'number') ? entry.presetValue : (live.value || 0)
                    hasPT = true
                    // Need ET from storage
                    if (entry.storageAddress !== -1) {
                         const storageLive = [...editor.live_symbol_values.values()].find(l => l.absoluteAddress === entry.storageAddress && (l.type === 'u32' || l.type === 'dint'))
                         if (storageLive) {
                             et = storageLive.value || 0
                             hasET = true
                         }
                    }
                }

                if (hasPT && hasET) {
                    text = String(Math.max(0, Number(pt) - Number(et)))
                } else if (hasPT && !hasET && entry.isTimerPT) {
                    text = String(pt)
                }

                if (entry.isTimerStorage && et > 0) {
                     className += ' active-timer'
                }
            }

            if (entry?.type === 'bit' || live.type === 'bit') {
                className += ` ${live.value ? 'on' : 'off'} bit`
            }
            return { text, className }
        },
        onPreviewAction: (entry, action) => handlePreviewAction(entry, action),
        onPreviewContextMenu: (entry, event) => {
            if (!editor.window_manager?.isMonitoringActive?.()) return
            const { addressStr, fullType } = resolveEntryInfo(entry)
            
            const addrMatch = ADDRESS_REGEX.exec(addressStr)
            if (!addrMatch) return
            
            let prefix = '', byteStr = '', bitStr = ''
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
                items.push({ label: 'Set (1)', name: 'set', icon: 'check', type: 'item' })
                items.push({ label: 'Reset (0)', name: 'reset', icon: 'close', type: 'item' })
                items.push({ label: 'Toggle', name: 'toggle', icon: 'symbol-event', type: 'item' })
            } else {
                 items.push({ label: 'Edit Value...', name: 'edit', icon: 'edit', type: 'item' })
            }
            
            const contextMenu = editor.context_manager
            if (contextMenu && typeof contextMenu.show === 'function') {
                contextMenu.show(event, items, async (actionName) => {
                     await handlePreviewAction(entry, actionName)
                })
            }
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
        symbolProvider: (type) => {
            if (type === 'label') {
                const matches = block.code.matchAll(/^\s*([A-Za-z_]\w+):/gm)
                return [...matches].map(m => ({name: m[1], type: 'Label'}))
            }
            if (!editor.project || !editor.project.symbols) return []
            
            let symbols = editor.project.symbols
            if (type === 'bit_symbol') {
                 symbols = symbols.filter(s => s.type === 'bit')
            }
            
            // Return full symbol objects
            return symbols.map(s => ({name: s.name, type: s.type}))
        },
        hoverProvider: (word) => {
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
                        const bitRaw = bitStr
                        const bitValue = typeof bitRaw === 'undefined' ? null : Number.parseInt(bitRaw, 10)
                        const bit = Number.isFinite(bitValue) ? Math.max(0, Math.min(bitValue, 7)) : null
                        const location = prefix ? (ADDRESS_LOCATION_MAP[prefix] || 'marker') : 'memory'
                        const addressLabel = bit !== null ? `${byte}.${bit}` : `${byte}`
                        const canonicalName = `${prefix}${byte}${bit !== null ? '.' + bit : ''}`
                        const type = bit !== null ? 'bit' : 'byte'
                        const liveEntry = editor.live_symbol_values?.get(canonicalName)
                        const valueText = liveEntry
                            ? (typeof liveEntry.text === 'string'
                                ? liveEntry.text
                                : typeof liveEntry.value !== 'undefined'
                                    ? String(liveEntry.value)
                                    : '-')
                            : '-'
                        const locColor = LOCATION_COLORS[location] || '#cccccc'
                        const typeColor = TYPE_COLORS[type] || '#808080'
                        
                        let valueColor = '#b5cea8'
                        if (type === 'bit' && (valueText === 'ON' || valueText === 'OFF')) {
                            valueColor = valueText === 'ON' ? '#1fba5f' : 'rgba(200, 200, 200, 0.5)'
                        }

                        return `
                            <div class="mce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                                <span class="icon" style="width: 14px; height: 14px; background-size: contain; background-repeat: no-repeat; background-image: url('data:image/svg+xml,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; viewBox=&quot;0 0 16 16&quot;><path fill=&quot;%23cccccc&quot; d=&quot;M14 4h-2a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2h2v-2h-2V6h2V4zM4 12V4h6v8H4z&quot;/></svg>')"></span>
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
            if (!editor.project || !editor.project.symbols) return null
            if (word) {
                const labelMatches = block.code.matchAll(/^\s*([A-Za-z_]\w+):/gm)
                const labels = []
                for (const match of labelMatches) {
                    labels.push({ name: match[1], index: match.index || 0 })
                }
                const label = labels.find(l => l.name === word)
                if (label) {
                    const before = block.code.slice(0, label.index)
                    const line = before.split('\n').length + 1
                    return `
                        <div class="mce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                            <span class="icon" style="width: 14px; height: 14px; background-size: contain; background-repeat: no-repeat; background-image: url('data:image/svg+xml,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; viewBox=&quot;0 0 16 16&quot;><path fill=&quot;%23cccccc&quot; d=&quot;M3 2.5h7a1.5 1.5 0 0 1 1.5 1.5v1H14v2h-2.5v1H14v2h-2.5v1A1.5 1.5 0 0 1 10 13.5H3A1.5 1.5 0 0 1 1.5 12V4A1.5 1.5 0 0 1 3 2.5zm0 1A.5.5 0 0 0 2.5 4v8a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-1H8V9h2.5V7H8V5h2.5V4a.5.5 0 0 0-.5-.5H3z&quot;/></svg>')"></span>
                            <span style="color:#4daafc">${label.name}</span>
                            <span style="color:#9cdcfe; margin-left: auto; font-weight: bold;">Label</span>
                        </div>
                        <div class="mce-hover-desc">
                            <div><span style="color:#bbb">Defined at:</span> <span style="color:#b5cea8">Ln ${line}</span></div>
                        </div>
                    `
                }
            }
            const sym = editor.project.symbols.find(s => s.name === word)
            if (sym) {
                let addr = sym.address
                if (sym.type === 'bit') addr = (parseFloat(addr) || 0).toFixed(1)
                
                const locColor = LOCATION_COLORS[sym.location] || '#cccccc'
                const typeColor = TYPE_COLORS[sym.type] || '#808080'

                return `
                    <div class="mce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                        <span class="icon" style="width: 14px; height: 14px; background-size: contain; background-repeat: no-repeat; background-image: url('data:image/svg+xml,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; viewBox=&quot;0 0 16 16&quot;><path fill=&quot;%23cccccc&quot; d=&quot;M14 4h-2a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2h2v-2h-2V6h2V4zM4 12V4h6v8H4z&quot;/></svg>')"></span>
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
        onChange: (value) => {
          block.code = value
          updateBlockSize()
        }
      })
      // console.log('ASM editor created')
      // console.log(text_editor)
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
              left: hasLeft ? block.scrollLeft : undefined
            })
          }
        })
      }
      setTimeout(updateBlockSize, 400) // Wait for the editor to be created
    }
  }
}

export default ladderRenderer
