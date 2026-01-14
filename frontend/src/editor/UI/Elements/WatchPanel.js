import { ElementSynthesis, CSSimporter } from "../../../utils/tools.js"
import { Popup } from "./components/popup.js"

const importCSS = CSSimporter(import.meta.url)
await importCSS('./WatchPanel.css')

const WATCH_TYPES = {
    'bit':   { size: 1, label: 'BIT' },
    'byte':  { size: 1, label: 'BYTE' },
    'u8':    { size: 1, label: 'U8' },
    'i8':    { size: 1, label: 'I8' },
    'int':   { size: 2, label: 'INT' },
    'u16':   { size: 2, label: 'U16' },
    'dint':  { size: 4, label: 'DINT' },
    'u32':   { size: 4, label: 'U32' },
    'real':  { size: 4, label: 'REAL' },
    'f64':   { size: 8, label: 'F64' },
    'hex':   { size: 1, label: 'HEX' },
}

export default class WatchPanel {
    active_device = 'simulation'
    entries = []

    /**
     * @param {import('../../Editor.js').VovkPLCEditor} editor 
     * @param {HTMLElement} parent
     */
    constructor(editor, parent) {
        this.editor = editor
        this.parent = parent
        this.minimized = false
        this.selectedIndex = -1
        this.render()
    }

    /** @type { (entries: any[]) => void } */
    onListChange = null

    setEntries(items) {
        // Clear existing monitoring
        this.entries.forEach(e => this.stopMonitoring(e))
        this.entries = items.map(item => {
            if (typeof item === 'string') return { name: item, value: '-', type: '' }
            return { name: item.name, type: item.type || '', value: '-' }
        })
        this.entries.forEach(e => this.startMonitoring(e))
        this.renderList()
    }

    getEntries() {
        return this.entries.map(e => ({ name: e.name, type: e.type }))
    }

    _notifyChange() {
        if (this.onListChange) {
            this.onListChange(this.getEntries())
        }
    }


    render() {
        // Styles loaded via CSS file

        const element = ElementSynthesis(/*HTML*/`
            <div class="plc-device-watch resizable-panel" id="panel-watch">
                <div class="plc-device-watch-header" title="Click to toggle collapse">
                    <span class="codicon codicon-chevron-down plc-device-watch-chevron"></span>
                    <span class="plc-icon plc-icon-sidebar-watch" style="margin-right: 4px; transform: scale(0.8);"></span>
                    <span class="plc-device-watch-title">Watch Table</span>
                </div>
                <div class="plc-device-watch-content">
                    <div class="plc-device-watch-input-container">
                        <div class="plc-device-watch-input-row">
                            <input class="plc-device-watch-input" type="text" placeholder="Add symbol..." autocomplete="off"/>
                            <button class="plc-device-watch-add">Add</button>
                        </div>
                        <div class="plc-device-watch-suggestions"></div>
                    </div>
                    <div class="plc-device-watch-body">
                        <div class="plc-device-watch-row plc-device-watch-row-head">
                            <span style="flex:2">Name</span>
                            <span style="flex:1">Type</span>
                            <span style="flex:2; text-align: right; padding-right: 4px;">Value</span>
                        </div>
                        <div class="plc-device-watch-list" tabindex="0"></div>
                        <div class="plc-device-watch-empty">Add symbols to monitor their values. Right-click to remove.</div>
                    </div>
                </div>
            </div>
        `)

        this.parent.appendChild(element)
        this.element = element

        this.headerEl = element.querySelector('.plc-device-watch-header')
        this.contentEl = element.querySelector('.plc-device-watch-content')
        this.chevronEl = element.querySelector('.plc-device-watch-chevron')
        
        /*
        this.headerEl.addEventListener('click', () => {
            this.minimized = !this.minimized
            this.updateMinimizedState()
        })
        */

        this.listEl = element.querySelector('.plc-device-watch-list')
        this.emptyEl = element.querySelector('.plc-device-watch-empty')
        this.inputEl = element.querySelector('.plc-device-watch-input')
        this.addBtn = element.querySelector('.plc-device-watch-add')
        this.suggestionsEl = element.querySelector('.plc-device-watch-suggestions')

        this.addBtn.addEventListener('click', () => this.onWatchAdd())
        
        this.listEl.addEventListener('keydown', (e) => this.onListKeyDown(e))
        this.listEl.addEventListener('focus', () => {
             if (this.selectedIndex === -1 && this.entries.length > 0) {
                 this.selectedIndex = 0
                 this.updateSelectionVisuals()
             }
        })

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (this.suggestionsEl.style.display !== 'none' && this.activeSuggestionIndex >= 0) {
                     // Selection handled by onWatchAdd via value set
                     if (this.activeSuggestionIndex >= 0 && this.suggestionItems && this.suggestionItems[this.activeSuggestionIndex]) {
                         // Extract name from the span
                         this.inputEl.value = this.suggestionItems[this.activeSuggestionIndex].querySelector('span').textContent
                     }
                }
                this.onWatchAdd()
                this.closeSuggestions()
            } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                this.navigateSuggestions(1)
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                this.navigateSuggestions(-1)
            } else if (e.key === 'Escape') {
                this.closeSuggestions()
            }
        })
        
        this.inputEl.addEventListener('input', () => this.updateSuggestions())
        this.inputEl.addEventListener('focus', () => this.updateSuggestions())
        // Delay blur to allow click on suggestion
        this.inputEl.addEventListener('blur', () => setTimeout(() => this.closeSuggestions(), 200))

        // Context Menu
        if (this.editor.context_manager) {
            this.editor.context_manager.addListener({
                target: this.listEl,
                onOpen: (e) => {
                    const row = e.target.closest('.plc-device-watch-row')
                    const items = []
                    
                    if (row) {
                        const idx = +row.dataset.index
                        this.activeActionIndex = idx
                        items.push({ type: 'item', label: 'Edit Watch', name: 'edit' })
                        items.push({ type: 'item', label: 'Remove Watch', name: 'remove' })
                        items.push({ type: 'separator' })
                    }

                    items.push({ type: 'item', label: 'Clear All', name: 'clear', disabled: this.entries.length === 0 })
                    
                    return items
                },
                onClose: (key) => {
                    if (key === 'edit' && this.activeActionIndex !== undefined) {
                        this.enterEditMode(this.activeActionIndex)
                    }
                    if (key === 'remove' && this.activeActionIndex !== undefined) {
                        const entry = this.entries[this.activeActionIndex]
                        if (entry) {
                            this.stopMonitoring(entry)
                            this.entries.splice(this.activeActionIndex, 1)
                            this._notifyChange()
                            this.renderList()
                        }
                    }
                    if (key === 'clear') {
                        this.entries.forEach(e => this.stopMonitoring(e))
                        this.entries = []
                        this._notifyChange()
                        this.renderList()
                    }
                }
            })
        }
        
        this.renderList()
    }

    updateMinimizedState() {
        if (this.minimized) {
             this.contentEl.style.display = 'none'
             this.chevronEl.classList.remove('codicon-chevron-down')
             this.chevronEl.classList.add('codicon-chevron-right')
        } else {
             this.contentEl.style.display = 'flex' // Or block, depending on layout
             this.contentEl.style.flexDirection = 'column'
             this.contentEl.style.flex = '1'
             this.contentEl.style.minHeight = '0'
             
             this.chevronEl.classList.remove('codicon-chevron-right')
             this.chevronEl.classList.add('codicon-chevron-down')
        }
    }

    // Autocomplete Logic
    updateSuggestions() {
        const query = this.inputEl.value.trim()
        
        if (!query) {
             this.closeSuggestions()
             return
        }

        const project = this.editor.project
        if (!project) return

        const symbols = project.symbols || []
        const suggestions = []
        const qLower = query.toLowerCase()

        // Prioritize startsWith
        const starts = []
        const contains = []

        symbols.forEach(s => {
            const name = s.name
            const lower = name.toLowerCase()
            if (lower === qLower) return // Exact match, maybe don't suggest? Or suggest on top.
            
            if (lower.startsWith(qLower)) {
                starts.push({ type: 'symbol', value: s.name, detail: s.type })
            } else if (lower.includes(qLower)) {
                 contains.push({ type: 'symbol', value: s.name, detail: s.type })
            }
        })
        
        // Sort starts alphabetically
        starts.sort((a,b) => a.value.localeCompare(b.value))
        // Sort contains alphabetically
        contains.sort((a,b) => a.value.localeCompare(b.value))

        this.renderSuggestions([...starts, ...contains])
    }

    renderSuggestions(items) {
        if (!items.length) {
            this.suggestionsEl.style.display = 'none'
            return
        }
        
        this.suggestionsEl.innerHTML = ''
        const maxItems = 20
        const visibleItems = items.slice(0, maxItems)

        visibleItems.forEach((item, index) => {
            const div = document.createElement('div')
            div.className = 'plc-device-watch-suggestion-item'
            div.dataset.index = index
            
            // Hover effect
            div.onmouseenter = () => {
                this.activeSuggestionIndex = index
                this.updateSuggestionVisuals()
            }
            
            div.innerHTML = `<span>${item.value}</span><span style="opacity:0.6; font-size: 0.9em">${item.detail || ''}</span>`
            
            div.onmousedown = (e) => { // mousedown happens before blur
                e.preventDefault()
                this.inputEl.value = item.value
                this.onWatchAdd()
                this.closeSuggestions()
            }
            
            this.suggestionsEl.appendChild(div)
        })
        
        this.suggestionsEl.style.display = 'block'
        
        // Update Position
        const rect = this.inputEl.getBoundingClientRect()
        // Account for any fixed positioning or scrolling of parent
        // Fixed positioning is safest for overlays
        this.suggestionsEl.style.top = (rect.bottom + 1) + 'px'
        this.suggestionsEl.style.left = rect.left + 'px'
        this.suggestionsEl.style.width = rect.width + 'px'

        this.suggestionItems = Array.from(this.suggestionsEl.children)
        this.activeSuggestionIndex = 0
        this.updateSuggestionVisuals()
    }

    updateSuggestionVisuals() {
        if (!this.suggestionItems) return
        this.suggestionItems.forEach((item, idx) => {
            if (idx === this.activeSuggestionIndex) {
                 item.classList.add('active')
            } else {
                 item.classList.remove('active')
            }
        })
    }

    navigateSuggestions(dir) {
        if (!this.suggestionItems || !this.suggestionItems.length) return
        
        this.activeSuggestionIndex += dir
        if (this.activeSuggestionIndex < 0) this.activeSuggestionIndex = this.suggestionItems.length - 1
        if (this.activeSuggestionIndex >= this.suggestionItems.length) this.activeSuggestionIndex = 0
        
        this.updateSuggestionVisuals()
        
        const item = this.suggestionItems[this.activeSuggestionIndex]
        item.scrollIntoView({ block: 'nearest' })
        
        // Optional: auto-fill input on navigation? Usually only on Enter.
        // this.inputEl.value = item.querySelector('span').textContent
    }

    closeSuggestions() {
        this.suggestionsEl.style.display = 'none'
        this.suggestionItems = null
    }

    // Watch List Logic

    // Helper to control opacity during pause
    setMonitoringState(isMonitoring) {
        // Clear legacy inline style if present
        this.listEl.style.opacity = ''
        
        if (isMonitoring) {
             this.listEl.classList.remove('monitoring-paused')
        } else {
             this.listEl.classList.add('monitoring-paused')
        }
    }

    onWatchAdd() {
        const value = this.inputEl.value.trim()
        if (!value) return
        
        // Avoid duplicates
        if (this.entries.some(e => e.name === value)) {
            this.inputEl.value = ''
            return
        }

        const entry = { name: value, value: '-', type: '' }
        
        // Start monitoring
        this.startMonitoring(entry)

        this.entries.push(entry)
        this._notifyChange()
        this.inputEl.value = ''
        this.renderList()
    }

    /*
    onListClick(e) {
        const btn = e.target.closest('button[data-action]')
        if (!btn) return
        
        const row = e.target.closest('.plc-device-watch-row')
        const index = +row.dataset.index
        
        const action = btn.dataset.action
        if (action === 'remove') {
            const entry = this.entries[index]
            this.stopMonitoring(entry)
            this.entries.splice(index, 1)
            this.renderList()
        }
    }
    */

    renderList() {
        this.listEl.innerHTML = ''
        
        // Register monitoring for all entries
        // Note: we might need to unregister everything first if this is a re-render
        // Ideally we do diffing or clear registry outside.
        // But since this is just a mockup for now, let's assume we manage subscriptions elsewhere or just add them.
        // Actually, we should probably unregister old ones?
        // Let's rely on the DataFetcher being smart or just update subscriptions when list changes.
        // DataFetcher manages registry.
        
        this.entries.forEach((entry, idx) => {
            const row = document.createElement('div')
            row.className = 'plc-device-watch-row'
            row.dataset.index = idx
            row.draggable = true // Enable dragging
            if (this.selectedIndex === idx) row.classList.add('selected')

            row.onclick = (e) => {
                if (e.target.closest('.plc-device-watch-type-select')) return
                this.selectedIndex = idx
                this.updateSelectionVisuals()
                this.listEl.focus()
            }
            
            row.ondblclick = () => {
                this.handleAction('edit')
            }

            // Drag Events
            row.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = "move"
                e.dataTransfer.setData("text/plain", idx)
                row.classList.add('dragging')
            })
            
            row.addEventListener('dragend', () => {
                row.classList.remove('dragging')
                this.listEl.querySelectorAll('.droptarget').forEach(el => el.classList.remove('droptarget'))
            })
            
            row.addEventListener('dragover', (e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                // Only style if valid drop target
                let target = e.target.closest('.plc-device-watch-row')
                if (target && target !== row) {
                    target.classList.add('droptarget')
                }
            })
            
            row.addEventListener('dragleave', (e) => {
                 let target = e.target.closest('.plc-device-watch-row')
                 if (target) target.classList.remove('droptarget')
            })
            
            row.addEventListener('drop', (e) => {
                e.preventDefault()
                // Find drop target row
                const targetRow = e.target.closest('.plc-device-watch-row')
                if (!targetRow) return

                const fromIdx = +e.dataTransfer.getData("text/plain")
                const toIdx = +targetRow.dataset.index
                
                if (fromIdx !== toIdx && Number.isFinite(fromIdx) && Number.isFinite(toIdx)) {
                    const item = this.entries.splice(fromIdx, 1)[0]
                    this.entries.splice(toIdx, 0, item)
                    this.renderList()
                    this.updateValues()
                }
            })

            const nameSpan = document.createElement('span')
            nameSpan.style.flex = '2'
            nameSpan.textContent = entry.name
            
            const typeSelect = document.createElement('select')
            typeSelect.className = 'plc-device-watch-type-select'
            typeSelect.style.flex = '1'
            
            Object.keys(WATCH_TYPES).forEach(t => {
                const opt = document.createElement('option')
                opt.value = t
                opt.textContent = WATCH_TYPES[t].label
                if (t === entry.type) opt.selected = true
                typeSelect.appendChild(opt)
            })
            typeSelect.onchange = () => {
                entry.type = typeSelect.value
                this.stopMonitoring(entry)
                this.startMonitoring(entry)
                this._notifyChange()
            }

            const valueSpan = document.createElement('span')
            valueSpan.className = 'plc-device-watch-value'
            valueSpan.style.flex = '2'
            valueSpan.style.fontFamily = 'Consolas, monospace'
            valueSpan.style.textAlign = 'right'
            valueSpan.style.paddingRight = '4px'
            valueSpan.textContent = typeof entry.value !== 'undefined' ? entry.value : '-'
            entry.valueEl = valueSpan
            
            row.append(nameSpan, typeSelect, valueSpan)
            this.listEl.appendChild(row)
        })
        
        this.emptyEl.style.display = this.entries.length ? 'none' : 'block'
    }

    updateSelectionVisuals() {
        if (!this.listEl) return
        const rows = this.listEl.querySelectorAll('.plc-device-watch-row')
        rows.forEach((row, idx) => {
            if (idx === this.selectedIndex) row.classList.add('selected')
            else row.classList.remove('selected')
        })
    }

    onListKeyDown(e) {
        if (this.selectedIndex === -1 && this.entries.length > 0) {
            this.selectedIndex = 0
            this.updateSelectionVisuals()
            return
        }

        const entry = this.entries[this.selectedIndex]
        if (!entry) return

        const key = e.key
        const isBit = entry.type === 'bit'

        if (key === 'ArrowDown') {
            e.preventDefault()
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.entries.length - 1)
            this.updateSelectionVisuals()
        } else if (key === 'ArrowUp') {
            e.preventDefault()
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
            this.updateSelectionVisuals()
        } else if (key === 'Delete' || (key === 'Backspace' && e.ctrlKey)) {
            e.preventDefault()
            this.handleAction('remove')
        } else if (key === 'f' && e.ctrlKey) {
            e.preventDefault()
            this.inputEl.focus()
        } else if (key === 'F2') {
            e.preventDefault()
            this.enterEditMode(this.selectedIndex)
        } else {
            let action = null
            if (isBit) {
                if (key === '1') action = 'set'
                else if (key === '0') action = 'reset'
                else if (key === 'Enter' || key === ' ') action = 'toggle'
            } else {
                if (key === 'Enter' || key === ' ') action = 'edit'
            }

            if (action) {
                e.preventDefault()
                this.handleAction(action)
            }
        }
    }

    async handleAction(action) {
        if (this.selectedIndex === -1) return
        const entry = this.entries[this.selectedIndex]
        if (!entry) return

        if (action === 'remove') {
            this.stopMonitoring(entry)
            this.entries.splice(this.selectedIndex, 1)
            this.selectedIndex = Math.min(this.selectedIndex, this.entries.length - 1)
            this._notifyChange()
            this.renderList()
            return
        }

        if (action === 'edit' || action === 'set' || action === 'reset' || action === 'toggle') {
            if (!this.editor.window_manager?.isMonitoringActive?.()) return
            const connection = this.editor.device_manager?.connection
            if (!connection) return

            const resolved = entry.resolved
            if (!resolved) return

            const isBit = entry.type === 'bit'
            const absAddress = resolved.address

            try {
                if (isBit) {
                    const bitIndex = resolved.bit
                    const mask = bitIndex !== null ? (1 << bitIndex) : 1
                    let val = 0
                    if (action === 'set') val = mask
                    else if (action === 'reset') val = 0
                    else if (action === 'toggle' || action === 'edit') {
                        const isOn = entry.value === 'ON'
                        val = isOn ? 0 : mask
                    }
                    await connection.writeMemoryAreaMasked(absAddress, [val], [mask])
                } else if (action === 'edit') {
                    const currentVal = entry.value || '0'
                    const formResult = await Popup.form({
                        title: `Edit ${entry.name}`,
                        description: `Enter new value for ${entry.name} (${entry.type})`,
                        inputs: [
                            { type: 'text', name: 'value', label: 'Value', value: String(currentVal) }
                        ],
                        buttons: [
                            { text: 'Write', value: 'confirm' },
                            { text: 'Cancel', value: 'cancel' }
                        ]
                    })

                    if (formResult && typeof formResult.value !== 'undefined') {
                        const input = String(formResult.value)
                        let num = Number(input)
                        if (!Number.isNaN(num)) {
                            const size = WATCH_TYPES[entry.type]?.size || 1
                            const type = entry.type
                            const data = []
                            
                            if (type === 'real' || type === 'float' || type === 'f32') {
                                const floatArr = new Float32Array([num])
                                const uintArr = new Uint8Array(floatArr.buffer)
                                for (let i = 0; i < size; i++) data.push(uintArr[i])
                            } else if (type === 'f64') {
                                const floatArr = new Float64Array([num])
                                const uintArr = new Uint8Array(floatArr.buffer)
                                for (let i = 0; i < size; i++) data.push(uintArr[i])
                            } else {
                                let val = BigInt(Math.floor(num))
                                for (let i = 0; i < size; i++) {
                                    data.push(Number(val & 0xFFn))
                                    val >>= 8n
                                }
                            }
                            await connection.writeMemoryArea(absAddress, data)
                        }
                    }
                }
                if (this.editor.window_manager.updateLiveMonitorState) this.editor.window_manager.updateLiveMonitorState()
            } catch (e) {
                console.error('Failed to write memory:', e)
            }
        }
    }

    updateValues() {
        // Handled by callbacks or renderList re-population
    }

    enterEditMode(index) {
        if (index < 0 || index >= this.entries.length) return
        const entry = this.entries[index]
        const rows = this.listEl.querySelectorAll('.plc-device-watch-row')
        const row = Array.from(rows).find(r => +r.dataset.index === index)
        if (!row) return

        const nameSpan = row.querySelector('span:nth-child(1)')
        if (!nameSpan) return

        const input = document.createElement('input')
        input.type = 'text'
        input.value = entry.name
        input.style.flex = '2'
        input.style.border = 'none'
        input.style.outline = '1px solid #007fd4'
        input.style.background = '#252526' // editor background
        input.style.color = 'inherit'
        input.style.fontFamily = 'inherit'
        input.style.fontSize = 'inherit'
        input.style.padding = '0 4px'
        input.onclick = (e) => e.stopPropagation() // Prevent row click issues
        
        // Replace span
        nameSpan.replaceWith(input)
        input.focus()

        const commit = () => {
            const newValue = input.value.trim()
            if (newValue && newValue !== entry.name) {
                // Check duplicate if needed? Or allow same name?
                // Ideally check duplicate but user might want to watch same address with different interpretation (if we supported that)
                // For now, let's just update.
                this.stopMonitoring(entry)
                entry.name = newValue
                this.startMonitoring(entry)
                this._notifyChange()
            }
            this.renderList() // Re-render to restore span structure
        }

        let committed = false
        input.onblur = () => {
            if (committed) return
            committed = true
            commit()
        }
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                if (committed) return
                committed = true
                commit()
            } else if (e.key === 'Escape') {
                if (committed) return
                committed = true
                this.renderList() // Revert
            }
        }
    }
    
    startMonitoring(entry) {
        if (!this.editor.data_fetcher) return
        
        const resolved = this.editor.data_fetcher.resolve(entry.name)
        if (!resolved) return
        
        // If entry.type is not set, initialize it from resolved type
        if (!entry.type) {
            entry.type = resolved.type || 'byte'
            if (entry.type === 'bool') entry.type = 'bit'
            if (!WATCH_TYPES[entry.type]) entry.type = 'byte'
        }

        const typeInfo = WATCH_TYPES[entry.type]
        const size = typeInfo ? typeInfo.size : (resolved.size || 1)
        
        entry.resolved = { ...resolved, type: entry.type, size }
        entry.update = (data) => {
            // Format value
            let val = '-'
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
            
            // Basic formatting based on type
            const LIVE_COLOR_ON = '#1fba5f'
            const LIVE_COLOR_OFF = 'rgba(200, 200, 200, 0.5)'
            let color = ''

            const type = entry.type

            if (type === 'bit') {
                 if (data.length > 0) {
                     let isOn = false
                     // Check bit
                     if (resolved.bit !== null) {
                         isOn = ((data[0] >> resolved.bit) & 1)
                     } else {
                         isOn = !!data[0]
                     }
                     val = isOn ? 'ON' : 'OFF'
                     color = isOn ? LIVE_COLOR_ON : LIVE_COLOR_OFF
                 }
            } else if (type === 'byte' || type === 'u8') {
                 val = data[0]
            } else if (type === 'i8') {
                 val = view.getInt8(0)
            } else if (type === 'int' || type === 'i16') {
                 if (data.length >= 2) val = view.getInt16(0, true)
            } else if (type === 'u16') {
                 if (data.length >= 2) val = view.getUint16(0, true)
            } else if (type === 'dint' || type === 'i32') {
                 if (data.length >= 4) val = view.getInt32(0, true)
            } else if (type === 'u32') {
                 if (data.length >= 4) val = view.getUint32(0, true)
            } else if (type === 'real') {
                 if (data.length >= 4) val = view.getFloat32(0, true).toFixed(3)
            } else if (type === 'f64') {
                 if (data.length >= 8) val = view.getFloat64(0, true).toFixed(3)
            } else {
                 // Hex fallback or similar?
                 val = Array.from(data).map(b => b.toString(16).padStart(2,'0')).join(' ')
            }
            
            if (entry.valueEl) {
                entry.valueEl.textContent = val
                if (color) entry.valueEl.style.color = color
                else entry.valueEl.style.color = ''
            }
            entry.value = val
        }
        
        this.editor.data_fetcher.register('watch', entry.resolved.address, entry.resolved.size, entry.update)
    }
    
    stopMonitoring(entry) {
        if (!this.editor.data_fetcher || !entry.resolved || !entry.update) return
        this.editor.data_fetcher.unregister('watch', entry.resolved.address, entry.resolved.size, entry.update)
    }

    refresh() {
        this.entries.forEach(e => {
            this.stopMonitoring(e)
            this.startMonitoring(e)
        })
    }
}
