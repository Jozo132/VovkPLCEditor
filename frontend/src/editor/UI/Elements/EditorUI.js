import { ElementSynthesis, ElementSynthesisMany, CSSimporter } from "../../../utils/tools.js"
import { PLC_Program, PLC_ProgramBlock, PLCEditor } from "../../../utils/types.js"
import { getIconType } from "./components/icons.js"
import { Popup } from "./components/popup.js"


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

                if (blockIndex !== -1) {
                    items.push(
                        { type: 'item', name: 'add_above', label: 'Add Block Above', className: `plc-icon ${getIconType('add')}` },
                        { type: 'item', name: 'add_below', label: 'Add Block Below', className: `plc-icon ${getIconType('add')}` },
                    )
                } else {
                    items.push(
                        { type: 'item', name: 'add_block', label: 'Add Block', className: `plc-icon ${getIconType('add')}` },
                    )
                }

                items.push(
                    { type: 'separator' },
                    { type: 'item', name: 'edit', label: 'Edit' },
                    { type: 'item', name: 'delete', label: 'Delete' },
                    { type: 'separator' },
                    { type: 'item', name: 'copy', label: 'Copy' },
                    { type: 'item', name: 'paste', label: 'Paste' },
                )
                return items
            },
            onClose: (selected) => {
                // console.log(`Editor selected: ${selected}`)
                if (selected === 'add_block') this.addBlock()
                if (selected === 'add_above') this.addBlock(this._contextTargetIndex)
                if (selected === 'add_below') this.addBlock(this._contextTargetIndex + 1)
                if (selected === 'delete') this.deleteBlock(this._contextTargetIndex)
                if (selected === 'edit') this.editBlock(this._contextTargetIndex)
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
                                        ${(type || '???').toUpperCase().substring(0, 3)}
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

                // Drag and Drop
                header.addEventListener('dragstart', (e) => {
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
            container.style.gap = '15px'
            container.style.marginTop = '10px'
            
            // Name Input
            const nameContainer = document.createElement('div')
            nameContainer.style.display = 'flex'
            nameContainer.style.flexDirection = 'column'
            nameContainer.style.gap = '5px'
            
            const nameLabel = document.createElement('label')
            nameLabel.innerText = 'Name'
            nameLabel.style.fontSize = '12px'
            nameLabel.style.fontWeight = 'bold'
            nameLabel.style.color = '#333'
            
            const nameInput = document.createElement('input')
            nameInput.type = 'text'
            nameInput.value = 'Network ' + ((this.program.blocks ? this.program.blocks.length : 0) + 1)
            nameInput.style.padding = '5px'
            nameInput.style.backgroundColor = '#fff'
            nameInput.style.border = '1px solid #ccc'
            nameInput.style.color = '#333'
            nameInput.style.borderRadius = '3px'
            
            nameContainer.appendChild(nameLabel)
            nameContainer.appendChild(nameInput)
            container.appendChild(nameContainer)
            
            // Comment Input
            const commentContainer = document.createElement('div')
            commentContainer.style.display = 'flex'
            commentContainer.style.flexDirection = 'column'
            commentContainer.style.gap = '5px'
            
            const commentLabel = document.createElement('label')
            commentLabel.innerText = 'Description'
            commentLabel.style.fontSize = '12px'
            commentLabel.style.fontWeight = 'bold'
            commentLabel.style.color = '#333'
            
            const commentInput = document.createElement('input')
            commentInput.type = 'text'
            commentInput.placeholder = 'Optional description'
            commentInput.style.padding = '5px'
            commentInput.style.backgroundColor = '#fff'
            commentInput.style.border = '1px solid #ccc'
            commentInput.style.color = '#333'
            commentInput.style.borderRadius = '3px'
            
            commentContainer.appendChild(commentLabel)
            commentContainer.appendChild(commentInput)
            container.appendChild(commentContainer)
            
            // Type Selection
            const typeContainer = document.createElement('div')
            typeContainer.style.display = 'flex'
            typeContainer.style.flexDirection = 'column'
            typeContainer.style.gap = '5px'

            const typeLabel = document.createElement('div')
            typeLabel.innerText = 'Select Type:'
            typeLabel.style.fontSize = '12px'
            typeLabel.style.fontWeight = 'bold'
            typeLabel.style.color = '#333'
            typeContainer.appendChild(typeLabel)
            
            // Button Grid (2 columns, auto-expanding rows)
            const buttonGroup = document.createElement('div')
            buttonGroup.style.display = 'grid'
            buttonGroup.style.gridTemplateColumns = 'repeat(2, 1fr)'
            buttonGroup.style.gap = '10px'
            
            let selectedType = 'ladder' // Default selection
            const typeButtons = []

            const updateButtonVisuals = () => {
                typeButtons.forEach(b => {
                    const isSelected = b.dataset.type === selectedType
                    // Reset to base styles
                    b.className = 'plc-btn' 
                    b.style.userSelect = 'none' // Disable text select
                    b.style.display = 'flex'
                    b.style.alignItems = 'center'
                    b.style.justifyContent = 'flex-start'
                    b.style.gap = '8px'
                    
                     // Compensate for border width difference to prevent layout shift
                    // Selected: 2px border + 9px padding = 11px
                    // Unselected: 1px border + 10px padding = 11px
                    b.style.padding = isSelected ? '9px 14px' : '10px 15px'
                    b.style.border = isSelected ? '2px solid #007bff' : '1px solid #ccc' 
                    b.style.backgroundColor = isSelected ? '#e6f0ff' : '#f9f9f9'
                    b.style.color = isSelected ? '#0056b3' : '#333'
                    b.style.fontWeight = '600'
                })
            }

            const createTypeBtn = (id, label) => {
                const btn = document.createElement('button')
                btn.dataset.type = id
                
                // Icon (First 3 chars)
                const icon = document.createElement('span')
                icon.innerText = id.toUpperCase().substring(0, 3)
                icon.style.color = '#60a8da'
                // Replicate header icon style
                icon.style.fontSize = '12px' 
                icon.style.fontWeight = 'bold'
                
                const text = document.createElement('span')
                text.innerText = label
                
                btn.appendChild(icon)
                btn.appendChild(text)
                
                btn.onclick = () => {
                   selectedType = id
                   updateButtonVisuals()
                }
                return btn
            }
            
            const btnLadder = createTypeBtn('ladder', 'Ladder Diagram (LAD)')
            const btnStl = createTypeBtn('stl', 'Siemens STL')
            const btnAsm = createTypeBtn('asm', 'Assembly (ASM)')
            
            typeButtons.push(btnLadder, btnStl, btnAsm)
            updateButtonVisuals() // Initial state
            
            buttonGroup.appendChild(btnLadder)
            buttonGroup.appendChild(btnStl)
            buttonGroup.appendChild(btnAsm)
            typeContainer.appendChild(buttonGroup)

            /*
            const radioGroup = document.createElement('div')
            radioGroup.style.display = 'flex'
            radioGroup.style.gap = '15px'
            
            const createRadio = (id, label, checked = false) => {
                const wrapper = document.createElement('div')
                wrapper.style.display = 'flex'
                wrapper.style.alignItems = 'center'
                wrapper.style.gap = '5px'
                
                const radio = document.createElement('input')
                radio.type = 'radio'
                radio.name = 'block_type'
                radio.value = id
                radio.id = 'radio_' + id
                radio.checked = checked
                
                const lbl = document.createElement('label')
                lbl.innerText = label
                lbl.setAttribute('for', 'radio_' + id)
                lbl.style.color = '#333'
                lbl.style.cursor = 'pointer'

                wrapper.appendChild(radio)
                wrapper.appendChild(lbl)
                return { wrapper, radio }
            }

            const r1 = createRadio('ladder', 'Ladder Diagram (LAD)', true)
            const r2 = createRadio('asm', 'Assembly (ASM)')
            
            radioGroup.appendChild(r1.wrapper)
            radioGroup.appendChild(r2.wrapper)
            typeContainer.appendChild(radioGroup)
            */
            container.appendChild(typeContainer)

            let popup = null

            popup = new Popup({
                title: 'Add Program Block',
                description: 'Enter details and select language:',
                content: container,
                buttons: [
                    { 
                        text: 'Add', 
                        value: 'confirm', 
                        background: '#007bff',
                        color: 'white',
                        verify: () => {
                            if (!nameInput.value.trim()) {
                                nameInput.style.borderColor = 'red'
                                return false
                            }
                            return true
                        }
                    },
                    { text: 'Cancel', value: 'cancel' } 
                ],
                onClose: (val) => {
                    if (val === 'confirm') {
                        // Use the selectedType variable instead of querying radios
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
