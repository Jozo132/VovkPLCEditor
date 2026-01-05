import { ElementSynthesis, ElementSynthesisMany, CSSimporter } from "../../../utils/tools.js"
import { PLC_Program, PLC_ProgramBlock, PLCEditor } from "../../../utils/types.js"


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
                console.log(`VovkPLC Editor "#${this.id}" context menu open`)
                return [
                    { type: 'item', name: 'edit', label: 'Edit' },
                    { type: 'item', name: 'delete', label: 'Delete' },
                    { type: 'separator' },
                    { type: 'item', name: 'copy', label: 'Copy' },
                    { type: 'item', name: 'paste', label: 'Paste' },
                ]
            },
            onClose: (selected) => {
                console.log(`Editor selected: ${selected}`)
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
                this.body.appendChild(block.div)
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
            this.#drawProgramBlock(block)
        })
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
        if (this.program) this.program.blocks.forEach(block => {
            if (!block) return
            if (block.div) {
                block.div.remove()
                delete block.div
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