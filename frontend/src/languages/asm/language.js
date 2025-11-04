import { PLC_ContextState, PLC_Symbol } from "../../utils/types.js"
import { LanguageModule } from "../types.js"
// import { evaluateAssembly } from "./evaluator.js"



/**
 * @typedef {{ 
 *      id?: string, 
 *      type: 'asm', 
 *      name: string, 
 *      comment: string, 
 *      code: string, 
 *      div?: Element, 
 *      mode?: PLC_ContextState
 * }} PLC_Assembly * @type { PLC_Assembly }
**/
export let PLC_Assembly

/** @type { LanguageModule } */
export const asmLanguage = {
    id: 'asm',
    name: 'PLC Assembly',

    evaluate(editor, block) {
        if (block.type !== 'asm') throw new Error('Invalid block type for asm evaluation')
        // evaluateAssembly(editor, block)
    },

    compile(block) {
        if (block.type !== 'asm') throw new Error('Invalid block type for asm compilation')
        return block.code
    },

    toString(block) {
        return block.name + ' (' + block.type + ')'
    },
}

export default asmLanguage