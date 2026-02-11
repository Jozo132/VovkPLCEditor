import { ElementSynthesis, CSSimporter, readTypedValue, evaluateNumericInput } from "../../../utils/tools.js"
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
    'str8':  { size: 0, label: 'STR8', isString: true, headerSize: 2 },   // [capacity:u8, length:u8, data...]
    'str16': { size: 0, label: 'STR16', isString: true, headerSize: 4 },  // [capacity:u16, length:u16, data...]
    'cstr8': { size: 0, label: 'CSTR8', isString: true, headerSize: 2, isConst: true },
    'cstr16':{ size: 0, label: 'CSTR16', isString: true, headerSize: 4, isConst: true },
}

export default class WatchPanel {
    active_device = 'simulation'
    entries = []
    STORAGE_KEY = 'vovk_plc_watch_values'
    _saveTimeout = null

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
        
        // Restore last values from localStorage
        this.restoreValues()
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
        
        // Restore last values from localStorage
        this.restoreValues()
        
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
                        // Check if this watch entry matches a project symbol
                        const entry = this.entries[idx]
                        if (entry) {
                            const symbols = this.editor.project?.symbols || []
                            const sym = symbols.find(s => s.name === entry.name && !s.readonly && !s.device)
                            if (sym) {
                                items.push({ type: 'separator' })
                                items.push({ type: 'item', label: 'Rename Symbol', name: 'rename', icon: 'edit' })
                            }
                        }
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
                    if (key === 'rename' && this.activeActionIndex !== undefined) {
                        const entry = this.entries[this.activeActionIndex]
                        if (entry) {
                            const oldName = entry.name
                            Popup.form({
                                title: 'Rename Symbol',
                                description: `Rename "${oldName}" across the entire project`,
                                inputs: [{ type: 'text', name: 'newName', label: 'New Name', value: oldName }],
                                buttons: [{ text: 'Rename', value: 'rename', background: '#007bff', color: 'white' }, { text: 'Cancel', value: 'cancel' }],
                            }).then(result => {
                                if (!result || !result.newName || result.newName === oldName) return
                                const res = this.editor.renameSymbol(oldName, result.newName)
                                if (!res.success) {
                                    new Popup({ title: 'Rename Failed', description: res.message, buttons: [{ text: 'OK', value: 'ok' }] })
                                }
                            })
                        }
                    }
                }
            })
        }

        // Handle Symbol Drops on the panel
        element.addEventListener('dragover', (e) => {
            if (e.dataTransfer.types.includes('vovk-app/symbol')) {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                element.classList.add('drag-over')
            }
        })
        
        element.addEventListener('dragleave', (e) => {
            element.classList.remove('drag-over')
        })
        
        element.addEventListener('drop', (e) => {
            element.classList.remove('drag-over')
            const data = e.dataTransfer.getData('vovk-app/symbol')
            if (data) {
                e.preventDefault()
                try {
                    const item = JSON.parse(data)
                    this.addEntry(item.name, item.type)
                } catch(e) {}
            }
        })
        
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
    
    addEntry(name, type = '') {
        const value = name ? name.trim() : ''
        if (!value) return
        
        if (this.entries.some(e => e.name === value)) return

        const entry = { name: value, value: '-', type: type }
        this.startMonitoring(entry)
        this.entries.push(entry)
        this._notifyChange()
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
                if (e.dataTransfer.types.includes('vovk-app/symbol')) return

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
                if (e.dataTransfer.types.includes('vovk-app/symbol')) return

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
                    const typeInfo = WATCH_TYPES[entry.type]
                    
                    // Check if this is a const string (not writable)
                    if (typeInfo?.isConst) {
                        await Popup.alert({ title: 'Cannot Edit', description: 'Constant strings are read-only.' })
                        return
                    }
                    
                    const currentVal = entry.value || '0'
                    const isString = typeInfo?.isString
                    
                    const formResult = await Popup.form({
                        title: `Edit ${entry.name}`,
                        description: isString 
                            ? `Enter new string value for ${entry.name} (${entry.type})`
                            : `Enter new value for ${entry.name} (${entry.type})`,
                        inputs: [
                            { type: 'text', name: 'value', label: 'Value', value: isString ? currentVal.replace(/^"|"$/g, '') : String(currentVal) }
                        ],
                        buttons: [
                            { text: 'Write', value: 'confirm' },
                            { text: 'Cancel', value: 'cancel' }
                        ]
                    })

                    if (formResult && typeof formResult.value !== 'undefined') {
                        const input = String(formResult.value)
                        
                        if (isString) {
                            // String write: need to read current capacity, then write [capacity, new_length, new_data...]
                            const isLittleEndian = this.editor.device_manager?.deviceInfo?.isLittleEndian ?? true
                            const headerSize = typeInfo.headerSize
                            const is16Bit = entry.type === 'str16'
                            
                            // Encode the string to UTF-8
                            const encoder = new TextEncoder()
                            const strBytes = encoder.encode(input)
                            
                            // Read current capacity from device
                            const headerData = await connection.readMemoryArea(absAddress, headerSize)
                            const headerView = new DataView(new Uint8Array(headerData).buffer)
                            const capacity = is16Bit ? headerView.getUint16(0, isLittleEndian) : headerData[0]
                            
                            // Truncate string if it exceeds capacity
                            const length = Math.min(strBytes.length, capacity)
                            const truncatedBytes = strBytes.slice(0, length)
                            
                            // Build the data to write: [capacity, length, data...]
                            const buffer = new ArrayBuffer(headerSize + length)
                            const view = new DataView(buffer)
                            const byteArray = new Uint8Array(buffer)
                            
                            if (is16Bit) {
                                view.setUint16(0, capacity, isLittleEndian)
                                view.setUint16(2, length, isLittleEndian)
                            } else {
                                byteArray[0] = capacity
                                byteArray[1] = length
                            }
                            
                            // Copy string data
                            byteArray.set(truncatedBytes, headerSize)
                            
                            await connection.writeMemoryArea(absAddress, Array.from(byteArray))
                        } else {
                            const isFloatType = entry.type === 'real' || entry.type === 'float' || entry.type === 'f32' || entry.type === 'f64'
                            let num = evaluateNumericInput(input, isFloatType ? 'float' : 'int')
                            if (!Number.isNaN(num)) {
                                const size = typeInfo?.size || 1
                                const type = entry.type
                                
                                // Use device endianness for writes
                                const isLittleEndian = this.editor.device_manager?.deviceInfo?.isLittleEndian ?? true
                                const buffer = new ArrayBuffer(size)
                                const view = new DataView(buffer)
                                
                                if (type === 'real' || type === 'float' || type === 'f32') {
                                    view.setFloat32(0, num, isLittleEndian)
                                } else if (type === 'f64') {
                                    view.setFloat64(0, num, isLittleEndian)
                                } else if (type === 'int' || type === 'i16') {
                                    view.setInt16(0, num, isLittleEndian)
                                } else if (type === 'u16') {
                                    view.setUint16(0, num, isLittleEndian)
                                } else if (type === 'dint' || type === 'i32') {
                                    view.setInt32(0, num, isLittleEndian)
                                } else if (type === 'u32') {
                                    view.setUint32(0, num, isLittleEndian)
                                } else if (type === 'i8') {
                                    view.setInt8(0, num)
                                } else {
                                    // byte/u8 - single byte, no endianness
                                    view.setUint8(0, num & 0xFF)
                                }
                                
                                const data = Array.from(new Uint8Array(buffer))
                                await connection.writeMemoryArea(absAddress, data)
                            }
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
        let size = typeInfo ? typeInfo.size : (resolved.size || 1)
        
        // For string types, read a reasonable max size (header + max string content)
        // str8: [capacity:u8, length:u8] + data (max 254 bytes) = 256 bytes max
        // str16: [capacity:u16, length:u16] + data (max 65534 bytes) = we limit to reasonable amount
        if (typeInfo?.isString) {
            if (entry.type === 'str8' || entry.type === 'cstr8') {
                size = 256 // header (2) + max data (254)
            } else {
                size = 260 // header (4) + reasonable display amount (256)
            }
        }
        
        entry.resolved = { ...resolved, type: entry.type, size }
        entry.update = (data) => {
            // Format value
            let val = '-'
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
            
            // Get device endianness (default to little-endian if unknown)
            const isLittleEndian = this.editor.device_manager?.deviceInfo?.isLittleEndian ?? true
            
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
                 if (data.length >= 2) val = view.getInt16(0, isLittleEndian)
            } else if (type === 'u16') {
                 if (data.length >= 2) val = view.getUint16(0, isLittleEndian)
            } else if (type === 'dint' || type === 'i32') {
                 if (data.length >= 4) val = view.getInt32(0, isLittleEndian)
            } else if (type === 'u32') {
                 if (data.length >= 4) val = view.getUint32(0, isLittleEndian)
            } else if (type === 'real') {
                 if (data.length >= 4) val = view.getFloat32(0, isLittleEndian).toFixed(3)
            } else if (type === 'f64') {
                 if (data.length >= 8) val = view.getFloat64(0, isLittleEndian).toFixed(3)
            } else if (type === 'str8' || type === 'cstr8') {
                 // str8 format: [capacity:u8, length:u8, data...]
                 if (data.length >= 2) {
                     const capacity = data[0]
                     const length = Math.min(data[1], capacity, data.length - 2)
                     const strBytes = data.slice(2, 2 + length)
                     try {
                         val = `"${new TextDecoder('utf-8', { fatal: false }).decode(strBytes)}"`
                     } catch {
                         val = `"${String.fromCharCode(...strBytes)}"`
                     }
                 }
            } else if (type === 'str16' || type === 'cstr16') {
                 // str16 format: [capacity:u16, length:u16, data...]
                 if (data.length >= 4) {
                     const capacity = view.getUint16(0, isLittleEndian)
                     const length = Math.min(view.getUint16(2, isLittleEndian), capacity, data.length - 4)
                     const strBytes = data.slice(4, 4 + length)
                     try {
                         val = `"${new TextDecoder('utf-8', { fatal: false }).decode(strBytes)}"`
                     } catch {
                         val = `"${String.fromCharCode(...strBytes)}"`
                     }
                 }
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
            
            // Save value to localStorage (debounced)
            this.debounceSaveValues()
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
    
    /**
     * Get project identifier for localStorage key
     */
    getProjectKey() {
        // Use project name if available, otherwise use a default key
        const projectName = this.editor.project?.info?.name || 'default_project'
        return `${this.STORAGE_KEY}_${projectName}`
    }
    
    /**
     * Debounced save to avoid excessive localStorage writes
     */
    debounceSaveValues() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout)
        }
        this._saveTimeout = setTimeout(() => {
            this.saveValues()
            this._saveTimeout = null
        }, 1000) // Save 1 second after last update
    }
    
    /**
     * Save watch values to localStorage
     */
    saveValues() {
        try {
            const data = {}
            this.entries.forEach(entry => {
                if (entry.name && entry.value !== '-') {
                    data[entry.name] = {
                        value: entry.value,
                        type: entry.type,
                        timestamp: Date.now()
                    }
                }
            })
            localStorage.setItem(this.getProjectKey(), JSON.stringify(data))
        } catch (e) {
            console.warn('[WatchPanel] Failed to save values to localStorage', e)
        }
    }
    
    /**
     * Restore watch values from localStorage
     */
    restoreValues() {
        try {
            const saved = localStorage.getItem(this.getProjectKey())
            if (!saved) return
            
            const data = JSON.parse(saved)
            this.entries.forEach(entry => {
                const savedEntry = data[entry.name]
                if (savedEntry && savedEntry.value !== undefined) {
                    entry.value = savedEntry.value
                    // Restore type if it was manually overridden
                    if (savedEntry.type && !entry.type) {
                        entry.type = savedEntry.type
                    }
                    // Update UI if element exists
                    if (entry.valueEl) {
                        entry.valueEl.textContent = entry.value
                    }
                }
            })
        } catch (e) {
            console.warn('[WatchPanel] Failed to restore values from localStorage', e)
        }
    }
}
