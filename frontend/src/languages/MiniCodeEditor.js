/* MiniCodeEditor.js v0.26 */
export class MiniCodeEditor {
    /**
     * @param {Element} mountElement DOM container (position: relative or static)
     * @param {{language?:string,value?:string,font?:string,
     *          liveProvider?:(symbol:string)=>any,
     *          previewEntriesProvider?:()=>{start:number,end:number,name?:string,type?:string,address?:string}[],
     *          previewValueProvider?:(entry:any)=>string|number|{text?:string,className?:string}|null,
     *          autocompleteProvider?:(prefix:string)=>string[],
     *          symbolProvider?:(type?:string)=>string[],
     *          hoverProvider?:(word:string)=>Promise<string|null>|string|null,
     *          lintProvider?:(code:string)=>Promise<{type:'error'|'warning',start:number,end:number,message:string}[]>,
     *          onDiagnosticsChange?:(diagnostics:any[])=>void,
     *          editorId?:number,
     *          programId?:string,
     *          readOnly?:boolean,
     *          blockId?:string,
     *          onLintHover?:(payload:{state:'enter'|'leave',diagnostic:any,blockId?:string})=>void,
     *          onGoToDefinition?:(payload:{type:'symbol',name:string,blockId?:string})=>void,
     *          onPreviewClick?:(entry:any, event:MouseEvent)=>void,
     *          onPreviewAction?:(entry:any, action:'set'|'reset'|'toggle'|'edit')=>void,
     *          onScroll?:(pos:{top:number,left:number})=>void,
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
            s.textContent = `.mce{width:100%;height:100%;font:var(--f,14px/1.4 monospace);background:#282828;overflow:hidden}
.mce>textarea,.mce>pre{position:absolute;top:0;bottom:0;width:100%;margin:0;border:0;resize:none;outline:0;font:inherit;white-space:pre;overflow:auto;box-sizing:border-box;tab-size:4;-moz-tab-size:4}
.mce>textarea{z-index:1;background:none;color:transparent;caret-color:transparent;padding:8px 8px 8px calc(${LN_W}px + 8px)}
.mce>textarea::selection,.mce>textarea::-moz-selection{color:transparent;background:transparent}
.mce>pre.code{pointer-events:none;color:#ddd;left:${LN_W}px;right:0;padding:8px;overflow:hidden; width:calc(100% - ${LN_W}px); z-index: 2;}
.mce>pre.code code{display:inline-block;min-width:100%}
.mce>pre.ln{pointer-events:none;color:#555;left:0;width:${LN_W}px;text-align:right;padding:8px 4px 8px 0;margin:0;user-select:none;overflow:hidden;z-index: 10;background: #282828;}
.mce-user-selection { position: absolute; pointer-events: none; z-index: 3; background: rgba(87, 166, 255, 0.25); border-radius: 2px; }
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
.type-keyword{color:#569cd6}.variable{color:#9cdcfe}.function{color:#dcdcaa}.dt{color:#4ec9b0}.addr{color:#d7ba7d}
.dot{color:#fff}
.mce>div.overlay{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;pointer-events:none;z-index:4}
.mce-marker { position: absolute; pointer-events: none; z-index: 5; color: transparent !important; }
.mce-marker.err { text-decoration: underline wavy #f48771; }
.mce-marker.warn { text-decoration: underline wavy #cca700; }
.mce-hover-highlight { position: absolute; pointer-events: none; z-index: 4; background: rgba(216, 90, 112, 0.3); border-radius: 2px; }
.mce-link-highlight { position: absolute; pointer-events: none; z-index: 4; height: 2px; background: #4daafc; border-radius: 1px; opacity: 0.9; }
.mce-selection-highlight { position: absolute; pointer-events: none; z-index: 3; background: rgba(76, 141, 255, 0.28); border-radius: 2px; }
.mce-preview-pill { display:inline-flex; vertical-align:middle; position:relative; align-items:center; justify-content:center; height:1.1em; padding:0 0.4em; border-radius:0.2em; background:#464646; color:#fff; border:1px solid #464646; font-size:0.85em; line-height:1; font-weight:600; white-space:nowrap; pointer-events:auto; cursor:pointer; z-index:6; box-shadow:0 1px 1px rgba(0,0,0,0.2); outline: none; margin: 0 0.2em; box-sizing: border-box; user-select: none; }
.mce-preview-pill:hover { filter: brightness(1.2); border-color: #007acc; }
.mce-preview-pill:focus { border-color: #007acc; box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.5); z-index: 20; outline: none; }
.mce-preview-pill:not([tabindex]) { cursor: default; user-select: none; }
.mce-preview-pill:not([tabindex]):hover { filter: none; border-color: #464646; }
.mce-preview-pill.on { background:#3a3a3a; color:#1fba5f; border-color:#1fba5f; }
.mce-preview-pill.off { background:#3a3a3a; color:rgba(200, 200, 200, 0.5); border-color:#555; }
.mce-preview-pill.bit { min-width:2.8em; }
.mce-preview-pill.byte, .mce-preview-pill.u8, .mce-preview-pill.i8 { min-width:3em; }
.mce-preview-pill.int, .mce-preview-pill.u16, .mce-preview-pill.i16, .mce-preview-pill.word { min-width:4.5em; }
.mce-preview-pill.dint, .mce-preview-pill.u32, .mce-preview-pill.i32, .mce-preview-pill.dword, .mce-preview-pill.real, .mce-preview-pill.float, .mce-preview-pill.f32, .mce-preview-pill.timer { min-width:6em; }
.mce-preview-pill.u64, .mce-preview-pill.i64, .mce-preview-pill.f64, .mce-preview-pill.lword { min-width:8em; }
.mce-preview-pill.editable-constant { border-style: dashed; border-color: #d7ba7d; }
.mce-marker:hover::after {
    content: attr(data-msg);
    position: absolute; bottom: 100%; left: 0;
    background: #252526; color: #ccc; border: 1px solid #454545;
    padding: 4px 8px; font-size: 12px; white-space: nowrap; z-index: 10;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3); pointer-events: none;
}
.mce-hover{position:fixed;background:#252526;border:1px solid #454545;box-shadow:0 4px 8px rgba(0,0,0,0.4);color:#ccc;font-size:13px;z-index:100000;padding:0;max-width:400px;display:none;font-family:var(--f,monospace);line-height:1.4;pointer-events:none}
.mce-hover-def{font-family:monospace;border-bottom:1px solid #454545;padding:6px 10px;background:#1e1e1e;color:#b4b4b4;font-weight:600}
.mce-hover-desc{padding:8px 10px 4px 10px;}
.mce-hover-ex{padding:4px 10px 8px 10px;font-family:monospace;font-size:0.9em;color:#ce9178;white-space:pre-wrap}
@media(max-width:768px){.mce{font-size:8px!important;line-height:12px!important}.mce>textarea{padding:4px 4px 4px 35px!important}.mce>pre.code{left:27px!important;width:calc(100% - 27px)!important;padding:4px!important}.mce>pre.ln{width:27px!important;padding-top:4px!important;padding-bottom:4px!important}.ac{font-size:9px!important;max-width:200px!important}.ac li{height:16px!important;line-height:16px!important;padding:0 4px!important}.ac li .icon{width:12px!important;height:12px!important;margin-right:4px!important}.mce-hover{font-size:9px!important;max-width:220px!important}.mce-hover-def{padding:3px 5px!important}.mce-hover-desc{padding:4px 5px 2px 5px!important}.mce-hover-ex{padding:2px 5px 4px 5px!important}}
`;
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
            hint = document.body.appendChild(document.createElement('div')),
            hov = document.body.appendChild(document.createElement('div'))
        
        hov.className = 'mce-hover'
        ov.className = 'overlay'
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
        if (o.readOnly) {
            ta.readOnly = true
        }
        
        // Save references for cleanup
        this._ac = ac
        this._hint = hint
        this._hov = hov

        const navRoot = typeof window !== 'undefined' ? window : globalThis
        const navState = navRoot.__vovkPlcNavState
        const navEditorId = Number.isInteger(o.editorId) ? o.editorId : null
        const navProgramId = o.programId || null
        const navBlockId = o.blockId || null
        const getNavHistory = () => {
            if (!navState || navEditorId === null) return null
            const editor = navState.editors?.get(navEditorId)
            return editor?._nav_history || null
        }
        const canTrackHistory = () => !!(navProgramId && navBlockId && getNavHistory())
        const markActiveEditor = () => {
            if (navState && navEditorId !== null) {
                navState.activeEditorId = navEditorId
            }
        }
        let historyTimer = null
        let historySuppressed = false
        let lastRecordedLine = null

        const getLineFromIndex = (text, index) => {
            let line = 1
            const max = Math.max(0, Math.min(index || 0, text.length))
            for (let i = 0; i < max; i++) {
                if (text.charCodeAt(i) === 10) line += 1
            }
            return line
        }

        const getCursorInfo = (indexOverride) => {
            const text = ta.value || ''
            const rawIndex = typeof indexOverride === 'number'
                ? indexOverride
                : (typeof ta.selectionStart === 'number' ? ta.selectionStart : 0)
            const index = Math.max(0, Math.min(rawIndex, text.length))
            return { index, line: getLineFromIndex(text, index) }
        }

        const recordHistory = () => {
            if (!canTrackHistory() || historySuppressed) return
            const history = getNavHistory()
            if (!history) return
            const info = getCursorInfo()
            if (!info) return
            if (info.line === lastRecordedLine) return
            lastRecordedLine = info.line
            history.push({
                type: 'code',
                editorId: navEditorId,
                programId: navProgramId,
                blockId: navBlockId,
                index: info.index,
                line: info.line,
            })
        }

        const scheduleHistory = () => {
            if (!canTrackHistory() || historySuppressed) return
            markActiveEditor()
            if (historyTimer) clearTimeout(historyTimer)
            historyTimer = setTimeout(() => {
                historyTimer = null
                recordHistory()
            }, 500)
        }

        const suppressHistory = (duration = 120, indexOverride) => {
            if (!canTrackHistory()) return
            historySuppressed = true
            if (historyTimer) {
                clearTimeout(historyTimer)
                historyTimer = null
            }
            const info = getCursorInfo(indexOverride)
            lastRecordedLine = info.line
            setTimeout(() => {
                historySuppressed = false
            }, duration)
        }

        const hoverHighlights = []
        const selectedHighlights = []
        const linkHighlights = []
        const clearHoverHighlight = () => {
            hoverHighlights.forEach(h => h.remove())
            hoverHighlights.length = 0
        }
        const clearSelectedHighlight = () => {
            selectedHighlights.forEach(h => h.remove())
            selectedHighlights.length = 0
        }
        const clearLinkHighlight = () => {
            linkHighlights.forEach(h => h.remove())
            linkHighlights.length = 0
        }
        const renderHoverHighlight = (range) => {
            clearHoverHighlight()
            if (!range || typeof range.start !== 'number' || typeof range.end !== 'number') return
            const text = ta.value || ''
            if (!text.length) return

            const maxLen = text.length
            let start = Math.max(0, Math.min(range.start, maxLen))
            let end = Math.max(start + 1, Math.min(range.end, maxLen))
            if (end <= start) end = Math.min(maxLen, start + 1)

            let offset = 0
            const lines = text.split('\n')
            for (let i = 0; i < lines.length; i++) {
                const lineStart = offset
                const lineEnd = offset + lines[i].length
                if (end <= lineStart) break
                if (start < lineEnd + 1 && end > lineStart) {
                    const segStart = Math.max(start, lineStart)
                    const segEnd = Math.min(end, lineEnd)
                    if (segEnd > segStart) {
                        const p = caretPx(segStart)
                        const p2 = caretPx(segEnd)
                        const h = document.createElement('div')
                        h.className = 'mce-hover-highlight'
                        h.style.left = p.x + 'px'
                        h.style.top = p.y + 'px'
                        h.style.height = p.h + 'px'
                        h.style.width = Math.max(2, p2.x - p.x) + 'px'
                        ov.insertBefore(h, ov.firstChild)
                        hoverHighlights.push(h)
                    }
                }
                offset += lines[i].length + 1
            }
        }
        const renderSelectedHighlight = (range) => {
            clearSelectedHighlight()
            if (!range || typeof range.start !== 'number' || typeof range.end !== 'number') return
            const text = ta.value || ''
            if (!text.length) return

            const maxLen = text.length
            let start = Math.max(0, Math.min(range.start, maxLen))
            let end = Math.max(start + 1, Math.min(range.end, maxLen))
            if (end <= start) end = Math.min(maxLen, start + 1)

            let offset = 0
            const lines = text.split('\n')
            for (let i = 0; i < lines.length; i++) {
                const lineStart = offset
                const lineEnd = offset + lines[i].length
                if (end <= lineStart) break
                if (start < lineEnd + 1 && end > lineStart) {
                    const segStart = Math.max(start, lineStart)
                    const segEnd = Math.min(end, lineEnd)
                    if (segEnd > segStart) {
                        const p = caretPx(segStart)
                        const p2 = caretPx(segEnd)
                        const h = document.createElement('div')
                        h.className = 'mce-selection-highlight'
                        h.style.left = p.x + 'px'
                        h.style.top = p.y + 'px'
                        h.style.height = p.h + 'px'
                        h.style.width = Math.max(2, p2.x - p.x) + 'px'
                        ov.insertBefore(h, ov.firstChild)
                        selectedHighlights.push(h)
                    }
                }
                offset += lines[i].length + 1
            }
        }
        const renderLinkHighlight = (range) => {
            clearLinkHighlight()
            if (!range || typeof range.start !== 'number' || typeof range.end !== 'number') return
            const text = ta.value || ''
            if (!text.length) return

            const maxLen = text.length
            let start = Math.max(0, Math.min(range.start, maxLen))
            let end = Math.max(start + 1, Math.min(range.end, maxLen))
            if (end <= start) end = Math.min(maxLen, start + 1)

            let offset = 0
            const lines = text.split('\n')
            for (let i = 0; i < lines.length; i++) {
                const lineStart = offset
                const lineEnd = offset + lines[i].length
                if (end <= lineStart) break
                if (start < lineEnd + 1 && end > lineStart) {
                    const segStart = Math.max(start, lineStart)
                    const segEnd = Math.min(end, lineEnd)
                    if (segEnd > segStart) {
                        const p = caretPx(segStart)
                        const p2 = caretPx(segEnd)
                        const h = document.createElement('div')
                        h.className = 'mce-link-highlight'
                        h.style.left = p.x + 'px'
                        h.style.top = (p.y + p.h - 2) + 'px'
                        h.style.width = Math.max(2, p2.x - p.x) + 'px'
                        ov.insertBefore(h, ov.firstChild)
                        linkHighlights.push(h)
                    }
                }
                offset += lines[i].length + 1
            }
        }

        let lintHoverVisible = false
        let lintHoverEntry = null
        const hideHover = () => {
             hov.style.display = 'none'
             hov.innerHTML = ''
             lintHoverVisible = false
             clearHoverHighlight()
             if (lintHoverEntry && typeof o.onLintHover === 'function') {
                 o.onLintHover({ state: 'leave', diagnostic: lintHoverEntry, blockId: o.blockId })
             }
             lintHoverEntry = null
        }

        let lintDiagnostics = []
        let lintHoverActive = false

        const positionHover = (x, y, preferAbove = false) => {
             let left = x + 10
             let top = y + 10
             
             hov.style.left = left + 'px'
             hov.style.top = top + 'px'
             
             const box = hov.getBoundingClientRect()
             const winW = window.innerWidth
             const winH = window.innerHeight
             
             if (box.right > winW) left = x - box.width - 10
             if (left < 0) left = 0
             
             if (preferAbove) {
                 top = y - box.height - 6
                 if (top < 0) top = y + 10
             } else if (box.bottom > winH) {
                 top = y - box.height - 10
             }
             if (top < 0) top = 0
             
             hov.style.left = left + 'px'
             hov.style.top = top + 'px'
        }
        
        const showLintHover = (lint, x, y, caretIndex = null, opts = {}) => {
            const total = lintDiagnostics.length
            const idx = lintDiagnostics.indexOf(lint)
            const indexLabel = idx >= 0 && total > 0 ? ` (${idx + 1}/${total})` : ''
            const label = lint.type === 'warning' ? 'Lint Warning' : lint.type === 'info' ? 'Lint Info' : 'Lint Error'
             
             hov.innerHTML = ''
             const header = document.createElement('div')
             header.className = 'mce-hover-def'
             header.textContent = label + indexLabel
             hov.appendChild(header)
             
             if (lint.message) {
                 const desc = document.createElement('div')
                 desc.className = 'mce-hover-desc'
                 desc.textContent = lint.message
                 hov.appendChild(desc)
             }
             
             hov.style.display = 'block'
             lintHoverVisible = true
             if (opts.highlight !== false) {
                 renderHoverHighlight(lint)
             }
             if (opts.notify !== false) {
                 if (lintHoverEntry && lintHoverEntry !== lint && typeof o.onLintHover === 'function') {
                     o.onLintHover({ state: 'leave', diagnostic: lintHoverEntry, blockId: o.blockId })
                 }
                 if (lintHoverEntry !== lint && typeof o.onLintHover === 'function') {
                     o.onLintHover({ state: 'enter', diagnostic: lint, blockId: o.blockId })
                 }
                 lintHoverEntry = lint
             }
             if (typeof caretIndex === 'number') {
                 const safeIndex = Math.max(0, Math.min(caretIndex, ta.value.length))
                 const p = caretPx(safeIndex)
                 const r = ta.getBoundingClientRect()
                 const left = r.left + p.x - ta.scrollLeft
                 const top = r.top + p.y - ta.scrollTop
                 positionHover(left, top, true)
             } else {
                 positionHover(x, y, true)
             }
        }
        
        // Font measuring for hover calculations
        let textMetrics = null
        const measureText = () => {
            if (textMetrics) return textMetrics
            
            const d = document.createElement('div')
            const s = getComputedStyle(ta)
            // Use same robust styling as caretPx but stripped of layout offsets
            d.style.cssText = `position:absolute;white-space:pre;visibility:hidden;overflow:hidden;
            font-family:${s.fontFamily};font-size:${s.fontSize};font-weight:${s.fontWeight};
            font-style:${s.fontStyle};font-variant:${s.fontVariant};font-stretch:${s.fontStretch};
            letter-spacing:${s.letterSpacing};line-height:${s.lineHeight};
            padding:0;border:0;box-sizing:content-box;
            text-transform:${s.textTransform};text-indent:0;
            tab-size:${s.tabSize};-moz-tab-size:${s.tabSize};
            width:auto;top:0;left:0;margin:0;`

            d.textContent = 'M'
            // Append to parent to ensure correct inheritance
            ta.parentNode.appendChild(d)
            const rect = d.getBoundingClientRect()
            ta.parentNode.removeChild(d)
            
            textMetrics = { w: rect.width || 8, h: rect.height || 18 }
            return textMetrics
        }

        // Hover Handlers
        let hoverTimer = null
        const getHoverInfo = (x, y) => {
             const r = ta.getBoundingClientRect()
             const style = getComputedStyle(ta)
             const tm = measureText()
             const lh = tm.h

             const pl = parseFloat(style.paddingLeft) + (parseFloat(style.borderLeftWidth) || 0)
             const pt = parseFloat(style.paddingTop) + (parseFloat(style.borderTopWidth) || 0)

             if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null

             const relY = y - r.top - pt + ta.scrollTop
             const relX = x - r.left - pl + ta.scrollLeft
             if (relY < 0) return null

             const row = Math.floor(relY / lh)
             const lines = ta.value.split('\n')
             if (row < 0 || row >= lines.length) return null

             const line = lines[row]
             if (line === undefined) return null

             const cw = tm.w
             let currX = 0
             let idx = 0
             let found = false
             for (let i = 0; i < line.length; i++) {
                 const w = (line[i] === '\t' ? 4 : 1) * cw
                 if (relX >= currX && relX < currX + w) {
                     idx = i
                     found = true
                     break
                 }
                 currX += w
             }
             if (!found && relX > currX) return null

             let lineStart = 0
             for (let i = 0; i < row; i++) lineStart += lines[i].length + 1
             const offset = lineStart + idx

             return { offset, row, idx, lines, line, relX, relY }
        }

        const isWordChar = ch => /[A-Za-z0-9_.]/.test(ch)
        const normalizeNames = list => (list || [])
            .map(item => (typeof item === 'string' ? item : item?.name))
            .filter(Boolean)

        const getLabelDefinitions = () => {
            const text = ta.value || ''
            const defs = new Map()
            const re = /^\s*([A-Za-z_]\w*):/gm
            let match = null
            while ((match = re.exec(text))) {
                const label = match[1]
                if (!label || defs.has(label)) continue
                const labelOffset = match.index + match[0].indexOf(label)
                defs.set(label, labelOffset)
            }
            return defs
        }

        const getWordAtInfo = info => {
            if (!info || !info.line) return null
            const line = info.line
            let idx = info.idx
            if (!isWordChar(line[idx]) && idx > 0 && isWordChar(line[idx - 1])) {
                idx -= 1
            }
            if (!isWordChar(line[idx])) return null
            let start = idx
            let end = idx
            while (start > 0 && isWordChar(line[start - 1])) start--
            while (end < line.length && isWordChar(line[end])) end++
            const lineStart = info.offset - info.idx
            return {
                word: line.slice(start, end),
                start: lineStart + start,
                end: lineStart + end,
            }
        }

        const getWordAtIndex = index => {
            const text = ta.value || ''
            if (!text.length) return null
            let idx = Math.max(0, Math.min(index || 0, text.length - 1))
            if (!isWordChar(text[idx]) && idx > 0 && isWordChar(text[idx - 1])) {
                idx -= 1
            }
            if (!isWordChar(text[idx])) return null
            let start = idx
            let end = idx
            while (start > 0 && isWordChar(text[start - 1])) start--
            while (end < text.length && isWordChar(text[end])) end++
            return { word: text.slice(start, end), start, end }
        }

        const resolveDefinition = wordInfo => {
            if (!wordInfo || !wordInfo.word) return null
            const labelDefs = getLabelDefinitions()
            if (labelDefs.has(wordInfo.word)) {
                return { type: 'label', name: wordInfo.word, index: labelDefs.get(wordInfo.word), range: wordInfo }
            }
            const symbolList = normalizeNames(o.symbolProvider ? o.symbolProvider('symbol') : [])
            if (symbolList.includes(wordInfo.word)) {
                return { type: 'symbol', name: wordInfo.word, range: wordInfo }
            }
            return null
        }

        let linkHoverTarget = null
        let lastMouse = null
        let ctrlDown = false

        const clearLinkHover = () => {
            clearLinkHighlight()
            linkHoverTarget = null
            ta.style.cursor = ''
        }

        const updateLinkHover = (x, y) => {
            const info = getHoverInfo(x, y)
            if (!info) {
                clearLinkHover()
                return
            }
            const wordInfo = getWordAtInfo(info)
            const target = resolveDefinition(wordInfo)
            if (!target) {
                clearLinkHover()
                return
            }
            linkHoverTarget = target
            renderLinkHighlight(target.range)
            ta.style.cursor = 'pointer'
        }

        const goToDefinition = target => {
            if (!target) return
            if (target.type === 'label') {
                const pos = typeof target.index === 'number' ? target.index : target.range?.start
                if (typeof pos !== 'number') return
                if (typeof this.setCursor === 'function') {
                    this.setCursor(pos, { reveal: true, record: true })
                } else {
                    ta.focus()
                    ta.selectionStart = pos
                    ta.selectionEnd = pos
                    if (typeof this.revealRange === 'function') {
                        this.revealRange({ start: pos, end: pos + 1 }, { ratio: 0.33, highlight: false })
                    }
                }
            } else if (target.type === 'symbol') {
                if (typeof o.onGoToDefinition === 'function') {
                    o.onGoToDefinition({ type: 'symbol', name: target.name, blockId: o.blockId })
                }
            }
        }

        const handleCtrlKey = e => {
            const next = !!(e.ctrlKey || e.metaKey)
            if (next === ctrlDown) return
            ctrlDown = next
            if (!ctrlDown) {
                clearLinkHover()
            } else if (lastMouse) {
                updateLinkHover(lastMouse.x, lastMouse.y)
            }
        }

        const tryShowLintHoverAt = (x, y) => {
             if (!lintDiagnostics.length) return false
             const info = getHoverInfo(x, y)
             if (!info) return false
             const lintHit = lintDiagnostics.find(d => info.offset >= d.start && info.offset < d.end)
             if (!lintHit) return false
             const caretIndex = typeof lintHit.start === 'number' ? lintHit.start : info.offset
             showLintHover(lintHit, x, y, caretIndex)
             return true
        }

        const handleHover = (e) => {
             lastMouse = { x: e.clientX, y: e.clientY }
             if (ctrlDown) {
                 updateLinkHover(e.clientX, e.clientY)
             } else {
                 clearLinkHover()
             }
             if (hoverTimer) clearTimeout(hoverTimer)
             if (lintHoverActive) return
             if (tryShowLintHoverAt(e.clientX, e.clientY)) return
             if (lintHoverVisible) hideHover()
             if (!lang.definitions && !o.hoverProvider) return
             
             hoverTimer = setTimeout(() => {
                 showHover(e.clientX, e.clientY)
             }, 400)
        }
        
        const showHover = (x, y) => {
             const r = ta.getBoundingClientRect()
             const style = getComputedStyle(ta)
             
             const tm = measureText()
             const lh = tm.h

             const pl = parseFloat(style.paddingLeft) + (parseFloat(style.borderLeftWidth) || 0)
             const pt = parseFloat(style.paddingTop) + (parseFloat(style.borderTopWidth  ) || 0)
             
             // Check if within bounds
             if (x < r.left || x > r.right || y < r.top || y > r.bottom) return hideHover()

             const relY = y - r.top - pt + ta.scrollTop
             const relX = x - r.left - pl + ta.scrollLeft
             
             if (relY < 0) return hideHover()
             
             const row = Math.floor(relY / lh)
             const lines = ta.value.split('\n')
             if (row < 0 || row >= lines.length) return hideHover()
             
             const line = lines[row]
             if (line === undefined) return hideHover()

             // Approximate col
             const cw = tm.w
             const col = Math.floor(relX / cw)
             
             // Extract word at col
             // Accounting for tabs is tricky without robust measurement.
             // We can assume 4 spaces for now as we set tab-size: 4
             let currX = 0
             let idx = 0
             let found = false
             for (let i = 0; i < line.length; i++) {
                 const w = (line[i] === '\t' ? 4 : 1) * cw
                 if (relX >= currX && relX < currX + w) {
                     idx = i
                     found = true
                     break
                 }
                 currX += w
             }
             if (!found && relX > currX) {
                 // Cursor past end of line
                 return hideHover()
             }

             if (lintDiagnostics.length) {
                 let lineStart = 0
                 for (let i = 0; i < row; i++) lineStart += lines[i].length + 1
                 const offset = lineStart + idx
                 const lintHit = lintDiagnostics.find(d => offset >= d.start && offset < d.end)
                 if (lintHit) {
                     const caretIndex = typeof lintHit.start === 'number' ? lintHit.start : offset
                     showLintHover(lintHit, x, y, caretIndex)
                     return
                 }
             }
             
             // Find word boundaries
             if (!/[a-zA-Z0-9_.]/.test(line[idx])) return hideHover()
                 
             let start = idx
             while (start > 0 && /[a-zA-Z0-9_.]/.test(line[start - 1])) start--
             
             let end = idx
             while (end < line.length && /[a-zA-Z0-9_.]/.test(line[end])) end++
             
             const fullWord = line.slice(start, end)
             if (!fullWord) return hideHover()
             
             // Lookup definition
             // Try strict match first
             let def = lang.definitions[fullWord]
             let label = fullWord
             
             // Namespace lookup
             if (!def && fullWord.includes('.')) {
                 const [ns, key] = fullWord.split('.')
                 const parent = Object.entries(lang.definitions).find(([k]) => k.toLowerCase() === ns.toLowerCase())
                 // parent is [key, val]
                 if (parent) {
                    if (parent[1][key]) {
                        def = parent[1][key]
                        label = fullWord
                    } else if (parent[1][key.toLowerCase()]) {
                        def = parent[1][key.toLowerCase()]
                         label = `${parent[0]}.${key}`
                    }
                 }
             }
             
             // Try searching just the leaf if no match?
             if (!def && fullWord.includes('.')) {
                  // If hovering "u8.add" and "u8" is not a namespace but just a prefix?
                  // Should already be handled.
             }
             
             if (!def && !fullWord.includes('.')) {
                  // Maybe case insensitive
                  const match = Object.keys(lang.definitions).find(k => k.toLowerCase() === fullWord.toLowerCase())
                  if (match) {
                      def = lang.definitions[match]
                      label = match
                  }
             }

             // Check external hover provider
             let externalHover = null
             if (o.hoverProvider) {
                 try {
                     const res = o.hoverProvider(fullWord)
                     // Handle both async and sync (though handleHover timer is short, async might lag)
                     // For now assume sync or fast async?
                     // If async, we can't await here easily inside showHover which is synchronous-ish context.
                     // But let's support string return.
                     if (typeof res === 'string') externalHover = res
                     else if (res && typeof res.then === 'function') {
                         // Async handling complicates things as we are already in a timer callback
                         // For now, let's assume sync for symbols.
                         // If we need async, we'd need to handle promise resolution and re-check bounds.
                     }
                 } catch (e) { console.error(e) }
             }

             if (def || externalHover) {
                 // Found instructions?
                 let html = ''
                 
                 if (def) {
                     // Def is array of args.
                     // Check if it has description
                     const desc = def.description || ''
                     const example = def.example || ''
                     
                     let sig = label
                     if (Array.isArray(def)) {
                         sig += '(' + def.map(a => `${a.name}${a.type?': '+a.type:''}`).join(', ') + ')'
                     }
                     
                     html = `<div class="mce-hover-def">${sig}</div>`
                     if (desc) html += `<div class="mce-hover-desc">${desc}</div>`
                     if (example) html += `<div class="mce-hover-ex">${example}</div>`
                 } else if (externalHover) {
                     html = externalHover
                 }
                 
                 hov.innerHTML = html
                 hov.style.display = 'block'
                 
                 // Position at bottom of line?
                 // Use client coordinates or fixed?
                 // hov is fixed
                 
                 // Smart positioning (avoid offscreen)
                 positionHover(x, y)

             } else {
                 hideHover()
             }
        }
        
        ta.addEventListener('mousemove', handleHover)
        ta.addEventListener('mouseleave', () => {
            if (hoverTimer) clearTimeout(hoverTimer)
            hideHover()
            clearLinkHover()
        })
        ta.addEventListener('scroll', () => {
            hideHover()
            clearLinkHover()
        })


        /* language */
        const lang = MiniCodeEditor.languages[(o.language || 'st').toLowerCase()]
        if (!lang) throw Error('language ' + o.language)

        /* utils */
        const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const processToken = (token, rule) => {
            if (rule.className === 'kw' && lang.definitions && lang.typeKeywords && lang.typeKeywords.includes(token)) return `<span class="type-keyword">${token}</span>`
            return `<span class="${rule.className}">${token}</span>`
        }
        const applyRule = (segment, rule) => {
            if (typeof rule.replace === 'function') {
                return segment.replace(rule.regex, (...args) => rule.replace(...args))
            }
            return segment.replace(rule.regex, m => processToken(m, rule))
        }
        const colour = t =>
            lang.rules.reduce(
                (v, r) =>
                    v
                        .split(/(<span[^>]*>.*?<\/span>)/gs)
                        .map(s => (s.startsWith('<span') ? s : applyRule(s, r)))
                        .join(''),
                esc(t)
            )
        let visualText = ''
        const visualMarkers = new Map()
        let sortedPills = []

        const cursorEl = m.appendChild(document.createElement('div'))
        cursorEl.className = 'mce-cursor'
        cursorEl.style.cssText = `position:absolute;width:2px;background:#ccc;z-index:20;pointer-events:none;display:none;will-change:transform;`
        
        let blinkInterval = null
        const resetBlink = () => {
             cursorEl.style.visibility = 'visible'
             if (blinkInterval) clearInterval(blinkInterval)
             blinkInterval = setInterval(() => {
                 cursorEl.style.visibility = cursorEl.style.visibility === 'hidden' ? 'visible' : 'hidden'
             }, 530)
        }

        const updateCursor = () => {
             if (document.activeElement !== ta) {
                 cursorEl.style.display = 'none'
                 if (blinkInterval) clearInterval(blinkInterval)
                 return
             }
             const p = caretPx(ta.selectionStart)
             
             cursorEl.style.display = 'block'
             cursorEl.style.left = p.x + 'px'
             cursorEl.style.top = p.y + 'px'
             cursorEl.style.height = p.h + 'px'
             resetBlink()
        }
        
        const userSelectionDivs = []
        const updateUserSelection = () => {
            userSelectionDivs.forEach(d => d.remove())
            userSelectionDivs.length = 0
            
            if (document.activeElement !== ta) return
            const start = ta.selectionStart
            const end = ta.selectionEnd
            if (start === end) return

            const text = ta.value || ''
            if (!text.length) return

            const maxLen = text.length
            let safeStart = Math.max(0, Math.min(start, maxLen))
            let safeEnd = Math.max(safeStart + 1, Math.min(end, maxLen))
             
            // We iterate lines similar to renderSelectedHighlight but we use caretPx on the visual text
            let offset = 0
            const lines = text.split('\n')
            
            for (let i = 0; i < lines.length; i++) {
                const lineStart = offset
                const lineEnd = offset + lines[i].length // excluding \n
                
                // Check intersection
                // Range is [safeStart, end)
                // Line is [lineStart, lineEnd] - actually lines include \n in length calculation for offset but not for display
                
                // If the selection spans into this line
                if (end > lineStart && safeStart < lineEnd + 1) { // +1 to cover EOL selection?
                     // Calculate Clamped Segment
                     let s = Math.max(safeStart, lineStart)
                     let e = Math.min(end, lineEnd) // Do we highlight the newline character width?
                     
                     // If selection covers the newline, usually editors highlight a standard width at EOL
                     let highlightEOL = false
                     if (end > lineEnd) {
                         // selected the newline
                         highlightEOL = true
                     }
                     
                     if (e > s || (highlightEOL && s === e)) {
                         const p = caretPx(s)
                         const p2 = caretPx(e)
                         
                         const d = document.createElement('div')
                         d.className = 'mce-user-selection'
                         d.style.left = p.x + 'px'
                         d.style.top = p.y + 'px'
                         d.style.height = p.h + 'px'
                         
                         let w = p2.x - p.x
                         if (w < 0) w = 0
                         if (highlightEOL) w += 8 // Arbitrary width for newline highlight
                         if (w < 2) w = 2
                         
                         d.style.width = w + 'px'
                         ov.insertBefore(d, ov.firstChild)
                         userSelectionDivs.push(d)
                     }
                }
                
                offset += lines[i].length + 1
            }
        }

        document.addEventListener('selectionchange', () => {
             if (document.activeElement === ta) {
                 updateCursor()
                 updateUserSelection()
             }
        })
        
        const updatePillValues = () => {
             const entries = getPreviewEntries()
             if (!entries || !previewValueProvider) return paint()

             // 1. Resolve Current Active Pills
             const newActive = []
             entries.forEach(e => {
                const val = previewValueProvider(e)
                if (val !== null && val !== undefined && val !== '') {
                    newActive.push({ pos: e.end ?? e.start ?? 0, val, entry: e })
                }
             })
             newActive.sort((a,b) => a.pos - b.pos)
             
             // 2. Struct Check
             if (newActive.length !== sortedPills.length) return paint()
             
             for (let i = 0; i < newActive.length; i++) {
                 if (newActive[i].pos !== sortedPills[i].pos) return paint()
             }
             
             // 3. Fast DOM Update
             const domPills = cd.querySelectorAll('.mce-preview-pill')
             if (domPills.length !== newActive.length) return paint()
             
             let changed = false
             let markerCode = 0xE000
             
             newActive.forEach((p, idx) => {
                 const oldP = sortedPills[idx]
                 // Simple value check (handling objects)
                 const newValJson = typeof p.val === 'object' ? JSON.stringify(p.val) : String(p.val)
                 const oldValJson = typeof oldP.val === 'object' ? JSON.stringify(oldP.val) : String(oldP.val)
                 
                 // Always update reference and visualMarkers cache for caretPx to be correct
                 sortedPills[idx] = p 
                 
                 let text = '', cls = ''
                 if (typeof p.val === 'object') {
                     text = p.val.text || ''
                     cls = p.val.className || ''
                 } else {
                     text = String(p.val)
                 }

                 // Check if entry is non-interactive (no tab selection)
                 const tabindexAttr = p.entry?.nonInteractive ? '' : ' tabindex="0"'
                 const validMarker = String.fromCharCode(markerCode++)
                 const html = `<span class="mce-preview-pill ${cls}" data-pill-index="${idx}"${tabindexAttr}>${esc(text)}</span>`
                 visualMarkers.set(validMarker, html)

                 if (newValJson !== oldValJson) {
                     changed = true
                     const el = domPills[idx]
                     if (el.textContent !== text) el.textContent = text
                     const newCls = `mce-preview-pill ${cls}`
                     if (el.className !== newCls) el.className = newCls
                     if (el.dataset.pillIndex !== String(idx)) el.dataset.pillIndex = String(idx)
                     // Update tabindex for non-interactive pills
                     if (p.entry?.nonInteractive) {
                         el.removeAttribute('tabindex')
                     } else if (!el.hasAttribute('tabindex')) {
                         el.setAttribute('tabindex', '0')
                     }
                 }
             })

             if (changed) {
                 updateUserSelection()
                 updateCursor()
             }
        }

        const paint = () => {
            const entries = getPreviewEntries()
            const code = ta.value
            
            visualText = ''
            visualMarkers.clear()
            sortedPills = []
            
            if (previewValueProvider) {
                entries.forEach(e => {
                    const val = previewValueProvider(e)
                    if (val !== null && val !== undefined && val !== '') {
                        sortedPills.push({ pos: e.end ?? e.start ?? 0, val, entry: e })
                    }
                })
            }
            sortedPills.sort((a,b) => a.pos - b.pos)
            
            let lastPos = 0
            let markerCode = 0xE000
            
            sortedPills.forEach((p, idx) => {
                const seg = code.slice(lastPos, p.pos)
                visualText += seg
                
                const validMarker = String.fromCharCode(markerCode++)
                visualText += validMarker
                
                let text = '', cls = ''
                if (typeof p.val === 'object') {
                     text = p.val.text || ''
                     cls = p.val.className || ''
                } else {
                     text = String(p.val)
                }
                // Check if entry is non-interactive (no tab selection)
                const tabindexAttr = p.entry?.nonInteractive ? '' : ' tabindex="0"'
                const html = `<span class="mce-preview-pill ${cls}" data-pill-index="${idx}"${tabindexAttr}>${esc(text)}</span>`
                visualMarkers.set(validMarker, html)
                
                lastPos = p.pos
            })
            visualText += code.slice(lastPos)
            
            let html = colour(visualText)
            html = html.replace(/[\uE000-\uF8FF]/g, m => visualMarkers.get(m) || '')
            
            cd.innerHTML = html + '\u200B'
            updateLN()
            updateCursor()
        }

        /* Pill Interactions */
        const handlePillAction = (e, type) => {
             const pill = e.target.closest('.mce-preview-pill')
             if (!pill) return
             
             if (type !== 'keydown') {
                 e.stopPropagation()
                 if (document.activeElement !== pill) pill.focus()
             }

             const idx = parseInt(pill.dataset.pillIndex, 10)
             const p = sortedPills[idx]
             if (p && p.entry) {
                 if (type === 'click' && o.onPreviewClick) o.onPreviewClick(p.entry, e)
                 else if ((type === 'contextmenu' || type === 'dblclick') && o.onPreviewContextMenu) {
                     e.preventDefault()
                     o.onPreviewContextMenu(p.entry, e)
                 } else if (type === 'keydown') {
                     const isBit = pill.classList.contains('bit')
                     const key = e.key
                     let action = null
                     
                     if (key === 'Escape') {
                         pill.blur()
                         e.preventDefault()
                         e.stopPropagation()
                         return
                     }
                     
                     if (isBit) {
                         if (key === '1') action = 'set'
                         else if (key === '0') action = 'reset'
                         else if (key === 'Enter' || key === ' ') action = 'toggle'
                     } else {
                         if (key === 'Enter' || key === ' ') action = 'edit'
                     }
                     
                     if (action) {
                         e.preventDefault()
                         e.stopPropagation()
                         if (o.onPreviewAction) o.onPreviewAction(p.entry, action)
                     }
                 }
             }
        }
        cd.addEventListener('mousedown', e => handlePillAction(e, 'click'))
        cd.addEventListener('contextmenu', e => handlePillAction(e, 'contextmenu'))
        cd.addEventListener('dblclick', e => handlePillAction(e, 'dblclick'))
        cd.addEventListener('keydown', e => handlePillAction(e, 'keydown'))


        /* line numbers */
        const updateLN = () => {
            const lines = ta.value.split(/\n/).length
            let out = ''
            for (let i = 1; i <= lines; i++) out += i + '\n'
            ln.textContent = out
        }

        /* caret px helper */
        const caretPx = i => {
            let count = 0
            for(const p of sortedPills) {
                if(p.pos <= i) count++
                else break
            }
            const vi = i + count
            
            const subVisual = visualText.slice(0, vi) || ta.value.slice(0, i) // Fallback if paint not called yet

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
            
            let h = colour(subVisual)
            h = h.replace(/[\uE000-\uF8FF]/g, m => visualMarkers.get(m) || '')
            
            d.innerHTML = h
            const sp = d.appendChild(document.createElement('span'))
            sp.textContent = '|'
            ta.parentNode.appendChild(d)
            const p = {x: sp.offsetLeft, y: sp.offsetTop, h: sp.offsetHeight}
            ta.parentNode.removeChild(d)
            return p
        }

        /* scrolling sync */
        const sync = () => {
            // Fix: If horizontal scrollbar is present, the textarea client height decreases, 
            // increasing the max scrollTop. The background layers (pr, ln) don't have a scrollbar
            // so their client height is larger, resulting in a smaller max scrollTop.
            // We compensate by adding bottom padding to match the scrollbar height.
            const sbH = ta.offsetHeight - ta.clientHeight
            pr.style.paddingBottom = (8 + sbH) + 'px'
            ln.style.paddingBottom = (8 + sbH) + 'px'

            pr.scrollLeft = ta.scrollLeft
            pr.scrollTop = ta.scrollTop
            ln.scrollTop = ta.scrollTop
            ov.style.width = Math.max(ta.scrollWidth, ta.clientWidth) + 'px'
            ov.style.height = Math.max(ta.scrollHeight, ta.clientHeight) + 'px'
            ov.style.transform = `translate(${-ta.scrollLeft}px,${-ta.scrollTop}px)`
            if (!ac.classList.contains('hide')) posAC(ta.selectionStart)
        }
        const handleScroll = () => {
            sync()
            blurPills()
            if (typeof o.onScroll === 'function') {
                o.onScroll({ top: ta.scrollTop, left: ta.scrollLeft })
            }
        }
        ta.addEventListener('scroll', handleScroll)

        /* linter */
        const markers = []
        const renderMarkers = (diagnostics) => {
            markers.forEach(m => m.remove())
            markers.length = 0
            lintDiagnostics = Array.isArray(diagnostics) ? diagnostics : []
            lintHoverActive = false

            if (!ta.value.length) return
    
            lintDiagnostics.forEach((d, idx) => {
                const rawStart = typeof d.start === 'number' ? d.start : 0
                const rawEnd = typeof d.end === 'number' ? d.end : rawStart + 1
                const maxLen = ta.value.length
                const start = Math.max(0, Math.min(rawStart, maxLen))
                let end = Math.max(start + 1, Math.min(rawEnd, maxLen))
                if (end <= start) end = Math.min(maxLen, start + 1)

                const p = caretPx(start)
                const p2 = caretPx(end)
                
                const m = document.createElement('div')
                m.className = `mce-marker ${d.type === 'error' ? 'err' : 'warn'}`
                const total = lintDiagnostics.length
                const typeLabel = d.type === 'warning' ? 'Warning' : d.type === 'info' ? 'Info' : 'Error'
                const indexLabel = total > 0 ? ` ${idx + 1}/${total}` : ''
                const message = d.message || ''
                m.dataset.msg = `${typeLabel}${indexLabel}: ${message}`.trim()
                m.style.left = p.x + 'px'
                m.style.top = p.y + 'px'
                m.style.height = p.h + 'px'
                
                if (p.y === p2.y) {
                     m.style.width = (p2.x - p.x) + 'px'
                } else {
                     m.style.width = '100px'
                }
                m.textContent = ta.value.slice(start, end)

                m.addEventListener('mouseenter', () => {
                    lintHoverActive = true
                    hideHover()
                })
                m.addEventListener('mouseleave', () => {
                    lintHoverActive = false
                })
                
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
                // Ensure we lint clean code free of artifacts
                const code = rawCode !== null ? rawCode : unspace(ta.value)
                const problems = await provider(code)
                renderMarkers(problems)
                if (o.onDiagnosticsChange) o.onDiagnosticsChange(problems)
             } catch (e) { console.error(e) }
        }
        
        let lintTimer = null
        const triggerLint = () => {
            if (lintTimer) clearTimeout(lintTimer)
            lintTimer = setTimeout(runLint, 200)
        }

        /* live overlay */
        let live = o.liveProvider || (() => undefined)
        let previewEntriesProvider = typeof o.previewEntriesProvider === 'function' ? o.previewEntriesProvider : null
        let previewValueProvider = typeof o.previewValueProvider === 'function' ? o.previewValueProvider : null
        
        /** @type {Map<string, {el: HTMLElement, x: number, y: number, text: string, cls: string}>} */
        const activePills = new Map()

        const clearPreviewPills = () => {
             // Logic moved to renderPreviewPills diffing
             // But if we need to force clear:
             activePills.forEach(({el}) => el.remove())
             activePills.clear()
        }
        
        const blurPills = () => {
             const active = document.activeElement
             if (active && active.classList.contains('mce-preview-pill')) {
                 active.blur()
             }
        }

        const GAP_STR = ''
        let rawCode = null 
        const unspace = (text) => text
        const restoreRaw = () => {}

        const getPreviewEntries = () => {
            if (previewEntriesProvider) return previewEntriesProvider() || []
            return []
        }

        const updateVisualGaps = () => {}
        const renderPreviewPills = () => {}

        const originalCleanup = this._cleanup || (() => {})
        this._cleanup = () => {
            originalCleanup()
        }

        const overlay = () => {
             ov.querySelectorAll('.live').forEach(n => n.remove())
            // ... legacy live provider support ...
            const re = /\b([A-Za-z_]\w*)\b/g
            let mx
            while ((mx = re.exec(ta.value))) {
                const val = live(mx[1])
                if (val === undefined) continue
                const p = caretPx(mx.index + mx[1].length)
                const s = document.createElement('span')
                s.className = 'live'
                s.textContent = ' = ' + val
                s.style.cssText = `position:absolute;left:${p.x + 6}px;top:${p.y}px`
                ov.appendChild(s)
            }
        }

        /* expose live methods */
        this.refreshLive = () => {
            paint() 
            overlay()
            sync()
        }
        
        ta.addEventListener('focus', () => { })
        ta.addEventListener('blur', () => { this.refreshLive() })
        
        this.setLiveProvider = fn => {
            if (typeof fn === 'function') {
                live = fn
                this.refreshLive()
            }
        }
        this.setPreviewProviders = (entriesProvider, valueProvider) => {
            previewEntriesProvider = typeof entriesProvider === 'function' ? entriesProvider : null
            previewValueProvider = typeof valueProvider === 'function' ? valueProvider : null
            paint()
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

        const handleHistoryEvent = () => {
            markActiveEditor()
            scheduleHistory()
        }
        ta.addEventListener('keyup', handleHistoryEvent)
        ta.addEventListener('mouseup', handleHistoryEvent)
        ta.addEventListener('input', handleHistoryEvent)
        ta.addEventListener('focus', handleHistoryEvent)

        // Manual Trigger (Ctrl+Space or Ctrl+Click)
        ta.addEventListener('keydown', e => {
            if (e.key === 'F12') {
                const target = resolveDefinition(getWordAtIndex(ta.selectionStart))
                if (target) {
                    e.preventDefault()
                    goToDefinition(target)
                }
                return
            }
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
            if (e.ctrlKey || e.metaKey) {
                const target = linkHoverTarget || resolveDefinition(getWordAtInfo(getHoverInfo(e.clientX, e.clientY)))
                if (target) {
                    e.preventDefault()
                    e.stopPropagation()
                    goToDefinition(target)
                    return
                }
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
            o.onChange && o.onChange(rawCode !== null ? rawCode : unspace(ta.value))
        }
        setTimeout(() => {
            ta.addEventListener('input', tick)
            tick()
            this._timer = setInterval(() => {
                 if (previewValueProvider) updatePillValues()
                 overlay()
            }, 200)
        }, 100)

        document.addEventListener('keydown', handleCtrlKey)
        document.addEventListener('keyup', handleCtrlKey)
        
        // Expose cleanup for destroy
        this._cleanup = () => {
             document.removeEventListener('mousedown', docClick)
             document.removeEventListener('keydown', handleCtrlKey)
             document.removeEventListener('keyup', handleCtrlKey)
             ta.removeEventListener('keyup', handleHistoryEvent)
             ta.removeEventListener('mouseup', handleHistoryEvent)
             ta.removeEventListener('input', handleHistoryEvent)
             ta.removeEventListener('focus', handleHistoryEvent)
             if (historyTimer) clearTimeout(historyTimer)
             if (this._ac) this._ac.remove()
             if (this._hint) this._hint.remove()
        }

        /* Public API */
        this.setDiagnostics = (diagnostics = []) => {
            renderMarkers(diagnostics)
            if (o.onDiagnosticsChange) o.onDiagnosticsChange(diagnostics)
        }
        this.setHoverHighlight = (range) => {
            if (!range) {
                clearHoverHighlight()
                return
            }
            renderHoverHighlight(range)
        }
        this.setSelectedHighlight = (range) => {
            if (!range) {
                clearSelectedHighlight()
                return
            }
            renderSelectedHighlight(range)
        }
        this.getCodePosition = index => {
            const text = ta.value || ''
            const maxLen = text.length
            const safeIndex = Math.max(0, Math.min(index || 0, maxLen))
            const p = caretPx(safeIndex)
            const rect = ta.getBoundingClientRect()
            return {
                x: p.x,
                y: p.y,
                height: p.h,
                viewportX: rect.left + p.x - ta.scrollLeft,
                viewportY: rect.top + p.y - ta.scrollTop,
                scrollTop: ta.scrollTop,
                scrollLeft: ta.scrollLeft,
                rect
            }
        }
        this.revealRange = (range, opts = {}) => {
            if (!range || typeof range.start !== 'number') return false
            const ratio = typeof opts.ratio === 'number' ? opts.ratio : 0.33
            const maxAttempts = typeof opts.attempts === 'number' ? opts.attempts : 3
            const tooltipHighlight = opts.tooltipHighlight !== false
            const applyScroll = () => {
                const p = caretPx(range.start)
                const target = Math.max(0, p.y - ta.clientHeight * ratio)
                if (Math.abs(ta.scrollTop - target) > 1) {
                    ta.scrollTop = target
                }
                sync()
            }
            const attemptReveal = (attempt = 0) => {
                applyScroll()
                if (opts.highlight !== false) renderHoverHighlight(range)
                if (opts.showTooltip) {
                    const shown = this.showLintTooltip(range, { highlight: tooltipHighlight })
                    if (!shown && attempt < maxAttempts) {
                        requestAnimationFrame(() => attemptReveal(attempt + 1))
                    }
                }
            }
            applyScroll()
            requestAnimationFrame(() => attemptReveal(0))
            return true
        }
        this.showLintTooltip = (range, opts = {}) => {
            if (hoverTimer) clearTimeout(hoverTimer)
            if (!range) {
                hideHover()
                return false
            }
            if (!lintDiagnostics.length) return false

            const start = typeof range.start === 'number' ? range.start : null
            const end = typeof range.end === 'number' ? range.end : null
            if (start === null) return false

            const hit = lintDiagnostics.find(d => start >= d.start && start < d.end)
                || lintDiagnostics.find(d => end !== null && d.start < end && d.end > start)
            if (!hit) return false

            const p = caretPx(hit.start)
            const visibleTop = ta.scrollTop
            const visibleBottom = ta.scrollTop + ta.clientHeight
            if (p.y + p.h < visibleTop || p.y > visibleBottom) return false

            const r = ta.getBoundingClientRect()
            const viewportX = r.left + p.x - ta.scrollLeft
            const viewportY = r.top + p.y - ta.scrollTop
            const viewportBottom = viewportY + p.h
            const body = ta.closest('.plc-editor-body')
            if (body) {
                const bodyRect = body.getBoundingClientRect()
                if (viewportY < bodyRect.top || viewportBottom > bodyRect.bottom) return false
            } else {
                if (viewportY < 0 || viewportBottom > window.innerHeight) return false
            }

            showLintHover(hit, 0, 0, hit.start, { highlight: opts.highlight !== false, notify: opts.notify === true })
            return true
        }
        this.setCursor = (index, opts = {}) => {
            const text = ta.value || ''
            const maxLen = text.length
            const rawIndex = typeof index === 'number' ? index : 0
            const safeIndex = Math.max(0, Math.min(rawIndex, maxLen))
            if (opts.suppressHistory) {
                suppressHistory(120, safeIndex)
            }
            ta.focus()
            ta.selectionStart = safeIndex
            ta.selectionEnd = safeIndex
            if (opts.reveal !== false && typeof this.revealRange === 'function') {
                const ratio = typeof opts.ratio === 'number' ? opts.ratio : 0.33
                this.revealRange({ start: safeIndex, end: safeIndex + 1 }, { ratio, highlight: false })
            }
            if (opts.record) {
                scheduleHistory()
            }
        }
        this.getValue = () => unspace(ta.value)
        this.getScroll = () => ({ top: ta.scrollTop, left: ta.scrollLeft })
        this.setScroll = pos => {
            if (!pos) return
            if (typeof pos.top === 'number') ta.scrollTop = pos.top
            if (typeof pos.left === 'number') ta.scrollLeft = pos.left
            sync()
        }
        this.setValue = v => {
            if (typeof restoreRaw === 'function') restoreRaw()
            const sl = ta.scrollLeft,
                st = ta.scrollTop
            ta.value = v
            tick()
            ta.scrollLeft = sl
            ta.scrollTop = st
        }
        this.getScrollHeight = () => (cd.scrollHeight || 0) + 16
        this.setReadOnly = (locked = true) => {
            ta.readOnly = !!locked
            if (!locked && ta.disabled) ta.disabled = false
        }
        this.setMonitoringBackground = (enabled) => {
             // Change background to lighter grey when monitoring
             // Default bg is usually around #1e1e1e (dark)
             // We want it significantly lighter to indicate monitoring mode
             if (enabled) {
                 pr.style.backgroundColor = '#383838' // Distinct lighter grey
                 ta.style.backgroundColor = 'transparent'
             } else {
                 pr.style.backgroundColor = '' // Reset to default CSS
                 ta.style.backgroundColor = ''
             }
        }

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => {
                sync()
                updateLN()
            })
            ro.observe(m)
            const clean = this._cleanup
            this._cleanup = () => {
                ro.disconnect()
                if (clean) clean()
            }
        }
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
const doc = (args, desc, ex) => {
    const a = args || []
    a.description = desc
    a.example = ex
    return a
}

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
    const: doc([{name:'value', type:'number'}], 'Push constant value to stack.', 'u8.const 10'),
    move: doc([], 'Move value from stack to memory using pointer from the stack. Pops value and pointer.', 'u8.move'), 
    load: doc([], 'Load value from memory to stack using pointer from the stack. Pops pointer, pushes value.', 'u8.load'),
    move_copy: doc([], 'Move value from stack to memory using pointer from the stack. Keeps value on stack, pops pointer.', 'u8.move_copy'),
    load_from: doc([{name: 'addr', type: 'symbol'}], 'Load value from memory to stack using immediate address.', 'u8.load_from var1'),
    move_to: doc([{name: 'addr', type: 'symbol'}], 'Move value from stack to memory using immediate address.', 'u8.move_to var1'),
    copy: doc([], 'Duplicate the top value on the stack.', 'u8.copy'), 
    swap: doc([], 'Swap the top two values on the stack.', 'u8.swap'), 
    drop: doc([], 'Discard the top value on the stack.', 'u8.drop'), 
    // Bit Ops available on integer types usually, but definitely on u8
    set: doc([{name:'bit', type:'number'}], 'Set a specific bit of the value on stack to 1.', 'u8.set 0'),
    get: doc([{name:'bit', type:'number'}], 'Get a specific bit of the value on stack (0 or 1).', 'u8.get 0'),
    rset: doc([{name:'bit', type:'number'}], 'Reset a specific bit of the value on stack to 0.', 'u8.rset 0'),
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
        const: doc([{name: 'address', type: 'symbol'}], 'Load address of a symbol into pointer register', 'ptr.const symbol1'),
        copy: doc([], 'Copy pointer value', 'ptr.copy'),
        load: doc([], 'Load value from address pointed to by register', 'ptr.load'), // Indirect load?
    },
    
    // Type operations (Cascading definitions)
    ...typeOps,

    // u8 specific extensions from snippet
    u8: {
        ...typeOps.u8,
        readBit: doc([{name: 'addr.bit', type: 'bit_symbol'}], 'Read a single bit from a byte variable or input/output.', 'u8.readBit input1'),
        readBitDU: doc([{name: 'input', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Rising Edge Contact (R_TRIG).\nPushes 1 if input transitions from 0 to 1, otherwise 0.\nUpdates the state bit.', 'u8.readBitDU input1 state_var'),
        readBitDD: doc([{name: 'input', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Falling Edge Contact (F_TRIG).\nPushes 1 if input transitions from 1 to 0, otherwise 0.\nUpdates the state bit.', 'u8.readBitDD input1 state_var'),
        readBitInvDU: doc([{name: 'input', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Rising Edge Contact on Inverted Input.\nPushes 1 if inverted input transitions from 0 to 1 (Input 1->0).', 'u8.readBitInvDU input1 state_var'),
        readBitInvDD: doc([{name: 'input', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Falling Edge Contact on Inverted Input.\nPushes 1 if inverted input transitions from 1 to 0 (Input 0->1).', 'u8.readBitInvDD input1 state_var'),
        
        writeBit: doc([{name: 'addr.bit', type: 'bit_symbol'}], 'Write the accumulator LSB to a target bit.', 'u8.writeBit output1'),
        writeBitDU: doc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Pulse Coil (Rising).\nWrites 1 to target only on the rising edge of the accumulator value.', 'u8.writeBitDU output1 state_var'),
        writeBitDD: doc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Pulse Coil (Falling).\nWrites 1 to target only on the falling edge of the accumulator value.', 'u8.writeBitDD output1 state_var'),
        
        writeBitOn: doc([{name: 'addr.bit', type: 'bit_symbol'}], 'Write 1 to target bit.', 'u8.writeBitOn output1'),
        writeBitOnDU: doc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Set Coil on Rising Edge.\nSets target to 1 on rising edge of accumulator.', 'u8.writeBitOnDU output1 state_var'),
        writeBitOnDD: doc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Set Coil on Falling Edge.\nSets target to 1 on falling edge of accumulator.', 'u8.writeBitOnDD output1 state_var'),
        
        writeBitOff: doc([{name: 'addr.bit', type: 'bit_symbol'}], 'Write 0 to target bit.', 'u8.writeBitOff output1'),
        writeBitOffDU: doc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Reset Coil on Rising Edge.\nSets target to 0 on rising edge of accumulator.', 'u8.writeBitOffDU output1 state_var'),
        writeBitOffDD: doc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Reset Coil on Falling Edge.\nSets target to 0 on falling edge of accumulator.', 'u8.writeBitOffDD output1 state_var'),

        writeBitInv: doc([{name: 'addr.bit', type: 'bit_symbol'}], 'Write the inverted accumulator LSB to a target bit.', 'u8.writeBitInv output1'),
        writeBitInvDU: doc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Pulse Coil (Inverted Rising).\nWrites 1 to target on rising edge of !ACC (Falling edge of ACC).', 'u8.writeBitInvDU output1 state_var'),
        writeBitInvDD: doc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Pulse Coil (Inverted Falling).\nWrites 1 to target on falling edge of !ACC (Rising edge of ACC).', 'u8.writeBitInvDD output1 state_var'),

        du: doc([{name: 'state', type: 'bit_symbol'}], 'Detect Rising Edge of Stack.\nChecks if value on stack has risen (0->1) based on state bit.', 'u8.du state_var'),
        add: doc([], 'Add value to accumulator.', 'u8.add'),
    },

    // Control Flow
    jmp: doc([{name: 'label', type: 'label'}], 'Jump unconditionally to label', 'jmp skip_label'),
    jump: doc([{name: 'label', type: 'label'}], 'Jump unconditionally to label', 'jump target'),
    jmp_if: doc([{name: 'label', type: 'label'}], 'Jump if accumulator is non-zero (true)', 'jmp_if cond_true'),
    jmp_if_not: doc([{name: 'label', type: 'label'}], 'Jump if accumulator is zero (false)', 'jmp_if_not cond_false'),
    
    call: doc([{name: 'label', type: 'label'}], 'Call subroutine at label', 'call subroutine1'),
    
    ret: doc([], 'Return from subroutine', 'ret'),
    exit: doc([], 'End program execution', 'exit'),
    nop: doc([], 'No Operation', 'nop'),
    clear: doc([], 'Clear the stack. Removes all values from the stack.', 'clear'),
    
    // Conversion
    cvt: doc([
        {name: 'from', type: 'type'},
        {name: 'to', type: 'type'},
    ], 'Convert value between types', 'cvt u8 f32'),
    
    // Global Const
    const: doc([
        {name: 'name', type: 'text'},
        {name: 'value', type: 'number'},
    ], 'Define a global constant', 'const MAX_VAL 100'),
}

MiniCodeEditor.registerLanguage('asm', {
    rules: [
        {regex: /\/\*[\s\S]*?\*\//g, className: 'cmt'},
        {regex: /\/\/.*$/gm, className: 'cmt'},
        {regex: /T#[A-Za-z0-9_]+/gi, className: 'num'},
        {regex: /#(?:\s*\d+)?/g, className: 'num'},
        {regex: /^\s*([A-Za-z_]\w*):/gm, className: 'function'}, // Labels
        {
            regex: /(\b(?:jmp|jump|call)(?:_if(?:_not)?)?(?:_rel)?\b)(\s+)([A-Za-z_]\w*)/gi,
            replace: (match, instr, ws, label) => `${instr}${ws}<span class="function">${label}</span>`
        }, // Label references in jumps/calls
        {regex: /^\b(const)\b/gm, className: 'kw'}, // Const declaration
        // Specific types (Datatypes)
        {regex: /\b[CXYMS]\d+(?:\.\d+)?\b/gi, className: 'addr'},
        {regex: /\b(ptr|u8|u16|u32|u64|i8|i16|i32|i64|f32|f64)\b/g, className: 'dt'},
        // BR (Binary Result) stack operations
        {regex: /\b(br)\.(save|read|copy|drop)\b/gim, className: 'kw'},
        // Timer and Counter instructions
        {regex: /\b(ton|tof|tp|ctu|ctd|ctud)\b/gim, className: 'type-keyword'},
        // Top level Keywords and method calls
        {regex: /\b(add|sub|mul|div|mod|pow|sqrt|neg|abs|sin|cos|cmp_eq|cmp_neq|cmp_gt|cmp_lt|cmp_gte|cmp_lte|and|or|xor|not|lshift|rshift|move|move_to|move_copy|load|load_from|copy|swap|drop|clear|set|get|rset|readBit|writeBit|writeBitInv|writeBitOn|writeBitOff|readBitDU|readBitDD|readBitInvDU|readBitInvDD|writeBitDU|writeBitDD|writeBitInvDU|writeBitInvDD|writeBitOnDU|writeBitOnDD|writeBitOffDU|writeBitOffDD|du|jmp(?:_if(?:_not)?)?(?:_rel)?|jump(?:_if(?:_not)?)?|call(?:_if(?:_not)?)?|ret(?:_if(?:_not)?)?|exit|loop|cvt|nop)\b/gim, className: 'kw'},
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

/* Siemens STL (Statement List) */
MiniCodeEditor.registerLanguage('stl', {
    definitions: {},
    rules: [
        // Comments
        {regex: /\/\/.*$/gm, className: 'cmt'},
        {regex: /\(\*[\s\S]*?\*\)/g, className: 'cmt'},
        // Labels (identifier followed by colon, not :=)
        {regex: /^\s*([A-Za-z_]\w*)(?=\s*:(?!=))/gm, className: 'function'},
        // IEC Time literals T#...
        {regex: /T#[A-Za-z0-9_]+/gi, className: 'num'},
        // Immediate values #123
        {regex: /#-?\d+/g, className: 'num'},
        // STL Instructions - Bit Logic (allow A( and O( for nesting)
        {regex: /\b(A|AN|O|ON|NOT|SET|CLR|CLEAR)\b(?!:)/gi, className: 'kw'},
        // XOR - separate to avoid matching X address prefix
        {regex: /\b(XN?)\b(?=\s+[A-Za-z])/gi, className: 'kw'},
        // Assign instruction (= at start of line or after whitespace)
        {regex: /(?<=^\s*|[\s])=(?=\s+[A-Za-z])/gm, className: 'kw'},
        // Set/Reset (S/R before an operand)
        {regex: /\b(S|R)\b(?=\s+[A-Za-z])/gi, className: 'kw'},
        // Edge Detection
        {regex: /\b(FP|FN)\b/gi, className: 'kw'},
        // Timers (special highlighting)
        {regex: /\b(TON|TOF|TP)\b/gi, className: 'type-keyword'},
        // Counters (special highlighting)
        {regex: /\b(CTU|CTD|CTUD)\b/gi, className: 'type-keyword'},
        // Load/Transfer/Store
        {regex: /\b(LD|LDN|ST)\b/gi, className: 'kw'},
        // L and T as standalone instructions (not address prefix)
        {regex: /(?<=^\s*)(L|T)\b(?=\s)/gim, className: 'kw'},
        // Math operators
        {regex: /[+\-*\/]I\b/gi, className: 'kw'},
        {regex: /\b(MOD|NEG|ABS)\b/gi, className: 'kw'},
        // Compare operators
        {regex: /[=<>]+I\b/gi, className: 'kw'},
        // Jumps
        {regex: /\b(JU|JC|JCN|JMP|JMPC|JMPCN)\b/gi, className: 'kw'},
        // Call/Return
        {regex: /\b(CALL|BE|BEC|BEU|RET)\b/gi, className: 'kw'},
        // IEC IL aliases
        {regex: /\b(AND|ANDN|OR|ORN|XOR|XORN)\b/gi, className: 'kw'},
        // Network marker
        {regex: /\b(NETWORK)\b/gi, className: 'function'},
        // NOP
        {regex: /\b(NOP)\b/gi, className: 'kw'},
        // Addresses - Siemens style I, Q, M, T, C and PLCASM style X, Y, K
        {regex: /\b[IQMTCSXYK]\d+(?:\.\d+)?\b/gi, className: 'addr'},
        // Numeric bit addresses (0.0 style)
        {regex: /\b\d+\.\d+\b/g, className: 'addr'},
        // Plain numbers
        {regex: /\b\d+\b/g, className: 'num'},
        // Parentheses for nesting
        {regex: /[()]/g, className: 'dot'},
        // Fallback for symbols/identifiers
        {regex: /[A-Za-z_]\w*/g, className: 'variable'},
    ],
    words: [
        // Bit Logic
        'A', 'AN', 'O', 'ON', 'X', 'XN', 'NOT', 'SET', 'CLR', 'CLEAR',
        // Assign/Set/Reset
        'S', 'R',
        // Edge Detection
        'FP', 'FN',
        // Timers
        'TON', 'TOF', 'TP',
        // Counters
        'CTU', 'CTD', 'CTUD',
        // Load/Transfer
        'L', 'T', 'LD', 'LDN', 'ST',
        // Math
        'MOD', 'NEG', 'ABS',
        // Jumps
        'JU', 'JC', 'JCN', 'JMP', 'JMPC', 'JMPCN',
        // Call/Return
        'CALL', 'BE', 'BEC', 'BEU', 'RET',
        // IEC aliases
        'AND', 'ANDN', 'OR', 'ORN', 'XOR', 'XORN',
        // Other
        'NETWORK', 'NOP',
    ],
})

/* JSON */
MiniCodeEditor.registerLanguage('json', {
    definitions: {},
    rules: [
        // Property names (string followed by colon) - must come before general strings
        {
            regex: /("(?:[^"\\]|\\.)*")(\s*:)/g,
            replace: (match, key, colon) => `<span class="variable">${key}</span>${colon}`
        },
        // String values (double-quoted)
        {regex: /"(?:[^"\\]|\\.)*"/g, className: 'str'},
        // Keywords
        {regex: /\b(true|false|null)\b/g, className: 'kw'},
        // Numbers
        {regex: /-?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, className: 'num'},
        // Braces and brackets
        {regex: /[\[\]{}]/g, className: 'dot'},
        // Commas
        {regex: /,/g, className: 'dot'},
    ],
    words: ['true', 'false', 'null'],
})

export default MiniCodeEditor
