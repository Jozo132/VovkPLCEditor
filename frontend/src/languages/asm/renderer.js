import { MiniCodeEditor } from "../MiniCodeEditor.js"
import { RendererModule } from "../types.js"
// import { resolveBlockState } from "./evaluator.js"


/** @type { RendererModule } */
export const ladderRenderer = {
  id: 'asm',

  render(editor, block, ctx) {
    if (block.type !== 'asm') return
    const { div, id, type, name, props } = block

    if (!div) throw new Error('Block div not found')
    const block_container = div.querySelector('.plc-program-block-code')
    if (!block_container) throw new Error('Block code not found')
    
    // If loaded from JSON, props.text_editor might be a plain object
    if (props.text_editor && !(props.text_editor instanceof MiniCodeEditor)) {
        props.text_editor = null
    }

    if (!props.text_editor) {
      const updateBlockSize = () => {
        const height = text_editor.getScrollHeight()
        const block_height = height > 800 ? 800 : height < 100 ? 100 : height // @ts-ignore
        block_container.style.height = `${block_height}px`
      }
      const text_editor = new MiniCodeEditor(block_container, {
        language: 'asm',
        value: block.code,
        font: '12px Consolas, monospace',
        symbolProvider: (type) => {
            if (type === 'label') {
                const matches = block.code.matchAll(/^\s*([A-Za-z_]\w+):/gm)
                return [...matches].map(m => ({name: m[1], type: 'Label'}))
            }
            if (!editor.project || !editor.project.symbols) return []
            
            let symbols = editor.project.symbols
            if (type === 'bit_symbol') {
                 symbols = symbols.filter(s => s.type === 'bit')
            }
            
            // Return full symbol objects
            return symbols.map(s => ({name: s.name, type: s.type}))
        },
        onChange: (value) => {
          block.code = value
          updateBlockSize()
        }
      })
      // console.log('ASM editor created')
      // console.log(text_editor)
      props.text_editor = text_editor
      setTimeout(updateBlockSize, 400) // Wait for the editor to be created
    }
  }
}

export default ladderRenderer