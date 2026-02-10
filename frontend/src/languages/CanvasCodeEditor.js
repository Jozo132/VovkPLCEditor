/* CanvasCodeEditor.js v0.1 - High Performance Canvas-Based Code Editor */

/**
 * @typedef {Object} CCE_Diagnostic
 * @property {'error'|'warning'|'info'} type
 * @property {number} start - Character offset start
 * @property {number} end - Character offset end
 * @property {string} message
 * @property {number} [line] - Optional line number (1-based)
 */

/**
 * @typedef {Object} CCE_Cursor
 * @property {number} line - 0-based line index
 * @property {number} col - 0-based column index
 * @property {number} offset - Character offset in the text
 */

/**
 * @typedef {Object} CCE_Selection
 * @property {CCE_Cursor} start
 * @property {CCE_Cursor} end
 * @property {boolean} isReversed - True if selection was made from right to left
 */

/**
 * @typedef {Object} CCE_Token
 * @property {number} start - Start column in line
 * @property {number} end - End column in line
 * @property {string} type - Token type for styling
 * @property {string} text - Token text
 */

/**
 * @typedef {Object} CCE_Pill
 * @property {number} line - Line index (0-based)
 * @property {number} col - Column position (0-based)
 * @property {number} width - Width in character units
 * @property {string} text - Display text
 * @property {string} [className] - Optional CSS class name
 * @property {any} [data] - Optional associated data
 */

const DEFAULT_OPTIONS = {
    font: '14px Consolas, monospace',
    lineHeight: 1.4,
    tabSize: 4,
    gutterWidth: 48,
    padding: 8,
    colors: {
        background: '#1e1e1e',
        gutter: '#1e1e1e',
        gutterText: '#858585',
        gutterTextActive: '#c6c6c6',
        gutterBorder: '#333',
        text: '#d4d4d4',
        selection: 'rgba(38, 79, 120, 0.6)',
        selectionInactive: 'rgba(150, 150, 150, 0.3)',
        wordHighlight: 'rgba(150, 150, 150, 0.25)',
        cursor: '#aeafad',
        lineHighlight: 'rgba(255, 255, 255, 0.12)',
        errorSquiggle: '#f48771',
        warningSquiggle: '#cca700',
        infoSquiggle: '#75beff',
        pillBackground: '#464646',
        pillBorder: '#464646',
        pillText: '#fff',
        pillOn: '#1fba5f',
        pillOff: 'rgba(200, 200, 200, 0.5)',
        pillSelected: 'rgba(0, 122, 204, 0.5)',
    },
    tokenColors: {
        keyword: '#c586c0',
        number: '#b5cea8',
        string: '#ce9178',
        comment: '#6a9955',
        type: '#4ec9b0',
        function: '#dcdcaa',
        variable: '#9cdcfe',
        operator: '#d4d4d4',
        address: '#d7ba7d',
        default: '#d4d4d4',
    },
    readOnly: false,
}

export class CanvasCodeEditor {
    /**
     * @param {HTMLElement} container
     * @param {Object} options
     */
    constructor(container, options = {}) {
        if (!(container instanceof HTMLElement)) throw new Error('Invalid container element')
        
        this.container = container
        this.options = { ...DEFAULT_OPTIONS, ...options }
        this.options.colors = { ...DEFAULT_OPTIONS.colors, ...options.colors }
        this.options.tokenColors = { ...DEFAULT_OPTIONS.tokenColors, ...options.tokenColors }
        
        // Text state
        this._lines = ['']
        this._version = 0
        
        // Cursor and selection state
        /** @type {CCE_Cursor[]} */
        this._cursors = [{ line: 0, col: 0, offset: 0 }]
        /** @type {CCE_Selection[]} */
        this._selections = []
        
        // Scroll state
        this._scrollX = 0
        this._scrollY = 0
        
        // Metrics (computed on init/resize)
        this._charWidth = 0
        this._lineHeight = 0
        this._visibleLines = 0
        this._visibleCols = 0
        
        // Diagnostics
        /** @type {CCE_Diagnostic[]} */
        this._diagnostics = []
        
        // Pills (inline components)
        /** @type {CCE_Pill[]} */
        this._pills = []
        
        // Selected pill for keyboard interaction
        this._selectedPill = null
        
        // Line gaps cache (pill visual gaps — cleared each render frame)
        this._lineGapsCache = new Map()
        
        // Tokenization cache
        /** @type {Map<number, CCE_Token[]>} */
        this._tokenCache = new Map()
        this._tokenCacheVersion = -1
        
        // Language
        this._language = (options.language || 'text').toLowerCase()
        this._languageRules = CanvasCodeEditor.languages[this._language] || null
        
        // Animation state
        this._cursorVisible = true
        this._cursorBlinkTimer = null
        this._rafId = null
        this._needsRender = true
        
        // Input state
        this._composing = false
        this._mouseDown = false
        this._selectionAnchor = null // Tracks the fixed anchor point for mouse drag selection
        this._blockSelectAnchor = null // Tracks the anchor for Alt+Shift block/column drag selection
        this._lastClickTime = 0
        this._lastClickPos = null
        this._clickCount = 0
        
        // Callbacks
        this._onChange = options.onChange || null
        this._onScroll = options.onScroll || null
        this._lintProvider = options.lintProvider || null
        this._previewEntriesProvider = options.previewEntriesProvider || null
        this._previewValueProvider = options.previewValueProvider || null
        this._onPreviewAction = options.onPreviewAction || null
        this._onPreviewContextMenu = options.onPreviewContextMenu || null
        this._hoverProvider = options.hoverProvider || null
        this._symbolProvider = options.symbolProvider || null
        this._onDiagnosticsChange = options.onDiagnosticsChange || null
        this._onLintHover = options.onLintHover || null
        this._blockId = options.blockId || null
        this._onRenameSymbol = options.onRenameSymbol || null
        this._onGoToDefinition = options.onGoToDefinition || null
        this._editorId = typeof options.editorId === 'number' ? options.editorId : null
        this._programId = options.programId || null
        
        // Hover tooltip state
        this._hoverTimer = null
        this._hoverWord = null
        this._hoverLine = -1
        this._hoverCol = -1
        
        // Lint hover state
        this._lintHoverEntry = null
        
        // Ctrl+hover link highlight state
        this._ctrlDown = false
        this._lastMouse = null
        this._linkHoverTarget = null
        this._linkHighlightRange = null
        
        // Navigation history state
        this._historyTimer = null
        this._historySuppressed = false
        this._lastRecordedLine = null
        
        // Highlight ranges (set externally by problem panel)
        this._hoverHighlightRange = null
        this._selectedHighlightRange = null
        
        // Autocomplete state
        this._acVisible = false
        this._acItems = []
        this._acSelected = 0
        this._acPrefix = ''
        this._autocompleteProvider = options.autocompleteProvider || null
        
        // Lint debounce state
        this._lintTimer = null
        this._lintVersion = 0
        
        // Preview entries cache
        this._previewEntries = []
        this._previewEntriesVersion = -1
        this._lastPreviewRefreshTime = 0
        
        // Build DOM
        this._buildDOM()
        this._measureFont()
        this._setupEvents()
        
        // Initial content
        if (options.value) {
            this.setValue(options.value)
        }
        
        // Start render loop
        this._startRenderLoop()
        this._startCursorBlink()
        
        // Run initial lint
        this._scheduleLint()
    }
    
    // ==========================================================================
    // DOM SETUP
    // ==========================================================================
    
    _buildDOM() {
        const c = this.container
        c.style.position = 'relative'
        c.style.overflow = 'hidden'
        c.style.background = this.options.colors.background
        c.classList.add('cce')
        
        // Inject global styles once
        if (!document.getElementById('cce-styles')) {
            const style = document.createElement('style')
            style.id = 'cce-styles'
            style.textContent = `
                .cce { user-select: none; -webkit-user-select: none; }
                .cce canvas { display: block; }
                .cce-input {
                    position: absolute;
                    left: -9999px;
                    top: 0;
                    width: 1px;
                    height: 1px;
                    opacity: 0;
                    pointer-events: none;
                    font: inherit;
                }
                .cce:focus-within { outline: 1px solid #007acc; outline-offset: -1px; }
                .cce-hover {
                    position: fixed;
                    background: #252526;
                    border: 1px solid #454545;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.4);
                    color: #ccc;
                    font-size: 13px;
                    z-index: 100000;
                    padding: 0;
                    max-width: 400px;
                    display: none;
                    font-family: Consolas, monospace;
                    line-height: 1.4;
                    pointer-events: none;
                }
                .cce-hover-def {
                    font-family: monospace;
                    border-bottom: 1px solid #454545;
                    padding: 6px 10px;
                    background: #1e1e1e;
                    color: #b4b4b4;
                    font-weight: 600;
                }
                .cce-hover-desc {
                    padding: 8px 10px 4px 10px;
                }
                .cce-hover-ex {
                    padding: 4px 10px 8px 10px;
                    font-family: monospace;
                    font-size: 0.9em;
                    color: #ce9178;
                    white-space: pre-wrap;
                }
                .cce-pill-input {
                    position: absolute;
                    display: none;
                    box-sizing: border-box;
                    background: #1e1e1e;
                    border: 1.5px solid #007acc;
                    border-radius: 3px;
                    color: #d4d4d4;
                    padding: 0 4px;
                    outline: none;
                    z-index: 10;
                    box-shadow: 0 0 6px rgba(0, 122, 204, 0.5);
                }
                .cce-ac {
                    position: fixed;
                    z-index: 100001;
                    background: #252526;
                    border: 1px solid #454545;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
                    font-family: Consolas, monospace;
                    font-size: 13px;
                    color: #ccc;
                    max-height: 220px;
                    overflow-y: auto;
                    overflow-x: hidden;
                    min-width: 180px;
                    max-width: 400px;
                    display: none;
                    list-style: none;
                    margin: 0;
                    padding: 0;
                }
                .cce-ac::-webkit-scrollbar { width: 6px; }
                .cce-ac::-webkit-scrollbar-track { background: transparent; }
                .cce-ac::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
                .cce-ac li {
                    padding: 0 8px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    height: 22px;
                    line-height: 22px;
                    white-space: nowrap;
                }
                .cce-ac li:hover { background: #2a2d2e; }
                .cce-ac li.sel { background: #04395e; color: #fff; }
                .cce-ac li .icon {
                    display: inline-block;
                    width: 16px;
                    height: 16px;
                    margin-right: 6px;
                    background-size: contain;
                    background-repeat: no-repeat;
                    background-position: center;
                    flex-shrink: 0;
                }
                .cce-ac li .icon.kw { background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="%23c586c0" d="M14 4h-2a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2h2v-2h-2V6h2V4zM4 12V4h6v8H4z"/></svg>'); }
                .cce-ac li .icon.dt { background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="%234ec9b0" d="M13.5 14h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5zm-11-12a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 2.5 16h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 2h-11z"/></svg>'); }
                .cce-ac li .label { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; }
                .cce-ac li .desc { opacity: 0.6; font-size: 0.85em; margin-left: 10px; flex-shrink: 0; }
                .cce-hint {
                    position: fixed;
                    color: #888;
                    font-size: 13px;
                    font-family: Consolas, monospace;
                    pointer-events: none;
                    z-index: 100001;
                    background: #1e1e1e;
                    padding: 4px 8px;
                    border: 1px solid #333;
                    display: none;
                    border-radius: 3px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                }
            `
            document.head.appendChild(style)
        }
        
        // Main canvas for text rendering
        this._canvas = document.createElement('canvas')
        this._canvas.style.position = 'absolute'
        this._canvas.style.left = '0'
        this._canvas.style.top = '0'
        c.appendChild(this._canvas)
        this._ctx = this._canvas.getContext('2d', { alpha: false })
        
        // Hidden textarea for input handling
        this._input = document.createElement('textarea')
        this._input.className = 'cce-input'
        this._input.setAttribute('autocomplete', 'off')
        this._input.setAttribute('autocorrect', 'off')
        this._input.setAttribute('autocapitalize', 'off')
        this._input.setAttribute('spellcheck', 'false')
        this._input.setAttribute('tabindex', '0')
        c.appendChild(this._input)
        
        // Inline pill edit input
        this._pillInput = document.createElement('input')
        this._pillInput.className = 'cce-pill-input'
        this._pillInput.setAttribute('type', 'text')
        this._pillInput.setAttribute('autocomplete', 'off')
        this._pillInput.setAttribute('spellcheck', 'false')
        c.appendChild(this._pillInput)
        this._pillInputEntry = null
        
        this._pillInput.addEventListener('keydown', (e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
                this._closePillInput()
            } else if (e.key === 'Enter') {
                this._confirmPillInput()
            }
        })
        this._pillInput.addEventListener('blur', () => {
            this._closePillInput()
        })
        
        // Hover tooltip element (appended to body for fixed positioning)
        this._hoverEl = document.createElement('div')
        this._hoverEl.className = 'cce-hover'
        document.body.appendChild(this._hoverEl)
        
        // Autocomplete dropdown (appended to body for fixed positioning)
        this._acEl = document.createElement('ul')
        this._acEl.className = 'cce-ac'
        document.body.appendChild(this._acEl)
        this._acEl.addEventListener('mousedown', e => {
            e.preventDefault()
            const li = e.target.closest('li')
            if (li && li.dataset.val) this._insertAutocomplete(li.dataset.val)
        })
        
        // Hint element for parameter signatures
        this._hintEl = document.createElement('div')
        this._hintEl.className = 'cce-hint'
        document.body.appendChild(this._hintEl)
        
        // Document click to close autocomplete
        this._acDocClick = e => {
            if (!this._acEl.contains(e.target) && e.target !== this._input) {
                this._hideAutocomplete()
            }
        }
        document.addEventListener('mousedown', this._acDocClick)
        
        // Initial size
        this._resize()
        
        // ResizeObserver for container resize
        this._resizeObserver = new ResizeObserver(() => this._resize())
        this._resizeObserver.observe(c)
    }
    
    _measureFont() {
        const ctx = this._ctx
        ctx.font = this.options.font
        const metrics = ctx.measureText('M')
        this._charWidth = metrics.width
        
        // Parse line height from font
        const fontMatch = this.options.font.match(/(\d+)px/)
        const fontSize = fontMatch ? parseInt(fontMatch[1], 10) : 14
        this._lineHeight = Math.ceil(fontSize * this.options.lineHeight)
    }
    
    _resize() {
        const c = this.container
        const rect = c.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        
        this._width = rect.width
        this._height = rect.height
        
        const newW = Math.floor(rect.width * dpr)
        const newH = Math.floor(rect.height * dpr)
        const sizeChanged = this._canvas.width !== newW || this._canvas.height !== newH
        
        if (sizeChanged) {
            this._canvas.width = newW
            this._canvas.height = newH
            this._canvas.style.width = rect.width + 'px'
            this._canvas.style.height = rect.height + 'px'
        }
        
        this._ctx.scale(dpr, dpr)
        this._ctx.font = this.options.font
        
        // Recalculate visible area
        const contentWidth = this._width - this.options.gutterWidth - this.options.padding * 2
        const contentHeight = this._height - this.options.padding * 2
        
        this._visibleLines = Math.ceil(contentHeight / this._lineHeight) + 1
        this._visibleCols = Math.ceil(contentWidth / this._charWidth) + 1
        
        // Render immediately to avoid blank-frame flicker when canvas size changes
        this._render()
        this._needsRender = false
    }
    
    // ==========================================================================
    // EVENT HANDLING
    // ==========================================================================
    
    _setupEvents() {
        const canvas = this._canvas
        const input = this._input
        
        // Focus handling
        canvas.addEventListener('mousedown', (e) => {
            // Only handle primary (left) button — ignore back/forward (3/4), middle (1)
            if (e.button !== 0 && e.button !== 2) return
            e.preventDefault()
            input.focus()
            this._handleMouseDown(e)
        })
        
        canvas.addEventListener('mousemove', (e) => {
            // During drag, let the document listener handle it to avoid double-firing
            if (!this._mouseDown) {
                this._handleHoverMove(e)
            } else {
                this._handleMouseMove(e)
            }
        })
        canvas.addEventListener('mouseleave', () => {
            this._hideHover()
            this._clearLinkHover()
        })
        canvas.addEventListener('mouseup', (e) => this._handleMouseUp(e))
        canvas.addEventListener('wheel', (e) => this._handleWheel(e), { passive: false })
        canvas.addEventListener('dblclick', (e) => this._handleDoubleClick(e))
        canvas.addEventListener('contextmenu', (e) => this._handleContextMenu(e))
        
        // Input events
        input.addEventListener('input', (e) => this._handleInput(e))
        input.addEventListener('keydown', (e) => this._handleKeyDown(e))
        input.addEventListener('compositionstart', () => { this._composing = true })
        input.addEventListener('compositionend', () => { this._composing = false })
        input.addEventListener('paste', (e) => {
            if (this.options.readOnly) return
            e.preventDefault()
            const raw = e.clipboardData?.getData('text/plain')
            if (!raw) return
            // Normalize line endings (Windows clipboard may convert \n → \r\n)
            const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            
            const mc = CanvasCodeEditor._multiCursorClipboard
            if (mc && mc.entries.length === this._cursors.length && mc.joined === text) {
                // Multi-cursor paste: distribute each entry to its corresponding cursor
                this._insertTextPerCursor(mc.entries)
            } else if (mc && mc.entries.length === this._cursors.length && mc.entries.join('\n') === text) {
                // Fallback match (in case joined was stored differently)
                this._insertTextPerCursor(mc.entries)
            } else if (this._cursors.length > 1) {
                // No multi-cursor clipboard match, but we have multiple cursors:
                // split pasted text by lines and distribute if line count matches cursor count
                const lines = text.split('\n')
                if (lines.length === this._cursors.length) {
                    this._insertTextPerCursor(lines)
                } else {
                    this._insertText(text)
                }
            } else {
                // Single cursor: normal paste
                this._insertText(text)
            }
        })
        input.addEventListener('focus', () => { this._needsRender = true; this._startCursorBlink(); this._markActiveEditor() })
        input.addEventListener('blur', (e) => {
            // Don't clear pill selection when focus moves to the pill input overlay
            if (e.relatedTarget === this._pillInput) return
            this._selectedPill = null
            this._needsRender = true
            this._stopCursorBlink()
        })
        
        // Clear block select anchor when Alt or Shift is released
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Alt' || e.key === 'Shift') {
                this._blockSelectAnchor = null
            }
        })
        
        // Ctrl key tracking for link-hover (go to definition)
        this._handleCtrlKey = (e) => {
            const next = !!(e.ctrlKey || e.metaKey)
            if (next === this._ctrlDown) return
            this._ctrlDown = next
            if (!next) {
                this._clearLinkHover()
            } else if (this._lastMouse) {
                this._updateLinkHover(this._lastMouse.x, this._lastMouse.y)
            }
        }
        document.addEventListener('keydown', this._handleCtrlKey)
        document.addEventListener('keyup', this._handleCtrlKey)
        
        // Global mouse events for drag selection
        document.addEventListener('mousemove', (e) => {
            if (this._mouseDown) this._handleMouseMove(e)
        })
        document.addEventListener('mouseup', (e) => {
            if (this._mouseDown) this._handleMouseUp(e)
        })
    }
    
    _handleContextMenu(e) {
        // Check for pill right-click
        const pillEntry = this._getPillAtMouse(e)
        if (pillEntry && this._onPreviewContextMenu) {
            e.preventDefault()
            this._onPreviewContextMenu(pillEntry, e)
            return
        }
        
        // Check for symbol rename context menu
        if (this._onRenameSymbol && this._symbolProvider) {
            const pos = this._getPositionFromMouse(e)
            if (pos) {
                const wordInfo = this._getWordAt(pos)
                if (wordInfo && wordInfo.word) {
                    // Check if word is a known symbol
                    const symbols = this._symbolProvider() || []
                    const isSymbol = symbols.some(s => s.name === wordInfo.word)
                    if (isSymbol) {
                        e.preventDefault()
                        this._onRenameSymbol(wordInfo.word, e)
                    }
                }
            }
        }
    }
    
    _handleDblClick(e) {
        // Double-click on pill — for non-bit pills, open inline edit overlay
        const pillEntry = this._getPillAtMouse(e)
        if (pillEntry) {
            e.preventDefault()
            e.stopPropagation()
            this._selectedPill = pillEntry
            this._selections = []
            if (this._cursors.length > 1) this._cursors = [this._cursors[0]]
            this._needsRender = true
            
            // Determine if pill is a bit type
            let pillClass = ''
            if (this._previewValueProvider) {
                const val = this._previewValueProvider(pillEntry)
                if (val && typeof val === 'object') pillClass = val.className || ''
            }
            const isBit = pillClass.includes('bit')
            
            if (!isBit) {
                // Non-bit pill: open inline input overlay
                this._openPillInput(pillEntry)
            } else if (this._onPreviewContextMenu) {
                // Bit pill: open context menu as before
                this._onPreviewContextMenu(pillEntry, e)
            }
            return true
        }
        return false
    }
    
    _handlePillKeyDown(e) {
        const key = e.key
        const pill = this._selectedPill
        if (!pill) return
        
        if (key === 'Escape') {
            this._selectedPill = null
            this._needsRender = true
            return
        }
        
        // Resolve pill class to check if it's a bit
        let pillClass = ''
        if (this._previewValueProvider) {
            const val = this._previewValueProvider(pill)
            if (val && typeof val === 'object') {
                pillClass = val.className || ''
            }
        }
        const isBit = pillClass.includes('bit')
        
        let action = null
        if (isBit) {
            if (key === '1') action = 'set'
            else if (key === '0') action = 'reset'
            else if (key === 'Enter' || key === ' ') action = 'toggle'
        } else {
            if (key === 'Enter' || key === ' ') {
                // Open inline input overlay for non-bit pills
                this._openPillInput(pill)
                return
            }
        }
        
        if (action && this._onPreviewAction) {
            this._onPreviewAction(pill, action)
        }
    }
    
    _handleMouseDown(e) {
        // Close pill input overlay and hover on any mouse click
        if (this._pillInputEntry) this._closePillInput()
        this._hideHover()
        
        // Ctrl+click: go to definition
        if (e.ctrlKey || e.metaKey) {
            const pos = this._getPositionFromMouse(e)
            if (pos) {
                const target = this._linkHoverTarget || this._resolveDefinition(this._getWordAt(pos))
                if (target) {
                    e.preventDefault()
                    e.stopPropagation()
                    this._clearLinkHover()
                    this._goToDefinition(target)
                    this._mouseDown = false
                    return
                }
            }
        }
        
        // Check for pill click — single click selects the pill, deselects text
        const pillEntry = this._getPillAtMouse(e)
        if (pillEntry) {
            e.preventDefault()
            e.stopPropagation()
            this._selectedPill = pillEntry
            // Clear all text selections and multi-cursors
            this._selections = []
            if (this._cursors.length > 1) {
                this._cursors = [this._cursors[0]]
            }
            this._needsRender = true
            return
        }
        
        // Clicking text deselects any selected pill
        if (this._selectedPill) {
            this._selectedPill = null
            this._needsRender = true
        }
        
        const pos = this._getPositionFromMouse(e)
        if (!pos) return
        
        const now = Date.now()
        const isDoubleClick = (now - this._lastClickTime < 300) && 
            this._lastClickPos?.line === pos.line && 
            Math.abs(this._lastClickPos.col - pos.col) < 2
        
        this._lastClickTime = now
        this._lastClickPos = pos
        this._mouseDown = true
        
        if (isDoubleClick) {
            this._clickCount = 2
            if (e.altKey) {
                // Alt+double-click: add word selection to multi-select
                this._addWordSelection(pos)
                this._selectionAnchor = null
                this._blockSelectAnchor = null
            } else {
                this._selectWordAt(pos)
                this._selectionAnchor = null
                this._blockSelectAnchor = null
            }
        } else {
            this._clickCount = 1
            if (e.altKey && e.shiftKey) {
                // Block/column selection: keep anchor from first click, only update target
                // On first Shift+Alt click, use existing cursor position as anchor
                // Use unclamped column so the box extends to the mouse position
                const blockPos = this._getPositionFromMouse(e, false)
                if (!this._blockSelectAnchor) {
                    this._blockSelectAnchor = { ...this._cursors[0] }
                }
                this._blockSelect(this._blockSelectAnchor, blockPos)
            } else if (e.shiftKey && this._cursors.length === 1) {
                // Extend selection from current cursor position
                this._selectionAnchor = { ...this._cursors[0] }
                this._extendSelection(pos)
                this._blockSelectAnchor = null
            } else if (e.altKey) {
                // Add cursor with anchor for potential drag selection
                const prevCount = this._cursors.length
                this._addCursor(pos)
                // Only set anchor if a cursor was added (not toggled off)
                this._selectionAnchor = this._cursors.length > prevCount ? { ...pos } : null
                this._blockSelectAnchor = null
            } else {
                // Single cursor - set anchor for potential drag
                this._setCursor(pos)
                this._selectionAnchor = { ...pos }
                this._blockSelectAnchor = null
            }
        }
        
        this._needsRender = true
    }
    
    _handleMouseMove(e) {
        if (!this._mouseDown) return
        
        if (this._blockSelectAnchor) {
            // Dynamic block/column selection during drag — use unclamped column
            const pos = this._getPositionFromMouse(e, false)
            if (!pos) return
            this._blockSelect(this._blockSelectAnchor, pos)
            this._needsRender = true
            return
        }
        
        const pos = this._getPositionFromMouse(e)
        if (!pos) return
        
        if (!this._selectionAnchor) return // No anchor = no drag selection
        
        // Don't create a selection until the mouse moves to a different character cell
        if (pos.line === this._selectionAnchor.line && pos.col === this._selectionAnchor.col) {
            // Mouse hasn't moved to a new position — collapse the in-progress selection for this cursor
            const lastSel = this._selections.length > 0 ? this._selections[this._selections.length - 1] : null
            if (lastSel && lastSel.start.offset === this._selectionAnchor.offset) {
                this._selections.pop()
                this._needsRender = true
            }
            return
        }
        
        this._extendSelection(pos)
        this._needsRender = true
    }
    
    _handleMouseUp(e) {
        this._mouseDown = false
        // Don't clear _blockSelectAnchor here — it persists while Shift+Alt is held
        // Merge overlapping cursors and selections after drag completes
        this._mergeCursors()
        this._markActiveEditor()
        this._scheduleHistory()
    }
    
    _handleDoubleClick(e) {
        // Check pill double-click — opens context menu
        this._handleDblClick(e)
    }
    
    _handleWheel(e) {
        // Close pill input overlay, hover and autocomplete on scroll
        if (this._pillInputEntry) this._closePillInput()
        this._hideHover()
        this._hideAutocomplete()
        this._clearLinkHover()
        
        const deltaX = e.deltaX
        const deltaY = e.deltaY
        
        const maxScrollY = Math.max(0, this._lines.length * this._lineHeight - this._height + this.options.padding * 2)
        const oldScrollX = this._scrollX
        const oldScrollY = this._scrollY
        
        // Compute new scroll positions
        const newScrollX = Math.max(0, this._scrollX + deltaX)
        const newScrollY = Math.max(0, Math.min(this._scrollY + deltaY, maxScrollY))
        
        // If scroll didn't change (at limit), let the event propagate to parent
        if (newScrollX === oldScrollX && newScrollY === oldScrollY) return
        
        e.preventDefault()
        
        this._scrollX = newScrollX
        this._scrollY = newScrollY
        
        this._needsRender = true
        
        if (this._onScroll) {
            this._onScroll({ top: this._scrollY, left: this._scrollX })
        }
    }
    
    _handleInput(e) {
        if (this._composing) return
        if (this.options.readOnly) return
        
        const text = this._input.value
        if (text) {
            this._insertText(text)
            this._input.value = ''
            this._triggerAutocomplete(false)
            this._scheduleHistory()
        }
    }
    
    _handleKeyDown(e) {
        // F12: go to definition of word at cursor
        if (e.key === 'F12') {
            const target = this._resolveDefinition(this._getWordAt(this._cursors[0]))
            if (target) {
                e.preventDefault()
                this._goToDefinition(target)
            }
            return
        }
        
        // Handle keys when a pill is selected (even in readOnly mode)
        if (this._selectedPill) {
            e.preventDefault()
            e.stopPropagation()
            this._handlePillKeyDown(e)
            return
        }
        
        // Autocomplete navigation — intercept before other handlers
        if (this._acVisible) {
            const acKeys = ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape']
            if (acKeys.includes(e.key)) {
                e.preventDefault()
                e.stopPropagation()
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    const items = this._acEl.children
                    if (items.length > 0) {
                        items[this._acSelected]?.classList.remove('sel')
                        this._acSelected = (this._acSelected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                        items[this._acSelected]?.classList.add('sel')
                        items[this._acSelected]?.scrollIntoView({ block: 'nearest' })
                    }
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                    const sel = this._acEl.children[this._acSelected]
                    if (sel && sel.dataset.val) this._insertAutocomplete(sel.dataset.val)
                } else if (e.key === 'Escape') {
                    this._hideAutocomplete()
                }
                return
            }
            // Close AC on non-typing, non-nav keys
            const isTyping = e.key.length === 1 || e.key === 'Backspace'
            const isModifier = ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)
            if (!isTyping && !isModifier) {
                this._hideAutocomplete()
            }
        }
        
        // Ctrl+Space to force trigger autocomplete
        if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
            e.preventDefault()
            this._triggerAutocomplete(true)
            return
        }
        
        if (this.options.readOnly && !this._isNavigationKey(e)) {
            if (!e.ctrlKey && !e.metaKey) return
        }
        
        const ctrl = e.ctrlKey || e.metaKey
        const shift = e.shiftKey
        const alt = e.altKey
        
        let handled = true
        
        switch (e.key) {
            case 'ArrowLeft':
                this._hideAutocomplete()
                this._moveCursors('left', shift, ctrl)
                break
            case 'ArrowRight':
                this._hideAutocomplete()
                this._moveCursors('right', shift, ctrl)
                break
            case 'ArrowUp':
                if (alt && shift && !this.options.readOnly) {
                    this._duplicateSelectedLines(1)
                } else if (alt && !this.options.readOnly) {
                    this._moveSelectedLines(-1)
                } else {
                    this._moveCursors('up', shift)
                }
                break
            case 'ArrowDown':
                if (alt && shift && !this.options.readOnly) {
                    this._duplicateSelectedLines(-1)
                } else if (alt && !this.options.readOnly) {
                    this._moveSelectedLines(1)
                } else {
                    this._moveCursors('down', shift)
                }
                break
            case 'Home':
                this._moveCursors('lineStart', shift, ctrl)
                break
            case 'End':
                this._moveCursors('lineEnd', shift, ctrl)
                break
            case 'PageUp':
                this._moveCursors('pageUp', shift)
                break
            case 'PageDown':
                this._moveCursors('pageDown', shift)
                break
            case 'Enter':
                if (!this.options.readOnly) {
                    this._insertText('\n')
                }
                break
            case 'Backspace':
                if (!this.options.readOnly) {
                    this._deleteBackward(ctrl)
                    this._triggerAutocomplete(false)
                }
                break
            case 'Delete':
                if (!this.options.readOnly) {
                    this._deleteForward(ctrl)
                }
                break
            case 'Tab':
                if (ctrl || alt) {
                    handled = false
                } else if (!this.options.readOnly) {
                    if (shift) {
                        this._outdentLines()
                    } else {
                        this._indentOrTab()
                    }
                }
                break
            case 'a':
                if (ctrl) {
                    this._selectAll()
                } else {
                    handled = false
                }
                break
            case 'c':
                if (ctrl) {
                    this._copy()
                } else {
                    handled = false
                }
                break
            case 'x':
                if (ctrl && !this.options.readOnly) {
                    this._cut()
                } else {
                    handled = false
                }
                break
            case 'v':
                if (ctrl && !this.options.readOnly) {
                    // Let the paste event on the input handle it
                    handled = false
                } else {
                    handled = false
                }
                break
            case 'z':
                if (ctrl && !this.options.readOnly) {
                    if (shift) {
                        this._redo()
                    } else {
                        this._undo()
                    }
                } else {
                    handled = false
                }
                break
            case 'y':
                if (ctrl && !this.options.readOnly) {
                    this._redo()
                } else {
                    handled = false
                }
                break
            case 'd':
                if (ctrl && !this.options.readOnly) {
                    this._duplicateLine()
                } else {
                    handled = false
                }
                break
            case 'Escape':
                this._clearSecondarySelections()
                break
            default:
                handled = false
        }
        
        if (handled) {
            e.preventDefault()
            e.stopPropagation()
            this._needsRender = true
            this._scheduleHistory()
        }
    }
    
    _isNavigationKey(e) {
        const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 
                         'Home', 'End', 'PageUp', 'PageDown']
        return navKeys.includes(e.key) || (e.ctrlKey && ['a', 'c'].includes(e.key))
    }
    
    // ==========================================================================
    // POSITION CALCULATIONS
    // ==========================================================================
    
    _getPositionFromMouse(e, clampCol = true) {
        const rect = this._canvas.getBoundingClientRect()
        const x = e.clientX - rect.left - this.options.gutterWidth - this.options.padding + this._scrollX
        const y = e.clientY - rect.top - this.options.padding + this._scrollY
        
        let line = Math.floor(y / this._lineHeight)
        line = Math.max(0, Math.min(line, this._lines.length - 1))
        
        // Convert visual column to text column, skipping gaps
        const gaps = this._getLineGaps(line)
        const visualCol = Math.round(x / this._charWidth)
        let col = this._visualToTextCol(Math.max(0, visualCol), gaps)
        col = Math.max(0, col)
        if (clampCol) {
            col = Math.min(col, this._lines[line].length)
        }
        
        const offset = this._getOffset(line, Math.min(col, this._lines[line].length))
        
        return { line, col, offset }
    }
    
    _getOffset(line, col) {
        let offset = 0
        for (let i = 0; i < line && i < this._lines.length; i++) {
            offset += this._lines[i].length + 1 // +1 for newline
        }
        offset += Math.min(col, this._lines[line]?.length || 0)
        return offset
    }
    
    _getPositionFromOffset(offset) {
        let remaining = offset
        for (let line = 0; line < this._lines.length; line++) {
            const lineLen = this._lines[line].length
            if (remaining <= lineLen) {
                return { line, col: remaining, offset }
            }
            remaining -= lineLen + 1 // +1 for newline
        }
        // Past end - return last position
        const lastLine = this._lines.length - 1
        return { 
            line: lastLine, 
            col: this._lines[lastLine].length,
            offset: this._getText().length
        }
    }
    
    _getPillAtMouse(e) {
        if (!this._previewEntriesProvider) return null
        
        const rect = this._canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top
        
        const opts = this.options
        const contentX = opts.gutterWidth + opts.padding
        const baseY = opts.padding - (this._scrollY % this._lineHeight)
        const firstVisibleLine = Math.floor(this._scrollY / this._lineHeight)
        
        // Determine which line was clicked
        const relY = mouseY - opts.padding + (this._scrollY % this._lineHeight)
        const lineIndex = firstVisibleLine + Math.floor(relY / this._lineHeight)
        
        if (lineIndex < 0 || lineIndex >= this._lines.length) return null
        
        const entries = this._getPreviewEntriesForLine(lineIndex)
        if (!entries || entries.length === 0) return null
        
        const lineY = baseY + (lineIndex - firstVisibleLine) * this._lineHeight
        const x = contentX - this._scrollX
        const charW = this._charWidth
        const lineH = this._lineHeight
        
        const compact = this._lines.length <= 1
        const pillHeight = compact ? 12 : 14
        const gaps = this._getLineGaps(lineIndex)
        
        // Check each pill
        for (const entry of entries) {
            const tokenLen = entry.end - entry.start
            const insertAt = entry.col + tokenLen
            const thisGap = gaps.find(g => g.insertAt === insertAt)
            const pillCols = thisGap ? thisGap.pillCols : 4
            const pillWidth = pillCols * charW
            const gapStartVCol = thisGap
                ? this._textToVisualCol(insertAt, gaps) - thisGap.widthCols
                : insertAt
            const pillX = x + (gapStartVCol + 0.5) * charW
            const pillY = lineY + (lineH - pillHeight) / 2
            
            if (mouseX >= pillX && mouseX <= pillX + pillWidth &&
                mouseY >= pillY && mouseY <= pillY + pillHeight) {
                return entry
            }
        }
        
        return null
    }
    
    /** Compute the pill's bounding rect in container-relative coordinates */
    _getPillRect(entry) {
        const opts = this.options
        const contentX = opts.gutterWidth + opts.padding
        const baseY = opts.padding - (this._scrollY % this._lineHeight)
        const firstVisibleLine = Math.floor(this._scrollY / this._lineHeight)
        
        // Derive line and col from the entry offset
        const pos = this._getPositionFromOffset(entry.start)
        const lineIndex = pos.line
        const col = entry.col ?? pos.col
        if (lineIndex < firstVisibleLine) return null
        
        const lineY = baseY + (lineIndex - firstVisibleLine) * this._lineHeight
        const x = contentX - this._scrollX
        const charW = this._charWidth
        const lineH = this._lineHeight
        const compact = this._lines.length <= 1
        const pillHeight = compact ? 12 : 14
        const pillFontSize = compact ? 9 : 10
        
        const gaps = this._getLineGaps(lineIndex)
        const tokenLen = entry.end - entry.start
        const insertAt = col + tokenLen
        const thisGap = gaps.find(g => g.insertAt === insertAt)
        const pillCols = thisGap ? thisGap.pillCols : Math.max(4, Math.ceil(32 / charW))
        const pillWidth = pillCols * charW
        const gapStartVCol = thisGap
            ? this._textToVisualCol(insertAt, gaps) - thisGap.widthCols
            : insertAt
        const pillX = x + (gapStartVCol + 0.5) * charW
        const pillY = lineY + (lineH - pillHeight) / 2
        
        // Measure pill text for the input overlay
        const ctx = this._ctx
        ctx.font = `${pillFontSize}px Consolas, monospace`
        let pillText = ''
        if (this._previewValueProvider) {
            const val = this._previewValueProvider(entry)
            if (val && typeof val === 'object') pillText = val.text ?? ''
            else if (val != null) pillText = String(val)
        }
        ctx.font = opts.font // restore
        
        return { x: pillX, y: pillY, width: pillWidth, height: pillHeight, text: pillText, fontSize: pillFontSize }
    }
    
    /** Open inline input overlay on top of a pill for value editing */
    _openPillInput(entry) {
        const rect = this._getPillRect(entry)
        if (!rect) return
        
        const inp = this._pillInput
        const minWidth = Math.max(rect.width + 40, 80)
        inp.style.left = `${rect.x - 2}px`
        inp.style.top = `${rect.y - 2}px`
        inp.style.width = `${minWidth}px`
        inp.style.height = `${rect.height + 4}px`
        inp.style.font = `${rect.fontSize}px Consolas, monospace`
        inp.style.display = 'block'
        inp.value = rect.text
        this._pillInputEntry = entry
        
        // Focus and select all text
        requestAnimationFrame(() => {
            inp.focus()
            inp.select()
        })
    }
    
    /** Close the inline pill input overlay without taking action */
    _closePillInput() {
        if (this._pillInput.style.display === 'none') return
        this._pillInput.style.display = 'none'
        this._pillInput.value = ''
        this._pillInputEntry = null
        // Return focus to the main editor input
        this._input.focus()
    }
    
    /** Confirm the inline pill input value and dispatch the edit action */
    _confirmPillInput() {
        const entry = this._pillInputEntry
        const newValue = this._pillInput.value.trim()
        this._pillInput.style.display = 'none'
        this._pillInput.value = ''
        this._pillInputEntry = null
        
        if (entry && newValue && this._onPreviewAction) {
            this._onPreviewAction(entry, 'edit-confirm', newValue)
        }
        
        // Return focus to the main editor input
        this._input.focus()
    }
    
    // ==========================================================================
    // HOVER TOOLTIP
    // ==========================================================================
    
    /** Handle mouse movement for hover tooltip (non-drag) */
    _handleHoverMove(e) {
        // Track last mouse position for Ctrl key toggling
        this._lastMouse = { x: e.clientX, y: e.clientY }
        
        // Update Ctrl+hover link highlight
        if (this._ctrlDown) {
            this._updateLinkHover(e.clientX, e.clientY)
        } else {
            this._clearLinkHover()
        }
        
        // Cancel pending hover
        if (this._hoverTimer) {
            clearTimeout(this._hoverTimer)
            this._hoverTimer = null
        }
        
        // Get position under mouse
        const pos = this._getPositionFromMouse(e)
        if (!pos) { this._hideHover(); return }
        
        // Check if hovering over a diagnostic (lint) squiggle — takes priority
        if (this._diagnostics.length > 0) {
            const offset = pos.offset
            const lintHit = this._diagnostics.find(d => offset >= d.start && offset < d.end)
            if (lintHit) {
                // If already showing this lint tooltip, keep it
                if (this._lintHoverEntry === lintHit) return
                this._hideHover()
                this._showLintHoverAt(e.clientX, e.clientY, lintHit)
                return
            }
        }
        
        // Clear lint hover if we left the squiggle
        if (this._lintHoverEntry) {
            this._clearLintHover()
        }
        
        // If mouse is over the same word, keep existing tooltip
        if (pos.line === this._hoverLine && pos.col === this._hoverCol) return
        this._hoverLine = pos.line
        this._hoverCol = pos.col
        
        // Extract word under mouse
        const wordInfo = this._getHoverWordAt(pos)
        if (!wordInfo || !wordInfo.word) {
            this._hideHover()
            return
        }
        
        // If same word, keep tooltip
        if (wordInfo.word === this._hoverWord) return
        
        // Hide current, schedule new
        this._hideHover()
        this._hoverTimer = setTimeout(() => {
            this._hoverTimer = null
            this._showHoverAt(e.clientX, e.clientY, wordInfo.word)
        }, 400)
    }
    
    /** Get extended word at position (includes dots, %, # for addresses/time literals) */
    _getHoverWordAt(pos) {
        const line = this._lines[pos.line]
        if (!line) return null
        
        let col = pos.col
        if (col >= line.length) col = line.length - 1
        if (col < 0) return null
        
        const isHoverChar = (ch) => /[a-zA-Z0-9_.%#]/.test(ch)
        
        if (!isHoverChar(line[col])) return null
        
        let start = col
        let end = col
        while (start > 0 && isHoverChar(line[start - 1])) start--
        while (end < line.length && isHoverChar(line[end])) end++
        
        const word = line.slice(start, end)
        if (!word) return null
        return { word, line: pos.line, startCol: start, endCol: end }
    }
    
    /** Show hover tooltip at screen coordinates */
    _showHoverAt(clientX, clientY, word) {
        if (!this._hoverProvider) return
        
        let html = null
        try {
            const result = this._hoverProvider(word)
            if (typeof result === 'string') html = result
        } catch (e) { console.error('[CCE] hoverProvider error:', e) }
        
        if (!html) { this._hideHover(); return }
        
        this._hoverWord = word
        const hov = this._hoverEl
        hov.innerHTML = html
        hov.style.display = 'block'
        
        // Position near mouse, smart-fit to viewport
        let left = clientX + 10
        let top = clientY + 10
        hov.style.left = left + 'px'
        hov.style.top = top + 'px'
        
        const box = hov.getBoundingClientRect()
        const winW = window.innerWidth
        const winH = window.innerHeight
        
        if (box.right > winW) left = clientX - box.width - 10
        if (left < 0) left = 0
        if (box.bottom > winH) top = clientY - box.height - 10
        if (top < 0) top = 0
        
        hov.style.left = left + 'px'
        hov.style.top = top + 'px'
    }
    
    /** Hide hover tooltip */
    _hideHover() {
        if (this._hoverTimer) {
            clearTimeout(this._hoverTimer)
            this._hoverTimer = null
        }
        this._hoverWord = null
        this._hoverLine = -1
        this._hoverCol = -1
        if (this._hoverEl) {
            this._hoverEl.style.display = 'none'
            this._hoverEl.innerHTML = ''
        }
    }
    
    // ==========================================================================
    // CTRL+HOVER LINK HIGHLIGHT (GO TO DEFINITION)
    // ==========================================================================
    
    /** Resolve a word to a navigable definition target (label or symbol) */
    _resolveDefinition(wordInfo) {
        if (!wordInfo || !wordInfo.word) return null
        
        // Check label definitions (e.g. "myLabel:" in source)
        const text = this._getText()
        const re = /^\s*([A-Za-z_]\w*):/gm
        let match
        while ((match = re.exec(text))) {
            const label = match[1]
            if (label === wordInfo.word) {
                const labelOffset = match.index + match[0].indexOf(label)
                return { type: 'label', name: wordInfo.word, index: labelOffset, wordInfo }
            }
        }
        
        // Check known symbols from symbolProvider
        if (this._symbolProvider) {
            const symbols = this._symbolProvider('symbol') || []
            const normalizedList = symbols
                .map(item => (typeof item === 'string' ? item : item?.name))
                .filter(Boolean)
            if (normalizedList.includes(wordInfo.word)) {
                return { type: 'symbol', name: wordInfo.word, wordInfo }
            }
        }
        
        return null
    }
    
    /** Update the Ctrl+hover link highlight at mouse position */
    _updateLinkHover(clientX, clientY) {
        const pos = this._getPositionFromMouse({ clientX, clientY })
        if (!pos) { this._clearLinkHover(); return }
        
        const wordInfo = this._getWordAt(pos)
        const target = this._resolveDefinition(wordInfo)
        if (!target) { this._clearLinkHover(); return }
        
        // Compute the offset range of the word for rendering the underline
        const startOffset = this._getOffset(wordInfo.line, wordInfo.startCol)
        const endOffset = this._getOffset(wordInfo.line, wordInfo.endCol)
        
        this._linkHoverTarget = target
        this._linkHighlightRange = { start: startOffset, end: endOffset }
        this._canvas.style.cursor = 'pointer'
        this._needsRender = true
    }
    
    /** Clear the Ctrl+hover link highlight */
    _clearLinkHover() {
        if (!this._linkHoverTarget && !this._linkHighlightRange) return
        this._linkHoverTarget = null
        this._linkHighlightRange = null
        this._canvas.style.cursor = ''
        this._needsRender = true
    }
    
    /** Navigate to the definition of a resolved target */
    _goToDefinition(target) {
        if (!target) return
        // Record current position before navigating away
        this._recordHistory()
        if (target.type === 'label') {
            const pos = typeof target.index === 'number' ? target.index : null
            if (pos === null) return
            const posObj = this._getPositionFromOffset(pos)
            this._cursors = [posObj]
            this._selections = []
            this._needsRender = true
            this._updateCursorSnapshot()
            this._ensureCursorVisible()
            this._input.focus()
            // Record the destination too
            this._suppressHistory(120)
            this._recordHistory()
        } else if (target.type === 'symbol') {
            if (typeof this._onGoToDefinition === 'function') {
                this._onGoToDefinition({ type: 'symbol', name: target.name, blockId: this._blockId })
            }
        }
    }
    
    /** Render the link underline highlight on canvas */
    _renderLinkHighlight(ctx, firstLine, lastLine, contentX, baseY) {
        const range = this._linkHighlightRange
        if (!range || typeof range.start !== 'number' || typeof range.end !== 'number') return
        
        const startPos = this._getPositionFromOffset(range.start)
        const endPos = this._getPositionFromOffset(range.end)
        
        const lh = this._lineHeight
        const cw = this._charWidth
        
        ctx.fillStyle = '#4daafc'
        ctx.globalAlpha = 0.9
        
        for (let i = Math.max(startPos.line, firstLine); i <= Math.min(endPos.line, lastLine); i++) {
            const line = this._lines[i]
            const gaps = this._getLineGaps(i)
            
            const segStart = (i === startPos.line) ? startPos.col : 0
            const segEnd = (i === endPos.line) ? endPos.col : line.length
            if (segEnd <= segStart) continue
            
            const vStart = this._textToVisualCol(segStart, gaps)
            const vEnd = this._textToVisualCol(segEnd, gaps)
            
            const x = contentX + vStart * cw - this._scrollX
            const y = baseY + (i - firstLine) * lh + lh - 2
            const w = Math.max((vEnd - vStart) * cw, cw)
            
            ctx.fillRect(x, y, w, 2)
        }
        
        ctx.globalAlpha = 1.0
    }
    
    // ==========================================================================
    // NAVIGATION HISTORY
    // ==========================================================================
    
    /** Get the nav history instance from the global nav state */
    _getNavHistory() {
        if (this._editorId === null) return null
        const root = typeof window !== 'undefined' ? window : globalThis
        const navState = root.__vovkPlcNavState
        if (!navState) return null
        const editor = navState.editors?.get(this._editorId)
        return editor?._nav_history || null
    }
    
    /** Whether nav history tracking is possible */
    _canTrackHistory() {
        return !!(this._programId && this._blockId && this._getNavHistory())
    }
    
    /** Mark this editor instance as active in global nav state */
    _markActiveEditor() {
        if (this._editorId === null) return
        const root = typeof window !== 'undefined' ? window : globalThis
        const navState = root.__vovkPlcNavState
        if (navState) navState.activeEditorId = this._editorId
    }
    
    /** Immediately record the current cursor position in nav history */
    _recordHistory() {
        if (!this._canTrackHistory() || this._historySuppressed) return
        const history = this._getNavHistory()
        if (!history) return
        const cursor = this._cursors[0]
        if (!cursor) return
        const line = cursor.line + 1 // 1-based line for history
        if (line === this._lastRecordedLine) return
        this._lastRecordedLine = line
        // Always compute offset fresh from line/col to avoid stale/undefined values
        const offset = typeof cursor.offset === 'number'
            ? cursor.offset
            : this._getOffset(cursor.line, cursor.col)
        history.push({
            type: 'code',
            editorId: this._editorId,
            programId: this._programId,
            blockId: this._blockId,
            index: offset,
            line,
        })
    }
    
    /** Schedule a debounced history record (500ms) */
    _scheduleHistory() {
        if (!this._canTrackHistory() || this._historySuppressed) return
        this._markActiveEditor()
        if (this._historyTimer) clearTimeout(this._historyTimer)
        this._historyTimer = setTimeout(() => {
            this._historyTimer = null
            this._recordHistory()
        }, 500)
    }
    
    /** Suppress history recording temporarily (used when restoring from nav) */
    _suppressHistory(duration = 120) {
        if (!this._canTrackHistory()) return
        this._historySuppressed = true
        if (this._historyTimer) {
            clearTimeout(this._historyTimer)
            this._historyTimer = null
        }
        const cursor = this._cursors[0]
        if (cursor) this._lastRecordedLine = cursor.line + 1
        setTimeout(() => {
            this._historySuppressed = false
        }, duration)
    }
    
    /** Show a lint diagnostic tooltip at screen coordinates */
    _showLintHoverAt(clientX, clientY, diag, opts = {}) {
        if (!diag) return
        const total = this._diagnostics.length
        const idx = this._diagnostics.indexOf(diag)
        const indexLabel = idx >= 0 && total > 0 ? ` (${idx + 1}/${total})` : ''
        const label = diag.type === 'warning' ? 'Warning' : diag.type === 'info' ? 'Info' : 'Error'
        
        const hov = this._hoverEl
        hov.innerHTML = `<div class="cce-hover-def">${label}${indexLabel}</div>` +
            (diag.message ? `<div class="cce-hover-desc">${diag.message}</div>` : '')
        hov.style.display = 'block'
        
        // Position near the squiggle start
        const startPos = this._getPositionFromOffset(diag.start)
        const canvasRect = this._canvas.getBoundingClientRect()
        const gaps = this._getLineGaps(startPos.line)
        const visualCol = this._textToVisualCol(startPos.col, gaps)
        
        let left = canvasRect.left + this.options.gutterWidth + this.options.padding + visualCol * this._charWidth - this._scrollX
        let top = canvasRect.top + this.options.padding + (startPos.line * this._lineHeight) - this._scrollY
        
        // Position above the line
        top -= 6
        hov.style.left = left + 'px'
        hov.style.top = top + 'px'
        
        const box = hov.getBoundingClientRect()
        top = top - box.height
        if (top < 0) top = canvasRect.top + this.options.padding + ((startPos.line + 1) * this._lineHeight) - this._scrollY + 4
        if (box.right > window.innerWidth) left = left - box.width
        if (left < 0) left = 0
        
        hov.style.left = left + 'px'
        hov.style.top = top + 'px'
        
        // Track lint hover entry and set highlight
        const prevEntry = this._lintHoverEntry
        this._lintHoverEntry = diag
        
        if (opts.highlight !== false) {
            this._hoverHighlightRange = { start: diag.start, end: diag.end }
            this._needsRender = true
        }
        
        // Notify problem panel
        if (opts.notify !== false && this._onLintHover) {
            if (prevEntry && prevEntry !== diag) {
                this._onLintHover({ state: 'leave', diagnostic: prevEntry, blockId: this._blockId })
            }
            if (prevEntry !== diag) {
                this._onLintHover({ state: 'enter', diagnostic: diag, blockId: this._blockId })
            }
        }
    }
    
    /** Clear lint hover state */
    _clearLintHover() {
        const prevEntry = this._lintHoverEntry
        this._lintHoverEntry = null
        this._hoverHighlightRange = null
        this._needsRender = true
        
        if (this._hoverEl) {
            this._hoverEl.style.display = 'none'
            this._hoverEl.innerHTML = ''
        }
        
        if (prevEntry && this._onLintHover) {
            this._onLintHover({ state: 'leave', diagnostic: prevEntry, blockId: this._blockId })
        }
    }
    
    // ==========================================================================
    // AUTOCOMPLETE
    // ==========================================================================
    
    _getAutocompleteContext() {
        if (this._cursors.length !== 1) return null
        const cursor = this._cursors[0]
        const line = this._lines[cursor.line] || ''
        const lineText = line.slice(0, cursor.col)
        
        // Extract the word prefix at cursor (include dots for definition-based languages like ASM)
        const lang = this._languageRules
        const prefixRegex = lang?.definitions ? /[A-Za-z_][\w.]*$/ : /[A-Za-z_]\w*$/
        const prefixMatch = prefixRegex.exec(lineText)
        const prefix = prefixMatch ? prefixMatch[0] : ''
        
        // Simple context: first token on line for command, count args
        const trimmed = lineText.trimStart()
        const trailingSpace = /\s$/.test(lineText)
        const tokens = trimmed.split(/[\s,]+/).filter(t => t)
        
        if (!trimmed) return { cmd: null, argIndex: 0, prefix: '', lineText }
        
        let argIndex = tokens.length - 1
        if (trailingSpace) {
            argIndex++
        }
        
        return { cmd: tokens[0], argIndex, prefix, lineText }
    }
    
    _triggerAutocomplete(force = false) {
        const lang = this._languageRules
        if (!lang) return this._hideAutocomplete()
        
        const ctx = this._getAutocompleteContext()
        if (!ctx) return this._hideAutocomplete()
        
        let list = []
        let helpText = ''
        
        // Definition-based autocomplete (instruction lookup)
        if (lang.definitions) {
            if (ctx.argIndex === 0) {
                if (!force && !ctx.prefix) return this._hideAutocomplete()
                
                let options = []
                const p = ctx.prefix
                const tree = lang.originalDefinitions || lang.definitions
                
                // Hierarchical lookup for dotted names
                if (p.includes('.')) {
                    const parts = p.split('.')
                    const root = parts[0]
                    const prop = parts.length > 1 ? parts.slice(1).join('.') : ''
                    const rootKey = Object.keys(tree).find(k => k.toLowerCase() === root.toLowerCase())
                    
                    if (rootKey && !Array.isArray(tree[rootKey])) {
                        const childOps = Object.keys(tree[rootKey])
                        options = childOps.map(k => {
                            const val = tree[rootKey][k]
                            let params = ''
                            if (Array.isArray(val)) params = val.map(p => p.name).join(', ')
                            return { text: `${rootKey}.${k}`, display: k, type: 'Instruction', kind: 'kw', params }
                        })
                        if (prop) options = options.filter(o => o.text.toLowerCase().startsWith(p.toLowerCase()))
                    }
                } else {
                    options = Object.keys(tree).map(k => {
                        const val = tree[k]
                        const isNamespace = !Array.isArray(val)
                        let params = ''
                        if (!isNamespace) params = val.map(p => p.name).join(', ')
                        return {
                            text: k,
                            display: k,
                            type: isNamespace ? 'Datatype' : 'Instruction',
                            kind: isNamespace ? 'dt' : 'kw',
                            params
                        }
                    })
                    options = options.filter(o => o.text.toLowerCase().startsWith(p.toLowerCase()))
                }
                list = options
            } else {
                // Argument position — lookup command definition (supports dotted commands like u8.readBit)
                let def = null
                if (ctx.cmd?.includes('.')) {
                    const cmdParts = ctx.cmd.split('.')
                    let node = lang.definitions
                    for (const part of cmdParts) {
                        if (!node || Array.isArray(node)) { node = null; break }
                        const key = Object.keys(node).find(k => k.toLowerCase() === part.toLowerCase()) || part
                        node = node[key]
                    }
                    if (Array.isArray(node)) def = node
                } else {
                    const d = lang.definitions[ctx.cmd] || lang.definitions[ctx.cmd?.toLowerCase?.()]
                    if (Array.isArray(d)) def = d
                }
                if (def) {
                    const argDef = def[ctx.argIndex - 1]
                    
                    // Signature help
                    const argsHtml = def.map((a, idx) => {
                        const isCurrent = idx === ctx.argIndex - 1
                        const style = isCurrent ? 'style="color:#4daafc;font-weight:bold"' : ''
                        return `<span ${style}>${a.name}${a.type ? ':' + a.type : ''}</span>`
                    }).join(', ')
                    helpText = `<span style="color:#c586c0">${ctx.cmd}</span> ${argsHtml}`
                    
                    if (argDef) {
                        if (argDef.type === 'symbol' || argDef.type === 'label' || argDef.type === 'bit_symbol') {
                            const syms = (this._symbolProvider ? this._symbolProvider(argDef.type) : []) || []
                            list = syms
                                .filter(s => (typeof s === 'string' ? s : s.name).toLowerCase().startsWith(ctx.prefix.toLowerCase()))
                                .map(s => {
                                    const name = typeof s === 'string' ? s : s.name
                                    const type = typeof s === 'string' ? (argDef.type === 'label' ? 'Label' : 'Variable') : s.type
                                    return { text: name, type, kind: 'kw' }
                                })
                        } else if (argDef.type === 'type' && lang.types) {
                            list = lang.types
                                .filter(t => t.toUpperCase().startsWith(ctx.prefix.toUpperCase()))
                                .map(t => ({ text: t, type: 'Type', kind: 'dt' }))
                        } else if (argDef.type === 'enum' && argDef.options) {
                            list = argDef.options
                                .filter(o => o.startsWith(ctx.prefix))
                                .map(o => ({ text: o, type: 'Enum', kind: 'kw' }))
                        }
                    }
                }
            }
        } else if (lang.words) {
            // Simple word-based autocomplete
            if (!force && !ctx.prefix) return this._hideAutocomplete()
            // Suppress autocomplete after declaration keywords (e.g. 'let ', 'const ', 'function ')
            if (lang.declarationKeywords && ctx.argIndex >= 1) {
                const prevToken = ctx.lineText.trimStart().split(/[\s,]+/).filter(t => t)[0]
                if (prevToken && lang.declarationKeywords.includes(prevToken.toLowerCase())) {
                    return this._hideAutocomplete()
                }
            }
            list = lang.words
                .filter(w => w.toLowerCase().startsWith(ctx.prefix.toLowerCase()))
                .slice(0, 15)
                .map(w => ({ text: w, type: '', kind: 'kw' }))
        }
        
        // Custom autocomplete provider (additive)
        if (this._autocompleteProvider) {
            const custom = this._autocompleteProvider(ctx.prefix)
            if (Array.isArray(custom) && custom.length > 0) {
                const customItems = custom
                    .filter(w => {
                        const name = typeof w === 'string' ? w : w.name || w.text
                        return name.toLowerCase().startsWith(ctx.prefix.toLowerCase())
                    })
                    .map(w => {
                        if (typeof w === 'string') return { text: w, type: '', kind: 'kw' }
                        return { text: w.name || w.text, type: w.type || '', kind: w.kind || 'kw' }
                    })
                list = list.concat(customItems)
            }
        }
        
        // Show hint for parameter help
        if (helpText && !list.length) {
            this._hintEl.innerHTML = helpText
            this._hintEl.style.display = 'block'
            this._positionAutocomplete()
            this._acEl.style.display = 'none'
            this._acVisible = false
            return
        } else {
            this._hintEl.style.display = 'none'
        }
        
        if (!list.length) return this._hideAutocomplete()
        
        // Don't show single exact match
        if (list.length === 1 && list[0].text.toLowerCase() === ctx.prefix.toLowerCase()) {
            return this._hideAutocomplete()
        }
        
        this._acItems = list
        this._acPrefix = ctx.prefix
        this._acSelected = 0
        
        // Render
        this._acEl.innerHTML = list.map((item, j) => {
            let labelContent = item.display || item.text
            if (item.params) {
                labelContent += `<span style="opacity:0.5;font-size:0.9em;margin-left:8px">${item.params}</span>`
            }
            return `<li class="${j === 0 ? 'sel' : ''}" data-val="${item.text}">
                <span class="icon ${item.kind || 'kw'}"></span>
                <span class="label">${labelContent}</span>
                <span class="desc">${item.type || ''}</span>
            </li>`
        }).join('')
        
        this._acEl.style.display = 'block'
        this._acVisible = true
        this._positionAutocomplete()
    }
    
    _positionAutocomplete() {
        if (!this._acVisible && this._hintEl.style.display === 'none') return
        
        const cursor = this._cursors[0]
        if (!cursor) return
        
        const gaps = this._getLineGaps(cursor.line)
        const visualCol = this._textToVisualCol(cursor.col, gaps)
        const canvasRect = this._canvas.getBoundingClientRect()
        
        const left = canvasRect.left + this.options.gutterWidth + this.options.padding + visualCol * this._charWidth - this._scrollX
        const lineY = canvasRect.top + this.options.padding + (cursor.line * this._lineHeight) - this._scrollY + this._lineHeight
        
        // Constrain to editor container bounds
        const container = this.container.closest('.plc-editor-body') || document.documentElement
        const cr = container.getBoundingClientRect()
        
        if (lineY < cr.top || lineY > cr.bottom || left < cr.left || left > cr.right) {
            this._acEl.style.display = 'none'
            this._hintEl.style.display = 'none'
            return
        }
        
        this._acEl.style.left = left + 'px'
        this._acEl.style.top = lineY + 'px'
        this._hintEl.style.left = (left + 20) + 'px'
        this._hintEl.style.top = lineY + 'px'
    }
    
    _insertAutocomplete(word) {
        const ctx = this._getAutocompleteContext()
        const prefix = ctx ? ctx.prefix : ''
        const lang = this._languageRules
        
        // If inserting an instruction with parameters, append a space
        let appendSpace = false
        if (lang?.definitions && ctx?.argIndex === 0) {
            let def = null
            if (word.includes('.')) {
                const parts = word.split('.')
                let node = lang.definitions
                for (const part of parts) {
                    if (!node || Array.isArray(node)) { node = null; break }
                    const key = Object.keys(node).find(k => k.toLowerCase() === part.toLowerCase()) || part
                    node = node[key]
                }
                if (Array.isArray(node)) def = node
            } else {
                def = lang.definitions[word] || lang.definitions[word.toLowerCase?.()]
            }
            if (def && Array.isArray(def) && def.length > 0) appendSpace = true
        }
        
        // Delete the prefix and insert the word
        if (prefix.length > 0) {
            const cursor = this._cursors[0]
            cursor.col -= prefix.length
            cursor.offset = this._getOffset(cursor.line, cursor.col)
            
            // Delete the prefix characters
            const line = this._lines[cursor.line]
            this._lines[cursor.line] = line.slice(0, cursor.col) + line.slice(cursor.col + prefix.length)
            this._version++
            this._tokenCache.clear()
        }
        
        const textToInsert = word + (appendSpace ? ' ' : '')
        this._insertText(textToInsert)
        this._hideAutocomplete()
        
        // If we appended a space (meaning there are more args), re-trigger
        if (appendSpace) {
            setTimeout(() => this._triggerAutocomplete(true), 10)
        }
    }
    
    _hideAutocomplete() {
        this._acVisible = false
        this._acItems = []
        this._acSelected = 0
        this._acPrefix = ''
        if (this._acEl) this._acEl.style.display = 'none'
        if (this._hintEl) this._hintEl.style.display = 'none'
    }
    
    // ==========================================================================
    // LINE GAP UTILITIES (pill visual gaps)
    // ==========================================================================
    
    /** Compute visual gaps for a line based on pill entries.
     *  Returns [{insertAt, widthCols}] sorted by insertAt.
     *  insertAt is the text column at which the gap is inserted — all text >= insertAt shifts right. */
    _computeLineGaps(lineIndex) {
        if (!this._previewEntriesProvider) return []
        const entries = this._getPreviewEntriesForLine(lineIndex)
        if (!entries || entries.length === 0) return []
        const charW = this._charWidth
        const compact = this._lines.length <= 1
        const pillFontSize = compact ? 9 : 10
        const ctx = this._ctx
        const savedFont = ctx.font
        ctx.font = `${pillFontSize}px Consolas, monospace`
        const gaps = []
        for (const entry of entries) {
            let pillText = ''
            if (this._previewValueProvider) {
                const val = this._previewValueProvider(entry)
                if (val === null || val === undefined) continue
                if (typeof val === 'object') pillText = val.text ?? ''
                else pillText = String(val)
            } else continue
            const pillPixelWidth = Math.max(ctx.measureText(pillText).width + 12, 32)
            const pillCols = Math.max(4, Math.ceil(pillPixelWidth / charW))
            const widthCols = pillCols + 1 // +1 for spacing
            const tokenLen = entry.end - entry.start
            const insertAt = entry.col + tokenLen
            gaps.push({ insertAt, widthCols, pillCols })
        }
        ctx.font = savedFont
        gaps.sort((a, b) => a.insertAt - b.insertAt)
        return gaps
    }
    
    /** Get gaps for a line (cached per render frame) */
    _getLineGaps(lineIndex) {
        if (this._lineGapsCache.has(lineIndex)) return this._lineGapsCache.get(lineIndex)
        const gaps = this._computeLineGaps(lineIndex)
        this._lineGapsCache.set(lineIndex, gaps)
        return gaps
    }
    
    /** Map text column to visual column (adds accumulated gap widths) */
    _textToVisualCol(textCol, gaps) {
        if (!gaps || gaps.length === 0) return textCol
        let offset = 0
        for (const g of gaps) {
            if (g.insertAt <= textCol) offset += g.widthCols
            else break
        }
        return textCol + offset
    }
    
    /** Map visual column back to text column (snaps to boundary if inside a gap) */
    _visualToTextCol(visualCol, gaps) {
        if (!gaps || gaps.length === 0) return visualCol
        let offset = 0
        for (const g of gaps) {
            const gapVisualStart = g.insertAt + offset
            if (visualCol < gapVisualStart) break
            const gapVisualEnd = gapVisualStart + g.widthCols
            if (visualCol < gapVisualEnd) return g.insertAt
            offset += g.widthCols
        }
        return visualCol - offset
    }
    
    // ==========================================================================
    // CURSOR & SELECTION MANAGEMENT
    // ==========================================================================
    
    _setCursor(pos) {
        this._cursors = [{ ...pos }]
        this._selections = []
        this._resetCursorBlink()
        this._updateCursorSnapshot()
    }
    
    _addCursor(pos) {
        // Check if click is inside an existing selection range — deselect that range + its cursor
        const selIdx = this._selections.findIndex(s =>
            pos.offset >= s.start.offset && pos.offset <= s.end.offset
        )
        if (selIdx !== -1) {
            const sel = this._selections[selIdx]
            // Find the cursor associated with this selection (at start or end)
            const cursorIdx = this._cursors.findIndex(c =>
                (c.line === sel.start.line && c.col === sel.start.col) ||
                (c.line === sel.end.line && c.col === sel.end.col)
            )
            this._selections.splice(selIdx, 1)
            if (cursorIdx !== -1 && this._cursors.length > 1) {
                this._cursors.splice(cursorIdx, 1)
            }
            this._resetCursorBlink()
            return
        }
        
        // Check if cursor already exists at this position — toggle it off
        const idx = this._cursors.findIndex(c => c.line === pos.line && c.col === pos.col)
        if (idx !== -1) {
            // Don't remove the last remaining cursor
            if (this._cursors.length > 1) {
                this._cursors.splice(idx, 1)
                // Remove any selection that touches this position
                this._selections = this._selections.filter(s =>
                    !((s.start.line === pos.line && s.start.col === pos.col) ||
                      (s.end.line === pos.line && s.end.col === pos.col))
                )
            }
        } else {
            this._cursors.push({ ...pos })
        }
        this._resetCursorBlink()
        this._updateCursorSnapshot()
    }
    
    /** Block/column selection between anchor and pos.
     *  Each row's selection is clamped to its text length.
     *  Rows shorter than the anchor column are skipped.
     *  Cursor blinks on the side the mouse is on (left or right). */
    _blockSelect(anchor, pos) {
        const startLine = Math.min(anchor.line, pos.line)
        const endLine = Math.max(anchor.line, pos.line)
        const anchorCol = anchor.col
        const targetCol = pos.col
        const leftCol = Math.min(anchorCol, targetCol)
        const rightCol = Math.max(anchorCol, targetCol)
        const selectingLeft = targetCol < anchorCol
        
        const newCursors = []
        const newSelections = []
        
        for (let line = startLine; line <= endLine; line++) {
            const lineLen = this._lines[line].length
            
            // Skip rows that don't reach the left edge of the box at all
            if (lineLen < leftCol) continue
            
            // Clamp right edge to available text
            const clampedRight = Math.min(rightCol, lineLen)
            
            // Cursor on the side the mouse is dragging toward
            const cursorCol = selectingLeft ? leftCol : clampedRight
            const cursorOffset = this._getOffset(line, cursorCol)
            
            newCursors.push({ line, col: cursorCol, offset: cursorOffset })
            
            // Add selection only if there's an actual range
            if (leftCol < clampedRight) {
                newSelections.push({
                    start: { line, col: leftCol, offset: this._getOffset(line, leftCol) },
                    end: { line, col: clampedRight, offset: this._getOffset(line, clampedRight) },
                    isReversed: selectingLeft,
                })
            }
        }
        
        if (newCursors.length > 0) {
            this._cursors = newCursors
            this._selections = newSelections
        }
        
        this._resetCursorBlink()
        this._needsRender = true
        this._updateCursorSnapshot()
    }
    
    _extendSelection(pos) {
        const cursor = this._cursors[this._cursors.length - 1]
        const anchor = this._selectionAnchor
        
        if (anchor) {
            // Anchor-based selection (mouse drag or shift+click)
            // Find the selection associated with this anchor, or create one
            let sel = this._selections.find(s =>
                (s.start.offset === anchor.offset || s.end.offset === anchor.offset)
            )
            if (!sel) {
                sel = {
                    start: { ...anchor },
                    end: { ...anchor },
                    isReversed: false
                }
                this._selections.push(sel)
            }
            
            if (pos.offset < anchor.offset) {
                sel.start = { ...pos }
                sel.end = { ...anchor }
                sel.isReversed = true
            } else {
                sel.start = { ...anchor }
                sel.end = { ...pos }
                sel.isReversed = false
            }
        } else {
            // Fallback for non-anchored selection (shouldn't normally happen)
            let sel = this._selections.find(s => 
                s.start.line === cursor.line && s.start.col === cursor.col ||
                s.end.line === cursor.line && s.end.col === cursor.col
            )
            
            if (!sel) {
                sel = {
                    start: { ...cursor },
                    end: { ...cursor },
                    isReversed: false
                }
                this._selections.push(sel)
            }
            
            if (pos.offset < sel.start.offset) {
                sel.start = { ...pos }
                sel.isReversed = true
            } else {
                sel.end = { ...pos }
                sel.isReversed = false
            }
        }
        
        // Update cursor position
        cursor.line = pos.line
        cursor.col = pos.col
        cursor.offset = pos.offset
        
        // Remove zero-width selections (e.g. drag didn't move past anchor)
        this._selections = this._selections.filter(s => s.start.offset !== s.end.offset)
        this._updateCursorSnapshot()
    }
    
    _clearSecondarySelections() {
        if (this._cursors.length > 1) {
            this._cursors = [this._cursors[0]]
        }
        if (this._selections.length > 0) {
            this._selections = []
        }
        this._needsRender = true
        this._updateCursorSnapshot()
    }
    
    /** Get the word boundaries at a given position, or null if cursor is not on a word */
    _getWordAt(pos) {
        const line = this._lines[pos.line]
        if (!line) return null
        
        let start = pos.col
        let end = pos.col
        
        const isWordChar = (ch) => /[a-zA-Z0-9_]/.test(ch)
        
        // If cursor is not on or adjacent to a word char, return null
        if (!isWordChar(line[start]) && (start === 0 || !isWordChar(line[start - 1]))) return null
        
        while (start > 0 && isWordChar(line[start - 1])) start--
        while (end < line.length && isWordChar(line[end])) end++
        
        if (start === end) return null
        return { line: pos.line, startCol: start, endCol: end, word: line.slice(start, end) }
    }
    
    _selectWordAt(pos) {
        const line = this._lines[pos.line]
        if (!line) return
        
        let start = pos.col
        let end = pos.col
        
        // Expand to word boundaries
        const isWordChar = (ch) => /[a-zA-Z0-9_.]/.test(ch)
        
        while (start > 0 && isWordChar(line[start - 1])) start--
        while (end < line.length && isWordChar(line[end])) end++
        
        // If no word found (e.g., clicking on whitespace), just set cursor
        if (start === end) {
            this._setCursor(pos)
            return
        }
        
        const startPos = { line: pos.line, col: start, offset: this._getOffset(pos.line, start) }
        const endPos = { line: pos.line, col: end, offset: this._getOffset(pos.line, end) }
        
        this._cursors = [endPos]
        this._selections = [{
            start: startPos,
            end: endPos,
            isReversed: false
        }]
        
        this._resetCursorBlink()
        this._updateCursorSnapshot()
    }
    
    /** Add a word selection at pos to the existing multi-cursor set */
    _addWordSelection(pos) {
        const line = this._lines[pos.line]
        if (!line) return
        
        let start = pos.col
        let end = pos.col
        
        const isWordChar = (ch) => /[a-zA-Z0-9_.]/.test(ch)
        
        while (start > 0 && isWordChar(line[start - 1])) start--
        while (end < line.length && isWordChar(line[end])) end++
        
        if (start === end) return
        
        const startPos = { line: pos.line, col: start, offset: this._getOffset(pos.line, start) }
        const endPos = { line: pos.line, col: end, offset: this._getOffset(pos.line, end) }
        
        this._cursors.push(endPos)
        this._selections.push({
            start: startPos,
            end: endPos,
            isReversed: false
        })
        
        this._mergeCursors()
        this._resetCursorBlink()
        this._updateCursorSnapshot()
    }
    
    /** Render grey highlight boxes over all occurrences of the word under the single cursor */
    _renderWordHighlights(ctx, firstLine, lastLine, contentX, baseY) {
        // Only when single cursor with no selections, and no pill selected
        if (this._cursors.length !== 1 || this._selections.length !== 0) return
        if (this._selectedPill) return
        
        const wordInfo = this._getWordAt(this._cursors[0])
        if (!wordInfo) return
        if (wordInfo.word.length < 2) return // Skip single-char matches
        
        const word = wordInfo.word
        const isWordChar = (ch) => /[a-zA-Z0-9_]/.test(ch)
        const lh = this._lineHeight
        const cw = this._charWidth
        const gap = 1
        const radius = 3
        
        ctx.fillStyle = this.options.colors.wordHighlight
        
        for (let i = firstLine; i <= lastLine; i++) {
            const line = this._lines[i]
            const lineGaps = this._getLineGaps(i)
            let idx = 0
            while ((idx = line.indexOf(word, idx)) !== -1) {
                // Ensure whole word match
                const before = idx > 0 ? line[idx - 1] : ' '
                const after = idx + word.length < line.length ? line[idx + word.length] : ' '
                if (!isWordChar(before) && !isWordChar(after)) {
                    const vCol = this._textToVisualCol(idx, lineGaps)
                    const vColEnd = this._textToVisualCol(idx + word.length, lineGaps)
                    const x = contentX + vCol * cw - this._scrollX
                    const y = baseY + (i - firstLine) * lh
                    const w = (vColEnd - vCol) * cw
                    
                    // Draw rounded rect
                    const top = y + gap
                    const bottom = y + lh - gap
                    const left = x
                    const right = x + w
                    const r = Math.min(radius, w / 2, (lh - 2 * gap) / 2)
                    
                    ctx.beginPath()
                    ctx.moveTo(left + r, top)
                    ctx.lineTo(right - r, top)
                    ctx.arcTo(right, top, right, top + r, r)
                    ctx.lineTo(right, bottom - r)
                    ctx.arcTo(right, bottom, right - r, bottom, r)
                    ctx.lineTo(left + r, bottom)
                    ctx.arcTo(left, bottom, left, bottom - r, r)
                    ctx.lineTo(left, top + r)
                    ctx.arcTo(left, top, left + r, top, r)
                    ctx.closePath()
                    ctx.fill()
                }
                idx += 1
            }
        }
    }
    
    /**
     * Render a highlighted range (used by problem panel hover/selection)
     */
    _renderHighlightRange(ctx, range, color, firstLine, lastLine, contentX, baseY) {
        if (!range || typeof range.start !== 'number' || typeof range.end !== 'number') return
        
        const startPos = this._getPositionFromOffset(range.start)
        const endPos = this._getPositionFromOffset(range.end)
        
        const lh = this._lineHeight
        const cw = this._charWidth
        
        for (let i = Math.max(startPos.line, firstLine); i <= Math.min(endPos.line, lastLine); i++) {
            const line = this._lines[i]
            const gaps = this._getLineGaps(i)
            
            const segStart = (i === startPos.line) ? startPos.col : 0
            const segEnd = (i === endPos.line) ? endPos.col : line.length
            if (segEnd <= segStart) continue
            
            const vStart = this._textToVisualCol(segStart, gaps)
            const vEnd = this._textToVisualCol(segEnd, gaps)
            
            const x = contentX + vStart * cw - this._scrollX
            const y = baseY + (i - firstLine) * lh
            const w = Math.max((vEnd - vStart) * cw, cw)
            
            ctx.fillStyle = color
            ctx.fillRect(x, y, w, lh)
        }
    }
    
    _selectAll() {
        const lastLine = this._lines.length - 1
        const lastCol = this._lines[lastLine].length
        
        this._selections = [{
            start: { line: 0, col: 0, offset: 0 },
            end: { line: lastLine, col: lastCol, offset: this._getText().length },
            isReversed: false
        }]
        this._cursors = [{ line: lastLine, col: lastCol, offset: this._getText().length }]
        this._updateCursorSnapshot()
    }
    
    // ==========================================================================
    // CURSOR MOVEMENT
    // ==========================================================================
    
    _moveCursors(direction, extend = false, wordMode = false) {
        for (let i = 0; i < this._cursors.length; i++) {
            const cursor = this._cursors[i]
            const oldPos = { ...cursor }
            
            switch (direction) {
                case 'left':
                    if (wordMode) {
                        this._moveCursorByWord(cursor, -1)
                    } else if (cursor.col > 0) {
                        cursor.col--
                    } else if (cursor.line > 0) {
                        cursor.line--
                        cursor.col = this._lines[cursor.line].length
                    }
                    break
                    
                case 'right':
                    if (wordMode) {
                        this._moveCursorByWord(cursor, 1)
                    } else if (cursor.col < this._lines[cursor.line].length) {
                        cursor.col++
                    } else if (cursor.line < this._lines.length - 1) {
                        cursor.line++
                        cursor.col = 0
                    }
                    break
                    
                case 'up':
                    if (cursor.line > 0) {
                        cursor.line--
                        cursor.col = Math.min(cursor.col, this._lines[cursor.line].length)
                    }
                    break
                    
                case 'down':
                    if (cursor.line < this._lines.length - 1) {
                        cursor.line++
                        cursor.col = Math.min(cursor.col, this._lines[cursor.line].length)
                    }
                    break
                    
                case 'lineStart':
                    if (wordMode) {
                        cursor.line = 0
                        cursor.col = 0
                    } else {
                        // Smart home: go to first non-whitespace, or start
                        const line = this._lines[cursor.line]
                        const firstNonWs = line.search(/\S/)
                        if (firstNonWs === -1 || cursor.col <= firstNonWs) {
                            cursor.col = 0
                        } else {
                            cursor.col = firstNonWs
                        }
                    }
                    break
                    
                case 'lineEnd':
                    if (wordMode) {
                        cursor.line = this._lines.length - 1
                        cursor.col = this._lines[cursor.line].length
                    } else {
                        cursor.col = this._lines[cursor.line].length
                    }
                    break
                    
                case 'pageUp':
                    cursor.line = Math.max(0, cursor.line - this._visibleLines)
                    cursor.col = Math.min(cursor.col, this._lines[cursor.line].length)
                    break
                    
                case 'pageDown':
                    cursor.line = Math.min(this._lines.length - 1, cursor.line + this._visibleLines)
                    cursor.col = Math.min(cursor.col, this._lines[cursor.line].length)
                    break
            }
            
            cursor.offset = this._getOffset(cursor.line, cursor.col)
            
            // Handle selection extension
            if (extend) {
                let sel = this._selections[i]
                if (!sel) {
                    sel = { start: { ...oldPos }, end: { ...oldPos }, isReversed: false }
                    this._selections[i] = sel
                }
                
                if (sel.isReversed) {
                    sel.start = { ...cursor }
                } else {
                    sel.end = { ...cursor }
                }
                
                // Normalize selection direction
                if (sel.start.offset > sel.end.offset) {
                    [sel.start, sel.end] = [sel.end, sel.start]
                    sel.isReversed = !sel.isReversed
                }
            } else {
                this._selections[i] = null
            }
        }
        
        // Clean up null selections
        this._selections = this._selections.filter(s => s !== null)
        
        this._mergeCursors()
        this._ensureCursorVisible()
        this._resetCursorBlink()
        this._updateCursorSnapshot()
    }
    
    _moveCursorByWord(cursor, direction) {
        const line = this._lines[cursor.line]
        const isWordChar = (ch) => /[a-zA-Z0-9_]/.test(ch)
        
        if (direction < 0) {
            // Move left
            if (cursor.col === 0 && cursor.line > 0) {
                cursor.line--
                cursor.col = this._lines[cursor.line].length
                return
            }
            
            let col = cursor.col - 1
            // Skip whitespace
            while (col > 0 && !isWordChar(line[col])) col--
            // Skip word
            while (col > 0 && isWordChar(line[col - 1])) col--
            cursor.col = col
        } else {
            // Move right
            if (cursor.col >= line.length && cursor.line < this._lines.length - 1) {
                cursor.line++
                cursor.col = 0
                return
            }
            
            let col = cursor.col
            // Skip word
            while (col < line.length && isWordChar(line[col])) col++
            // Skip whitespace
            while (col < line.length && !isWordChar(line[col])) col++
            cursor.col = col
        }
    }
    
    _ensureCursorVisible() {
        if (this._cursors.length === 0) return
        
        const cursor = this._cursors[0]
        const y = cursor.line * this._lineHeight
        const gaps = this._getLineGaps(cursor.line)
        const x = this._textToVisualCol(cursor.col, gaps) * this._charWidth
        
        const viewTop = this._scrollY
        const viewBottom = this._scrollY + this._height - this.options.padding * 2
        const viewLeft = this._scrollX
        const viewRight = this._scrollX + this._width - this.options.gutterWidth - this.options.padding * 2
        
        // Vertical scroll
        if (y < viewTop) {
            this._scrollY = y
        } else if (y + this._lineHeight > viewBottom) {
            this._scrollY = y + this._lineHeight - (this._height - this.options.padding * 2)
        }
        
        // Horizontal scroll
        if (x < viewLeft) {
            this._scrollX = Math.max(0, x - this._charWidth * 5)
        } else if (x > viewRight - this._charWidth * 5) {
            this._scrollX = x - (viewRight - viewLeft) + this._charWidth * 10
        }
    }
    
    // ==========================================================================
    // TEXT EDITING
    // ==========================================================================
    
    _getText() {
        return this._lines.join('\n')
    }
    
    _setText(text) {
        this._lines = text.split('\n')
        this._version++
        this._tokenCache.clear()
        this._needsRender = true
    }
    
    _insertText(text) {
        const hasSelections = this._selections.length > 0 && this._selections.some(s => s)
        
        if (hasSelections) {
            // Replace each selection with the new text in one atomic pass
            const ops = []
            for (let i = 0; i < this._cursors.length; i++) {
                const sel = this._selections[i]
                ops.push({
                    cursor: this._cursors[i],
                    startOffset: sel ? sel.start.offset : this._cursors[i].offset,
                    endOffset: sel ? sel.end.offset : this._cursors[i].offset,
                })
            }
            
            // Sort descending by startOffset so end-to-start replacements don't shift earlier offsets
            ops.sort((a, b) => b.startOffset - a.startOffset)
            
            let fullText = this._getText()
            for (const op of ops) {
                fullText = fullText.slice(0, op.startOffset) + text + fullText.slice(op.endOffset)
            }
            
            this._lines = fullText.split('\n')
            this._selections = []
            
            // Calculate final cursor positions (ascending order for cumulative shift)
            ops.sort((a, b) => a.startOffset - b.startOffset)
            let cumulativeShift = 0
            for (const op of ops) {
                const delta = text.length - (op.endOffset - op.startOffset)
                const finalOffset = op.startOffset + cumulativeShift + text.length
                const pos = this._getPositionFromOffset(finalOffset)
                op.cursor.line = pos.line
                op.cursor.col = pos.col
                op.cursor.offset = finalOffset
                cumulativeShift += delta
            }
        } else {
            // No selections – insert at each cursor
            const sortedCursors = [...this._cursors].sort((a, b) => a.offset - b.offset)
            let cumulativeShift = 0
            
            for (const cursor of sortedCursors) {
                const adjustedOffset = cursor.offset + cumulativeShift
                const pos = this._getPositionFromOffset(adjustedOffset)
                
                const line = this._lines[pos.line]
                const before = line.slice(0, pos.col)
                const after = line.slice(pos.col)
                
                const insertLines = text.split('\n')
                
                if (insertLines.length === 1) {
                    this._lines[pos.line] = before + text + after
                    cursor.line = pos.line
                    cursor.col = pos.col + text.length
                } else {
                    this._lines[pos.line] = before + insertLines[0]
                    
                    const middleLines = insertLines.slice(1, -1)
                    const lastInsert = insertLines[insertLines.length - 1]
                    
                    this._lines.splice(pos.line + 1, 0, ...middleLines, lastInsert + after)
                    
                    cursor.line = pos.line + insertLines.length - 1
                    cursor.col = lastInsert.length
                }
                
                cursor.offset = this._getOffset(cursor.line, cursor.col)
                cumulativeShift += text.length
            }
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
    }
    
    /** Insert different text at each cursor (entries distributed in offset order, top-to-bottom) */
    _insertTextPerCursor(entries) {
        const hasSelections = this._selections.length > 0 && this._selections.some(s => s)
        
        if (hasSelections) {
            // Replace each selection with its corresponding entry text
            const ops = []
            for (let i = 0; i < this._cursors.length; i++) {
                const sel = this._selections[i]
                ops.push({
                    cursor: this._cursors[i],
                    startOffset: sel ? sel.start.offset : this._cursors[i].offset,
                    endOffset: sel ? sel.end.offset : this._cursors[i].offset,
                    origIndex: i,
                })
            }
            
            // Sort ascending by startOffset to pair with entries (which are in offset order)
            ops.sort((a, b) => a.startOffset - b.startOffset)
            // Assign entry text to each op
            for (let i = 0; i < ops.length; i++) {
                ops[i].text = entries[i] || ''
            }
            
            // Sort descending for end-to-start replacement
            ops.sort((a, b) => b.startOffset - a.startOffset)
            
            let fullText = this._getText()
            for (const op of ops) {
                fullText = fullText.slice(0, op.startOffset) + op.text + fullText.slice(op.endOffset)
            }
            
            this._lines = fullText.split('\n')
            this._selections = []
            
            // Calculate final cursor positions (ascending order for cumulative shift)
            ops.sort((a, b) => a.startOffset - b.startOffset)
            let cumulativeShift = 0
            for (const op of ops) {
                const delta = op.text.length - (op.endOffset - op.startOffset)
                const finalOffset = op.startOffset + cumulativeShift + op.text.length
                const pos = this._getPositionFromOffset(finalOffset)
                op.cursor.line = pos.line
                op.cursor.col = pos.col
                op.cursor.offset = finalOffset
                cumulativeShift += delta
            }
        } else {
            // No selections – insert at each cursor
            const sortedCursors = [...this._cursors].sort((a, b) => a.offset - b.offset)
            let cumulativeShift = 0
            
            for (let i = 0; i < sortedCursors.length; i++) {
                const cursor = sortedCursors[i]
                const text = entries[i] || ''
                if (!text) continue
                
                const adjustedOffset = cursor.offset + cumulativeShift
                const pos = this._getPositionFromOffset(adjustedOffset)
                
                const line = this._lines[pos.line]
                const before = line.slice(0, pos.col)
                const after = line.slice(pos.col)
                
                const insertLines = text.split('\n')
                
                if (insertLines.length === 1) {
                    this._lines[pos.line] = before + text + after
                    cursor.line = pos.line
                    cursor.col = pos.col + text.length
                } else {
                    this._lines[pos.line] = before + insertLines[0]
                    
                    const middleLines = insertLines.slice(1, -1)
                    const lastInsert = insertLines[insertLines.length - 1]
                    
                    this._lines.splice(pos.line + 1, 0, ...middleLines, lastInsert + after)
                    
                    cursor.line = pos.line + insertLines.length - 1
                    cursor.col = lastInsert.length
                }
                
                cursor.offset = this._getOffset(cursor.line, cursor.col)
                cumulativeShift += text.length
            }
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
    }
    
    _deleteBackward(wordMode = false) {
        // If there are selections, delete them
        if (this._selections.length > 0 && this._selections.some(s => s)) {
            this._deleteSelections()
            return
        }
        
        // Process cursors in ascending offset order, tracking cumulative shift
        // so each deletion correctly accounts for prior deletions
        const sortedCursors = [...this._cursors].sort((a, b) => a.offset - b.offset)
        let cumulativeShift = 0
        
        for (const cursor of sortedCursors) {
            const adjustedOffset = cursor.offset + cumulativeShift
            const pos = this._getPositionFromOffset(adjustedOffset)
            cursor.line = pos.line
            cursor.col = pos.col
            
            if (wordMode) {
                const origCol = cursor.col
                const origLine = cursor.line
                const origOffset = this._getOffset(cursor.line, cursor.col)
                this._moveCursorByWord(cursor, -1)
                const newOffset = this._getOffset(cursor.line, cursor.col)
                if (newOffset < origOffset) {
                    const charsDeleted = origOffset - newOffset
                    this._deleteRange(newOffset, origOffset)
                    const newPos = this._getPositionFromOffset(newOffset)
                    cursor.line = newPos.line
                    cursor.col = newPos.col
                    cursor.offset = newOffset - cumulativeShift
                    cumulativeShift -= charsDeleted
                }
            } else if (cursor.col > 0) {
                // Delete single character before cursor
                const line = this._lines[cursor.line]
                this._lines[cursor.line] = line.slice(0, cursor.col - 1) + line.slice(cursor.col)
                cursor.col--
                cursor.offset = cursor.offset - 1 // Original offset shifts back by 1
                cumulativeShift--
            } else if (cursor.line > 0) {
                // Join with previous line
                const prevLine = this._lines[cursor.line - 1]
                const currLine = this._lines[cursor.line]
                this._lines[cursor.line - 1] = prevLine + currLine
                this._lines.splice(cursor.line, 1)
                cursor.line--
                cursor.col = prevLine.length
                cursor.offset = cursor.offset - 1 // Newline char removed
                cumulativeShift--
            }
        }
        
        // Final recalculation of line/col from offsets using the adjusted offsets
        for (const cursor of this._cursors) {
            cursor.offset = this._getOffset(cursor.line, cursor.col)
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
    }
    
    _deleteForward(wordMode = false) {
        // If there are selections, delete them
        if (this._selections.length > 0 && this._selections.some(s => s)) {
            this._deleteSelections()
            return
        }
        
        // Process cursors in ascending offset order, tracking cumulative shift
        const sortedCursors = [...this._cursors].sort((a, b) => a.offset - b.offset)
        let cumulativeShift = 0
        
        for (const cursor of sortedCursors) {
            const adjustedOffset = cursor.offset + cumulativeShift
            const pos = this._getPositionFromOffset(adjustedOffset)
            cursor.line = pos.line
            cursor.col = pos.col
            
            const line = this._lines[cursor.line]
            
            if (wordMode) {
                // Delete word forward
                const origOffset = this._getOffset(cursor.line, cursor.col)
                const savedCursor = { line: cursor.line, col: cursor.col, offset: origOffset }
                this._moveCursorByWord(cursor, +1)
                const newOffset = this._getOffset(cursor.line, cursor.col)
                if (newOffset > origOffset) {
                    const charsDeleted = newOffset - origOffset
                    this._deleteRange(origOffset, newOffset)
                    // Restore cursor to original position (text after was deleted)
                    cursor.line = savedCursor.line
                    cursor.col = savedCursor.col
                    cursor.offset = origOffset - cumulativeShift
                    cumulativeShift -= charsDeleted
                }
            } else if (cursor.col < line.length) {
                // Delete single character after cursor
                this._lines[cursor.line] = line.slice(0, cursor.col) + line.slice(cursor.col + 1)
                cumulativeShift--
            } else if (cursor.line < this._lines.length - 1) {
                // Join with next line
                this._lines[cursor.line] = line + this._lines[cursor.line + 1]
                this._lines.splice(cursor.line + 1, 1)
                cumulativeShift--
            }
            
            cursor.offset = this._getOffset(cursor.line, cursor.col)
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
    }
    
    _deleteRange(start, end) {
        const text = this._getText()
        const newText = text.slice(0, start) + text.slice(end)
        this._setText(newText)
    }
    
    _deleteSelections() {
        // Move each cursor to the start of its selection before deleting
        for (let i = 0; i < this._cursors.length; i++) {
            const sel = this._selections[i]
            if (!sel) continue
            const cursor = this._cursors[i]
            cursor.offset = sel.start.offset
        }
        
        // Sort selections by offset (descending) so later ranges are deleted first
        const sorted = [...this._selections]
            .filter(s => s)
            .sort((a, b) => b.start.offset - a.start.offset)
        
        for (const sel of sorted) {
            this._deleteRange(sel.start.offset, sel.end.offset)
        }
        
        // Reset selections and update cursors from their (now adjusted) offsets
        this._selections = []
        for (const cursor of this._cursors) {
            const pos = this._getPositionFromOffset(cursor.offset)
            cursor.line = pos.line
            cursor.col = pos.col
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
    }
    
    _moveSelectedLines(direction) {
        // Get unique lines from cursors and selections
        const lineSet = new Set()
        
        for (const cursor of this._cursors) {
            lineSet.add(cursor.line)
        }
        for (const sel of this._selections) {
            if (!sel) continue
            for (let l = sel.start.line; l <= sel.end.line; l++) {
                lineSet.add(l)
            }
        }
        
        const lines = [...lineSet].sort((a, b) => a - b)
        
        if (direction < 0 && lines[0] === 0) return
        if (direction > 0 && lines[lines.length - 1] === this._lines.length - 1) return
        
        if (direction < 0) {
            // Move up
            for (const lineNum of lines) {
                const temp = this._lines[lineNum - 1]
                this._lines[lineNum - 1] = this._lines[lineNum]
                this._lines[lineNum] = temp
            }
        } else {
            // Move down
            for (const lineNum of [...lines].reverse()) {
                const temp = this._lines[lineNum + 1]
                this._lines[lineNum + 1] = this._lines[lineNum]
                this._lines[lineNum] = temp
            }
        }
        
        // Update cursors
        for (const cursor of this._cursors) {
            if (lineSet.has(cursor.line)) {
                cursor.line += direction
                cursor.offset = this._getOffset(cursor.line, cursor.col)
            }
        }
        
        // Update selections
        for (const sel of this._selections) {
            if (!sel) continue
            if (lineSet.has(sel.start.line)) {
                sel.start.line += direction
                sel.start.offset = this._getOffset(sel.start.line, sel.start.col)
            }
            if (lineSet.has(sel.end.line)) {
                sel.end.line += direction
                sel.end.offset = this._getOffset(sel.end.line, sel.end.col)
            }
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
        this._scheduleLint()
    }
    
    /** Duplicate selected lines up or down. Cursors stay in place visually. */
    _duplicateSelectedLines(direction) {
        // Get unique lines from cursors and selections
        const lineSet = new Set()
        
        for (const cursor of this._cursors) {
            lineSet.add(cursor.line)
        }
        for (const sel of this._selections) {
            if (!sel) continue
            for (let l = sel.start.line; l <= sel.end.line; l++) {
                lineSet.add(l)
            }
        }
        
        const sortedLines = [...lineSet].sort((a, b) => a - b)
        const firstLine = sortedLines[0]
        const lastLine = sortedLines[sortedLines.length - 1]
        const count = lastLine - firstLine + 1
        
        // Copy the block of lines
        const copiedLines = []
        for (let i = firstLine; i <= lastLine; i++) {
            copiedLines.push(this._lines[i])
        }
        
        if (direction < 0) {
            // Duplicate up: insert copy above, cursors stay (they shift down by count)
            this._lines.splice(firstLine, 0, ...copiedLines)
            // Cursors/selections are now on lines shifted down by `count`, pointing at originals
            // The copy is above — cursors stay where they are (on the original lines that moved down)
            for (const cursor of this._cursors) {
                if (cursor.line >= firstLine) {
                    cursor.line += count
                    cursor.offset = this._getOffset(cursor.line, cursor.col)
                }
            }
            for (const sel of this._selections) {
                if (!sel) continue
                if (sel.start.line >= firstLine) {
                    sel.start.line += count
                    sel.start.offset = this._getOffset(sel.start.line, sel.start.col)
                }
                if (sel.end.line >= firstLine) {
                    sel.end.line += count
                    sel.end.offset = this._getOffset(sel.end.line, sel.end.col)
                }
            }
        } else {
            // Duplicate down: insert copy below, cursors stay on originals
            this._lines.splice(lastLine + 1, 0, ...copiedLines)
            // Cursors stay where they are — copy is below them
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
        this._scheduleLint()
    }
    
    _duplicateLine() {
        const cursor = this._cursors[0]
        const line = this._lines[cursor.line]
        this._lines.splice(cursor.line + 1, 0, line)
        cursor.line++
        cursor.offset = this._getOffset(cursor.line, cursor.col)
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
    }
    
    /** Check if any cursor has a multi-line selection */
    _hasMultiLineSelection() {
        for (const sel of this._selections) {
            if (!sel) continue
            if (sel.start.line !== sel.end.line) return true
        }
        return false
    }
    
    /** TAB without Shift: either indent block or insert alignment spaces */
    _indentOrTab() {
        if (this._hasMultiLineSelection()) {
            this._indentLines()
        } else {
            this._tabAlignCursors()
        }
    }
    
    /** For single-line cursors/selections: delete selection, insert spaces to next multiple of 2 */
    _tabAlignCursors() {
        // Delete selections first if any
        if (this._selections.length > 0 && this._selections.some(s => s)) {
            this._deleteSelections()
        }
        
        const sortedCursors = [...this._cursors].sort((a, b) => a.offset - b.offset)
        let cumulativeShift = 0
        
        for (const cursor of sortedCursors) {
            const adjustedOffset = cursor.offset + cumulativeShift
            const pos = this._getPositionFromOffset(adjustedOffset)
            
            const spacesNeeded = 2 - (pos.col % 2) || 2
            const spaces = ' '.repeat(spacesNeeded)
            
            const line = this._lines[pos.line]
            this._lines[pos.line] = line.slice(0, pos.col) + spaces + line.slice(pos.col)
            
            cursor.line = pos.line
            cursor.col = pos.col + spacesNeeded
            cursor.offset = this._getOffset(cursor.line, cursor.col)
            cumulativeShift += spacesNeeded
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
    }
    
    /** For multi-line selections: add leading spaces (indent to next multiple of 2) */
    _indentLines() {
        const processed = new Set()
        
        for (let ci = 0; ci < this._cursors.length; ci++) {
            const cursor = this._cursors[ci]
            const sel = this._selections[ci]
            
            const startLine = sel ? sel.start.line : cursor.line
            const endLine = sel ? sel.end.line : cursor.line
            
            for (let l = startLine; l <= endLine; l++) {
                if (processed.has(l)) continue
                processed.add(l)
                
                const line = this._lines[l]
                const leadingSpaces = line.length - line.trimStart().length
                const spacesToAdd = 2 - (leadingSpaces % 2) || 2
                this._lines[l] = ' '.repeat(spacesToAdd) + line
            }
        }
        
        // Update all cursors and selections
        for (let ci = 0; ci < this._cursors.length; ci++) {
            const cursor = this._cursors[ci]
            const sel = this._selections[ci]
            
            if (sel) {
                // Recalculate selection positions
                sel.start.col = Math.min(sel.start.col + 2, this._lines[sel.start.line].length)
                sel.start.offset = this._getOffset(sel.start.line, sel.start.col)
                sel.end.col = Math.min(sel.end.col + 2, this._lines[sel.end.line].length)
                sel.end.offset = this._getOffset(sel.end.line, sel.end.col)
            }
            cursor.col = Math.min(cursor.col + 2, this._lines[cursor.line].length)
            cursor.offset = this._getOffset(cursor.line, cursor.col)
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
    }
    
    /** Shift+TAB: remove leading whitespace (outdent by up to 2 spaces) */
    _outdentLines() {
        const processed = new Set()
        const removedPerLine = new Map()
        
        for (let ci = 0; ci < this._cursors.length; ci++) {
            const cursor = this._cursors[ci]
            const sel = this._selections[ci]
            
            const startLine = sel ? sel.start.line : cursor.line
            const endLine = sel ? sel.end.line : cursor.line
            
            for (let l = startLine; l <= endLine; l++) {
                if (processed.has(l)) continue
                processed.add(l)
                
                const line = this._lines[l]
                const leadingSpaces = line.length - line.trimStart().length
                // Remove 1 or 2 spaces to get to previous multiple of 2
                let toRemove = leadingSpaces % 2 || 2
                toRemove = Math.min(toRemove, leadingSpaces)
                if (toRemove > 0) {
                    this._lines[l] = line.slice(toRemove)
                }
                removedPerLine.set(l, toRemove)
            }
        }
        
        // Update all cursors and selections
        for (let ci = 0; ci < this._cursors.length; ci++) {
            const cursor = this._cursors[ci]
            const sel = this._selections[ci]
            
            if (sel) {
                const rs = removedPerLine.get(sel.start.line) || 0
                sel.start.col = Math.max(0, sel.start.col - rs)
                sel.start.offset = this._getOffset(sel.start.line, sel.start.col)
                const re = removedPerLine.get(sel.end.line) || 0
                sel.end.col = Math.max(0, sel.end.col - re)
                sel.end.offset = this._getOffset(sel.end.line, sel.end.col)
            }
            const r = removedPerLine.get(cursor.line) || 0
            cursor.col = Math.max(0, cursor.col - r)
            cursor.offset = this._getOffset(cursor.line, cursor.col)
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
    }
    
    // ==========================================================================
    // CLIPBOARD
    // ==========================================================================
    
    /** @type {{ entries: string[], joined: string } | null} Shared across all instances */
    static _multiCursorClipboard = null
    
    async _copy() {
        const text = this._getText()
        const entries = []
        
        // Collect per-selection text (sorted by offset ascending for consistent order)
        const sortedSels = [...this._selections]
            .filter(s => s)
            .sort((a, b) => a.start.offset - b.start.offset)
        
        for (const sel of sortedSels) {
            entries.push(text.slice(sel.start.offset, sel.end.offset))
        }
        
        if (entries.length === 0) return
        
        const joined = entries.join('\n')
        
        // Store multi-cursor clipboard for cross-instance use
        if (entries.length > 1) {
            CanvasCodeEditor._multiCursorClipboard = { entries, joined }
        } else {
            CanvasCodeEditor._multiCursorClipboard = null
        }
        
        await navigator.clipboard.writeText(joined)
    }
    
    async _cut() {
        await this._copy()
        this._deleteSelections()
    }
    
    async _paste() {
        // Paste is handled by the 'paste' event listener on the hidden input element.
        // This avoids needing clipboard read permissions (navigator.clipboard.readText).
        // Kept as a no-op for backwards compatibility.
    }
    
    _getSelectedText() {
        if (this._selections.length === 0) return ''
        
        const text = this._getText()
        const parts = []
        
        for (const sel of this._selections) {
            if (!sel) continue
            parts.push(text.slice(sel.start.offset, sel.end.offset))
        }
        
        return parts.join('\n')
    }
    
    // ==========================================================================
    // UNDO/REDO with cursor/selection state and debounced grouping
    // ==========================================================================
    
    _undoStack = []
    _redoStack = []
    _lastUndoText = ''
    _undoDebounceTimer = null
    _pendingUndoEntry = null // The "before" snapshot waiting to be committed
    _lastCursorSnapshot = null // Cursor state at the last committed or idle point
    
    _snapshotCursorState() {
        return {
            cursors: this._cursors.map(c => ({ ...c })),
            selections: this._selections.map(s => ({
                start: { ...s.start },
                end: { ...s.end },
                isReversed: s.isReversed,
            })),
        }
    }
    
    /** Update the cursor snapshot — call whenever cursors change without a text edit */
    _updateCursorSnapshot() {
        this._lastCursorSnapshot = this._snapshotCursorState()
    }
    
    _pushUndo() {
        const text = this._getText()
        if (text === this._lastUndoText) return
        
        // On first change after idle, capture the "before" state using the last known cursor snapshot
        if (!this._pendingUndoEntry) {
            this._pendingUndoEntry = {
                beforeText: this._lastUndoText,
                before: this._lastCursorSnapshot || this._snapshotCursorState(),
            }
        }
        
        this._lastUndoText = text
        
        // Debounce: reset timer on each change, commit after 500ms idle
        if (this._undoDebounceTimer) clearTimeout(this._undoDebounceTimer)
        this._undoDebounceTimer = setTimeout(() => {
            this._commitUndo()
            this._lastCursorSnapshot = this._snapshotCursorState()
        }, 500)
    }
    
    _commitUndo() {
        if (this._undoDebounceTimer) {
            clearTimeout(this._undoDebounceTimer)
            this._undoDebounceTimer = null
        }
        if (!this._pendingUndoEntry) return
        
        // Complete the entry with "after" state
        this._pendingUndoEntry.afterText = this._getText()
        this._pendingUndoEntry.after = this._snapshotCursorState()
        
        this._undoStack.push(this._pendingUndoEntry)
        this._pendingUndoEntry = null
        this._redoStack = []
        if (this._undoStack.length > 200) {
            this._undoStack.shift()
        }
    }
    
    _undo() {
        // Commit any pending debounced changes first
        this._commitUndo()
        
        if (this._undoStack.length === 0) return
        
        const entry = this._undoStack.pop()
        this._redoStack.push(entry)
        
        // Restore the "before" state — text and cursors from before the edit
        this._setText(entry.beforeText)
        this._lastUndoText = entry.beforeText
        this._cursors = entry.before.cursors.map(c => ({ ...c }))
        this._selections = entry.before.selections.map(s => ({
            start: { ...s.start }, end: { ...s.end }, isReversed: s.isReversed,
        }))
        this._lastCursorSnapshot = this._snapshotCursorState()
        this._needsRender = true
        if (this._onChange) this._onChange(this._getText())
        this._scheduleLint()
    }
    
    _redo() {
        if (this._redoStack.length === 0) return
        
        const entry = this._redoStack.pop()
        this._undoStack.push(entry)
        
        // Restore the "after" state — text and cursors from after the edit
        this._setText(entry.afterText)
        this._lastUndoText = entry.afterText
        this._cursors = entry.after.cursors.map(c => ({ ...c }))
        this._selections = entry.after.selections.map(s => ({
            start: { ...s.start }, end: { ...s.end }, isReversed: s.isReversed,
        }))
        this._lastCursorSnapshot = this._snapshotCursorState()
        this._needsRender = true
        if (this._onChange) this._onChange(this._getText())
        this._scheduleLint()
    }
    
    _notifyChange() {
        this._mergeCursors()
        this._pushUndo()
        this._needsRender = true

        // Clear external highlights on edit (problem panel hover/selection)
        if (this._hoverHighlightRange) { this._hoverHighlightRange = null }
        if (this._selectedHighlightRange) { this._selectedHighlightRange = null }
        
        if (this._onChange) {
            this._onChange(this._getText())
        }
        
        // Schedule lint on change
        this._scheduleLint()
    }
    
    /** Deduplicate cursors that share the same line and column */
    _mergeCursors() {
        if (this._cursors.length <= 1 && this._selections.length <= 1) return
        
        // Remember the primary (first) cursor so we can keep it as the first element after merge
        const primaryCursor = this._cursors[0]
        
        // Build paired list of cursor + associated selection (by index)
        const pairs = this._cursors.map((c, i) => ({
            cursor: c,
            sel: this._selections[i] || null,
        }))
        
        // Sort by cursor offset
        pairs.sort((a, b) => a.cursor.offset - b.cursor.offset)
        
        // Merge overlapping or touching selections, drop duplicate cursors
        const merged = []
        for (const pair of pairs) {
            if (merged.length === 0) {
                merged.push(pair)
                continue
            }
            const prev = merged[merged.length - 1]
            const pSel = prev.sel
            const cSel = pair.sel
            
            // Check if cursors are at the same position
            if (prev.cursor.line === pair.cursor.line && prev.cursor.col === pair.cursor.col) {
                // Duplicate cursor — merge selections if both exist
                if (pSel && cSel) {
                    pSel.start = pSel.start.offset <= cSel.start.offset ? { ...pSel.start } : { ...cSel.start }
                    pSel.end = pSel.end.offset >= cSel.end.offset ? { ...pSel.end } : { ...cSel.end }
                } else if (!pSel && cSel) {
                    prev.sel = cSel
                }
                continue
            }
            
            // Check if selections overlap or one cursor is inside the other's selection
            if (pSel && cSel) {
                if (pSel.end.offset >= cSel.start.offset) {
                    // Overlapping — merge into prev
                    pSel.end = pSel.end.offset >= cSel.end.offset ? { ...pSel.end } : { ...cSel.end }
                    // Keep the cursor that's at the furthest extent
                    prev.cursor = pSel.isReversed ? { ...pSel.start } : { ...pSel.end }
                    continue
                }
            } else if (pSel && !cSel) {
                // Cursor inside prev's selection range — drop it
                if (pair.cursor.offset >= pSel.start.offset && pair.cursor.offset <= pSel.end.offset) {
                    continue
                }
            } else if (!pSel && cSel) {
                // Prev cursor inside this selection range — replace prev
                if (prev.cursor.offset >= cSel.start.offset && prev.cursor.offset <= cSel.end.offset) {
                    merged[merged.length - 1] = pair
                    continue
                }
            }
            
            merged.push(pair)
        }
        
        // Rebuild cursors and selections, keeping primary cursor first
        const cursors = merged.map(p => p.cursor)
        const selections = merged.filter(p => p.sel).map(p => p.sel)
        
        // Move the primary cursor (and its selection) to the front of the array
        const primaryIdx = cursors.findIndex(c =>
            c.line === primaryCursor.line && c.col === primaryCursor.col
        )
        if (primaryIdx > 0) {
            const [pc] = cursors.splice(primaryIdx, 1)
            cursors.unshift(pc)
            // Find the selection associated with this cursor
            const selIdx = selections.findIndex(s =>
                (s.start.line === pc.line && s.start.col === pc.col) ||
                (s.end.line === pc.line && s.end.col === pc.col)
            )
            if (selIdx !== -1) {
                const [ps] = selections.splice(selIdx, 1)
                selections.unshift(ps)
            }
        }
        
        this._cursors = cursors
        this._selections = selections
    }
    
    // ==========================================================================
    // LINTING
    // ==========================================================================
    
    _scheduleLint() {
        if (!this._lintProvider) return
        
        if (this._lintTimer) {
            clearTimeout(this._lintTimer)
        }
        
        this._lintTimer = setTimeout(() => {
            this._runLint()
        }, 300) // Debounce 300ms
    }
    
    async _runLint() {
        if (!this._lintProvider) return
        
        const version = ++this._lintVersion
        const code = this._getText()
        
        try {
            const diagnostics = await this._lintProvider(code)
            
            // Check if still current
            if (version !== this._lintVersion) return
            
            this.setDiagnostics(diagnostics || [])
        } catch (e) {
            console.error('Lint error:', e)
        }
    }
    
    // ==========================================================================
    // PREVIEW ENTRIES (Pills)
    // ==========================================================================
    
    _updatePreviewEntries() {
        if (!this._previewEntriesProvider) {
            this._previewEntries = []
            return
        }
        
        const now = Date.now()
        const versionChanged = this._previewEntriesVersion !== this._version
        const stale = now - this._lastPreviewRefreshTime > 200
        
        if (!versionChanged && !stale) return
        
        try {
            const entries = this._previewEntriesProvider(this._getText())
            this._previewEntries = entries || []
            this._previewEntriesVersion = this._version
            this._lastPreviewRefreshTime = now
        } catch (e) {
            console.error('Preview entries error:', e)
            this._previewEntries = []
        }
    }
    
    _getPreviewEntriesForLine(lineIndex) {
        this._updatePreviewEntries()
        
        const lineStart = this._getOffset(lineIndex, 0)
        const lineEnd = lineStart + this._lines[lineIndex].length
        
        return this._previewEntries.filter(entry => {
            return entry.start >= lineStart && entry.start < lineEnd
        }).map(entry => {
            const pos = this._getPositionFromOffset(entry.start)
            return { ...entry, col: pos.col }
        })
    }
    
    // ==========================================================================
    // TOKENIZATION & SYNTAX HIGHLIGHTING
    // ==========================================================================
    
    _tokenizeLine(lineIndex) {
        if (this._tokenCacheVersion === this._version && this._tokenCache.has(lineIndex)) {
            return this._tokenCache.get(lineIndex)
        }
        
        const line = this._lines[lineIndex]
        if (!line) return []
        
        const tokens = []
        const rules = this._languageRules?.rules || []
        
        // Mark all character positions
        const marks = new Array(line.length).fill(null)
        
        for (const rule of rules) {
            const regex = new RegExp(rule.regex.source, rule.regex.flags.replace('g', '') + 'g')
            let match
            
            while ((match = regex.exec(line)) !== null) {
                const start = match.index
                const end = match.index + match[0].length
                
                // Only mark if not already marked
                let canMark = true
                for (let i = start; i < end; i++) {
                    if (marks[i] !== null) {
                        canMark = false
                        break
                    }
                }
                
                if (canMark) {
                    // If rule has subTokens function, expand into multiple tokens
                    if (rule.subTokens) {
                        const subs = rule.subTokens(match[0], start)
                        for (const sub of subs) {
                            for (let i = sub.start; i < sub.end; i++) {
                                marks[i] = sub.type
                            }
                            tokens.push(sub)
                        }
                    } else {
                        for (let i = start; i < end; i++) {
                            marks[i] = rule.className
                        }
                        tokens.push({
                            start,
                            end,
                            type: rule.className,
                            text: match[0]
                        })
                    }
                }
            }
        }
        
        // Sort tokens by start position
        tokens.sort((a, b) => a.start - b.start)
        
        // Cache
        if (this._tokenCacheVersion !== this._version) {
            this._tokenCache.clear()
            this._tokenCacheVersion = this._version
        }
        this._tokenCache.set(lineIndex, tokens)
        
        return tokens
    }
    
    _getTokenColor(type) {
        const colorMap = {
            'kw': this.options.tokenColors.keyword,
            'keyword': this.options.tokenColors.keyword,
            'num': this.options.tokenColors.number,
            'number': this.options.tokenColors.number,
            'str': this.options.tokenColors.string,
            'string': this.options.tokenColors.string,
            'cmt': this.options.tokenColors.comment,
            'comment': this.options.tokenColors.comment,
            'dt': this.options.tokenColors.type,
            'type': this.options.tokenColors.type,
            'type-keyword': this.options.tokenColors.type,
            'function': this.options.tokenColors.function,
            'variable': this.options.tokenColors.variable,
            'addr': this.options.tokenColors.address,
            'address': this.options.tokenColors.address,
            'dot': this.options.tokenColors.operator,
            'operator': this.options.tokenColors.operator,
            'tpl-esc': '#569cd6',
        }
        return colorMap[type] || this.options.tokenColors.default
    }
    
    // ==========================================================================
    // RENDERING
    // ==========================================================================
    
    _startRenderLoop() {
        const render = () => {
            // When preview providers are active, always re-render to pick up live value changes
            if (this._needsRender || this._previewEntriesProvider) {
                this._render()
                this._needsRender = false
            }
            this._rafId = requestAnimationFrame(render)
        }
        this._rafId = requestAnimationFrame(render)
    }
    
    _stopRenderLoop() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId)
            this._rafId = null
        }
    }
    
    _startCursorBlink() {
        this._stopCursorBlink()
        this._cursorVisible = true
        this._cursorBlinkTimer = setInterval(() => {
            this._cursorVisible = !this._cursorVisible
            this._needsRender = true
        }, 530)
    }
    
    _stopCursorBlink() {
        if (this._cursorBlinkTimer) {
            clearInterval(this._cursorBlinkTimer)
            this._cursorBlinkTimer = null
        }
        this._cursorVisible = false
    }
    
    _resetCursorBlink() {
        this._cursorVisible = true
        this._startCursorBlink()
    }
    
    _render() {
        // Clear line gaps cache for this frame
        this._lineGapsCache.clear()
        
        const ctx = this._ctx
        const opts = this.options
        const colors = opts.colors
        const dpr = window.devicePixelRatio || 1
        
        // Reset transform
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(dpr, dpr)
        
        // Clear
        ctx.fillStyle = colors.background
        ctx.fillRect(0, 0, this._width, this._height)
        
        // Calculate visible line range
        const firstVisibleLine = Math.floor(this._scrollY / this._lineHeight)
        const lastVisibleLine = Math.min(
            this._lines.length - 1,
            firstVisibleLine + this._visibleLines
        )
        
        const contentX = opts.gutterWidth + opts.padding
        const baseY = opts.padding - (this._scrollY % this._lineHeight)
        
        // Draw gutter
        ctx.fillStyle = colors.gutter
        ctx.fillRect(0, 0, opts.gutterWidth, this._height)
        
        // Gutter border
        ctx.strokeStyle = colors.gutterBorder
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(opts.gutterWidth - 0.5, 0)
        ctx.lineTo(opts.gutterWidth - 0.5, this._height)
        ctx.stroke()
        
        // Draw line numbers
        ctx.font = opts.font
        ctx.textBaseline = 'top'
        ctx.textAlign = 'right'
        
        const primaryLine = (this._selectedPill) ? -1 : (this._cursors[0]?.line ?? -1)
        
        for (let i = firstVisibleLine; i <= lastVisibleLine; i++) {
            const y = baseY + (i - firstVisibleLine) * this._lineHeight
            const lineNum = (i + 1).toString()
            ctx.fillStyle = i === primaryLine ? colors.gutterTextActive : colors.gutterText
            ctx.fillText(lineNum, opts.gutterWidth - 8, y + (this._lineHeight - 14) / 2)
        }
        
        // Set clipping for content area
        ctx.save()
        ctx.beginPath()
        ctx.rect(opts.gutterWidth, 0, this._width - opts.gutterWidth, this._height)
        ctx.clip()
        
        // Draw word occurrence highlights (before selections so selections draw on top)
        this._renderWordHighlights(ctx, firstVisibleLine, lastVisibleLine, contentX, baseY)
        
        // Draw external highlight ranges (from problem panel hover/selection)
        this._renderHighlightRange(ctx, this._hoverHighlightRange, 'rgba(255, 255, 255, 0.08)', firstVisibleLine, lastVisibleLine, contentX, baseY)
        this._renderHighlightRange(ctx, this._selectedHighlightRange, 'rgba(255, 200, 50, 0.12)', firstVisibleLine, lastVisibleLine, contentX, baseY)
        
        // Draw selections
        this._renderAllSelections(ctx, firstVisibleLine, lastVisibleLine, contentX, baseY)
        
        // Erase selection colour behind pill gaps (so selections visually skip the gap)
        for (let i = firstVisibleLine; i <= lastVisibleLine; i++) {
            const gaps = this._getLineGaps(i)
            if (gaps.length === 0) continue
            const lineY = baseY + (i - firstVisibleLine) * this._lineHeight
            for (const g of gaps) {
                const gapStartVCol = this._textToVisualCol(g.insertAt, gaps) - g.widthCols
                const gapX = contentX + gapStartVCol * this._charWidth - this._scrollX
                const gapW = g.widthCols * this._charWidth
                ctx.fillStyle = colors.background
                ctx.fillRect(gapX, lineY, gapW, this._lineHeight)
            }
        }
        
        // Draw current line highlight (border top + bottom) for all cursor rows when no selections exist
        if (this._selections.length === 0 && !this._selectedPill) {
            ctx.strokeStyle = colors.lineHighlight
            ctx.lineWidth = 1
            const drawnLines = new Set()
            for (const cursor of this._cursors) {
                if (cursor.line >= firstVisibleLine && cursor.line <= lastVisibleLine && !drawnLines.has(cursor.line)) {
                    drawnLines.add(cursor.line)
                    const y = baseY + (cursor.line - firstVisibleLine) * this._lineHeight
                    ctx.beginPath()
                    ctx.moveTo(opts.gutterWidth, y + 0.5)
                    ctx.lineTo(this._width, y + 0.5)
                    ctx.moveTo(opts.gutterWidth, y + this._lineHeight - 0.5)
                    ctx.lineTo(this._width, y + this._lineHeight - 0.5)
                    ctx.stroke()
                }
            }
        }
        
        // Draw text with syntax highlighting
        ctx.textAlign = 'left'
        
        for (let i = firstVisibleLine; i <= lastVisibleLine; i++) {
            const line = this._lines[i]
            const y = baseY + (i - firstVisibleLine) * this._lineHeight + (this._lineHeight - 14) / 2
            const x = contentX - this._scrollX
            const gaps = this._getLineGaps(i)
            
            const tokens = this._tokenizeLine(i)
            this._renderLineTokens(ctx, line, tokens, x, y, gaps)
            
            // Draw diagnostics (squiggly lines)
            this._renderLineDiagnostics(ctx, i, x, y, gaps)
            
            // Draw pills for this line
            if (this._previewEntriesProvider) {
                const entries = this._getPreviewEntriesForLine(i)
                this._renderLinePills(ctx, i, entries, x, baseY + (i - firstVisibleLine) * this._lineHeight, gaps)
            }
        }
        
        // Draw Ctrl+hover link underline highlight (go-to-definition)
        this._renderLinkHighlight(ctx, firstVisibleLine, lastVisibleLine, contentX, baseY)
        
        // Draw cursors (hidden when a pill is selected or in readOnly mode)
        if (this._cursorVisible && document.activeElement === this._input && !this._selectedPill && !this.options.readOnly) {
            ctx.fillStyle = colors.cursor
            
            for (const cursor of this._cursors) {
                if (cursor.line >= firstVisibleLine && cursor.line <= lastVisibleLine) {
                    const gaps = this._getLineGaps(cursor.line)
                    const visualCol = this._textToVisualCol(cursor.col, gaps)
                    const x = contentX + visualCol * this._charWidth - this._scrollX
                    const y = baseY + (cursor.line - firstVisibleLine) * this._lineHeight
                    ctx.fillRect(x, y, 2, this._lineHeight)
                }
            }
        }
        
        ctx.restore()
    }
    
    /** Groups and renders all selection highlights with rounded corners and sharp cursor-side edges */
    _renderAllSelections(ctx, firstLine, lastLine, contentX, baseY) {
        if (this._selections.length === 0) return
        
        const gap = 1 // 1px gap above and below each selection group
        const radius = 3 // Corner rounding radius
        const focused = document.activeElement === this._input
        
        ctx.fillStyle = focused ? this.options.colors.selection : this.options.colors.selectionInactive
        
        // Convert selections to row-rect arrays
        const selGroups = []
        for (const sel of this._selections) {
            if (!sel) continue
            const sl = Math.max(sel.start.line, firstLine)
            const el = Math.min(sel.end.line, lastLine)
            const rows = []
            for (let line = sl; line <= el; line++) {
                const lineText = this._lines[line]
                const sc = (line === sel.start.line) ? sel.start.col : 0
                const ec = (line === sel.end.line) ? sel.end.col : lineText.length
                const gaps = this._getLineGaps(line)
                const vsc = this._textToVisualCol(sc, gaps)
                const vec = this._textToVisualCol(ec, gaps)
                const x = contentX + vsc * this._charWidth - this._scrollX
                const w = (vec - vsc) * this._charWidth
                rows.push({ line, left: x, right: x + Math.max(w, 4) })
            }
            if (rows.length > 0) selGroups.push({ rows, isReversed: !!sel.isReversed })
        }
        
        // Merge adjacent single-row selections with matching left/right (from block select)
        const merged = this._mergeAdjacentSelGroups(selGroups)
        
        for (const group of merged) {
            const { points, rightSideIndices, leftSideIndices } =
                this._buildSelectionPolygon(group.rows, firstLine, baseY, gap)
            // In readOnly mode all edges are rounded (no cursor side)
            const sharpIndices = this.options.readOnly ? new Set() : (group.isReversed ? leftSideIndices : rightSideIndices)
            this._drawRoundedPolygon(ctx, points, radius, sharpIndices)
        }
    }
    
    /** Merge adjacent same-column single-row selections into combined groups */
    _mergeAdjacentSelGroups(groups) {
        if (groups.length <= 1) return groups
        const result = []
        const singles = []
        for (const g of groups) {
            if (g.rows.length === 1) singles.push(g)
            else result.push(g)
        }
        singles.sort((a, b) => a.rows[0].line - b.rows[0].line)
        let cur = null
        for (const s of singles) {
            const row = s.rows[0]
            if (cur) {
                const last = cur.rows[cur.rows.length - 1]
                if (row.line === last.line + 1 &&
                    Math.abs(row.left - last.left) < 0.5 &&
                    Math.abs(row.right - last.right) < 0.5) {
                    cur.rows.push({ ...row })
                    continue
                }
            }
            if (cur) result.push(cur)
            cur = { rows: [{ ...row }], isReversed: s.isReversed }
        }
        if (cur) result.push(cur)
        return result
    }
    
    /** Build polygon outline from rows with 1px gap at top/bottom of the merged shape */
    _buildSelectionPolygon(rows, firstLine, baseY, gap) {
        const n = rows.length
        const lh = this._lineHeight
        const topY = baseY + (rows[0].line - firstLine) * lh + gap
        const bottomY = baseY + (rows[n - 1].line - firstLine + 1) * lh - gap
        
        const points = []
        const rightSide = new Set()
        const leftSide = new Set()
        
        // Top-left corner (left side)
        leftSide.add(points.length)
        points.push({ x: rows[0].left, y: topY })
        // Top-right corner (right side)
        rightSide.add(points.length)
        points.push({ x: rows[0].right, y: topY })
        
        // Right side going down — add step corners where right edge changes
        for (let i = 0; i < n - 1; i++) {
            const yt = baseY + (rows[i + 1].line - firstLine) * lh
            if (Math.abs(rows[i].right - rows[i + 1].right) > 0.5) {
                rightSide.add(points.length)
                points.push({ x: rows[i].right, y: yt })
                rightSide.add(points.length)
                points.push({ x: rows[i + 1].right, y: yt })
            }
        }
        
        // Bottom-right corner (right side)
        rightSide.add(points.length)
        points.push({ x: rows[n - 1].right, y: bottomY })
        // Bottom-left corner (left side)
        leftSide.add(points.length)
        points.push({ x: rows[n - 1].left, y: bottomY })
        
        // Left side going up — add step corners where left edge changes
        for (let i = n - 1; i > 0; i--) {
            const yt = baseY + (rows[i].line - firstLine) * lh
            if (Math.abs(rows[i].left - rows[i - 1].left) > 0.5) {
                leftSide.add(points.length)
                points.push({ x: rows[i].left, y: yt })
                leftSide.add(points.length)
                points.push({ x: rows[i - 1].left, y: yt })
            }
        }
        
        return { points, rightSideIndices: rightSide, leftSideIndices: leftSide }
    }
    
    /** Draw a polygon with rounded corners, sharp at specified vertex indices */
    _drawRoundedPolygon(ctx, points, radius, sharpIndices) {
        const n = points.length
        if (n < 3) return
        
        ctx.beginPath()
        // Start from midpoint of edge between last and first point
        const midX = (points[n - 1].x + points[0].x) / 2
        const midY = (points[n - 1].y + points[0].y) / 2
        ctx.moveTo(midX, midY)
        
        for (let i = 0; i < n; i++) {
            const curr = points[i]
            const next = points[(i + 1) % n]
            const prev = points[(i - 1 + n) % n]
            // Clamp radius so it doesn't exceed half of either adjacent edge
            const lenPrev = Math.abs(prev.x - curr.x) + Math.abs(prev.y - curr.y)
            const lenNext = Math.abs(next.x - curr.x) + Math.abs(next.y - curr.y)
            const maxR = Math.min(lenPrev, lenNext) / 2
            const r = sharpIndices.has(i) ? 0 : Math.min(radius, Math.max(0, maxR))
            ctx.arcTo(curr.x, curr.y, next.x, next.y, r)
        }
        
        ctx.closePath()
        ctx.fill()
    }
    
    _renderLineTokens(ctx, line, tokens, x, y, gaps) {
        const charW = this._charWidth
        
        // Compute pixel X for a text column, accounting for gaps
        const vx = (col) => x + this._textToVisualCol(col, gaps) * charW
        
        // Render a text segment, splitting at gap boundaries if needed
        const drawSeg = (text, startCol, color) => {
            if (!text) return
            ctx.fillStyle = color
            if (!gaps || gaps.length === 0) {
                ctx.fillText(text, vx(startCol), y)
                return
            }
            let segStart = startCol
            const segEnd = startCol + text.length
            for (const g of gaps) {
                if (g.insertAt >= segEnd) break
                if (g.insertAt > segStart) {
                    ctx.fillText(text.slice(segStart - startCol, g.insertAt - startCol), vx(segStart), y)
                    segStart = g.insertAt
                }
            }
            if (segStart < segEnd) {
                ctx.fillText(text.slice(segStart - startCol), vx(segStart), y)
            }
        }
        
        if (tokens.length === 0) {
            drawSeg(line, 0, this.options.colors.text)
            return
        }
        
        let pos = 0
        for (const token of tokens) {
            if (token.start > pos) {
                drawSeg(line.slice(pos, token.start), pos, this.options.colors.text)
            }
            drawSeg(token.text, token.start, this._getTokenColor(token.type))
            pos = token.end
        }
        
        if (pos < line.length) {
            drawSeg(line.slice(pos), pos, this.options.colors.text)
        }
    }
    
    _renderLineDiagnostics(ctx, lineIndex, x, y, gaps) {
        const lineDiagnostics = this._diagnostics.filter(d => {
            const pos = this._getPositionFromOffset(d.start)
            return pos.line === lineIndex
        })
        
        for (const diag of lineDiagnostics) {
            const startPos = this._getPositionFromOffset(diag.start)
            const endPos = this._getPositionFromOffset(diag.end)
            
            if (startPos.line !== lineIndex) continue
            
            const startCol = startPos.col
            const endCol = (endPos.line === lineIndex) ? endPos.col : this._lines[lineIndex].length
            
            const vStart = this._textToVisualCol(startCol, gaps)
            const vEnd = this._textToVisualCol(endCol, gaps)
            const squiggleX = x + vStart * this._charWidth
            const squiggleWidth = Math.max((vEnd - vStart) * this._charWidth, this._charWidth)
            const squiggleY = y + 14 + 2 // Below text
            
            // Draw squiggly line
            ctx.strokeStyle = diag.type === 'error' ? this.options.colors.errorSquiggle :
                             diag.type === 'warning' ? this.options.colors.warningSquiggle :
                             this.options.colors.infoSquiggle
            ctx.lineWidth = 1
            ctx.beginPath()
            
            const amplitude = 2
            const wavelength = 4
            let currX = squiggleX
            
            while (currX < squiggleX + squiggleWidth) {
                const phase = (currX - squiggleX) / wavelength * Math.PI * 2
                const offsetY = Math.sin(phase) * amplitude
                
                if (currX === squiggleX) {
                    ctx.moveTo(currX, squiggleY + offsetY)
                } else {
                    ctx.lineTo(currX, squiggleY + offsetY)
                }
                currX += 1
            }
            
            ctx.stroke()
        }
    }
    
    _renderLinePills(ctx, lineIndex, entries, x, lineY, gaps) {
        if (!entries || entries.length === 0) return
        
        const colors = this.options.colors
        const charW = this._charWidth
        const lineH = this._lineHeight
        const compact = this._lines.length <= 1
        const pillHeight = compact ? 12 : 14
        const pillFontSize = compact ? 9 : 10
        
        for (const entry of entries) {
            // Get value from provider
            let value = null
            let pillClass = ''
            
            if (this._previewValueProvider) {
                const val = this._previewValueProvider(entry)
                if (val === null || val === undefined) continue
                
                if (typeof val === 'object') {
                    value = val.text ?? ''
                    pillClass = val.className || ''
                } else {
                    value = String(val)
                }
            } else {
                continue // No provider, skip pills
            }
            
            const pillText = value
            const tokenLen = entry.end - entry.start
            const insertAt = entry.col + tokenLen
            
            // Find this entry's gap to get the char-aligned dimensions
            const thisGap = gaps ? gaps.find(g => g.insertAt === insertAt) : null
            const pillCols = thisGap ? thisGap.pillCols : Math.max(4, Math.ceil(Math.max(ctx.measureText(pillText).width + 12, 32) / charW))
            const pillWidth = pillCols * charW
            
            // Position pill in the gap region
            const gapStartVCol = thisGap
                ? this._textToVisualCol(insertAt, gaps) - thisGap.widthCols
                : (entry.col + tokenLen)
            const pillX = x + (gapStartVCol + 0.5) * charW
            const pillY = lineY + (lineH - pillHeight) / 2
            const pillRadius = 3
            
            ctx.font = `${pillFontSize}px Consolas, monospace`
            
            // Determine colors based on class
            let bgColor = colors.pillBackground
            let borderColor = colors.pillBorder
            let textColor = colors.pillText
            
            if (pillClass.includes('on')) {
                textColor = colors.pillOn
                borderColor = colors.pillOn
                bgColor = '#3a3a3a'
            } else if (pillClass.includes('off')) {
                textColor = colors.pillOff
                borderColor = '#555'
                bgColor = '#3a3a3a'
            }
            
            // Draw pill background
            ctx.fillStyle = bgColor
            ctx.strokeStyle = borderColor
            ctx.lineWidth = 1
            
            ctx.beginPath()
            ctx.roundRect(pillX, pillY, pillWidth, pillHeight, pillRadius)
            ctx.fill()
            ctx.stroke()
            
            // Draw selection emphasis if this pill is selected
            const isSelected = this._selectedPill &&
                entry.start === this._selectedPill.start &&
                entry.end === this._selectedPill.end
            if (isSelected) {
                ctx.strokeStyle = '#007acc'
                ctx.lineWidth = 1.5
                ctx.beginPath()
                ctx.roundRect(pillX - 2, pillY - 2, pillWidth + 4, pillHeight + 4, pillRadius + 1)
                ctx.stroke()
                // Outer glow
                ctx.strokeStyle = colors.pillSelected
                ctx.lineWidth = 2
                ctx.beginPath()
                ctx.roundRect(pillX - 4, pillY - 4, pillWidth + 8, pillHeight + 8, pillRadius + 2)
                ctx.stroke()
            }
            
            // Draw pill text
            ctx.fillStyle = textColor
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.font = `${pillFontSize}px Consolas, monospace`
            ctx.fillText(pillText, pillX + pillWidth / 2, pillY + pillHeight / 2)
            
            // Reset font
            ctx.font = this.options.font
            ctx.textAlign = 'left'
            ctx.textBaseline = 'top'
        }
    }
    
    // ==========================================================================
    // PUBLIC API
    // ==========================================================================
    
    /**
     * Set the editor content
     * @param {string} value
     */
    setValue(value) {
        this._setText(value || '')
        this._cursors = [{ line: 0, col: 0, offset: 0 }]
        this._selections = []
        this._scrollX = 0
        this._scrollY = 0
        this._undoStack = []
        this._redoStack = []
        this._lastUndoText = value || ''
        this._pendingUndoEntry = null
        this._lastCursorSnapshot = this._snapshotCursorState()
    }
    
    /**
     * Get the editor content
     * @returns {string}
     */
    getValue() {
        return this._getText()
    }
    
    /**
     * Set diagnostics (errors, warnings)
     * @param {CCE_Diagnostic[]} diagnostics
     */
    setDiagnostics(diagnostics) {
        this._diagnostics = diagnostics || []
        this._needsRender = true
        if (this._onDiagnosticsChange) {
            this._onDiagnosticsChange(this._diagnostics)
        }
    }
    
    /**
     * Set hover highlight range (from problem panel hover)
     * @param {{start: number, end: number}|null} range
     */
    setHoverHighlight(range) {
        if (!range) {
            this._hoverHighlightRange = null
        } else {
            this._hoverHighlightRange = range
        }
        this._needsRender = true
    }
    
    /**
     * Set selected highlight range (from problem panel selection)
     * @param {{start: number, end: number}|null} range
     */
    setSelectedHighlight(range) {
        if (!range) {
            this._selectedHighlightRange = null
        } else {
            this._selectedHighlightRange = range
        }
        this._needsRender = true
    }
    
    /**
     * Get pixel position for a code offset
     * @param {number} index
     * @returns {{x: number, y: number, height: number, viewportX: number, viewportY: number, scrollTop: number, scrollLeft: number, rect: DOMRect}}
     */
    getCodePosition(index) {
        const pos = this._getPositionFromOffset(index)
        const gaps = this._getLineGaps(pos.line)
        const visualCol = this._textToVisualCol(pos.col, gaps)
        const x = visualCol * this._charWidth
        const y = pos.line * this._lineHeight
        const rect = this._canvas.getBoundingClientRect()
        return {
            x,
            y,
            height: this._lineHeight,
            viewportX: rect.left + this.options.gutterWidth + this.options.padding + x - this._scrollX,
            viewportY: rect.top + this.options.padding + y - this._scrollY,
            scrollTop: this._scrollY,
            scrollLeft: this._scrollX,
            rect,
        }
    }
    
    /**
     * Show a lint tooltip for a code range (called from problem panel)
     * @param {{start: number, end: number}|null} range
     * @param {{highlight?: boolean, notify?: boolean}} opts
     * @returns {boolean}
     */
    showLintTooltip(range, opts = {}) {
        if (!range) {
            this._clearLintHover()
            return false
        }
        if (!this._diagnostics.length) return false
        
        const start = typeof range.start === 'number' ? range.start : null
        const end = typeof range.end === 'number' ? range.end : null
        if (start === null) return false
        
        const hit = this._diagnostics.find(d => start >= d.start && start < d.end)
            || this._diagnostics.find(d => end !== null && d.start < end && d.end > start)
        if (!hit) return false
        
        // Check if the diagnostic is visible
        const startPos = this._getPositionFromOffset(hit.start)
        const lineY = startPos.line * this._lineHeight
        if (lineY + this._lineHeight < this._scrollY || lineY > this._scrollY + this._height) return false
        
        const canvasRect = this._canvas.getBoundingClientRect()
        const viewportY = canvasRect.top + this.options.padding + lineY - this._scrollY
        const body = this.container.closest('.plc-editor-body')
        if (body) {
            const bodyRect = body.getBoundingClientRect()
            if (viewportY < bodyRect.top || viewportY + this._lineHeight > bodyRect.bottom) return false
        }
        
        this._showLintHoverAt(0, 0, hit, {
            highlight: opts.highlight !== false,
            notify: opts.notify === true,
        })
        return true
    }
    
    /**
     * Set pills (inline components)
     * @param {CCE_Pill[]} pills
     */
    setPills(pills) {
        this._pills = pills || []
        this._needsRender = true
    }
    
    /**
     * Set read-only mode
     * @param {boolean} readOnly
     */
    setReadOnly(readOnly) {
        this.options.readOnly = readOnly
    }
    
    /**
     * Focus the editor
     */
    focus() {
        this._input.focus()
    }
    
    /**
     * Check if editor is focused
     * @returns {boolean}
     */
    isFocused() {
        return document.activeElement === this._input
    }
    
    /**
     * Set scroll position
     * @param {{top?: number, left?: number}} pos
     */
    setScroll(pos) {
        if (typeof pos.top === 'number') {
            this._scrollY = Math.max(0, pos.top)
        }
        if (typeof pos.left === 'number') {
            this._scrollX = Math.max(0, pos.left)
        }
        this._needsRender = true
    }
    
    /**
     * Get scroll position
     * @returns {{top: number, left: number}}
     */
    getScroll() {
        return { top: this._scrollY, left: this._scrollX }
    }
    
    /**
     * Set cursor position.
     * Supports two signatures:
     *   setCursor(line, col)        — 0-based line and column
     *   setCursor(index, opts)      — character offset + options object (MCE-compatible)
     *     opts.reveal          {boolean}  scroll to make cursor visible (default true)
     *     opts.suppressHistory {boolean}  suppress history recording temporarily
     *     opts.record          {boolean}  schedule a history record
     *     opts.ratio           {number}   viewport ratio for scroll alignment
     * @param {number} lineOrIndex
     * @param {number | {reveal?: boolean, suppressHistory?: boolean, record?: boolean, ratio?: number}} colOrOpts
     */
    setCursor(lineOrIndex, colOrOpts) {
        if (typeof colOrOpts === 'object' && colOrOpts !== null) {
            // MCE-compatible signature: setCursor(index, opts)
            const text = this._getText()
            const maxLen = text.length
            const safeIndex = Math.max(0, Math.min(typeof lineOrIndex === 'number' ? lineOrIndex : 0, maxLen))
            const pos = this._getPositionFromOffset(safeIndex)

            if (colOrOpts.suppressHistory) {
                this._suppressHistory(120)
            }

            this._cursors = [pos]
            this._selections = []
            this._needsRender = true
            this._input.focus()

            if (colOrOpts.reveal !== false) {
                const ratio = typeof colOrOpts.ratio === 'number' ? colOrOpts.ratio : 0.33
                this.revealRange({ start: safeIndex, end: safeIndex + 1 }, { ratio, highlight: false })
            }

            if (colOrOpts.record) {
                this._scheduleHistory()
            }
        } else {
            // Original signature: setCursor(line, col)
            const line = Math.max(0, Math.min(lineOrIndex, this._lines.length - 1))
            const col = Math.max(0, Math.min(typeof colOrOpts === 'number' ? colOrOpts : 0, this._lines[line].length))
            const offset = this._getOffset(line, col)

            this._cursors = [{ line, col, offset }]
            this._selections = []
            this._ensureCursorVisible()
            this._needsRender = true
        }
    }
    
    /**
     * Reveal a range (scroll to make it visible)
     * @param {{start: number, end: number}} range
     * @param {{ratio?: number, showTooltip?: boolean, highlight?: boolean, tooltipHighlight?: boolean}} opts
     * @returns {boolean}
     */
    revealRange(range, opts = {}) {
        if (!range || typeof range.start !== 'number') return false
        const ratio = typeof opts.ratio === 'number' ? opts.ratio : 0.33
        
        // Scroll to position
        const pos = this._getPositionFromOffset(range.start)
        const targetY = Math.max(0, pos.line * this._lineHeight - this._height * ratio)
        if (Math.abs(this._scrollY - targetY) > 1) {
            this._scrollY = targetY
        }
        this._cursors = [{ line: pos.line, col: pos.col, offset: range.start }]
        this._selections = []
        this._needsRender = true
        
        // Apply highlight
        if (opts.highlight !== false) {
            this._hoverHighlightRange = range
        }
        
        // Show tooltip after layout
        if (opts.showTooltip) {
            const tooltipHighlight = opts.tooltipHighlight !== false
            requestAnimationFrame(() => {
                this.showLintTooltip(range, { highlight: tooltipHighlight })
            })
        }
        
        return true
    }
    
    /**
     * Dispose the editor and clean up resources
     */
    dispose() {
        this._stopRenderLoop()
        this._stopCursorBlink()
        this._hideHover()
        this._hideAutocomplete()
        
        if (this._hoverEl && this._hoverEl.parentNode) {
            this._hoverEl.parentNode.removeChild(this._hoverEl)
            this._hoverEl = null
        }
        
        if (this._acEl && this._acEl.parentNode) {
            this._acEl.parentNode.removeChild(this._acEl)
            this._acEl = null
        }
        
        if (this._hintEl && this._hintEl.parentNode) {
            this._hintEl.parentNode.removeChild(this._hintEl)
            this._hintEl = null
        }
        
        if (this._acDocClick) {
            document.removeEventListener('mousedown', this._acDocClick)
            this._acDocClick = null
        }
        
        // Clean up Ctrl key listeners for link hover
        if (this._handleCtrlKey) {
            document.removeEventListener('keydown', this._handleCtrlKey)
            document.removeEventListener('keyup', this._handleCtrlKey)
            this._handleCtrlKey = null
        }
        
        if (this._historyTimer) {
            clearTimeout(this._historyTimer)
            this._historyTimer = null
        }
        
        if (this._lintTimer) {
            clearTimeout(this._lintTimer)
            this._lintTimer = null
        }
        
        if (this._resizeObserver) {
            this._resizeObserver.disconnect()
        }
        
        // Remove DOM elements
        if (this._canvas && this._canvas.parentNode) {
            this._canvas.parentNode.removeChild(this._canvas)
        }
        if (this._input && this._input.parentNode) {
            this._input.parentNode.removeChild(this._input)
        }
        
        this._canvas = null
        this._ctx = null
        this._input = null
        this._onChange = null
        this._onScroll = null
        this._lintProvider = null
        this._previewEntriesProvider = null
        this._previewValueProvider = null
        this._onPreviewAction = null
        this._onPreviewContextMenu = null
    }
    
    // ==========================================================================
    // STATIC: LANGUAGE REGISTRATION
    // ==========================================================================
    
    static languages = {}
    
    /**
     * Register a language for syntax highlighting
     * @param {string} name
     * @param {Object} config
     */
    static registerLanguage(name, config) {
        CanvasCodeEditor.languages[name.toLowerCase()] = config
    }
}

// ==========================================================================
// REGISTER DEFAULT LANGUAGES
// ==========================================================================

// Plain text (no highlighting)
CanvasCodeEditor.registerLanguage('text', { rules: [] })

// JSON
CanvasCodeEditor.registerLanguage('json', {
    rules: [
        { regex: /"(?:\\.|[^"\\])*"\s*(?=:)/g, className: 'variable' }, // property keys
        { regex: /"(?:\\.|[^"\\])*"/g, className: 'str' },              // string values
        { regex: /\b(true|false|null)\b/g, className: 'kw' },           // literals
        { regex: /-?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, className: 'num' }, // numbers
        { regex: /[{}\[\]]/g, className: 'dot' },                       // braces / brackets
        { regex: /[:,]/g, className: 'dot' },                            // colon, comma
    ],
})

// ---- ASM instruction definitions (for autocomplete) ----
const _asmDoc = (args, desc, ex) => {
    const a = args || []
    a.description = desc
    a.example = ex
    return a
}

const _asmTypes = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64', 'f32', 'f64']

const _commonMath = { add: [], sub: [], mul: [], div: [], mod: [], pow: [], sqrt: [], neg: [], abs: [], sin: [], cos: [] }
const _commonCmp = { cmp_eq: [], cmp_neq: [], cmp_gt: [], cmp_lt: [], cmp_gte: [], cmp_lte: [] }
const _commonLogic = {
    and: [], or: [], xor: [], not: [],
    lshift: [{name:'bits', type:'number'}],
    rshift: [{name:'bits', type:'number'}]
}
const _commonStack = {
    const: _asmDoc([{name:'value', type:'number'}], 'Push constant value to stack.', 'u8.const 10'),
    move: _asmDoc([], 'Move value from stack to memory using pointer from the stack.', 'u8.move'),
    load: _asmDoc([], 'Load value from memory to stack using pointer from the stack.', 'u8.load'),
    move_copy: _asmDoc([], 'Move value from stack to memory (keeps value on stack).', 'u8.move_copy'),
    load_from: _asmDoc([{name: 'addr', type: 'symbol'}], 'Load value from memory using immediate address.', 'u8.load_from var1'),
    move_to: _asmDoc([{name: 'addr', type: 'symbol'}], 'Move value from stack to memory using immediate address.', 'u8.move_to var1'),
    copy: _asmDoc([], 'Duplicate the top value on the stack.', 'u8.copy'),
    swap: _asmDoc([], 'Swap the top two values on the stack.', 'u8.swap'),
    drop: _asmDoc([], 'Discard the top value on the stack.', 'u8.drop'),
    set: _asmDoc([{name:'bit', type:'number'}], 'Set a specific bit to 1.', 'u8.set 0'),
    get: _asmDoc([{name:'bit', type:'number'}], 'Get a specific bit (0 or 1).', 'u8.get 0'),
    rset: _asmDoc([{name:'bit', type:'number'}], 'Reset a specific bit to 0.', 'u8.rset 0'),
}

const _typeOps = {}
_asmTypes.forEach(t => {
    _typeOps[t] = { ..._commonMath, ..._commonCmp, ..._commonStack }
    if (!t.startsWith('f')) Object.assign(_typeOps[t], _commonLogic)
})

const _asmInstructions = {
    ptr: {
        const: _asmDoc([{name: 'address', type: 'symbol'}], 'Load address of a symbol into pointer register', 'ptr.const symbol1'),
        copy: _asmDoc([], 'Copy pointer value', 'ptr.copy'),
        load: _asmDoc([], 'Load value from address pointed to by register', 'ptr.load'),
    },
    ..._typeOps,
    u8: {
        ..._typeOps.u8,
        readBit: _asmDoc([{name: 'addr.bit', type: 'bit_symbol'}], 'Read a single bit from a byte variable.', 'u8.readBit input1'),
        readBitDU: _asmDoc([{name: 'input', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Rising Edge Contact (R_TRIG).', 'u8.readBitDU input1 state_var'),
        readBitDD: _asmDoc([{name: 'input', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Falling Edge Contact (F_TRIG).', 'u8.readBitDD input1 state_var'),
        readBitInvDU: _asmDoc([{name: 'input', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Rising Edge on inverted input.', 'u8.readBitInvDU input1 state_var'),
        readBitInvDD: _asmDoc([{name: 'input', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Falling Edge on inverted input.', 'u8.readBitInvDD input1 state_var'),
        writeBit: _asmDoc([{name: 'addr.bit', type: 'bit_symbol'}], 'Write the accumulator LSB to a target bit.', 'u8.writeBit output1'),
        writeBitDU: _asmDoc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Pulse Coil (Rising).', 'u8.writeBitDU output1 state_var'),
        writeBitDD: _asmDoc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Pulse Coil (Falling).', 'u8.writeBitDD output1 state_var'),
        writeBitOn: _asmDoc([{name: 'addr.bit', type: 'bit_symbol'}], 'Write 1 to target bit.', 'u8.writeBitOn output1'),
        writeBitOnDU: _asmDoc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Set Coil on Rising Edge.', 'u8.writeBitOnDU output1 state_var'),
        writeBitOnDD: _asmDoc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Set Coil on Falling Edge.', 'u8.writeBitOnDD output1 state_var'),
        writeBitOff: _asmDoc([{name: 'addr.bit', type: 'bit_symbol'}], 'Write 0 to target bit.', 'u8.writeBitOff output1'),
        writeBitOffDU: _asmDoc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Reset Coil on Rising Edge.', 'u8.writeBitOffDU output1 state_var'),
        writeBitOffDD: _asmDoc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Reset Coil on Falling Edge.', 'u8.writeBitOffDD output1 state_var'),
        writeBitInv: _asmDoc([{name: 'addr.bit', type: 'bit_symbol'}], 'Write inverted accumulator LSB to a target bit.', 'u8.writeBitInv output1'),
        writeBitInvDU: _asmDoc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Pulse Coil (Inverted Rising).', 'u8.writeBitInvDU output1 state_var'),
        writeBitInvDD: _asmDoc([{name: 'target', type: 'bit_symbol'}, {name: 'state', type: 'bit_symbol'}], 'Pulse Coil (Inverted Falling).', 'u8.writeBitInvDD output1 state_var'),
        du: _asmDoc([{name: 'state', type: 'bit_symbol'}], 'Detect Rising Edge of Stack.', 'u8.du state_var'),
        add: _asmDoc([], 'Add value to accumulator.', 'u8.add'),
    },
    br: {
        save: _asmDoc([], 'Save Binary Result to BR stack.', 'br.save'),
        read: _asmDoc([], 'Read Binary Result from BR stack.', 'br.read'),
        copy: _asmDoc([], 'Copy Binary Result on BR stack.', 'br.copy'),
        drop: _asmDoc([], 'Drop Binary Result from BR stack.', 'br.drop'),
    },
    ton: _asmDoc([{name: 'timer', type: 'symbol'}, {name: 'preset', type: 'number'}], 'Timer On Delay', 'ton T0 T#1s'),
    tof: _asmDoc([{name: 'timer', type: 'symbol'}, {name: 'preset', type: 'number'}], 'Timer Off Delay', 'tof T0 T#1s'),
    tp: _asmDoc([{name: 'timer', type: 'symbol'}, {name: 'preset', type: 'number'}], 'Timer Pulse', 'tp T0 T#1s'),
    ctu: _asmDoc([{name: 'counter', type: 'symbol'}, {name: 'preset', type: 'number'}], 'Counter Up', 'ctu C0 10'),
    ctd: _asmDoc([{name: 'counter', type: 'symbol'}, {name: 'preset', type: 'number'}], 'Counter Down', 'ctd C0 10'),
    ctud: _asmDoc([{name: 'counter', type: 'symbol'}, {name: 'preset', type: 'number'}], 'Counter Up/Down', 'ctud C0 10'),
    jmp: _asmDoc([{name: 'label', type: 'label'}], 'Jump unconditionally to label', 'jmp skip_label'),
    jump: _asmDoc([{name: 'label', type: 'label'}], 'Jump unconditionally to label', 'jump target'),
    jmp_if: _asmDoc([{name: 'label', type: 'label'}], 'Jump if accumulator is non-zero', 'jmp_if cond_true'),
    jmp_if_not: _asmDoc([{name: 'label', type: 'label'}], 'Jump if accumulator is zero', 'jmp_if_not cond_false'),
    call: _asmDoc([{name: 'label', type: 'label'}], 'Call subroutine at label', 'call subroutine1'),
    ret: _asmDoc([], 'Return from subroutine', 'ret'),
    exit: _asmDoc([], 'End program execution', 'exit'),
    nop: _asmDoc([], 'No Operation', 'nop'),
    clear: _asmDoc([], 'Clear the stack.', 'clear'),
    cvt: _asmDoc([{name: 'from', type: 'type'}, {name: 'to', type: 'type'}], 'Convert value between types', 'cvt u8 f32'),
    const: _asmDoc([{name: 'name', type: 'text'}, {name: 'value', type: 'number'}], 'Define a global constant', 'const MAX_VAL 100'),
}

// Assembly (PLCASM)
CanvasCodeEditor.registerLanguage('asm', {
    rules: [
        { regex: /\/\*[\s\S]*?\*\//g, className: 'cmt' },
        { regex: /\/\/.*$/gm, className: 'cmt' },
        { regex: /T#[A-Za-z0-9_]+/gi, className: 'num' },
        { regex: /#(?:\s*\d+)?/g, className: 'num' },
        { regex: /^\s*([A-Za-z_]\w*):/gm, className: 'function' },
        { regex: /\b[IQCTXYMS]\d+(?:\.\d+)?\b/gi, className: 'addr' },
        { regex: /\b(ptr|u8|u16|u32|u64|i8|i16|i32|i64|f32|f64)\b/g, className: 'dt' },
        { regex: /\b(br)\.(save|read|copy|drop)\b/gim, className: 'type-keyword' },
        { regex: /\b(ton|tof|tp|ctu|ctd|ctud)\b/gim, className: 'type-keyword' },
        { regex: /\b(add|sub|mul|div|mod|pow|sqrt|neg|abs|sin|cos|cmp_eq|cmp_neq|cmp_gt|cmp_lt|cmp_gte|cmp_lte|and|or|xor|not|lshift|rshift|move|move_to|move_copy|load|load_from|copy|swap|drop|clear|set|get|rset|readBit|writeBit|writeBitInv|writeBitOn|writeBitOff|readBitDU|readBitDD|readBitInvDU|readBitInvDD|writeBitDU|writeBitDD|writeBitInvDU|writeBitInvDD|writeBitOnDU|writeBitOnDD|writeBitOffDU|writeBitOffDD|du|jmp(?:_if(?:_not)?)?(?:_rel)?|jump(?:_if(?:_not)?)?|call(?:_if(?:_not)?)?|ret(?:_if(?:_not)?)?|exit|loop|cvt|nop)\b/gim, className: 'kw' },
        { regex: /\./g, className: 'dot' },
        { regex: /\b\d+\.\d+|\.\d+\b/g, className: 'num' },
        { regex: /\b0x[\da-f]+|\b\d+\b/gi, className: 'num' },
        { regex: /[A-Za-z_]\w*/g, className: 'variable' },
    ],
    definitions: _asmInstructions,
    types: _asmTypes,
    typeKeywords: _asmTypes,
})

// STL (Statement List)
CanvasCodeEditor.registerLanguage('stl', {
    rules: [
        { regex: /\/\/.*$/gm, className: 'cmt' },
        { regex: /\(\*[\s\S]*?\*\)/g, className: 'cmt' },
        { regex: /^\s*([A-Za-z_]\w*)(?=\s*:(?!=))/gm, className: 'function' },
        { regex: /T#[A-Za-z0-9_]+/gi, className: 'num' },
        { regex: /#-?\d+/g, className: 'num' },
        { regex: /\b(A|AN|O|ON|NOT|SET|CLR|CLEAR)\b(?!:)/gi, className: 'kw' },
        { regex: /\b(XN?)\b(?=\s+[A-Za-z])/gi, className: 'kw' },
        { regex: /\b(S|R)\b(?=\s+[A-Za-z])/gi, className: 'kw' },
        { regex: /\b(FP|FN)\b/gi, className: 'kw' },
        { regex: /\b(TON|TOF|TP)\b/gi, className: 'type-keyword' },
        { regex: /\b(CTU|CTD|CTUD)\b/gi, className: 'type-keyword' },
        { regex: /\b(LD|LDN|ST)\b/gi, className: 'kw' },
        { regex: /[+\-*\/]I\b/gi, className: 'kw' },
        { regex: /\b(MOD|NEG|ABS)\b/gi, className: 'kw' },
        { regex: /[=<>]+I\b/gi, className: 'kw' },
        { regex: /\b(JU|JC|JCN|JMP|JMPC|JMPCN)\b/gi, className: 'kw' },
        { regex: /\b(CALL|BE|BEC|BEU|RET)\b/gi, className: 'kw' },
        { regex: /\b(AND|ANDN|OR|ORN|XOR|XORN)\b/gi, className: 'kw' },
        { regex: /\b(NETWORK)\b/gi, className: 'function' },
        { regex: /\b(NOP)\b/gi, className: 'kw' },
        { regex: /\b[IQMTCSXY]\d+(?:\.\d+)?\b/gi, className: 'addr' },
        { regex: /\b\d+\.\d+\b/g, className: 'addr' },
        { regex: /\b\d+\b/g, className: 'num' },
        { regex: /[()]/g, className: 'dot' },
        { regex: /[A-Za-z_]\w*/g, className: 'variable' },
    ],
    words: [
        'A', 'AN', 'O', 'ON', 'X', 'XN', 'NOT', 'SET', 'CLR', 'CLEAR',
        'S', 'R',
        'FP', 'FN',
        'TON', 'TOF', 'TP',
        'CTU', 'CTD', 'CTUD',
        'L', 'T', 'LD', 'LDN', 'ST',
        'MOD', 'NEG', 'ABS',
        'JU', 'JC', 'JCN', 'JMP', 'JMPC', 'JMPCN',
        'CALL', 'BE', 'BEC', 'BEU', 'RET',
        'AND', 'ANDN', 'OR', 'ORN', 'XOR', 'XORN',
        'NETWORK', 'NOP',
    ],
})

// Structured Text (IEC 61131-3)
CanvasCodeEditor.registerLanguage('st', {
    rules: [
        { regex: /\(\*[\s\S]*?\*\)/g, className: 'cmt' },
        { regex: /\/\/.*$/gm, className: 'cmt' },
        { regex: /'(?:[^'\\]|\\.)*'/g, className: 'str' },
        { regex: /\b(IF|THEN|ELSE|ELSIF|END_IF|CASE|OF|END_CASE|FOR|TO|BY|DO|END_FOR|WHILE|END_WHILE|REPEAT|UNTIL|END_REPEAT|EXIT|RETURN|VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|VAR_GLOBAL|END_VAR|AT|CONSTANT|RETAIN|FUNCTION|END_FUNCTION|FUNCTION_BLOCK|END_FUNCTION_BLOCK|PROGRAM|END_PROGRAM)\b/gi, className: 'kw' },
        { regex: /\b(BOOL|BYTE|WORD|DWORD|LWORD|SINT|INT|DINT|LINT|USINT|UINT|UDINT|ULINT|REAL|LREAL|TIME|DATE|TOD|DT|STRING|WSTRING|ARRAY|STRUCT|END_STRUCT)\b/gi, className: 'dt' },
        { regex: /\b(TRUE|FALSE)\b/gi, className: 'num' },
        { regex: /\b(AND|OR|XOR|NOT|MOD)\b/gi, className: 'kw' },
        { regex: /\b(TON|TOF|TP|CTU|CTD|CTUD|R_TRIG|F_TRIG)\b/gi, className: 'type-keyword' },
        { regex: /T#[A-Za-z0-9_]+/gi, className: 'num' },
        { regex: /%[IQMSCT][XBWD]?\d+(?:\.\d+)?/gi, className: 'addr' },
        { regex: /\b\d+\.\d+\b/g, className: 'num' },
        { regex: /\b\d+\b/g, className: 'num' },
        { regex: /:=|<=|>=|<>|[+\-*\/=<>]/g, className: 'dot' },
        { regex: /[();,\[\]]/g, className: 'dot' },
        { regex: /[A-Za-z_]\w*/g, className: 'variable' },
    ],
    words: [
        'IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF', 'CASE', 'OF', 'END_CASE',
        'FOR', 'TO', 'BY', 'DO', 'END_FOR', 'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT', 'EXIT', 'RETURN',
        'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_GLOBAL', 'END_VAR', 'AT', 'CONSTANT', 'RETAIN',
        'FUNCTION', 'END_FUNCTION', 'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK', 'PROGRAM', 'END_PROGRAM',
        'BOOL', 'BYTE', 'WORD', 'DWORD', 'LWORD', 'SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT', 'REAL', 'LREAL',
        'TIME', 'DATE', 'TOD', 'DT', 'STRING', 'WSTRING', 'ARRAY', 'STRUCT', 'END_STRUCT',
        'TRUE', 'FALSE', 'AND', 'OR', 'XOR', 'NOT', 'MOD',
        'TON', 'TOF', 'TP', 'CTU', 'CTD', 'CTUD', 'R_TRIG', 'F_TRIG',
    ],
})

// PLCScript
CanvasCodeEditor.registerLanguage('plcscript', {
    rules: [
        { regex: /\/\*[\s\S]*?\*\//g, className: 'cmt' },
        { regex: /\/\/.*$/gm, className: 'cmt' },
        { regex: /'(?:\\.|[^'\\])*'/g, className: 'str' },
        { regex: /"(?:\\.|[^"\\])*"/g, className: 'str' },
        // Template literals with ${expression} interpolation
        {
            regex: /`(?:[^`\\]|\\.)*`/g,
            subTokens: (text, offset) => {
                const tokens = []
                if (text.indexOf('${') === -1) {
                    tokens.push({ start: offset, end: offset + text.length, type: 'str', text })
                    return tokens
                }
                let i = 0
                let strStart = 0
                const pushStr = (end) => {
                    if (end > strStart) {
                        tokens.push({ start: offset + strStart, end: offset + end, type: 'str', text: text.slice(strStart, end) })
                    }
                }
                while (i < text.length) {
                    if (text[i] === '\\' && i + 1 < text.length) {
                        i += 2
                    } else if (text[i] === '$' && i + 1 < text.length && text[i + 1] === '{') {
                        pushStr(i)
                        // Find matching closing brace with depth tracking
                        let depth = 1, j = i + 2
                        while (j < text.length - 1 && depth > 0) {
                            if (text[j] === '{') depth++
                            else if (text[j] === '}') depth--
                            if (depth > 0) j++
                        }
                        if (depth === 0) {
                            // ${ delimiter
                            tokens.push({ start: offset + i, end: offset + i + 2, type: 'tpl-esc', text: '${' })
                            // Content inside ${} — leave untyped so default styling applies
                            const inner = text.slice(i + 2, j)
                            if (inner.length > 0) {
                                // Sub-tokenize the inner content with PLCScript rules (excluding template/string rules)
                                const innerRules = [
                                    { regex: /\b(if|else|while|for|return|break|continue|function|let|const)\b/g, className: 'kw' },
                                    { regex: /\b(u8|i8|u16|i16|u32|i32|u64|i64|f32|f64|bool|void|auto|str8|str16)\b/g, className: 'dt' },
                                    { regex: /\b(true|false)\b/g, className: 'num' },
                                    { regex: /\b0x[\da-fA-F]+\b/g, className: 'num' },
                                    { regex: /\b0b[01]+\b/g, className: 'num' },
                                    { regex: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, className: 'num' },
                                    { regex: /\b[IQCTXYMS]\d+(?:\.\d+)?\b/gi, className: 'addr' },
                                    { regex: /[+\-*\/%&|^~<>=!]+/g, className: 'dot' },
                                    { regex: /[A-Za-z_]\w*/g, className: 'variable' },
                                ]
                                const innerMarks = new Array(inner.length).fill(null)
                                const innerTokens = []
                                for (const rule of innerRules) {
                                    const re = new RegExp(rule.regex.source, rule.regex.flags.replace('g', '') + 'g')
                                    let m
                                    while ((m = re.exec(inner)) !== null) {
                                        let ok = true
                                        for (let k = m.index; k < m.index + m[0].length; k++) {
                                            if (innerMarks[k] !== null) { ok = false; break }
                                        }
                                        if (ok) {
                                            for (let k = m.index; k < m.index + m[0].length; k++) innerMarks[k] = rule.className
                                            innerTokens.push({ start: offset + i + 2 + m.index, end: offset + i + 2 + m.index + m[0].length, type: rule.className, text: m[0] })
                                        }
                                    }
                                }
                                tokens.push(...innerTokens)
                            }
                            // } delimiter
                            tokens.push({ start: offset + j, end: offset + j + 1, type: 'tpl-esc', text: '}' })
                            strStart = j + 1
                            i = j + 1
                        } else {
                            i++
                        }
                    } else {
                        i++
                    }
                }
                pushStr(text.length)
                return tokens
            }
        },
        { regex: /\b[IQCTXYMS]\d+(?:\.\d+)?\b/gi, className: 'addr' },
        { regex: /\bM[WD]?\d+\b/gi, className: 'addr' },
        { regex: /\b(if|else|while|for|return|break|continue|function|let|const)\b/g, className: 'kw' },
        { regex: /\b(u8|i8|u16|i16|u32|i32|u64|i64|f32|f64|bool|void|auto|str8|str16)\b/g, className: 'dt' },
        { regex: /@/g, className: 'kw' },
        { regex: /\b(true|false)\b/g, className: 'num' },
        { regex: /\b0x[\da-fA-F]+\b/g, className: 'num' },
        { regex: /\b0b[01]+\b/g, className: 'num' },
        { regex: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, className: 'num' },
        // Function calls
        {
            regex: /\b([A-Za-z_]\w*)(\s*\()/g,
            subTokens: (text, offset) => {
                const m = /^([A-Za-z_]\w*)(\s*\()/.exec(text)
                if (!m) return [{ start: offset, end: offset + text.length, type: 'variable', text }]
                const name = m[1]
                const paren = m[2]
                const keywords = ['if', 'else', 'while', 'for', 'return', 'function', 'let', 'const']
                const nameType = keywords.includes(name) ? 'kw' : 'function'
                const tokens = [{ start: offset, end: offset + name.length, type: nameType, text: name }]
                if (paren.trim()) {
                    tokens.push({ start: offset + name.length + (paren.length - 1), end: offset + text.length, type: 'dot', text: '(' })
                }
                return tokens
            }
        },
        { regex: /[+\-*\/%&|^~<>=!]+/g, className: 'dot' },
        { regex: /[(){}\[\];,]/g, className: 'dot' },
        { regex: /[A-Za-z_]\w*/g, className: 'variable' },
    ],
    words: [
        'let', 'const', 'function', 'if', 'else', 'while', 'for', 'return', 'break', 'continue',
        'u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64', 'f32', 'f64', 'bool', 'void',
        'auto', 'str8', 'str16', 'true', 'false',
    ],
    declarationKeywords: ['let', 'const', 'function'],
})

export default CanvasCodeEditor
