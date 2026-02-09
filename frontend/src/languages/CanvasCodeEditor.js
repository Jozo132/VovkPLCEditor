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
            e.preventDefault()
            input.focus()
            this._handleMouseDown(e)
        })
        
        canvas.addEventListener('mousemove', (e) => {
            // During drag, let the document listener handle it to avoid double-firing
            if (!this._mouseDown) this._handleMouseMove(e)
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
        input.addEventListener('focus', () => { this._needsRender = true; this._startCursorBlink() })
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
        // Close pill input overlay on any mouse click
        if (this._pillInputEntry) this._closePillInput()
        
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
    }
    
    _handleDoubleClick(e) {
        // Check pill double-click — opens context menu
        this._handleDblClick(e)
    }
    
    _handleWheel(e) {
        // Close pill input overlay on scroll
        if (this._pillInputEntry) this._closePillInput()
        
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
        }
    }
    
    _handleKeyDown(e) {
        // Handle keys when a pill is selected (even in readOnly mode)
        if (this._selectedPill) {
            e.preventDefault()
            e.stopPropagation()
            this._handlePillKeyDown(e)
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
                this._moveCursors('left', shift, ctrl)
                break
            case 'ArrowRight':
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
        
        const startPos = { line: pos.line, col: start, offset: this._getOffset(pos.line, start) }
        const endPos = { line: pos.line, col: end, offset: this._getOffset(pos.line, end) }
        
        this._cursors = [endPos]
        this._selections = [{
            start: startPos,
            end: endPos,
            isReversed: false
        }]
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
        // Delete selections first if any
        if (this._selections.length > 0 && this._selections.some(s => s)) {
            this._deleteSelections()
        }
        
        // Sort cursors ascending by offset and track cumulative shift
        // so each insertion correctly accounts for prior insertions
        const sortedCursors = [...this._cursors].sort((a, b) => a.offset - b.offset)
        let cumulativeShift = 0
        
        for (const cursor of sortedCursors) {
            // Adjust for all prior insertions
            const adjustedOffset = cursor.offset + cumulativeShift
            const pos = this._getPositionFromOffset(adjustedOffset)
            
            const line = this._lines[pos.line]
            const before = line.slice(0, pos.col)
            const after = line.slice(pos.col)
            
            const insertLines = text.split('\n')
            
            if (insertLines.length === 1) {
                // Single line insert
                this._lines[pos.line] = before + text + after
                cursor.line = pos.line
                cursor.col = pos.col + text.length
            } else {
                // Multi-line insert
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
        
        this._version++
        this._tokenCache.clear()
        this._notifyChange()
    }
    
    /** Insert different text at each cursor (entries distributed in offset order, top-to-bottom) */
    _insertTextPerCursor(entries) {
        // Delete selections first if any
        if (this._selections.length > 0 && this._selections.some(s => s)) {
            this._deleteSelections()
        }
        
        // Sort cursors ascending by offset — entries are already in offset order from _copy
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
            
            if (cursor.col < line.length) {
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
        this._scheduleLint()
    }
    
    _notifyChange() {
        this._mergeCursors()
        this._pushUndo()
        this._needsRender = true
        
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
