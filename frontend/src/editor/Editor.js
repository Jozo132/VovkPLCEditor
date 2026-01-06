import {CSSimporter, debug_components} from '../utils/tools.js'
import {PLC_Program, PLC_Project} from '../utils/types.js'

const importCSS = CSSimporter(import.meta.url)
await importCSS('./Editor.css')

import VovkPLC from '../wasm/VovkPLC.js'
import DeviceManager from './DeviceManager.js'
import WindowManager from './UI/WindowManager.js'
import ProjectManager from './ProjectManager.js'
import LanguageManager from './LanguageManager.js'
import ContextManager from './ContextManager.js'
import Actions from './Actions.js'
import EditorUI from './UI/Elements/EditorUI.js'

Actions.initialize() // Enable global actions for all instances of VovkPLCEditor

export class VovkPLCEditor {
    /** @type {PLC_Project} */ project
    /** @type {HTMLElement} */ workspace

    memory = new Array(100).fill(0)
    runtime = new VovkPLC()
    runtime_ready = false

    /** @type {Object | null} */
    initial_program = null

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

    /** @param {{ workspace?: HTMLElement | string | null, debug_css?: boolean, debug_context?: boolean, debug_hover?: boolean, initial_program?: string | Object }} options */
    constructor({workspace, debug_css, debug_context, debug_hover, initial_program}) {
        this.initial_program = initial_program || {
            offsets: {
                control: {offset: 0, size: 16},
                input: {offset: 16, size: 16},
                output: {offset: 32, size: 16},
                memory: {offset: 48, size: 16},
                system: {offset: 64, size: 16},
            },
            symbols: [
                {name: 'button1', location: 'input', type: 'bit', address: 0.0, initial_value: 0, comment: 'Test input'},
                {name: 'button2', location: 'input', type: 'bit', address: 0.1, initial_value: 0, comment: 'Test input'},
                {name: 'button3', location: 'input', type: 'bit', address: 0.2, initial_value: 0, comment: 'Test input'},
                {name: 'button4', location: 'input', type: 'bit', address: 0.3, initial_value: 0, comment: 'Test input'},
                {name: 'light1', location: 'output', type: 'bit', address: 0.0, initial_value: 0, comment: 'Test output'},
                {name: 'light2', location: 'output', type: 'bit', address: 0.1, initial_value: 0, comment: 'Test output'},
            ],
            // folders: ['/programs/test/b', '/programs/test/a', '/programs/test/c'],
            files: [
                {
                    path: '/',
                    type: 'program',
                    name: 'main',
                    full_path: '/main',
                },
            ],
        }
        this.debug_css = !!debug_css
        this.debug_context = !!debug_context
        this.debug_hover = !!debug_hover
        if (typeof workspace === 'string') workspace = document.getElementById(workspace)
        if (!workspace) throw new Error('Container not found')

        this.workspace = workspace
        this.workspace.classList.add('plc-workspace')
        if (debug_css) this.workspace.classList.add('debug')

        this.runtime.initialize('/wasm/VovkPLC.wasm').then(() => {
            // Compile 'exit' to flush out any initial runtime logs
            try { this.runtime.compile('exit') } catch (e) { }
            this.runtime_ready = true
        })

        this.window_manager = new WindowManager(this)
        this.device_manager = new DeviceManager(this)
        this.project_manager = new ProjectManager(this)
        this.language_manager = new LanguageManager(this)
        this.context_manager = new ContextManager(this)

        this.window_manager.initialize()
        this.device_manager.initialize()
        this.project_manager.initialize()
        this.context_manager.initialize()
        this.language_manager.initialize()

        if (this.initial_program) {
            this.openProject(this.initial_program)
        }
    }

    /** @param {PLC_Project} project */
    openProject(project) {
        this.project = project
        this._prepareProject(project)
        this.window_manager.openProject(project)
        // this.draw()
    }

    /** @type { (program: PLC_Program) => PLC_Program | null } */
    searchForProgram = program => {
        const editor = this
        if (!program.id) throw new Error('Program ID not found')
        // console.log(`Comparing if ${program.id} is equal to ${editor.active_tab}`)
        if (program.id === editor.active_tab) return program
        return null
    }

    /** @type { (id: any) => PLC_Program | null } */
    findProgram = id => {
        const editor = this
        if (!editor) throw new Error('Editor not found')
        // Search the navigation tree for the program with the given ID
        const found = editor.window_manager.tree_manager.findProgram(id)
        if (found) return found
        if (typeof id === 'object') {
            const program_id = editor.window_manager.tab_manager.findProgramIdByTab(id)
            if (!program_id) return null
            const program = editor.window_manager.tree_manager.findProgram(program_id)
            if (program) return program
        }
        return null
    }

    /** @param { string | null } id */
    _openProgram(id) {
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
                onOpen: event => {
                    console.log(`Program "#${id}" context menu open`)
                    return [{type: 'item', name: 'edit', label: 'Edit'}, {type: 'item', name: 'delete', label: 'Delete'}, {type: 'separator'}, {type: 'item', name: 'copy', label: 'Copy'}, {type: 'item', name: 'paste', label: 'Paste'}]
                },
                onClose: selected => {
                    console.log(`Program selected: ${selected}`)
                },
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
    _prepareProject(project) {
        // Clear reserved IDs when loading a new project to prevent conflicts with old IDs
        this.reserved_ids = []

        /** @param { PLC_Program } program */
        const checkProgram = program => {
            program.id = this._generateID(program.id)
            if (program.id === this.window_manager.active_tab) {
                program.blocks.forEach(block => {
                    block.id = this._generateID(block.id)
                    if (block.type === 'ladder') {
                        block.blocks.forEach(ladder => {
                            ladder.id = this._generateID(ladder.id)
                        })
                        block.connections.forEach(con => {
                            con.id = this._generateID(con.id)
                        })
                    }
                })
            }
        }
        project.files.forEach(file => {
            if (file.type === 'program') return checkProgram(file)
            const system_types = ['symbols', 'setup']
            if (system_types.includes(file.type)) return
            // @ts-ignore
            throw new Error(`Invalid child type: ${file.type}`)
        })
    }

    _generateID(id = '') {
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
            new_id = this._generateID()
        }
        this.reserved_ids.push(new_id)
        return new_id
    }
}

if (debug_components) {
    Object.assign(window, {VovkPLCEditor})
}
