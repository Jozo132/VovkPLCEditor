// @ts-check
"use strict"

import { PLC_ProgramBlock, PLCEditor } from "../utils/types.js";

/**
 * @typedef {{
 *    id: string;
 *    render(editor: PLCEditor, ctx: CanvasRenderingContext2D, block: PLC_ProgramBlock): void;
 * }} RendererModule
 * @type { RendererModule }
**/
export let RendererModule

/**
 * @typedef {{
 *    id: string;
 *    name: string;
 *    evaluate(editor: PLCEditor, block: PLC_ProgramBlock): void;
 *    compile(block: PLC_ProgramBlock): string;
 *    toString(block: PLC_ProgramBlock): string;
 * }} LanguageModule
 * @type { LanguageModule }
**/
export let LanguageModule