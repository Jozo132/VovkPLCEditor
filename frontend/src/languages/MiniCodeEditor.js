/* MiniCodeEditor.js v0.26 */
export class MiniCodeEditor {
    /**
     * @param {Element} mountElement DOM container (position: relative or static)
     * @param {{language?:string,value?:string,font?:string,
     *          liveProvider?:(symbol:string)=>any,
     *          autocompleteProvider?:(prefix:string)=>string[],
     *          symbolProvider?:(type?:string)=>string[],
     *          lintProvider?:(code:string)=>Promise<{type:'error'|'warning',start:number,end:number,message:string}[]>,
     *          onDiagnosticsChange?:(diagnostics:any[])=>void,
     *          onChange?:(value:string)=>void}} options
     */
    constructor(mountElement, options = {}) {
        if (!(mountElement instanceof Element)) throw Error('mountElement')
        const m = mountElement,
            o = options,
            cs = getComputedStyle(m)
        if (cs.position === 'static') m.style.position = 'relative'
        if (!m.style.height || cs.height === '0px') m.style.height = '100%'
        m.classList.add('mce')

        /* config */
        const LN_W = 48 /* gutter width in px */

        /* one‑time style */
        if (!document.getElementById('mce-css')) {
            const s = document.createElement('style')
            s.id = 'mce-css'
            s.textContent = `.mce{width:100%;height:100%;font:var(--f,14px/1.4 monospace);background:#282828}
.mce>textarea,.mce>pre{position:absolute;top:0;bottom:0;width:100%;margin:0;border:0;resize:none;outline:0;font:inherit;white-space:pre;overflow:auto;box-sizing:border-box;tab-size:4;-moz-tab-size:4}
.mce>textarea{background:none;color:transparent;caret-color:#fff;padding:8px 8px 8px calc(${LN_W}px + 8px)}
.mce>textarea::selection,.mce>textarea::-moz-selection{color:transparent;background:rgba(0,0,0,.25)}
.mce>pre.code{pointer-events:none;color:#ddd;left:${LN_W}px;right:0;padding:8px;overflow:hidden; width:calc(100% - ${LN_W}px)}
.mce>pre.code code{display:inline-block;min-width:100%}
.mce>pre.ln{pointer-events:none;color:#555;left:0;width:${LN_W}px;text-align:right;padding:8px 4px 8px 0;margin:0;user-select:none;overflow:hidden}
.ac{list-style:none;position:absolute;max-width:400px;max-height:200px;overflow-y:auto;background:#252526;border:1px solid #454545;box-shadow:0 4px 6px rgba(0,0,0,0.3);margin:0;padding:5px 0;z-index:99999;color:#ccc;font-size:12px;font-family: var(--f, monospace);}
.ac::-webkit-scrollbar{width:8px;height:8px}
.ac::-webkit-scrollbar-track{background:#FFF2}
.ac::-webkit-scrollbar-thumb{background:#8883;border-radius:1px}
.ac::-webkit-scrollbar-track:hover{background:#FFF5}
.ac::-webkit-scrollbar-thumb:hover{background:#CCC}
.ac.hide{display:none}
.ac li{padding:0 8px;cursor:pointer;display:flex;align-items:center;height:22px;line-height:22px;}
.ac li:hover{background:#2a2d2e}
.ac li.sel{background:#04395e;color:#fff}
.ac li .icon { display: inline-block; width: 16px; height: 16px; margin-right: 6px; background-size: contain; background-repeat: no-repeat; background-position: center; flex-shrink: 0; }
.ac li .icon.kw { background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="%23c586c0" d="M14 4h-2a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2h2v-2h-2V6h2V4zM4 12V4h6v8H4z"/></svg>'); }
.ac li .icon.dt { background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="%234ec9b0" d="M13.5 14h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5zm-11-12a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 2.5 16h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 2h-11z"/></svg>'); }
.ac li .label { flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ac li .desc{opacity:0.6;font-size:0.85em;margin-left:10px; flex-shrink: 0;}
.ac li span.match{font-weight:bold;color:#4daafc}
.start-hint { position:absolute; color: #888; font-size: 0.9em; pointer-events:none; z-index:99999; background:#1e1e1e; padding:4px 8px; border:1px solid #333; display:none; border-radius: 3px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.kw{color:#c586c0}.num{color:#b5cea8}.str{color:#ce9178}.cmt{color:#6a9955}.live{color:#0f0;opacity:.8}
.type-keyword{color:#569cd6}.variable{color:#9cdcfe}.function{color:#dcdcaa}.dt{color:#4ec9b0}
.dot{color:#fff}
.mce-marker { position: absolute; pointer-events: auto; z-index: 5; color: transparent !important; }
.mce-marker.err { text-decoration: underline wavy #f48771; }
.mce-marker.warn { text-decoration: underline wavy #cca700; }
.mce-marker:hover::after {
    content: attr(data-msg);
    position: absolute; bottom: 100%; left: 0;
    background: #252526; color: #ccc; border: 1px solid #454545;
    padding: 4px 8px; font-size: 12px; white-space: nowrap; z-index: 10;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3); pointer-events: none;
}`;
            document.head.appendChild(s)
        }
        m.style.setProperty('--f', o.font || `${cs.fontSize} ${cs.fontFamily}`)

        /* build DOM */
        const ta = m.appendChild(document.createElement('textarea')),
            ln = m.appendChild(document.createElement('pre')),
            pr = m.appendChild(document.createElement('pre')),
            cd = pr.appendChild(document.createElement('code')),
            // Append tooltip to body to avoid overflow issues
            ac = document.body.appendChild(document.createElement('ul')),
            ov = m.appendChild(document.createElement('div')),
            hint = document.body.appendChild(document.createElement('div'))
        ln.className = 'ln'
        pr.className = 'code'
        ac.className = 'ac hide'
        // Ensure high Z-index for tooltips and use fixed positioning to avoid scroll issues
        ac.style.zIndex = '99999'
        ac.style.position = 'fixed'
        hint.style.zIndex = '99999'
        hint.style.position = 'fixed'

        hint.className = 'start-hint'
        ta.value = o.value || ''
        ta.spellcheck = false
        
        // Save references for cleanup
        this._ac = ac
        this._hint = hint


        /* language */
        const lang = MiniCodeEditor.languages[(o.language || 'st').toLowerCase()]
        if (!lang) throw Error('language ' + o.language)

        /* utils */
        const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const processToken = (token, rule) => {
            if (rule.className === 'kw' && lang.definitions && lang.typeKeywords && lang.typeKeywords.includes(token)) return `<span class="type-keyword">${token}</span>`
            return `<span class="${rule.className}">${token}</span>`
        }
        const colour = t =>
            lang.rules.reduce(
                (v, r) =>
                    v
                        .split(/(<span[^>]*>.*?<\/span>)/gs)
                        .map(s => (s.startsWith('<span') ? s : s.replace(r.regex, m => processToken(m, r))))
                        .join(''),
                esc(t)
            )
        const paint = () => {
            cd.innerHTML = colour(ta.value) + '\u200B'
            updateLN()
        }

        /* line numbers */
        const updateLN = () => {
            const lines = ta.value.split(/\n/).length
            let out = ''
            for (let i = 1; i <= lines; i++) out += i + '\n'
            ln.textContent = out
        }

        /* caret px helper */
        const caretPx = i => {
            const d = document.createElement('div'),
                s = getComputedStyle(ta)
            
            d.style.cssText = `position:absolute;white-space:pre;visibility:hidden;overflow:hidden;
            font-family:${s.fontFamily};font-size:${s.fontSize};font-weight:${s.fontWeight};
            font-style:${s.fontStyle};font-variant:${s.fontVariant};font-stretch:${s.fontStretch};
            letter-spacing:${s.letterSpacing};line-height:${s.lineHeight};
            padding:${s.padding};border:${s.border};box-sizing:${s.boxSizing};
            text-transform:${s.textTransform};text-indent:${s.textIndent};
            tab-size:${s.tabSize};-moz-tab-size:${s.tabSize};
            width:${s.width};top:0;left:0;margin:0;`
            
            d.textContent = ta.value.slice(0, i)
            const sp = d.appendChild(document.createElement('span'))
            sp.textContent = '|'
            ta.parentNode.appendChild(d)
            const p = {x: sp.offsetLeft, y: sp.offsetTop, h: sp.offsetHeight}
            ta.parentNode.removeChild(d)
            return p
        }

        /* scrolling sync */
        const sync = () => {
            pr.scrollLeft = ta.scrollLeft
            pr.scrollTop = ta.scrollTop
            ln.scrollTop = ta.scrollTop
            ov.style.transform = `translate(${-ta.scrollLeft}px,${-ta.scrollTop}px)`
            if (!ac.classList.contains('hide')) posAC(ta.selectionStart)
        }
        ta.addEventListener('scroll', sync)

        /* linter */
        const markers = []
        const renderMarkers = (diagnostics) => {
            markers.forEach(m => m.remove())
            markers.length = 0
    
            diagnostics.forEach(d => {
                const p = caretPx(d.start)
                const p2 = caretPx(d.end)
                
                const m = document.createElement('div')
                m.className = `mce-marker ${d.type === 'error' ? 'err' : 'warn'}`
                m.dataset.msg = d.message
                m.style.left = (p.x + LN_W) + 'px'
                m.style.top = p.y + 'px'
                m.style.height = p.h + 'px'
                
                if (p.y === p2.y) {
                     m.style.width = (p2.x - p.x) + 'px'
                } else {
                     m.style.width = '100px'
                }
                m.textContent = ta.value.slice(d.start, d.end)
                
                ov.appendChild(m)
                markers.push(m)
            })
        }

        const defaultLinter = async (code) => {
            if (!lang.definitions) return []
            const problems = []
            // Split by lines to keep track of indices
            let index = 0
            const lines = code.split('\n')
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]
                // Skip empty/comments
                const trimmed = line.trim()
                if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) {
                    index += line.length + 1
                    continue
                }
                
                // Naive tokenizer by space, but handle strings?
                // Just splitting by space for now
                // Match regex for command at start of line
                // But we need the offsets relative to code start.
                
                // Find first word
                const match = /^\s*([A-Za-z_][\w.]*)/.exec(line)
                if (match) {
                    const cmd = match[1]
                    const cmdStart = index + match.index + (match[0].length - cmd.length)
                    const cmdEnd = cmdStart + cmd.length

                    // Check if it is a label
                    if (line.trim().endsWith(':')) {
                        index += line.length + 1
                        continue
                    }
                    
                    const def = lang.definitions[cmd] || lang.definitions[cmd.toLowerCase()]
                    
                    if (!def) {
                         if (!['const'].includes(cmd)) { // Exceptions
                            problems.push({ type: 'error', start: cmdStart, end: cmdEnd, message: `Unknown instruction '${cmd}'` })
                         }
                    } else {
                        // Check args
                        // This is very basic tokenization
                        const tokens = line.slice(match[0].length).split(/,/).map(s => s.trim()).filter(s => s)
                        // Should match def length
                        // Filter empty strings from split
                        const args = []
                        // Re-tokenizing with regex needed to get positions, simply validating count for now?
                        // User wants linter. 
                        
                        if (tokens.length !== def.length) {
                             problems.push({ type: 'warning', start: cmdStart, end: cmdEnd, message: `Expected ${def.length} arguments, got ${tokens.length}` })
                        }
                    }
                }
                index += line.length + 1
            }
            return problems
        }

        const runLint = async () => {
             const provider = o.lintProvider || defaultLinter
             try {
                const problems = await provider(ta.value)
                renderMarkers(problems)
                if (o.onDiagnosticsChange) o.onDiagnosticsChange(problems)
             } catch (e) { console.error(e) }
        }
        
        let lintTimer = null
        const triggerLint = () => {
            if (lintTimer) clearTimeout(lintTimer)
            lintTimer = setTimeout(runLint, 500)
        }

        /* live overlay */
        let live = o.liveProvider || (() => undefined)
        const overlay = () => {
            ov.innerHTML = ''
            const re = /\b([A-Za-z_]\w*)\b/g
            let mx
            while ((mx = re.exec(ta.value))) {
                const val = live(mx[1])
                if (val === undefined) continue
                const p = caretPx(mx.index + mx[1].length)
                const s = document.createElement('span')
                s.className = 'live'
                s.textContent = ' = ' + val
                s.style.cssText = `position:absolute;left:${p.x + LN_W + 6}px;top:${p.y}px`
                ov.appendChild(s)
            }
        }

        /* expose live methods */
        this.refreshLive = () => {
            overlay()
            sync()
        }
        this.setLiveProvider = fn => {
            if (typeof fn === 'function') {
                live = fn
                this.refreshLive()
            }
        }

        /* autocomplete */
        let sel = 0
        // Default symbol provider does nothing
        const symbolSrc = o.symbolProvider || (() => [])

        // Fallback/Legacy autocomplete
        const wordSrc = o.autocompleteProvider || (pref => lang.words || [])

        const hide = () => {
            ac.classList.add('hide')
            ac.style.display = '' // Clear inline display so class takes precedence
            hint.style.display = 'none'
            document.removeEventListener('scroll', updatePos, true)
        }
        
        // Document click close handler
        const docClick = (e) => {
            if (!ac.contains(e.target) && e.target !== ta) hide()
        }
        document.addEventListener('mousedown', docClick)

        const updatePos = () => {
            if (ac.classList.contains('hide')) return
            const i = ta.selectionStart
            const p = caretPx(i)
            const r = ta.getBoundingClientRect()
            const left = r.left + p.x - ta.scrollLeft
            const top = r.top + p.y - ta.scrollTop + p.h
            
            // Constrain to plc-editor-body if available
            const container = m.closest('.plc-editor-body') || document.documentElement
            const cr = container.getBoundingClientRect()
            
            // Check if injection point is within the container bounds
            // For fixed positioning, we compare viewport coordinates directly
            if (top < cr.top || top > cr.bottom || left < cr.left || left > cr.right) {
                 ac.style.display = 'none'
                 hint.style.display = 'none'
            } else {
                 ac.style.display = 'block'
                 if (hint.innerHTML && !ac.children.length) hint.style.display = 'block'
            }

            // Update positions
            ac.style.left = left + 'px'
            ac.style.top = top + 'px'
            hint.style.left = (left + 20) + 'px'
            hint.style.top = top + 'px'
        }

        const posAC = i => {
            if (ac.classList.contains('hide')) return
            // Ensure visible initially
            ac.style.display = 'block'
            updatePos()
            // Add scroll listener
            document.addEventListener('scroll', updatePos, true)
        }

        // Helper to extract context
        const getContext = idx => {
            const textToCursor = ta.value.slice(0, idx)
            const lineStart = textToCursor.lastIndexOf('\n') + 1
            const lineText = textToCursor.slice(lineStart)
            // Tokenize line simple by space

            const trailingSpace = /\s$/.test(lineText)

            const tokens = lineText.trimStart().split(/[\s,]+/).filter(t => t)
            if (!lineText.trim()) return {cmd: null, argIndex: 0, prefix: ''} // Empty line

            let argIndex = tokens.length - 1
            let prefix = tokens[tokens.length - 1]

            if (trailingSpace) {
                argIndex++
                prefix = ''
            }

            return {cmd: tokens[0], argIndex, prefix, lineText}
        }

        const triggerAC = (force = false) => {
            const i = ta.selectionStart
            const ctx = getContext(i)
            if (!ctx) return hide()

            let list = []
            let helpText = ''

            // Check if we have definitions for this language
            if (lang.definitions) {
                if (ctx.argIndex === 0) {
                    // Start of line instruction suggestion
                    if (!force && !ctx.prefix) return hide()

                    let options = []
                    const p = ctx.prefix
                    const tree = lang.originalDefinitions || lang.definitions

                    // Hierarchical Lookup
                    if (p.includes('.')) {
                        const parts = p.split('.')
                        // Traverse to the deepest object
                        // Limitation: only supports 1 level deep well for now or full match
                        // If we support u8.const -> we need to find 'u8' in tree
                        const root = parts[0]
                        const prop = parts.length > 1 ? parts.slice(1).join('.') : ''
                        
                         // Case insensitive lookup for root
                        const rootKey = Object.keys(tree).find(k => k.toLowerCase() === root.toLowerCase())
                        
                        if (rootKey && !Array.isArray(tree[rootKey])) {
                            // It is a namespace/object
                            const childOps = Object.keys(tree[rootKey])
                            options = childOps.map(k => {
                                const val = tree[rootKey][k]
                                let params = ''
                                if (Array.isArray(val)) {
                                     params = val.map(p => p.name).join(', ')
                                }
                                return {
                                    text: `${rootKey}.${k}`,
                                    display: k,
                                    type: 'Instruction',
                                    kind: 'kw',
                                    params: params
                                }
                            })
                            // Filter by prop
                             if (prop) {
                                 options = options.filter(o => o.text.toLowerCase().startsWith(p.toLowerCase()))
                             }
                        }
                    } else {
                        // Root level
                        options = Object.keys(tree).map(k => {
                            const val = tree[k]
                            const isNamespace = !Array.isArray(val)
                            let params = ''
                            if (!isNamespace) {
                                 params = val.map(p => p.name).join(', ')
                            }
                            return {
                                text: k,
                                display: k,
                                type: isNamespace ? 'Datatype' : 'Instruction',
                                kind: isNamespace ? 'dt' : 'kw',
                                params: params
                            }
                        })
                         options = options.filter(o => o.text.toLowerCase().startsWith(p.toLowerCase()))
                    }
                    
                    list = options
                } else {
                    // Look up command
                    const def = lang.definitions[ctx.cmd] || lang.definitions[ctx.cmd.toLowerCase()]
                    if (def) {
                        const argDef = def[ctx.argIndex - 1]
                        
                        // Show signature help
                        const argsHtml = def.map((a, idx) => {
                            const isCurrent = idx === ctx.argIndex - 1
                            const style = isCurrent ? 'style="color:#4daafc;font-weight:bold"' : ''
                            return `<span ${style}>${a.name}${a.type ? ':' + a.type : ''}</span>`
                        }).join(', ')
                        helpText = `<span style="color:#c586c0">${ctx.cmd}</span> ${argsHtml}`

                        if (argDef) {
                            if (argDef.type === 'symbol' || argDef.type === 'label' || argDef.type === 'bit_symbol') {
                                // Fetch from symbol provider
                                const syms = symbolSrc(argDef.type) || []
                                list = syms
                                    .filter(s => (typeof s === 'string' ? s : s.name).toLowerCase().startsWith(ctx.prefix.toLowerCase()))
                                    .map(s => {
                                        const name = typeof s === 'string' ? s : s.name
                                        const type = typeof s === 'string' ? (argDef.type === 'label' ? 'Label' : 'Variable') : s.type
                                        return { text: name, type: type, kind: 'kw' }
                                    })
                                if (argDef.type === 'text') {
                                    list = [] // Free text
                                }
                            } else if (argDef.type === 'type') {
                                if (lang.types) {
                                    list = lang.types.filter(t => t.toUpperCase().startsWith(ctx.prefix.toUpperCase())).map(t => ({text: t, type: 'Type', kind: 'dt'}))
                                }
                            } else if (argDef.type === 'enum' && argDef.options) {
                                list = argDef.options.filter(o => o.startsWith(ctx.prefix)).map(o => ({text: o, type: 'Enum', kind: 'kw'}))
                            }
                        }
                    }
                }
            } else {
                // Legacy behavior
                const pref = /[A-Za-z_]\w*$/.exec(ta.value.slice(0, i))?.[0] || ''
                if (!force && !pref) return hide()
                const raw = wordSrc(pref)
                list = raw
                    .filter(w => w.toUpperCase().startsWith(pref.toUpperCase()))
                    .slice(0, 15)
                    .map(w => ({text: w, type: '', kind: 'kw'}))
                ctx.prefix = pref
            }

            // Show Hint
            if (helpText && !list.length) {
                hint.innerHTML = helpText
                hint.style.display = 'block'
                hint.style.borderColor = '#444'
            } else {
                hint.style.display = 'none'
            }

            if (!list.length) return ac.classList.add('hide')

            // Render List
            // list = list.slice(0, 8) 
            ac.innerHTML = list
                .map((item, j) => {
                    const matched = item.display || item.text
                    // Highlight match
                    // const m = ctx.prefix ? matched.replace(new RegExp(`(${ctx.prefix})`, 'i'), '<span class="match">$1</span>') : matched
                    
                    let labelContent = matched
                    if (item.params) {
                        labelContent += `<span style="opacity:0.5;font-size:0.9em;margin-left:8px">${item.params}</span>`
                    }

                    return `<li class="${j ? '' : 'sel'}" data-val="${item.text}">
             <span class="icon ${item.kind || 'kw'}"></span>
             <span class="label">${labelContent}</span>
             <span class="desc">${item.type || ''}</span>
          </li>`
                })
                .join('')

            sel = 0
            ac.classList.remove('hide')
            posAC(i)
        }

        ta.addEventListener('input', e => {
            if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo' || e.inputType === 'insertFromPaste') {
                return hide()
            }
            triggerAC(false)
        })

        // Manual Trigger (Ctrl+Space or Ctrl+Click)
        ta.addEventListener('keydown', e => {
            if (e.ctrlKey && e.code === 'Space') {
                 e.preventDefault()
                 triggerAC(true)
                 return
            }
            
            if (!ac.classList.contains('hide')) {
                const isNav = ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)
                const isTyping = e.key.length === 1 || e.key === 'Backspace'
                const isModifier = ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)
                
                if (!isNav && !isTyping && !isModifier) {
                     hide()
                }
            }
            
            if (ac.classList.contains('hide')) return
            const li = [...ac.children]
            switch (e.key) {
                case 'ArrowDown':
                case 'ArrowUp':
                    e.preventDefault()
                    li[sel].classList.remove('sel')
                    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + li.length) % li.length
                    li[sel].scrollIntoView({block: 'nearest'})
                    li[sel].classList.add('sel')
                    break
                case 'Enter':
                    e.preventDefault()
                    // @ts-ignore
                    insertAC(li[sel].dataset.val)
                    break
                case 'Escape':
                    hide()
                    break
            }
        })
        
        ta.addEventListener('click', e => {
            if (e.ctrlKey) {
                // Wait for caret to move
                setTimeout(() => triggerAC(true), 0)
            } else {
                hide()
            }
        })
        const insertAC = w => {
            const i = ta.selectionStart
            const ctx = getContext(i)
            const pref = ctx ? ctx.prefix : ''
            
            let appendSpace = false
            if (lang.definitions && ctx.argIndex === 0) {
                 const def = lang.definitions[w] || lang.definitions[w.toLowerCase()]
                 if (def && Array.isArray(def) && def.length > 0) {
                     appendSpace = true
                 }
            }

            ta.focus()
            const before = ta.value.slice(0, i - pref.length)
            const after = ta.value.slice(i)
            const textToInsert = w + (appendSpace ? ' ' : '')
            
            ta.value = before + textToInsert + after
            const newPos = i - pref.length + textToInsert.length
            ta.selectionStart = ta.selectionEnd = newPos
            ta.dispatchEvent(new Event('input'))
            
            if (appendSpace) {
                setTimeout(() => triggerAC(true), 10)
            } else {
                hide()
            }
        }

        /* TAB inserts four spaces */
        ta.addEventListener('keydown', e => {
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                if (!ac.classList.contains('hide')) {
                    e.preventDefault()
                    // @ts-ignore
                    insertAC(ac.children[sel].dataset.val)
                } else {
                    e.preventDefault()
                    ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end')
                    ta.dispatchEvent(new Event('input'))
                }
                return
            }
        })

        ac.addEventListener('mousedown', e => {
            e.preventDefault()
            const li = e.target.closest('li')
            if (li) insertAC(li.dataset.val)
        })

        /* reactive render with small init delay */
        const tick = () => {
            paint()
            sync()
            overlay()
            triggerLint()
            o.onChange && o.onChange(ta.value)
        }
        setTimeout(() => {
            ta.addEventListener('input', tick)
            tick()
            this._timer = setInterval(overlay, 200)
        }, 100)
        
        // Expose cleanup for destroy
        this._cleanup = () => {
             document.removeEventListener('mousedown', docClick)
             if (this._ac) this._ac.remove()
             if (this._hint) this._hint.remove()
        }

        /* Public API */
        this.getValue = () => ta.value
        this.setValue = v => {
            const sl = ta.scrollLeft,
                st = ta.scrollTop
            ta.value = v
            tick()
            ta.scrollLeft = sl
            ta.scrollTop = st
        }
        this.getScrollHeight = () => (cd.scrollHeight || 0) + 16
    }

    destroy() {
        clearInterval(this._timer)
        if (this._cleanup) this._cleanup()
    }

    static registerLanguage(name, spec) {
        if (spec.definitions && !spec._flattened) {
             spec.originalDefinitions = spec.definitions // Keep tree structure
            const flatten = (defs, prefix = '') => {
                let out = {}
                for (const k in defs) {
                    const val = defs[k]
                    const key = prefix ? `${prefix}.${k}` : k
                    if (Array.isArray(val)) {
                        out[key] = val
                    } else if (typeof val === 'object' && val !== null) {
                        Object.assign(out, flatten(val, key))
                    }
                }
                return out
            }
            spec.definitions = flatten(spec.definitions)
            spec._flattened = true
            // Auto update words if not provided
            if (!spec.words) spec.words = Object.keys(spec.definitions)
        }
        MiniCodeEditor.languages[name.toLowerCase()] = spec
    }
}
MiniCodeEditor.languages = {}

/* Structured Text */
MiniCodeEditor.registerLanguage('st', {
    rules: [
        {regex: /\(\*[\s\S]*?\*\)/g, className: 'cmt'},
        {regex: /\/\/.*$/gm, className: 'cmt'},
        {regex: /"(?:\\.|[^"])*"/g, className: 'str'},
        {regex: /\b(END_IF|IF|THEN|ELSE|VAR|BOOL|INT|REAL)\b/g, className: 'kw'},
        {regex: /\b\d+(?:\.\d+)?\b/g, className: 'num'},
    ],
    words: ['IF', 'THEN', 'ELSE', 'END_IF', 'BOOL', 'INT', 'REAL'],
})

/* JavaScript */
MiniCodeEditor.registerLanguage('js', {
    rules: [
        {regex: /\/\*[\s\S]*?\*\/|\/\/.*$/gm, className: 'cmt'},
        {regex: /`(?:\\.|[^`])*`|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/g, className: 'str'},
        {regex: /\b(function|return|let|const|if|else)\b/g, className: 'kw'},
        {regex: /\b\d+\b/g, className: 'num'},
    ],
    words: ['function', 'return', 'console', 'document'],
})

/* Assembly */
const asmTypes = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64', 'f32', 'f64']

const commonMath = {
    add: [], sub: [], mul: [], div: [], mod: [], 
    pow: [], sqrt: [], neg: [], abs: [], sin: [], cos: []
}
const commonCmp = {
    cmp_eq: [], cmp_neq: [], cmp_gt: [], cmp_lt: [], cmp_gte: [], cmp_lte: []
}
const commonLogic = {
    and: [], or: [], xor: [], not: [],
    lshift: [{name:'bits', type:'number'}], 
    rshift: [{name:'bits', type:'number'}]
}
const commonStack = {
    const: [{name:'value', type:'number'}],
    move: [], load: [], copy: [], swap: [], drop: [], clear: [],
    // Bit Ops available on integer types usually, but definitely on u8
    set: [{name:'bit', type:'number'}],
    get: [{name:'bit', type:'number'}],
    rset: [{name:'bit', type:'number'}],
}

// Generate type specific instructions
const typeOps = {}
asmTypes.forEach(t => {
    typeOps[t] = {
        ...commonMath,
        ...commonCmp,
        ...commonStack
    }
    // Logic only for integers?
    if (!t.startsWith('f')) {
        Object.assign(typeOps[t], commonLogic)
    }
})

const asmInstructions = {
    // Pointer operations
    ptr: {
        const: [{name: 'address', type: 'symbol'}],
        copy: [],
        load: [], // Indirect load?
    },
    
    // Type operations (Cascading definitions)
    ...typeOps,

    // u8 specific extensions from snippet
    u8: {
        ...typeOps.u8,
        readBit: [{name: 'addr.bit', type: 'bit_symbol'}],
        writeBit: [{name: 'addr.bit', type: 'bit_symbol'}],
        writeBitInv: [{name: 'addr.bit', type: 'bit_symbol'}],
    },

    // Control Flow
    jmp: [{name: 'label', type: 'label'}],
    jump: [{name: 'label', type: 'label'}],
    jmp_if: [{name: 'label', type: 'label'}],
    jmp_if_not: [{name: 'label', type: 'label'}],
    jump_if: [{name: 'label', type: 'label'}],
    jump_if_not: [{name: 'label', type: 'label'}],
    
    call: [{name: 'label', type: 'label'}],
    call_if: [{name: 'label', type: 'label'}],
    call_if_not: [{name: 'label', type: 'label'}],
    
    ret: [],
    ret_if: [],
    ret_if_not: [],
    exit: [],
    nop: [],
    loop: [], // Usually a label def but sometimes a keyword
    
    // Conversion
    cvt: [
        {name: 'from', type: 'type'},
        {name: 'to', type: 'type'},
    ],
    
    // Global Const
    const: [
        {name: 'name', type: 'text'},
        {name: 'value', type: 'number'},
    ],
}

MiniCodeEditor.registerLanguage('asm', {
    rules: [
        {regex: /\/\*[\s\S]*?\*\//g, className: 'cmt'},
        {regex: /\/\/.*$/gm, className: 'cmt'},
        {regex: /#.*$/gm, className: 'cmt'},
        {regex: /^\s*([A-Za-z_]\w*):/gm, className: 'function'}, // Labels
        {regex: /^\b(const)\b/gm, className: 'kw'}, // Const declaration
        // Specific types (Datatypes)
         {regex: /\b(ptr|u8|u16|u32|u64|i8|i16|i32|i64|f32|f64)\b/g, className: 'dt'},
        // Top level Keywords and method calls
        {regex: /\b(add|sub|mul|div|mod|pow|sqrt|neg|abs|sin|cos|cmp_eq|cmp_neq|cmp_gt|cmp_lt|cmp_gte|cmp_lte|and|or|xor|not|lshift|rshift|move|load|copy|swap|drop|clear|set|get|rset|readBit|writeBit|writeBitInv|jmp(?:_if(?:_not)?)?|jump(?:_if(?:_not)?)?|call(?:_if(?:_not)?)?|ret(?:_if(?:_not)?)?|exit|loop|cvt|nop)\b/gim, className: 'kw'},
        {regex: /\./g, className: 'dot'},
        
        {regex: /\b(u8|u16|u32|u64|i8|i16|i32|i64|f32|f64)\b/g, className: 'type-keyword'},
        {regex: /\b\d+\.\d+|\.\d+\b/g, className: 'num'},
        {regex: /\b0x[\da-f]+|\b\d+\b/gi, className: 'num'},
        {regex: /[A-Za-z_]\w*/g, className: 'variable'}, // Fallback for symbols
    ],
    definitions: asmInstructions, // Nested definitions will be flattened
    types: asmTypes,
    typeKeywords: asmTypes,
})

export default MiniCodeEditor
