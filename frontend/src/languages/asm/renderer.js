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
        blockId: block.id,
        onLintHover: payload => {
          if (editor.window_manager?.setProblemHover) {
            editor.window_manager.setProblemHover(payload)
          }
        },
        onGoToDefinition: payload => {
          if (payload?.type === 'symbol' && editor.window_manager?.focusSymbolByName) {
            editor.window_manager.focusSymbolByName(payload.name)
          }
        },
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
        hoverProvider: (word) => {
            if (!editor.project || !editor.project.symbols) return null
            const sym = editor.project.symbols.find(s => s.name === word)
            if (sym) {
                // Return HTML string
                let addr = sym.address
                if (sym.type === 'bit') addr = (parseFloat(addr) || 0).toFixed(1)
                
                const locationColors = {
                    input: '#89d185',
                    output: '#d68d5e',
                    memory: '#c586c0',
                    control: '#4fc1ff',
                    system: '#a0a0a0'
                }

                const typeColors = {
                    bit: '#569cd6',
                    byte: '#4ec9b0',
                    int: '#b5cea8',
                    dint: '#dcdcaa',
                    real: '#ce9178'
                }
                
                const locColor = locationColors[sym.location] || '#cccccc'
                const typeColor = typeColors[sym.type] || '#808080'

                return `
                    <div class="mce-hover-def" style="display: flex; align-items: center; gap: 6px;">
                        <span class="icon" style="width: 14px; height: 14px; background-size: contain; background-repeat: no-repeat; background-image: url('data:image/svg+xml,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; viewBox=&quot;0 0 16 16&quot;><path fill=&quot;%23cccccc&quot; d=&quot;M14 4h-2a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2h2v-2h-2V6h2V4zM4 12V4h6v8H4z&quot;/></svg>')"></span>
                        <span style="color:#4daafc">${sym.name}</span>
                        <span style="color:${typeColor}; margin-left: auto; font-weight: bold;">${sym.type}</span>
                    </div>
                    <div class="mce-hover-desc">
                        <div><span style="color:#bbb">Location:</span> <span style="color:${locColor}">${sym.location}</span></div>
                        <div><span style="color:#bbb">Address:</span> <span style="color:#b5cea8">${addr}</span></div>
                        ${sym.comment ? `<div style="margin-top:4px; font-style: italic; color:#6a9955">// ${sym.comment}</div>` : ''}
                    </div>
                `
            }
            return null
        },
        lintProvider: async () => {
            if (!block.id || !editor.lintBlock) return []
            return await editor.lintBlock(block.id)
        },
        onScroll: pos => {
          block.scrollTop = pos.top
          block.scrollLeft = pos.left
        },
        onChange: (value) => {
          block.code = value
          updateBlockSize()
        }
      })
      // console.log('ASM editor created')
      // console.log(text_editor)
      props.text_editor = text_editor
      if (typeof text_editor.setScroll === 'function') {
        requestAnimationFrame(() => {
          const hasTop = typeof block.scrollTop === 'number'
          const hasLeft = typeof block.scrollLeft === 'number'
          if (hasTop || hasLeft) {
            text_editor.setScroll({
              top: hasTop ? block.scrollTop : undefined,
              left: hasLeft ? block.scrollLeft : undefined
            })
          }
        })
      }
      setTimeout(updateBlockSize, 400) // Wait for the editor to be created
    }
  }
}

export default ladderRenderer
