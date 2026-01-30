import { ensureOffsets } from '../utils/offsets.js'
import { PLC_Program, PLC_Project, PLC_Symbol, PLCEditor } from '../utils/types.js'
import { PLC_Ladder, toGraph as ladderToGraph } from '../languages/ladder/language.js'
import { PLC_STL } from '../languages/stl/language.js'
import { PLC_Assembly } from '../languages/asm/language.js'

/** @type {PLC_Symbol[]} */
const SYSTEM_SYMBOLS = /** @type {PLC_Symbol[]} */ ([
    { name: 'P_100ms', location: 'control', type: 'bit', address: 2.0, initial_value: 0, comment: '100ms pulse' },
    { name: 'P_200ms', location: 'control', type: 'bit', address: 2.1, initial_value: 0, comment: '200ms pulse' },
    { name: 'P_300ms', location: 'control', type: 'bit', address: 2.2, initial_value: 0, comment: '300ms pulse' },
    { name: 'P_500ms', location: 'control', type: 'bit', address: 2.3, initial_value: 0, comment: '500ms pulse' },
    { name: 'P_1s', location: 'control', type: 'bit', address: 2.4, initial_value: 0, comment: '1 second pulse' },
    { name: 'P_2s', location: 'control', type: 'bit', address: 2.5, initial_value: 0, comment: '2 second pulse' },
    { name: 'P_5s', location: 'control', type: 'bit', address: 2.6, initial_value: 0, comment: '5 second pulse' },
    { name: 'P_10s', location: 'control', type: 'bit', address: 2.7, initial_value: 0, comment: '10 second pulse' },
    { name: 'P_30s', location: 'control', type: 'bit', address: 3.0, initial_value: 0, comment: '30 second pulse' },
    { name: 'P_1min', location: 'control', type: 'bit', address: 3.1, initial_value: 0, comment: '1 minute pulse' },
    { name: 'P_2min', location: 'control', type: 'bit', address: 3.2, initial_value: 0, comment: '2 minute pulse' },
    { name: 'P_5min', location: 'control', type: 'bit', address: 3.3, initial_value: 0, comment: '5 minute pulse' },
    { name: 'P_10min', location: 'control', type: 'bit', address: 3.4, initial_value: 0, comment: '10 minute pulse' },
    { name: 'P_15min', location: 'control', type: 'bit', address: 3.5, initial_value: 0, comment: '15 minute pulse' },
    { name: 'P_30min', location: 'control', type: 'bit', address: 3.6, initial_value: 0, comment: '30 minute pulse' },
    { name: 'P_1hr', location: 'control', type: 'bit', address: 3.7, initial_value: 0, comment: '1 hour pulse' },
    { name: 'P_2hr', location: 'control', type: 'bit', address: 4.0, initial_value: 0, comment: '2 hour pulse' },
    { name: 'P_3hr', location: 'control', type: 'bit', address: 4.1, initial_value: 0, comment: '3 hour pulse' },
    { name: 'P_4hr', location: 'control', type: 'bit', address: 4.2, initial_value: 0, comment: '4 hour pulse' },
    { name: 'P_5hr', location: 'control', type: 'bit', address: 4.3, initial_value: 0, comment: '5 hour pulse' },
    { name: 'P_6hr', location: 'control', type: 'bit', address: 4.4, initial_value: 0, comment: '6 hour pulse' },
    { name: 'P_12hr', location: 'control', type: 'bit', address: 4.5, initial_value: 0, comment: '12 hour pulse' },
    { name: 'P_1day', location: 'control', type: 'bit', address: 4.6, initial_value: 0, comment: '1 day pulse' },

    { name: 'S_100ms', location: 'control', type: 'bit', address: 5.0, initial_value: 0, comment: '100ms square wave' },
    { name: 'S_200ms', location: 'control', type: 'bit', address: 5.1, initial_value: 0, comment: '200ms square wave' },
    { name: 'S_300ms', location: 'control', type: 'bit', address: 5.2, initial_value: 0, comment: '300ms square wave' },
    { name: 'S_500ms', location: 'control', type: 'bit', address: 5.3, initial_value: 0, comment: '500ms square wave' },
    { name: 'S_1s', location: 'control', type: 'bit', address: 5.4, initial_value: 0, comment: '1 second square wave' },
    { name: 'S_2s', location: 'control', type: 'bit', address: 5.5, initial_value: 0, comment: '2 second square wave' },
    { name: 'S_5s', location: 'control', type: 'bit', address: 5.6, initial_value: 0, comment: '5 second square wave' },
    { name: 'S_10s', location: 'control', type: 'bit', address: 5.7, initial_value: 0, comment: '10 second square wave' },
    { name: 'S_30s', location: 'control', type: 'bit', address: 6.0, initial_value: 0, comment: '30 second square wave' },
    { name: 'S_1min', location: 'control', type: 'bit', address: 6.1, initial_value: 0, comment: '1 minute square wave' },
    { name: 'S_2min', location: 'control', type: 'bit', address: 6.2, initial_value: 0, comment: '2 minute square wave' },
    { name: 'S_5min', location: 'control', type: 'bit', address: 6.3, initial_value: 0, comment: '5 minute square wave' },
    { name: 'S_10min', location: 'control', type: 'bit', address: 6.4, initial_value: 0, comment: '10 minute square wave' },
    { name: 'S_15min', location: 'control', type: 'bit', address: 6.5, initial_value: 0, comment: '15 minute square wave' },
    { name: 'S_30min', location: 'control', type: 'bit', address: 6.6, initial_value: 0, comment: '30 minute square wave' },
    { name: 'S_1hr', location: 'control', type: 'bit', address: 6.7, initial_value: 0, comment: '1 hour square wave' },

    { name: 'elapsed_seconds', location: 'control', type: 'byte', address: 8.0, initial_value: 0, comment: 'Elapsed seconds' },
    { name: 'elapsed_minutes', location: 'control', type: 'byte', address: 9.0, initial_value: 0, comment: 'Elapsed minutes' },
    { name: 'elapsed_hours', location: 'control', type: 'byte', address: 10.0, initial_value: 0, comment: 'Elapsed hours' },
    { name: 'elapsed_days', location: 'control', type: 'byte', address: 11.0, initial_value: 0, comment: 'Elapsed days' },

    { name: 'system_uptime', location: 'control', type: 'dint', address: 12.0, initial_value: 0, comment: 'System uptime in seconds' },
].map(s => ({ ...s, readonly: true })))

const LOCAL_STORAGE_KEY = 'vovk_plc_project_autosave'


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
      'K': 'control',
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
                    // Special windows (symbols, setup, memory) that don't live in the project tree
                    const isSpecialWindow = id === 'symbols' || id === 'setup' || id === 'memory'
                    
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
   * @returns {Promise<{size: number, output: string, bytecode?: string, problem?: any, compileTime?: number, memory?: any, flash?: any, execution?: any}>}
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

        return {
            size: result.output?.flash?.used || 0,
            output: result.bytecode || '',
            bytecode: result.bytecode,
            compileTime: result.compileTime,
            memory: result.output?.memory,
            flash: result.output?.flash,
            execution: result.output?.execution
        }
    } catch (e) {
        cleanup()
        throw e
    }
  }

  /**
   * Builds a VOVKPLCPROJECT format string from the current project
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
    const kSize = offsets.control?.size || 64
    const xSize = offsets.input?.size || 64
    const ySize = offsets.output?.size || 64
    const sSize = offsets.system?.size || 256
    const mSize = offsets.marker?.size || 256
    const tSize = offsets.timer?.size || 16
    const cSize = offsets.counter?.size || 16
    
    // Total memory is sum of all areas
    const totalMemory = kSize + xSize + ySize + sSize + mSize + tSize + cSize
    
    lines.push('MEMORY')
    lines.push(`    OFFSET 0`)
    lines.push(`    AVAILABLE ${totalMemory}`)
    lines.push(`    K ${kSize}`)
    lines.push(`    X ${xSize}`)
    lines.push(`    Y ${ySize}`)
    lines.push(`    S ${sSize}`)
    lines.push(`    M ${mSize}`)
    lines.push(`    T ${tSize}`)
    lines.push(`    C ${cSize}`)
    lines.push('END_MEMORY')
    lines.push('')

    // Symbols section
    const symbols = project.symbols || []
    const userSymbols = symbols.filter(s => !s.readonly)
    if (userSymbols.length > 0) {
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
            'control': 'K',
            'input': 'X',
            'output': 'Y',
            'system': 'S',
            'marker': 'M'
        }
        
        for (const sym of userSymbols) {
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
        
        let filePath = file.full_path || file.path || file.name || 'main'
        // Remove leading slash if present (FILE paths should not start with /)
        if (filePath.startsWith('/')) filePath = filePath.substring(1)
        lines.push(`FILE ${filePath}`)
        
        const blocks = file.blocks || []
        for (const block of blocks) {
            const blockName = block.name || 'Code'
            const blockType = block.type || 'asm'
            
            // Map block type to language
            const langMap = {
                'asm': 'PLCASM',
                'plcasm': 'PLCASM',
                'stl': 'STL',
                'ladder': 'LADDER'
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
        
        lines.push(`END_FILE`)
        lines.push('')
    }

    return lines.join('\n')
  }

  /** Create a new empty project structure */
  /** @returns {PLC_Project} */
  createEmptyProject() {
    return {
      offsets: {
        control: { offset: 0, size: 16 },
        counter: { offset: 16, size: 64 },
        timer: { offset: 80, size: 64 },
        input: { offset: 144, size: 16 },
        output: { offset: 160, size: 16 },
        system: { offset: 176, size: 16 },
        marker: { offset: 192, size: 64 }
      },
      symbols: [...SYSTEM_SYMBOLS],
      info: {
        type: 'Device',
        arch: 'avr',
        version: '0.0.1',
        capacity: 1024
      },
      folders: [],
      files: []
    }
  }
} 
