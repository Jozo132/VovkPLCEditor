import { VovkPLCEditor } from "./editor/Editor.js"
import { plc_project } from "./sample/demo.js"

const root = document.getElementById("PLCEditor")
// const root2 = document.getElementById("PLCEditor2")

const editor = new VovkPLCEditor({
    workspace: root,
    debug_css: false,
    debug_context: false,
    debug_hover: false
})

// editor.openProject(plc_project)

// const editor2 = new VovkPLCEditor({
//     workspace: root2,
//     initial_program: plc_project
// })

// Attach helpers to window (optional for testing)
Object.assign(window, { editor, plc_project })


// const PLCEditor = new VovkPLCEditor({
//     workspace: 'PLCEditor',
//     // debug_css: true,
//     initial_program: 'main'
// })

// editor.open(plc_project)


// const toggle_input = (offset) => {
//     let state = PLCEditor.getInputBit(offset)
//     state = !state
//     PLCEditor.setInputBit(offset, state)
// }

// const toggle_output = (offset) => {
//     let state = PLCEditor.getOutputBit(offset)
//     state = !state
//     PLCEditor.setOutputBit(offset, state)
// }


// let cycle = 0
// const draw = () => {
//     if (!PLCEditor.runtime_ready) return // Wait for the runtime to be ready
//     cycle++
//     if (cycle === 1) {
//         PLCEditor.runtime.downloadBytecode('5D 00 05 61 00 20 FF')
//     }

//     PLCEditor.draw()
// }


// draw()
// setInterval(draw, 20)


// Object.assign(window, { PLCEditor, runtime: PLCEditor.runtime, draw, plc_project, toggle_input, toggle_output })