import { PLC_ContextState, PLC_Symbol } from "../../utils/types.js"
import { LanguageModule } from "../types.js"

/**
 * @typedef {{ 
 *      id?: string, 
 *      type: 'stl', 
 *      name: string, 
 *      comment: string, 
 *      code: string, 
 *      div?: Element, 
 *      mode?: PLC_ContextState
 * }} PLC_STL
 * @type { PLC_STL }
**/
export let PLC_STL

/** @type { LanguageModule } */
export const stlLanguage = {
    id: 'stl',
    name: 'Siemens STL',

    evaluate(editor, block) {
        if (block.type !== 'stl') throw new Error('Invalid block type for stl evaluation')
        // STL evaluation would go here if needed
    },

    /**
     * Compiles STL code to PLCASM assembly.
     * This transpilation step is performed by the VovkPLC runtime's STL compiler.
     * The returned PLCASM is then compiled to bytecode by the standard compiler.
     * 
     * @param {PLC_STL} block - The STL block to compile
     * @param {object} [options] - Compilation options
     * @param {object} [options.runtime] - The VovkPLC runtime instance
     * @returns {string} - The transpiled PLCASM code
     */
    compile(block, options = {}) {
        if (block.type !== 'stl') throw new Error('Invalid block type for stl compilation')
        
        // The actual STL->PLCASM transpilation is done by the runtime
        // This compile method returns the raw STL code which will be
        // transpiled before bytecode compilation in _buildAsmAssembly
        return block.code
    },

    toString(block) {
        return block.name + ' (' + block.type + ')'
    },
}

export default stlLanguage
