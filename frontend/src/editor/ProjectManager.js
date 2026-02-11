import { ensureOffsets } from '../utils/offsets.js'
import { PLC_Program, PLC_Project, PLC_Symbol, PLCEditor } from '../utils/types.js'
import { PLC_Ladder, toGraph as ladderToGraph, smartStringify } from '../languages/ladder/language.js'
import { PLC_STL } from '../languages/stl/language.js'
import { PLC_Assembly } from '../languages/asm/language.js'

/** @type {PLC_Symbol[]} */
const SYSTEM_SYMBOLS = /** @type {PLC_Symbol[]} */ ([
    { name: 'P_100ms', location: 'system', type: 'bit', address: 2.0, initial_value: 0, comment: '100ms pulse' },
    { name: 'P_200ms', location: 'system', type: 'bit', address: 2.1, initial_value: 0, comment: '200ms pulse' },
    { name: 'P_300ms', location: 'system', type: 'bit', address: 2.2, initial_value: 0, comment: '300ms pulse' },
    { name: 'P_500ms', location: 'system', type: 'bit', address: 2.3, initial_value: 0, comment: '500ms pulse' },
    { name: 'P_1s', location: 'system', type: 'bit', address: 2.4, initial_value: 0, comment: '1 second pulse' },
    { name: 'P_2s', location: 'system', type: 'bit', address: 2.5, initial_value: 0, comment: '2 second pulse' },
    { name: 'P_5s', location: 'system', type: 'bit', address: 2.6, initial_value: 0, comment: '5 second pulse' },
    { name: 'P_10s', location: 'system', type: 'bit', address: 2.7, initial_value: 0, comment: '10 second pulse' },
    { name: 'P_30s', location: 'system', type: 'bit', address: 3.0, initial_value: 0, comment: '30 second pulse' },
    { name: 'P_1min', location: 'system', type: 'bit', address: 3.1, initial_value: 0, comment: '1 minute pulse' },
    { name: 'P_2min', location: 'system', type: 'bit', address: 3.2, initial_value: 0, comment: '2 minute pulse' },
    { name: 'P_5min', location: 'system', type: 'bit', address: 3.3, initial_value: 0, comment: '5 minute pulse' },
    { name: 'P_10min', location: 'system', type: 'bit', address: 3.4, initial_value: 0, comment: '10 minute pulse' },
    { name: 'P_15min', location: 'system', type: 'bit', address: 3.5, initial_value: 0, comment: '15 minute pulse' },
    { name: 'P_30min', location: 'system', type: 'bit', address: 3.6, initial_value: 0, comment: '30 minute pulse' },
    { name: 'P_1hr', location: 'system', type: 'bit', address: 3.7, initial_value: 0, comment: '1 hour pulse' },
    { name: 'P_2hr', location: 'system', type: 'bit', address: 4.0, initial_value: 0, comment: '2 hour pulse' },
    { name: 'P_3hr', location: 'system', type: 'bit', address: 4.1, initial_value: 0, comment: '3 hour pulse' },
    { name: 'P_4hr', location: 'system', type: 'bit', address: 4.2, initial_value: 0, comment: '4 hour pulse' },
    { name: 'P_5hr', location: 'system', type: 'bit', address: 4.3, initial_value: 0, comment: '5 hour pulse' },
    { name: 'P_6hr', location: 'system', type: 'bit', address: 4.4, initial_value: 0, comment: '6 hour pulse' },
    { name: 'P_12hr', location: 'system', type: 'bit', address: 4.5, initial_value: 0, comment: '12 hour pulse' },
    { name: 'P_1day', location: 'system', type: 'bit', address: 4.6, initial_value: 0, comment: '1 day pulse' },

    { name: 'S_100ms', location: 'system', type: 'bit', address: 5.0, initial_value: 0, comment: '100ms square wave' },
    { name: 'S_200ms', location: 'system', type: 'bit', address: 5.1, initial_value: 0, comment: '200ms square wave' },
    { name: 'S_300ms', location: 'system', type: 'bit', address: 5.2, initial_value: 0, comment: '300ms square wave' },
    { name: 'S_500ms', location: 'system', type: 'bit', address: 5.3, initial_value: 0, comment: '500ms square wave' },
    { name: 'S_1s', location: 'system', type: 'bit', address: 5.4, initial_value: 0, comment: '1 second square wave' },
    { name: 'S_2s', location: 'system', type: 'bit', address: 5.5, initial_value: 0, comment: '2 second square wave' },
    { name: 'S_5s', location: 'system', type: 'bit', address: 5.6, initial_value: 0, comment: '5 second square wave' },
    { name: 'S_10s', location: 'system', type: 'bit', address: 5.7, initial_value: 0, comment: '10 second square wave' },
    { name: 'S_30s', location: 'system', type: 'bit', address: 6.0, initial_value: 0, comment: '30 second square wave' },
    { name: 'S_1min', location: 'system', type: 'bit', address: 6.1, initial_value: 0, comment: '1 minute square wave' },
    { name: 'S_2min', location: 'system', type: 'bit', address: 6.2, initial_value: 0, comment: '2 minute square wave' },
    { name: 'S_5min', location: 'system', type: 'bit', address: 6.3, initial_value: 0, comment: '5 minute square wave' },
    { name: 'S_10min', location: 'system', type: 'bit', address: 6.4, initial_value: 0, comment: '10 minute square wave' },
    { name: 'S_15min', location: 'system', type: 'bit', address: 6.5, initial_value: 0, comment: '15 minute square wave' },
    { name: 'S_30min', location: 'system', type: 'bit', address: 6.6, initial_value: 0, comment: '30 minute square wave' },
    { name: 'S_1hr', location: 'system', type: 'bit', address: 6.7, initial_value: 0, comment: '1 hour square wave' },

    { name: 'elapsed_seconds', location: 'system', type: 'byte', address: 8.0, initial_value: 0, comment: 'Elapsed seconds' },
    { name: 'elapsed_minutes', location: 'system', type: 'byte', address: 9.0, initial_value: 0, comment: 'Elapsed minutes' },
    { name: 'elapsed_hours', location: 'system', type: 'byte', address: 10.0, initial_value: 0, comment: 'Elapsed hours' },
    { name: 'elapsed_days', location: 'system', type: 'byte', address: 11.0, initial_value: 0, comment: 'Elapsed days' },

    { name: 'system_uptime', location: 'system', type: 'dint', address: 12.0, initial_value: 0, comment: 'System uptime in seconds' },
].map(s => ({ ...s, readonly: true })))

const LOCAL_STORAGE_KEY = 'vovk_plc_project_autosave'

/** @param {string} str */
const _needsQuotes = (str) => str && str.includes(' ')
/** @param {string} str */
const _quote = (str) => _needsQuotes(str) ? `"${str}"` : str

/**
 * Parse a PROGRAM header: name [PATH=path] [: comment]
 * Supports quoted names and paths.
 * @param {string} str
 * @returns {{ name: string, path: string, comment: string }}
 */
const _parseProgramHeader = (str) => {
    let pos = 0
    let name = '', path = '', comment = ''

    // Skip leading whitespace
    while (pos < str.length && str[pos] === ' ') pos++

    // Parse name (possibly quoted)
    if (str[pos] === '"') {
        const end = str.indexOf('"', pos + 1)
        if (end !== -1) { name = str.substring(pos + 1, end); pos = end + 1 }
    } else {
        let end = pos
        while (end < str.length && str[end] !== ' ' && str[end] !== ':') end++
        name = str.substring(pos, end)
        pos = end
    }

    // Skip whitespace
    while (pos < str.length && str[pos] === ' ') pos++

    // Parse optional PATH=
    if (str.substring(pos).startsWith('PATH=')) {
        pos += 5
        if (str[pos] === '"') {
            const end = str.indexOf('"', pos + 1)
            if (end !== -1) { path = str.substring(pos + 1, end); pos = end + 1 }
        } else {
            let end = pos
            while (end < str.length && str[end] !== ' ' && str[end] !== ':') end++
            path = str.substring(pos, end)
            pos = end
        }
    }

    // Skip whitespace
    while (pos < str.length && str[pos] === ' ') pos++

    // Parse optional : comment
    if (str[pos] === ':') {
        comment = str.substring(pos + 1).trim()
    }

    return { name, path, comment }
}

/**
 * Parse a DB header line: DB<N> ["Alias"] [PATH=<dir>] [ADDRESS=<addr>] [{ [: comment]]
 * Supports both old format (no braces) and new format (with braces).
 * @param {string} line
 * @returns {{ id: number, name: string, path: string, address: number, comment: string, hasBrace: boolean } | null}
 */
const _parseDBHeader = (line) => {
    const result = { id: 0, name: '', path: '/', address: 0, comment: '', hasBrace: false }

    const dbMatch = line.match(/^DB(\d+)/)
    if (!dbMatch) return null
    result.id = parseInt(dbMatch[1], 10)
    let pos = dbMatch[0].length

    // Skip whitespace
    while (pos < line.length && line[pos] === ' ') pos++

    // Parse optional "Alias"
    if (pos < line.length && line[pos] === '"') {
        const end = line.indexOf('"', pos + 1)
        if (end !== -1) {
            result.name = line.substring(pos + 1, end)
            pos = end + 1
        }
    }
    if (!result.name) result.name = `DataBlock${result.id}`

    // Parse remaining: PATH=, ADDRESS=, {, : comment
    while (pos < line.length) {
        while (pos < line.length && line[pos] === ' ') pos++
        if (pos >= line.length) break

        const rest = line.substring(pos)
        if (rest.startsWith('PATH=')) {
            pos += 5
            if (line[pos] === '"') {
                const end = line.indexOf('"', pos + 1)
                if (end !== -1) { result.path = line.substring(pos + 1, end); pos = end + 1 }
            } else {
                let end = pos
                while (end < line.length && line[end] !== ' ' && line[end] !== '{' && line[end] !== ':') end++
                result.path = line.substring(pos, end)
                pos = end
            }
        } else if (rest.startsWith('ADDRESS=')) {
            pos += 8
            let end = pos
            while (end < line.length && /\d/.test(line[end])) end++
            result.address = parseInt(line.substring(pos, end), 10) || 0
            pos = end
        } else if (line[pos] === '{') {
            result.hasBrace = true
            pos++
        } else if (line[pos] === ':') {
            result.comment = line.substring(pos + 1).trim()
            break
        } else {
            pos++
        }
    }
    return result
}


export default class ProjectManager {
  #editor
  last_saved_state = ''

  /** @param {PLCEditor} editor */
  constructor(editor) {
    this.#editor = editor
  }

  initialize() {
    this.restoreFromLocalStorage()
    // Auto-save check every 5 seconds
    setInterval(() => this.checkAndSave(), 5000)
  }

  restoreFromLocalStorage() {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (saved) {
        const project = JSON.parse(saved)
        if (project) {
          // console.log('[ProjectManager] Restoring project from localStorage')
          this.ensureSystemSymbols(project)
          this.load(project) // Use the new load method which includes UI restore
          // Disable default initial program since we restored one
          this.#editor.initial_program = null
          this.last_saved_state = saved
        }
      }
    } catch (e) {
      console.error('[ProjectManager] Failed to restore project from localStorage', e)
    }
  }

  ensureSystemSymbols(project) {
    if (!project.symbols) project.symbols = []
    if (!project.device_symbols) project.device_symbols = []
    
    // Split user symbols from existing system symbols (to re-add them in correct order)
    const userSymbols = project.symbols.filter(s => !s.readonly && !s.device)
    // Actually we can just filter out any existing system symbols by name to be safe
    const systemNames = new Set(SYSTEM_SYMBOLS.map(s => s.name))
    const deviceNames = new Set(project.device_symbols.map(s => s.name))
    const cleanUserSymbols = userSymbols.filter(s => !systemNames.has(s.name) && !deviceNames.has(s.name))
    
    project.symbols = [...SYSTEM_SYMBOLS, ...project.device_symbols, ...cleanUserSymbols]
  }

  /**
   * Set device symbols from PLC device
   * @param {Array<{name: string, area: string, address: number, bit: number, type: string, comment: string}>} rawSymbols 
   */
  setDeviceSymbols(rawSymbols) {
    const project = this.#editor.project
    if (!project) return
    
    // Map area names to location types
    // Supports both IEC notation (I, Q) and traditional PLC notation (X, Y)
    /** @type {Record<string, import('../utils/types.js').PLC_Symbol_Location>} */
    const areaToLocation = {
      'X': 'input',
      'I': 'input',    // IEC notation for input
      'Y': 'output',
      'Q': 'output',   // IEC notation for output
      'S': 'system',
      'M': 'marker',
      'T': 'timer',
      'C': 'counter'
    }
    
    // Map type names (including C++ type aliases from runtime)
    // Preserve unsigned types for correct value display
    /** @type {Record<string, import('../utils/types.js').PLC_Symbol_Type>} */
    const typeMap = {
      'bit': 'bit',
      'bool': 'bit',
      'byte': 'byte',
      'u8': 'u8',
      'i8': 'i8',
      'int': 'int',
      'i16': 'i16',
      'u16': 'u16',
      'dint': 'dint',
      'i32': 'i32',
      'u32': 'u32',
      'real': 'real',
      'f32': 'f32',
      'float': 'real'
    }
    
    // Convert raw symbols to PLC_Symbol format
    /** @type {import('../utils/types.js').PLC_Symbol[]} */
    const deviceSymbols = rawSymbols.map(raw => ({
      name: raw.name,
      location: areaToLocation[raw.area] || 'marker',
      type: typeMap[raw.type] || 'byte',
      address: raw.bit > 0 ? raw.address + (raw.bit / 10) : raw.address,
      initial_value: 0,
      comment: raw.comment || `Device symbol (${raw.area}${raw.address}${raw.bit > 0 ? '.' + raw.bit : ''})`,
      readonly: true,
      device: true
    }))
    
    project.device_symbols = deviceSymbols
    // Rebuild combined symbols list
    this.ensureSystemSymbols(project)
  }

  /**
   * Clear device symbols (when disconnecting)
   */
  clearDeviceSymbols() {
    const project = this.#editor.project
    if (!project) return
    project.device_symbols = []
    this.ensureSystemSymbols(project)
  }

  /**
   * Get all symbols for compilation (system + device + project)
   * @returns {import('../utils/types.js').PLC_Symbol[]}
   */
  getAllSymbolsForCompile() {
    const project = this.#editor.project
    if (!project) return []
    return project.symbols || []
  }

  checkAndSave() {
    if (!this.#editor.project) return

    this.collectProjectState()

    try {
      // Filter out system symbols before saving (only save user symbols)
      // Keep device_symbols so they persist across sessions
      const projectToSave = { ...this.#editor.project }
      if (projectToSave.symbols) {
          projectToSave.symbols = projectToSave.symbols.filter(s => !s.readonly && !s.device)
      }

      const current_state = JSON.stringify(projectToSave)
      if (current_state !== this.last_saved_state) {
        localStorage.setItem(LOCAL_STORAGE_KEY, current_state)
        this.last_saved_state = current_state
        // console.log('[ProjectManager] Project saved to localStorage')
      }
    } catch (e) {
      console.error('[ProjectManager] Auto-save failed', e)
    }
  }

  collectProjectState() {
    if (!this.#editor.window_manager || !this.#editor.window_manager.tree_manager) return

    const root = this.#editor.window_manager.tree_manager.root

    // Collect files
    const files = root
      .filter(item => item.type === 'file' && item.item && item.item.item)
      .map(item => {
        /** @type {PLC_Program} */
        const source = item.item.item
        const blocks = (source.blocks || []).map(block => {
          const copy = { ...block }
          // delete copy.id
          delete copy.div // Remove DOM reference
          delete copy.cached_asm
          delete copy.cached_checksum
          delete copy.cached_symbols_checksum
          delete copy.cached_asm_map
          delete copy.cached_symbol_refs
          delete copy.programId
          // delete copy.props // Remove rendering props
          if (copy.props) {
            const props_copy = { ...copy.props }
            delete props_copy.ctx // Remove canvas context
            delete props_copy.canvas // Remove canvas element
            delete props_copy.text_editor // Remove code editor instance
            copy.props = props_copy
          }
          return copy
        })
        
        // Create a clean copy to avoid circular references (like .host added by EditorUI)
        return {
          id: source.id,
          type: source.type,
          name: source.name,
          path: source.path,
          full_path: source.full_path,
          comment: source.comment,
          scrollTop: source.scrollTop,
          blocks: blocks
        }
      }) // PLC_File -> item (PLC_ProjectItem)

    // Collect folders
    const folders = root
      .filter(item => item.type === 'folder')
      .map(item => item.full_path)

    // Collect UI State
    /** @type {import('./UI/Elements/TabManager.js').default} */
    const tabManager = this.#editor.window_manager.tab_manager
    const openTabs = tabManager.getOpenTabsOrdered()
    const activeTab = tabManager.active
    const activeDevice = this.#editor.window_manager.active_device
    const treeState = this.#editor.window_manager.tree_manager.minimized_folders
    const consoleState = typeof this.#editor.window_manager.getConsoleState === 'function'
      ? this.#editor.window_manager.getConsoleState()
      : null

    // Update project
    this.#editor.project.files = files
    this.#editor.project.folders = folders
    this.#editor.project._ui_state = {
        open_tabs: openTabs,
        active_tab: activeTab,
        active_device: activeDevice,
        tree_state: treeState,
        console_state: consoleState
    }
  }

  /** Load a project and initialize editor state */
  /** @param {PLC_Project} project */
  load(project) {
    this.#editor.openProject(project) // This handles _prepareProject and window_manager.openProject
    this.restoreUIState(project)
  }

  restoreUIState(project) {
    let restoredTabs = false;
    if (project && project._ui_state) {
        try {
            const { open_tabs, active_tab, active_device, tree_state, console_state } = project._ui_state
            const wm = this.#editor.window_manager
            
            // Restore Tree State
            if (tree_state) {
                 wm.tree_manager.minimized_folders = tree_state
                 wm.tree_manager.draw_navigation_tree(true)
            }
            
            // Restore Device
            if (active_device && wm.setActiveDevice) {
                wm.setActiveDevice(active_device)
            }

            // Restore Tabs
            if (open_tabs && Array.isArray(open_tabs)) {
                open_tabs.forEach(id => {
                    // Special windows (symbols, setup, memory, datablocks, db:N) that don't live in the project tree
                    const isSpecialWindow = id === 'symbols' || id === 'setup' || id === 'memory' || id === 'datablocks' || id.startsWith('db:')
                    
                    // Check if file still exists in project (or is a special window)
                    // The openTab method needs the file to exist in the tree/project structure
                    // We assume openProject has already populated the tree
                    try {
                        // Check if it exists or is a special window
                        const exists = this.#editor.findProgram(id) || isSpecialWindow
                        if (exists) {
                            // Restore as lazy tab initially
                            // The active tab will be fully loaded by switchTo below
                            // @ts-ignore
                            wm.restoreLazyTab(id)
                            restoredTabs = true;
                        }
                    } catch(e) { console.warn('Failed to restore tab', id, e) }
                })
            }

            // Set Active Tab
            if (active_tab) {
                wm.tab_manager.switchTo(active_tab)
            } else if (restoredTabs) {
                 // Nothing specific active, but tabs restored
                 const first = wm.tab_manager.tabs.keys().next().value;
                 if(first) wm.tab_manager.switchTo(first)
            }

            if (console_state && typeof wm.setConsoleState === 'function') {
                wm.setConsoleState(console_state)
            }

        } catch (e) {
            console.error('Failed to restore UI state', e)
        }
    }

    if (!restoredTabs && project && project.files) {
        // Fallback: Default to opening 'main' if no state restored
        const main = project.files.find(f => f.name === 'main' && f.path === '/' && f.type === 'program')
        if (main && main.id) this.#editor.window_manager.openProgram(main.id)
    }
  }

  /** Save current project to JSON */
  save() {
    const projectToSave = { ...this.#editor.project }
    if (projectToSave.symbols) {
        projectToSave.symbols = projectToSave.symbols.filter(s => !s.readonly)
    }
    return JSON.stringify(projectToSave, null, 2)
  }

  /**
   * Compiles the current project using the VOVKPLCPROJECT format
   * @returns {Promise<{size: number, output: string, bytecode?: string, problem?: any, compileTime?: number, memory?: any, flash?: any, execution?: any, memoryAreas?: any[], datablockDecls?: any[]}>}
   */
  async compile() {
    // Ensure project state is up to date before compiling
    this.checkAndSave()

    const runtime = this.#editor.runtime
    if (!runtime) throw new Error('Runtime not initialized')

    // Build the VOVKPLCPROJECT text format
    const projectText = this.buildProjectText()

    // Keep silent during compilation to avoid console spam
    await runtime.setSilent(true)

    try {
        // Use the new compileProject API
        const result = await runtime.compileProject(projectText)

        if (result.problem) {
            // Return error in a compatible format
            return {
                size: 0,
                output: '',
                bytecode: null,
                problem: result.problem
            }
        }

        // Extract T/C offsets from compiler-computed memory_map and update project offsets
        const memoryMap = result.output?.memory_map || {}
        if (this.#editor.project) {
            const offsets = this.#editor.project.offsets
            if (memoryMap['T']) {
                const [offset, size] = memoryMap['T']
                offsets.timer = { offset, size }
            }
            if (memoryMap['C']) {
                const [offset, size] = memoryMap['C']
                offsets.counter = { offset, size }
            }
        }

        // Convert memory_map to memoryAreas array for compatibility
        const memoryAreas = Object.entries(memoryMap).map(([name, [start, size]]) => ({ name, start, size }))

        // Extract datablock declarations from the compiler
        // These contain absolute offsets, field layouts, types and sizes
        let datablockDecls = []
        try {
            if (typeof runtime.dbGetAllDecls === 'function') {
                datablockDecls = runtime.dbGetAllDecls()
            }
        } catch (e) {
            console.warn('Failed to extract datablock declarations:', e)
        }

        return {
            size: result.output?.flash?.used || 0,
            output: result.bytecode || '',
            bytecode: result.bytecode,
            compileTime: result.compileTime,
            memory: result.output?.memory,
            flash: result.output?.flash,
            execution: result.output?.execution,
            memoryAreas,
            datablockDecls
        }
    } catch (e) {
        await runtime.setSilent(false)
        throw e
    }
  }

  /**
   * Builds a portable VOVKPLCPROJECT format string for export
   * This includes all metadata needed to fully reconstruct the project
   * @returns {string}
   */
  buildExportText() {
    const project = this.#editor.project
    if (!project) throw new Error('No project loaded')

    const lines = []
    
    // Project header with metadata
    const projectName = project.info?.name || 'PLCProject'
    const projectVersion = project.info?.version || '1.0.0'
    const projectAuthor = project.info?.author || ''
    const projectDescription = project.info?.description || ''
    const exportDate = new Date().toISOString()
    
    lines.push(`VOVKPLCPROJECT ${projectName}`)
    lines.push(`VERSION ${projectVersion}`)
    lines.push(`EXPORT_DATE ${exportDate}`)
    lines.push(`FORMAT_VERSION 1.0`)
    if (projectAuthor) lines.push(`AUTHOR ${projectAuthor}`)
    if (projectDescription) lines.push(`DESCRIPTION ${projectDescription}`)
    lines.push('')

    // Device info and interfaces (before MEMORY for better readability)
    const deviceInfo = this.#editor.device_manager?.deviceInfo || project.lastPhysicalDevice?.deviceInfo
    const transports = project.lastPhysicalDevice?.transports || []
    if (deviceInfo || transports.length > 0) {
        lines.push('DEVICE')
        if (deviceInfo) {
            if (deviceInfo.device) lines.push(`    NAME ${deviceInfo.device}`)
            if (deviceInfo.type) lines.push(`    TYPE ${deviceInfo.type}`)
            if (deviceInfo.arch) lines.push(`    ARCH ${deviceInfo.arch}`)
            if (deviceInfo.version) lines.push(`    VERSION ${deviceInfo.version}`)
            if (deviceInfo.build) lines.push(`    BUILD ${deviceInfo.build}`)
            if (deviceInfo.memory) lines.push(`    MEMORY ${deviceInfo.memory}`)
            if (deviceInfo.program) lines.push(`    PROGRAM ${deviceInfo.program}`)
        }
        if (transports.length > 0) {
            lines.push('    INTERFACES')
            for (const t of transports) {
                const name = t.name || `Interface_${t.type}`
                const props = []
                if (t.type !== undefined) props.push(`TYPE=${t.type}`)
                if (t.isNetwork !== undefined) props.push(`NETWORK=${t.isNetwork}`)
                if (t.isConnected !== undefined) props.push(`CONNECTED=${t.isConnected}`)
                if (t.requiresAuth !== undefined) props.push(`AUTH=${t.requiresAuth}`)
                // Serial-specific
                if (t.baudrate) props.push(`BAUDRATE=${t.baudrate}`)
                // Network-specific
                if (t.ip) props.push(`IP=${t.ip}`)
                if (t.port) props.push(`PORT=${t.port}`)
                if (t.gateway) props.push(`GATEWAY=${t.gateway}`)
                if (t.subnet) props.push(`SUBNET=${t.subnet}`)
                if (t.mac) props.push(`MAC=${t.mac}`)
                // Legacy enabled field
                if (t.enabled !== undefined) props.push(`ENABLED=${t.enabled}`)
                
                const propsStr = props.length > 0 ? ' : ' + props.join(' : ') : ''
                lines.push(`        ${name}${propsStr}`)
            }
            lines.push('    END_INTERFACES')
        }
        lines.push('END_DEVICE')
        lines.push('')
    }

    // Open tabs - convert IDs to full_path for portability
    const tabManager = this.#editor.window_manager?.tab_manager
    const specialWindows = ['symbols', 'setup', 'memory', 'datablocks']
    if (tabManager && tabManager.tabs && tabManager.tabs.size > 0) {
        const openTabIds = Array.from(tabManager.tabs.keys())
        if (openTabIds.length > 0) {
            lines.push('TABS')
            for (const tabId of openTabIds) {
                // Special windows and db:N keep their name, program tabs use full_path
                if (specialWindows.includes(tabId) || tabId.startsWith('db:')) {
                    lines.push(`    ${tabId}`)
                } else {
                    const program = this.#editor.findProgram(tabId)
                    if (program?.full_path) {
                        let path = program.full_path
                        if (path.startsWith('/')) path = path.substring(1)
                        lines.push(`    ${path}`)
                    }
                }
            }
            lines.push('END_TABS')
            lines.push('')
        }
    }

    // Active tab - convert ID to full_path for portability
    const activeTab = tabManager?.active
    if (activeTab) {
        if (specialWindows.includes(activeTab) || activeTab.startsWith('db:')) {
            lines.push(`ACTIVE_TAB ${activeTab}`)
        } else {
            const program = this.#editor.findProgram(activeTab)
            if (program?.full_path) {
                let path = program.full_path
                if (path.startsWith('/')) path = path.substring(1)
                lines.push(`ACTIVE_TAB ${path}`)
            }
        }
        lines.push('')
    }

    // Memory configuration
    const offsets = ensureOffsets(project.offsets)
    
    const sSize = offsets.system?.size || 64
    const xSize = offsets.input?.size || 64
    const ySize = offsets.output?.size || 64
    const mSize = offsets.marker?.size || 256
    const tSize = offsets.timer?.size || 0
    const cSize = offsets.counter?.size || 0
    
    const totalMemory = sSize + xSize + ySize + mSize + tSize + cSize
    
    lines.push('MEMORY')
    lines.push(`    OFFSET 0`)
    lines.push(`    AVAILABLE ${totalMemory}`)
    lines.push(`    S ${sSize}`)
    lines.push(`    X ${xSize}`)
    lines.push(`    Y ${ySize}`)
    lines.push(`    M ${mSize}`)
    lines.push(`    T ${tSize}`)
    lines.push(`    C ${cSize}`)
    lines.push('END_MEMORY')
    lines.push('')

    // Symbols section - user symbols only
    const symbols = project.symbols || []
    const userSymbols = symbols.filter(s => !s.readonly && !s.device)
    if (userSymbols.length > 0) {
        lines.push('SYMBOLS')
        
        const typeMap = {
            'bit': 'BOOL',
            'bool': 'BOOL',
            'byte': 'BYTE',
            'int': 'INT',
            'dint': 'DINT',
            'real': 'REAL',
            'word': 'WORD',
            'dword': 'DWORD',
            'u8': 'U8',
            'i8': 'I8',
            'u16': 'U16',
            'i16': 'I16',
            'u32': 'U32',
            'i32': 'I32',
            'f32': 'F32',
        }
        
        const locationPrefix = {
            'system': 'S',
            'input': 'X',
            'output': 'Y',
            'marker': 'M',
            'timer': 'T',
            'counter': 'C'
        }
        
        for (const sym of userSymbols) {
            if (sym.name && sym.type && sym.address !== undefined) {
                const prefix = locationPrefix[sym.location] || 'M'
                const mappedType = typeMap[sym.type] || sym.type.toUpperCase()
                let addrStr = String(sym.address)
                if ((mappedType === 'BOOL' || sym.type === 'bit') && !addrStr.includes('.')) {
                    addrStr += '.0'
                }
                const fullAddress = `${prefix}${addrStr}`
                const comment = sym.comment ? ` : ${sym.comment}` : ''
                lines.push(`    ${sym.name} : ${mappedType} : ${fullAddress}${comment}`)
            }
        }
        lines.push('END_SYMBOLS')
        lines.push('')
    }

    // Data Blocks section
    const datablocks = project.datablocks || []
    if (datablocks.length > 0) {
        lines.push('DATABLOCKS')
        for (const db of datablocks) {
            const nameStr = db.name ? ` ${_quote(db.name)}` : ''
            const dbPath = db.path || '/'
            const pathStr = dbPath !== '/' ? ` PATH=${_quote(dbPath)}` : ''
            const commentStr = db.comment ? ` : ${db.comment}` : ''
            lines.push(`    DB${db.id}${nameStr}${pathStr} {${commentStr}`)
            for (const field of (db.fields || [])) {
                const typeStr = (field.type || 'byte').toUpperCase()
                const defStr = field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== 0 ? ` = ${field.defaultValue}` : ''
                const fComment = field.comment ? ` : ${field.comment}` : ''
                lines.push(`        ${field.name}: ${typeStr}${defStr}${fComment}`)
            }
            lines.push(`    }`)
        }
        lines.push('END_DATABLOCKS')
        lines.push('')
    }

    // Program files
    const treeRoot = this.#editor.window_manager?.tree_manager?.root
    let files = []
    if (Array.isArray(treeRoot) && treeRoot.length) {
        files = treeRoot.filter(node => node.type === 'file' && node.item?.item?.type === 'program').map(node => node.item.item)
    }
    if (!files.length) {
        files = (project.files || []).filter(file => file.type === 'program')
    }
    
    for (const file of files) {
        const name = file.name || 'main'
        const programPath = file.path || '/'
        const fileComment = file.comment ? ` : ${file.comment}` : ''

        if (name === 'main') {
            lines.push(`PROGRAM ${_quote(name)}${fileComment}`)
        } else {
            lines.push(`PROGRAM ${_quote(name)} PATH=${_quote(programPath)}${fileComment}`)
        }
        
        const blocks = file.blocks || []
        for (const block of blocks) {
            const blockName = block.name || 'Code'
            const blockType = block.type || 'asm'
            
            const langMap = {
                'asm': 'PLCASM',
                'plcasm': 'PLCASM',
                'stl': 'STL',
                'ladder': 'LADDER',
                'plcscript': 'PLCSCRIPT',
                'st': 'ST'
            }
            const lang = langMap[blockType.toLowerCase()] || 'PLCASM'
            
            lines.push(`    BLOCK LANG=${lang} ${blockName}`)
            
            let content = ''
            if (blockType === 'ladder') {
                /** @type {PLC_Ladder} */
                const ladderBlock = /** @type {any} */ (block)
                try {
                    const graph = ladderToGraph(ladderBlock)
                    content = smartStringify(graph)
                } catch (e) {
                    if (ladderBlock.nodes || ladderBlock.blocks) {
                        const graph = {
                            comment: ladderBlock.comment || ladderBlock.name || '',
                            nodes: ladderBlock.nodes || ladderBlock.blocks || [],
                            connections: ladderBlock.connections || []
                        }
                        content = smartStringify(graph)
                    } else {
                        console.warn('[ProjectManager] Could not serialize ladder block:', e)
                    }
                }
            } else {
                /** @type {PLC_STL | PLC_Assembly} */
                const codeBlock = /** @type {any} */ (block)
                content = codeBlock.code || ''
            }
            
            const contentLines = content.split('\n')
            for (const line of contentLines) {
                lines.push(line)
            }
            
            lines.push(`    END_BLOCK`)
        }
        
        lines.push(`END_PROGRAM`)
        lines.push('')
    }

    // Watch items
    const watchItems = project.watch || []
    if (watchItems.length > 0) {
        lines.push('WATCH')
        for (const item of watchItems) {
            if (item.name) {
                const format = item.format ? ` : ${item.format}` : ''
                lines.push(`    ${item.name}${format}`)
            }
        }
        lines.push('END_WATCH')
        lines.push('')
    }

    lines.push('END_PROJECT')
    return lines.join('\n')
  }

  /**
   * Parses a VOVKPLCPROJECT format string into a project object
   * @param {string} text
   * @returns {PLC_Project}
   */
  parseProjectText(text) {
    const lines = text.split('\n')
    let lineIndex = 0
    
    const project = this.createEmptyProject()
    project.symbols = []
    project.datablocks = []
    project.files = []
    project.folders = []
    project.watch = []
    
    // Type mappings (reverse of export)
    const typeMap = {
        'BOOL': 'bit',
        'BYTE': 'byte',
        'INT': 'int',
        'DINT': 'dint',
        'REAL': 'real',
        'WORD': 'int',
        'DWORD': 'dint',
        'U8': 'byte',
        'I8': 'byte',
        'U16': 'int',
        'I16': 'int',
        'U32': 'dint',
        'I32': 'dint',
        'F32': 'real',
    }
    
    const locationMap = {
        'X': 'input',
        'Y': 'output',
        'S': 'system',
        'M': 'marker',
        'T': 'timer',
        'C': 'counter'
    }

    const readLine = () => {
        if (lineIndex >= lines.length) return null
        return lines[lineIndex++]
    }
    
    const peekLine = () => {
        if (lineIndex >= lines.length) return null
        return lines[lineIndex]
    }

    // Parse header
    let line = readLine()
    if (!line || !line.startsWith('VOVKPLCPROJECT')) {
        throw new Error('Invalid project file: missing VOVKPLCPROJECT header')
    }
    project.info = project.info || {}
    project.info.name = line.substring('VOVKPLCPROJECT'.length).trim()
    
    // Parse sections
    while ((line = readLine()) !== null) {
        const trimmed = line.trim()
        
        if (trimmed.startsWith('VERSION ')) {
            project.info.version = trimmed.substring('VERSION '.length).trim()
        } else if (trimmed.startsWith('AUTHOR ')) {
            project.info.author = trimmed.substring('AUTHOR '.length).trim()
        } else if (trimmed.startsWith('DESCRIPTION ')) {
            project.info.description = trimmed.substring('DESCRIPTION '.length).trim()
        } else if (trimmed === 'MEMORY') {
            // Parse memory section
            while ((line = readLine()) !== null) {
                const memLine = line.trim()
                if (memLine === 'END_MEMORY') break
                
                const parts = memLine.split(/\s+/)
                if (parts.length >= 2) {
                    const key = parts[0]
                    const value = parseInt(parts[1], 10)
                    if (!isNaN(value)) {
                        switch (key) {
                            case 'S': project.offsets.system.size = value; break
                            case 'X': project.offsets.input.size = value; break
                            case 'Y': project.offsets.output.size = value; break
                            case 'M': project.offsets.marker.size = value; break
                            case 'T': project.offsets.timer.size = value; break
                            case 'C': project.offsets.counter.size = value; break
                        }
                    }
                }
            }
            // Recalculate offsets based on sizes
            project.offsets = ensureOffsets(project.offsets)
        } else if (trimmed === 'SYMBOLS') {
            // Parse symbols section
            while ((line = readLine()) !== null) {
                const symLine = line.trim()
                if (symLine === 'END_SYMBOLS') break
                if (!symLine) continue
                
                // Format: name : TYPE : ADDRESS : comment
                const parts = symLine.split(':').map(p => p.trim())
                if (parts.length >= 3) {
                    const name = parts[0]
                    const type = typeMap[parts[1].toUpperCase()] || parts[1].toLowerCase()
                    const addrPart = parts[2]
                    const comment = parts.length > 3 ? parts.slice(3).join(':').trim() : ''
                    
                    // Parse address like "M0.1" or "X10"
                    const prefix = addrPart.charAt(0).toUpperCase()
                    const location = locationMap[prefix] || 'marker'
                    const addrStr = addrPart.substring(1)
                    const address = parseFloat(addrStr) || 0
                    
                    project.symbols.push({
                        name,
                        type,
                        location,
                        address,
                        initial_value: 0,
                        comment
                    })
                }
            }
        } else if (trimmed === 'DATABLOCKS') {
            // Parse data blocks section
            if (!project.datablocks) project.datablocks = []
            while ((line = readLine()) !== null) {
                const dbLine = line.trim()
                if (dbLine === 'END_DATABLOCKS') break
                if (!dbLine) continue

                // Parse DB header: DB<N> ["Alias"] [PATH=<dir>] [ADDRESS=<addr>] [{ [: comment]]
                // Supports both old format (END_DB) and new format ({ ... })
                const parsed = _parseDBHeader(dbLine)
                if (parsed) {
                    /** @type {{ id: number, name: string, path: string, address: number, fields: import('../utils/types.js').PLC_DataBlockField[], comment: string }} */
                    const db = {
                        id: parsed.id,
                        name: parsed.name,
                        path: parsed.path,
                        address: parsed.address,
                        fields: [],
                        comment: parsed.comment,
                    }

                    // Parse fields until END_DB or }
                    while ((line = readLine()) !== null) {
                        const fieldLine = line.trim()
                        if (fieldLine === 'END_DB' || fieldLine === '}') break
                        if (!fieldLine) continue

                        // Format: name: TYPE = defaultValue : comment  (new)
                        // Format: name : TYPE = defaultValue : comment (old)
                        const colonIdx = fieldLine.indexOf(':')
                        if (colonIdx === -1) continue

                        const fieldName = fieldLine.substring(0, colonIdx).trim()
                        const afterName = fieldLine.substring(colonIdx + 1).trim()

                        // Split remaining by ':' for comment
                        const parts = afterName.split(':').map(p => p.trim())
                        let typeAndDefault = parts[0]
                        const fieldComment = parts.length > 1 ? parts.slice(1).join(':').trim() : ''

                        /** @type {number | string} */
                        let defaultValue = 0
                        /** @type {import('../utils/types.js').PLC_Symbol_Type} */
                        let fieldType = 'byte'

                        // Check for default value: TYPE = value
                        const eqMatch = typeAndDefault.match(/^(\S+)\s*=\s*(.+)$/)
                        if (eqMatch) {
                            fieldType = (typeMap[eqMatch[1].toUpperCase()] || eqMatch[1].toLowerCase())
                            const defStr = eqMatch[2].trim()
                            const num = parseFloat(defStr)
                            defaultValue = isNaN(num) ? defStr : num
                        } else {
                            fieldType = (typeMap[typeAndDefault.toUpperCase()] || typeAndDefault.toLowerCase())
                        }

                        db.fields.push({
                            name: fieldName,
                            type: fieldType,
                            defaultValue,
                            comment: fieldComment,
                        })
                    }

                    project.datablocks.push(db)
                }
            }
        } else if (trimmed.startsWith('FILE ') || trimmed.startsWith('PROGRAM ')) {
            // Parse file/program section
            const isProgram = trimmed.startsWith('PROGRAM ')

            let programName, programPath, fileComment

            if (isProgram) {
                // New format: PROGRAM <name> [PATH=<path>] [: comment]
                const header = _parseProgramHeader(trimmed.substring('PROGRAM '.length))
                programName = header.name
                programPath = header.path || '/'
                fileComment = header.comment
            } else {
                // Legacy format: FILE path/to/prog : comment
                const headerParts = trimmed.substring('FILE '.length).split(':').map(p => p.trim())
                const filePath = headerParts[0]
                programName = filePath.split('/').pop() || filePath
                const pathSegments = filePath.split('/').slice(0, -1).join('/')
                programPath = pathSegments ? '/' + pathSegments : '/'
                fileComment = headerParts.length > 1 ? headerParts.slice(1).join(':').trim() : ''
            }

            // Clean up path
            if (!programPath.startsWith('/')) programPath = '/' + programPath
            if (programPath !== '/' && programPath.endsWith('/')) programPath = programPath.slice(0, -1)

            const fullPath = programPath === '/' ? `/${programName}` : `${programPath}/${programName}`

            /** @type {PLC_Program} */
            const file = {
                id: null,
                type: /** @type {'program'} */ ('program'),
                name: programName,
                path: programPath,
                full_path: fullPath,
                comment: fileComment,
                blocks: []
            }
            
            const endMarker = isProgram ? 'END_PROGRAM' : 'END_FILE'
            
            while ((line = readLine()) !== null) {
                const fileLine = line.trim()
                if (fileLine === endMarker) break
                
                if (fileLine.startsWith('BLOCK ')) {
                    // Parse block header: BLOCK LANG=XXX BlockName
                    const blockHeader = fileLine.substring('BLOCK '.length)
                    let lang = 'PLCASM'
                    let blockName = 'Code'
                    
                    const langMatch = blockHeader.match(/LANG=(\w+)\s*/)
                    if (langMatch) {
                        lang = langMatch[1].toUpperCase()
                        blockName = blockHeader.substring(langMatch[0].length).trim() || 'Code'
                    } else {
                        blockName = blockHeader.trim() || 'Code'
                    }
                    
                    // Collect block content until END_BLOCK
                    const contentLines = []
                    while ((line = peekLine()) !== null) {
                        const contentLine = line.trim()
                        if (contentLine === 'END_BLOCK') {
                            readLine() // consume END_BLOCK
                            break
                        }
                        contentLines.push(lines[lineIndex])
                        lineIndex++
                    }
                    const content = contentLines.join('\n').trim()
                    
                    // Create block based on language
                    if (lang === 'LADDER') {
                        try {
                            const graph = JSON.parse(content)
                            file.blocks.push({
                                id: null,
                                type: 'ladder',
                                name: blockName,
                                comment: graph.comment || '',
                                nodes: graph.nodes || [],
                                connections: graph.connections || [],
                                blocks: graph.nodes || []
                            })
                        } catch (e) {
                            console.warn('Failed to parse ladder block:', e)
                        }
                    } else if (lang === 'STL') {
                        file.blocks.push({
                            id: null,
                            type: 'stl',
                            name: blockName,
                            comment: '',
                            code: content
                        })
                    } else {
                        // PLCASM or unknown
                        file.blocks.push({
                            id: null,
                            type: 'asm',
                            name: blockName,
                            comment: '',
                            code: content
                        })
                    }
                }
            }
            
            project.files.push(file)
        } else if (trimmed === 'WATCH') {
            // Parse watch section
            while ((line = readLine()) !== null) {
                const watchLine = line.trim()
                if (watchLine === 'END_WATCH') break
                if (!watchLine) continue
                
                const parts = watchLine.split(':').map(p => p.trim())
                const watchItem = { name: parts[0] }
                if (parts.length > 1) watchItem.format = parts[1]
                project.watch.push(watchItem)
            }
        } else if (trimmed === 'DEVICE') {
            // Parse device section
            project.lastPhysicalDevice = project.lastPhysicalDevice || { deviceInfo: {}, transports: [], symbols: [], timestamp: '' }
            project.lastPhysicalDevice.deviceInfo = project.lastPhysicalDevice.deviceInfo || {}
            while ((line = readLine()) !== null) {
                const deviceLine = line.trim()
                if (deviceLine === 'END_DEVICE') break
                if (!deviceLine) continue
                
                if (deviceLine.startsWith('NAME ')) {
                    project.lastPhysicalDevice.deviceInfo.device = deviceLine.substring('NAME '.length).trim()
                } else if (deviceLine.startsWith('TYPE ')) {
                    project.lastPhysicalDevice.deviceInfo.type = deviceLine.substring('TYPE '.length).trim()
                } else if (deviceLine.startsWith('ARCH ')) {
                    project.lastPhysicalDevice.deviceInfo.arch = deviceLine.substring('ARCH '.length).trim()
                } else if (deviceLine.startsWith('VERSION ')) {
                    project.lastPhysicalDevice.deviceInfo.version = deviceLine.substring('VERSION '.length).trim()
                } else if (deviceLine.startsWith('BUILD ')) {
                    project.lastPhysicalDevice.deviceInfo.build = deviceLine.substring('BUILD '.length).trim()
                } else if (deviceLine.startsWith('MEMORY ')) {
                    project.lastPhysicalDevice.deviceInfo.memory = deviceLine.substring('MEMORY '.length).trim()
                } else if (deviceLine.startsWith('PROGRAM ')) {
                    project.lastPhysicalDevice.deviceInfo.program = deviceLine.substring('PROGRAM '.length).trim()
                } else if (deviceLine === 'INTERFACES') {
                    project.lastPhysicalDevice.transports = []
                    while ((line = readLine()) !== null) {
                        const ifaceLine = line.trim()
                        if (ifaceLine === 'END_INTERFACES') break
                        if (!ifaceLine) continue
                        
                        const parts = ifaceLine.split(':').map(p => p.trim())
                        const iface = { name: parts[0] }
                        for (let i = 1; i < parts.length; i++) {
                            const kv = parts[i].split('=')
                            if (kv.length === 2) {
                                const key = kv[0].trim().toLowerCase()
                                const val = kv[1].trim()
                                if (key === 'type') iface.type = parseInt(val, 10) || val
                                else if (key === 'enabled') iface.enabled = val === 'true' || val === '1'
                                else if (key === 'network') iface.isNetwork = val === 'true' || val === '1'
                                else if (key === 'connected') iface.isConnected = val === 'true' || val === '1'
                                else if (key === 'auth') iface.requiresAuth = val === 'true' || val === '1'
                                else if (key === 'baudrate') iface.baudrate = parseInt(val, 10) || 0
                                else if (key === 'ip') iface.ip = val
                                else if (key === 'port') iface.port = parseInt(val, 10) || 0
                                else if (key === 'gateway') iface.gateway = val
                                else if (key === 'subnet') iface.subnet = val
                                else if (key === 'mac') iface.mac = val
                            }
                        }
                        project.lastPhysicalDevice.transports.push(iface)
                    }
                }
            }
        } else if (trimmed === 'TABS') {
            // Parse tabs section - store for later restoration
            project._ui_state = project._ui_state || {}
            project._ui_state.openTabs = []
            while ((line = readLine()) !== null) {
                const tabLine = line.trim()
                if (tabLine === 'END_TABS') break
                if (!tabLine) continue
                project._ui_state.openTabs.push(tabLine)
            }
        } else if (trimmed.startsWith('ACTIVE_TAB ')) {
            // Parse active tab
            project._ui_state = project._ui_state || {}
            project._ui_state.activeTab = trimmed.substring('ACTIVE_TAB '.length).trim()
        } else if (trimmed === 'END_PROJECT') {
            break
        }
    }
    
    return project
  }

  /**
   * Builds a VOVKPLCPROJECT format string from the current project (for compilation)
   * @returns {string}
   */
  buildProjectText() {
    const project = this.#editor.project
    if (!project) throw new Error('No project loaded')

    const lines = []
    
    // Project header
    const projectName = project.info?.name || 'PLCProject'
    const projectVersion = project.info?.version || '1.0'
    lines.push(`VOVKPLCPROJECT ${projectName}`)
    lines.push(`VERSION ${projectVersion}`)
    lines.push('')

    // Memory configuration
    const offsets = ensureOffsets(project.offsets)
    
    // Calculate sizes for each area
    const sSize = offsets.system?.size || 64
    const xSize = offsets.input?.size || 64
    const ySize = offsets.output?.size || 64
    const mSize = offsets.marker?.size || 256
    const tSize = offsets.timer?.size || 0
    const cSize = offsets.counter?.size || 0
    
    // Total memory is sum of all areas
    const totalMemory = sSize + xSize + ySize + mSize + tSize + cSize
    
    lines.push('MEMORY')
    lines.push(`    OFFSET 0`)
    lines.push(`    AVAILABLE ${totalMemory}`)
    lines.push(`    S ${sSize}`)
    lines.push(`    X ${xSize}`)
    lines.push(`    Y ${ySize}`)
    lines.push(`    M ${mSize}`)
    lines.push(`    T ${tSize}`)
    lines.push(`    C ${cSize}`)
    lines.push('END_MEMORY')
    lines.push('')

    // Symbols section
    const symbols = project.symbols || []
    // Include all symbols for compilation (User, System, Device)
    const compileSymbols = symbols 
    if (compileSymbols.length > 0) {
        lines.push('SYMBOLS')
        
        // Map PLC symbol types to project compiler types
        const typeMap = {
            'bit': 'BOOL',
            'bool': 'BOOL',
            'byte': 'BYTE',
            'int': 'INT',
            'dint': 'DINT',
            'real': 'REAL',
            'word': 'WORD',
            'dword': 'DWORD',
        }
        
        // Map location to prefix
        const locationPrefix = {
            'system': 'S',
            'input': 'X',
            'output': 'Y',
            'marker': 'M',
            'timer': 'T',
            'counter': 'C'
        }
        
        for (const sym of compileSymbols) {
            if (sym.name && sym.type && sym.address !== undefined) {
                const prefix = locationPrefix[sym.location] || 'M'
                const mappedType = typeMap[sym.type] || sym.type.toUpperCase()
                let addrStr = String(sym.address)
                // Ensure bit addresses have the .bit portion
                if ((mappedType === 'BOOL' || sym.type === 'bit') && !addrStr.includes('.')) {
                    addrStr += '.0'
                }
                const fullAddress = `${prefix}${addrStr}`
                const comment = sym.comment ? ` : ${sym.comment}` : ''
                lines.push(`    ${sym.name} : ${mappedType} : ${fullAddress}${comment}`)
            }
        }
        lines.push('END_SYMBOLS')
        lines.push('')
    }

    // Data Blocks section
    const datablocks = project.datablocks || []
    if (datablocks.length > 0) {
        lines.push('DATABLOCKS')
        for (const db of datablocks) {
            const nameStr = db.name ? ` ${_quote(db.name)}` : ''
            const dbPath = db.path || '/'
            const pathStr = dbPath !== '/' ? ` PATH=${_quote(dbPath)}` : ''
            lines.push(`    DB${db.id}${nameStr}${pathStr} {`)
            for (const field of (db.fields || [])) {
                const typeStr = (field.type || 'byte').toUpperCase()
                const defStr = field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== 0 ? ` = ${field.defaultValue}` : ''
                lines.push(`        ${field.name}: ${typeStr}${defStr}`)
            }
            lines.push(`    }`)
        }
        lines.push('END_DATABLOCKS')
        lines.push('')
    }

    // Program files - get from tree manager for up-to-date block references
    const treeRoot = this.#editor.window_manager?.tree_manager?.root
    let files = []
    if (Array.isArray(treeRoot) && treeRoot.length) {
        files = treeRoot.filter(node => node.type === 'file' && node.item?.item?.type === 'program').map(node => node.item.item)
    }
    if (!files.length) {
        files = (project.files || []).filter(file => file.type === 'program')
    }
    for (const file of files) {
        const name = file.name || 'main'
        const programPath = file.path || '/'

        if (name === 'main') {
            lines.push(`PROGRAM ${_quote(name)}`)
        } else {
            lines.push(`PROGRAM ${_quote(name)} PATH=${_quote(programPath)}`)
        }
        
        const blocks = file.blocks || []
        for (const block of blocks) {
            const blockName = block.name || 'Code'
            const blockType = block.type || 'asm'
            
            // Map block type to language
            const langMap = {
                'asm': 'PLCASM',
                'plcasm': 'PLCASM',
                'stl': 'STL',
                'ladder': 'LADDER',
                'plcscript': 'PLCSCRIPT',
                'st': 'ST'
            }
            const lang = langMap[blockType.toLowerCase()] || 'PLCASM'
            
            lines.push(`    BLOCK LANG=${lang} ${blockName}`)
            
            // Get block content
            let content = ''
            if (blockType === 'ladder') {
                // For ladder blocks, export the graph as JSON using the imported function
                /** @type {PLC_Ladder} */
                const ladderBlock = /** @type {any} */ (block)
                try {
                    const graph = ladderToGraph(ladderBlock)
                    content = JSON.stringify(graph)
                } catch (e) {
                    // Fallback: block itself might have the graph structure
                    if (ladderBlock.nodes || ladderBlock.blocks) {
                        const graph = {
                            comment: ladderBlock.comment || ladderBlock.name || '',
                            nodes: ladderBlock.nodes || ladderBlock.blocks || [],
                            connections: ladderBlock.connections || []
                        }
                        content = JSON.stringify(graph)
                    } else {
                        console.warn('[ProjectManager] Could not serialize ladder block:', e)
                    }
                }
            } else {
                // For STL and PLCASM, use the code directly
                /** @type {PLC_STL | PLC_Assembly} */
                const codeBlock = /** @type {any} */ (block)
                content = codeBlock.code || ''
            }
            
            // Output content lines without indentation
            const contentLines = content.split('\n')
            for (const line of contentLines) {
                lines.push(line)
            }
            
            lines.push(`    END_BLOCK`)
        }
        
        lines.push(`END_PROGRAM`)
        lines.push('')
    }

    return lines.join('\n')
  }

  /** Create a new empty project structure */
  /** @returns {PLC_Project} */
  createEmptyProject() {
    // Get runtime info for default project settings (WASM simulator)
    const runtimeInfo = this.#editor?.runtime_info || {}
    
    return {
      offsets: {
        system: { offset: runtimeInfo.system_offset ?? 0, size: runtimeInfo.system_size ?? 64 },
        input: { offset: runtimeInfo.input_offset ?? 64, size: runtimeInfo.input_size ?? 64 },
        output: { offset: runtimeInfo.output_offset ?? 128, size: runtimeInfo.output_size ?? 64 },
        marker: { offset: runtimeInfo.marker_offset ?? 192, size: runtimeInfo.marker_size ?? 256 },
        timer: { offset: runtimeInfo.timer_offset ?? 448, size: (runtimeInfo.timer_count ?? 16) * (runtimeInfo.timer_struct_size ?? 9) },
        counter: { offset: runtimeInfo.counter_offset ?? 592, size: (runtimeInfo.counter_count ?? 16) * (runtimeInfo.counter_struct_size ?? 5) }
      },
      symbols: [...SYSTEM_SYMBOLS],
      datablocks: [],
      info: {
        name: runtimeInfo.device || 'Simulator',
        type: runtimeInfo.device || 'Simulator',
        arch: runtimeInfo.arch || 'WASM',
        version: '1.0.0',
        capacity: runtimeInfo.program || 104857
      },
      folders: [],
      files: []
    }
  }
} 
