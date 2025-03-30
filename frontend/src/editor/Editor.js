// @ts-check
"use strict"

import { importCSS } from "../utils/tools.js"
import { PLC_Folder, PLC_Program, PLC_Project, PLC_ProjectItem } from "../utils/types.js"

await importCSS('./editor/Editor.css')

import VovkPLC from "../wasm/VovkPLC.js"
import DeviceManager from "./DeviceManager.js"
import WindowManager from "./UI/WindowManager.js"
import ProjectManager from "./ProjectManager.js"
import LanguageManager from "./LanguageManager.js"
import ContextManager from "./ContextManager.js"
import Actions from './Actions.js'
import EditorUI from "./UI/Elements/EditorUI.js"


Actions.initialize() // Enable global actions for all instances of VovkPLCEditor

export class VovkPLCEditor {
    /** @type {PLC_Project} */ project
    /** @type {HTMLElement} */ workspace

    memory = new Array(100).fill(0)
    runtime = new VovkPLC()
    runtime_ready = false

    /** @type {Object | null} */
    initial_program = null

    /** @type {PLC_ProjectItem[]} */
    navigation_tree = []

    /** @type {String[]} */
    reserved_ids = []

    properties = {
        ladder_block_width: 120,
        ladder_block_height: 80,
        ladder_blocks_per_row: 7,
        style: {
            background_color_alt: '#333',
            background_color_online: '#444',
            background_color_edit: '#666',
            color: '#000',
            highlight_color: '#3C3',
            highlight_sim_color: '#4AD',
            grid_color: '#FFF4',
            select_highlight_color: '#7AF',
            select_color: '#456',
            hover_color: '#456',
            font: '16px Consolas',
            font_color: '#DDD',
            font_error_color: '#FCC',
            line_width: 3,
            highlight_width: 8,
        },
    }

    /** @param {{ workspace?: HTMLElement | string | null, debug_css?: boolean, initial_program?: string | Object }} options */
    constructor({ workspace, debug_css, initial_program }) {
        this.initial_program = initial_program || null
        if (typeof workspace === 'string') workspace = document.getElementById(workspace)
        if (!workspace) throw new Error('Container not found')

        this.workspace = workspace
        this.workspace.classList.add('plc-workspace')
        if (debug_css) this.workspace.classList.add('debug')

        this.runtime.initialize('/wasm/VovkPLC.wasm').then(() => {
            this.runtime_ready = true
        })

        this.window_manager = new WindowManager(this)
        this.device_manager = new DeviceManager(this)
        this.project_manager = new ProjectManager(this)
        this.language_manager = new LanguageManager(this)
        this.context_manager = new ContextManager(this)

        this.window_manager.initialize()
        this.device_manager.initialize()

        if (initial_program) {
            this.open(initial_program)
        }
    }

    /** @param {PLC_Project} project */
    open(project) {
        this.project = project
        this.prepareProject(project)
        this.window_manager.open(project)
        // this.draw()
    }


    /** @type { (folder: PLC_Folder) => PLC_Program | null } */
    searchForProgramInFolder = (folder) => { // @ts-ignore
        for (let i = 0; i < folder.children.length; i++) {
            const child = folder.children[i]
            let program
            if (child.type === 'folder') program = this.searchForProgramInFolder(child)
            else if (child.type === 'program') program = this.searchForProgram(child) // @ts-ignore
            else throw new Error(`Invalid child type: ${child.type}`)
            if (program) return program
        }
        return null
    }
    /** @type { (program: PLC_Program) => PLC_Program | null } */
    searchForProgram = (program) => {
        const editor = this
        if (!program.id) throw new Error('Program ID not found')
        // console.log(`Comparing if ${program.id} is equal to ${editor.active_tab}`)
        if (program.id === editor.active_tab) return program
        return null
    }

    /** @type { (id: string | null) => PLC_Program | null } */
    findProgram = (id) => {
        const editor = this
        if (!editor) throw new Error('Editor not found')
        if (!editor.project) return null
        if (!editor.project.project) return null
        const project = editor.project.project
        for (let i = 0; i < project.length; i++) {
            const folder = project[i]
            let program
            if (folder.type === 'folder') program = this.searchForProgramInFolder(folder)
            else if (folder.type === 'program') program = this.searchForProgram(folder) // @ts-ignore
            else throw new Error(`Invalid folder type: ${folder.type}`)
            if (id && program && program.id === id) return program
            if (program && id === null) {
                console.log(`Loading the first program found`, program)
                return program
            }
        }
        return null
    }

    /** @param { string | null } id */
    openProgram(id) {
        if (!id) throw new Error('Program ID not found')
        if (this.active_program) {
            this.active_program.host?.hide()
        }
        this.active_tab = id
        this.active_program = this.findProgram(id)
        if (!this.active_program) throw new Error(`Program not found: ${id}`)
        // activateTab(this, id)
        if (!this.active_program.host) {
            const host = new EditorUI(this, id)
            this.active_program.host = host

            host.div.setAttribute('id', id)
            this.context_manager.addListener({
                target: host.div,
                onOpen: (event) => {
                    console.log(`Program "#${id}" context menu open`)
                    return [
                        { type: 'item', name: 'edit', label: 'Edit' },
                        { type: 'item', name: 'delete', label: 'Delete' },
                        { type: 'separator' },
                        { type: 'item', name: 'copy', label: 'Copy' },
                        { type: 'item', name: 'paste', label: 'Paste' },
                    ]
                },
                onClose: (selected) => {
                    console.log(`Program selected: ${selected}`)
                }
            })
        }
        this.active_program.host.program = this.active_program
        this.active_tab = id
        this.active_program.host.reloadProgram()
        this.active_program.host.show()
        const frame = this.active_program.host.frame
        if (!frame) throw new Error('Frame not found')
        const frame_width = frame.clientWidth
        if (frame_width <= 500) {
            // minimize navigation
            const navigation = this.workspace.querySelector('.plc-navigation')
            if (!navigation) throw new Error('Navigation not found')
            navigation.classList.add('minimized')
            const minimize = navigation.querySelector('.plc-navigation-bar .menu-button')
            if (!minimize) throw new Error('Minimize button not found')
            minimize.innerHTML = '+'
        }
        // this.draw()
    }

    /** @param { PLC_Project } project */
    prepareProject(project) {
        /** @type { (folder: PLC_Folder) => void } */
        const checkFolder = (folder) => {
            folder.id = this.generateID(folder.id)
            /** @type { (program: PLC_Program) => void } */
            folder.children.forEach(child => {
                if (child.type === 'folder') return checkFolder(child)
                if (child.type === 'program') return checkProgram(child) // @ts-ignore
                throw new Error(`Invalid child type: ${child.type}`)
            })
        }
        /** @param { PLC_Program } program */
        const checkProgram = (program) => {
            program.id = this.generateID(program.id)
            if (program.id === this.window_manager.active_tab) {
                program.blocks.forEach(block => {
                    block.id = this.generateID(block.id)
                    block.blocks.forEach(ladder => {
                        ladder.id = this.generateID(ladder.id)
                    })
                    block.connections.forEach(con => {
                        con.id = this.generateID(con.id)
                    })
                })
            }
        }
        project.project.forEach(child => {
            if (child.type === 'folder') return checkFolder(child)
            if (child.type === 'program') return checkProgram(child) // @ts-ignore
            throw new Error(`Invalid child type: ${child.type}`)
        })
    }

    generateID(id = '') {
        if (id && !this.reserved_ids.includes(id)) {
            this.reserved_ids.push(id)
            return id
        }
        let new_id = ''
        const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
        new_id = letters.charAt(Math.floor(Math.random() * letters.length))
        for (let i = 0; i < 12; i++) {
            new_id += characters.charAt(Math.floor(Math.random() * characters.length))
        }
        while (this.reserved_ids.includes(new_id)) {
            new_id = this.generateID()
        }
        this.reserved_ids.push(new_id)
        return new_id
    }
}
