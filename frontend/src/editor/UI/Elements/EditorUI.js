// @ts-check
"use strict"

import { ElementSynthesisMany } from "../../../utils/tools.js"
import { PLC_Program, PLCEditor } from "../../../utils/types.js"

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
    }

    hide() {
        this.hidden = true
        this.div.classList.add('hidden')
    }
    show() {
        this.hidden = false
        this.div.classList.remove('hidden')
    }
}