import { PLC_Program, PLC_Project, PLCEditor } from '../utils/types.js'

const SYSTEM_SYMBOLS = [
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

    { name: 'elapsed_days', location: 'control', type: 'byte', address: 8.0, initial_value: 0, comment: 'Elapsed days' },
    { name: 'elapsed_hours', location: 'control', type: 'byte', address: 9.0, initial_value: 0, comment: 'Elapsed hours' },
    { name: 'elapsed_minutes', location: 'control', type: 'byte', address: 10.0, initial_value: 0, comment: 'Elapsed minutes' },
    { name: 'elapsed_seconds', location: 'control', type: 'byte', address: 11.0, initial_value: 0, comment: 'Elapsed seconds' },

    { name: 'system_uptime', location: 'control', type: 'dint', address: 12.0, initial_value: 0, comment: 'System uptime in seconds' },
].map(s => ({ ...s, readonly: true }))

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
          console.log('[ProjectManager] Restoring project from localStorage')
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
    
    // Split user symbols from existing system symbols (to re-add them in correct order)
    const userSymbols = project.symbols.filter(s => !s.readonly)
    // Actually we can just filter out any existing system symbols by name to be safe
    const systemNames = new Set(SYSTEM_SYMBOLS.map(s => s.name))
    const cleanUserSymbols = userSymbols.filter(s => !systemNames.has(s.name))
    
    project.symbols = [...SYSTEM_SYMBOLS, ...cleanUserSymbols]
  }

  checkAndSave() {
    if (!this.#editor.project) return

    this.collectProjectState()

    try {
      // Filter out system symbols before saving
      const projectToSave = { ...this.#editor.project }
      if (projectToSave.symbols) {
          projectToSave.symbols = projectToSave.symbols.filter(s => !s.readonly)
      }

      const current_state = JSON.stringify(projectToSave)
      if (current_state !== this.last_saved_state) {
        localStorage.setItem(LOCAL_STORAGE_KEY, current_state)
        this.last_saved_state = current_state
        console.log('[ProjectManager] Project saved to localStorage')
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

    // Update project
    this.#editor.project.files = files
    this.#editor.project.folders = folders
    this.#editor.project._ui_state = {
        open_tabs: openTabs,
        active_tab: activeTab,
        active_device: activeDevice,
        tree_state: treeState
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
            const { open_tabs, active_tab, active_device, tree_state } = project._ui_state
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
                    // Check if file still exists in project
                    // The openTab method needs the file to exist in the tree/project structure
                    // We assume openProject has already populated the tree
                    try {
                        // Check if it exists
                        const exists = this.#editor.findProgram(id)
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
   * Compiles the current project
   * @returns {{size: number, output: string}}
   */
  compile() {
    // Ensure project state is up to date before compiling
    this.checkAndSave()

    let asm = ''
    try {
        const project = this.#editor.project
        // Iterate over all files in the project
        if (project.files) {
            for (const file of project.files) {
                if (file.blocks) {
                    for (const block of file.blocks) {
                        if (block.type === 'asm' && block.code) {
                            asm += block.code + '\n'
                        } else if (block.type !== 'asm') {
                            const msg = `${file.full_path} -> ${block.name || '?'}: Block type '${block.type}' not yet supported for compilation`
                            console.log(msg)
                            this.#editor.window_manager.logToConsole(msg, 'warning')
                        }
                    }
                }
            }
        }

        // Symbol Replacement
        if (asm && project.symbols) {
             project.symbols.forEach(symbol => {
                if (!symbol.name) return
                const name = symbol.name
                
                // Calculate absolute address based on location offset
                let base_offset = 0
                if (symbol.location && project.offsets && project.offsets[symbol.location]) {
                    base_offset = project.offsets[symbol.location].offset || 0
                }

                let addressStr = ''
                
                if (symbol.type === 'bit') {
                    const val = parseFloat(symbol.address) || 0
                    const byte = Math.floor(val)
                    // Extract bit index from decimal part (e.g. 2.4 -> 4)
                    const bit = Math.round((val - byte) * 10)
                    
                    addressStr = (base_offset + byte) + '.' + bit
                } else {
                     const val = parseFloat(symbol.address) || 0
                     addressStr = (base_offset + Math.floor(val)).toString()
                }

                // Replace whole words only
                const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                const regex = new RegExp(`\\b${escapedName}\\b`, 'g')
                asm = asm.replace(regex, addressStr)
            })
        }

    } catch(e) { console.warn('Could not extract ASM from project', e) }

    if (!asm) {
        // Fallback or empty?
        // Reuse the fallback logic if desired, or throw error
         asm = `
    u8.readBit     2.4    // Read bit 2.4 which is 1s pulse
    jump_if_not    end    // Jump to the label 'end' if the bit is OFF
    u8.writeBitInv 32.0   // Invert bit 32.0
end:                      // Label to jump to
`
    }
    
    // Hook up console locally to capture WASM output
    const runtime = this.#editor.runtime
    const cleanup = () => {
        runtime.onStdout(undefined)
        runtime.onStderr(undefined)
    }

    runtime.onStdout((msg) => this.#editor.window_manager.logToConsole(msg, 'info'))
    runtime.onStderr((msg) => this.#editor.window_manager.logToConsole(msg, 'error'))

    try {
        const result = runtime.compile(asm)
        cleanup()
        return result
    } catch (e) {
        cleanup()
        throw e
    }
  }

  /** Create a new empty project structure */
  /** @returns {PLC_Project} */
  createEmptyProject() {
    return {
      offsets: {
        control: { offset: 0, size: 16 },
        input: { offset: 16, size: 16 },
        output: { offset: 32, size: 16 },
        memory: { offset: 48, size: 16 },
        system: { offset: 64, size: 16 }
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
