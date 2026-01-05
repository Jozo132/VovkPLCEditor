import { PLC_Project, PLCEditor } from '../utils/types.js'

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
          this.#editor.openProject(project)
          // Disable default initial program since we restored one
          this.#editor.initial_program = null
          this.last_saved_state = saved
        }
      }
    } catch (e) {
      console.error('[ProjectManager] Failed to restore project from localStorage', e)
    }
  }

  checkAndSave() {
    if (!this.#editor.project) return

    this.collectProjectState()

    try {
      const current_state = JSON.stringify(this.#editor.project)
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
        // Create a clean copy to avoid circular references (like .host added by EditorUI)
        return {
          type: source.type,
          name: source.name,
          path: source.path,
          full_path: source.full_path,
          comment: source.comment,
          blocks: source.blocks // Assumes blocks don't have circular references
        }
      }) // PLC_File -> item (PLC_ProjectItem)

    // Collect folders
    const folders = root
      .filter(item => item.type === 'folder')
      .map(item => item.full_path)

    // Update project
    this.#editor.project.files = files
    this.#editor.project.folders = folders
  }

  /** Load a project and initialize editor state */
  /** @param {PLC_Project} project */
  load(project) {
    this.#editor.project = project
  }

  /** Save current project to JSON */
  save() {
    return JSON.stringify(this.#editor.project, null, 2)
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
      symbols: [],
      folders: [],
      files: []
    }
  }
} 
