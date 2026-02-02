import { PLC_ContextState, PLC_Symbol } from "../../utils/types.js"
import { LanguageModule } from "../types.js"

/**
 * @typedef {{ 
 *      id?: string, 
 *      type: 'st', 
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
 * }} PLC_ST
 * @type { PLC_ST }
**/
export let PLC_ST

/** @type { LanguageModule } */
export const stLanguage = {
    id: 'st',
    name: 'Structured Text',

    evaluate(editor, block) {
        if (block.type !== 'st') throw new Error('Invalid block type for st evaluation')
        // ST evaluation would go here if needed
    },

    /**
     * Compiles Structured Text (IEC 61131-3) code to PLCASM assembly.
     * This transpilation step is performed by the VovkPLC runtime's ST compiler.
     * ST is first transpiled to PLCScript, then PLCScript to PLCASM.
     * The returned PLCASM is then compiled to bytecode by the standard compiler.
     * 
     * @param {PLC_ST} block - The ST block to compile
     * @param {object} [options] - Compilation options
     * @param {object} [options.runtime] - The VovkPLC runtime instance
     * @returns {string} - The transpiled PLCASM code
     */
    compile(block, options = {}) {
        if (block.type !== 'st') throw new Error('Invalid block type for st compilation')
        
        // The actual ST->PLCScript->PLCASM transpilation is done by the runtime
        // This compile method returns the raw ST code which will be
        // transpiled before bytecode compilation in _buildAsmAssembly
        return block.code
    },

    toString(block) {
        return block.name + ' (' + block.type + ')'
    },
}

export default stLanguage
