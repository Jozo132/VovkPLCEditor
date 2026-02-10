import EditorUI from '../editor/UI/Elements/EditorUI.js'

/** @typedef { import('../editor/Editor.js').VovkPLCEditor } PLCEditor * @type { PLCEditor } */
export let PLCEditor


/** @typedef { import('../editor/ContextManager.js').MenuElement } MenuElement * @type { MenuElement } */
export let MenuElement

/** @typedef { import('../editor/ContextManager.js').MenuListener } MenuListener * @type { MenuListener } */
export let MenuListener

/** @typedef { 'locked' | 'unlocked' | 'editing' | 'live'  | 'editing_live' } PLC_ContextState * @type { PLC_ContextState } */
export let PLC_ContextState

/** @typedef { 'counter' | 'timer' | 'input' | 'output' | 'system' | 'marker' | 'memory' } PLC_Symbol_Location * @type { PLC_Symbol_Location } */
export let PLC_Symbol_Location

/** @typedef { 'bit' | 'byte' | 'int' | 'dint' | 'real' | 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32' | 'f32' | 'str8' | 'str16' | 'cstr8' | 'cstr16' } PLC_Symbol_Type * @type { PLC_Symbol_Type } */
export let PLC_Symbol_Type

/** 
 * @typedef {{
 *     name: string,
 *     location: PLC_Symbol_Location,
 *     type: PLC_Symbol_Type,
 *     address: number,
 *     initial_value: number | string,
 *     comment: string,
 *     readonly?: boolean,
 *     device?: boolean,
 *     array_size?: number
 * }} PLC_Symbol * @type { PLC_Symbol } 
**/
export let PLC_Symbol


/** @typedef { import('../languages/index.js').PLC_ProgramBlock } PLC_ProgramBlock * @type { PLC_ProgramBlock } */
export let PLC_ProgramBlock

/** @typedef {{ id?: string, path: string, full_path: string, type: 'program', name: string, comment: string, blocks: PLC_ProgramBlock[], host?: EditorUI, tab?: Element, scrollTop?: number }} PLC_Program * @type { PLC_Program } */
export let PLC_Program

/** @typedef { PLC_Program } PLC_ProjectItem * @type { PLC_ProjectItem } */
export let PLC_ProjectItem


/**
 * @typedef {{
 *     name: string,
 *     type: PLC_Symbol_Type,
 *     defaultValue?: number | string,
 *     comment?: string,
 * }} PLC_DataBlockField * @type { PLC_DataBlockField }
 **/
export let PLC_DataBlockField

/**
 * @typedef {{
 *     id: number,
 *     name: string,
 *     address?: number,
 *     fields: PLC_DataBlockField[],
 *     comment?: string,
 * }} PLC_DataBlock * @type { PLC_DataBlock }
 **/
export let PLC_DataBlock


/**
 * @typedef {{ 
*     info?: { name?: string, version?: string, type?: string, arch?: string, capacity?: number, author?: string, description?: string }
*     _ui_state?: any
*     offsets: {
*         system: { offset: number, size: number }
*         counter: { offset: number, size: number }
*         timer: { offset: number, size: number }
*         input: { offset: number, size: number }
*         output: { offset: number, size: number }
*         marker: { offset: number, size: number }
*     }
*     symbols: PLC_Symbol[]
*     device_symbols?: PLC_Symbol[]
*     datablocks?: PLC_DataBlock[]
*     folders: string[]
*     files: PLC_ProjectItem[]
*     watch?: { name: string, format?: string }[]
*     lastPhysicalDevice?: { deviceInfo?: any, transports?: any[], symbols?: any[], datablockInfo?: { slots: number, active: number, table_offset: number, free_space: number, lowest_address: number, entries: Array<{ db: number, offset: number, size: number }> }, timestamp?: string }
* }} PLC_Project * @type { PLC_Project }
**/
export let PLC_Project
