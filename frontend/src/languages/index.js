import { LanguageModule, RendererModule } from "./types.js"

import ladderRenderer from "./ladder/renderer.js"
import ladderLanguage, { PLC_Ladder } from "./ladder/language.js"

import asmRenderer from "./asm/renderer.js"
import asmLanguage, { PLC_Assembly } from "./asm/language.js"

import stlRenderer from "./stl/renderer.js"
import stlLanguage, { PLC_STL } from "./stl/language.js"

import plcscriptRenderer from "./plcscript/renderer.js"
import plcscriptLanguage, { PLC_PLCScript } from "./plcscript/language.js"

import stRenderer from "./st/renderer.js"
import stLanguage, { PLC_ST } from "./st/language.js"


/** 
 * @typedef {{ [property: string]: any }} PLC_ProgramProperty
 * @typedef { { props?: any } & (PLC_Ladder | PLC_Assembly | PLC_STL | PLC_PLCScript | PLC_ST) } PLC_ProgramBlock 
**/

/**  @type { { renderer: RendererModule, language: LanguageModule }[] } */
export default [
    { renderer: ladderRenderer, language: ladderLanguage }, // Ladder Language
    { renderer: asmRenderer, language: asmLanguage }, // Assembly Language
    { renderer: stlRenderer, language: stlLanguage }, // Siemens STL Language
    { renderer: plcscriptRenderer, language: plcscriptLanguage }, // PLCScript Language
    { renderer: stRenderer, language: stLanguage }, // IEC 61131-3 Structured Text Language
]