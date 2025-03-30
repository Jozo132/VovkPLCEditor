// @ts-check
"use strict"

import { PLC_Folder, PLC_Program, PLC_ProjectItem, PLCEditor } from "../../../utils/types.js"
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


    draw_navigation_tree = () => {
        const editor = this.#editor
        // [ + ] [icon] [title]   < ------ folder
        //       [icon] [title]   < ------ item
        const program = editor.project.project
        editor.navigation_tree = program
        const navigation = editor.navigation_tree
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

    update_navigation_tree = () => {
        const editor = this.#editor
        // Check for differences between the navigation tree and the project tree and redraw if any differences are found, keeping the minimized state of the folders if they are still present
        const project = editor.project.project
        const navigation = editor.navigation_tree
        let difference = false
        const checkFolder = (folder, nav_folder) => {
            for (let i = 0; i < folder.children.length; i++) {
                const child = folder.children[i]
                let nav_child = nav_folder.children.find(c => c.id === child.id)
                if (!nav_child) {
                    difference = true
                    break
                }
                if (child.type === 'folder') {
                    checkFolder(child, nav_child)
                    if (difference) break
                }
            }
        }
        for (let i = 0; i < project.length; i++) {
            const folder = project[i]
            const nav_folder = navigation.find(f => f.id === folder.id)
            if (!nav_folder) {
                difference = true
                break
            }
            if (folder.type === 'folder') {
                checkFolder(folder, nav_folder)
                if (difference) break
            }
        }
        if (difference) {
            editor.navigation_tree = project
            this.draw_navigation_tree()
        }
    }
}