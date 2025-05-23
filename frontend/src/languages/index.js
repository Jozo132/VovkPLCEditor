// @ts-check
"use strict"

import { LanguageModule, RendererModule } from "./types.js"

import ladderRenderer from "./ladder/renderer.js"
import ladderLanguage, { PLC_Ladder } from "./ladder/language.js"

import asmRenderer from "./asm/renderer.js"
import asmLanguage, { PLC_Assembly } from "./asm/language.js"


/** 
 * @typedef {{ [property: string]: any }} PLC_ProgramProperty
 * @typedef { { props?: any } & (PLC_Ladder | PLC_Assembly) } PLC_ProgramBlock 
**/

/**  @type { { renderer: RendererModule, language: LanguageModule }[] } */
export default [
    { renderer: ladderRenderer, language: ladderLanguage }, // Ladder Language
    { renderer: asmRenderer, language: asmLanguage }, // Assembly Language
]