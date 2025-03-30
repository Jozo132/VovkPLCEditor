// @ts-check
"use strict"

import { LanguageModule, RendererModule } from "./types.js"

import ladderRenderer from "./ladder/renderer.js"
import ladderLanguage, { PLC_Ladder } from "./ladder/language.js"


/** 
 * @typedef { PLC_Ladder } PLC_ProgramBlock 
**/

/**  @type { { renderer: RendererModule, language: LanguageModule }[] } */
export default [
    { renderer: ladderRenderer, language: ladderLanguage }, // Ladder Language
]