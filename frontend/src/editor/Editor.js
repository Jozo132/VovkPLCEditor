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
import LivePatcher from './LivePatcher.js'
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

    memory = new Uint8Array(65536) // 64KB to match DataFetcher buffer and cover all PLC memory regions
    /** @type { VovkPLC | VovkPLCWorker } */
    runtime
    runtime_ready = false
    _lint_state = {
        assembly: '',
        projectText: '',
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
            highlight_color: '#32cd32', // lime green for device mode
            highlight_sim_color: '#00ffff', // cyan for simulation mode
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

    /** @type {{ ladder_id: string | null, program_id: string | null, origin: { x: number, y: number }, selection: Array<{type: 'block' | 'area', x: number, y: number, width?: number, height?: number}> }} */
    ladder_selection = {
        ladder_id: null,
        program_id: null,
        origin: {x: 0, y: 0},
        selection: [],
    }

    /** @type {{ blocks: any[], connections: any[], ladder_id: string | null } | null} */
    ladder_clipboard = null

    /** @param {{ workspace?: HTMLElement | string | null, debug_css?: boolean, debug_context?: boolean, debug_hover?: boolean, initial_program?: string | Object }} options */
    constructor({workspace, debug_css, debug_context, debug_hover, initial_program}) {
        this.initial_program = initial_program || {
            offsets: {
                system: {offset: 0, size: 64},
                input: {offset: 64, size: 64},
                output: {offset: 128, size: 64},
                marker: {offset: 192, size: 256},
            },
            symbols: [],
            // folders: ['/programs/test/b', '/programs/test/a', '/programs/test/c'],
            files: [
                {
                    path: '/',
                    type: 'program',
                    name: 'main',
                    full_path: '/main',
                    blocks: [
                        {
                            type: 'ladder',
                            name: 'Network 1',
                            comment: '',
                            blocks: [],
                            connections: []
                        }
                    ],
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

        // Initialize Program Patcher
        this.program_patcher = new LivePatcher(this)
        this.workspace.addEventListener('plc-device-update', () => {
            this._updateOffsetsFromDevice()
        })

        this.runtime = new VovkPLC('/wasm/VovkPLC.wasm')
        this.runtime_info = null
        this.runtime.initialize().then(async () => {
            // Small delay to ensure WASM internals are fully ready
            await new Promise(r => setTimeout(r, 50))
            // Cache runtime info immediately after initialization (before stream is consumed)
            try {
                const info = await this.runtime.getInfo()
                // If printInfo returned valid object with version, use it
                if (info && typeof info === 'object' && info.version) {
                    this.runtime_info = info
                } else {
                    // Fallback: get version from runtime properties if available
                    const version = this.runtime.version || '0.1.0'
                    const build = this.runtime.build || ''
                    this.runtime_info = {
                        header: 'VovkPLCRuntime',
                        arch: 'WASM',
                        version: build ? `${version} Build ${build}` : version,
                        device: 'Simulator'
                    }
                }
            } catch (e) {
                console.warn('Failed to get runtime info:', e)
                // Provide basic fallback info
                this.runtime_info = {
                    header: 'VovkPLCRuntime',
                    arch: 'WASM',
                    version: '0.1.0',
                    device: 'Simulator'
                }
            }
            // Compile 'exit' to flush out any initial runtime logs
            try {
                this.runtime.compilePLCASM('exit')
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
            system: ['system_offset', 'system_size'],
            input: ['input_offset', 'input_size'],
            output: ['output_offset', 'output_size'],
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

        // Handle timer and counter separately (count * struct_size)
        if (typeof dInfo.timer_offset === 'number' && typeof dInfo.timer_count === 'number' && typeof dInfo.timer_struct_size === 'number') {
            const timerSize = dInfo.timer_count * dInfo.timer_struct_size
            if (offsets.timer.offset !== dInfo.timer_offset || offsets.timer.size !== timerSize) {
                offsets.timer.offset = dInfo.timer_offset
                offsets.timer.size = timerSize
                changed = true
            }
        }
        if (typeof dInfo.counter_offset === 'number' && typeof dInfo.counter_count === 'number' && typeof dInfo.counter_struct_size === 'number') {
            const counterSize = dInfo.counter_count * dInfo.counter_struct_size
            if (offsets.counter.offset !== dInfo.counter_offset || offsets.counter.size !== counterSize) {
                offsets.counter.offset = dInfo.counter_offset
                offsets.counter.size = counterSize
                changed = true
            }
        }

        if (changed) {
            // Re-normalize just in case
            this.project.offsets = ensureOffsets(this.project.offsets)

            // Clear caches from all blocks to force re-evaluation with new offsets
            if (this.project.files) {
                this.project.files.forEach(file => {
                    if (file.type === 'program' && Array.isArray(file.blocks)) {
                        file.blocks.forEach(block => {
                            // @ts-ignore
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
            const system_types = ['symbols', 'setup', 'memory', 'datablocks', 'datablock']
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
            // Timer uses 9 bytes per unit, Counter uses 5 bytes per unit
            const structSize = symbol.location === 'timer' ? 9 : symbol.location === 'counter' ? 5 : 1

            let addressStr = ''
            const rawVal = parseFloat(symbol.address) || 0
            if (symbol.type === 'bit') {
                const byte = Math.floor(rawVal)
                const bit = Math.round((rawVal - byte) * 10)
                addressStr = `${baseOffset + byte * structSize}.${bit}`
                details.set(name, {
                    name,
                    type: symbol.type || 'bit',
                    location: symbol.location || '',
                    address: symbol.address,
                    addressLabel: addressStr,
                    absoluteAddress: baseOffset + byte * structSize,
                    bit,
                })
            } else {
                addressStr = (baseOffset + Math.floor(rawVal) * structSize).toString()
                details.set(name, {
                    name,
                    type: symbol.type || 'byte',
                    location: symbol.location || '',
                    address: symbol.address,
                    addressLabel: addressStr,
                    absoluteAddress: baseOffset + Math.floor(rawVal) * structSize,
                    bit: null,
                })
            }

            map.set(name, addressStr)
            signatureParts.push(`${name}|${symbol.type || ''}|${symbol.location || ''}|${symbol.address}|${baseOffset}`)
        })

        const signature = this._hashString(signatureParts.join('||')).toString()
        return {map, signature, details}
    }

    /**
     * Rename a symbol across the entire project: symbol table, all block code, and watch entries.
     * @param {string} oldName - The current symbol name
     * @param {string} newName - The new symbol name
     * @returns {{ success: boolean, message?: string, replacements?: number }}
     */
    renameSymbol(oldName, newName) {
        if (!oldName || !newName || oldName === newName) return { success: false, message: 'Invalid names' }
        if (!this.project) return { success: false, message: 'No project loaded' }

        // Validate new name: must be a valid identifier
        if (!/^[A-Za-z_]\w*$/.test(newName)) return { success: false, message: 'Invalid symbol name. Must start with a letter or underscore and contain only letters, digits, and underscores.' }

        // Check for conflicts with existing symbols
        const symbols = this.project.symbols || []
        const conflict = symbols.find(s => s.name === newName)
        if (conflict) return { success: false, message: `Symbol "${newName}" already exists` }

        let replacements = 0
        const wordBoundaryReplace = (text, old, replacement) => {
            const re = new RegExp(`\\b${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
            let count = 0
            const result = text.replace(re, () => { count++; return replacement })
            return { result, count }
        }

        // 1. Rename in symbol table
        const sym = symbols.find(s => s.name === oldName)
        if (sym) {
            sym.name = newName
            replacements++
        }

        // 2. Replace in all block code across all program files
        const files = this.project.files || []
        files.forEach(file => {
            if (file.type !== 'program' || !Array.isArray(file.blocks)) return
            file.blocks.forEach(block => {
                // Text-based languages (STL, ST, PLCScript, ASM)
                if (block.code) {
                    const { result, count } = wordBoundaryReplace(block.code, oldName, newName)
                    if (count > 0) {
                        block.code = result
                        replacements += count
                        // Invalidate caches
                        delete block.cached_asm
                        delete block.cached_checksum
                        delete block.cached_symbols_checksum
                        delete block.cached_symbol_refs
                    }
                }
                // Ladder blocks store symbol refs in nodes
                if (Array.isArray(block.nodes)) {
                    for (const node of block.nodes) {
                        if (node.symbol === oldName) { node.symbol = newName; replacements++ }
                        if (node.in1 === oldName) { node.in1 = newName; replacements++ }
                        if (node.in2 === oldName) { node.in2 = newName; replacements++ }
                        if (node.out === oldName) { node.out = newName; replacements++ }
                        // Clear cached state so it gets re-resolved
                        if (node.state) node.state = undefined
                    }
                    // Invalidate caches
                    delete block.cached_asm
                    delete block.cached_checksum
                    delete block.cached_symbols_checksum
                    delete block.cached_symbol_refs
                }
            })
        })

        // 3. Replace in watch entries
        const watchPanel = this.window_manager?.watch_panel
        if (watchPanel && Array.isArray(watchPanel.entries)) {
            watchPanel.entries.forEach(entry => {
                if (entry.name === oldName) {
                    entry.name = newName
                    replacements++
                }
            })
            watchPanel.renderList()
        }

        // 4. Refresh symbol table UI
        const symbolsUI = this.window_manager?.windows?.get('symbols')
        if (symbolsUI && typeof symbolsUI.renderTable === 'function') {
            symbolsUI.renderTable()
        }

        // 5. Save project
        if (this.project_manager && typeof this.project_manager.checkAndSave === 'function') {
            this.project_manager.checkAndSave()
        }

        // 6. Re-render ladder diagrams (they use block.symbol, not block.code)
        if (this.ladder_render_registry) {
            for (const key in this.ladder_render_registry) {
                if (typeof this.ladder_render_registry[key] === 'function') {
                    this.ladder_render_registry[key]()
                }
            }
        }

        return { success: true, replacements }
    }

    /**
     * Scan the entire project for references to a given name (symbol or DB field).
     * Returns a list of locations where the name is used.
     * @param {string} searchName - The name to search for (e.g. "mySymbol", "DB1.fieldName")
     * @returns {{ program: string, block: string, blockType: string, line?: number, col?: number, x?: number, y?: number, preview: string }[]}
     */
    scanReferences(searchName) {
        if (!searchName || !this.project) return []
        const results = []
        const escaped = searchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`\\b${escaped}\\b`, 'g')

        const files = this.project.files || []
        for (const file of files) {
            if (file.type !== 'program' || !Array.isArray(file.blocks)) continue
            for (const block of file.blocks) {
                const blockName = block.name || block.id || '(unnamed)'
                // Text-based languages (STL, ST, PLCScript, ASM)
                if (block.code) {
                    const lines = block.code.split('\n')
                    for (let i = 0; i < lines.length; i++) {
                        let match
                        re.lastIndex = 0
                        while ((match = re.exec(lines[i])) !== null) {
                            const preview = lines[i].trim()
                            results.push({
                                program: file.name || file.id,
                                block: blockName,
                                blockType: block.type || 'unknown',
                                line: i + 1,
                                col: match.index,
                                preview: preview.length > 60 ? preview.slice(0, 57) + '...' : preview,
                            })
                        }
                    }
                }
                // Ladder blocks store symbol refs in nodes
                if (Array.isArray(block.nodes)) {
                    for (const node of block.nodes) {
                        const fields = ['symbol', 'in1', 'in2', 'out']
                        for (const f of fields) {
                            if (node[f] && re.test(node[f])) {
                                re.lastIndex = 0
                                results.push({
                                    program: file.name || file.id,
                                    block: blockName,
                                    blockType: 'ladder',
                                    x: node.x,
                                    y: node.y,
                                    preview: `${node.type || 'node'} [${f}=${node[f]}]`,
                                })
                            }
                        }
                    }
                }
            }
        }
        return results
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
            C: 'counter',
            T: 'timer',
            X: 'input',
            Y: 'output',
            M: 'marker',
            S: 'system',
            I: 'input',
            Q: 'output',
        }
        // Match: 1=Prefix, 2=Byte, 3=Bit (Optional) OR 4=Byte, 5=Bit
        // Extended to support I/Q (Siemens style)
        const regex = /\b(?:([CTXYMSIQ])(\d+)(?:\.(\d+))?|(\d+)\.(\d+))\b/gi
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
            let structSize = 1 // Default: 1 byte per address unit

            if (prefix) {
                location = locationMap[prefix] || 'marker'
                baseOffset = normalizedOffsets[location]?.offset || 0
                // Timer (T) uses 9 bytes per unit, Counter (C) uses 5 bytes per unit
                if (prefix === 'T') structSize = 9
                else if (prefix === 'C') structSize = 5
            } else {
                location = 'memory' // Treated as absolute
                baseOffset = 0
            }

            const addressLabel = bit !== null ? `${byte}.${bit}` : `${byte}`
            const canonicalName = `${prefix}${byte}${bit !== null ? '.' + bit : ''}`
            const absoluteAddress = baseOffset + byte * structSize

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

    _extractAsmTimerRefsFromCode(code, offsets, symbolDetails) {
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

        // Match timer instructions: ton/tof/tp storage preset
        // Preset can be #123 (raw ms) or T#... (IEC style, e.g. T#5s, T#1h30m)
        // Supports both ASM space separation (TON T0 T#5s) and STL comma separation (TON T0, T#5s)
        const timerRegex = /\b(?:u8\.)?(ton|tof|tp)\b\s+([A-Za-z_]\w*(?:\.\d+)?|[CTXYMS]\d+(?:\.\d+)?)\s*(?:,|\s)\s*((?:T#[A-Za-z0-9_]+|#\d+)|[A-Za-z_]\w*(?:\.\d+)?|[CTXYMS]\d+(?:\.\d+)?)\b/gi

        let match = null
        while ((match = timerRegex.exec(masked))) {
            const instr = match[1].toLowerCase()
            const storageToken = match[2]
            const presetToken = match[3]

            const storageStart = match.index + match[0].indexOf(storageToken)
            const presetStart = match.index + match[0].lastIndexOf(presetToken)

            let storageAddr = -1

            const addrMatch = /^(?:([CTXYMS])(\d+)(?:\.(\d+))?|(\d+)\.(\d+))$/i.exec(storageToken)
            if (addrMatch) {
                let prefix = addrMatch[1] ? addrMatch[1].toUpperCase() : ''
                let byte = parseInt(addrMatch[2] || addrMatch[4], 10)
                let loc = prefix ? {C: 'counter', T: 'timer', X: 'input', Y: 'output', M: 'marker', S: 'system'}[prefix] || 'marker' : 'memory'
                let base = loc === 'memory' ? 0 : normalizedOffsets[loc]?.offset || 0
                // Timer (T) uses 9 bytes per unit, Counter (C) uses 5 bytes per unit
                let structSize = prefix === 'T' ? 9 : prefix === 'C' ? 5 : 1
                storageAddr = base + byte * structSize
            } else if (symbolDetails && symbolDetails.has(storageToken)) {
                const sym = symbolDetails.get(storageToken)
                storageAddr = sym.absoluteAddress
            }

            // Helper to parse preset value
            const parsePreset = token => {
                if (token.startsWith('#')) return parseInt(token.substring(1), 10)
                if (token.toUpperCase().startsWith('T#')) {
                    const content = token.substring(2)
                    // Parse multi-part time strings, e.g. "1h30m", "4h3s", "250ms"
                    const partRegex = /(\d+)(ms|s|m|h|d)/gi
                    let totalMs = 0
                    let hasMatch = false
                    let pMatch

                    while ((pMatch = partRegex.exec(content))) {
                        hasMatch = true
                        const val = parseInt(pMatch[1], 10)
                        const unit = pMatch[2].toLowerCase()
                        if (unit === 's') totalMs += val * 1000
                        else if (unit === 'm') totalMs += val * 60000
                        else if (unit === 'h') totalMs += val * 3600000
                        else if (unit === 'd') totalMs += val * 86400000
                        else totalMs += val // ms
                    }

                    if (hasMatch) return totalMs

                    // Fallback for just numbers (technically invalid IEC but good to handle)
                    const simple = parseInt(content, 10)
                    return isNaN(simple) ? null : simple
                }
                return null
            }

            const parsedVal = parsePreset(presetToken)
            const isConstant = parsedVal !== null

            let presetAddr = -1
            if (!isConstant) {
                const pAddrMatch = /^(?:([CTXYMS])(\d+)(?:\.(\d+))?|(\d+)\.(\d+))$/i.exec(presetToken)
                if (pAddrMatch) {
                    let prefix = pAddrMatch[1] ? pAddrMatch[1].toUpperCase() : ''
                    let byte = parseInt(pAddrMatch[2] || pAddrMatch[4], 10)
                    let loc = prefix ? {C: 'counter', T: 'timer', X: 'input', Y: 'output', M: 'marker', S: 'system'}[prefix] || 'marker' : 'memory'
                    let base = loc === 'memory' ? 0 : normalizedOffsets[loc]?.offset || 0
                    // Timer (T) uses 9 bytes per unit, Counter (C) uses 5 bytes per unit
                    let structSize = prefix === 'T' ? 9 : prefix === 'C' ? 5 : 1
                    presetAddr = base + byte * structSize
                } else if (symbolDetails && symbolDetails.has(presetToken)) {
                    const sym = symbolDetails.get(presetToken)
                    presetAddr = sym.absoluteAddress
                }
            }

            if (storageAddr !== -1) {
                // Use stable name based on storage address instead of text position
                const storageRef = {
                    name: `tim_storage_M${storageAddr}`,
                    originalName: storageToken,
                    type: 'u32',
                    absoluteAddress: storageAddr,
                    start: storageStart,
                    end: storageStart + storageToken.length,
                    isTimerStorage: true,
                    timerType: instr,
                    storageAddress: storageAddr,
                }
                if (isConstant) {
                    storageRef.presetValue = parsedVal
                } else {
                    storageRef.presetName = presetToken
                    if (presetAddr !== -1) storageRef.presetAddress = presetAddr
                }
                refs.push(storageRef)

                // Add timer Q output state pill (flags byte at offset +8, bit 0)
                refs.push({
                    name: `tim_output_M${storageAddr}`,
                    originalName: 'Q',
                    type: 'bit',
                    absoluteAddress: storageAddr + 8, // Flags byte at offset +8
                    bitOffset: 0, // TIMER_FLAG_Q is bit 0
                    start: storageStart, // Position before storage token
                    end: storageStart, // Zero-width, rendered as pill
                    isTimerOutput: true,
                    timerType: instr,
                    storageAddress: storageAddr,
                })
            }

            if (isConstant) {
                const val = parsedVal
                // Use stable name based on timer storage address instead of text position
                // e.g., "tim_const_M192_p2" instead of "tim_const_p2@t73"
                // This way the name doesn't change when you edit code before it
                const timerName = storageAddr !== -1 ? `M${storageAddr}` : `pos${presetStart}`
                refs.push({
                    name: `tim_const_${timerName}_p2`,
                    originalName: presetToken,
                    type: 'u32',
                    value: val,
                    start: presetStart,
                    end: presetStart + presetToken.length,
                    isTimerPT: true,
                    storageAddress: storageAddr,
                    presetValue: val,
                })
            } else {
                if (presetAddr !== -1) {
                    // Use stable name based on preset memory address
                    refs.push({
                        name: `tim_memory_M${presetAddr}`,
                        originalName: presetToken,
                        type: 'u32',
                        absoluteAddress: presetAddr,
                        start: presetStart,
                        end: presetStart + presetToken.length,
                        isTimerPT: true,
                        storageAddress: storageAddr,
                        isPresetAddress: true,
                    })
                }
            }
        }
        return refs
    }

    _ensureBlockAddressRefs(block, offsets, symbolDetails) {
        if (!block) return
        const normalizedOffsets = offsets || ensureOffsets(this.project?.offsets || {})
        block.cached_address_refs = this._extractAsmAddressRefsFromCode(block.code || '', normalizedOffsets)
        block.cached_timer_refs = this._extractAsmTimerRefsFromCode(block.code || '', normalizedOffsets, symbolDetails)
    }

    _getAsmAddressRefsForLive(offsets) {
        const normalizedOffsets = offsets || ensureOffsets(this.project?.offsets || {})
        const {details: symbolDetails} = this._buildSymbolCache()
        const refs = []
        const seen = new Set()
        const programs = (this.project?.files || []).filter(file => file?.type === 'program')
        programs.forEach(program => {
            const blocks = program.blocks || []
            blocks.forEach(block => {
                if (!block) return

                // Handle ASM/STL/PLCScript/ST blocks
                if (block.type === 'asm' || block.type === 'stl' || block.type === 'plcscript' || block.type === 'st') {
                    this._ensureBlockAddressRefs(block, normalizedOffsets, symbolDetails)
                    const blockRefs = [...(block.cached_address_refs || []), ...(block.cached_timer_refs || [])]
                    blockRefs.forEach(ref => {
                        if (!ref || !ref.name) return
                        if (seen.has(ref.name)) return
                        seen.add(ref.name)
                        refs.push(ref)
                    })
                }

                // Handle Ladder blocks - collect timer symbols for monitoring
                if (block.type === 'ladder' && block.blocks) {
                    block.blocks.forEach(ladderBlock => {
                        if (!ladderBlock || !ladderBlock.symbol) return
                        const isTimer = ['timer_ton', 'timer_tof', 'timer_tp'].includes(ladderBlock.type)
                        if (!isTimer) return

                        const symbolName = ladderBlock.symbol
                        if (seen.has(symbolName)) return
                        seen.add(symbolName)

                        // Parse the timer address (e.g., T0, T1)
                        const match = symbolName.match(/^[tT]([0-9]+)$/i)
                        if (match) {
                            const timerIndex = parseInt(match[1], 10)
                            const timerOffset = normalizedOffsets.timer?.offset || 704
                            // Timer storage is 9 bytes per timer unit in memory layout
                            const absoluteAddress = timerOffset + timerIndex * 9
                            refs.push({
                                name: symbolName,
                                location: 'timer',
                                type: 'u32', // Timer elapsed time is u32
                                address: timerIndex,
                                absoluteAddress: absoluteAddress,
                            })
                        }
                    })
                }
            })
        })
        return refs
    }

    _buildSymbolRefs(code, symbolDetails) {
        const refs = []
        if (!code || !symbolDetails || symbolDetails.size === 0) return refs

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

        const re = /\b[A-Za-z_]\w*\b/g
        let match = null
        while ((match = re.exec(masked))) {
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
            this._ensureBlockAddressRefs(block, null, symbolDetails)
            return block.cached_asm
        }
        const replaced = this._replaceSymbolsOnce(code, symbolMap)
        block.cached_asm = replaced.code
        block.cached_checksum = checksum
        block.cached_symbols_checksum = symbolsSignature
        block.cached_asm_map = replaced.map
        block.cached_symbol_refs = this._buildSymbolRefs(code, symbolDetails)
        this._ensureBlockAddressRefs(block, null, symbolDetails)
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
                // Handle ASM, STL, PLCScript, ST, and Ladder block types
                if (block.type !== 'asm' && block.type !== 'stl' && block.type !== 'plcscript' && block.type !== 'st' && block.type !== 'ladder') {
                    if (onUnsupported) onUnsupported(file, block)
                    return
                }
                if (!block.id) block.id = this._generateID(block.id)

                let code = ''

                if (block.type === 'stl') {
                    // STL blocks need to be transpiled to PLCASM
                    // The transpilation will be done during compilation in ProjectManager
                    // For now, mark it with a special header so the compiler knows to transpile it
                    const stlCode = block.code || ''
                    code = `// stl_block_start\n${stlCode}\n// stl_block_end\n`
                } else if (block.type === 'plcscript') {
                    // PLCScript blocks need to be transpiled to PLCASM
                    // Mark with special header for transpilation
                    const plcscriptCode = block.code || ''
                    code = `// plcscript_block_start\n${plcscriptCode}\n// plcscript_block_end\n`
                } else if (block.type === 'st') {
                    // Structured Text (IEC 61131-3) blocks need to be transpiled to PLCScript then to PLCASM
                    // Mark with special header for transpilation
                    const stCode = block.code || ''
                    code = `// st_block_start\n${stCode}\n// st_block_end\n`
                } else if (block.type === 'ladder') {
                    // Ladder blocks need to be compiled to JSON, then transpiled
                    // The transpilation chain: LADDER JSON -> STL -> PLCASM
                    const ladderLang = this.language_manager.getLanguage('ladder')
                    if (ladderLang && ladderLang.compile) {
                        code = ladderLang.compile(block)
                    } else {
                        console.warn('Ladder language module not found')
                        code = '// ladder block skipped - language module not available\n'
                    }
                } else {
                    // ASM blocks use the cache
                    code = this._ensureAsmCache(block, signature, map, details) || ''
                }

                const header = includeHeaders ? `// block:${block.id}\n` : ''
                assembly += header
                const codeStart = assembly.length
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

    async _transpileSTLForLinting(assembly) {
        // Transpile Ladder blocks to PLCASM before STL
        let result = await this._transpileLadderForLinting(assembly)

        // Transpile ST (Structured Text) blocks to PLCScript then to PLCASM
        result = await this._transpileBlocksForLinting(result, 'st', /\/\/ st_block_start\n([\s\S]*?)\/\/ st_block_end\n/g)
        
        // Transpile PLCScript blocks to PLCASM
        result = await this._transpileBlocksForLinting(result, 'plcscript', /\/\/ plcscript_block_start\n([\s\S]*?)\/\/ plcscript_block_end\n/g)

        // Then transpile STL blocks to PLCASM
        result = await this._transpileBlocksForLinting(result, 'stl', /\/\/ stl_block_start\n([\s\S]*?)\/\/ stl_block_end\n/g)

        return result
    }

    async _transpileBlocksForLinting(assembly, language, regex) {
        let result = assembly
        let match
        const replacements = []

        while ((match = regex.exec(result)) !== null) {
            const code = match[1]
            const fullMatch = match[0]
            const startIndex = match.index

            try {
                // Dispatch to the correct language-specific compiler
                let compileResult
                if (language === 'plcscript') compileResult = await this.runtime.compilePLCScript(code)
                else if (language === 'stl') compileResult = await this.runtime.compileSTL(code)
                else if (language === 'st') compileResult = await this.runtime.compileST(code)
                else throw new Error(`Unsupported language for transpilation: ${language}`)
                if (compileResult && compileResult.output) {
                    replacements.push({
                        start: startIndex,
                        end: startIndex + fullMatch.length,
                        replacement: compileResult.output + '\n',
                    })
                }
            } catch (e) {
                // If transpilation fails, replace with empty comment
                // Errors are already caught by the respective linters
                replacements.push({
                    start: startIndex,
                    end: startIndex + fullMatch.length,
                    replacement: `// ${language.toUpperCase()} block with errors\n`,
                })
            }
        }

        // Apply replacements in reverse order to preserve indices
        replacements.sort((a, b) => b.start - a.start)
        for (const r of replacements) {
            result = result.slice(0, r.start) + r.replacement + result.slice(r.end)
        }

        return result
    }

    async _transpileLadderForLinting(assembly) {
        // Transpile Ladder Graph blocks to PLCASM via Ladder Graph -> STL -> PLCASM chain
        const ladderGraphRegex = /\/\/ ladder_graph_start\n([\s\S]*?)\/\/ ladder_graph_end\n/g
        let result = assembly
        let match
        const replacements = []

        while ((match = ladderGraphRegex.exec(assembly)) !== null) {
            const graphJson = match[1].trim()
            const fullMatch = match[0]
            const startIndex = match.index

            try {
                // Parse the graph JSON
                let parsedGraph = null
                try {
                    parsedGraph = JSON.parse(graphJson)
                } catch (parseErr) {
                    throw new Error('Invalid ladder graph JSON')
                }

                // Skip if no nodes
                if (!parsedGraph.nodes || parsedGraph.nodes.length === 0) {
                    throw new Error('No nodes in graph')
                }

                // Check if compileLadder is available
                if (typeof this.runtime.compileLadder !== 'function') {
                    throw new Error('Ladder Graph compiler not available')
                }

                // Step 1: Ladder Graph JSON -> STL
                const ladderResult = await this.runtime.compileLadder(graphJson)
                if (!ladderResult || !ladderResult.output) {
                    throw new Error('Ladder Graph compilation returned no output')
                }

                // Step 2: STL -> PLCASM
                const stlResult = await this.runtime.compileSTL(ladderResult.output)
                if (stlResult && stlResult.output) {
                    replacements.push({
                        start: startIndex,
                        end: startIndex + fullMatch.length,
                        replacement: stlResult.output + '\n',
                    })
                }
            } catch (e) {
                // If transpilation fails, replace with empty comment
                replacements.push({
                    start: startIndex,
                    end: startIndex + fullMatch.length,
                    replacement: '// Ladder graph with errors\n',
                })
            }
        }

        // Apply replacements in reverse order to preserve indices
        replacements.sort((a, b) => b.start - a.start)
        for (const r of replacements) {
            result = result.slice(0, r.start) + r.replacement + result.slice(r.end)
        }

        return result
    }

    _applyLintDiagnostics(blocks, diagnosticsByBlock) {
        blocks.forEach(({block}) => {
            const diagnostics = diagnosticsByBlock.get(block.id) || []
            
            if (block.type === 'ladder') {
                // For ladder blocks, store diagnostics on props and trigger re-render
                if (!block.props) block.props = {}
                block.props.diagnostics = diagnostics
                // Trigger re-render if renderer is available
                if (this.language_manager) {
                    const renderer = this.language_manager.getRenderer('ladder')
                    if (renderer && typeof renderer.render === 'function') {
                        renderer.render(this, block)
                    }
                }
            } else {
                // For text-based blocks (STL/ASM), use the text_editor
                const editor = block.props?.text_editor
                if (editor && typeof editor.setDiagnostics === 'function') {
                    editor.setDiagnostics(diagnostics)
                }
            }
        })
    }

    async lintProject() {
        // Use project-based linting if available
        if (this.runtime_ready && this.runtime && typeof this.runtime.lintProject === 'function' && this.project_manager) {
            return await this._lintProjectBased()
        }

        // Fallback to assembly-based linting
        return await this._lintAssemblyBased()
    }

    async _lintProjectBased() {
        const programs = this._getLintPrograms()
        const emptyByBlock = new Map()
        const blocks = []

        // Build block list for applying diagnostics
        programs.forEach(file => {
            if (!file.blocks) return
            file.blocks.forEach(block => {
                if (!block.id) block.id = this._generateID(block.id)
                emptyByBlock.set(block.id, [])
                blocks.push({block, program: file})
            })
        })

        // Build project text for linting
        let projectText = ''
        try {
            projectText = this.project_manager.buildProjectText()
        } catch (e) {
            console.warn('Failed to build project text for linting:', e)
            this._lint_state = {assembly: '', projectText: '', diagnosticsByBlock: emptyByBlock, inFlight: null, runId: this._lint_state.runId || 0}
            this._applyLintDiagnostics(blocks, emptyByBlock)
            if (this.window_manager?.setConsoleProblems) {
                this.window_manager.setConsoleProblems([])
            }
            return this._lint_state
        }

        if (!projectText.trim()) {
            this._lint_state = {assembly: '', projectText: '', diagnosticsByBlock: emptyByBlock, inFlight: null, runId: this._lint_state.runId || 0}
            this._applyLintDiagnostics(blocks, emptyByBlock)
            if (this.window_manager?.setConsoleProblems) {
                this.window_manager.setConsoleProblems([])
            }
            return this._lint_state
        }

        // Check if we already have results for this project text
        if (this._lint_state.projectText === projectText && this._lint_state.diagnosticsByBlock) {
            this._applyLintDiagnostics(blocks, this._lint_state.diagnosticsByBlock)
            return this._lint_state
        }

        // Check if there's already a request in flight for this text
        if (this._lint_state.inFlight && this._lint_state.inFlight.projectText === projectText) {
            return await this._lint_state.inFlight.promise
        }

        const runId = (this._lint_state.runId || 0) + 1
        this._lint_state.runId = runId

        if (this.window_manager?.setConsoleProblems) {
            this.window_manager.setConsoleProblems({status: 'checking'})
        }

        const promise = (async () => {
            const diagnosticsByBlock = new Map()
            const problemsList = []
            blocks.forEach(({block}) => diagnosticsByBlock.set(block.id, []))

            try {
                // Call the runtime's lintProject API
                const problems = await this.runtime.lintProject(projectText)

                if (problems && problems.length) {
                    console.log(`Project lint found ${problems.length} problems:`, problems)
                    for (const problem of problems) {
                        // Find the matching block by name
                        const blockName = problem.block || ''
                        const programName = problem.program || ''

                        let target = null
                        for (const info of blocks) {
                            const blockMatches = !blockName || info.block.name === blockName
                            const programMatches = !programName || info.program?.name === programName || info.program?.path === programName || info.program?.full_path === programName
                            if (blockMatches && programMatches) {
                                // For ladder blocks with a token, verify the token exists in this block
                                if (info.block.type === 'ladder' && problem.token) {
                                    const token = problem.token
                                    // Check if token is a connection reference (c[index])
                                    const connMatch = token.match(/^c\[(\d+)\]$/)
                                    if (connMatch) {
                                        const connIndex = parseInt(connMatch[1], 10)
                                        const connections = info.block.connections || []
                                        if (connIndex >= connections.length) continue // Connection index out of range
                                    } else {
                                        // Token is a node ID
                                        const nodes = info.block.nodes || info.block.blocks || []
                                        const hasToken = nodes.some(n => n.id === token)
                                        if (!hasToken) continue // Token not in this ladder, keep looking
                                    }
                                }
                                target = info
                                break
                            }
                        }

                        // Calculate local position within block's code
                        let localLine = problem.line || 1
                        let localColumn = problem.column || 1
                        let localStart = 0
                        let localEnd = 1

                        if (target && (target.block.type === 'stl' || target.block.type === 'asm' || target.block.type === 'plcscript' || target.block.type === 'st')) {
                            const code = target.block.code || ''
                            const lines = code.split('\n')
                            const lineStarts = [0]
                            for (let i = 0; i < lines.length; i++) {
                                lineStarts.push(lineStarts[i] + lines[i].length + 1)
                            }
                            const lineIndex = Math.max(0, localLine - 1)
                            const colIndex = Math.max(0, localColumn - 1)
                            localStart = (lineStarts[lineIndex] ?? 0) + colIndex
                            localEnd = localStart + (problem.length || 1)

                            // Add to diagnostics for this block
                            const list = diagnosticsByBlock.get(target.block.id) || []
                            list.push({
                                type: problem.type || 'error',
                                start: localStart,
                                end: localEnd,
                                message: problem.message || 'Lint error',
                            })
                            diagnosticsByBlock.set(target.block.id, list)
                        } else if (target && target.block.type === 'ladder') {
                            // For ladder blocks, store the token and let renderer resolve position
                            // This ensures highlighting follows nodes when they move
                            const list = diagnosticsByBlock.get(target.block.id) || []
                            list.push({
                                type: problem.type || 'error',
                                token: problem.token || '',
                                // Fallback cell positions if token lookup fails
                                fallbackCellX: (problem.column || 1) - 1,
                                fallbackCellY: (problem.line || 1) - 1,
                                message: problem.message || 'Lint error',
                            })
                            diagnosticsByBlock.set(target.block.id, list)
                        }

                        // Add to problems list for the console panel
                        const langMap = {1: 'plcasm', 2: 'stl', 3: 'ladder'}
                        const language = problem.compiler?.toLowerCase() || langMap[problem.lang] || target?.block.type || ''

                        problemsList.push({
                            type: problem.type || 'error',
                            message: problem.message || 'Lint error',
                            token: problem.token || '',
                            line: localLine,
                            column: localColumn,
                            start: localStart,
                            end: localEnd,
                            blockId: target?.block.id || '',
                            blockName: blockName || target?.block.name || '',
                            blockType: target?.block.type || '',
                            language,
                            languageStack: [language].filter(Boolean),
                            programName: programName || target?.program?.name || '',
                            programPath: target?.program?.full_path || target?.program?.path || '',
                            programId: target?.program?.id || '',
                        })
                    }
                }
            } catch (e) {
                console.error('Project lint failed', e)
            }

            if (this._lint_state.runId !== runId) return this._lint_state

            this._lint_state = {assembly: '', projectText, diagnosticsByBlock, inFlight: null, runId}
            this._applyLintDiagnostics(blocks, diagnosticsByBlock)
            if (this.window_manager?.setConsoleProblems) {
                this.window_manager.setConsoleProblems(problemsList)
            }
            return this._lint_state
        })()

        this._lint_state.inFlight = {projectText, promise}
        const state = await promise
        if (this._lint_state.inFlight?.promise === promise) {
            this._lint_state.inFlight = null
        }
        return state
    }

    async _lintAssemblyBased() {
        const {assembly, blocks} = this._buildLintAssembly()
        const emptyByBlock = new Map()
        blocks.forEach(({block}) => emptyByBlock.set(block.id, []))

        if (!this.runtime_ready || !this.runtime || typeof this.runtime.lintPLCASM !== 'function') {
            this._lint_state = {assembly, projectText: '', diagnosticsByBlock: emptyByBlock, inFlight: null, runId: this._lint_state.runId || 0}
            this._applyLintDiagnostics(blocks, emptyByBlock)
            if (this.window_manager?.setConsoleProblems) {
                this.window_manager.setConsoleProblems([])
            }
            return this._lint_state
        }

        if (!assembly.trim()) {
            this._lint_state = {assembly, projectText: '', diagnosticsByBlock: emptyByBlock, inFlight: null, runId: this._lint_state.runId || 0}
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
            let lintAssembly = assembly
            const diagnosticsByBlock = new Map()
            const problemsList = []
            blocks.forEach(({block}) => diagnosticsByBlock.set(block.id, []))

            try {
                const offsets = this.project?.offsets
                if (offsets && typeof this.runtime.setRuntimeOffsets === 'function') {
                    /*
                        // Updated Layout after K→S refactor
                        // S: 0 (Size 64) - System (formerly K/Control)
                        // X: 64 (Size 64) - Input
                        // Y: 128 (Size 64) - Output
                        // M: 192 (Size 256) - Marker
                        // T and C are compiler-defined based on usage
                        await runtime.callExport('setRuntimeOffsets', 0, 64, 128, 192)
                    */
                    const normalized = ensureOffsets(offsets)
                    const S = normalized?.system?.offset || 0
                    const X = normalized?.input?.offset || 0
                    const Y = normalized?.output?.offset || 0
                    const M = normalized?.marker?.offset || 0
                    await this.runtime.setRuntimeOffsets(S, X, Y, M)
                }

                // First, lint STL blocks separately using lintSTL
                if (typeof this.runtime.lintSTL === 'function') {
                    for (const info of blocks) {
                        if (info.block.type === 'stl') {
                            const stlCode = info.block.code || ''
                            if (!stlCode.trim()) continue

                            try {
                                const stlResult = await this.runtime.lintSTL(stlCode)
                                if (stlResult?.problems?.length) {
                                    const stlLines = stlCode.split('\n')
                                    const stlLineStarts = [0]
                                    for (let i = 0; i < stlLines.length; i++) {
                                        stlLineStarts.push(stlLineStarts[i] + stlLines[i].length + 1)
                                    }

                                    const list = diagnosticsByBlock.get(info.block.id) || []
                                    stlResult.problems.forEach(p => {
                                        const lineIndex = Math.max(0, (p.line || 1) - 1)
                                        const colIndex = Math.max(0, (p.column || 1) - 1)
                                        const lineStart = stlLineStarts[lineIndex] ?? 0
                                        const start = lineStart + colIndex
                                        const length = p.length || 1
                                        const end = start + length

                                        list.push({
                                            type: p.type || 'error',
                                            start,
                                            end,
                                            message: p.message || 'STL lint error',
                                        })

                                        problemsList.push({
                                            type: p.type || 'error',
                                            message: p.message || 'STL lint error',
                                            token: p.token_text || '',
                                            line: p.line || 1,
                                            column: p.column || 1,
                                            start,
                                            end,
                                            blockId: info.block.id,
                                            blockName: info.block.name || '',
                                            blockType: 'stl',
                                            language: 'stl',
                                            languageStack: ['stl'],
                                            programName: info.program?.name || '',
                                            programPath: info.program?.full_path || info.program?.path || '',
                                            programId: info.program?.id || '',
                                        })
                                    })
                                    diagnosticsByBlock.set(info.block.id, list)
                                }
                            } catch (e) {
                                console.warn('STL lint failed for block', info.block.id, e)
                            }
                        }
                    }
                }

                // Lint PLCScript blocks separately using lintPLCScript
                if (typeof this.runtime.lintPLCScript === 'function') {
                    for (const info of blocks) {
                        if (info.block.type === 'plcscript') {
                            const plcscriptCode = info.block.code || ''
                            if (!plcscriptCode.trim()) continue

                            try {
                                const plcscriptResult = await this.runtime.lintPLCScript(plcscriptCode)
                                if (plcscriptResult?.problems?.length) {
                                    const plcLines = plcscriptCode.split('\n')
                                    const plcLineStarts = [0]
                                    for (let i = 0; i < plcLines.length; i++) {
                                        plcLineStarts.push(plcLineStarts[i] + plcLines[i].length + 1)
                                    }

                                    const list = diagnosticsByBlock.get(info.block.id) || []
                                    plcscriptResult.problems.forEach(p => {
                                        const lineIndex = Math.max(0, (p.line || 1) - 1)
                                        const colIndex = Math.max(0, (p.column || 1) - 1)
                                        const lineStart = plcLineStarts[lineIndex] ?? 0
                                        const start = lineStart + colIndex
                                        const length = p.length || 1
                                        const end = start + length

                                        list.push({
                                            type: p.type || 'error',
                                            start,
                                            end,
                                            message: p.message || 'PLCScript lint error',
                                        })

                                        problemsList.push({
                                            type: p.type || 'error',
                                            message: p.message || 'PLCScript lint error',
                                            token: '',
                                            line: p.line || 1,
                                            column: p.column || 1,
                                            start,
                                            end,
                                            blockId: info.block.id,
                                            blockName: info.block.name || '',
                                            blockType: 'plcscript',
                                            language: 'plcscript',
                                            languageStack: ['plcscript'],
                                            programName: info.program?.name || '',
                                            programPath: info.program?.full_path || info.program?.path || '',
                                            programId: info.program?.id || '',
                                        })
                                    })
                                    diagnosticsByBlock.set(info.block.id, list)
                                }
                            } catch (e) {
                                console.warn('PLCScript lint failed for block', info.block.id, e)
                            }
                        }
                    }
                }

                // Lint ladder blocks for structural errors
                for (const info of blocks) {
                    if (info.block.type === 'ladder') {
                        try {
                            // Import ladder language module dynamically to use toIR (for ladder validation)
                            const ladderLanguage = await import('../languages/ladder/language.js')
                            // The block itself IS the ladder with blocks and connections arrays
                            if (ladderLanguage.toIR && info.block.blocks) {
                                const irResult = ladderLanguage.toIR(info.block)
                                if (irResult.errors && irResult.errors.length > 0) {
                                    const list = diagnosticsByBlock.get(info.block.id) || []

                                    for (const err of irResult.errors) {
                                        // Add to diagnostics for this block
                                        list.push({
                                            type: err.type || 'error',
                                            start: 0,
                                            end: 0,
                                            message: err.message || 'Ladder error',
                                        })

                                        // Add to problems list for the console panel
                                        problemsList.push({
                                            type: err.type || 'error',
                                            message: err.message || 'Ladder error',
                                            token: '',
                                            line: 1,
                                            column: 1,
                                            start: 0,
                                            end: 0,
                                            blockId: info.block.id,
                                            blockName: info.block.name || '',
                                            blockType: 'ladder',
                                            language: 'ladder',
                                            languageStack: ['ladder'],
                                            programName: info.program?.name || '',
                                            programPath: info.program?.full_path || info.program?.path || '',
                                            programId: info.program?.id || '',
                                        })
                                    }
                                    diagnosticsByBlock.set(info.block.id, list)
                                }
                            }
                        } catch (e) {
                            console.warn('Ladder lint failed for block', info.block.id, e)
                        }
                    }
                }

                // Transpile STL blocks to PLCASM before linting the full assembly
                lintAssembly = await this._transpileSTLForLinting(assembly)

                problems = await this.runtime.lintPLCASM(lintAssembly)
            } catch (e) {
                console.error('Lint failed', e)
            }

            if (problems && problems.length) {
                // Use the transpiled assembly for line offset calculation since that's what was linted
                const lineStarts = [0]
                for (let i = 0; i < lintAssembly.length; i++) {
                    if (lintAssembly[i] === '\n') lineStarts.push(i + 1)
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
                        // Skip STL and PLCScript blocks - they're handled separately by their dedicated linters
                        if (info.block.type === 'stl' || info.block.type === 'plcscript') continue
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
                    const language = target.block.language || (target.block.type === 'asm' ? 'plcasm' : target.block.type === 'stl' ? 'stl' : target.block.type || '')
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

            this._lint_state = {assembly, projectText: '', diagnosticsByBlock, inFlight: null, runId}
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

    async lintSTLBlock(blockId, code) {
        if (!this.runtime_ready || !this.runtime || typeof this.runtime.lintSTL !== 'function') {
            return []
        }
        if (!code || !code.trim()) {
            return []
        }
        try {
            const result = await this.runtime.lintSTL(code)
            if (!result || !result.problems || !result.problems.length) {
                return []
            }

            // Build line start offsets for converting line/column to character offsets
            const lines = code.split('\n')
            const lineStarts = [0]
            for (let i = 0; i < lines.length; i++) {
                lineStarts.push(lineStarts[i] + lines[i].length + 1) // +1 for newline
            }

            return result.problems.map(p => {
                // Convert 1-based line/column to 0-based character offset
                const lineIndex = Math.max(0, (p.line || 1) - 1)
                const colIndex = Math.max(0, (p.column || 1) - 1)
                const lineStart = lineStarts[lineIndex] ?? 0
                const start = lineStart + colIndex
                const length = p.length || 1
                const end = start + length

                return {
                    type: p.type || 'error',
                    start,
                    end,
                    message: p.message || 'STL lint error',
                }
            })
        } catch (e) {
            console.error('STL lint failed', e)
            return []
        }
    }

    async lintPLCScriptBlock(blockId, code) {
        if (!this.runtime_ready || !this.runtime || typeof this.runtime.lintPLCScript !== 'function') {
            return []
        }
        if (!code || !code.trim()) {
            return []
        }
        try {
            const result = await this.runtime.lintPLCScript(code)
            if (!result || !result.problems || !result.problems.length) {
                return []
            }

            // Build line start offsets for converting line/column to character offsets
            const lines = code.split('\n')
            const lineStarts = [0]
            for (let i = 0; i < lines.length; i++) {
                lineStarts.push(lineStarts[i] + lines[i].length + 1) // +1 for newline
            }

            return result.problems.map(p => {
                // Convert 1-based line/column to 0-based character offset
                const lineIndex = Math.max(0, (p.line || 1) - 1)
                const colIndex = Math.max(0, (p.column || 1) - 1)
                const lineStart = lineStarts[lineIndex] ?? 0
                const start = lineStart + colIndex
                const length = p.length || 1
                const end = start + length

                return {
                    type: p.type || 'error',
                    start,
                    end,
                    message: p.message || 'PLCScript lint error',
                }
            })
        } catch (e) {
            console.error('PLCScript lint failed', e)
            return []
        }
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
