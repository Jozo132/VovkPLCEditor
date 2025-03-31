// @ts-check
"use strict"

import { MenuElement, PLC_Folder, PLC_Program, PLC_ProjectItem, PLCEditor } from "../../../utils/types.js"
import { ElementSynthesis } from "../../../utils/tools.js"
import { folder_icon, program_icon } from "./components/icons.js"


export default class NavigationTreeManager {

    #editor
    /** @param { PLCEditor } editor */
    constructor(editor) {
        this.#editor = editor
        const workspace = editor.workspace
        this.workspace = workspace

        const container = workspace.querySelector('.plc-navigation-tree')
        if (!container) throw new Error('Navigation tree container not found')
        container.innerHTML = ''
    }


    initialize() {
        const editor = this.#editor

        /** @type { MenuElement[] } */
        const ctx_edit_folder = [
            { type: 'item', name: 'add', label: 'Add item' },
            { type: 'separator' },
            { type: 'item', name: 'delete', label: 'Delete' },
            { type: 'item', name: 'rename', label: 'Rename' },
        ]
        /** @type { MenuElement[] } */
        const ctx_edit_program = [
            { type: 'item', name: 'cut', label: 'Cut' },
            { type: 'item', name: 'copy', label: 'Copy' },
            { type: 'item', name: 'paste', label: 'Paste' },
            { type: 'separator' },
            { type: 'item', name: 'delete', label: 'Delete' },
            { type: 'item', name: 'rename', label: 'Rename' },
        ]

        /** @type { MenuElement[] } */
        const ctx_online_folder = [
            { type: 'item', name: 'add', label: 'Add item', disabled: true },
            { type: 'separator' },
            { type: 'item', name: 'delete', label: 'Delete', disabled: true },
            { type: 'item', name: 'rename', label: 'Rename', disabled: true },
        ]
        /** @type { MenuElement[] } */
        const ctx_online_program = [
            { type: 'item', name: 'cut', label: 'Cut', disabled: true },
            { type: 'item', name: 'copy', label: 'Copy' },
            { type: 'item', name: 'paste', label: 'Paste', disabled: true },
            { type: 'separator' },
            { type: 'item', name: 'delete', label: 'Delete', disabled: true },
            { type: 'item', name: 'rename', label: 'Rename', disabled: true },
        ]

        /** @type { (event: any, element: any) => MenuElement[] } */
        const on_context_open_navigation_tree = (event, element) => {
            const connected = editor.device_manager.connected
            const classes = element.classList
            const className = classes[0] // Get the first class name
            if (className === 'plc-navigation-folder') {
                return connected ? ctx_online_folder : ctx_edit_folder
            }
            if (className === 'plc-navigation-program') {
                return connected ? ctx_online_program : ctx_edit_program
            }
            throw new Error(`Invalid class name: ${className}`)
        }

        const on_context_close_navigation_tree = (selected, event, element) => {
            editor.window_manager.tree_manager.onContextMenu(selected, event, element)
        }

        editor.context_manager.addListener({
            className: 'plc-navigation-folder',
            onOpen: on_context_open_navigation_tree,
            onClose: on_context_close_navigation_tree,
        })
        editor.context_manager.addListener({
            className: 'plc-navigation-program',
            onOpen: on_context_open_navigation_tree,
            onClose: on_context_close_navigation_tree,
        })
    }

    /** @param { PLC_ProjectItem } item */
    draw_structure = (item) => {
        if (item.type === 'folder') return this.draw_folder(item)
        if (item.type === 'program') return this.draw_item(item) // @ts-ignore
        if (item.type === 'item') return this.draw_item(item)
    }
    /** @param { PLC_Folder } folder */
    draw_folder = (folder) => {
        const minimized = false
        const div = ElementSynthesis(/*HTML*/`
            <div class="plc-navigation-item ${minimized ? 'minimized' : ''}">
                <div class="plc-navigation-folder">
                    <div class="minimize">${minimized ? '+' : '-'}</div>
                    <div class="plc-icon">${folder_icon}</div>
                    <div class="plc-title">${folder.name}</div>
                </div>
                <div class="plc-navigation-children"></div>
            </div>
        `)[0]
        const children = div.querySelector('.plc-navigation-children'); if (!children) throw new Error('Children not found')
        const minimize = div.querySelector('.minimize'); if (!minimize) throw new Error('Minimize button not found')
        const navigation_folder = div.querySelector('.plc-navigation-folder'); if (!navigation_folder) throw new Error('Navigation folder not found')
        navigation_folder.addEventListener('click', () => {
            div.classList.toggle('minimized') // @ts-ignore
            minimize.innerText = div.classList.contains('minimized') ? '+' : '-'
        })
        folder.children.forEach(child => {
            const div = this.draw_structure(child)
            if (!div) throw new Error('Div not found')
            children.appendChild(div)
        })
        return div
    }
    /** @param { PLC_Program } program */
    draw_item = (program) => {
        const div = ElementSynthesis(/*HTML*/`
            <div class="plc-navigation-item">
                <div class="plc-navigation-program">
                    <div class="plc-void"></div>
                    <div class="plc-icon">${program_icon}</div>
                    <div class="plc-title">${program.name}</div>
                </div>
            </div>
        `)[0]
        div.addEventListener('click', () => {
            if (!program.id) throw new Error('Program ID not found')
            this.#editor.window_manager.openProgram(program.id)
        })
        if (this.#editor.initial_program && program.name === this.#editor.initial_program) {
            this.#editor.initial_program = null
            setTimeout(() => this.#editor.window_manager.openProgram(program.id), 50)
        }
        return div
    }

    onContextMenu = (selected, event, element) => {
        console.log(`Navigation tree selected: ${selected}, element:`, element, `event:`, event)
    }

    draw_navigation_tree = () => {
        const editor = this.#editor
        // [ + ] [icon] [title]   < ------ folder
        //       [icon] [title]   < ------ item
        const navigation = editor.project.project
        const container = editor.workspace.querySelector('.plc-navigation-tree')
        if (!container) throw new Error('Navigation tree container not found')
        container.innerHTML = ''
        navigation.forEach(item => {
            const div = this.draw_structure(item)
            if (!div) throw new Error('Div not found')
            container.appendChild(div)
        })

        editor.initial_program = null // Prevent opening the initial program again on redraw
    }
}