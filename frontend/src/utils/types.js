import EditorUI from '../editor/UI/Elements/EditorUI.js'

/** @typedef { import('../editor/Editor.js').VovkPLCEditor } PLCEditor * @type { PLCEditor } */
export let PLCEditor


/** @typedef { import('../editor/ContextManager.js').MenuElement } MenuElement * @type { MenuElement } */
export let MenuElement

/** @typedef { import('../editor/ContextManager.js').MenuListener } MenuListener * @type { MenuListener } */
export let MenuListener

/** @typedef { 'locked' | 'unlocked' | 'editing' | 'live'  | 'editing_live' } PLC_ContextState * @type { PLC_ContextState } */
export let PLC_ContextState

/** @typedef { 'control' | 'input' | 'output' | 'memory' } PLC_Symbol_Location * @type { PLC_Symbol_Location } */
export let PLC_Symbol_Location

/** @typedef { 'bit' | 'byte' | 'int' | 'dint' | 'real' } PLC_Symbol_Type * @type { PLC_Symbol_Type } */
export let PLC_Symbol_Type

/** 
 * @typedef {{
 *     name: string,
 *     location: PLC_Symbol_Location,
 *     type: PLC_Symbol_Type,
 *     address: number,
 *     initial_value: number,
 *     comment: string
 * }} PLC_Symbol * @type { PLC_Symbol } 
**/
export let PLC_Symbol


/** @typedef { import('../languages/index.js').PLC_ProgramBlock } PLC_ProgramBlock * @type { PLC_ProgramBlock } */
export let PLC_ProgramBlock

/** @typedef {{ id?: string, path: string, full_path: string, type: 'program', name: string, comment: string, blocks: PLC_ProgramBlock[], host?: EditorUI, tab?: Element }} PLC_Program * @type { PLC_Program } */
export let PLC_Program

/** @typedef { PLC_Program } PLC_ProjectItem * @type { PLC_ProjectItem } */
export let PLC_ProjectItem


/**
 * @typedef {{ 
*     offsets: {
*         control: { offset: number, size: number }
*         input: { offset: number, size: number }
*         output: { offset: number, size: number }
*         memory: { offset: number, size: number }
*         system: { offset: number, size: number }
*     }
*     symbols: PLC_Symbol[]
*     folders: string[]
*     files: PLC_ProjectItem[]
* }} PLC_Project * @type { PLC_Project }
**/
export let PLC_Project