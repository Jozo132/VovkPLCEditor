import { ElementSynthesis, CSSimporter } from "../../../utils/tools.js"
import { getIconType } from "./components/icons.js"

const importCSS = CSSimporter(import.meta.url)
// Reuse EditorUI css for now or create new one
await importCSS('./EditorUI.css')
await importCSS('./SymbolsUI_Color.css')

export default class SymbolsUI {
    id = 'symbols'
    hidden = false
    div
    header
    body
    master
    locked = false
    live_values = new Map()
    _live_cells = new Map()
    monitoringActive = false
    monitor_buttons = []
    monitoringAvailable = false
    _live_color_on = '#1fba5f'
    _live_color_off = 'rgba(200, 200, 200, 0.5)'
    
    selectedSymbols = new Set()
    lastFocusedIndex = -1

    sortState = {
        column: null,
        direction: 'asc'
    }
    
    // Track collapsed state for each symbol section
    collapsedSections = {
        system: true,  // Collapsed by default
        device: false,
        project: false
    }

    /** @param { import("../../Editor.js").VovkPLCEditor } master */
    constructor(master) {
        this.master = master
        
        // Load collapsed state from localStorage
        this._loadCollapsedState()
        
        const div = document.createElement('div')
        div.classList.add('plc-editor', 'symbols-editor')
        this.div = div
        
        const frame = master.workspace.querySelector('.plc-window-frame')
        if (!frame) throw new Error('Frame not found')
        this.frame = frame
        frame.appendChild(div)

        div.innerHTML = /*HTML*/`
            <div class="plc-editor-top">
                <div class="plc-editor-header">
                    <h2 style="margin-top: 0px; margin-bottom: 3px;">Symbols</h2>
                    <p>Global Variable Table</p>
                    <button class="plc-btn monitor-btn" data-monitor-toggle="true" title="Toggle Live Monitoring">
                        <span class="plc-icon plc-icon-monitor"></span>
                    </button>
                </div>
            </div>
            <div class="plc-editor-body symbols-body">
                <table class="symbols-table">
                    <thead>
                        <tr>
                            <th class="col-mini"></th>
                            <th data-sort="name" class="col-name">Name <span class="sort-icon"></span></th>
                            <th data-sort="location" class="col-loc">Location <span class="sort-icon"></span></th>
                            <th data-sort="type" class="col-type">Type <span class="sort-icon"></span></th>
                            <th data-sort="address" class="col-addr">Address <span class="sort-icon"></span></th>
                    <th data-sort="value" class="col-init">Value <span class="sort-icon"></span></th>
                            <th data-sort="comment" class="col-comm">Comment <span class="sort-icon"></span></th>
                            <th class="col-mini"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- Rows -->
                    </tbody>
                </table>
            </div>
            <div class="plc-editor-bottom symbols-bottom-panel">
                <div class="symbols-toolbar symbols-toolbar-panel">
                    <button class="plc-btn add-symbol-btn">+ Add Symbol</button>
                    <!-- <button class="plc-btn delete-symbol-btn">Remove Selected</button> -->
                </div>
            </div>
        `
        
        this.header = div.querySelector('.plc-editor-header')
        this.body = div.querySelector('.plc-editor-body')
        this.tbody = div.querySelector('tbody')
        
        this.add_button = div.querySelector('.add-symbol-btn')
        this.add_button.addEventListener('click', () => this.addSymbol())

        this.monitor_buttons = Array.from(div.querySelectorAll('[data-monitor-toggle="true"]'))
        this.monitor_buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.master?.window_manager?.toggleMonitoringActive?.()
            })
        })
        this.updateMonitoringState(this.master?.window_manager?.isMonitoringActive?.() || false)
        this.updateMonitoringAvailability(this.master?.window_manager?.isMonitoringAvailable?.() || false)
        
        // Bind sort handlers
        const headers = div.querySelectorAll('th[data-sort]')
        headers.forEach(th => {
            th.addEventListener('click', () => {
                const column = th.getAttribute('data-sort')
                this.handleSort(column)
            })
        })

        // Copy Paste handlers
        div.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'c') {
                this.copySelected()
            }
            if (e.ctrlKey && e.key === 'v') {
                // We need to handle paste via event listener on document or focused element usually?
                // But div is focusable if we set tabindex, or global listener if this tab is active.
            }
        })
        
        // Use global listener but check visibility
        document.addEventListener('keydown', this.handleKeyDown.bind(this))
        
        div.addEventListener('click', (e) => {
            // @ts-ignore
            if (!e.target.closest('.symbol-icon-cell')) {
                this.deselectAll()
            }
        })

        div.addEventListener('focusout', (e) => {
             // @ts-ignore
            if (!e.relatedTarget || !div.contains(e.relatedTarget)) {
                this.lastFocusedIndex = -1
            }
        })

        // Context Menu
        if(this.master.context_manager) {
            this.master.context_manager.addListener({
                target: this.tbody,
                onOpen: (e, el) => {
                    const tr = e.target.closest('tr')
                    let symbol = null
                    let index = -1
                    
                    if (tr) {
                        index = parseInt(tr.dataset.index)
                        if (!isNaN(index)) {
                            symbol = this.master.project.symbols[index]
                            
                            // Select if not already selected
                            if (symbol && !this.selectedSymbols.has(symbol)) {
                                 this.selectedSymbols.clear()
                                 this.selectedSymbols.add(symbol)
                                 this.renderTable()
                            }
                        }
                    }

                    const selectedCount = this.selectedSymbols.size
                    const hasSelection = selectedCount > 0
                    
                    const items = []
                    
                    if (symbol) {
                        items.push({ type: 'item', name: 'add-above', label: 'Add Symbol Above', className: `plc-icon ${getIconType('add')}` })
                        items.push({ type: 'item', name: 'add-below', label: 'Add Symbol Below', className: `plc-icon ${getIconType('add')}` })
                        items.push({ type: 'separator' })
                    } else {
                        items.push({ type: 'item', label: 'Add Symbol', name: 'add' })
                    }
                    
                    if (hasSelection) {
                         items.push({ type: 'item', name: 'copy', label: `Copy (${selectedCount})` })
                         items.push({ type: 'item', name: 'delete', label: 'Delete', className: `plc-icon ${getIconType('delete')}` })
                    }
                    
                    items.push({ type: 'separator' })
                    items.push({ type: 'item', name: 'paste', label: 'Paste' })
                    items.push({ type: 'separator' })
                    items.push({ type: 'item', label: 'Toggle Monitor', name: 'monitor_toggle' })
                    
                    this._ctx_menu_idx = index
                    this._ctx_menu_symbol = symbol

                    return items
                },
                onClose: (key) => {
                    const index = this._ctx_menu_idx
                    const symbol = this._ctx_menu_symbol
                    
                    if (key === 'add') this.addSymbol()
                    if (key === 'add-above') this.addSymbol(index)
                    if (key === 'add-below') this.addSymbol(index + 1)
                    
                    if (key === 'copy') {
                        if (symbol && this.selectedSymbols.size <= 1) {
                            this.selectedSymbols.clear()
                            this.selectedSymbols.add(symbol)
                        }
                        this.copySelected()
                    }
                    if (key === 'paste') this.pasteSymbols(index >= 0 ? index + 1 : undefined)
                    
                    if (key === 'delete') {
                         if (this.selectedSymbols.size > 0) this.deleteSelected()
                    }
                    
                    if (key === 'monitor_toggle') this.master.window_manager.toggleMonitoringActive()
                }
            })
        }

        this.reload()
    }

    handleKeyDown(e) {
        if (this.hidden) return
        if (this.locked) return
        
        if (e.key === 'Escape') {
            this.deselectAll()
            if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                // Blur if in input, but selection is cleared anyway
                document.activeElement.blur()
            }
            return
        }

        // Avoid triggering when editing text
        const isInput = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)
        if (isInput) return

        if (e.key === 'Delete') {
            this.deleteSelected()
        }

        if (e.ctrlKey && e.key === 'c') {
            this.copySelected()
        }
        if (e.ctrlKey && e.key === 'v') {
            this.pasteSymbols()
        }
    }

    deleteSelected() {
        if (this.locked) return
        if (this.selectedSymbols.size === 0) return
        
        // delete only non-readonly symbols
        this.master.project.symbols = this.master.project.symbols.filter(s => {
            if (this.selectedSymbols.has(s)) {
                return !!s.readonly
            }
            return true
        })
        this.deselectAll()
        this.renderTable()
    }
    
    deselectAll() {
        this.selectedSymbols.clear()
        if (this.tbody) {
            const rows = this.tbody.querySelectorAll('tr.selected')
            // @ts-ignore
            rows.forEach(r => r.classList.remove('selected'))
        }
    }

    async copySelected() {
        if (this.selectedSymbols.size === 0) return
        const symbols = Array.from(this.selectedSymbols)
        const json = JSON.stringify(symbols, null, 2)
        try {
            await navigator.clipboard.writeText(json)
            // console.log('Copied symbols to clipboard')
        } catch (err) {
            console.error('Failed to copy symbols: ', err)
        }
    }

    async pasteSymbols(index = undefined) {
        if (this.locked) return
        try {
            const text = await navigator.clipboard.readText()
            const symbols = JSON.parse(text)
            if (!Array.isArray(symbols)) return
            
            // Determine insertion index if not provided
            if (typeof index === 'undefined') {
                if (this.selectedSymbols.size > 0) {
                    // Find the max index of selected items
                    let maxIndex = -1
                    this.master.project.symbols.forEach((s, i) => {
                        if (this.selectedSymbols.has(s)) {
                            maxIndex = Math.max(maxIndex, i)
                        }
                    })
                    if (maxIndex !== -1) {
                        index = maxIndex + 1
                    }
                }
            }
            
            let insertIndex = typeof index !== 'undefined' ? index : this.master.project.symbols.length
            
            // Clear selection so we can select the new ones
            this.selectedSymbols.clear()
            let lastAdded = null

            symbols.forEach(s => {
                if (s.name && s.type) { // Minimal validation
                    // Ensure unique name? Or just append
                    this.master.project.symbols.splice(insertIndex, 0, s)
                    lastAdded = s
                    insertIndex++
                }
            })
            
            if (lastAdded) {
                this.selectedSymbols.add(lastAdded)
            }

            this.reload()
        } catch (err) {
            console.error('Failed to paste symbols: ', err)
        }
    }

    show() {
        this.hidden = false
        this.div.style.display = 'flex'
        if (this.master?.window_manager?.updateLiveMonitorState) {
            this.master.window_manager.updateLiveMonitorState()
        }
    }

    hide() {
        this.hidden = true
        this.div.style.display = 'none'
        if (this.master?.window_manager?.updateLiveMonitorState) {
            this.master.window_manager.updateLiveMonitorState()
        }
    }
    
    close() {
        this.div.remove()
        if (this.master?.window_manager?.updateLiveMonitorState) {
            this.master.window_manager.updateLiveMonitorState()
        }
    }

    reload() {
        this.renderTable()
    }
    
    reloadProgram() {
        this.reload()
    }

    handleSort(column) {
        if (this.sortState.column === column) {
            this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc'
        } else {
            this.sortState.column = column
            this.sortState.direction = 'asc'
        }
        this.sortSymbols()
        this.renderTable()
        this.updateSortIcons()
    }

    updateSortIcons() {
        const headers = this.div.querySelectorAll('th[data-sort]')
        headers.forEach(th => {
            const column = th.getAttribute('data-sort')
            const icon = th.querySelector('.sort-icon')
            if (!icon) return
            
            icon.textContent = ''
            if (this.sortState.column === column) {
                icon.textContent = this.sortState.direction === 'asc' ? ' ▲' : ' ▼'
            }
        })
    }

    sortSymbols() {
        if (!this.sortState.column) return
        const { column, direction } = this.sortState
        
        this.master.project.symbols.sort((a, b) => {
            let valA = a[column]
            let valB = b[column]
            
        // Numeric sort for address/value
        if (column === 'address') {
            valA = parseFloat(valA) || 0
            valB = parseFloat(valB) || 0
        } else if (column === 'value') {
            const liveA = this.live_values.get(a.name)
            const liveB = this.live_values.get(b.name)
            valA = typeof liveA?.value === 'number' ? liveA.value : -Infinity
            valB = typeof liveB?.value === 'number' ? liveB.value : -Infinity
        } else {
            valA = String(valA || '').toLowerCase()
            valB = String(valB || '').toLowerCase()
        }
            
            if (valA < valB) return direction === 'asc' ? -1 : 1
            if (valA > valB) return direction === 'asc' ? 1 : -1
            return 0
        })
    }

    renderTable() {
        if (!this.tbody) return
        this.tbody.innerHTML = ''
        this._live_cells = new Map()
        const symbols = this.master.project.symbols || []
        
        // Separate symbols into categories
        const systemSymbols = symbols.filter(s => s.readonly && !s.device)
        const deviceSymbols = symbols.filter(s => s.device)
        const projectSymbols = symbols.filter(s => !s.readonly && !s.device)
        
        // Render with section headers
        this._renderSection('System Symbols', systemSymbols, symbols, 'system')
        this._renderSection('Device Symbols', deviceSymbols, symbols, 'device')
        this._renderSection('Project Symbols', projectSymbols, symbols, 'project')
    }
    
    _renderSection(title, sectionSymbols, allSymbols, sectionType) {
        // Only hide system section when empty; always show device and project sections
        if (sectionSymbols.length === 0 && sectionType === 'system') return
        
        const isCollapsed = this.collapsedSections[sectionType] || false
        const chevron = isCollapsed ? '▶' : '▼'
        
        // Section Header Row
        const headerTr = document.createElement('tr')
        headerTr.classList.add('symbol-section-header', `section-${sectionType}`)
        if (isCollapsed) headerTr.classList.add('collapsed')
        const headerTd = document.createElement('td')
        headerTd.colSpan = 8
        headerTd.innerHTML = `<span class="section-chevron">${chevron}</span><span class="section-title">${title}</span> <span class="section-count">(${sectionSymbols.length})</span>`
        headerTr.appendChild(headerTd)
        
        // Click to toggle collapse
        headerTr.addEventListener('click', () => {
            this.collapsedSections[sectionType] = !this.collapsedSections[sectionType]
            this._saveCollapsedState()
            this.renderTable()
        })
        
        this.tbody.appendChild(headerTr)
        
        // Only render symbols if not collapsed
        if (!isCollapsed) {
            sectionSymbols.forEach((symbol) => {
                const index = allSymbols.indexOf(symbol)
                this._renderSymbolRow(symbol, index)
            })
        }
    }
    
    _loadCollapsedState() {
        try {
            const saved = localStorage.getItem('vovk_plc_symbols_collapsed')
            if (saved) {
                const parsed = JSON.parse(saved)
                if (typeof parsed === 'object') {
                    this.collapsedSections = { ...this.collapsedSections, ...parsed }
                }
            }
        } catch (e) {
            console.warn('Failed to load symbols collapsed state', e)
        }
    }
    
    _saveCollapsedState() {
        try {
            localStorage.setItem('vovk_plc_symbols_collapsed', JSON.stringify(this.collapsedSections))
        } catch (e) {
            console.warn('Failed to save symbols collapsed state', e)
        }
    }
    
    _renderSymbolRow(symbol, index) {
        if (symbol?.location === 'memory') symbol.location = 'marker'
        const tr = document.createElement('tr')
        tr.dataset.symbolName = symbol.name || ''
        tr.dataset.index = index
        if (this.selectedSymbols.has(symbol)) {
            tr.classList.add('selected')
        }
        
        // Add class based on symbol type
        if (symbol.readonly && !symbol.device) tr.classList.add('symbol-system')
        if (symbol.device) tr.classList.add('symbol-device')

        // Drag Start
        tr.draggable = true
        tr.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'copy'
            const payload = JSON.stringify({
                name: symbol.name,
                type: symbol.type
            })
            e.dataTransfer.setData('vovk-app/symbol', payload)
            e.dataTransfer.setData('text/plain', symbol.name) // Fallback
        })

        // Icon Column
        const tdIcon = document.createElement('td')
        tdIcon.classList.add('symbol-icon-cell')
        tdIcon.addEventListener('click', (e) => this.toggleSelection(symbol, e, tr))
        
        // Context Menu - Handled globally via tbody
        
        const icon = document.createElement('div')
        icon.classList.add('symbol-icon')
        // icon.textContent = '{}' 
        icon.style.width = '16px'
        icon.style.height = '16px'
        icon.style.backgroundImage = "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"%2344AA77\" d=\"M14 4h-2a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2h2v-2h-2V6h2V4zM4 12V4h6v8H4z\"/></svg>')"
        icon.style.backgroundRepeat = 'no-repeat'
        icon.style.backgroundPosition = 'center'
        tdIcon.appendChild(icon)
        tr.appendChild(tdIcon)
        
        const cellLocked = this.locked || symbol.readonly || symbol.device
        // Name
        tr.appendChild(this.createCell('input', symbol.name, val => symbol.name = val, [], 'text', cellLocked))

        // Location
        tr.appendChild(this.createCell('select', symbol.location, val => symbol.location = val, ['control', 'input', 'output', 'system', 'marker'], 'text', cellLocked))

        // Type - include explicit signed/unsigned types for device symbols
        const typeOptions = ['bit', 'byte', 'int', 'dint', 'real', 'u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f32']
        tr.appendChild(this.createCell('select', symbol.type, val => symbol.type = val, typeOptions, 'text', cellLocked))

        // Address
        let addressValue = symbol.address
        if (symbol.type === 'bit') {
            addressValue = (parseFloat(symbol.address) || 0).toFixed(1)
        }
        // Use text input to avoid locale-specific comma formatting
        tr.appendChild(this.createCell('input', addressValue, (val, inputEl) => {
            const num = parseFloat(String(val).replace(',', '.')) || 0
            symbol.address = num
            // Reformat display immediately
            if (inputEl) {
                 if (symbol.type === 'bit') {
                     inputEl.value = num.toFixed(1)
                 } else {
                     inputEl.value = num
                 }
            }
        }, null, 'text', cellLocked))

        // Live Value
        const liveCell = document.createElement('td')
        liveCell.classList.add('symbol-live-value')
        this.applyLiveCellState(liveCell, this.live_values.get(symbol.name))
        if (symbol.name) this._live_cells.set(symbol.name, liveCell)
        tr.appendChild(liveCell)

        // Comment
        tr.appendChild(this.createCell('input', symbol.comment, val => symbol.comment = val, [], 'text', cellLocked))

        // Delete
        const tdDel = document.createElement('td')
        if (!cellLocked) {
            const btnDel = document.createElement('button')
            btnDel.innerText = 'x'
            btnDel.classList.add('symbol-delete-btn')
            btnDel.addEventListener('click', () => {
                this.master.project.symbols.splice(index, 1)
                this.renderTable()
            })
            tdDel.appendChild(btnDel)
        }
        tr.appendChild(tdDel)

        this.tbody.appendChild(tr)
    }

    focusSymbol(name) {
        if (!name || !this.tbody) return false
        const symbol = (this.master.project.symbols || []).find(s => s.name === name)
        if (!symbol) return false
        this.selectedSymbols.clear()
        this.selectedSymbols.add(symbol)
        this.renderTable()
        const rows = Array.from(this.tbody.querySelectorAll('tr'))
        const row = rows.find(r => r.dataset.symbolName === name)
        if (row) {
            row.classList.add('active-row')
            row.scrollIntoView({ block: 'center' })
            const input = row.querySelector('input')
            if (input && !this.locked) input.focus()
        }
        return true
    }

    getLiveValueText(symbol) {
        if (!symbol || !symbol.name) return '-'
        const live = this.live_values.get(symbol.name)
        if (!live || typeof live.text !== 'string') return '-'
        return live.text
    }

    applyLiveCellState(cell, live) {
        if (!cell) return
        
        // Transparency when monitoring is off
        cell.style.opacity = this.monitoringActive ? '' : '0.5'
        
        if (!live || typeof live.text !== 'string') {
            cell.textContent = '-'
            cell.style.color = ''
            return
        }
        cell.textContent = live.text
        if (live.type === 'bit') {
            cell.style.color = live.value ? this._live_color_on : this._live_color_off
        } else {
            cell.style.color = ''
        }
    }

    updateLiveValues(values = new Map()) {
        this.live_values = values
        if (!this._live_cells || !this._live_cells.size) return
        for (const [name, cell] of this._live_cells.entries()) {
            const live = this.live_values.get(name)
            this.applyLiveCellState(cell, live)
        }
    }

    updateMonitoringState(active = false) {
        this.monitoringActive = !!active
        this.monitor_buttons.forEach(btn => {
            // btn.textContent = this.monitoringActive ? 'Monitoring' : 'Monitor'
            btn.classList.toggle('active', this.monitoringActive)
        })
        // Refresh cells to update opacity
        if (this._live_cells) {
            for (const [name, cell] of this._live_cells.entries()) {
                const live = this.live_values.get(name)
                this.applyLiveCellState(cell, live)
            }
        }
    }

    updateMonitoringAvailability(available = false) {
        this.monitoringAvailable = !!available
        // Keep button always enabled and visible - allow toggling even when disconnected
    }
    
    toggleSelection(symbol, event, tr) {
        if (event.ctrlKey || event.metaKey) {
            if (this.selectedSymbols.has(symbol)) {
                this.selectedSymbols.delete(symbol)
                tr.classList.remove('selected')
            } else {
                this.selectedSymbols.add(symbol)
                tr.classList.add('selected')
            }
        } else {
            // Deselect all others
            this.deselectAll()
            
            this.selectedSymbols.add(symbol)
            tr.classList.add('selected')
        }
    }

    createCell(type, value, onChange, options = [], inputType = 'text', readonly = false) {
        const td = document.createElement('td')
        
        if (type === 'input') {
            const input = document.createElement('input')
            input.type = inputType
            // Ignore for autofill
            input.setAttribute('autocomplete', 'off')
            input.setAttribute('name', 'sbl_' + Math.random().toString(36).substr(2, 9))
            
            input.value = value !== undefined ? value : ''

            if (readonly) {
                input.readOnly = true
                input.disabled = true
                input.style.color = '#888'
                // input.style.cursor = 'not-allowed'
            }
            
            if (!readonly) {
                input.addEventListener('change', (e) => onChange(e.target.value, e.target))
            }

            input.addEventListener('focus', () => {
                const tr = input.closest('tr')
                if (tr) {
                    const old = this.tbody.querySelector('tr.active-row')
                    if (old) old.classList.remove('active-row')
                    tr.classList.add('active-row')

                    this.lastFocusedIndex = Array.from(this.tbody.children).indexOf(tr)
                }
            })
            input.addEventListener('blur', () => {
                // Optional: remove if you only want it while focused
                // const tr = input.closest('tr')
                // if (tr) tr.classList.remove('active-row')
            })
            td.appendChild(input)
        } else if (type === 'select') {
            const select = document.createElement('select')
            // Ignore for autofill
            select.setAttribute('autocomplete', 'off')
            select.setAttribute('name', 'sbl_sel_' + Math.random().toString(36).substr(2, 9))
            
            // Add class for coloring
            select.classList.add('symbol-cell-select')
            // Set initial color class
            setTimeout(() => {
                 const cls = 'val-' + String(value).toLowerCase()
                 select.classList.add(cls)
            }, 0)

            if (readonly) {
                select.disabled = true
                // select.style.cursor = 'not-allowed'
            }

            options.forEach(opt => {
                const option = document.createElement('option')
                option.value = opt
                option.innerText = opt
                if (opt === value) option.selected = true
                select.appendChild(option)
            })
            
            if (!readonly) {
                select.addEventListener('change', (e) => {
                    const val = e.target.value
                    // update class for coloring
                    select.className = 'symbol-cell-select'
                    select.classList.add('val-' + String(val).toLowerCase())
                    onChange(val)
                })
            }

            select.addEventListener('focus', () => {
                const tr = select.closest('tr')
                if (tr) {
                    // Update active row class
                    const old = this.tbody.querySelector('tr.active-row')
                    if (old) old.classList.remove('active-row')
                    tr.classList.add('active-row')
                    
                    this.lastFocusedIndex = Array.from(this.tbody.children).indexOf(tr)
                }
            })
            td.appendChild(select)
        }
        
        return td
    }

    addSymbol(index = undefined) {
        if (this.locked) return
        if (!this.master.project.symbols) this.master.project.symbols = []
        
        // Infer index from selection or focus if not provided
        if (typeof index === 'undefined') {
            if (this.selectedSymbols.size > 0) {
                // Find the index of the last selected symbol
                let maxIndex = -1
                this.master.project.symbols.forEach((s, i) => {
                    if (this.selectedSymbols.has(s)) {
                        maxIndex = Math.max(maxIndex, i)
                    }
                })
                if (maxIndex !== -1) {
                    index = maxIndex + 1
                }
            } else if (this.lastFocusedIndex !== -1) {
                // Validate if index is within bounds
                if (this.lastFocusedIndex < this.master.project.symbols.length) {
                    index = this.lastFocusedIndex + 1
                }
            }
        }

        let reference = null
        // If adding at specific index
        if (typeof index !== 'undefined') {
            // Try getting symbol above (index - 1)
            if (index > 0 && this.master.project.symbols[index - 1]) {
                reference = this.master.project.symbols[index - 1]
            } else if (this.master.project.symbols[index]) {
                // Fallback to symbol below (at index, before we insert new one)
                reference = this.master.project.symbols[index]
            }
        } else {
            // Appending to end, use last symbol
            if (this.master.project.symbols.length > 0) {
                reference = this.master.project.symbols[this.master.project.symbols.length - 1]
            }
        }

        const newSymbol = {
            name: 'newItem',
            location: 'marker',
            type: 'bit',
            address: 0,
            initial_value: 0,
            comment: ''
        }
        
        if (reference) {
            newSymbol.location = reference.location
            newSymbol.type = reference.type
            
            // Auto-increment address
            const addr = parseFloat(reference.address) || 0
            if (reference.type === 'bit') {
                const byte = Math.floor(addr)
                const bit = Math.round((addr - byte) * 10)
                let newBit = bit + 1
                let newByte = byte
                if (newBit > 7) {
                    newBit = 0
                    newByte++
                }
                newSymbol.address = newByte + newBit / 10
            } else if (reference.type === 'byte') {
                newSymbol.address = addr + 1
            } else if (reference.type === 'int') {
                newSymbol.address = addr + 2
            } else if (reference.type === 'float') {
                newSymbol.address = addr + 4
            } else {
                newSymbol.address = addr + 1
            }
        }

        let insertIndex = typeof index !== 'undefined' ? index : this.master.project.symbols.length

        if (typeof index !== 'undefined') {
            this.master.project.symbols.splice(index, 0, newSymbol)
        } else {
            this.master.project.symbols.push(newSymbol)
        }
        
        this.renderTable()
        
        // Focus name field
        setTimeout(() => {
            const rows = this.tbody.querySelectorAll('tr')
            const row = rows[insertIndex]
            if (row) {
                const input = row.querySelector('input') // Name is first input
                if (input) {
                    input.focus()
                    // input.select() // Optional: select text
                }
            }
        }, 0)
    }

    setLocked(locked = true) {
        this.locked = !!locked
        if (this.add_button) {
            if (this.locked) {
                this.add_button.setAttribute('disabled', 'disabled')
            } else {
                this.add_button.removeAttribute('disabled')
            }
        }
        this.renderTable()
    }
}
