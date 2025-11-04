import { PLC_Project, PLCEditor } from '../utils/types.js'




export default class ProjectManager {
  #editor
  /** @param {PLCEditor} editor */
  constructor(editor) {
    this.#editor = editor
  }

  initialize() {
    // TODO: Finish this
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
