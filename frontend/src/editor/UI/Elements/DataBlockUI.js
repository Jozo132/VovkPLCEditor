import { CSSimporter, evaluateNumericInput } from "../../../utils/tools.js"
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

/**
 * UI window for editing a single DataBlock.
 * Opened from the file tree when clicking an individual DB item.
 */
export default class DataBlockUI {
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
    _fetcherId = ''
    _autoConfirmWrite = false
    _inlineInput = null

    /** Device-reported DB entries: Map<db_number, { offset: number, size: number }> */
    _deviceDBEntries = new Map()

    /** Compiler-declared DB entries: Map<db_number, { computedOffset: number, totalSize: number, fields: { name: string, typeName: string, typeSize: number, offset: number }[] }> */
    _compiledDBEntries = new Map()

    /** @type {number} */
    dbNumber

    /** @type {string} */
    id

    /** @param { import("../../Editor.js").VovkPLCEditor } master */
    /** @param { number } dbNumber */
    constructor(master, dbNumber) {
        this.master = master
        this.dbNumber = dbNumber
        this.id = `db:${dbNumber}`
        this._fetcherId = `datablock-${dbNumber}-monitor`

        const div = document.createElement('div')
        div.classList.add('plc-editor', 'datablocks-editor')
        this.div = div

        const frame = master.workspace.querySelector('.plc-window-frame')
        if (!frame) throw new Error('Frame not found')
        this.frame = frame
        frame.appendChild(div)

        const db = this._getDB()
        const badge = `DB${db ? db.id : dbNumber}`
        const title = db ? `${db.name || 'DataBlock'}` : `DataBlock`

        div.innerHTML = /*HTML*/`
            <div class="plc-editor-top">
                <div class="plc-editor-header">
                    <h2 style="margin-top: 0px; margin-bottom: 3px;"><span class="plc-db-badge">${badge}</span>${this._escapeHTML(title)}</h2>
                    <p>Data Block Definition</p>
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
                    <button class="plc-btn add-field-btn">+ Add Field</button>
                </div>
            </div>
        `

        this.header = div.querySelector('.plc-editor-header')
        this.body = div.querySelector('.plc-editor-body')
        this.tbody = /** @type {HTMLTableSectionElement} */ (div.querySelector('tbody'))

        const addBtn = div.querySelector('.add-field-btn')
        if (addBtn) addBtn.addEventListener('click', () => {
            const db = this._getDB()
            if (db) this.addField(db)
        })

        this.monitor_buttons = Array.from(div.querySelectorAll('[data-monitor-toggle="true"]'))
        this.monitor_buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.master?.window_manager?.toggleMonitoringActive?.()
            })
        })
        this.updateMonitoringState(this.master?.window_manager?.isMonitoringActive?.() || false)
        this.updateMonitoringAvailability(this.master?.window_manager?.isMonitoringAvailable?.() || false)

        // Pick up existing device DB info if available
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

        // Context menu
        if (this.master.context_manager) {
            this.master.context_manager.addListener({
                target: /** @type {HTMLElement} */ (this.tbody),
                onOpen: (e, el) => {
                    // @ts-ignore
                    const tr = e.target?.closest('tr')
                    /** @type {import('../../../utils/types.js').MenuElement[]} */
                    const items = []

                    const isLive = this.monitoringActive && !!this.master?.device_manager?.connected

                    if (tr && tr.classList.contains('db-field-row')) {
                        items.push({ type: 'item', name: 'add-field-above', label: 'Add Field Above', className: `plc-icon ${getIconType('add')}`, disabled: isLive })
                        items.push({ type: 'item', name: 'add-field-below', label: 'Add Field Below', className: `plc-icon ${getIconType('add')}`, disabled: isLive })
                        items.push({ type: 'separator' })
                        items.push({ type: 'item', name: 'move-up', label: 'Move Up', disabled: isLive })
                        items.push({ type: 'item', name: 'move-down', label: 'Move Down', disabled: isLive })
                        items.push({ type: 'separator' })
                        items.push({ type: 'item', name: 'rename-field', label: 'Rename Field', disabled: isLive })
                        items.push({ type: 'item', name: 'delete-field', label: 'Delete Field', className: `plc-icon ${getIconType('delete')}`, disabled: isLive })
                    } else {
                        items.push({ type: 'item', name: 'add-field', label: 'Add Field', className: `plc-icon ${getIconType('add')}`, disabled: isLive })
                    }

                    this._ctx_tr = tr
                    return items
                },
                onClose: (action, e, el) => {
                    const db = this._getDB()
                    if (!db) return
                    const tr = this._ctx_tr
                    const fieldIdx = tr ? parseInt(tr.dataset.fieldIdx) : -1

                    if (action === 'add-field') this.addField(db)
                    else if (action === 'add-field-above' && fieldIdx >= 0) this.addField(db, fieldIdx)
                    else if (action === 'add-field-below' && fieldIdx >= 0) this.addField(db, fieldIdx + 1)
                    else if (action === 'delete-field' && fieldIdx >= 0) {
                        this._confirmDeleteField(db, fieldIdx)
                    }
                    else if (action === 'rename-field' && fieldIdx >= 0 && db.fields[fieldIdx]) {
                        const oldName = db.fields[fieldIdx].name
                        Popup.form({
                            title: `Rename Field "${oldName}"`,
                            inputs: [{ type: 'text', name: 'newName', label: 'New Name', value: oldName }],
                            buttons: [{ text: 'Rename', value: 'confirm' }, { text: 'Cancel', value: 'cancel' }]
                        }).then(result => {
                            if (!result || !result.newName || result.newName === oldName) return
                            this.master.renameDataBlockField(db.id, oldName, result.newName)
                            this.renderTable()
                        })
                    }
                    else if (action === 'move-up' && fieldIdx > 0) {
                        const [moved] = db.fields.splice(fieldIdx, 1)
                        db.fields.splice(fieldIdx - 1, 0, moved)
                        this._onDataChanged()
                        this.renderTable()
                    }
                    else if (action === 'move-down' && fieldIdx >= 0 && fieldIdx < db.fields.length - 1) {
                        const [moved] = db.fields.splice(fieldIdx, 1)
                        db.fields.splice(fieldIdx + 1, 0, moved)
                        this._onDataChanged()
                        this.renderTable()
                    }

                }
            })
        }

        this.renderTable()
    }

    _ctx_tr = null

    // ── Data access ──

    _getDB() {
        const dbs = this.master?.project?.datablocks || []
        return dbs.find(db => db.id === this.dbNumber) || null
    }

    _onDataChanged() {
        if (this.master?.project_manager?.checkAndSave) {
            this.master.project_manager.checkAndSave()
        }
        // Notify the main datablocks window to refresh if open
        const dbsWindow = this.master?.window_manager?.windows?.get('datablocks')
        if (dbsWindow && typeof dbsWindow.renderTable === 'function') {
            dbsWindow.renderTable()
        }
        this._scheduleLint()
    }

    _scheduleLint() {
        if (this._lintTimer) clearTimeout(this._lintTimer)
        this._lintTimer = setTimeout(() => {
            this._lintTimer = null
            if (typeof this.master?.lintProject === 'function') {
                this.master.lintProject()
            }
        }, 500)
    }

    _calcDBSize(db) {
        return (db.fields || []).reduce((sum, f) => sum + (TYPE_SIZES[f.type] || 1), 0)
    }

    _escapeHTML(str) {
        const div = document.createElement('div')
        div.textContent = str
        return div.innerHTML
    }

    // ── Show / Hide / Close ──

    show() {
        this.hidden = false
        this.div.style.display = 'flex'
        this._updateHeader()
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
        this._updateHeader()
        this.renderTable()
        this._registerMonitorRanges()
    }

    reloadProgram() {
        this.reload()
    }

    setLocked(locked) {
        this.locked = locked
        this.renderTable()
    }

    _updateHeader() {
        const db = this._getDB()
        if (!db) return
        const h2 = this.header?.querySelector('h2')
        if (h2) h2.innerHTML = `<span class="plc-db-badge">DB${db.id}</span>${this._escapeHTML(db.name || 'DataBlock')}`
    }

    // ── Rendering ──

    renderTable() {
        const db = this._getDB()
        this.tbody.innerHTML = ''
        this._live_cells.clear()

        if (!db) {
            const tr = document.createElement('tr')
            const td = document.createElement('td')
            td.colSpan = 7
            td.textContent = `Data block DB${this.dbNumber} not found.`
            tr.appendChild(td)
            this.tbody.appendChild(tr)
            return
        }

        if (db.fields.length === 0) {
            const tr = document.createElement('tr')
            tr.classList.add('datablocks-empty-row')
            const td = document.createElement('td')
            td.colSpan = 7
            td.textContent = 'No fields. Click "+ Add Field" or right-click to add.'
            tr.appendChild(td)
            this.tbody.appendChild(tr)
        } else {
            let fieldOffset = 0
            db.fields.forEach((field, idx) => {
                this._renderFieldRow(db, field, idx, fieldOffset)
                fieldOffset += TYPE_SIZES[field.type] || 1
            })
        }

        // Summary row
        const totalSize = this._calcDBSize(db)
        const deviceEntry = this._deviceDBEntries.get(db.id)
        const compiledEntry = this._compiledDBEntries.get(db.id)
        const effectiveOffset = deviceEntry ? deviceEntry.offset : (compiledEntry ? compiledEntry.computedOffset : null)
        const summaryTr = document.createElement('tr')
        summaryTr.classList.add('db-section-header')
        const summaryTd = document.createElement('td')
        summaryTd.colSpan = 7
        summaryTd.style.borderTop = '1px solid #333'
        summaryTd.style.paddingTop = '6px'
        const addressStr = effectiveOffset !== null ? `@${effectiveOffset}` : ''
        const sizeStr = totalSize > 0 ? `${totalSize} bytes` : '0 bytes'
        const allocStatus = deviceEntry ? '' : (compiledEntry ? ' (compiled)' : ' (not allocated on device)')
        summaryTd.innerHTML = `<span style="color: #888; font-size: 11px;">${db.fields.length} field${db.fields.length !== 1 ? 's' : ''} · ${sizeStr} ${addressStr}${allocStatus}</span>`
        summaryTr.appendChild(summaryTd)
        this.tbody.appendChild(summaryTr)
    }

    _renderFieldRow(db, field, fieldIdx, fieldOffset) {
        const tr = document.createElement('tr')
        tr.classList.add('db-field-row')
        tr.dataset.dbId = String(db.id)
        tr.dataset.fieldIdx = String(fieldIdx)

        const cellLocked = this.locked
        const isLive = this.monitoringActive && !!this.master?.device_manager?.connected

        // Offset cell
        const iconTd = document.createElement('td')
        iconTd.classList.add('col-mini')
        iconTd.style.color = '#666'
        iconTd.style.fontSize = '10px'
        iconTd.style.textAlign = 'right'
        iconTd.style.userSelect = 'none'
        iconTd.style.paddingRight = '4px'
        const deviceEntry = this._deviceDBEntries.get(db.id)
        const compiledEntry = this._compiledDBEntries.get(db.id)
        const effectiveBase = deviceEntry ? deviceEntry.offset : (compiledEntry ? compiledEntry.computedOffset : null)
        const absAddrStr = effectiveBase !== null
            ? `Absolute: @${effectiveBase + fieldOffset}${!deviceEntry && compiledEntry ? ' (compiled)' : ''}`
            : 'Not allocated on device'
        iconTd.textContent = `+${fieldOffset}`
        iconTd.title = absAddrStr
        tr.appendChild(iconTd)

        // Name cell – locked when monitoring
        const nameTd = this._createInputCell(field.name || '', (val) => {
            field.name = val.trim()
            this._onDataChanged()
            this._validateDuplicateNames(db)
        }, cellLocked || isLive)
        nameTd.classList.add('db-name-cell')
        nameTd.dataset.dbId = String(db.id)
        tr.appendChild(nameTd)

        // Mark duplicate names
        this._markDuplicateNameCell(db, field, nameTd)

        // Type cell – locked when monitoring
        const typeTd = this._createSelectCell(field.type || 'byte', DB_FIELD_TYPES, (val) => {
            field.type = val
            this._onDataChanged()
            this.renderTable()
        }, cellLocked || isLive)
        tr.appendChild(typeTd)

        // Default value cell – disabled when monitoring
        const defVal = field.defaultValue !== undefined && field.defaultValue !== null ? String(field.defaultValue) : ''
        const defTd = this._createInputCell(defVal, (val) => {
            const num = parseFloat(val)
            field.defaultValue = isNaN(num) ? val : num
            this._onDataChanged()
        }, cellLocked || isLive, 'text')
        if (isLive && !cellLocked) {
            const defInput = defTd.querySelector('input')
            if (defInput) defInput.classList.add('db-field-disabled')
        }
        tr.appendChild(defTd)

        // Live value cell – editable when monitoring & connected
        const liveTd = document.createElement('td')
        liveTd.classList.add('db-live-cell')
        if (isLive) {
            liveTd.classList.add('live-editable')
            liveTd.addEventListener('click', () => this._handleLiveCellClick(db, field, fieldOffset))
        }
        const liveKey = `DB${db.id}.${field.name}`
        this._live_cells.set(liveKey, liveTd)
        const liveData = this.live_values.get(liveKey)
        this._applyLiveCellState(liveTd, liveData)
        tr.appendChild(liveTd)

        // Comment cell – locked when monitoring
        const commentTd = this._createInputCell(field.comment || '', (val) => {
            field.comment = val
            this._onDataChanged()
        }, cellLocked || isLive)
        tr.appendChild(commentTd)

        // Delete cell – hidden when monitoring
        const delTd = document.createElement('td')
        delTd.classList.add('col-mini')
        if (!cellLocked && !isLive) {
            const delBtn = document.createElement('button')
            delBtn.classList.add('plc-btn', 'db-field-delete-btn')
            delBtn.style.padding = '0 4px'
            delBtn.style.fontSize = '11px'
            delBtn.textContent = '✕'
            delBtn.title = 'Delete field'
            delBtn.addEventListener('click', () => {
                this._confirmDeleteField(db, fieldIdx)
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
            input.addEventListener('blur', () => onChange(input.value))
        }
        td.appendChild(input)
        return td
    }

    _createSelectCell(value, options, onChange, readonly = false) {
        const td = document.createElement('td')
        const select = document.createElement('select')
        select.classList.add('db-cell-select')
        setTimeout(() => {
            select.classList.add('val-' + String(value).toLowerCase())
        }, 0)
        for (const opt of options) {
            const option = document.createElement('option')
            option.value = opt
            option.textContent = opt
            if (opt === value) option.selected = true
            select.appendChild(option)
        }
        if (readonly) {
            select.disabled = true
            select.style.opacity = '0.5'
        }
        select.addEventListener('change', () => {
            select.className = 'db-cell-select'
            select.classList.add('val-' + String(select.value).toLowerCase())
            onChange(select.value)
        })
        td.appendChild(select)
        return td
    }

    // ── Field operations ──

    addField(db, index) {
        if (this.locked) return
        if (this.monitoringActive && this.master?.device_manager?.connected) return
        if (!db) return

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

        this._onDataChanged()
        this.renderTable()

        // Focus new field name input
        setTimeout(() => {
            const rows = this.tbody.querySelectorAll('tr.db-field-row')
            const targetIdx = typeof index === 'number' ? index : db.fields.length - 1
            const row = rows[targetIdx]
            if (row) {
                const input = row.querySelector('input')
                if (input) input.focus()
            }
        }, 0)
    }

    /** Check if a single name cell should be marked as duplicate at render time */
    _markDuplicateNameCell(db, field, nameTd) {
        if (!field.name) return
        const lowerName = field.name.toLowerCase()
        const count = db.fields.filter(f => f.name && f.name.toLowerCase() === lowerName).length
        if (count > 1) nameTd.classList.add('db-name-duplicate')
    }

    /** Re-validate all name cells for a given DB (called on name change) */
    _validateDuplicateNames(db) {
        const dbId = String(db.id)
        const nameCells = this.tbody.querySelectorAll(`.db-name-cell[data-db-id="${dbId}"]`)
        const names = db.fields.map(f => (f.name || '').toLowerCase())
        nameCells.forEach((cell, idx) => {
            const name = names[idx]
            if (name && names.filter(n => n === name).length > 1) {
                cell.classList.add('db-name-duplicate')
            } else {
                cell.classList.remove('db-name-duplicate')
            }
        })
    }

    _confirmDeleteField(db, fieldIdx) {
        const field = db.fields[fieldIdx]
        if (!field) return
        const fieldRef = `DB${db.id}.${field.name}`
        // Scan for references using both the full qualified name and just the field name
        const refs = [
            ...this.master.scanReferences(fieldRef),
            ...(field.name ? this.master.scanReferences(field.name) : []),
        ]
        // Deduplicate by program+block+line
        const seen = new Set()
        const uniqueRefs = refs.filter(r => {
            const key = `${r.program}|${r.block}|${r.line || ''}|${r.x || ''}|${r.y || ''}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })

        if (uniqueRefs.length > 0) {
            let desc = `Field <b>"${fieldRef}"</b> is referenced in <b>${uniqueRefs.length}</b> place${uniqueRefs.length > 1 ? 's' : ''}:<br><br>`
            desc += '<div style="max-height:200px;overflow-y:auto;font-size:12px;background:#1a1a1a;padding:6px 8px;border-radius:4px;margin-bottom:8px;">'
            for (const ref of uniqueRefs.slice(0, 50)) {
                const loc = ref.line ? `line ${ref.line}` : ref.x !== undefined ? `${ref.x},${ref.y}` : ''
                desc += `<div style="padding:2px 0;border-bottom:1px solid #333;"><span style="color:#aaa;">${ref.program}</span> / <span style="color:#888;">${ref.block}</span>${loc ? ` : <span style="color:#666;">${loc}</span>` : ''}<br><code style="color:#555;font-size:11px;">${ref.preview}</code></div>`
            }
            if (uniqueRefs.length > 50) desc += `<div style="color:#888;padding-top:4px;">...and ${uniqueRefs.length - 50} more</div>`
            desc += '</div>'

            Popup.form({
                title: 'Delete Field',
                description: desc,
                inputs: [],
                buttons: [
                    { text: 'Delete Anyway', value: 'delete', background: '#d33', color: 'white' },
                    { text: 'Cancel', value: 'cancel' },
                ],
            }).then(result => {
                if (result !== 'delete') return
                db.fields.splice(fieldIdx, 1)
                this._onDataChanged()
                this.renderTable()
            })
        } else {
            db.fields.splice(fieldIdx, 1)
            this._onDataChanged()
            this.renderTable()
        }
    }

    // ── Live monitoring ──

    _applyLiveCellState(td, live) {
        if (!this.monitoringActive || !live) {
            td.textContent = '-'
            td.style.color = this._live_color_off
            return
        }
        if (typeof live === 'object' && live !== null) {
            td.textContent = live.text || '-'
            if (live.type === 'bit') {
                td.style.color = live.value ? this._live_color_on : this._live_color_off
            } else {
                td.style.color = this._live_color_on
            }
        } else {
            td.textContent = String(live)
            td.style.color = this._live_color_on
        }
    }

    updateLiveValues(values) {
        this.live_values = values || new Map()
        for (const [key, td] of this._live_cells) {
            // Skip updating cell if inline input is active for this cell
            if (this._inlineInput && this._inlineInput.liveKey === key) continue
            const data = this.live_values.get(key)
            this._applyLiveCellState(td, data)
        }
    }

    updateMonitoringState(active) {
        this.monitoringActive = active
        this.monitor_buttons.forEach(btn => {
            btn.classList.toggle('active', active)
        })
        // Re-render to update editable/disabled states
        this.renderTable()
        if (this.monitoringActive && !this.hidden) {
            this._registerMonitorRanges()
        } else {
            this._unregisterMonitorRanges()
        }
    }

    updateMonitoringAvailability(available) {
        this.monitoringAvailable = available
        this.monitor_buttons.forEach(btn => {
            btn.style.opacity = available ? '1' : '0.3'
            btn.title = available ? 'Toggle Live Monitoring' : 'Connect to device for live monitoring'
        })
    }

    async _handleLiveCellClick(db, field, fieldOffset) {
        const connection = this.master?.device_manager?.connection
        if (!connection) return

        const deviceEntry = this._deviceDBEntries.get(db.id)
        const compiledEntry = this._compiledDBEntries.get(db.id)
        const baseAddr = deviceEntry ? deviceEntry.offset : (compiledEntry ? compiledEntry.computedOffset : null)
        if (baseAddr === null) return

        const absAddress = baseAddr + fieldOffset
        const type = field.type || 'byte'
        const isLittleEndian = this.master?.device_manager?.deviceInfo?.isLittleEndian ?? true
        const liveKey = `DB${db.id}.${field.name}`

        try {
            if (type === 'bit') {
                // Toggle bit directly
                const live = this.live_values.get(liveKey)
                const currentVal = (typeof live === 'object' ? live?.value : live) ?? 0
                const newVal = currentVal ? 0 : 1
                await connection.writeMemoryAreaMasked(absAddress, [newVal], [1])
            } else {
                // Show inline input overlay
                const td = this._live_cells.get(liveKey)
                if (!td) return

                // Close any existing inline input
                this._closeInlineInput()

                const live = this.live_values.get(liveKey)
                const currentText = (typeof live === 'object' ? live?.text : String(live ?? 0)) || '0'

                // Create inline input
                const input = document.createElement('input')
                input.type = 'text'
                input.className = 'db-live-inline-input'
                input.value = currentText
                // Styling handled by CSS class .db-live-inline-input

                td.textContent = ''
                td.appendChild(input)
                this._inlineInput = { input, td, liveKey, field, db, type, absAddress, isLittleEndian }
                input.focus()
                input.select()

                const commitWrite = async (val) => {
                    const num = evaluateNumericInput(val, type === 'f32' ? 'float' : 'int')
                    if (Number.isNaN(num)) {
                        this._closeInlineInput()
                        return
                    }

                    if (!this._autoConfirmWrite) {
                        // Show confirmation popup
                        const result = await Popup.form({
                            title: 'Confirm Write',
                            description: `Write value <b>${num}</b> to <b>DB${db.id}.${field.name}</b> (${type})?`,
                            inputs: [
                                { type: 'checkbox', name: 'autoConfirm', label: 'Auto-confirm writes for this session', value: false }
                            ],
                            buttons: [
                                { text: 'Write', value: 'confirm', background: '#007bff', color: 'white' },
                                { text: 'Cancel', value: 'cancel' }
                            ]
                        })

                        if (!result || result === 'cancel') {
                            this._closeInlineInput()
                            return
                        }

                        if (result.autoConfirm) {
                            this._autoConfirmWrite = true
                        }
                    }

                    const size = TYPE_SIZES[type] || 1
                    const buffer = new ArrayBuffer(size)
                    const view = new DataView(buffer)

                    switch (type) {
                        case 'byte': case 'u8': view.setUint8(0, num & 0xFF); break
                        case 'i8': view.setInt8(0, num); break
                        case 'u16': view.setUint16(0, num, isLittleEndian); break
                        case 'i16': view.setInt16(0, num, isLittleEndian); break
                        case 'u32': view.setUint32(0, num >>> 0, isLittleEndian); break
                        case 'i32': view.setInt32(0, num, isLittleEndian); break
                        case 'f32': view.setFloat32(0, num, isLittleEndian); break
                        default: view.setUint8(0, num & 0xFF)
                    }

                    const data = Array.from(new Uint8Array(buffer))
                    await connection.writeMemoryArea(absAddress, data)
                    this._closeInlineInput()
                }

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault()
                        commitWrite(input.value)
                    } else if (e.key === 'Escape') {
                        e.preventDefault()
                        this._closeInlineInput()
                    }
                })

                input.addEventListener('blur', () => {
                    // Delay to allow Enter keydown to fire first
                    setTimeout(() => {
                        if (this._inlineInput?.input === input) {
                            this._closeInlineInput()
                        }
                    }, 100)
                })
            }
        } catch (err) {
            console.error(`[DataBlockUI] Failed to write DB${db.id}.${field.name}:`, err)
        }
    }

    _closeInlineInput() {
        if (!this._inlineInput) return
        const { td, liveKey } = this._inlineInput
        this._inlineInput = null
        // Re-apply live cell state
        const liveData = this.live_values.get(liveKey)
        this._applyLiveCellState(td, liveData)
    }

    _registerMonitorRanges() {
        const db = this._getDB()
        if (!db) return
        const deviceEntry = this._deviceDBEntries.get(db.id)
        const compiledEntry = this._compiledDBEntries.get(db.id)
        const baseAddr = deviceEntry ? deviceEntry.offset : (compiledEntry ? compiledEntry.computedOffset : null)
        if (baseAddr === null) return

        const fetcher = this.master?.data_fetcher
        if (!fetcher) return
        fetcher.unregisterAll(this._fetcherId)

        if (!this.monitoringActive || this.hidden) return

        const totalSize = this._calcDBSize(db)
        if (totalSize <= 0) return
        fetcher.register(this._fetcherId, baseAddr, totalSize, (data) => {
            this._processDBData(db, data, baseAddr)
        })
    }

    _unregisterMonitorRanges() {
        const fetcher = this.master?.data_fetcher
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
        for (const field of (db.fields || [])) {
            const key = `DB${db.id}.${field.name}`
            const type = field.type || 'byte'
            const size = TYPE_SIZES[type] || 1
            if (offset + size > bytes.length) break
            let value
            let text = '-'
            switch (type) {
                case 'bit': value = bytes[offset] & 1; text = value ? 'ON' : 'OFF'; break
                case 'byte':
                case 'u8': value = view.getUint8(offset); text = String(value); break
                case 'i8': value = view.getInt8(offset); text = String(value); break
                case 'u16': value = view.getUint16(offset, isLittleEndian); text = String(value); break
                case 'i16': value = view.getInt16(offset, isLittleEndian); text = String(value); break
                case 'u32': value = view.getUint32(offset, isLittleEndian); text = String(value); break
                case 'i32': value = view.getInt32(offset, isLittleEndian); text = String(value); break
                case 'f32': value = view.getFloat32(offset, isLittleEndian); text = Number.isFinite(value) ? value.toFixed(3) : String(value); break
                default: value = view.getUint8(offset); text = String(value)
            }
            this.live_values.set(key, { value, text, type, absoluteAddress: baseAddr + offset })
            offset += size
        }
        this.updateLiveValues(this.live_values)
    }

    onDataBlockInfoUpdated(entries) {
        this._deviceDBEntries.clear()
        if (entries) {
            for (const entry of entries) {
                this._deviceDBEntries.set(entry.db, { offset: entry.offset, size: entry.size })
            }
        }
        this.renderTable()
        if (!this.hidden) this._registerMonitorRanges()
    }

    /**
     * Receive compiled datablock declarations from the compiler
     * @param {{ db_number: number, alias: string, totalSize: number, computedOffset: number, fields: { name: string, typeName: string, typeSize: number, offset: number, hasDefault: boolean, defaultValue: number }[] }[]} decls
     */
    receiveCompiledDatablocks(decls) {
        this._compiledDBEntries.clear()
        if (decls?.length) {
            for (const decl of decls) {
                this._compiledDBEntries.set(decl.db_number, decl)
            }
        }
        this.renderTable()
        if (!this.hidden) this._registerMonitorRanges()
    }

    focusField(fieldName) {
        if (!fieldName || !this.tbody) return false
        const db = this._getDB()
        if (!db) return false
        const fieldIdx = db.fields.findIndex(f => f.name === fieldName)
        if (fieldIdx < 0) return false
        const rows = Array.from(this.tbody.querySelectorAll('tr.db-field-row'))
        const row = rows[fieldIdx]
        if (row) {
            const old = this.tbody.querySelector('tr.active-row')
            if (old) old.classList.remove('active-row')
            row.classList.add('active-row')
            row.scrollIntoView({ block: 'center' })
            const input = row.querySelector('input')
            if (input && !this.locked) input.focus()
            return true
        }
        return false
    }
}
