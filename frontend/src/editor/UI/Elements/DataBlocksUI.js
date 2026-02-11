import { CSSimporter } from "../../../utils/tools.js"
import { getIconType } from "./components/icons.js"
import { Popup } from "./components/popup.js"

const importCSS = CSSimporter(import.meta.url)
await importCSS('./EditorUI.css')
await importCSS('./DataBlocksUI_Color.css')

const DB_FIELD_TYPES = ['bit', 'byte', 'u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f32']

const TYPE_SIZES = {
    bit: 1, byte: 1, u8: 1, i8: 1,
    u16: 2, i16: 2,
    u32: 4, i32: 4, f32: 4,
}

export default class DataBlocksUI {
    id = 'datablocks'
    hidden = false
    div
    header
    body
    tbody
    master
    locked = false
    live_values = new Map()
    _live_cells = new Map()
    monitoringActive = false
    monitor_buttons = []
    monitoringAvailable = false
    _live_color_on = '#1fba5f'
    _live_color_off = 'rgba(200, 200, 200, 0.5)'
    _fetcherId = 'datablocks-monitor'

    /** Device-reported DB entries: Map<db_number, { offset: number, size: number }> */
    _deviceDBEntries = new Map()

    /** Compiler-declared DB entries: Map<db_number, { computedOffset: number, totalSize: number, fields: { name: string, typeName: string, typeSize: number, offset: number }[] }> */
    _compiledDBEntries = new Map()

    /** @type { Map<number, boolean> } */
    collapsedDBs = new Map()

    /** @param { import("../../Editor.js").VovkPLCEditor } master */
    constructor(master) {
        this.master = master
        this._loadCollapsedState()

        const div = document.createElement('div')
        div.classList.add('plc-editor', 'datablocks-editor')
        this.div = div

        const frame = master.workspace.querySelector('.plc-window-frame')
        if (!frame) throw new Error('Frame not found')
        this.frame = frame
        frame.appendChild(div)

        div.innerHTML = /*HTML*/`
            <div class="plc-editor-top">
                <div class="plc-editor-header">
                    <h2 style="margin-top: 0px; margin-bottom: 3px;">Data Blocks</h2>
                    <p>Structured Data Definitions</p>
                    <button class="plc-btn monitor-btn" data-monitor-toggle="true" title="Toggle Live Monitoring">
                        <span class="plc-icon plc-icon-monitor"></span>
                    </button>
                </div>
            </div>
            <div class="plc-editor-body symbols-body">
                <table class="datablocks-table symbols-table">
                    <thead>
                        <tr>
                            <th class="col-mini"></th>
                            <th class="col-name">Name</th>
                            <th class="col-type">Type</th>
                            <th class="col-init" style="min-width: 80px;">Default</th>
                            <th class="col-init" style="min-width: 80px;">Value</th>
                            <th class="col-comm">Comment</th>
                            <th class="col-mini"></th>
                        </tr>
                    </thead>
                    <tbody>
                    </tbody>
                </table>
            </div>
            <div class="plc-editor-bottom datablocks-bottom-panel">
                <div class="symbols-toolbar symbols-toolbar-panel">
                    <button class="plc-btn add-db-btn">+ Add Data Block</button>
                </div>
            </div>
        `

        this.header = div.querySelector('.plc-editor-header')
        this.body = div.querySelector('.plc-editor-body')
        this.tbody = /** @type {HTMLTableSectionElement} */ (div.querySelector('tbody'))

        this.add_button = div.querySelector('.add-db-btn')
        if (this.add_button) this.add_button.addEventListener('click', () => this.addDataBlock())

        this.monitor_buttons = Array.from(div.querySelectorAll('[data-monitor-toggle="true"]'))
        this.monitor_buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.master?.window_manager?.toggleMonitoringActive?.()
            })
        })
        this.updateMonitoringState(this.master?.window_manager?.isMonitoringActive?.() || false)
        this.updateMonitoringAvailability(this.master?.window_manager?.isMonitoringAvailable?.() || false)

        // Pick up existing device DB info if available (e.g. window opened after connect)
        const existingDbInfo = this.master?.project?.lastPhysicalDevice?.datablockInfo
        if (existingDbInfo?.entries) {
            for (const entry of existingDbInfo.entries) {
                this._deviceDBEntries.set(entry.db, { offset: entry.offset, size: entry.size })
            }
        }

        // Pick up existing compiled DB info if available
        const compiledDBs = this.master?.project?.compiledDatablocks
        if (compiledDBs?.length) {
            for (const decl of compiledDBs) {
                this._compiledDBEntries.set(decl.db_number, decl)
            }
        }

        // Global key handler
        document.addEventListener('keydown', this._handleKeyDown.bind(this))

        // Context menu
        if (this.master.context_manager) {
            this.master.context_manager.addListener({
                target: /** @type {HTMLElement} */ (this.tbody),
                onOpen: (e, el) => {
                    // @ts-ignore
                    const tr = e.target?.closest('tr')
                    /** @type {import('../../../utils/types.js').MenuElement[]} */
                    const items = []

                    if (tr && tr.classList.contains('db-field-row')) {
                        const dbId = parseInt(tr.dataset.dbId)
                        items.push({ type: 'item', name: 'add-field-above', label: 'Add Field Above', className: `plc-icon ${getIconType('add')}` })
                        items.push({ type: 'item', name: 'add-field-below', label: 'Add Field Below', className: `plc-icon ${getIconType('add')}` })
                        items.push({ type: 'separator' })
                        items.push({ type: 'item', name: 'move-up', label: 'Move Up' })
                        items.push({ type: 'item', name: 'move-down', label: 'Move Down' })
                        items.push({ type: 'separator' })
                        items.push({ type: 'item', name: 'delete-field', label: 'Delete Field', className: `plc-icon ${getIconType('delete')}` })
                    } else if (tr && tr.classList.contains('db-section-header')) {
                        const dbId = parseInt(tr.dataset.dbId)
                        items.push({ type: 'item', name: 'add-field', label: 'Add Field', className: `plc-icon ${getIconType('add')}` })
                        items.push({ type: 'separator' })
                        items.push({ type: 'item', name: 'rename-db', label: 'Rename Data Block' })
                        items.push({ type: 'item', name: 'delete-db', label: 'Delete Data Block', className: `plc-icon ${getIconType('delete')}` })
                    } else {
                        items.push({ type: 'item', name: 'add-db', label: 'Add Data Block', className: `plc-icon ${getIconType('add')}` })
                    }

                    items.push({ type: 'separator' })
                    items.push({ type: 'item', label: 'Toggle Monitor', name: 'monitor_toggle' })

                    this._ctx_tr = tr
                    return items
                },
                onClose: (key) => {
                    const tr = this._ctx_tr
                    if (!tr) {
                        if (key === 'add-db') this.addDataBlock()
                        if (key === 'monitor_toggle') this.master.window_manager.toggleMonitoringActive()
                        return
                    }

                    const dbId = parseInt(tr.dataset.dbId)
                    const fieldIdx = parseInt(tr.dataset.fieldIdx)
                    const db = this._getDataBlocks().find(d => d.id === dbId)

                    if (key === 'add-field' && db) this.addField(db)
                    if (key === 'add-field-above' && db) this.addField(db, fieldIdx)
                    if (key === 'add-field-below' && db) this.addField(db, fieldIdx + 1)
                    if (key === 'move-up' && db && fieldIdx > 0) {
                        const f = db.fields.splice(fieldIdx, 1)[0]
                        db.fields.splice(fieldIdx - 1, 0, f)
                        this.renderTable()
                    }
                    if (key === 'move-down' && db && fieldIdx < db.fields.length - 1) {
                        const f = db.fields.splice(fieldIdx, 1)[0]
                        db.fields.splice(fieldIdx + 1, 0, f)
                        this.renderTable()
                    }
                    if (key === 'delete-field' && db) {
                        db.fields.splice(fieldIdx, 1)
                        this.renderTable()
                    }
                    if (key === 'rename-db' && db) this._renameDB(db)
                    if (key === 'delete-db' && db) this._deleteDB(db)
                    if (key === 'add-db') this.addDataBlock()
                    if (key === 'monitor_toggle') this.master.window_manager.toggleMonitoringActive()
                }
            })
        }

        this.reload()
    }

    // ── Data access ──

    _getDataBlocks() {
        if (!this.master.project.datablocks) this.master.project.datablocks = []
        return this.master.project.datablocks
    }

    _nextDBId() {
        const dbs = this._getDataBlocks()
        if (!dbs.length) return 1
        return Math.max(...dbs.map(d => d.id)) + 1
    }

    // ── Collapsed state persistence ──

    _loadCollapsedState() {
        try {
            const raw = localStorage.getItem('plc-datablocks-collapsed')
            if (raw) {
                const obj = JSON.parse(raw)
                for (const [k, v] of Object.entries(obj)) {
                    this.collapsedDBs.set(Number(k), !!v)
                }
            }
        } catch { /* ignore */ }
    }

    _saveCollapsedState() {
        try {
            const obj = {}
            for (const [k, v] of this.collapsedDBs.entries()) obj[k] = v
            localStorage.setItem('plc-datablocks-collapsed', JSON.stringify(obj))
        } catch { /* ignore */ }
    }

    // ── Key handlers ──

    _handleKeyDown(e) {
        if (this.hidden) return
        if (this.locked) return
        const isInput = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)
        if (isInput) return

        if (e.key === 'Escape') {
            if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                /** @type {HTMLElement} */ (document.activeElement).blur()
            }
        }
    }

    // ── Show / Hide / Close ──

    show() {
        this.hidden = false
        this.div.style.display = 'flex'
        this._registerMonitorRanges()
        if (this.master?.window_manager?.updateLiveMonitorState) {
            this.master.window_manager.updateLiveMonitorState()
        }
    }

    hide() {
        this.hidden = true
        this.div.style.display = 'none'
        this._unregisterMonitorRanges()
        if (this.master?.window_manager?.updateLiveMonitorState) {
            this.master.window_manager.updateLiveMonitorState()
        }
    }

    close() {
        this._unregisterMonitorRanges()
        this.div.remove()
        if (this.master?.window_manager?.updateLiveMonitorState) {
            this.master.window_manager.updateLiveMonitorState()
        }
    }

    reload() {
        this.renderTable()
        this._registerMonitorRanges()
    }

    reloadProgram() {
        this.reload()
    }

    // ── Rendering ──

    renderTable() {
        const dbs = this._getDataBlocks()
        this.tbody.innerHTML = ''
        this._live_cells.clear()

        if (!dbs.length) {
            const tr = document.createElement('tr')
            tr.classList.add('datablocks-empty-row')
            const td = document.createElement('td')
            td.colSpan = 7
            td.textContent = 'No data blocks defined. Click "+ Add Data Block" to create one.'
            tr.appendChild(td)
            this.tbody.appendChild(tr)
            return
        }

        for (const db of dbs) {
            this._renderDBSection(db)
        }
    }

    _renderDBSection(db) {
        const collapsed = this.collapsedDBs.get(db.id) || false
        const chevron = collapsed ? '▶' : '▼'

        // DB header row
        const headerTr = document.createElement('tr')
        headerTr.classList.add('db-section-header')
        headerTr.dataset.dbId = String(db.id)
        if (collapsed) headerTr.classList.add('collapsed')

        const headerTd = document.createElement('td')
        headerTd.colSpan = 7

        const totalSize = this._calcDBSize(db)
        const deviceEntry = this._deviceDBEntries.get(db.id)
        const compiledEntry = this._compiledDBEntries.get(db.id)
        const effectiveOffset = deviceEntry ? deviceEntry.offset : (compiledEntry ? compiledEntry.computedOffset : null)
        const addressStr = effectiveOffset !== null ? `@${effectiveOffset}` : ''
        const sizeStr = totalSize > 0 ? `${totalSize}B` : ''
        const allocStatus = deviceEntry ? '' : (compiledEntry ? ' <span class="db-compiled-offset">(compiled)</span>' : ' <span class="db-not-allocated">(not allocated)</span>')

        const pathStr = db.path && db.path !== '/' ? `<span class="db-path">${this._escapeHTML(db.path)}/</span>` : ''

        headerTd.innerHTML = /*HTML*/`
            <span class="section-chevron">${chevron}</span>
            <span class="db-title">DB${db.id}</span>
            ${pathStr}<span class="db-name">${this._escapeHTML(db.name || '')}</span>
            <span class="db-address">${addressStr} ${sizeStr}${allocStatus}</span>
            <span class="section-count">(${db.fields.length} field${db.fields.length !== 1 ? 's' : ''})</span>
            <span class="db-header-actions">
                <button class="db-header-btn add-field-btn" title="Add field">+</button>
                <button class="db-header-btn rename-btn" title="Rename">✎</button>
                <button class="db-header-btn delete" title="Delete data block">✕</button>
            </span>
        `
        headerTr.appendChild(headerTd)

        // Header click -> toggle collapse
        headerTd.addEventListener('click', (e) => {
            // @ts-ignore
            if (e.target?.closest('.db-header-actions')) return
            this.collapsedDBs.set(db.id, !this.collapsedDBs.get(db.id))
            this._saveCollapsedState()
            this.renderTable()
        })

        // Button handlers
        /** @type {HTMLButtonElement | null} */
        const addBtn = headerTd.querySelector('.add-field-btn')
        /** @type {HTMLButtonElement | null} */
        const renameBtn = headerTd.querySelector('.rename-btn')
        /** @type {HTMLButtonElement | null} */
        const deleteBtn = headerTd.querySelector('.delete')

        if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); this.addField(db) })
        if (renameBtn) renameBtn.addEventListener('click', (e) => { e.stopPropagation(); this._renameDB(db) })
        if (deleteBtn) deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); this._deleteDB(db) })

        if (this.locked) {
            if (addBtn) addBtn.disabled = true
            if (renameBtn) renameBtn.disabled = true
            if (deleteBtn) deleteBtn.disabled = true
        }

        this.tbody.appendChild(headerTr)

        // Field rows (only if not collapsed)
        if (!collapsed) {
            if (db.fields.length === 0) {
                const emptyTr = document.createElement('tr')
                emptyTr.classList.add('datablocks-empty-row')
                const td = document.createElement('td')
                td.colSpan = 7
                td.textContent = 'No fields. Right-click or use + to add.'
                emptyTr.appendChild(td)
                this.tbody.appendChild(emptyTr)
            } else {
                let fieldOffset = 0
                db.fields.forEach((field, idx) => {
                    this._renderFieldRow(db, field, idx, fieldOffset)
                    fieldOffset += TYPE_SIZES[field.type] || 1
                })
            }
        }
    }

    _renderFieldRow(db, field, fieldIdx, fieldOffset) {
        const tr = document.createElement('tr')
        tr.classList.add('db-field-row')
        tr.dataset.dbId = String(db.id)
        tr.dataset.fieldIdx = String(fieldIdx)

        const cellLocked = this.locked

        // Icon cell - offset indicator
        const iconTd = document.createElement('td')
        iconTd.classList.add('col-mini')
        iconTd.style.color = '#666'
        iconTd.style.fontSize = '10px'
        iconTd.style.textAlign = 'right'
        iconTd.style.userSelect = 'none'
        iconTd.style.paddingRight = '4px'
        const absAddr = fieldOffset
        const deviceEntry = this._deviceDBEntries.get(db.id)
        const compiledEntry = this._compiledDBEntries.get(db.id)
        const effectiveBase = deviceEntry ? deviceEntry.offset : (compiledEntry ? compiledEntry.computedOffset : null)
        const absAddrStr = effectiveBase !== null
            ? `Absolute: @${effectiveBase + fieldOffset}${!deviceEntry && compiledEntry ? ' (compiled)' : ''}`
            : 'Not allocated on device'
        iconTd.textContent = `+${fieldOffset}`
        iconTd.title = absAddrStr
        tr.appendChild(iconTd)

        // Name cell
        const nameTd = this._createInputCell(field.name || '', (val) => {
            field.name = val.trim()
            this._onDataChanged()
        }, cellLocked)
        tr.appendChild(nameTd)

        // Type cell
        const typeTd = this._createSelectCell(field.type || 'byte', DB_FIELD_TYPES, (val) => {
            field.type = val
            this._onDataChanged()
            this.renderTable()
        }, cellLocked)
        tr.appendChild(typeTd)

        // Default value cell
        const defVal = field.defaultValue !== undefined && field.defaultValue !== null ? String(field.defaultValue) : ''
        const defTd = this._createInputCell(defVal, (val) => {
            const num = parseFloat(val)
            field.defaultValue = isNaN(num) ? val : num
            this._onDataChanged()
        }, cellLocked, 'text')
        tr.appendChild(defTd)

        // Live value cell
        const liveTd = document.createElement('td')
        liveTd.classList.add('db-live-cell')
        const liveKey = `DB${db.id}.${field.name}`
        this._live_cells.set(liveKey, liveTd)
        const liveData = this.live_values.get(liveKey)
        this._applyLiveCellState(liveTd, liveData)
        tr.appendChild(liveTd)

        // Comment cell
        const commentTd = this._createInputCell(field.comment || '', (val) => {
            field.comment = val
            this._onDataChanged()
        }, cellLocked)
        tr.appendChild(commentTd)

        // Delete cell
        const delTd = document.createElement('td')
        delTd.classList.add('col-mini')
        if (!cellLocked) {
            const delBtn = document.createElement('button')
            delBtn.classList.add('plc-btn')
            delBtn.style.padding = '0 4px'
            delBtn.style.fontSize = '11px'
            delBtn.style.color = '#888'
            delBtn.textContent = '✕'
            delBtn.title = 'Delete field'
            delBtn.addEventListener('click', () => {
                db.fields.splice(fieldIdx, 1)
                this._onDataChanged()
                this.renderTable()
            })
            delTd.appendChild(delBtn)
        }
        tr.appendChild(delTd)

        this.tbody.appendChild(tr)
    }

    // ── Cell creation helpers ──

    _createInputCell(value, onChange, readonly = false, inputType = 'text') {
        const td = document.createElement('td')
        const input = document.createElement('input')
        input.type = inputType
        input.setAttribute('autocomplete', 'off')
        input.setAttribute('name', 'db_' + Math.random().toString(36).substr(2, 9))
        input.value = value

        if (readonly) {
            input.readOnly = true
            input.disabled = true
            input.style.color = '#888'
        } else {
            input.addEventListener('change', () => onChange(input.value))
        }

        input.addEventListener('focus', () => {
            const tr = input.closest('tr')
            if (tr) {
                const old = this.tbody.querySelector('tr.active-row')
                if (old) old.classList.remove('active-row')
                tr.classList.add('active-row')
            }
        })

        td.appendChild(input)
        return td
    }

    _createSelectCell(value, options, onChange, readonly = false) {
        const td = document.createElement('td')
        const select = document.createElement('select')
        select.setAttribute('autocomplete', 'off')
        select.setAttribute('name', 'db_sel_' + Math.random().toString(36).substr(2, 9))
        select.classList.add('db-cell-select')

        setTimeout(() => {
            select.classList.add('val-' + String(value).toLowerCase())
        }, 0)

        if (readonly) {
            select.disabled = true
        }

        options.forEach(opt => {
            const option = document.createElement('option')
            option.value = opt
            option.innerText = opt
            if (opt === value) option.selected = true
            select.appendChild(option)
        })

        if (!readonly) {
            select.addEventListener('change', () => {
                select.className = 'db-cell-select'
                select.classList.add('val-' + String(select.value).toLowerCase())
                onChange(select.value)
            })
        }

        select.addEventListener('focus', () => {
            const tr = select.closest('tr')
            if (tr) {
                const old = this.tbody.querySelector('tr.active-row')
                if (old) old.classList.remove('active-row')
                tr.classList.add('active-row')
            }
        })

        td.appendChild(select)
        return td
    }

    // ── DB operations ──

    addDataBlock() {
        if (this.locked) return
        const dbs = this._getDataBlocks()

        const newDB = {
            id: this._nextDBId(),
            name: `DataBlock${dbs.length + 1}`,
            path: '/',
            fields: [],
            comment: '',
        }
        dbs.push(newDB)
        this._onDataChanged()
        this.renderTable()
    }

    addField(db, index) {
        if (this.locked) return
        if (!db) return

        // Reference previous field for default type
        let refType = 'byte'
        if (db.fields.length > 0) {
            const last = typeof index === 'number' && index > 0 ? db.fields[index - 1] : db.fields[db.fields.length - 1]
            if (last) refType = last.type
        }

        const newField = {
            name: 'field' + db.fields.length,
            type: refType,
            defaultValue: 0,
            comment: '',
        }

        if (typeof index === 'number') {
            db.fields.splice(index, 0, newField)
        } else {
            db.fields.push(newField)
        }

        // Expand the DB if collapsed
        this.collapsedDBs.set(db.id, false)
        this._saveCollapsedState()
        this._onDataChanged()
        this.renderTable()

        // Focus new field name input
        setTimeout(() => {
            const rows = this.tbody.querySelectorAll(`tr.db-field-row[data-db-id="${db.id}"]`)
            const targetIdx = typeof index === 'number' ? index : db.fields.length - 1
            const row = rows[targetIdx]
            if (row) {
                const input = row.querySelector('input')
                if (input) input.focus()
            }
        }, 0)
    }

    _renameDB(db) {
        if (this.locked) return
        Popup.form({
            title: 'Edit Data Block',
            description: `Edit DB${db.id}`,
            inputs: [
                { type: 'text', name: 'name', label: 'Name', value: db.name || '' },
                { type: 'text', name: 'path', label: 'Path', value: db.path || '/' },
            ],
            buttons: [
                { text: 'Save', value: 'save', background: '#007bff', color: 'white' },
                { text: 'Cancel', value: 'cancel' },
            ],
        }).then(result => {
            if (!result || result === 'cancel') return
            if (result.name !== undefined) db.name = result.name
            if (result.path !== undefined) {
                let p = result.path.trim() || '/'
                if (p !== '/' && !p.startsWith('/')) p = '/' + p
                if (p !== '/' && p.endsWith('/')) p = p.slice(0, -1)
                db.path = p
            }
            this._onDataChanged()
            this.renderTable()
        })
    }

    _deleteDB(db) {
        if (this.locked) return
        Popup.form({
            title: 'Delete Data Block',
            description: `Are you sure you want to delete DB${db.id} "${db.name}"?`,
            inputs: [],
            buttons: [
                { text: 'Delete', value: 'delete', background: '#d33', color: 'white' },
                { text: 'Cancel', value: 'cancel' },
            ],
        }).then(result => {
            if (result !== 'delete') return
            const dbs = this._getDataBlocks()
            const idx = dbs.indexOf(db)
            if (idx >= 0) {
                dbs.splice(idx, 1)
                this._onDataChanged()
                this.renderTable()
            }
        })
    }

    // ── Utility ──

    _calcDBSize(db) {
        let size = 0
        for (const f of db.fields) {
            size += TYPE_SIZES[f.type] || 1
        }
        return size
    }

    _escapeHTML(str) {
        const div = document.createElement('div')
        div.textContent = str
        return div.innerHTML
    }

    _onDataChanged() {
        // Trigger auto-save
        if (this.master?.project_manager?.checkAndSave) {
            this.master.project_manager.checkAndSave()
        }
        this._registerMonitorRanges()
    }

    // ── Live Monitoring ──

    _applyLiveCellState(cell, live) {
        if (!this.monitoringActive || !live) {
            cell.textContent = '-'
            cell.classList.remove('live-active')
            cell.classList.add('live-dimmed')
            return
        }
        cell.classList.remove('live-dimmed')
        cell.classList.add('live-active')
        cell.textContent = live.text || '-'
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
            this._applyLiveCellState(cell, live)
        }
    }

    updateMonitoringState(active = false) {
        this.monitoringActive = !!active
        this.monitor_buttons.forEach(btn => {
            btn.classList.toggle('active', this.monitoringActive)
        })
        if (this._live_cells) {
            for (const [name, cell] of this._live_cells.entries()) {
                const live = this.live_values.get(name)
                this._applyLiveCellState(cell, live)
            }
        }
        if (this.monitoringActive && !this.hidden) {
            this._registerMonitorRanges()
        } else {
            this._unregisterMonitorRanges()
        }
    }

    updateMonitoringAvailability(available = false) {
        this.monitoringAvailable = !!available
    }

    _registerMonitorRanges() {
        const fetcher = this.master?.window_manager?.data_fetcher
        if (!fetcher) return
        fetcher.unregisterAll(this._fetcherId)

        if (!this.monitoringActive || this.hidden) return

        const dbs = this._getDataBlocks()

        for (const db of dbs) {
            const totalSize = this._calcDBSize(db)
            if (totalSize <= 0) continue

            // Use device-reported absolute address first, fall back to compiled offset
            const deviceEntry = this._deviceDBEntries.get(db.id)
            const compiledEntry = this._compiledDBEntries.get(db.id)
            const baseAddr = deviceEntry ? deviceEntry.offset : (compiledEntry ? compiledEntry.computedOffset : null)
            if (baseAddr === null) continue // DB not allocated and not compiled, skip monitoring

            fetcher.register(this._fetcherId, baseAddr, totalSize, (data) => {
                this._processDBData(db, data, baseAddr)
            })
        }
    }

    _unregisterMonitorRanges() {
        const fetcher = this.master?.window_manager?.data_fetcher
        if (!fetcher) return
        fetcher.unregisterAll(this._fetcherId)
    }

    _processDBData(db, rawData, baseAddr) {
        let bytes
        if (rawData instanceof Uint8Array) {
            bytes = rawData
        } else if (Array.isArray(rawData)) {
            bytes = Uint8Array.from(rawData)
        } else if (rawData && rawData.buffer) {
            bytes = new Uint8Array(rawData.buffer, rawData.byteOffset || 0, rawData.byteLength || rawData.length || 0)
        }
        if (!bytes || !bytes.length) return

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const isLittleEndian = this.master?.device_manager?.deviceInfo?.isLittleEndian ?? true

        let offset = 0
        for (const field of db.fields) {
            const type = field.type || 'byte'
            const size = TYPE_SIZES[type] || 1

            if (offset + size > bytes.length) break

            let value = null
            let text = '-'

            if (type === 'bit') {
                value = bytes[offset] & 1
                text = value ? 'ON' : 'OFF'
            } else if (type === 'byte' || type === 'u8') {
                value = bytes[offset]
                text = String(value)
            } else if (type === 'i8') {
                value = view.getInt8(offset)
                text = String(value)
            } else if (type === 'u16') {
                value = view.getUint16(offset, isLittleEndian)
                text = String(value)
            } else if (type === 'i16') {
                value = view.getInt16(offset, isLittleEndian)
                text = String(value)
            } else if (type === 'u32') {
                value = view.getUint32(offset, isLittleEndian)
                text = String(value)
            } else if (type === 'i32') {
                value = view.getInt32(offset, isLittleEndian)
                text = String(value)
            } else if (type === 'f32') {
                value = view.getFloat32(offset, isLittleEndian)
                text = Number.isFinite(value) ? value.toFixed(3) : String(value)
            } else {
                value = bytes[offset]
                text = String(value)
            }

            const liveKey = `DB${db.id}.${field.name}`
            this.live_values.set(liveKey, {
                value,
                text,
                type,
                absoluteAddress: baseAddr + offset,
                timestamp: Date.now(),
            })

            const cell = this._live_cells.get(liveKey)
            if (cell) this._applyLiveCellState(cell, this.live_values.get(liveKey))

            offset += size
        }
    }

    // ── Device DB Info ──

    /**
     * Receive device-reported DataBlock info (from DA command)
     * Updates _deviceDBEntries map and refreshes display/monitoring
     * @param {{ slots: number, active: number, table_offset: number, free_space: number, lowest_address: number, entries: Array<{ db: number, offset: number, size: number }> }} dbInfo
     */
    receiveDeviceDBInfo(dbInfo) {
        this._deviceDBEntries.clear()
        if (dbInfo?.entries) {
            for (const entry of dbInfo.entries) {
                this._deviceDBEntries.set(entry.db, { offset: entry.offset, size: entry.size })
            }
        }
        // Re-render to show updated addresses
        this.renderTable()
        // Re-register monitoring ranges with correct addresses
        if (this.monitoringActive && !this.hidden) {
            this._registerMonitorRanges()
        }
    }

    /**
     * Receive compiled datablock declarations from the compiler
     * These contain absolute memory offsets computed during compilation
     * @param {{ db_number: number, alias: string, totalSize: number, computedOffset: number, fields: { name: string, typeName: string, typeSize: number, offset: number, hasDefault: boolean, defaultValue: number }[] }[]} decls
     */
    receiveCompiledDatablocks(decls) {
        this._compiledDBEntries.clear()
        if (decls?.length) {
            for (const decl of decls) {
                this._compiledDBEntries.set(decl.db_number, decl)
            }
        }
        // Re-render to show updated addresses
        this.renderTable()
        // Re-register monitoring ranges with compiled addresses
        if (this.monitoringActive && !this.hidden) {
            this._registerMonitorRanges()
        }
    }

    // ── Set locked ──

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
