import {CSSimporter, debug_components} from '../utils/tools.js'
import {ensureOffsets} from '../utils/offsets.js'
import {PLC_Program, PLC_Project} from '../utils/types.js'

const importCSS = CSSimporter(import.meta.url)
await importCSS('./Editor.css')

import VovkPLC, {VovkPLCWorker} from '../wasm/VovkPLC.js'
import DeviceManager from './DeviceManager.js'
import WindowManager from './UI/WindowManager.js'
import ProjectManager from './ProjectManager.js'
import LanguageManager from './LanguageManager.js'
import ContextManager from './ContextManager.js'
import Actions from './Actions.js'
import EditorUI from './UI/Elements/EditorUI.js'
import VOVKPLC_VERSION_BUILD from './BuildNumber.js'

Actions.initialize() // Enable global actions for all instances of VovkPLCEditor

const isSameNavEntry = (a, b) => {
    if (!a || !b) return false
    if (a.type !== b.type) return false
    if (a.editorId !== b.editorId) return false
    if (a.type === 'code') {
        return a.programId === b.programId && a.blockId === b.blockId && a.line === b.line
    }
    if (a.type === 'window') {
        return a.windowId === b.windowId
    }
    return false
}

const createNavHistory = editor => ({
    stack: [],
    index: -1,
    isNavigating: false,
    validate(entry) {
        if (!entry || !entry.type) return false
        if (entry.type === 'code') {
            const program = editor.findProgram(entry.programId)
            if (!program) return false
            return !!program?.blocks?.find(b => b.id === entry.blockId)
        }
        if (entry.type === 'window') {
            if (entry.windowId === 'symbols' || entry.windowId === 'setup' || entry.windowId === 'memory') return true
            return !!editor.findProgram(entry.windowId)
        }
        return false
    },
    push(entry) {
        if (!entry || this.isNavigating) return
        if (!this.validate(entry)) return
        const last = this.stack[this.index]
        if (isSameNavEntry(last, entry)) return
        if (this.index < this.stack.length - 1) {
            this.stack = this.stack.slice(0, this.index + 1)
        }
        this.stack.push(entry)
        this.index = this.stack.length - 1
    },
    apply(entry) {
        if (!entry) return false
        if (entry.type === 'code') {
            const wm = editor.window_manager
            if (wm && typeof wm.focusCodeLocation === 'function') {
                wm.focusCodeLocation(entry)
                return true
            }
        }
        if (entry.type === 'window') {
            const wm = editor.window_manager
            if (wm && typeof wm.openProgram === 'function') {
                wm.openProgram(entry.windowId)
                return true
            }
        }
        return false
    },
    go(delta) {
        const step = delta >= 0 ? 1 : -1
        let nextIndex = this.index + step
        while (nextIndex >= 0 && nextIndex < this.stack.length) {
            const entry = this.stack[nextIndex]
            if (!this.validate(entry)) {
                this.stack.splice(nextIndex, 1)
                if (nextIndex <= this.index) this.index -= 1
                if (this.index < -1) this.index = -1
                nextIndex = this.index + step
                continue
            }
            this.index = nextIndex
            this.isNavigating = true
            this.apply(entry)
            setTimeout(() => {
                this.isNavigating = false
            }, 0)
            return true
        }
        return false
    },
    back() {
        return this.go(-1)
    },
    forward() {
        return this.go(1)
    },
})

const getGlobalNavState = () => {
    const root = typeof window !== 'undefined' ? window : globalThis
    if (!root.__vovkPlcNavState) {
        root.__vovkPlcNavState = {
            nextEditorId: 1,
            editors: new Map(),
            workspaces: new Map(),
            activeEditorId: null,
            hoverEditorId: null,
            hotkeysBound: false,
        }
    }
    return root.__vovkPlcNavState
}

const bindGlobalNavHotkeys = state => {
    if (!state || state.hotkeysBound) return
    if (typeof document === 'undefined') return
    state.hotkeysBound = true
    const browserHistory = window.history
    const ensureNavIndex = () => {
        if (!browserHistory) return 0
        const current = browserHistory.state || {}
        const index = typeof current.__vovkNavIndex === 'number' ? current.__vovkNavIndex : null
        if (index === null) {
            const nextState = {...current, __vovkNavIndex: 0}
            browserHistory.replaceState(nextState, document.title)
            state.navIndex = 0
            return 0
        }
        state.navIndex = index
        return index
    }
    const pushHoldState = () => {
        if (!browserHistory) return
        const currentIndex = ensureNavIndex()
        const nextIndex = currentIndex + 1
        const currentState = browserHistory.state || {}
        browserHistory.pushState({...currentState, __vovkNavIndex: nextIndex}, document.title)
        state.navIndex = nextIndex
        state.trapHoldIndex = nextIndex
    }
    state.enableHistoryTrap = editorId => {
        if (!editorId) return
        if (state.trapEnabled && state.trapEditorId === editorId) return
        state.trapEnabled = true
        state.trapEditorId = editorId
        pushHoldState()
    }
    state.disableHistoryTrap = editorId => {
        if (!editorId) return
        if (state.trapEditorId !== editorId) return
        state.trapEnabled = false
    }
    if (!state.popstateBound && typeof window !== 'undefined') {
        state.popstateBound = true
        window.addEventListener('popstate', e => {
            if (state.popstateHandling) return
            state.popstateHandling = true
            const newIndex = typeof e?.state?.__vovkNavIndex === 'number' ? e.state.__vovkNavIndex : null
            const oldIndex = typeof state.navIndex === 'number' ? state.navIndex : newIndex
            const dir = newIndex !== null && oldIndex !== null && newIndex !== oldIndex ? (newIndex < oldIndex ? -1 : 1) : 0
            if (newIndex !== null) state.navIndex = newIndex
            if (state.trapEnabled) {
                const editorId = state.hoverEditorId ?? state.activeEditorId ?? state.trapEditorId
                const editor = editorId ? state.editors.get(editorId) : null
                const history = editor?._nav_history
                const skipNav = state.navMouseTriggered && dir !== 0 && dir === state.navMouseDirection
                if (history && !skipNav) {
                    if (dir < 0) history.back()
                    if (dir > 0) history.forward()
                }
                if (skipNav) {
                    state.navMouseTriggered = false
                    state.navMouseDirection = 0
                }
                pushHoldState()
            } else if (state.trapHoldIndex !== null && dir < 0 && !state.suppressBrowserNav) {
                state.suppressBrowserNav = true
                browserHistory.back()
                setTimeout(() => {
                    state.suppressBrowserNav = false
                }, 0)
            }
            setTimeout(() => {
                state.popstateHandling = false
            }, 0)
        })
    }
    document.addEventListener('keydown', e => {
        const isBack = e.key === 'BrowserBack' || (e.altKey && e.key === 'ArrowLeft')
        const isForward = e.key === 'BrowserForward' || (e.altKey && e.key === 'ArrowRight')
        if (!isBack && !isForward) return
        e.preventDefault()
        e.stopPropagation()
        const editorId = state.hoverEditorId ?? state.activeEditorId
        const editor = editorId ? state.editors.get(editorId) : null
        const history = editor?._nav_history
        if (!history) return
        if (isBack) history.back()
        if (isForward) history.forward()
    })
    let navMouseButton = null
    const resolveNavContext = e => {
        const target = e?.target
        const findWorkspace = node => (node && typeof node.closest === 'function' ? node.closest('.plc-workspace') : null)
        let workspace = findWorkspace(target)
        if (!workspace && typeof e?.clientX === 'number' && typeof e?.clientY === 'number') {
            const hit = document.elementFromPoint(e.clientX, e.clientY)
            workspace = findWorkspace(hit)
        }
        if (!workspace && typeof e?.clientX === 'number' && typeof e?.clientY === 'number') {
            const x = e.clientX
            const y = e.clientY
            for (const [el, id] of state.workspaces.entries()) {
                const rect = el.getBoundingClientRect()
                if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                    return {editorId: id, inWorkspace: true}
                }
            }
        }
        if (workspace) {
            return {editorId: state.workspaces.get(workspace) || null, inWorkspace: true}
        }
        const fallbackId = state.hoverEditorId ?? state.activeEditorId
        return {editorId: fallbackId || null, inWorkspace: false}
    }
    const handleNavMouseDown = e => {
        const isBack = e.button === 3
        const isForward = e.button === 4
        if (!isBack && !isForward) return
        const ctx = resolveNavContext(e)
        const editor = ctx.editorId ? state.editors.get(ctx.editorId) : null
        const history = editor?._nav_history
        if (ctx.inWorkspace) {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
        }
        if (!history) return
        navMouseButton = e.button
    }
    const handleNavMouseUp = e => {
        const isBack = e.button === 3
        const isForward = e.button === 4
        if (!isBack && !isForward) return
        const ctx = resolveNavContext(e)
        const editor = ctx.editorId ? state.editors.get(ctx.editorId) : null
        const history = editor?._nav_history
        if (ctx.inWorkspace) {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
        }
        if (!history) return
        if (navMouseButton !== e.button) return
        navMouseButton = null
        if (isBack) history.back()
        if (isForward) history.forward()
        state.navMouseTriggered = true
        state.navMouseDirection = isBack ? -1 : 1
        if (state.navMouseTriggerTimer) clearTimeout(state.navMouseTriggerTimer)
        state.navMouseTriggerTimer = setTimeout(() => {
            state.navMouseTriggered = false
            state.navMouseDirection = 0
        }, 200)
    }
    const handleNavAuxClick = e => {
        const isBack = e.button === 3
        const isForward = e.button === 4
        if (!isBack && !isForward) return
        const ctx = resolveNavContext(e)
        const editor = ctx.editorId ? state.editors.get(ctx.editorId) : null
        const history = editor?._nav_history
        if (ctx.inWorkspace) {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
        }
        if (!history) return
        if (navMouseButton !== null) return
        if (isBack) history.back()
        if (isForward) history.forward()
        state.navMouseTriggered = true
        state.navMouseDirection = isBack ? -1 : 1
        if (state.navMouseTriggerTimer) clearTimeout(state.navMouseTriggerTimer)
        state.navMouseTriggerTimer = setTimeout(() => {
            state.navMouseTriggered = false
            state.navMouseDirection = 0
        }, 200)
    }
    document.addEventListener('mousedown', handleNavMouseDown, true)
    document.addEventListener('mouseup', handleNavMouseUp, true)
    document.addEventListener('auxclick', handleNavAuxClick, true)
}

export class VovkPLCEditor {
    /** @type {PLC_Project} */ project
    /** @type {HTMLElement} */ workspace

    version_build = VOVKPLC_VERSION_BUILD
    static version_build = VOVKPLC_VERSION_BUILD

    memory = new Array(100).fill(0)
    /** @type { VovkPLC | VovkPLCWorker } */
    runtime
    runtime_ready = false
    _lint_state = {
        assembly: '',
        diagnosticsByBlock: new Map(),
        inFlight: null,
        runId: 0,
    }
    edit_locked = false
    live_symbol_values = new Map()

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
                system: {offset: 48, size: 16},
                marker: {offset: 64, size: 16},
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

        const navState = getGlobalNavState()
        this._nav_id = navState.nextEditorId++
        this._nav_history = createNavHistory(this)
        navState.editors.set(this._nav_id, this)
        navState.workspaces.set(this.workspace, this._nav_id)
        bindGlobalNavHotkeys(navState)

        const markActive = () => {
            navState.activeEditorId = this._nav_id
        }
        const markHover = () => {
            navState.hoverEditorId = this._nav_id
            if (typeof navState.enableHistoryTrap === 'function') {
                navState.enableHistoryTrap(this._nav_id)
            }
        }
        const clearHover = () => {
            if (navState.hoverEditorId === this._nav_id) {
                navState.hoverEditorId = null
            }
            if (typeof navState.disableHistoryTrap === 'function') {
                navState.disableHistoryTrap(this._nav_id)
            }
        }
        this.workspace.addEventListener('mousedown', markActive)
        this.workspace.addEventListener('focusin', markActive)
        this.workspace.addEventListener('mouseenter', markHover)
        this.workspace.addEventListener('mouseleave', clearHover)
        this.workspace.addEventListener('mousemove', markHover)
        this.workspace.addEventListener('plc-device-update', () => {
            this._updateOffsetsFromDevice()
        })

        this.runtime = new VovkPLC('/wasm/VovkPLC.wasm')
        this.runtime.initialize().then(() => {
            // Compile 'exit' to flush out any initial runtime logs
            try {
                this.runtime.compile('exit')
            } catch (e) {}
            this.runtime_ready = true
        })
        // VovkPLC.createWorker('/wasm/VovkPLC.wasm', {silent: false}).then(worker => {
        //     this.runtime = worker
        //     this.runtime.downloadBytecode('FF')
        //     this.runtime_ready = true
        // })

        this.context_manager = new ContextManager(this)
        this.window_manager = new WindowManager(this)
        this.device_manager = new DeviceManager(this)
        this.project_manager = new ProjectManager(this)
        this.language_manager = new LanguageManager(this)

        this.context_manager.initialize()
        this.window_manager.initialize()
        this.device_manager.initialize()
        this.project_manager.initialize()
        this.language_manager.initialize()

        if (this.initial_program) {
            this.openProject(this.initial_program)
        }
    }

    /** @param {PLC_Project} project */
    openProject(project) {
        if (this.project_manager && typeof this.project_manager.ensureSystemSymbols === 'function') {
            this.project_manager.ensureSystemSymbols(project)
        }
        this.project = project
        this._updateOffsetsFromDevice()
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
            this.window_manager?._outerLayoutControl?.setNavMinimized(true)
        }
        // this.draw()
    }

    setMonitoringVisuals(enabled) {
        const applyToBlock = block => {
            const editor = block?.props?.text_editor
            if (editor && typeof editor.setMonitoringBackground === 'function') {
                editor.setMonitoringBackground(!!enabled)
            }
        }

        const programs = this._getLintPrograms ? this._getLintPrograms() : []
        if (programs && programs.length) {
            programs.forEach(program => {
                program?.blocks?.forEach(applyToBlock)
            })
        } else if (this.project?.files) {
            this.project.files.forEach(file => {
                if (file.type !== 'program') return
                file?.blocks?.forEach(applyToBlock)
            })
        }
    }

    setEditLock(locked) {
        const next = !!locked
        if (this.edit_locked === next) return
        this.edit_locked = next

        const applyToBlock = block => {
            const editor = block?.props?.text_editor
            if (editor && typeof editor.setReadOnly === 'function') {
                editor.setReadOnly(next)
            }
        }

        const programs = this._getLintPrograms ? this._getLintPrograms() : []
        if (programs && programs.length) {
            programs.forEach(program => {
                program?.blocks?.forEach(applyToBlock)
            })
        } else if (this.project?.files) {
            this.project.files.forEach(file => {
                if (file.type !== 'program') return
                file?.blocks?.forEach(applyToBlock)
            })
        }

        const wm = this.window_manager
        const symbols = wm?.windows?.get('symbols')
        if (symbols && typeof symbols.setLocked === 'function') {
            symbols.setLocked(next)
        }
        const setup = wm?.windows?.get('setup')
        if (setup && typeof setup.setLocked === 'function') {
            setup.setLocked(next)
        }
    }

    _pushWindowHistory(id) {
        if (!id) return
        if (!this._nav_history || !this._nav_id) return
        this._nav_history.push({
            type: 'window',
            editorId: this._nav_id,
            windowId: id,
        })
    }

    _updateOffsetsFromDevice() {
        if (!this.project || !this.device_manager?.connected || !this.device_manager.deviceInfo) return
        const dInfo = this.device_manager.deviceInfo
        const offsets = (this.project.offsets = ensureOffsets(this.project.offsets || {}))

        const map = {
            control: ['control_offset', 'control_size'],
            input: ['input_offset', 'input_size'],
            output: ['output_offset', 'output_size'],
            system: ['system_offset', 'system_size'],
            marker: ['marker_offset', 'marker_size'],
        }

        let changed = false
        for (const [key, [offKey, sizeKey]] of Object.entries(map)) {
            if (typeof dInfo[offKey] === 'number' && typeof dInfo[sizeKey] === 'number') {
                if (offsets[key].offset !== dInfo[offKey] || offsets[key].size !== dInfo[sizeKey]) {
                    offsets[key].offset = dInfo[offKey]
                    offsets[key].size = dInfo[sizeKey]
                    changed = true
                }
            }
        }

        if (changed) {
            // Re-normalize just in case
            this.project.offsets = ensureOffsets(this.project.offsets)

            // Clear caches from all blocks to force re-evaluation with new offsets
            if (this.project.files) {
                this.project.files.forEach(file => {
                    if (file.type === 'program' && Array.isArray(file.blocks)) {
                        file.blocks.forEach(block => { // @ts-ignore
                            delete block.cached_asm // @ts-ignore
                            delete block.cached_checksum // @ts-ignore
                            delete block.cached_symbols_checksum // @ts-ignore
                            delete block.cached_symbol_refs
                        })
                    }
                })
            }

            // Notify UI
            if (this.window_manager?.windows?.get('setup')) {
                this.window_manager.windows.get('setup').render()
            }
        }
        return changed
    }

    /** @param { PLC_Project } project */
    _prepareProject(project) {
        // Clear reserved IDs when loading a new project to prevent conflicts with old IDs
        this.reserved_ids = []
        project.offsets = ensureOffsets(project.offsets || {})
        if (project.symbols && project.symbols.length) {
            project.symbols.forEach(symbol => {
                if (symbol && symbol.location === 'memory') {
                    symbol.location = 'marker'
                }
            })
        }

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
            const system_types = ['symbols', 'setup', 'memory']
            if (system_types.includes(file.type)) return
            // @ts-ignore
            throw new Error(`Invalid child type: ${file.type}`)
        })
    }

    _getLintPrograms() {
        const treeRoot = this.window_manager?.tree_manager?.root
        if (Array.isArray(treeRoot) && treeRoot.length) {
            const programs = treeRoot.filter(node => node.type === 'file' && node.item?.item?.type === 'program').map(node => node.item.item)
            if (programs.length) return programs
        }
        return (this.project?.files || []).filter(file => file.type === 'program')
    }

    _hashString(value) {
        const str = value || ''
        let hash = 0
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i)
            hash |= 0
        }
        return hash >>> 0
    }

    _buildSymbolCache() {
        const project = this.project
        const symbols = project?.symbols || []
        const offsets = ensureOffsets(project?.offsets || {})
        const map = new Map()
        const details = new Map()
        const signatureParts = []

        symbols.forEach(symbol => {
            if (!symbol || !symbol.name) return
            const name = symbol.name
            let baseOffset = 0
            if (symbol.location && offsets[symbol.location]) {
                baseOffset = offsets[symbol.location].offset || 0
            }

            let addressStr = ''
            const rawVal = parseFloat(symbol.address) || 0
            if (symbol.type === 'bit') {
                const byte = Math.floor(rawVal)
                const bit = Math.round((rawVal - byte) * 10)
                addressStr = `${baseOffset + byte}.${bit}`
                details.set(name, {
                    name,
                    type: symbol.type || 'bit',
                    location: symbol.location || '',
                    address: symbol.address,
                    addressLabel: addressStr,
                    absoluteAddress: baseOffset + byte,
                    bit,
                })
            } else {
                addressStr = (baseOffset + Math.floor(rawVal)).toString()
                details.set(name, {
                    name,
                    type: symbol.type || 'byte',
                    location: symbol.location || '',
                    address: symbol.address,
                    addressLabel: addressStr,
                    absoluteAddress: baseOffset + Math.floor(rawVal),
                    bit: null,
                })
            }

            map.set(name, addressStr)
            signatureParts.push(`${name}|${symbol.type || ''}|${symbol.location || ''}|${symbol.address}|${baseOffset}`)
        })

        const signature = this._hashString(signatureParts.join('||')).toString()
        return {map, signature, details}
    }

    _extractAsmAddressRefsFromCode(code, offsets) {
        const normalizedOffsets = offsets || ensureOffsets(this.project?.offsets || {})
        const refs = []
        if (!code) return refs

        // Create a masked version of code where comments and strings are replaced with spaces
        // This ensures the regex doesn't match inside them, but indices remain correct
        let masked = ''
        let state = 'out' // out, string, char, comment
        const limit = code.length

        for (let i = 0; i < limit; i++) {
            const char = code[i]

            if (state === 'out') {
                if (char === '/' && code[i + 1] === '/') {
                    state = 'comment'
                    masked += ' '
                } else if (char === '"') {
                    state = 'string'
                    masked += ' '
                } else if (char === "'") {
                    state = 'char'
                    masked += ' '
                } else {
                    masked += char
                }
            } else if (state === 'comment') {
                if (char === '\n') {
                    state = 'out'
                    masked += '\n'
                } else {
                    masked += ' '
                }
            } else if (state === 'string') {
                masked += ' '
                if (char === '"' && code[i - 1] !== '\\') {
                    state = 'out'
                }
            } else if (state === 'char') {
                masked += ' '
                if (char === "'" && code[i - 1] !== '\\') {
                    state = 'out'
                }
            }
        }

        const locationMap = {
            C: 'control',
            X: 'input',
            Y: 'output',
            M: 'marker',
            S: 'system',
        }
        // Match: 1=Prefix, 2=Byte, 3=Bit (Optional) OR 4=Byte, 5=Bit
        const regex = /\b(?:([CXYMS])(\d+)(?:\.(\d+))?|(\d+)\.(\d+))\b/gi
        let match = null
        while ((match = regex.exec(masked))) {
            let prefix = '',
                byteValStr = '',
                bitRawStr

            if (match[1]) {
                prefix = match[1].toUpperCase()
                byteValStr = match[2]
                bitRawStr = match[3]
            } else {
                // Numeric bit address
                byteValStr = match[4]
                bitRawStr = match[5]
            }

            const byteValue = Number.parseInt(byteValStr, 10)
            if (!Number.isFinite(byteValue)) continue
            const byte = Math.max(0, byteValue)

            const bitValue = typeof bitRawStr === 'undefined' ? null : Number.parseInt(bitRawStr, 10)
            const bit = Number.isFinite(bitValue) ? Math.max(0, Math.min(bitValue, 7)) : null

            let location = 'marker'
            let baseOffset = 0

            if (prefix) {
                location = locationMap[prefix] || 'marker'
                baseOffset = normalizedOffsets[location]?.offset || 0
            } else {
                location = 'memory' // Treated as absolute
                baseOffset = 0
            }

            const addressLabel = bit !== null ? `${byte}.${bit}` : `${byte}`
            const canonicalName = `${prefix}${byte}${bit !== null ? '.' + bit : ''}`
            const absoluteAddress = baseOffset + byte

            refs.push({
                name: canonicalName,
                token: match[0],
                location,
                type: bit !== null ? 'bit' : 'byte',
                address: addressLabel,
                absoluteAddress,
                byte,
                bit,
                start: match.index,
                end: match.index + match[0].length,
            })
        }
        return refs
    }

    _ensureBlockAddressRefs(block, offsets) {
        if (!block) return
        const normalizedOffsets = offsets || ensureOffsets(this.project?.offsets || {})
        block.cached_address_refs = this._extractAsmAddressRefsFromCode(block.code || '', normalizedOffsets)
    }

    _getAsmAddressRefsForLive(offsets) {
        const normalizedOffsets = offsets || ensureOffsets(this.project?.offsets || {})
        const refs = []
        const seen = new Set()
        const programs = (this.project?.files || []).filter(file => file?.type === 'program')
        programs.forEach(program => {
            const blocks = program.blocks || []
            blocks.forEach(block => {
                if (!block || block.type !== 'asm') return
                this._ensureBlockAddressRefs(block, normalizedOffsets)
                const blockRefs = block.cached_address_refs || []
                blockRefs.forEach(ref => {
                    if (!ref || !ref.name) return
                    if (seen.has(ref.name)) return
                    seen.add(ref.name)
                    refs.push(ref)
                })
            })
        })
        return refs
    }

    _buildSymbolRefs(code, symbolDetails) {
        const refs = []
        if (!code || !symbolDetails || symbolDetails.size === 0) return refs
        const re = /\b[A-Za-z_]\w*\b/g
        let match = null
        while ((match = re.exec(code))) {
            const name = match[0]
            const detail = symbolDetails.get(name)
            if (!detail) continue
            refs.push({
                name,
                start: match.index,
                end: match.index + name.length,
                type: detail.type,
                location: detail.location,
                address: detail.addressLabel,
                absoluteAddress: detail.absoluteAddress,
                bit: detail.bit,
            })
        }
        return refs
    }

    _replaceSymbolsOnce(code, symbolMap) {
        const src = code || ''
        if (!symbolMap || symbolMap.size === 0) {
            return {code: src, map: null}
        }
        const map = []
        const re = /\b[A-Za-z_]\w*\b/g
        let out = ''
        let outIndex = 0
        let last = 0
        let match = null

        while ((match = re.exec(src))) {
            const token = match[0]
            const start = match.index
            const end = start + token.length

            if (start > last) {
                const chunk = src.slice(last, start)
                out += chunk
                map.push({
                    outStart: outIndex,
                    outEnd: outIndex + chunk.length,
                    inStart: last,
                    inEnd: start,
                    replaced: false,
                })
                outIndex += chunk.length
            }

            const replacement = symbolMap.get(token)
            if (replacement !== undefined) {
                out += replacement
                map.push({
                    outStart: outIndex,
                    outEnd: outIndex + replacement.length,
                    inStart: start,
                    inEnd: end,
                    replaced: true,
                })
                outIndex += replacement.length
            } else {
                out += token
                map.push({
                    outStart: outIndex,
                    outEnd: outIndex + token.length,
                    inStart: start,
                    inEnd: end,
                    replaced: false,
                })
                outIndex += token.length
            }
            last = end
        }

        if (last < src.length) {
            const chunk = src.slice(last)
            out += chunk
            map.push({
                outStart: outIndex,
                outEnd: outIndex + chunk.length,
                inStart: last,
                inEnd: src.length,
                replaced: false,
            })
        }

        return {code: out, map}
    }

    _ensureAsmCache(block, symbolsSignature, symbolMap, symbolDetails) {
        const code = block.code || ''
        const checksum = this._hashString(code).toString()
        if (block.cached_asm && block.cached_checksum === checksum && block.cached_symbols_checksum === symbolsSignature) {
            if (!block.cached_symbol_refs) {
                block.cached_symbol_refs = this._buildSymbolRefs(code, symbolDetails)
            }
            this._ensureBlockAddressRefs(block)
            return block.cached_asm
        }
        const replaced = this._replaceSymbolsOnce(code, symbolMap)
        block.cached_asm = replaced.code
        block.cached_checksum = checksum
        block.cached_symbols_checksum = symbolsSignature
        block.cached_asm_map = replaced.map
        block.cached_symbol_refs = this._buildSymbolRefs(code, symbolDetails)
        this._ensureBlockAddressRefs(block)
        return block.cached_asm
    }

    _mapCachedRangeToSource(block, start, end) {
        const map = block?.cached_asm_map
        if (!map || !map.length) return {start, end}

        const findSeg = offset => {
            for (const seg of map) {
                if (offset >= seg.outStart && offset < seg.outEnd) return seg
            }
            const last = map[map.length - 1]
            if (last && offset >= last.outEnd) return last
            return null
        }

        const lastOffset = Math.max(start, end - 1)
        const startSeg = findSeg(start)
        const endSeg = findSeg(lastOffset)

        let mappedStart = start
        let mappedEnd = end

        if (startSeg) {
            mappedStart = startSeg.replaced ? startSeg.inStart : startSeg.inStart + (start - startSeg.outStart)
        }

        if (endSeg) {
            if (endSeg.replaced) {
                mappedEnd = endSeg.inEnd
            } else {
                mappedEnd = endSeg.inStart + (lastOffset - endSeg.outStart) + 1
            }
        }

        if (mappedEnd <= mappedStart) mappedEnd = mappedStart + 1
        return {start: mappedStart, end: mappedEnd}
    }

    _buildAsmAssembly(options = {}) {
        const includeHeaders = !!options.includeHeaders
        const onUnsupported = typeof options.onUnsupported === 'function' ? options.onUnsupported : null
        const blocks = []
        let assembly = ''
        const programs = this._getLintPrograms()
        const {map, signature, details} = this._buildSymbolCache()

        if (!programs.length) return {assembly, blocks}

        programs.forEach(file => {
            if (!file.blocks) return
            file.blocks.forEach(block => {
                if (block.type !== 'asm') {
                    if (onUnsupported) onUnsupported(file, block)
                    return
                }
                if (!block.id) block.id = this._generateID(block.id)

                const cached = this._ensureAsmCache(block, signature, map, details)
                const header = includeHeaders ? `// block:${block.id}\n` : ''
                assembly += header
                const codeStart = assembly.length
                const code = cached || ''
                assembly += code
                const codeEnd = assembly.length
                if (!assembly.endsWith('\n')) assembly += '\n'
                blocks.push({block, code, codeStart, codeEnd, program: file})
            })
        })

        return {assembly, blocks}
    }

    _buildLintAssembly() {
        return this._buildAsmAssembly({includeHeaders: true})
    }

    _applyLintDiagnostics(blocks, diagnosticsByBlock) {
        blocks.forEach(({block}) => {
            const editor = block.props?.text_editor
            if (editor && typeof editor.setDiagnostics === 'function') {
                editor.setDiagnostics(diagnosticsByBlock.get(block.id) || [])
            }
        })
    }

    async lintProject() {
        const {assembly, blocks} = this._buildLintAssembly()
        const emptyByBlock = new Map()
        blocks.forEach(({block}) => emptyByBlock.set(block.id, []))

        if (!this.runtime_ready || !this.runtime || typeof this.runtime.lint !== 'function') {
            this._lint_state = {assembly, diagnosticsByBlock: emptyByBlock, inFlight: null, runId: this._lint_state.runId || 0}
            this._applyLintDiagnostics(blocks, emptyByBlock)
            if (this.window_manager?.setConsoleProblems) {
                this.window_manager.setConsoleProblems([])
            }
            return this._lint_state
        }

        if (!assembly.trim()) {
            this._lint_state = {assembly, diagnosticsByBlock: emptyByBlock, inFlight: null, runId: this._lint_state.runId || 0}
            this._applyLintDiagnostics(blocks, emptyByBlock)
            if (this.window_manager?.setConsoleProblems) {
                this.window_manager.setConsoleProblems([])
            }
            return this._lint_state
        }

        if (this._lint_state.assembly === assembly && this._lint_state.diagnosticsByBlock) {
            this._applyLintDiagnostics(blocks, this._lint_state.diagnosticsByBlock)
            return this._lint_state
        }

        if (this._lint_state.inFlight && this._lint_state.inFlight.assembly === assembly) {
            return await this._lint_state.inFlight.promise
        }

        const runId = (this._lint_state.runId || 0) + 1
        this._lint_state.runId = runId

        if (this.window_manager?.setConsoleProblems) {
            this.window_manager.setConsoleProblems({status: 'checking'})
        }

        const promise = (async () => {
            let problems = []
            try {
                const offsets = this.project?.offsets
                if (offsets && typeof this.runtime.setRuntimeOffsets === 'function') {
                    /*
                        // Updated Layout based on new default sizes in plcasm-compiler.h
                        // C: 0 (Size 64)
                        // X: 64 (Size 64)
                        // Y: 128 (Size 64)
                        // S: 192 (Size 256)
                        // M: 448 (Size 256)
                        await runtime.callExport('setRuntimeOffsets', 0, 64, 128, 192, 448)
                    */
                    const normalized = ensureOffsets(offsets)
                    const C = normalized?.control?.offset || 0
                    const X = normalized?.input?.offset || 0
                    const Y = normalized?.output?.offset || 0
                    const S = normalized?.system?.offset || 0
                    const M = normalized?.marker?.offset || 0
                    await this.runtime.setRuntimeOffsets(C, X, Y, S, M)
                }
                problems = await this.runtime.lint(assembly)
            } catch (e) {
                console.error('Lint failed', e)
            }

            const diagnosticsByBlock = new Map()
            const problemsList = []
            blocks.forEach(({block}) => diagnosticsByBlock.set(block.id, []))

            if (problems && problems.length) {
                const lineStarts = [0]
                for (let i = 0; i < assembly.length; i++) {
                    if (assembly[i] === '\n') lineStarts.push(i + 1)
                }

                const toOffset = (line, column) => {
                    const lineIndex = Math.max(0, (line || 1) - 1)
                    const lineStart = lineStarts[lineIndex] ?? 0
                    const colIndex = Math.max(0, (column || 1) - 1)
                    return lineStart + colIndex
                }

                problems.forEach(problem => {
                    const length = Math.max(problem.length || problem.token_text?.length || 1, 1)
                    const start = toOffset(problem.line, problem.column)
                    const end = start + length

                    let target = null
                    for (const info of blocks) {
                        if (start >= info.codeStart && start <= info.codeEnd) {
                            target = info
                            break
                        }
                    }
                    if (!target) return

                    const localStart = Math.max(0, start - target.codeStart)
                    let localEnd = Math.min(target.code.length, end - target.codeStart)
                    if (localEnd <= localStart) {
                        localEnd = Math.min(target.code.length, localStart + 1)
                    }
                    const sourceCode = target.block.code || ''
                    const mapped = this._mapCachedRangeToSource(target.block, localStart, localEnd)
                    const mappedStart = Math.max(0, Math.min(mapped.start, sourceCode.length))
                    let mappedEnd = Math.max(mappedStart + 1, Math.min(mapped.end, sourceCode.length))
                    if (mappedEnd <= mappedStart) mappedEnd = Math.min(sourceCode.length, mappedStart + 1)

                    const list = diagnosticsByBlock.get(target.block.id)
                    if (list) {
                        list.push({
                            type: problem.type || 'error',
                            start: mappedStart,
                            end: mappedEnd,
                            message: problem.message || 'Lint error',
                        })
                    }

                    const before = sourceCode.slice(0, mappedStart)
                    const localLine = before.split('\n').length
                    const lastNl = before.lastIndexOf('\n')
                    const localColumn = mappedStart - (lastNl === -1 ? -1 : lastNl)
                    const language = target.block.language || (target.block.type === 'asm' ? 'plcasm' : target.block.type || '')
                    const stackSource = target.block.language_stack || target.block.languageStack || null
                    const languageStack = Array.isArray(stackSource) ? stackSource.filter(Boolean) : language ? [language] : []
                    problemsList.push({
                        type: problem.type || 'error',
                        message: problem.message || 'Lint error',
                        token: problem.token_text || '',
                        line: localLine,
                        column: localColumn,
                        start: mappedStart,
                        end: mappedEnd,
                        blockId: target.block.id,
                        blockName: target.block.name || '',
                        blockType: target.block.type || '',
                        language,
                        languageStack,
                        programName: target.program?.name || '',
                        programPath: target.program?.full_path || target.program?.path || '',
                        programId: target.program?.id || '',
                    })
                })
            }

            if (this._lint_state.runId !== runId) return this._lint_state

            this._lint_state = {assembly, diagnosticsByBlock, inFlight: null, runId}
            this._applyLintDiagnostics(blocks, diagnosticsByBlock)
            if (this.window_manager?.setConsoleProblems) {
                this.window_manager.setConsoleProblems(problemsList)
            }
            return this._lint_state
        })()

        this._lint_state.inFlight = {assembly, promise}
        const state = await promise
        if (this._lint_state.inFlight?.promise === promise) {
            this._lint_state.inFlight = null
        }
        return state
    }

    async lintBlock(blockId) {
        const state = await this.lintProject()
        return state.diagnosticsByBlock?.get(blockId) || []
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
