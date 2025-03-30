// @ts-check
"use strict"

import { ElementSynthesis, importCSS } from "../utils/tools.js"
import { PLC_Project, PLC_ProjectItem } from "../utils/types.js"

await importCSS('./editor/Editor.css')

import Menu from "./ContextMenu.js"
import PLCRuntimeWasm from "../wasm/VovkPLC.js"
import DeviceManager from "./DeviceManager.js"
import WindowManager from "./UI/WindowManager.js"
import ProjectManager from "./ProjectManager.js"
import LanguageManager from "./LanguageManager.js"
import Actions from './Actions.js'
import { ConnectionOptions } from "../connection/index.js"


Actions.initialize() // Enable global actions for all instances of VovkPLCEditor

export class VovkPLCEditor {
    /** @type {PLC_Project} */ project
    /** @type {HTMLElement} */ workspace

    /** @type {number[]} */
    memory = new Array(100).fill(0)
    runtime = new PLCRuntimeWasm()
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


        this.device_manager = new DeviceManager(this)
        this.window_manager = new WindowManager(this)
        this.project_manager = new ProjectManager(this)
        this.workspace_context_menu = new Menu(this)
        this.language_manager = new LanguageManager(this)

        this.window_manager.requestConnect = async (device) => {
            /** @type { ConnectionOptions | null } */
            let options = null
            if (device === 'simulation') {
                options = {
                    target: 'simulation'
                }
            }
            if (device === 'serial') {
                options = {
                    target: 'serial',
                    baudrate: 115200
                }
            }
            if (!options) {
                console.error('No connection options provided')
                return false
            }
            const connection = await this.device_manager.connect(options)
            const connected = connection && !this.device_manager.error
            return !!connected
        }

        this.workspace_context_menu.addListener({
            target: workspace,
            onOpen: () => [
                { type: 'item', name: 'edit', label: 'Edit' },
                { type: 'item', name: 'delete', label: 'Delete' },
                { type: 'separator' },
                { type: 'item', name: 'copy', label: 'Copy' },
                { type: 'item', name: 'paste', label: 'Paste' },
            ],
            onClose: selected => {
                console.log(`Workspace selected: ${selected}`)
            },
        })

        // On ESC remove all selections
        window.addEventListener('keydown', (event) => {
            const esc = event.key === 'Escape'
            const ctrl = event.ctrlKey
            const shift = event.shiftKey
            const alt = event.altKey
            const del = event.key === 'Delete'
            const x = event.key.toLocaleLowerCase() === 'x'
            const c = event.key.toLocaleLowerCase() === 'c'
            const v = event.key.toLocaleLowerCase() === 'v'
            const a = event.key.toLocaleLowerCase() === 'a'
            // if (esc) this.deselectAll()
            // if (ctrl && c) this.copySelection()
            // if (ctrl && x) this.cutSelection()
            // if (ctrl && v) this.pasteSelection()
            // if (del) this.deleteSelection()
        })
    }

    /** @param {PLC_Project} project */
    open(project) {
        this.project_manager.load(project)
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
