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
        this.header.innerHTML = /*HTML*/`
            <h2 style="margin-top: 0px; margin-bottom: 3px;">Program: ${this.name || ''}</h2>
            <p>${this.comment || ''}</p>
        `
        this.draw()
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
            this.header.innerHTML = /*HTML*/`
                <h2 style="margin-top: 0px; margin-bottom: 3px;">Program: ${name || ''}</h2>
                <p>${comment || ''}</p>
            `
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

        this.program.blocks.forEach(block => {
            if (!block) return
            if (!block.id) block.id = this.master._generateID(block.id)
            const { id, type, name, comment } = block
            if (!block.div) {
                block.div = ElementSynthesis(/*HTML*/`
                    <div class="plc-program-block">
                        <div class="plc-program-block-header">
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
                                    <div class="menu-button minimize">-</div>
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
                const minimize_button = block.div.querySelector('.minimize')
                if (!minimize_button) throw new Error('Minimize button not found')
                minimize_button.addEventListener('click', () => {
                    const { div } = block
                    if (!div) throw new Error('Block div not found')
                    // div.classList.toggle('minimized')
                    const is_minimized = div.classList.contains('minimized')
                    div.classList.toggle('minimized') // @ts-ignore
                    minimize_button.innerText = is_minimized ? '-' : '+'
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
    }

    async addBlock(index = undefined) {
        const type = await new Promise(resolve => {
            const container = document.createElement('div')
            container.style.display = 'flex'
            container.style.gap = '10px'
            container.style.justifyContent = 'center'
            container.style.marginTop = '10px'
            
            const types = [
                { id: 'ladder', label: 'Ladder Diagram (LAD)' },
                { id: 'asm', label: 'Assembly (ASM)' }
            ]
            
            let popup = null

            types.forEach(t => {
                const btn = document.createElement('button')
                btn.className = 'plc-btn'
                btn.innerText = t.label
                btn.style.padding = '15px 25px'
                btn.onclick = () => popup && popup.close(t.id)
                container.appendChild(btn)
            })

            popup = new Popup({
                title: 'Add Program Block',
                description: 'Select the language for the new block:',
                content: container,
                buttons: [ { text: 'Cancel', value: 'cancel' } ],
                onClose: (val) => resolve(val === 'cancel' || !val ? null : val)
            })
        })

        if (!type) return

        if (!this.program.blocks) this.program.blocks = []
        
        const newBlock = {
            id: this.master._generateID(),
            type: type, 
            name: 'Network ' + (this.program.blocks.length + 1),
            comment: '',
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

    hide() {
        this.hidden = true
        this.div.classList.add('hidden')
    }
    show() {
        this.hidden = false
        this.div.classList.remove('hidden')
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