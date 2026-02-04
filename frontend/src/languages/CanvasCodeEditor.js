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
        gutterBorder: '#333',
        text: '#d4d4d4',
        selection: 'rgba(38, 79, 120, 0.6)',
        cursor: '#aeafad',
        lineHighlight: 'rgba(255, 255, 255, 0.04)',
        errorSquiggle: '#f48771',
        warningSquiggle: '#cca700',
        infoSquiggle: '#75beff',
        pillBackground: '#464646',
        pillBorder: '#464646',
        pillText: '#fff',
        pillOn: '#1fba5f',
        pillOff: 'rgba(200, 200, 200, 0.5)',
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
        
        // Lint debounce state
        this._lintTimer = null
        this._lintVersion = 0
        
        // Preview entries cache
        this._previewEntries = []
        this._previewEntriesVersion = -1
        
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
        
        this._canvas.width = Math.floor(rect.width * dpr)
        this._canvas.height = Math.floor(rect.height * dpr)
        this._canvas.style.width = rect.width + 'px'
        this._canvas.style.height = rect.height + 'px'
        
        this._ctx.scale(dpr, dpr)
        this._ctx.font = this.options.font
        
        // Recalculate visible area
        const contentWidth = this._width - this.options.gutterWidth - this.options.padding * 2
        const contentHeight = this._height - this.options.padding * 2
        
        this._visibleLines = Math.ceil(contentHeight / this._lineHeight) + 1
        this._visibleCols = Math.ceil(contentWidth / this._charWidth) + 1
        
        this._needsRender = true
    }
    
    // ==========================================================================
    // EVENT HANDLING
    // ==========================================================================
    
    _setupEvents() {
        const canvas = this._canvas
        const input = this._input
        
        // Focus handling
        canvas.addEventListener('mousedown', (e) => {
            e.preventDefault()
            input.focus()
            this._handleMouseDown(e)
        })
        
        canvas.addEventListener('mousemove', (e) => this._handleMouseMove(e))
        canvas.addEventListener('mouseup', (e) => this._handleMouseUp(e))
        canvas.addEventListener('wheel', (e) => this._handleWheel(e), { passive: false })
        canvas.addEventListener('dblclick', (e) => this._handleDoubleClick(e))
        canvas.addEventListener('contextmenu', (e) => this._handleContextMenu(e))
        
        // Input events
        input.addEventListener('input', (e) => this._handleInput(e))
        input.addEventListener('keydown', (e) => this._handleKeyDown(e))
        input.addEventListener('compositionstart', () => { this._composing = true })
        input.addEventListener('compositionend', () => { this._composing = false })
        input.addEventListener('focus', () => { this._needsRender = true; this._startCursorBlink() })
        input.addEventListener('blur', () => { this._needsRender = true; this._stopCursorBlink() })
        
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
        }
    }
    
    _handleMouseDown(e) {
        // Check for pill click first
        const pillEntry = this._getPillAtMouse(e)
        if (pillEntry && this._onPreviewAction) {
            e.preventDefault()
            e.stopPropagation()
            
            if (e.button === 2) {
                // Right click
                if (this._onPreviewContextMenu) {
                    this._onPreviewContextMenu(pillEntry, e)
                }
            } else {
                // Left click - toggle action
                this._onPreviewAction(pillEntry, 'toggle')
            }
            return
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
            this._selectWordAt(pos)
        } else {
            this._clickCount = 1
            if (e.shiftKey && this._cursors.length === 1) {
                // Extend selection
                this._extendSelection(pos)
            } else if (e.altKey) {
                // Add cursor
                this._addCursor(pos)
            } else {
                // Single cursor
                this._setCursor(pos)
            }
        }
        
        this._needsRender = true
    }
    
    _handleMouseMove(e) {
        if (!this._mouseDown) return
        
        const pos = this._getPositionFromMouse(e)
        if (!pos) return
        
        this._extendSelection(pos)
        this._needsRender = true
    }
    
    _handleMouseUp(e) {
        this._mouseDown = false
    }
    
    _handleDoubleClick(e) {
        // Already handled in mousedown with click count
    }
    
    _handleWheel(e) {
        e.preventDefault()
        
        const deltaX = e.deltaX
        const deltaY = e.deltaY
        
        // Smooth scrolling
        this._scrollX = Math.max(0, this._scrollX + deltaX)
        this._scrollY = Math.max(0, Math.min(
            this._scrollY + deltaY,
            Math.max(0, this._lines.length * this._lineHeight - this._height + this.options.padding * 2)
        ))
        
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
        }
    }
    
    _handleKeyDown(e) {
        if (this.options.readOnly && !this._isNavigationKey(e)) {
            if (!e.ctrlKey && !e.metaKey) return
        }
        
        const ctrl = e.ctrlKey || e.metaKey
        const shift = e.shiftKey
        const alt = e.altKey
        
        let handled = true
        
        switch (e.key) {
            case 'ArrowLeft':
                this._moveCursors('left', shift, ctrl)
                break
            case 'ArrowRight':
                this._moveCursors('right', shift, ctrl)
                break
            case 'ArrowUp':
                if (alt && !this.options.readOnly) {
                    this._moveSelectedLines(-1)
                } else {
                    this._moveCursors('up', shift)
                }
                break
            case 'ArrowDown':
                if (alt && !this.options.readOnly) {
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
                }
                break
            case 'Delete':
                if (!this.options.readOnly) {
                    this._deleteForward(ctrl)
                }
                break
            case 'Tab':
                if (!this.options.readOnly) {
                    if (shift) {
                        this._outdentLines()
                    } else {
                        this._insertText('\t')
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
                    this._paste()
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
    
    _getPositionFromMouse(e) {
        const rect = this._canvas.getBoundingClientRect()
        const x = e.clientX - rect.left - this.options.gutterWidth - this.options.padding + this._scrollX
        const y = e.clientY - rect.top - this.options.padding + this._scrollY
        
        let line = Math.floor(y / this._lineHeight)
        line = Math.max(0, Math.min(line, this._lines.length - 1))
        
        let col = Math.round(x / this._charWidth)
        col = Math.max(0, Math.min(col, this._lines[line].length))
        
        const offset = this._getOffset(line, col)
        
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
        
        // Check each pill
        for (const entry of entries) {
            const pillX = x + (entry.col + (entry.end - entry.start)) * charW + 4
            const pillY = lineY + (lineH - 18) / 2
            const pillWidth = 48 // Approximate width, ideally measure text
            const pillHeight = 18
            
            if (mouseX >= pillX && mouseX <= pillX + pillWidth &&
                mouseY >= pillY && mouseY <= pillY + pillHeight) {
                return entry
            }
        }
        
        return null
    }
    
    // ==========================================================================
    // CURSOR & SELECTION MANAGEMENT
    // ==========================================================================
    
    _setCursor(pos) {
        this._cursors = [{ ...pos }]
        this._selections = []
        this._resetCursorBlink()
    }
    
    _addCursor(pos) {
        // Check if cursor already exists at this position
        const exists = this._cursors.some(c => c.line === pos.line && c.col === pos.col)
        if (!exists) {
            this._cursors.push({ ...pos })
        }
        this._resetCursorBlink()
    }
    
    _extendSelection(pos) {
        const cursor = this._cursors[this._cursors.length - 1]
        
        // Find or create selection for this cursor
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
        
        // Update selection end
        if (pos.offset < sel.start.offset) {
            sel.start = { ...pos }
            sel.isReversed = true
        } else {
            sel.end = { ...pos }
            sel.isReversed = false
        }
        
        // Update cursor position
        cursor.line = pos.line
        cursor.col = pos.col
        cursor.offset = pos.offset
    }
    
    _clearSecondarySelections() {
        if (this._cursors.length > 1) {
            this._cursors = [this._cursors[0]]
        }
        this._selections = []
        this._needsRender = true
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
        
        const startPos = { line: pos.line, col: start, offset: this._getOffset(pos.line, start) }
        const endPos = { line: pos.line, col: end, offset: this._getOffset(pos.line, end) }
        
        this._cursors = [endPos]
        this._selections = [{
            start: startPos,
            end: endPos,
            isReversed: false
        }]
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
        
        this._ensureCursorVisible()
        this._resetCursorBlink()
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
        const x = cursor.col * this._charWidth
        
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
        // Sort cursors by offset (descending) to avoid offset shifting issues
        const sortedCursors = [...this._cursors].sort((a, b) => b.offset - a.offset)
        
        // Delete selections first
        for (const sel of this._selections) {
            if (sel) {
                this._deleteRange(sel.start.offset, sel.end.offset)
            }
        }
        this._selections = []
        
        // Recalculate cursor positions after deletions
        for (const cursor of sortedCursors) {
            const pos = this._getPositionFromOffset(cursor.offset)
            cursor.line = pos.line
            cursor.col = pos.col
        }
        
        // Insert at each cursor
        for (const cursor of sortedCursors) {
            const line = this._lines[cursor.line]
            const before = line.slice(0, cursor.col)
            const after = line.slice(cursor.col)
            
            const insertLines = text.split('\n')
            
            if (insertLines.length === 1) {
                // Single line insert
                this._lines[cursor.line] = before + text + after
                cursor.col += text.length
            } else {
                // Multi-line insert
                this._lines[cursor.line] = before + insertLines[0]
                
                const middleLines = insertLines.slice(1, -1)
                const lastInsert = insertLines[insertLines.length - 1]
                
                this._lines.splice(cursor.line + 1, 0, ...middleLines, lastInsert + after)
                
                cursor.line += insertLines.length - 1
                cursor.col = lastInsert.length
            }
            
            cursor.offset = this._getOffset(cursor.line, cursor.col)
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
        
        // Otherwise delete character(s) before cursor
        for (const cursor of this._cursors) {
            if (wordMode) {
                // Delete word
                const oldCol = cursor.col
                this._moveCursorByWord(cursor, -1)
                if (cursor.line === this._cursors[0].line || cursor.col !== oldCol) {
                    const start = this._getOffset(cursor.line, cursor.col)
                    const end = this._getOffset(this._cursors[0].line, oldCol)
                    this._deleteRange(start, end)
                }
            } else if (cursor.col > 0) {
                // Delete single character
                const line = this._lines[cursor.line]
                this._lines[cursor.line] = line.slice(0, cursor.col - 1) + line.slice(cursor.col)
                cursor.col--
            } else if (cursor.line > 0) {
                // Join with previous line
                const prevLine = this._lines[cursor.line - 1]
                const currLine = this._lines[cursor.line]
                this._lines[cursor.line - 1] = prevLine + currLine
                this._lines.splice(cursor.line, 1)
                cursor.line--
                cursor.col = prevLine.length
            }
            
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
        
        // Otherwise delete character(s) after cursor
        for (const cursor of this._cursors) {
            const line = this._lines[cursor.line]
            
            if (cursor.col < line.length) {
                // Delete single character
                this._lines[cursor.line] = line.slice(0, cursor.col) + line.slice(cursor.col + 1)
            } else if (cursor.line < this._lines.length - 1) {
                // Join with next line
                this._lines[cursor.line] = line + this._lines[cursor.line + 1]
                this._lines.splice(cursor.line + 1, 1)
            }
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
        // Sort selections by offset (descending)
        const sorted = [...this._selections]
            .filter(s => s)
            .sort((a, b) => b.start.offset - a.start.offset)
        
        for (const sel of sorted) {
            this._deleteRange(sel.start.offset, sel.end.offset)
        }
        
        // Reset selections and update cursors
        this._selections = []
        for (const cursor of this._cursors) {
            const pos = this._getPositionFromOffset(cursor.offset)
            cursor.line = pos.line
            cursor.col = pos.col
        }
        
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
            
            // Update cursors
            for (const cursor of this._cursors) {
                if (lineSet.has(cursor.line)) {
                    cursor.line--
                    cursor.offset = this._getOffset(cursor.line, cursor.col)
                }
            }
        } else {
            // Move down
            for (const lineNum of [...lines].reverse()) {
                const temp = this._lines[lineNum + 1]
                this._lines[lineNum + 1] = this._lines[lineNum]
                this._lines[lineNum] = temp
            }
            
            // Update cursors
            for (const cursor of this._cursors) {
                if (lineSet.has(cursor.line)) {
                    cursor.line++
                    cursor.offset = this._getOffset(cursor.line, cursor.col)
                }
            }
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
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
    
    _outdentLines() {
        for (const cursor of this._cursors) {
            const line = this._lines[cursor.line]
            if (line.startsWith('\t')) {
                this._lines[cursor.line] = line.slice(1)
                if (cursor.col > 0) cursor.col--
            } else if (line.startsWith('    ')) {
                this._lines[cursor.line] = line.slice(4)
                cursor.col = Math.max(0, cursor.col - 4)
            }
            cursor.offset = this._getOffset(cursor.line, cursor.col)
        }
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
    }
    
    // ==========================================================================
    // CLIPBOARD
    // ==========================================================================
    
    async _copy() {
        const text = this._getSelectedText()
        if (text) {
            await navigator.clipboard.writeText(text)
        }
    }
    
    async _cut() {
        await this._copy()
        this._deleteSelections()
    }
    
    async _paste() {
        try {
            const text = await navigator.clipboard.readText()
            if (text) {
                this._insertText(text)
            }
        } catch (e) {
            console.error('Paste failed:', e)
        }
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
    // UNDO/REDO (Simple implementation - can be enhanced)
    // ==========================================================================
    
    _undoStack = []
    _redoStack = []
    _lastUndoText = ''
    
    _pushUndo() {
        const text = this._getText()
        if (text !== this._lastUndoText) {
            this._undoStack.push(this._lastUndoText)
            this._lastUndoText = text
            this._redoStack = []
            if (this._undoStack.length > 100) {
                this._undoStack.shift()
            }
        }
    }
    
    _undo() {
        if (this._undoStack.length === 0) return
        
        const current = this._getText()
        this._redoStack.push(current)
        
        const prev = this._undoStack.pop()
        this._setText(prev)
        this._lastUndoText = prev
        
        // Reset cursor to end
        this._cursors = [this._getPositionFromOffset(prev.length)]
        this._selections = []
    }
    
    _redo() {
        if (this._redoStack.length === 0) return
        
        const current = this._getText()
        this._undoStack.push(current)
        
        const next = this._redoStack.pop()
        this._setText(next)
        this._lastUndoText = next
        
        this._cursors = [this._getPositionFromOffset(next.length)]
        this._selections = []
    }
    
    _notifyChange() {
        this._pushUndo()
        this._needsRender = true
        
        if (this._onChange) {
            this._onChange(this._getText())
        }
        
        // Schedule lint on change
        this._scheduleLint()
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
        
        if (this._previewEntriesVersion === this._version) return
        
        try {
            const entries = this._previewEntriesProvider(this._getText())
            this._previewEntries = entries || []
            this._previewEntriesVersion = this._version
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
        }
        return colorMap[type] || this.options.tokenColors.default
    }
    
    // ==========================================================================
    // RENDERING
    // ==========================================================================
    
    _startRenderLoop() {
        const render = () => {
            if (this._needsRender) {
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
        ctx.fillStyle = colors.gutterText
        
        for (let i = firstVisibleLine; i <= lastVisibleLine; i++) {
            const y = baseY + (i - firstVisibleLine) * this._lineHeight
            const lineNum = (i + 1).toString()
            ctx.fillText(lineNum, opts.gutterWidth - 8, y + (this._lineHeight - 14) / 2)
        }
        
        // Set clipping for content area
        ctx.save()
        ctx.beginPath()
        ctx.rect(opts.gutterWidth, 0, this._width - opts.gutterWidth, this._height)
        ctx.clip()
        
        // Draw selections
        ctx.fillStyle = colors.selection
        for (const sel of this._selections) {
            if (!sel) continue
            this._renderSelection(ctx, sel, firstVisibleLine, lastVisibleLine, contentX, baseY)
        }
        
        // Draw current line highlight
        if (this._cursors.length === 1 && this._selections.length === 0) {
            const cursor = this._cursors[0]
            if (cursor.line >= firstVisibleLine && cursor.line <= lastVisibleLine) {
                const y = baseY + (cursor.line - firstVisibleLine) * this._lineHeight
                ctx.fillStyle = colors.lineHighlight
                ctx.fillRect(opts.gutterWidth, y, this._width - opts.gutterWidth, this._lineHeight)
            }
        }
        
        // Draw text with syntax highlighting
        ctx.textAlign = 'left'
        
        for (let i = firstVisibleLine; i <= lastVisibleLine; i++) {
            const line = this._lines[i]
            const y = baseY + (i - firstVisibleLine) * this._lineHeight + (this._lineHeight - 14) / 2
            const x = contentX - this._scrollX
            
            const tokens = this._tokenizeLine(i)
            this._renderLineTokens(ctx, line, tokens, x, y)
            
            // Draw diagnostics (squiggly lines)
            this._renderLineDiagnostics(ctx, i, x, y)
            
            // Draw pills for this line
            if (this._previewEntriesProvider) {
                const entries = this._getPreviewEntriesForLine(i)
                this._renderLinePills(ctx, i, entries, x, baseY + (i - firstVisibleLine) * this._lineHeight)
            }
        }
        
        // Draw cursors
        if (this._cursorVisible && document.activeElement === this._input) {
            ctx.fillStyle = colors.cursor
            
            for (const cursor of this._cursors) {
                if (cursor.line >= firstVisibleLine && cursor.line <= lastVisibleLine) {
                    const x = contentX + cursor.col * this._charWidth - this._scrollX
                    const y = baseY + (cursor.line - firstVisibleLine) * this._lineHeight
                    ctx.fillRect(x, y, 2, this._lineHeight)
                }
            }
        }
        
        ctx.restore()
    }
    
    _renderSelection(ctx, sel, firstLine, lastLine, contentX, baseY) {
        const startLine = Math.max(sel.start.line, firstLine)
        const endLine = Math.min(sel.end.line, lastLine)
        
        for (let line = startLine; line <= endLine; line++) {
            const lineText = this._lines[line]
            const y = baseY + (line - firstLine) * this._lineHeight
            
            let startCol = (line === sel.start.line) ? sel.start.col : 0
            let endCol = (line === sel.end.line) ? sel.end.col : lineText.length
            
            const x = contentX + startCol * this._charWidth - this._scrollX
            const width = (endCol - startCol) * this._charWidth
            
            ctx.fillRect(x, y, Math.max(width, 4), this._lineHeight)
        }
    }
    
    _renderLineTokens(ctx, line, tokens, x, y) {
        if (tokens.length === 0) {
            // No tokens - render as plain text
            ctx.fillStyle = this.options.colors.text
            ctx.fillText(line, x, y)
            return
        }
        
        let pos = 0
        
        for (const token of tokens) {
            // Render gap before token
            if (token.start > pos) {
                ctx.fillStyle = this.options.colors.text
                const text = line.slice(pos, token.start)
                ctx.fillText(text, x + pos * this._charWidth, y)
            }
            
            // Render token
            ctx.fillStyle = this._getTokenColor(token.type)
            ctx.fillText(token.text, x + token.start * this._charWidth, y)
            
            pos = token.end
        }
        
        // Render remainder
        if (pos < line.length) {
            ctx.fillStyle = this.options.colors.text
            ctx.fillText(line.slice(pos), x + pos * this._charWidth, y)
        }
    }
    
    _renderLineDiagnostics(ctx, lineIndex, x, y) {
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
            
            const squiggleX = x + startCol * this._charWidth
            const squiggleWidth = Math.max((endCol - startCol) * this._charWidth, this._charWidth)
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
    
    _renderLinePills(ctx, lineIndex, entries, x, lineY) {
        if (!entries || entries.length === 0) return
        
        const colors = this.options.colors
        const charW = this._charWidth
        const lineH = this._lineHeight
        
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
            const pillX = x + (entry.col + (entry.end - entry.start)) * charW + 4
            const pillY = lineY + (lineH - 18) / 2
            const pillWidth = Math.max(ctx.measureText(pillText).width + 12, 32)
            const pillHeight = 18
            const pillRadius = 3
            
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
            
            // Draw pill text
            ctx.fillStyle = textColor
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.font = '11px Consolas, monospace'
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
     * Set cursor position
     * @param {number} line - 0-based line number
     * @param {number} col - 0-based column number
     */
    setCursor(line, col) {
        line = Math.max(0, Math.min(line, this._lines.length - 1))
        col = Math.max(0, Math.min(col, this._lines[line].length))
        const offset = this._getOffset(line, col)
        
        this._cursors = [{ line, col, offset }]
        this._selections = []
        this._ensureCursorVisible()
        this._needsRender = true
    }
    
    /**
     * Reveal a range (scroll to make it visible)
     * @param {{start: number, end: number}} range
     */
    revealRange(range) {
        const pos = this._getPositionFromOffset(range.start)
        this.setCursor(pos.line, pos.col)
    }
    
    /**
     * Dispose the editor and clean up resources
     */
    dispose() {
        this._stopRenderLoop()
        this._stopCursorBlink()
        
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

// Assembly (PLCASM)
CanvasCodeEditor.registerLanguage('asm', {
    rules: [
        { regex: /\/\*[\s\S]*?\*\//g, className: 'cmt' },
        { regex: /\/\/.*$/gm, className: 'cmt' },
        { regex: /T#[A-Za-z0-9_]+/gi, className: 'num' },
        { regex: /#(?:\s*\d+)?/g, className: 'num' },
        { regex: /^\s*([A-Za-z_]\w*):/gm, className: 'function' },
        { regex: /\b[CXYMS]\d+(?:\.\d+)?\b/gi, className: 'addr' },
        { regex: /\b(ptr|u8|u16|u32|u64|i8|i16|i32|i64|f32|f64)\b/g, className: 'dt' },
        { regex: /\b(br)\.(save|read|copy|drop)\b/gim, className: 'type-keyword' },
        { regex: /\b(ton|tof|tp|ctu|ctd|ctud)\b/gim, className: 'type-keyword' },
        { regex: /\b(add|sub|mul|div|mod|pow|sqrt|neg|abs|sin|cos|cmp_eq|cmp_neq|cmp_gt|cmp_lt|cmp_gte|cmp_lte|and|or|xor|not|lshift|rshift|move|move_to|move_copy|load|load_from|copy|swap|drop|clear|set|get|rset|readBit|writeBit|writeBitInv|writeBitOn|writeBitOff|readBitDU|readBitDD|readBitInvDU|readBitInvDD|writeBitDU|writeBitDD|writeBitInvDU|writeBitInvDD|writeBitOnDU|writeBitOnDD|writeBitOffDU|writeBitOffDD|du|jmp(?:_if(?:_not)?)?(?:_rel)?|jump(?:_if(?:_not)?)?|call(?:_if(?:_not)?)?|ret(?:_if(?:_not)?)?|exit|loop|cvt|nop)\b/gim, className: 'kw' },
        { regex: /\./g, className: 'dot' },
        { regex: /\b\d+\.\d+|\.\d+\b/g, className: 'num' },
        { regex: /\b0x[\da-f]+|\b\d+\b/gi, className: 'num' },
        { regex: /[A-Za-z_]\w*/g, className: 'variable' },
    ]
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
        { regex: /\b[IQMTCSXYK]\d+(?:\.\d+)?\b/gi, className: 'addr' },
        { regex: /\b\d+\.\d+\b/g, className: 'addr' },
        { regex: /\b\d+\b/g, className: 'num' },
        { regex: /[()]/g, className: 'dot' },
        { regex: /[A-Za-z_]\w*/g, className: 'variable' },
    ]
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
        { regex: /%[IQMKCT][XBWD]?\d+(?:\.\d+)?/gi, className: 'addr' },
        { regex: /\b\d+\.\d+\b/g, className: 'num' },
        { regex: /\b\d+\b/g, className: 'num' },
        { regex: /:=|<=|>=|<>|[+\-*\/=<>]/g, className: 'dot' },
        { regex: /[();,\[\]]/g, className: 'dot' },
        { regex: /[A-Za-z_]\w*/g, className: 'variable' },
    ]
})

// PLCScript
CanvasCodeEditor.registerLanguage('plcscript', {
    rules: [
        { regex: /\/\*[\s\S]*?\*\//g, className: 'cmt' },
        { regex: /\/\/.*$/gm, className: 'cmt' },
        { regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, className: 'str' },
        { regex: /\b(if|else|while|for|return|break|continue|function|let|const)\b/g, className: 'kw' },
        { regex: /\b(u8|i8|u16|i16|u32|i32|u64|i64|f32|f64|bool|void|auto)\b/g, className: 'dt' },
        { regex: /@/g, className: 'kw' },
        { regex: /\b(true|false)\b/g, className: 'num' },
        { regex: /\b0x[\da-fA-F]+\b/g, className: 'num' },
        { regex: /\b0b[01]+\b/g, className: 'num' },
        { regex: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, className: 'num' },
        { regex: /[+\-*\/%&|^~<>=!]+/g, className: 'dot' },
        { regex: /[(){}\[\];,]/g, className: 'dot' },
        { regex: /[A-Za-z_]\w*/g, className: 'variable' },
    ]
})

export default CanvasCodeEditor
