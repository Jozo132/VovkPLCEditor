// @ts-check
"use strict"

import { RendererModule, LanguageModule } from "../languages/types.js"
import { PLC_ProgramBlock, PLCEditor } from "../utils/types.js"
import defaultLanguages from "../languages/index.js"

export default class LanguageManager {

  /**
   * Map of renderers by block type
   * @type {Record<string, RendererModule>}
   */
  #renderers = {}

  /**
   * Map of language modules by block type
   * @type {Record<string, LanguageModule>}
   */
  #languages = {}

  #editor

  /** @param {PLCEditor} editor */
  constructor(editor) {
    this.#editor = editor
    defaultLanguages.forEach(module => this.register(module)) // Register default languages
  }

  /**
   * Render a program block (via its registered renderer)
   * @param {CanvasRenderingContext2D} ctx
   * @param {PLC_ProgramBlock} block
   */
  renderBlock(ctx, block) {
    const renderer = this.getRenderer(block.type)
    if (renderer) {
      renderer.render(this.#editor, ctx, block)
    } else {
      console.warn(`No renderer registered for block type: ${block.type}`)
    }
  }

  /**
   * Evaluate a program block (via its registered language module)
   * @param {PLC_ProgramBlock} block
   */
  evaluateBlock(block) {
    const language = this.getLanguage(block.type)
    if (language) {
      language.evaluate(this.#editor, block)
    } else {
      console.warn(`No language module registered for block type: ${block.type}`)
    }
  }

  /** Register a new module @param {{ renderer: RendererModule, language: LanguageModule }} module */
  register = (module) => {
    if (!module) throw new Error('Module is undefined')
    this.registerRenderer(module.renderer)
    this.registerLanguage(module.language)
  }

  /** Register a new renderer module @param {RendererModule} renderer */
  registerRenderer = renderer => {
    if (!renderer) throw new Error('Module has no renderer')
    if (!renderer.id) throw new Error('Module renderer has no id')
    renderer = { ...renderer } // Clone the renderer object to avoid mutation
    this.#renderers[renderer.id] = renderer
  }

  /** Register a new language module @param {LanguageModule} language */
  registerLanguage = language => {
    if (!language) throw new Error('Module has no language')
    if (!language.id) throw new Error('Module language has no id')
    language = { ...language } // Clone the language object to avoid mutation
    this.#languages[language.id] = language
  }

  /** Get renderer @type { (id: string) => RendererModule | null } */
  getRenderer = id => this.#renderers[id] || null

  /** Get renderer @type { (id: string) => LanguageModule | null } */
  getLanguage = id => this.#languages[id] || null
}
