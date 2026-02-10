import { ElementSynthesis, ElementSynthesisMany, CSSimporter } from "../../../utils/tools.js"
import { PLC_Program, PLC_ProgramBlock, PLCEditor } from "../../../utils/types.js"
import { getIconType, getThumbnailDataUrl } from "./components/icons.js"
import { Popup } from "./components/popup.js"
import { toGraph } from "../../../languages/ladder/language.js"
import {CanvasCodeEditor} from "../../../languages/CanvasCodeEditor.js"

const SHORT_NAMES = {
    ladder: 'LAD',
    asm: 'ASM',
    stl: 'STL',
    st: 'ST',
    plcscript: 'PSC',
}

/** @param {string} type @returns {string} */
const shortName = (type) => SHORT_NAMES[(type || '').toLowerCase()] || (type || '???').toUpperCase().substring(0, 3)


const importCSS = CSSimporter(import.meta.url)

await importCSS('./EditorUI.css')

export default class EditorUI {
    id
    hidden = false
    name = ''
    comment = ''
    div
    header
    body
    /** @type { Element | null } */ frame
    /** @type { HTMLCanvasElement } */ canvas
    master
    monitor_button
    monitoringActive = false
    monitoringAvailable = false
    /** @type { PLC_Program | null } */ program = null
    /** @param { PLCEditor } master * @param { string } id */
    constructor(master, id) {
        if (!master) throw new Error('Editor not found')
        if (!id) throw new Error('ID not found')
        this.master = master
        this.id = id
        const div = document.createElement('div')
        div.classList.add('plc-editor')
        this.div = div
        // master.workspace.appendChild(div)
        this.frame = master.workspace.querySelector('.plc-window-frame')
        if (!this.frame) throw new Error('Frame not found')
        this.frame.appendChild(div)
        const content = ElementSynthesisMany(/*HTML*/`
            <div class="plc-editor-top">
                <div class="plc-editor-header"></div>
            </div>
            <div class="plc-editor-body"></div>
        `)
        const header = content[0].querySelector('.plc-editor-header')
        const body = content[1]
        if (!header) throw new Error('Header not found')
        if (!body) throw new Error('Body not found')
        this.header = header
        this.body = body
        this._lastBodyScrollTop = 0
        this.body.addEventListener('scroll', () => {
            this._lastBodyScrollTop = this.body.scrollTop
            if (this.program) {
                this.program.scrollTop = this.body.scrollTop
            }
        })
        content.forEach(c => div.appendChild(c))
        this.master.context_manager.addListener({
            target: this.div,
            onOpen: (event) => {
                // @ts-ignore
                const target = event.target
                const blockDiv = target.closest('.plc-program-block')
                const blockIndex = blockDiv ? this.program.blocks.findIndex(b => b.div === blockDiv) : -1
                this._contextTargetIndex = blockIndex

                let items = []
                const isMonitoring = this.monitoringActive

                if (blockIndex !== -1) {
                    items.push(
                        { type: 'item', name: 'add_above', label: 'Add Block Above', className: `plc-icon ${getIconType('add')}`, disabled: isMonitoring },
                        { type: 'item', name: 'add_below', label: 'Add Block Below', className: `plc-icon ${getIconType('add')}`, disabled: isMonitoring },
                    )
                } else {
                    items.push(
                        { type: 'item', name: 'add_block', label: 'Add Block', className: `plc-icon ${getIconType('add')}`, disabled: isMonitoring },
                    )
                }

                items.push(
                    { type: 'separator' },
                    { type: 'item', name: 'edit', label: 'Edit' },
                    { type: 'item', name: 'delete', label: 'Delete', disabled: isMonitoring },
                    { type: 'separator' },
                    { type: 'item', name: 'copy', label: 'Copy' },
                    { type: 'item', name: 'paste', label: 'Paste', disabled: isMonitoring },
                )

                // Add "View Logic as ..." options for compilable blocks
                if (blockIndex !== -1) {
                    const block = this.program.blocks[blockIndex]
                    if (block) {
                        const viewItems = []
                        if (block.type === 'ladder') {
                            viewItems.push(
                                { type: 'item', name: 'view_graph', label: 'View Logic as Ladder Graph' },
                                { type: 'item', name: 'view_stl', label: 'View Logic as STL' },
                                { type: 'item', name: 'view_asm', label: 'View Logic as PLCASM' },
                            )
                        } else if (block.type === 'stl') {
                            viewItems.push(
                                { type: 'item', name: 'view_asm', label: 'View Compiled PLCASM' },
                            )
                        } else if (block.type === 'st') {
                            viewItems.push(
                                { type: 'item', name: 'view_plcscript', label: 'View Compiled PLCScript' },
                                { type: 'item', name: 'view_asm', label: 'View Compiled PLCASM' },
                            )
                        } else if (block.type === 'plcscript') {
                            viewItems.push(
                                { type: 'item', name: 'view_asm', label: 'View Compiled PLCASM' },
                            )
                        }
                        if (viewItems.length > 0) {
                            items.push({ type: 'separator' }, ...viewItems)
                        }
                    }
                }

                return items
            },
            onClose: async (selected) => {
                // console.log(`Editor selected: ${selected}`)
                if (selected === 'add_block') this.addBlock()
                if (selected === 'add_above') this.addBlock(this._contextTargetIndex)
                if (selected === 'add_below') this.addBlock(this._contextTargetIndex + 1)
                if (selected === 'delete') this.deleteBlock(this._contextTargetIndex)
                if (selected === 'edit') this.editBlock(this._contextTargetIndex)

                // Handle "View Logic as ..." actions
                if (['view_graph', 'view_stl', 'view_plcscript', 'view_asm'].includes(selected)) {
                    const block = this.program?.blocks?.[this._contextTargetIndex]
                    if (block) {
                        await this._showCompiledLogic(block, selected)
                    }
                }
            }
        })
        this.reloadProgram()
    }

    appendChild(child) {
        this.body.appendChild(child)
    }

    reloadProgram() {
        this.program = this.master.findProgram(this.id)
        if (!this.program) throw new Error(`Program not found: ${this.id}`)
        this.name = this.program.name
        this.comment = this.program.comment
        this.renderHeader()
        this.draw()
    }

    updateMonitoringState(active = false) {
        this.monitoringActive = !!active
        if (!this.monitor_button) return
        this.monitor_button.classList.toggle('active', this.monitoringActive)
        
        if (this.live_edit_button) {
            this.live_edit_button.style.display = this.monitoringActive ? '' : 'none'
        }

        // Notify blocks to update pills
        if (this.program && this.program.blocks) {
             this.program.blocks.forEach(block => {
                 const editor = block.props?.text_editor
                 if (editor && typeof editor.updateDecorations === 'function') {
                     editor.updateDecorations()
                 }
             })
        }
    }

    updateLiveEditState(enabled) {
        if (!this.live_edit_button) return
        const iconLockClosed = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>`
        const iconLockOpen = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1a2 2 0 0 0-2 2v4a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h5V3a3 3 0 0 1 6 0v4a.5.5 0 0 1-1 0V3a2 2 0 0 0-2-2z"/></svg>`
        
        this.live_edit_button.innerHTML = enabled ? iconLockOpen : iconLockClosed
        this.live_edit_button.classList.toggle('active', enabled)
        this.live_edit_button.style.color = enabled ? '#4ec9b0' : ''
    }

    updateMonitoringAvailability(available = false) {
        this.monitoringAvailable = !!available
        if (!this.monitor_button) return
        this.monitor_button.style.display = this.monitoringAvailable ? '' : 'none'
        // The lock button visibility is controlled by updateMonitoringState, not availability
        // But if monitoring is not available, we should hide it
        if (!this.monitoringAvailable) {
            this.updateMonitoringState(false)
        }
    }

    renderHeader() {
        this.header.innerHTML = /*HTML*/`
            <h2 style="margin-top: 0px; margin-bottom: 3px;">Program: ${this.name || ''}</h2>
            <p>${this.comment || ''}</p>
        `

        // Container for right-aligned controls
        const controlsContainer = document.createElement('div')
        controlsContainer.style.display = 'flex'
        controlsContainer.style.marginLeft = 'auto' // Push to right
        controlsContainer.style.alignItems = 'center'
        controlsContainer.style.gap = '5px' 
        controlsContainer.style.height = '100%'

        const LOCK_SIZE = '22px' // Approximate button height

        // Live Edit Lock Button
        const lockBtn = document.createElement('button')
        lockBtn.className = 'plc-btn monitor-lock-btn'
        lockBtn.style.padding = '0'
        lockBtn.style.display = 'none' 
        lockBtn.style.justifyContent = 'center'
        lockBtn.style.alignItems = 'center'
        lockBtn.style.width = LOCK_SIZE
        lockBtn.style.height = LOCK_SIZE
        lockBtn.style.minHeight = LOCK_SIZE // Force square
        lockBtn.style.minWidth = LOCK_SIZE  // Force square
        // Make it look like a toggle
        lockBtn.style.backgroundColor = 'transparent'
        lockBtn.style.border = '1px solid transparent'
        lockBtn.style.color = '#ccc'
        
        lockBtn.title = 'Live Edit (Unlock editing while monitoring)'
        const iconLockClosed = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>`
        lockBtn.innerHTML = iconLockClosed
        lockBtn.onclick = () => {
             this.master?.window_manager?.toggleLiveEdit?.()
        }
        this.live_edit_button = lockBtn

        // Monitor Button
        const monitorBtn = document.createElement('button')
        monitorBtn.classList.add('plc-btn', 'monitor-btn')
        monitorBtn.setAttribute('data-monitor-toggle', 'true')
        monitorBtn.setAttribute('title', 'Toggle Live Monitoring')
        monitorBtn.style.height = LOCK_SIZE // Match height
        monitorBtn.style.display = 'flex' // Ensure flex box for text alignment if needed
        monitorBtn.style.alignItems = 'center'
        monitorBtn.style.justifyContent = 'center'
        monitorBtn.style.marginLeft = '0' // Reset margin since it's in container
        
        const monitorIcon = document.createElement('span')
        monitorIcon.className = 'plc-icon plc-icon-monitor'
        monitorBtn.appendChild(monitorIcon)
        
        monitorBtn.addEventListener('click', () => {
            this.master?.window_manager?.toggleMonitoringActive?.()
        })
        
        controlsContainer.appendChild(lockBtn)
        controlsContainer.appendChild(monitorBtn)
        this.header.appendChild(controlsContainer)

        this.monitor_button = monitorBtn
        
        // Wait, renderHeader replaces innerHTML. 
        // Let's rewrite the block to be cleaner.

        this.monitor_button = monitorBtn
        this.updateMonitoringState(this.master?.window_manager?.isMonitoringActive?.() || false)
        this.updateMonitoringAvailability(this.master?.window_manager?.isMonitoringAvailable?.() || false)
        if (this.master?.window_manager) {
             this.updateLiveEditState(this.master.window_manager._liveEditEnabled)
        }
    }

    draw() {
        const linked = !!this.program
        this.program = this.program || this.master.findProgram(this.id)
        if (!this.program) return //throw new Error(`Program not found -> ${this.id}`)
        if (!linked || this.program.host !== this) {
            this.program.host = this
        }
        if (this.hidden) return
        const { id, name, comment } = this.program
        if (this.name !== name || this.comment !== comment) {
            this.name = name
            this.comment = comment
            this.renderHeader()
        }
        // draw_program(this.master, this.program)

        if (!this.program.blocks || this.program.blocks.length === 0) {
            this.body.innerHTML = '<p>No blocks. Add blocks to start programming.</p>'
            return
        }
        
        // Remove "No blocks" message if present
        if (this.body.querySelector('p') && this.body.firstChild.textContent.startsWith('No blocks')) {
             this.body.innerHTML = ''
        }

        const programId = this.program?.id
        this.program.blocks.forEach(block => {
            if (!block) return
            block.programId = programId
            if (!block.id) block.id = this.master._generateID(block.id)
            const { id, type, name, comment } = block
            if (!block.div) {
                block.div = ElementSynthesis(/*HTML*/`
                    <div class="plc-program-block">
                        <div class="plc-program-block-header" draggable="true">
                            <div class="plc-program-block-header-content">
                                <div class="plc-program-block-header-title">
                                    <div class="plc-program-block-header-icon">
                                        ${shortName(type)}
                                    </div>
                                    <div class="plc-program-block-title">${name || ''}</div>
                                    <p class="plc-comment-simple">${comment || ''}</p>
                                </div>
                                <div class="plc-program-block-header-buttons">
                                    <!--div class="menu-button delete">x</div-->
                                    <!--div class="menu-button edit">/</div-->
                                    <div class="menu-button minimize">${block.minimized ? '+' : '-'}</div>
                                </div>
                            </div>
                            <p class="plc-comment-detailed">${comment || ''}</p>
                        </div>
                        <div class="plc-program-block-container">
                            <div class="plc-program-block-code">
                            </div>
                        </div>
                    </div>
                `)
                // this.body.appendChild(block.div) // Deferred to ensure order
                
                if (block.minimized) {
                    block.div.classList.add('minimized')
                }
                
                const minimize_button = block.div.querySelector('.minimize')
                const header = block.div.querySelector('.plc-program-block-header')

                if (!minimize_button) throw new Error('Minimize button not found')
                if (!header) throw new Error('Header not found')

                let clickTimeout = null

                const toggleMinimize = () => {
                     const is_minimized = block.div.classList.contains('minimized')
                     if (is_minimized) block.div.classList.remove('minimized')
                     else block.div.classList.add('minimized')
                     
                     block.minimized = !is_minimized
                     minimize_button.innerText = !is_minimized ? '+' : '-'
                }

                minimize_button.addEventListener('click', (e) => {
                    e.stopPropagation()
                    toggleMinimize()
                })

                header.addEventListener('click', (e) => {
                    if (e.target.closest('.menu-button')) return
                    // Don't toggle if we were dragging
                     if (block.div.classList.contains('dragging')) return

                     if (clickTimeout) clearTimeout(clickTimeout)
                     clickTimeout = setTimeout(() => {
                         toggleMinimize()
                         clickTimeout = null
                     }, 220)
                })

                header.addEventListener('dblclick', (e) => {
                    if (e.target.closest('.menu-button')) return
                    
                    if (clickTimeout) {
                        clearTimeout(clickTimeout)
                        clickTimeout = null
                    }
                    this.editBlock(this.program.blocks.indexOf(block))
                })

                // Drag and Drop (disabled when monitoring)
                header.addEventListener('dragstart', (e) => {
                    if (this.monitoringActive) {
                        e.preventDefault()
                        return
                    }
                    this._draggingBlock = block
                    block.div.classList.add('dragging')
                    e.dataTransfer.effectAllowed = 'move'
                    // e.dataTransfer.setDragImage(block.div, 0, 0)
                })

                header.addEventListener('dragend', (e) => {
                     block.div.classList.remove('dragging')
                     this._draggingBlock = null
                     
                     // Helper to rebuild array order based on DOM order
                     const newBlocks = []
                     const children = Array.from(this.body.children)
                     children.forEach(child => {
                         const b = this.program.blocks.find(bk => bk.div === child)
                         if (b) newBlocks.push(b)
                     })
                     this.program.blocks = newBlocks
                })

                block.div.addEventListener('dragover', (e) => {
                     e.preventDefault()
                     const dragging = this._draggingBlock
                     if (!dragging || dragging === block) return
                     
                     const rect = block.div.getBoundingClientRect()
                     const midpoint = rect.top + rect.height / 2
                     
                     if (e.clientY < midpoint) {
                         // Insert before
                         if (block.div.previousElementSibling !== dragging.div) {
                             this.body.insertBefore(dragging.div, block.div)
                         }
                     } else {
                         // Insert after
                         if (block.div.nextElementSibling !== dragging.div) {
                             this.body.insertBefore(dragging.div, block.div.nextSibling)
                         }
                     }
                })
            }
            
            // Ensure proper order
            try {
                this.body.appendChild(block.div)
            } catch (e) {
                console.error('Failed to append block div', block.div)
                throw e
            }
            
            this.#drawProgramBlock(block)
        })

        requestAnimationFrame(() => this.restoreBodyScroll())
    }

    /**
     * Pretty prints JSON with smart formatting for ladder graph display
     * @param {any} obj - The object to stringify
     * @param {number} indent - Current indentation level
     * @returns {string}
     */
    static _smartStringify(obj, indent = 0) {
        const spaces = '  '.repeat(indent)
        const nextSpaces = '  '.repeat(indent + 1)

        if (obj === null) return 'null'
        if (obj === undefined) return 'undefined'
        if (typeof obj === 'boolean' || typeof obj === 'number') return String(obj)
        if (typeof obj === 'string') return JSON.stringify(obj)

        const isSimple = v => v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string'

        if (Array.isArray(obj)) {
            if (obj.length === 0) return '[]'
            if (obj.every(isSimple)) {
                return '[' + obj.map(v => v === undefined ? 'null' : JSON.stringify(v)).join(', ') + ']'
            }
            const items = obj.map(v => nextSpaces + EditorUI._smartStringify(v, indent + 1))
            return '[\n' + items.join(',\n') + '\n' + spaces + ']'
        }

        if (typeof obj === 'object') {
            const keys = Object.keys(obj)
            if (keys.length === 0) return '{}'
            if (keys.every(k => isSimple(obj[k]))) {
                const pairs = keys.map(k => JSON.stringify(k) + ': ' + (obj[k] === undefined ? 'null' : JSON.stringify(obj[k])))
                return '{ ' + pairs.join(', ') + ' }'
            }
            const isConnection = keys.length === 2 && keys.includes('sources') && keys.includes('destinations') &&
                Array.isArray(obj.sources) && Array.isArray(obj.destinations) &&
                obj.sources.every(isSimple) && obj.destinations.every(isSimple)
            if (isConnection) {
                const srcArr = '[' + obj.sources.map(v => JSON.stringify(v)).join(', ') + ']'
                const dstArr = '[' + obj.destinations.map(v => JSON.stringify(v)).join(', ') + ']'
                return '{ "sources": ' + srcArr + ', "destinations": ' + dstArr + ' }'
            }
            const pairs = keys.map(k => nextSpaces + JSON.stringify(k) + ': ' + EditorUI._smartStringify(obj[k], indent + 1))
            return '{\n' + pairs.join(',\n') + '\n' + spaces + '}'
        }

        return String(obj)
    }

    /**
     * Show compiled logic for a program block.
     * Pipeline: Ladder→STL→PLCASM, STL→PLCASM, ST→PLCScript→PLCASM, PLCScript→PLCASM
     * @param {any} block - The program block
     * @param {string} action - 'view_graph', 'view_stl', 'view_plcscript', or 'view_asm'
     */
    async _showCompiledLogic(block, action) {
        try {
            const runtime = this.master.runtime
            let finalOutput = ''
            let titleSuffix = ''
            let editorLanguage = 'asm'

            if (block.type === 'ladder') {
                // Ladder → Ladder Graph → STL → PLCASM
                const graph = toGraph(block)

                if (action === 'view_graph') {
                    finalOutput = EditorUI._smartStringify(graph)
                    titleSuffix = 'Ladder Graph'
                    editorLanguage = 'json'
                } else {
                    if (!runtime || !runtime.compileLadder) {
                        throw new Error('Runtime compiler not available')
                    }
                    const graphJson = JSON.stringify(graph)
                    const ladderResult = await runtime.compileLadder(graphJson)
                    if (!ladderResult || typeof ladderResult.output !== 'string') {
                        throw new Error('Ladder compilation failed to produce STL')
                    }
                    finalOutput = ladderResult.output
                    titleSuffix = 'STL'
                    editorLanguage = 'stl'

                    if (action === 'view_asm') {
                        if (!finalOutput.trim()) {
                            finalOutput = ''
                        } else {
                            if (!runtime.compileSTL) {
                                throw new Error('STL compiler not available')
                            }
                            const asmResult = await runtime.compileSTL(finalOutput)
                            if (!asmResult || typeof asmResult.output !== 'string') {
                                throw new Error('STL compilation failed to produce PLCASM')
                            }
                            finalOutput = asmResult.output
                        }
                        titleSuffix = 'PLCASM'
                        editorLanguage = 'asm'
                    }
                }
            } else if (block.type === 'stl') {
                // STL → PLCASM
                if (!runtime || !runtime.compileSTL) {
                    throw new Error('Runtime compiler not available')
                }
                const result = await runtime.compileSTL(block.code)
                if (!result || typeof result.output !== 'string') {
                    throw new Error('STL compilation failed to produce PLCASM')
                }
                finalOutput = result.output
                titleSuffix = 'PLCASM'
                editorLanguage = 'asm'
            } else if (block.type === 'st') {
                // ST → PLCScript → PLCASM
                if (!runtime) throw new Error('Runtime not available')
                if (typeof runtime.compileST !== 'function') {
                    throw new Error('Structured Text compiler not available')
                }
                const stResult = await runtime.compileST(block.code)
                if (!stResult || typeof stResult.output !== 'string') {
                    throw new Error('ST compilation failed to produce PLCScript')
                }
                finalOutput = stResult.output
                titleSuffix = 'PLCScript'
                editorLanguage = 'plcscript'

                if (action === 'view_asm') {
                    if (typeof runtime.compilePLCScript !== 'function') {
                        throw new Error('PLCScript compiler not available')
                    }
                    const pscResult = await runtime.compilePLCScript(finalOutput)
                    if (!pscResult || typeof pscResult.output !== 'string') {
                        throw new Error('PLCScript compilation failed to produce PLCASM')
                    }
                    finalOutput = pscResult.output
                    titleSuffix = 'PLCASM'
                    editorLanguage = 'asm'
                }
            } else if (block.type === 'plcscript') {
                // PLCScript → PLCASM
                if (!runtime) throw new Error('Runtime not available')
                if (typeof runtime.compilePLCScript !== 'function') {
                    throw new Error('PLCScript compiler not available')
                }
                const result = await runtime.compilePLCScript(block.code)
                if (!result || typeof result.output !== 'string') {
                    throw new Error('PLCScript compilation failed to produce PLCASM')
                }
                finalOutput = result.output
                titleSuffix = 'PLCASM'
                editorLanguage = 'asm'
            } else {
                throw new Error(`Unsupported block type: ${block.type}`)
            }

            const container = document.createElement('div')
            Object.assign(container.style, {
                width: '100%',
                height: '500px',
                position: 'relative'
            })

            const cce = new CanvasCodeEditor(container, {
                value: finalOutput,
                language: editorLanguage,
                readOnly: true,
                font: '14px Consolas, monospace',
            })

            new Popup({
                title: `Compiled ${titleSuffix} (${block.name})`,
                width: '900px',
                content: container,
                buttons: [{ text: 'Close', value: 'close' }],
                onClose: () => cce.dispose(),
            })

        } catch (err) {
            console.error(err)
            new Popup({
                title: 'Compilation Failed',
                // @ts-ignore
                description: err.message,
                buttons: [{ text: 'OK', value: 'ok' }]
            })
        }
    }

    async editBlock(index) {
        if (!this.program.blocks || !this.program.blocks[index]) return
        const block = this.program.blocks[index]
        
        const data = await Popup.form({
            title: 'Edit Block',
            inputs: [
                { name: 'name', label: 'Name', type: 'text', value: block.name },
                { name: 'comment', label: 'Comment', type: 'text', value: block.comment }
            ],
            buttons: [
                { text: 'Save', value: 'save', color: 'blue' },
                { text: 'Cancel', value: 'cancel' }
            ]
        })
        
        if (!data) return
        
        block.name = data.name
        block.comment = data.comment
        
        if (block.div) {
            const title = block.div.querySelector('.plc-program-block-title')
            const simple = block.div.querySelector('.plc-comment-simple')
            const detailed = block.div.querySelector('.plc-comment-detailed')
            if (title) title.innerText = block.name
            if (simple) simple.innerText = block.comment
            if (detailed) detailed.innerText = block.comment
        }
    }

    async addBlock(index = undefined) {
        const result = await new Promise(resolve => {
            const container = document.createElement('div')
            container.style.display = 'flex'
            container.style.flexDirection = 'column'
            container.style.gap = '16px'
            container.style.marginTop = '8px'
            container.style.minWidth = '460px'

            // --- Input fields ---
            const inputSection = document.createElement('div')
            inputSection.style.cssText = 'display:flex; gap:10px;'

            const nameContainer = document.createElement('div')
            nameContainer.style.cssText = 'display:flex; flex-direction:column; gap:4px; flex:1;'
            const nameLabel = document.createElement('label')
            nameLabel.innerText = 'Name'
            nameLabel.style.cssText = 'font-size:11px; font-weight:600; color:#999; text-transform:uppercase; letter-spacing:0.5px;'
            const nameInput = document.createElement('input')
            nameInput.type = 'text'
            nameInput.value = 'Network ' + ((this.program.blocks ? this.program.blocks.length : 0) + 1)
            nameInput.style.cssText = 'padding:8px 10px; background:#2a2a2a; border:1px solid #444; color:#e0e0e0; border-radius:4px; font-size:13px; outline:none; transition: border-color 0.2s;'
            nameInput.onfocus = () => nameInput.style.borderColor = '#4a9eff'
            nameInput.onblur = () => nameInput.style.borderColor = '#444'
            nameContainer.append(nameLabel, nameInput)

            const commentContainer = document.createElement('div')
            commentContainer.style.cssText = 'display:flex; flex-direction:column; gap:4px; flex:1;'
            const commentLabel = document.createElement('label')
            commentLabel.innerText = 'Description'
            commentLabel.style.cssText = 'font-size:11px; font-weight:600; color:#999; text-transform:uppercase; letter-spacing:0.5px;'
            const commentInput = document.createElement('input')
            commentInput.type = 'text'
            commentInput.placeholder = 'Optional description'
            commentInput.style.cssText = 'padding:8px 10px; background:#2a2a2a; border:1px solid #444; color:#e0e0e0; border-radius:4px; font-size:13px; outline:none; transition: border-color 0.2s;'
            commentInput.onfocus = () => commentInput.style.borderColor = '#4a9eff'
            commentInput.onblur = () => commentInput.style.borderColor = '#444'
            commentContainer.append(commentLabel, commentInput)

            inputSection.append(nameContainer, commentContainer)
            container.appendChild(inputSection)

            // --- Language selection ---
            let selectedType = 'ladder'
            const typeButtons = []

            const updateButtonVisuals = () => {
                typeButtons.forEach(b => {
                    const isSelected = b.dataset.type === selectedType
                    b.style.borderColor = isSelected ? '#4a9eff' : '#333'
                    b.style.backgroundColor = isSelected ? '#1a2a3a' : '#222'
                    b.style.boxShadow = isSelected ? '0 0 0 1px #4a9eff44, 0 2px 8px #0004' : '0 1px 3px #0003'
                    const check = b.querySelector('.lang-check')
                    if (check) check.style.opacity = isSelected ? '1' : '0'
                })
            }

            const createTypeBtn = (id, label, subtitle, thumbnailType) => {
                const btn = document.createElement('button')
                btn.dataset.type = id
                btn.type = 'button'
                btn.style.cssText = `
                    display: flex; align-items: center; gap: 12px;
                    padding: 10px 12px; border: 1.5px solid #333; border-radius: 6px;
                    background: #222; cursor: pointer; text-align: left; width: 100%;
                    transition: all 0.15s ease; position: relative; user-select: none;
                `
                btn.onmouseenter = () => { if (btn.dataset.type !== selectedType) btn.style.backgroundColor = '#2a2a2a' }
                btn.onmouseleave = () => { if (btn.dataset.type !== selectedType) btn.style.backgroundColor = '#222' }

                // Thumbnail
                const thumb = document.createElement('div')
                thumb.style.cssText = `
                    width: 80px; height: 44px; border-radius: 4px; background: #181818;
                    border: 1px solid #333; flex-shrink: 0; overflow: hidden;
                    display: flex; align-items: center; justify-content: center;
                `
                const thumbSrc = getThumbnailDataUrl(thumbnailType)
                if (thumbSrc) {
                    const img = document.createElement('img')
                    img.src = thumbSrc
                    img.style.cssText = 'width:100%; height:100%; object-fit:contain;'
                    img.draggable = false
                    thumb.appendChild(img)
                }

                // Short name badge
                const badge = document.createElement('div')
                badge.style.cssText = `
                    font-size: 10px; font-weight: 700; color: #60a8da; letter-spacing: 0.5px;
                    min-width: 28px; text-align: center; flex-shrink: 0; user-select: none;
                `
                badge.innerText = shortName(id)

                // Text content
                const textCol = document.createElement('div')
                textCol.style.cssText = 'display:flex; flex-direction:column; gap:2px; flex:1; min-width:0;'
                const titleEl = document.createElement('div')
                titleEl.style.cssText = 'font-size:13px; font-weight:600; color:#e0e0e0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;'
                titleEl.innerText = label
                const subEl = document.createElement('div')
                subEl.style.cssText = 'font-size:11px; color:#888; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;'
                subEl.innerText = subtitle
                textCol.append(titleEl, subEl)

                // Checkmark
                const check = document.createElement('div')
                check.className = 'lang-check'
                check.style.cssText = `
                    width: 18px; height: 18px; border-radius: 50%; background: #4a9eff;
                    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
                    opacity: 0; transition: opacity 0.15s ease;
                `
                check.innerHTML = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

                btn.append(thumb, badge, textCol, check)
                btn.onclick = () => { selectedType = id; updateButtonVisuals() }
                typeButtons.push(btn)
                return btn
            }

            // --- IEC 61131-3 Languages group ---
            const iecGroup = document.createElement('div')
            iecGroup.style.cssText = 'display:flex; flex-direction:column; gap:6px;'
            const iecLabel = document.createElement('div')
            iecLabel.style.cssText = 'font-size:11px; font-weight:600; color:#999; text-transform:uppercase; letter-spacing:0.5px; padding-bottom:2px; border-bottom:1px solid #333; margin-bottom:2px;'
            iecLabel.innerText = 'IEC 61131-3 Languages'
            const iecGrid = document.createElement('div')
            iecGrid.style.cssText = 'display:flex; flex-direction:column; gap:6px;'

            iecGrid.append(
                createTypeBtn('ladder', 'Ladder Diagram', 'Visual relay logic editor', 'lang-ladder'),
                createTypeBtn('st', 'Structured Text', 'High-level IEC programming language also known as SCL', 'lang-st'),
                createTypeBtn('stl', 'Statement List', 'Siemens-style instruction list', 'lang-stl'),
            )
            iecGroup.append(iecLabel, iecGrid)

            // --- Custom PLC Languages group ---
            const customGroup = document.createElement('div')
            customGroup.style.cssText = 'display:flex; flex-direction:column; gap:6px;'
            const customLabel = document.createElement('div')
            customLabel.style.cssText = 'font-size:11px; font-weight:600; color:#999; text-transform:uppercase; letter-spacing:0.5px; padding-bottom:2px; border-bottom:1px solid #333; margin-bottom:2px;'
            customLabel.innerText = 'VovkPLC Languages'
            const customGrid = document.createElement('div')
            customGrid.style.cssText = 'display:flex; flex-direction:column; gap:6px;'

            customGrid.append(
                createTypeBtn('plcscript', 'PLCScript', 'High-level TS-like scripting language', 'lang-plcscript'),
                createTypeBtn('asm', 'PLCASM', 'Low-level PLC assembly', 'lang-asm'),
            )
            customGroup.append(customLabel, customGrid)

            updateButtonVisuals()
            container.append(iecGroup, customGroup)

            let popup = null
            popup = new Popup({
                title: 'Add Program Block',
                content: container,
                buttons: [
                    {
                        text: 'Add Block',
                        value: 'confirm',
                        background: '#4a9eff',
                        color: 'white',
                        verify: () => {
                            if (!nameInput.value.trim()) {
                                nameInput.style.borderColor = '#ff4444'
                                nameInput.focus()
                                return false
                            }
                            return true
                        }
                    },
                    { text: 'Cancel', value: 'cancel' }
                ],
                onClose: (val) => {
                    if (val === 'confirm') {
                        resolve({
                            type: selectedType,
                            name: nameInput.value,
                            comment: commentInput.value
                        })
                    } else {
                        resolve(null)
                    }
                }
            })
        })

        if (!result) return

        if (!this.program.blocks) this.program.blocks = []
        
        const newBlock = {
            id: this.master._generateID(),
            type: result.type, 
            name: result.name || ('Network ' + (this.program.blocks.length + 1)),
            comment: result.comment || '',
        }
        
        // Initialize code property for text-based languages
        if (['asm', 'stl', 'plcscript', 'st'].includes(result.type)) {
            newBlock.code = ''
        }
        
        if (typeof index === 'undefined') {
            this.program.blocks.push(newBlock)
        } else {
             if (index < 0) index = 0
             if (index > this.program.blocks.length) index = this.program.blocks.length
             this.program.blocks.splice(index, 0, newBlock)
        }
        
        this.draw()
    }

    deleteBlock(index) {
        if (!this.program.blocks) return
        if (index > -1 && index < this.program.blocks.length) {
            const block = this.program.blocks[index]
            if (block.div) {
                block.div.remove()
                block.div = null
            }
            this.program.blocks.splice(index, 1)
        }
        this.draw()
    }

    /** @param { PLC_ProgramBlock } block */
    #drawProgramBlock(block) {
        if (!block) throw new Error('Block not found')
        const { div, id, type, name } = block
        if (!div) throw new Error('Block div not found')
        const block_container = div.querySelector('.plc-program-block-code')
        if (!block_container) throw new Error('Block code not found')
        block.props = block.props || {}
        const rendered = this.master.language_manager.renderBlock(block)
        if (rendered) return

        // Unknown type
        console.warn(`Unknown block type: ${type}`)
        block_container.innerHTML = '<div class="TODO"></div>'
    }

    restoreBodyScroll() {
        if (!this.body) return
        const top = (this.program && typeof this.program.scrollTop === 'number')
            ? this.program.scrollTop
            : this._lastBodyScrollTop
        if (typeof top === 'number') {
            this.body.scrollTop = top
        }
    }

    hide() {
        this.hidden = true
        this.div.classList.add('hidden')
    }
    show() {
        this.hidden = false
        this.div.classList.remove('hidden')
        requestAnimationFrame(() => this.restoreBodyScroll())
    }

    close() {
        this.div.remove()
        if (this.program && this.program.blocks) this.program.blocks.forEach(block => {
            if (block) {
                if (block.div) {
                    block.div.remove()
                    delete block.div
                }
                if (block.props) {
                    delete block.props
                }
            }
        })
        this.master.context_manager.removeListener(this.div)
        this.master.window_manager.windows.delete(this.id)
    }

    /** @param { { name?: string, comment?: string } } options */
    updateInfo(options) {
        if (!this.program) throw new Error(`Program not found: ${this.id}`)
        this.program.name = options.name || this.program.name
        this.program.comment = options.comment || this.program.comment
        this.reloadProgram()
    }
}
