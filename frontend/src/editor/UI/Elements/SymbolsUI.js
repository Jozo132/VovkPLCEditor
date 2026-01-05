import { ElementSynthesis, CSSimporter } from "../../../utils/tools.js"

const importCSS = CSSimporter(import.meta.url)
// Reuse EditorUI css for now or create new one
await importCSS('./EditorUI.css')

export default class SymbolsUI {
    id = 'symbols'
    hidden = false
    div
    header
    body
    master
    
    sortState = {
        column: null,
        direction: 'asc'
    }

    /** @param { import("../../Editor.js").VovkPLCEditor } master */
    constructor(master) {
        this.master = master
        
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
                </div>
            </div>
            <div class="plc-editor-body" style="padding: 10px; overflow: auto;">
                <div class="symbols-toolbar" style="margin-bottom: 10px;">
                    <button class="plc-btn add-symbol-btn">+ Add Symbol</button>
                    <!-- <button class="plc-btn delete-symbol-btn">Remove Selected</button> -->
                </div>
                <table class="symbols-table" style="width: 100%; border-collapse: collapse; color: var(--font-color);">
                    <thead>
                        <tr style="text-align: left; border-bottom: 1px solid #666;">
                            <th data-sort="name" style="padding: 5px; cursor: pointer; user-select: none;">Name <span class="sort-icon"></span></th>
                            <th data-sort="location" style="padding: 5px; cursor: pointer; user-select: none; width: 120px;">Location <span class="sort-icon"></span></th>
                            <th data-sort="type" style="padding: 5px; cursor: pointer; user-select: none; width: 100px;">Type <span class="sort-icon"></span></th>
                            <th data-sort="address" style="padding: 5px; cursor: pointer; user-select: none; width: 100px;">Address <span class="sort-icon"></span></th>
                            <th data-sort="initial_value" style="padding: 5px; cursor: pointer; user-select: none; width: 100px;">Initial Value <span class="sort-icon"></span></th>
                            <th data-sort="comment" style="padding: 5px; cursor: pointer; user-select: none;">Comment <span class="sort-icon"></span></th>
                            <th style="padding: 5px; width: 30px;"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- Rows -->
                    </tbody>
                </table>
            </div>
        `
        
        this.header = div.querySelector('.plc-editor-header')
        this.body = div.querySelector('.plc-editor-body')
        this.tbody = div.querySelector('tbody')
        
        div.querySelector('.add-symbol-btn').addEventListener('click', () => this.addSymbol())
        
        // Bind sort handlers
        const headers = div.querySelectorAll('th[data-sort]')
        headers.forEach(th => {
            th.addEventListener('click', () => {
                const column = th.getAttribute('data-sort')
                this.handleSort(column)
            })
        })

        this.reload()
    }

    show() {
        this.hidden = false
        this.div.style.display = 'flex'
    }

    hide() {
        this.hidden = true
        this.div.style.display = 'none'
    }
    
    close() {
        this.div.remove()
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
            
            // Numeric sort for address and initial_value
            if (column === 'address' || column === 'initial_value') {
                valA = parseFloat(valA) || 0
                valB = parseFloat(valB) || 0
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
        const symbols = this.master.project.symbols || []
        
        symbols.forEach((symbol, index) => {
            const tr = document.createElement('tr')
            tr.style.borderBottom = '1px solid #444'
            
            // Name
            tr.appendChild(this.createCell('input', symbol.name, val => symbol.name = val))

            // Location
            tr.appendChild(this.createCell('select', symbol.location, val => symbol.location = val, ['input', 'output', 'memory', 'system']))

            // Type
            tr.appendChild(this.createCell('select', symbol.type, val => symbol.type = val, ['bit', 'byte', 'int', 'float']))

            // Address
            let addressValue = symbol.address
            if (symbol.type === 'bit') {
                addressValue = (parseFloat(symbol.address) || 0).toFixed(1)
            }
            tr.appendChild(this.createCell('input', addressValue, val => symbol.address = parseFloat(val) || 0, null, 'number'))

            // Initial Value
            tr.appendChild(this.createCell('input', symbol.initial_value, val => symbol.initial_value = parseFloat(val) || 0, null, 'number'))

            // Comment
            tr.appendChild(this.createCell('input', symbol.comment, val => symbol.comment = val))

            // Delete
            const tdDel = document.createElement('td')
            const btnDel = document.createElement('button')
            btnDel.innerText = 'x'
            btnDel.style.color = '#f55'
            btnDel.style.background = 'none'
            btnDel.style.border = 'none'
            btnDel.style.cursor = 'pointer'
            btnDel.addEventListener('click', () => {
                this.master.project.symbols.splice(index, 1)
                this.renderTable()
            })
            tdDel.appendChild(btnDel)
            tr.appendChild(tdDel)

            this.tbody.appendChild(tr)
        })
    }

    createCell(type, value, onChange, options = [], inputType = 'text') {
        const td = document.createElement('td')
        td.style.padding = '5px'
        
        if (type === 'input') {
            const input = document.createElement('input')
            input.type = inputType
            input.value = value !== undefined ? value : ''
            input.style.width = '100%'
            input.style.background = '#222'
            input.style.color = '#ddd'
            input.style.border = '1px solid #555'
            input.style.padding = '4px'
            
            input.addEventListener('change', (e) => onChange(e.target.value))
            td.appendChild(input)
        } else if (type === 'select') {
            const select = document.createElement('select')
            select.style.width = '100%'
            select.style.background = '#222'
            select.style.color = '#ddd'
            select.style.border = '1px solid #555'
            select.style.padding = '4px'
            
            options.forEach(opt => {
                const option = document.createElement('option')
                option.value = opt
                option.innerText = opt
                if (opt === value) option.selected = true
                select.appendChild(option)
            })
            
            select.addEventListener('change', (e) => onChange(e.target.value))
            td.appendChild(select)
        }
        
        return td
    }

    addSymbol() {
        if (!this.master.project.symbols) this.master.project.symbols = []
        this.master.project.symbols.push({
            name: 'newItem',
            location: 'memory',
            type: 'bit',
            address: 0,
            initial_value: 0,
            comment: ''
        })
        this.renderTable()
    }
}
