import { PLC_ContextState, PLC_Symbol } from "../../utils/types.js"
import { LanguageModule } from "../types.js"

/**
 * @typedef {{ 
 *      id?: string, 
 *      type: 'plcscript', 
 *      name: string, 
 *      comment: string, 
 *      code: string, 
 *      div?: Element, 
 *      mode?: PLC_ContextState,
 *      cached_asm?: string,
 *      cached_checksum?: string,
 *      cached_symbols_checksum?: string,
 *      cached_asm_map?: any,
 *      cached_symbol_refs?: any,
 *      programId?: string
 * }} PLC_PLCScript
 * @type { PLC_PLCScript }
**/
export let PLC_PLCScript

/** @type { LanguageModule } */
export const plcscriptLanguage = {
    id: 'plcscript',
    name: 'PLCScript',

    evaluate(editor, block) {
        if (block.type !== 'plcscript') throw new Error('Invalid block type for plcscript evaluation')
        // PLCScript evaluation would go here if needed
    },

    /**
     * Compiles PLCScript code to PLCASM assembly.
     * This transpilation step is performed by the VovkPLC runtime's PLCScript compiler.
     * The returned PLCASM is then compiled to bytecode by the standard compiler.
     * 
     * @param {PLC_PLCScript} block - The PLCScript block to compile
     * @param {object} [options] - Compilation options
     * @param {object} [options.runtime] - The VovkPLC runtime instance
     * @returns {string} - The transpiled PLCASM code
     */
    compile(block, options = {}) {
        if (block.type !== 'plcscript') throw new Error('Invalid block type for plcscript compilation')
        
        // The actual PLCScript->PLCASM transpilation is done by the runtime
        // This compile method returns the raw PLCScript code which will be
        // transpiled before bytecode compilation in _buildAsmAssembly
        return block.code
    },

    toString(block) {
        return block.name + ' (' + block.type + ')'
    },
}

export default plcscriptLanguage
