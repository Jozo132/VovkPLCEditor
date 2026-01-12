import {PLC_Project, PLCEditor} from '../../utils/types.js'
import {ElementSynthesisMany, getEventPath, isVisible} from '../../utils/tools.js'
import { normalizeOffsets } from '../../utils/offsets.js'
import {Popup} from './Elements/components/popup.js'
import NavigationTreeManager from './Elements/NavigationTreeManager.js'
import TabManager from './Elements/TabManager.js'
import EditorUI from './Elements/EditorUI.js'
import SymbolsUI from './Elements/SymbolsUI.js'
import SetupUI from './Elements/SetupUI.js'
import MemoryUI from './Elements/MemoryUI.js'

/** @typedef { EditorUI | SymbolsUI | SetupUI } WindowType */

export default class WindowManager {
    /** @type {'edit' | 'online'} */
    active_mode = 'edit'

    /** @type {'simulation' | 'device'} */
    active_device = 'simulation'
    _monitoringActive = false
    _monitoringAvailable = false
    _monitoringConnectionState = null
    _healthConnectionState = null
    _healthTimer = null
    _healthInFlight = false
    _healthResetInFlight = false
    _healthSnapshot = null

    workspace_body

    /** @type { Map<string, WindowType> } */
    windows = new Map() // filePath → { tabEl, editorEl }

    window_frame

    /** @type { (device: string) => Promise<boolean> } */
    requestConnect = async device => false

    highlightItem = element => this.tree_manager.highlightItem(element)
    removeHighlight = () => this.tree_manager.removeHighlight()

    #editor
    /** @param {PLCEditor} editor */
    constructor(editor) {
        this.#editor = editor
        const workspace = this.#editor.workspace
        this.workspace = workspace

        this.workspace_body = ElementSynthesisMany(/*HTML*/ `
            <div class="plc-workspace-header">
                <p></p>
            </div>
            <div class="plc-workspace-body">
                <div class="plc-navigation no-select resizable" style="width: 220px">
                    <div class="plc-navigation-container">
                        <!--h3>Navigation</h3-->
                        <div class="plc-device">
                            <!-- Left side: dropdown with options 'Device' and 'Simulation,  the right side: button for going online with text content 'Go online'  -->
                            <div class="plc-device-dropdown">
                                <select id="plc-device-select-field">
                                    <option value="simulation">Simulation</option>
                                    <!-- More options will be added dynamically -->
                                </select>
                            </div>
                            <div class="plc-device-online green" tabindex="0">Go online</div>
                        </div>
                        <div class="plc-device-info">
                            <!-- Device info will be displayed here -->
                        </div>
                        <h4>Project</h4>
                        <div class="plc-navigation-tree">
                            <!-- Navigation tree will be displayed here -->
                        </div>
                        <div class="plc-device-health">
                            <div class="plc-device-health-header">
                                <span class="plc-device-health-title">Device Health</span>
                                <button class="plc-device-health-reset" title="Reset max values">Reset</button>
                            </div>
                            <div class="plc-device-health-body">
                        <div class="plc-device-health-row plc-device-health-row-head">
                            <span class="plc-device-health-label"></span>
                            <span class="plc-device-health-col">Cycle</span>
                            <span class="plc-device-health-col">RAM Free</span>
                        </div>
                                <div class="plc-device-health-row">
                                    <span class="plc-device-health-label">Last</span>
                                    <span class="plc-device-health-value" data-field="cycle-last">-</span>
                                    <span class="plc-device-health-value" data-field="ram-free">-</span>
                                </div>
                                <div class="plc-device-health-row">
                                    <span class="plc-device-health-label">Max/Min</span>
                                    <span class="plc-device-health-value" data-field="cycle-max">-</span>
                                    <span class="plc-device-health-value" data-field="ram-min">-</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="resizer right"></div>
                    <div class="plc-navigation-bar">
                        <div class="menu-button">-</div>
                        <span class="thick text-rotate" style="margin: auto auto; margin-top: 5px; font-size: 0.6em;">Navigation</span>
                    </div>
                </div>
                
                <div class="plc-center-column" style="display: flex; flex-direction: column; flex: 1; overflow: hidden; position: relative;">
                    <div class="plc-window" style="flex: 1; min-height: 0;"> <!-- min-height: 0 is important for flex scrolling -->
                        <div class="plc-window-tabs"></div>
                        <div class="plc-window-frame"></div>
                    </div>
                    
                    <div class="resizer-console-top" style="height: 4px; background: #333; cursor: ns-resize; z-index: 10;"></div>
                    
                    <div class="plc-console minimized" style="height: 25px; min-height: 25px; background: #1e1e1e; border-top: 1px solid #333; display: flex; flex-direction: column;">
                        <div class="plc-console-header" style="height: 25px; background: #252526; display: flex; align-items: center; padding: 0 10px; cursor: pointer;">
                            <span class="codicon codicon-chevron-right" style="margin-right: 5px;"></span>
                            <div class="plc-console-tabs">
                                <button class="plc-console-tab active" data-tab="output">Output</button>
                                <button class="plc-console-tab plc-console-tab-problems" data-tab="problems">
                                    <span class="plc-console-tab-label">Problems</span>
                                    <span class="plc-console-tab-count" style="display:none;">0</span>
                                </button>
                            </div>
                            <div style="flex: 1;"></div>
                            <div class="plc-console-actions">
                                <button class="icon-btn clear-console" title="Clear Console" style="background:none; border: 1px solid #444; border-radius: 2px; padding: 0 5px; color:#ccc; cursor:pointer; font-size: 11px;">
                                    Clear
                                </button>
                            </div>
                        </div>
                        <div class="plc-console-body output" style="flex: 1; overflow: auto; padding: 5px 10px; font-family: monospace; color: #ddd;">
                            <!-- Console Output -->
                        </div>
                        <div class="plc-console-body problems" style="flex: 1; overflow: auto; padding: 5px 10px; font-family: inherit; color: #ddd; display: none;">
                            <!-- Lint Problems -->
                        </div>
                    </div>
                </div>

                <div class="plc-tools no-select resizable minimized" style="width: 200px">
                    <div class="plc-tools-bar">
                        <div class="menu-button">+</div>
                        <span class="thick text-rotate" style="margin: auto auto; margin-top: 5px; font-size: 0.6em;">Tools</span>
                    </div>
                    <div class="resizer left"></div>
                    <div class="plc-tools-container">
                        <h3>Tools</h3>
                    </div>
                </div>
            </div>
            
            <div class="plc-workspace-footer" style="height: 22px; background: #007acc; color: #fff; display: flex; align-items: center; padding: 0px; margin: 0px; font-size: 12px; justify-content: space-between;">
                <div style="display: flex; gap: 10px; align-items: center; margin-left: 15px;">
                    <div class="footer-item"><span class="codicon codicon-remote"></span> VovkPLC Editor</div>
                    <button id="footer-compile" class="footer-btn" style="background: none; border: none; color: white; cursor: pointer; display: flex; align-items: center; gap: 6px; opacity: 1; pointer-events: all; font-size: 11px;">
                        <span style="display: flex; transform: translateY(-1.5px);"><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 0-1 0v6z"/><path d="M3 11.5h2v2h-2zM7 11.5h2v2h-2zM11 11.5h2v2h-2zM5 8.5h2v2h-2zM9 8.5h2v2h-2z"/></svg></span> Compile
                    </button>
                    <button id="footer-download" class="footer-btn" style="background: none; border: none; color: white; cursor: pointer; display: flex; align-items: center; gap: 6px; opacity: 0.5; pointer-events: none; font-size: 11px;">
                        <span style="display: flex; transform: translateY(-1.5px);"><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4a.5.5 0 0 1 .5.5v5.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 10.293V4.5A.5.5 0 0 1 8 4z"/><path d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 0-1 0v6z"/></svg></span> Download
                    </button>
                </div>

                <div style="display: flex; gap: 15px; margin-right: 15px">
                     <span id="footer-device-status">Disconnected</span>
                </div>
            </div>
        `)

        this.workspace_body.forEach(element => workspace.appendChild(element))

        const navigation_minimize_button = workspace.querySelector('.plc-navigation-bar .menu-button')
        const tools_minimize_button = workspace.querySelector('.plc-tools-bar .menu-button')
        if (!navigation_minimize_button) throw new Error('Navigation minimize button not found')
        if (!tools_minimize_button) throw new Error('Tools minimize button not found')
        navigation_minimize_button.addEventListener('click', () => this.#on_navigation_minimize_toggle())
        tools_minimize_button.addEventListener('click', () => this.#on_tools_minimize_toggle())

        // Footer Events
        const compileBtn = workspace.querySelector('#footer-compile')
        const downloadBtn = workspace.querySelector('#footer-download')

        compileBtn.onclick = () => this.handleCompile()
        downloadBtn.onclick = () => this.handleDownload()

        const consoleHeader = workspace.querySelector('.plc-console-header')
        const consoleBody = workspace.querySelector('.plc-console')
        const consoleTabs = workspace.querySelectorAll('.plc-console-tab')
        const problemsTab = workspace.querySelector('.plc-console-tab-problems')
        const clearConsoleBtn = workspace.querySelector('.clear-console')
        const consoleResizer = workspace.querySelector('.resizer-console-top')
        const outputBody = workspace.querySelector('.plc-console-body.output')
        const problemsBody = workspace.querySelector('.plc-console-body.problems')

        const consoleHeaderHeight = Math.max(1, Math.round(consoleHeader.getBoundingClientRect().height || 25))
        consoleBody.style.height = `${consoleHeaderHeight}px` // Start minimized (header visible)
        consoleBody.style.minHeight = `${consoleHeaderHeight}px`

        // Initial console state management
        this._consoleState = this._consoleState || { activeTab: 'output', lastHeight: 150, minimized: true }
        const consoleState = this._consoleState
        consoleState.lastHeight = typeof consoleState.lastHeight === 'number' ? consoleState.lastHeight : 150
        consoleState.activeTab = consoleState.activeTab === 'problems' ? 'problems' : 'output'
        consoleState.minimized = typeof consoleState.minimized === 'boolean' ? consoleState.minimized : true
        let activeConsoleTab = consoleState.activeTab
        this._problemsFlat = []
        this._selectedProblemIndex = -1
        this._selectedProblemKey = null
        this._selectedProblemProgramId = null
        this._selectedProblemShowTooltip = false
        this._activeProblemHover = null
        this._selectedProblemHighlight = null
        this._problemsByHoverKey = new Map()
        this._hoveredProblemKey = null

        const setActiveConsoleTab = tab => {
            activeConsoleTab = tab === 'problems' ? 'problems' : 'output'
            consoleState.activeTab = activeConsoleTab
            if (outputBody) outputBody.style.display = activeConsoleTab === 'output' ? 'block' : 'none'
            if (problemsBody) problemsBody.style.display = activeConsoleTab === 'problems' ? 'block' : 'none'
            if (consoleBody) consoleBody.classList.toggle('tab-problems', activeConsoleTab === 'problems')
            consoleTabs.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === activeConsoleTab)
            })
            if (activeConsoleTab === 'problems' && problemsBody) {
                problemsBody.focus()
            }
        }

        const openConsole = (height, opts = {}) => {
            if (!consoleBody) return
            const wasMinimized = consoleBody.classList.contains('minimized')
            if (!wasMinimized && !opts.force) return
            consoleBody.classList.remove('minimized')
            consoleState.minimized = false
            const nextHeight = typeof height === 'number' && height > consoleHeaderHeight
                ? height
                : (consoleState.lastHeight && consoleState.lastHeight > consoleHeaderHeight ? consoleState.lastHeight : 150)
            consoleState.lastHeight = nextHeight
            consoleBody.style.height = `${nextHeight}px`
        }

        const clearHoverHighlight = () => {
            if (this._activeProblemHover?.editor?.setHoverHighlight) {
                this._activeProblemHover.editor.setHoverHighlight(null)
            }
            if (this._activeProblemHover?.editor?.showLintTooltip) {
                this._activeProblemHover.editor.showLintTooltip(null)
            }
            this._activeProblemHover = null
        }

        const clearSelectedHighlight = (opts = {}) => {
            if (this._selectedProblemHighlight?.editor?.setSelectedHighlight) {
                this._selectedProblemHighlight.editor.setSelectedHighlight(null)
            }
            if (opts.hideTooltip && this._selectedProblemHighlight?.editor?.showLintTooltip) {
                this._selectedProblemHighlight.editor.showLintTooltip(null)
            }
            this._selectedProblemHighlight = null
        }

        const clearProblemSelection = () => {
            if (this._selectedProblemIndex >= 0) {
                const prev = this._problemsFlat[this._selectedProblemIndex]
                prev?.element?.classList.remove('selected')
            }
            this._selectedProblemIndex = -1
            this._selectedProblemShowTooltip = false
            this._selectedProblemKey = null
            this._selectedProblemProgramId = null
            clearSelectedHighlight({ hideTooltip: true })
        }

        const ensureProblemVisible = entry => {
            if (!entry) return
            const item = entry.element
            if (item && item.scrollIntoView) {
                item.scrollIntoView({ block: 'nearest' })
            }
        }

        const applyProblemSelection = (index, opts = {}) => {
            if (!this._problemsFlat.length) return
            const max = this._problemsFlat.length - 1
            const nextIndex = Math.max(0, Math.min(index, max))
            if (this._selectedProblemIndex === nextIndex) {
                if (opts.showTooltip) {
                    this._selectedProblemShowTooltip = true
                    this._problemsFlat[nextIndex].show({ showTooltip: true, focus: false, mode: 'selected' })
                }
                return
            }
            clearProblemSelection()
            clearHoverHighlight()
            const entry = this._problemsFlat[nextIndex]
            if (!entry) return
            entry.element.classList.add('selected')
            this._selectedProblemIndex = nextIndex
            this._selectedProblemKey = entry.key
            this._selectedProblemShowTooltip = !!opts.showTooltip
            this._selectedProblemProgramId = entry.programId || null
            entry.ensureGroupOpen()
            ensureProblemVisible(entry)
            entry.show({ showTooltip: !!opts.showTooltip, focus: true, mode: 'selected' })
        }

        this.setConsoleTab = setActiveConsoleTab
        this.openConsole = openConsole
        const buildHoverKey = (blockId, diag) => {
            if (!blockId || !diag) return ''
            const start = typeof diag.start === 'number' ? diag.start : ''
            const end = typeof diag.end === 'number' ? diag.end : ''
            const msg = diag.message || ''
            return `${blockId}:${start}:${end}:${msg}`
        }
        this.getConsoleState = () => {
            if (!consoleBody) return null
            return {
                tab: activeConsoleTab,
                height: consoleState.lastHeight,
                minimized: consoleBody.classList.contains('minimized'),
            }
        }
        this.setConsoleState = state => {
            if (!state || !consoleBody) return
            if (state.tab) setActiveConsoleTab(state.tab)
            const nextHeight = typeof state.height === 'number' ? state.height : consoleState.lastHeight
            const isMinimized = typeof state.minimized === 'boolean' ? state.minimized : consoleBody.classList.contains('minimized')
            if (isMinimized) {
                if (typeof nextHeight === 'number' && nextHeight > consoleHeaderHeight) {
                    consoleState.lastHeight = nextHeight
                }
                consoleState.minimized = true
                consoleBody.classList.add('minimized')
                consoleBody.style.height = `${consoleHeaderHeight}px`
            } else {
                openConsole(nextHeight, { force: true })
            }
        }
        this.setProblemHover = payload => {
            const map = this._problemsByHoverKey
            if (!map) return
            const clear = () => {
                if (!this._hoveredProblemKey) return
                const entries = map.get(this._hoveredProblemKey) || []
                entries.forEach(entry => entry.element?.classList.remove('linked'))
                this._hoveredProblemKey = null
            }
            if (!payload || payload.state === 'leave') {
                clear()
                return
            }
            const key = buildHoverKey(payload.blockId, payload.diagnostic)
            if (!key) {
                clear()
                return
            }
            if (this._hoveredProblemKey && this._hoveredProblemKey !== key) {
                clear()
            }
            const entries = map.get(key) || []
            if (entries.length) {
                entries.forEach(entry => entry.element?.classList.add('linked'))
                this._hoveredProblemKey = key
            } else {
                clear()
            }
        }
        this.clearProblemSelection = () => {
            clearProblemSelection()
            clearHoverHighlight()
        }
        this._problemsCollapsed = this._problemsCollapsed || new Set()
        this.setConsoleProblems = input => {
            const list = Array.isArray(input) ? input : (input && Array.isArray(input.problems) ? input.problems : [])
            const status = !Array.isArray(input) && input && input.status ? input.status : 'idle'
            this._problemsFlat = []
            const prevSelectedKey = this._selectedProblemKey
            const prevSelectedProgramId = this._selectedProblemProgramId
            const prevSelectedShowTooltip = this._selectedProblemShowTooltip
            clearProblemSelection()
            this._selectedProblemKey = prevSelectedKey
            this._selectedProblemProgramId = prevSelectedProgramId
            this._selectedProblemShowTooltip = prevSelectedShowTooltip
            clearHoverHighlight()
            let activeHoverEntry = null
            this._problemsByHoverKey = new Map()
            this._hoveredProblemKey = null

            if (problemsTab) {
                const countEl = problemsTab.querySelector('.plc-console-tab-count')
                if (countEl) {
                    if (list.length) {
                        countEl.style.display = ''
                        countEl.textContent = list.length
                    } else {
                        countEl.style.display = 'none'
                        countEl.textContent = '0'
                    }
                }
            }

            if (!problemsBody) return
            problemsBody.innerHTML = ''

            if (status === 'checking') {
                const checking = document.createElement('div')
                checking.className = 'plc-problems-status'
                checking.textContent = 'Checking for problems ...'
                problemsBody.appendChild(checking)
                clearHoverHighlight()
                clearSelectedHighlight({ hideTooltip: true })
                return
            }

            if (!list.length) {
                const empty = document.createElement('div')
                empty.className = 'plc-problems-status'
                empty.textContent = 'No problems detected'
                problemsBody.appendChild(empty)
                clearHoverHighlight()
                clearSelectedHighlight({ hideTooltip: true })
                return
            }

            const groups = new Map()
            list.forEach(problem => {
                const rawPath = problem.programPath || problem.programName || 'Unknown'
                const cleanPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
                const pathParts = cleanPath.split('/').filter(Boolean)
                const fileName = problem.programName || pathParts[pathParts.length - 1] || 'Unknown'
                const dir = pathParts.length > 1 ? `/${pathParts.slice(0, -1).join('/')}` : '/'
                const blockId = problem.blockId || 'unknown'
                const blockName = problem.blockName || `Block ${blockId}`
                const blockType = problem.blockType || ''
                const key = `${cleanPath}::${blockId}`

                if (!groups.has(key)) {
                    groups.set(key, { fileName, dir, blockId, blockName, blockType, key, items: [] })
                }
                groups.get(key).items.push(problem)
            })

            groups.forEach(group => {
                const groupEl = document.createElement('div')
                groupEl.className = 'plc-problems-group'

                const header = document.createElement('div')
                header.className = 'plc-problems-group-header'

                const toggle = document.createElement('span')
                toggle.className = 'plc-problems-group-toggle'

                const block = document.createElement('span')
                block.className = 'plc-problems-block-name'
                block.textContent = group.blockName

                const file = document.createElement('span')
                file.className = 'plc-problems-file-name'
                file.textContent = group.fileName

                const arrow = document.createElement('span')
                arrow.className = 'plc-problems-arrow'
                arrow.textContent = '->'

                const blockType = document.createElement('span')
                blockType.className = 'plc-problems-block-type'
                blockType.textContent = group.blockType ? group.blockType.toUpperCase() : ''

                const dir = document.createElement('span')
                dir.className = 'plc-problems-file-path'
                dir.textContent = group.dir

                const count = document.createElement('span')
                count.className = 'plc-problems-file-count'
                count.textContent = group.items.length

                header.appendChild(toggle)
                header.appendChild(file)
                header.appendChild(arrow)
                header.appendChild(block)
                header.appendChild(blockType)
                header.appendChild(dir)
                header.appendChild(count)
                groupEl.appendChild(header)

                const items = document.createElement('div')
                items.className = 'plc-problems-group-items'

                group.items.forEach(problem => {
                    const item = document.createElement('div')
                    item.className = `plc-problems-item ${problem.type || 'error'}`

                    const icon = document.createElement('span')
                    icon.className = 'plc-problems-item-icon'

                    const msg = document.createElement('span')
                    msg.className = 'plc-problems-item-message'
                    const tokenText = problem.token ? ` "${problem.token}"` : ''
                    msg.textContent = `${problem.message || 'Lint error'}${tokenText}`

                    const lang = document.createElement('span')
                    lang.className = 'plc-problems-item-lang'
                    const stack = Array.isArray(problem.languageStack) ? problem.languageStack : (problem.language ? [problem.language] : [])
                    const stackText = stack.filter(Boolean).join(' > ')
                    lang.textContent = stackText ? `[${stackText}]` : ''

                    const meta = document.createElement('span')
                    meta.className = 'plc-problems-item-meta'
                    meta.textContent = `[Ln ${problem.line || 1}, Col ${problem.column || 1}]`

                    item.appendChild(icon)
                    item.appendChild(msg)
                    if (lang.textContent) item.appendChild(lang)
                    item.appendChild(meta)
                    items.appendChild(item)

                    const entryKey = `${problem.blockId || 'unknown'}:${problem.start || 0}:${problem.message || ''}:${problem.token || ''}`
                    const showProblem = (opts = {}) => {
                        const normalized = typeof opts === 'object' && opts ? opts : { showTooltip: !!opts }
                        const { showTooltip = false, focus = false, mode = 'hover' } = normalized
                        const isSelected = mode === 'selected'

                        if (!isSelected) {
                            clearHoverHighlight()
                        } else {
                            clearSelectedHighlight({ hideTooltip: !showTooltip })
                        }

                        const run = async () => {
                            if (!problem.blockId || typeof problem.start !== 'number' || typeof problem.end !== 'number') return
                            const findTarget = () => {
                                const programs = this.#editor?._getLintPrograms?.() || []
                                for (const program of programs) {
                                    const found = program?.blocks?.find(b => b.id === problem.blockId)
                                    if (found) return { program, block: found }
                                }
                                return { program: null, block: null }
                            }
                            const waitForLayout = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                            const waitForVisible = async block => {
                                for (let i = 0; i < 6; i++) {
                                    if (block?.div) {
                                        const rect = block.div.getBoundingClientRect()
                                        if (rect.width > 0 && rect.height > 0) return true
                                    }
                                    await waitForLayout()
                                }
                                return false
                            }
                            const waitForEditor = async block => {
                                for (let i = 0; i < 6; i++) {
                                    if (block?.props?.text_editor) return block.props.text_editor
                                    await waitForLayout()
                                }
                                return block?.props?.text_editor || null
                            }
                            const scrollBlockIntoView = (blockDiv, ratio = 0.33) => {
                                if (!blockDiv) return
                                const body = blockDiv.closest('.plc-editor-body')
                                if (!body) return
                                const bodyRect = body.getBoundingClientRect()
                                const blockRect = blockDiv.getBoundingClientRect()
                                const blockTop = blockRect.top - bodyRect.top + body.scrollTop
                                const targetTop = Math.max(0, blockTop - body.clientHeight * ratio)
                                if (Math.abs(body.scrollTop - targetTop) > 1) {
                                    body.scrollTop = targetTop
                                }
                                const nextBlockRect = blockDiv.getBoundingClientRect()
                                if (nextBlockRect.top < bodyRect.top || nextBlockRect.bottom > bodyRect.bottom) {
                                    blockDiv.scrollIntoView({ block: 'center' })
                                }
                            }
                            const expandBlock = block => {
                                if (!block?.div) return
                                if (!block.div.classList.contains('minimized')) return
                                block.div.classList.remove('minimized')
                                block.minimized = false
                                const minimizeBtn = block.div.querySelector('.menu-button.minimize')
                                if (minimizeBtn) minimizeBtn.innerText = '-'
                            }
                            const scrollBodyToCode = (blockDiv, codeEditor, index, ratio = 0.33) => {
                                if (!blockDiv || !codeEditor || typeof codeEditor.getCodePosition !== 'function') return
                                const body = blockDiv.closest('.plc-editor-body')
                                if (!body) return
                                const bodyRect = body.getBoundingClientRect()
                                const pos = codeEditor.getCodePosition(index)
                                const delta = pos.viewportY - bodyRect.top
                                const targetTop = Math.max(0, body.scrollTop + delta - body.clientHeight * ratio)
                                if (Math.abs(body.scrollTop - targetTop) > 1) {
                                    body.scrollTop = targetTop
                                }
                            }

                            let { program: targetProgram, block: targetBlock } = findTarget()
                            if (!targetBlock) return

                            if (focus && targetProgram?.id) {
                                this.openProgram(targetProgram.id)
                                await waitForLayout()
                                ;({ program: targetProgram, block: targetBlock } = findTarget())
                                if (!targetBlock) return
                                expandBlock(targetBlock)
                                await waitForLayout()
                            }

                            if (!targetBlock?.div) return
                            if (!focus && targetBlock.div.classList.contains('minimized')) return
                            if (focus) expandBlock(targetBlock)

                            await waitForVisible(targetBlock)

                            if (focus) {
                                scrollBlockIntoView(targetBlock.div, 0.33)
                                await waitForLayout()
                            }

                            const editor = await waitForEditor(targetBlock)
                            if (!editor) return

                            const range = { start: problem.start, end: problem.end }
                            if (focus && typeof editor.revealRange === 'function') {
                                editor.revealRange(range, {
                                    ratio: 0.33,
                                    showTooltip: !!showTooltip,
                                    highlight: !isSelected,
                                    tooltipHighlight: !isSelected
                                })
                                await waitForLayout()
                                scrollBodyToCode(targetBlock.div, editor, problem.start, 0.33)
                            } else {
                                if (!isSelected && typeof editor.setHoverHighlight === 'function') {
                                    editor.setHoverHighlight(range)
                                }
                                if (isSelected && typeof editor.setSelectedHighlight === 'function') {
                                    editor.setSelectedHighlight(range)
                                }
                                if (showTooltip && typeof editor.showLintTooltip === 'function') {
                                    editor.showLintTooltip(range, { highlight: !isSelected })
                                }
                            }

                            if (isSelected && typeof editor.setSelectedHighlight === 'function') {
                                editor.setSelectedHighlight(range)
                                this._selectedProblemHighlight = { editor }
                            } else if (!isSelected && typeof editor.setHoverHighlight === 'function') {
                                this._activeProblemHover = { editor }
                            }
                        }

                        run()
                    }

                    const ensureGroupOpen = () => {
                        if (this._problemsCollapsed.has(group.key)) {
                            this._problemsCollapsed.delete(group.key)
                            items.style.display = 'block'
                            toggle.textContent = '▾'
                        }
                    }

                    const entry = {
                        key: entryKey,
                        element: item,
                        ensureGroupOpen,
                        show: showProblem,
                        programId: problem.programId || null,
                    }
                    this._problemsFlat.push(entry)
                    const hoverKey = buildHoverKey(problem.blockId, problem)
                    if (hoverKey) {
                        const bucket = this._problemsByHoverKey.get(hoverKey) || []
                        bucket.push(entry)
                        this._problemsByHoverKey.set(hoverKey, bucket)
                    }

                    item.addEventListener('mouseenter', () => {
                        activeHoverEntry = entry
                        showProblem({ showTooltip: true, focus: false, mode: 'hover' })
                    })

                    item.addEventListener('mouseleave', () => {
                        if (activeHoverEntry !== entry) return
                        activeHoverEntry = null
                        clearHoverHighlight()
                        if (this._selectedProblemIndex >= 0) {
                            const selected = this._problemsFlat[this._selectedProblemIndex]
                            if (selected) {
                                selected.show({
                                    showTooltip: this._selectedProblemShowTooltip,
                                    focus: false,
                                    mode: 'selected'
                                })
                                return
                            }
                        }
                    })

                    item.addEventListener('click', () => {
                        applyProblemSelection(this._problemsFlat.indexOf(entry), { showTooltip: true })
                        if (problemsBody) problemsBody.focus()
                    })
                })

                const isCollapsed = this._problemsCollapsed.has(group.key)
                items.style.display = isCollapsed ? 'none' : 'block'
                toggle.textContent = isCollapsed ? '▸' : '▾'

                header.addEventListener('click', () => {
                    const nextCollapsed = !this._problemsCollapsed.has(group.key)
                    if (nextCollapsed) {
                        this._problemsCollapsed.add(group.key)
                        items.style.display = 'none'
                        toggle.textContent = '▸'
                    } else {
                        this._problemsCollapsed.delete(group.key)
                        items.style.display = 'block'
                        toggle.textContent = '▾'
                    }
                })

                groupEl.appendChild(items)
                problemsBody.appendChild(groupEl)
            })

            if (this._selectedProblemKey) {
                const idx = this._problemsFlat.findIndex(e => e.key === this._selectedProblemKey)
                if (idx >= 0) applyProblemSelection(idx, { showTooltip: false })
            } else {
                clearProblemSelection()
            }
        }

        if (problemsBody) {
            problemsBody.tabIndex = 0
            problemsBody.addEventListener('keydown', e => {
                if (activeConsoleTab !== 'problems') return
                if (!this._problemsFlat.length) return
                const key = e.key
                if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Tab') {
                    e.preventDefault()
                    const dir = (key === 'ArrowUp' || (key === 'Tab' && e.shiftKey)) ? -1 : 1
                    const nextIndex = this._selectedProblemIndex >= 0 ? this._selectedProblemIndex + dir : (dir > 0 ? 0 : this._problemsFlat.length - 1)
                    applyProblemSelection(nextIndex, { showTooltip: false, keyboard: true })
                } else if (key === 'Enter') {
                    e.preventDefault()
                    if (this._selectedProblemIndex >= 0) {
                        applyProblemSelection(this._selectedProblemIndex, { showTooltip: true, keyboard: true })
                    }
                } else if (key === 'Escape') {
                    e.preventDefault()
                    clearProblemSelection()
                    clearHoverHighlight()
                }
            })
        }

        consoleHeader.onclick = e => {
            if (e.target.closest('.plc-console-actions')) return
            if (e.target.closest('.plc-console-tab')) return
            if (consoleBody.classList.contains('minimized')) {
                openConsole()
            } else {
                consoleState.lastHeight = parseInt(getComputedStyle(consoleBody).height, 10)
                consoleState.minimized = true
                consoleBody.classList.add('minimized')
                consoleBody.style.height = `${consoleHeaderHeight}px`
            }
        }

        consoleTabs.forEach(tab => {
            tab.addEventListener('click', e => {
                e.preventDefault()
                e.stopPropagation()
                setActiveConsoleTab(tab.dataset.tab)
                openConsole()
            })
        })

        clearConsoleBtn.onclick = () => {
            if (outputBody) outputBody.innerHTML = ''
        }

        // Console Resizer Logic (Draggable Line)
        let isResizingConsole = false
        consoleResizer.addEventListener('mousedown', e => {
            isResizingConsole = true
            e.preventDefault()
            document.body.style.cursor = 'ns-resize'
        })

        document.addEventListener('mousemove', e => {
            if (!isResizingConsole) return

            const centerCol = workspace.querySelector('.plc-center-column')
            if (!centerCol) return
            const rect = centerCol.getBoundingClientRect()

            // Calculate height from bottom of center column
            let newHeight = rect.bottom - e.clientY

            // Constraints
            if (newHeight < consoleHeaderHeight + 2) newHeight = consoleHeaderHeight // Keep header visible
            if (newHeight > rect.height - 100) newHeight = rect.height - 100 // Max height

            consoleBody.style.height = newHeight + 'px'

            if (newHeight > consoleHeaderHeight) {
                consoleBody.classList.remove('minimized')
                consoleState.lastHeight = newHeight
                consoleState.minimized = false
            } else {
                consoleBody.classList.add('minimized')
                consoleState.minimized = true
            }
        })

        document.addEventListener('mouseup', () => {
            if (isResizingConsole) {
                isResizingConsole = false
                document.body.style.cursor = ''
            }
        })

        const device_info = workspace.querySelector('.plc-device-info')
        if (!device_info) throw new Error('Device info element not found')
        this.device_info = device_info

        const device_health = workspace.querySelector('.plc-device-health')
        if (!device_health) throw new Error('Device health element not found')
        this.device_health = device_health
        this.device_health_values = {
            cycleLast: device_health.querySelector('[data-field="cycle-last"]'),
            cycleMax: device_health.querySelector('[data-field="cycle-max"]'),
            ramFree: device_health.querySelector('[data-field="ram-free"]'),
            ramMin: device_health.querySelector('[data-field="ram-min"]'),
        }
        if (
            !this.device_health_values.cycleLast ||
            !this.device_health_values.cycleMax ||
            !this.device_health_values.ramFree ||
            !this.device_health_values.ramMin
        ) {
            throw new Error('Device health value elements not found')
        }
        const device_health_reset = device_health.querySelector('.plc-device-health-reset')
        if (!device_health_reset) throw new Error('Device health reset button not found')
        device_health_reset.addEventListener('click', () => this.#on_device_health_reset_click())
        this.device_health_reset = device_health_reset
        this._renderDeviceHealth(null)
        this._setHealthConnected(false)

        const device_select_element = workspace.querySelector('.plc-device-dropdown select')
        if (!device_select_element) throw new Error('Device select element not found')
        device_select_element.addEventListener('change', () => this.#on_device_select_change())
        this.device_select_element = device_select_element

        const device_online_button = workspace.querySelector('.plc-device-online')
        if (!device_online_button) throw new Error('Device online button not found')
        device_online_button.addEventListener('click', async () => this.#on_device_online_click())
        this.device_online_button = device_online_button

        // Poll connection status for footer buttons
        setInterval(() => {
            const connected = this.#editor.device_manager && this.#editor.device_manager.connected
            const status = workspace.querySelector('#footer-device-status')
            if (status) {
                status.innerText = connected ? 'Connected' : 'Disconnected'
                status.style.display = 'flex'
                status.style.alignItems = 'center'
                status.style.height = '100%'
                status.style.padding = '0 10px'
                status.style.margin = '0 8px'
                status.style.fontWeight = '600'
                status.style.backgroundColor = connected ? '#1fba5f' : ''
                status.style.color = connected ? '#fff' : ''
            }

            // Enable/Disable buttons based on connection
            if (compileBtn) {
                compileBtn.style.opacity = '1'
                compileBtn.style.pointerEvents = 'all'
            }
            if (downloadBtn) {
                downloadBtn.style.opacity = connected ? '1' : '0.5'
                downloadBtn.style.pointerEvents = connected ? 'all' : 'none'
            }

            // Update Setup Window if active/exists
            const setupWin = this.windows.get('setup')
            // @ts-ignore
            if (setupWin && typeof setupWin.updateConnectionStatus === 'function') {
                // @ts-ignore
                setupWin.updateConnectionStatus(connected)
            }

            const locked = !!connected
            if (this._edit_lock_state !== locked) {
                this._edit_lock_state = locked
                if (typeof this.#editor.setEditLock === 'function') {
                    this.#editor.setEditLock(locked)
                }
            }
            if (this._monitoringConnectionState !== connected) {
                this._monitoringConnectionState = connected
                this.setMonitoringActive(false)
                this.updateMonitoringAvailability(!!connected)
            }
            if (this._healthConnectionState !== connected) {
                this._healthConnectionState = connected
                if (connected) {
                    this._setHealthConnected(true)
                    this._startHealthPolling()
                } else {
                    this._stopHealthPolling()
                    this._setHealthConnected(false)
                }
            }
            this.updateLiveMonitorState()
        }, 500)

        const navigation = this.workspace.querySelector('.plc-navigation')
        if (!navigation) throw new Error('Navigation not found')
        this.div_navigation = navigation

        const window_frame = this.workspace.querySelector('.plc-window-frame')
        if (!window_frame) throw new Error('Window frame not found')
        this.window_frame = window_frame

        const tools = this.workspace.querySelector('.plc-tools')
        if (!tools) throw new Error('Tools not found')
        this.div_tools = tools

        this.tree_manager = new NavigationTreeManager(editor)
        this.tab_manager = new TabManager(editor)
    }

    #on_device_select_change = () => {
        // @ts-ignore
        const value = this.device_select_element.value
        this.active_device = value
    }

    /** @param {string} value */
    setActiveDevice(value) {
        if (!this.device_select_element) return
        this.device_select_element.value = value
        this.active_device = value
        // Trigger generic change handling if any exists beyond just setting the var
    }

    #on_device_health_reset_click = async () => {
        if (this._healthResetInFlight) return
        const editor = this.#editor
        if (!editor?.device_manager?.connected) return
        this._healthResetInFlight = true
        try {
            await editor.device_manager.resetHealth()
        } catch (err) {
            console.error('Failed to reset device health:', err)
        } finally {
            this._healthResetInFlight = false
        }
        this._pollDeviceHealth()
    }

    _setHealthConnected(connected = false) {
        const isConnected = !!connected
        if (this.device_health_reset) {
            if (isConnected) this.device_health_reset.removeAttribute('disabled')
            else this.device_health_reset.setAttribute('disabled', 'disabled')
        }
        if (!isConnected) {
            this._healthSnapshot = null
            this._renderDeviceHealth(null)
        }
    }

    _formatHealthNumber(value) {
        if (!Number.isFinite(value)) return null
        return String(Math.trunc(Number(value)))
    }

    _renderDeviceHealth(health) {
        if (!this.device_health_values) return
        const cycleLast = this.device_health_values.cycleLast
        const cycleMax = this.device_health_values.cycleMax
        const ramFree = this.device_health_values.ramFree
        const ramMin = this.device_health_values.ramMin
        if (!cycleLast || !cycleMax || !ramFree || !ramMin) return
        const withUnit = (value, unit) => {
            const text = this._formatHealthNumber(value)
            return text === null ? '-' : `${text} ${unit}`
        }
        if (!health) {
            cycleLast.textContent = '-'
            cycleMax.textContent = '-'
            ramFree.textContent = '-'
            ramMin.textContent = '-'
            return
        }
        const format = value => {
            const text = this._formatHealthNumber(value)
            return text === null ? '-' : `${text} B`
        }
        cycleLast.textContent = withUnit(health.last_cycle_time_us, 'us')
        cycleMax.textContent = withUnit(health.max_cycle_time_us, 'us')
        ramFree.textContent = format(health.ram_free)
        ramMin.textContent = format(health.min_ram_free)
    }

    _startHealthPolling() {
        if (this._healthTimer) return
        this._pollDeviceHealth()
        this._healthTimer = setInterval(() => {
            this._pollDeviceHealth()
        }, 5000)
    }

    _stopHealthPolling() {
        if (this._healthTimer) {
            clearInterval(this._healthTimer)
            this._healthTimer = null
        }
        this._healthInFlight = false
    }

    async _pollDeviceHealth() {
        if (this._healthInFlight) return
        const editor = this.#editor
        if (!editor?.device_manager?.connected) return
        this._healthInFlight = true
        try {
            const health = await editor.device_manager.getHealth()
            if (health) {
                this._healthSnapshot = health
                this._renderDeviceHealth(health)
            } else if (!this._healthSnapshot) {
                this._renderDeviceHealth(null)
            }
        } catch (err) {
            if (!this._healthSnapshot) {
                this._renderDeviceHealth(null)
            }
        } finally {
            this._healthInFlight = false
        }
    }

    focusSymbolByName(name) {
        if (!name) return false
        this.openProgram('symbols')
        const symbolsUI = this.windows.get('symbols')
        if (symbolsUI && typeof symbolsUI.focusSymbol === 'function') {
            return symbolsUI.focusSymbol(name)
        }
        return false
    }

    // Console Helpler
    consoleAutoOpened = false

    logToConsole(msg, type = 'info') {
        const body = this.workspace.querySelector('.plc-console-body.output')
        if (!body) return

        const line = document.createElement('div')
        line.style.borderBottom = '1px solid #333'
        line.style.padding = '2px 0'

        const d = new Date()
        const h = d.getHours().toString().padStart(2, '0')
        const m = d.getMinutes().toString().padStart(2, '0')
        const s = d.getSeconds().toString().padStart(2, '0')
        const ms = d.getMilliseconds().toString().padStart(3, '0')
        const timestamp = `${h}:${m}:${s}.${ms}`

        line.innerHTML = `<span style="color: #666; margin-right: 8px;">[${timestamp}]</span>`

        const content = document.createElement('span')
        content.style.whiteSpace = 'pre-wrap'
        content.innerText = typeof msg === 'string' ? msg : JSON.stringify(msg)

        const consoleEl = this.workspace.querySelector('.plc-console')
        const openConsole = height => {
            if (typeof this.openConsole === 'function') {
                this.openConsole(height)
                return
            }
            if (!consoleEl) return
            consoleEl.classList.remove('minimized')
            if (typeof height === 'number') {
                consoleEl.style.height = `${height}px`
            }
        }

        if (type === 'error') {
            content.style.color = '#f48771'
            openConsole(240)
        } else if (type === 'success') {
            content.style.color = '#89d185'
        } else if (type === 'warning') {
            content.style.color = '#cca700'
        }

        // Open console on first log of the session (usually compile/upload start)
        if (!this.consoleAutoOpened) {
            this.consoleAutoOpened = true
            openConsole(240)
        }

        line.appendChild(content)
        body.appendChild(line)
        body.scrollTop = body.scrollHeight
    }

    async handleCompile() {
        if (!this.#editor.runtime_ready) {
            this.logToConsole('WASM Runtime is not ready yet.', 'error')
            this.logToConsole('----------------------------------------', 'info')
            return
        }

        try {
            if (typeof this.setConsoleTab === 'function') {
                this.setConsoleTab('output')
            }
            this.logToConsole('Compiling project...', 'info')
            const startTime = performance.now()
            const result = await this.#editor.project_manager.compile()
            const endTime = performance.now()

            // Store result for download
            this.#editor.project.compiledBytecode = result.output
            this.#editor.project.compiledSize = result.size

            const MAX_PROGRAM_SIZE = 1024 // 1KB limit for now
            const percent = +((result.size / MAX_PROGRAM_SIZE) * 100).toFixed(1)
            const total_bars = 16
            const filled_bars = Math.round((Math.min(100, percent) / 100) * total_bars)
            const empty_bars = total_bars - filled_bars
            const bar = '[' + '='.repeat(filled_bars) + ' '.repeat(empty_bars) + ']'

            // Calculate Checksum
            let checksumMsg = ''
            let hexPreview = ''
            if (this.#editor.runtime && this.#editor.runtime.parseHex && this.#editor.runtime.crc8) {
                try {
                    const bytes = this.#editor.runtime.parseHex(result.output)
                    const checksum = this.#editor.runtime.crc8(bytes)

                    if (this.lastCompiledChecksum === checksum) {
                        checksumMsg = " No changes."
                    }
                    // else {
                    //    checksumMsg = ` Checksum: ${checksum.toString(16).toUpperCase().padStart(2, '0')}`
                    // }
                    this.lastCompiledChecksum = checksum

                    // Preview first 24 bytes
                    const subset = bytes.slice(0, 24)
                    hexPreview = subset.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
                    if (bytes.length > 24) hexPreview += '...'
                } catch (e) {
                    console.warn('Checksum calculation failed', e)
                }
            }

            this.logToConsole(`Compilation finished in ${(endTime - startTime).toFixed(2)}ms${checksumMsg}`, 'success')
            this.logToConsole(`${bar} ${result.size}/${MAX_PROGRAM_SIZE} bytes (${percent}%)`, result.size > MAX_PROGRAM_SIZE ? 'error' : 'info')

            if (hexPreview) this.logToConsole('Bytecode: ' + hexPreview)

            // Auto open console
            if (typeof this.openConsole === 'function') {
                this.openConsole(150)
            } else {
                const consoleEl = this.workspace.querySelector('.plc-console')
                if (consoleEl) {
                    consoleEl.classList.remove('minimized')
                    consoleEl.style.height = '150px'
                }
            }
            this.logToConsole('----------------------------------------', 'info')
        } catch (e) {
            this.logToConsole(`Compilation failed: ${e.message}`, 'error')
            this.logToConsole('----------------------------------------', 'info')
        }
    }

    async handleDownload() {
        const connected = this.#editor.device_manager && this.#editor.device_manager.connected
        if (!connected) {
            this.logToConsole('Connect to a device to download.', 'warning')
            this.logToConsole('----------------------------------------', 'info')
            return
        }
        const compiledBytecode = this.#editor.project.compiledBytecode
        const compiledSize = this.#editor.project.compiledSize

        if (!compiledBytecode) {
            this.logToConsole('No compiled program found. Please Compile first.', 'error')
            this.logToConsole('----------------------------------------', 'info')
            return
        }

        const MAX_PROGRAM_SIZE = 1024
        if (compiledSize > MAX_PROGRAM_SIZE) {
            this.logToConsole(`Program too large! ${compiledSize} > ${MAX_PROGRAM_SIZE} bytes.`, 'error')
            this.logToConsole('Upload aborted.', 'error')
            this.logToConsole('----------------------------------------', 'info')
            return
        }

        const deviceInfo = this.#editor.device_manager.deviceInfo
        const projectInfo = this.#editor.project.info

        if (deviceInfo && projectInfo) {
            const mismatches = []

            if (deviceInfo.arch && projectInfo.arch && deviceInfo.arch !== projectInfo.arch) {
                mismatches.push(`Architecture: Device (<b>${deviceInfo.arch}</b>) vs Project (<b>${projectInfo.arch}</b>)`)
            }
            deviceInfo.type = deviceInfo.type || deviceInfo.device
            if (deviceInfo.type && projectInfo.type && deviceInfo.type !== projectInfo.type) {
                mismatches.push(`Type: Device (<b>${deviceInfo.type}</b>) vs Project (<b>${projectInfo.type}</b>)`)
            }
            // Strict version check might be too aggressive if we just want compatibility, but the user asked for "any details"
            if (deviceInfo.version && projectInfo.version && deviceInfo.version !== projectInfo.version) {
                 mismatches.push(`Version: Device (<b>${deviceInfo.version}</b>) vs Project (<b>${projectInfo.version}</b>)`)
            }

            if (mismatches.length > 0) {
                const details = `<br><br><span style="color: #777; font-size: 0.9em;">Target: <b>${deviceInfo.type  || '?'}</b> ${deviceInfo.arch ? ('(' + deviceInfo.arch + ')') : ''} <span style="opacity: 0.7">${deviceInfo.version ? 'v' + deviceInfo.version : ''}</span></span>`
                const description = `The connected device details do not match the project configuration:<br><br>${mismatches.join('<br>')}<br><br>Upload anyway?${details}`
                const confirm = await Popup.confirm({
                    title: 'Device Mismatch',
                    description: description,
                    confirm_text: 'Upload',
                    cancel_text: 'Cancel',
                    confirm_button_color: '#d1852e',
                    confirm_text_color: '#FFF'
                })
                if (!confirm) {
                    this.logToConsole('Upload aborted due to device mismatch.', 'warning')
                    this.logToConsole('----------------------------------------', 'info')
                    return
                }
            } else {
                const details = `<br><br><span style="color: #777; font-size: 0.9em;">Target: <b>${deviceInfo.type || '?'}</b> ${deviceInfo.arch ? ('(' + deviceInfo.arch + ')') : ''} <span style="opacity: 0.7">${deviceInfo.version ? 'v' + deviceInfo.version : ''}</span></span>`
                const confirm = await Popup.confirm({
                    title: 'Upload Program',
                    description: `Upload ${compiledSize} bytes to the device? This will overwrite the current program.${details}`,
                    confirm_text: 'Upload',
                    cancel_text: 'Cancel',
                })
                if (!confirm) {
                    this.logToConsole('Upload cancelled.', 'info')
                    this.logToConsole('----------------------------------------', 'info')
                    return
                }
            }
        } else {
             const dInfo = deviceInfo || this.#editor.device_manager.deviceInfo
             const details = dInfo ? `<br><br><span style="color: #777; font-size: 0.9em;">Target: <b>${dInfo.type || '?'}</b> ${dInfo.arch ? ('(' + dInfo.arch + ')') : ''} <span style="opacity: 0.7">${dInfo.version ? 'v' + dInfo.version : ''}</span></span>` : ''
             
             const confirm = await Popup.confirm({
                title: 'Upload Program',
                description: `Upload ${compiledSize} bytes to the device? This will overwrite the current program.${details}`,
                confirm_text: 'Upload',
                cancel_text: 'Cancel',
            })
            if (!confirm) {
                this.logToConsole('Upload cancelled.', 'info')
                this.logToConsole('----------------------------------------', 'info')
                return
            }
        }

        try {
            this.logToConsole(`Uploading ${compiledSize} bytes to device...`, 'info')
            const startTime = performance.now()
            await this.#editor.device_manager.connection.downloadProgram(compiledBytecode)
            const endTime = performance.now()
            this.logToConsole('Program uploaded successfully.', 'success')
            this.logToConsole(`Upload took ${(endTime - startTime).toFixed(0)}ms`, 'info')
            this.logToConsole('----------------------------------------', 'info')
        } catch (e) {
            this.logToConsole(`Upload failed: ${e.message}`, 'error')
            this.logToConsole('----------------------------------------', 'info')
        }
    }

    #on_device_online_click = async () => {
        const editor = this.#editor
        const device_info = this.device_info
        const device_select_element = this.device_select_element
        const device_online_button = this.device_online_button
        // If attribute is disabled, return
        if (device_online_button.hasAttribute('disabled')) return
        const mode = this.active_mode === 'edit' ? 'online' : 'edit'

        device_online_button.setAttribute('disabled', 'disabled')
        const device_select_element_was_disabled = device_select_element.hasAttribute('disabled')
        if (!device_select_element_was_disabled) device_select_element.setAttribute('disabled', 'disabled')
        if (mode === 'online') {
            // @ts-ignore
            const before = device_online_button.innerText
            // @ts-ignore
            device_online_button.innerText = '----------'
            const connected = await this.requestConnect(this.active_device)
            if (!connected) {
                console.error('Failed to connect to device')
                await editor.device_manager.disconnect()
                device_online_button.removeAttribute('disabled')
                if (!device_select_element_was_disabled) device_select_element.removeAttribute('disabled')
                // @ts-ignore
                device_online_button.innerText = before
                device_info.innerHTML = editor.device_manager.error || ''
                this._healthConnectionState = false
                this._stopHealthPolling()
                this._setHealthConnected(false)
                return
            }
            const info = editor.device_manager.deviceInfo
            if (info) device_info.innerHTML = `${info.arch} v${info.version.split(' ')[0]}`
            else device_info.innerHTML = 'Unknown device'
            this._healthConnectionState = true
            this._setHealthConnected(true)
            this._startHealthPolling()
        } else {
            device_info.innerHTML = ''
            await editor.device_manager.disconnect()
            this._healthConnectionState = false
            this._stopHealthPolling()
            this._setHealthConnected(false)
        }
        device_online_button.removeAttribute('disabled')
        if (!device_select_element_was_disabled) device_select_element.removeAttribute('disabled')

        // @ts-ignore
        device_online_button.innerText = mode === 'online' ? 'Go offline' : 'Go online'
        if (mode === 'online') {
            device_select_element.setAttribute('disabled', 'disabled')
            device_online_button.classList.remove('green')
            device_online_button.classList.add('orange')
        } else {
            device_select_element.removeAttribute('disabled')
            device_online_button.classList.remove('orange')
            device_online_button.classList.add('green')
        }
        this.active_mode = mode
        if (typeof editor.setEditLock === 'function') {
            editor.setEditLock(mode === 'online')
        }
    }

    #on_navigation_minimize_toggle = () => {
        const navigation = this.div_navigation
        const [container] = Array.from(navigation.children)
        if (!container) throw new Error('Navigation container not found')
        const bar = navigation.querySelector('.plc-navigation-bar .menu-button')
        if (!bar) throw new Error('Navigation bar not found')
        // If the navigation doesn't have class 'minimized', we add it to the navigation and change the button text to '+'
        // Otherwise we remove the class and change the button text to '-'
        const is_minimized = navigation.classList.contains('minimized')
        if (is_minimized) {
            navigation.classList.remove('minimized')
            bar.innerHTML = '-'
        } else {
            navigation.classList.add('minimized')
            bar.innerHTML = '+'
        }
    }

    #on_tools_minimize_toggle = () => {
        const tools = this.div_tools
        if (!tools) throw new Error('Tools not found')
        const [container] = Array.from(tools.children)
        if (!container) throw new Error('Tools container not found')
        const bar = tools.querySelector('.plc-tools-bar .menu-button')
        if (!bar) throw new Error('Tools bar not found')
        // If the tools doesn't have class 'minimized', we add it to the tools and change the button text to '+'
        // Otherwise we remove the class and change the button text to '-'
        const is_minimized = tools.classList.contains('minimized')
        if (is_minimized) {
            tools.classList.remove('minimized')
            bar.innerHTML = '-'
        } else {
            tools.classList.add('minimized')
            bar.innerHTML = '+'
        }
    }

    setMode = mode => {
        this.mode = mode
        const workspace = this.#editor.workspace
    }
    setDevice = device => {
        this.device = device
    }

    refreshDeviceOptions = () => {
        const options = this.#editor.device_manager.devices
        if (!options) throw new Error('Options not provided')
        if (!Array.isArray(options)) throw new Error('Options must be an array')
        if (options.length === 0) throw new Error('Options array is empty')
        // Update dropdown with options
        const device_select_element = this.#editor.workspace.querySelector('.plc-device-dropdown select')
        if (!device_select_element) throw new Error('Device select element not found')
        device_select_element.innerHTML = ''
        options.forEach(option => {
            const {name, key, disabled} = option
            const opt = document.createElement('option')
            opt.value = key
            opt.innerText = name
            const isDisabled = !!disabled
            if (isDisabled) {
                opt.setAttribute('disabled', 'disabled')
                opt.setAttribute('title', disabled)
            }
            // @ts-ignore
            opt.disabled = isDisabled
            // @ts-ignore
            opt.classList.add('device-option')
            device_select_element.appendChild(opt)
        }) // @ts-ignore
        // Set active device to first option
        this.active_device = options[0].key // @ts-ignore
        device_select_element.value = this.active_device
    }

    setActiveDevice(device) {
        const select = this.#editor.workspace.querySelector('.plc-device-dropdown select')
        if (!select) return
        // Check if device exists in options
        const option = select.querySelector(`option[value="${device}"]`)
        if (option && !option.disabled) {
            this.active_device = device
            select.value = device
        }
    }

    get_focusable_elements = () => {
        const workspace = this.#editor.workspace
        const elems = [...workspace.querySelectorAll('[tabindex]')]
        return elems.filter(elem => {
            // @ts-ignore
            const focusable = elem.tabIndex >= 0
            const visible = isVisible(elem)
            return focusable && visible
        })
    }

    initialize() {
        this.refreshDeviceOptions()

        const workspace = this.#editor.workspace

        this.tree_manager.initialize()

        // On ESC remove all selections
        workspace.addEventListener('keydown', event => {
            const enter = event.key === 'Enter'
            const space = event.key === ' '
            const tab = event.key === 'Tab'
            const esc = event.key === 'Escape'
            const ctrl = event.ctrlKey
            const shift = event.shiftKey
            const alt = event.altKey
            const del = event.key === 'Delete'
            const x = event.key.toLocaleLowerCase() === 'x'
            const c = event.key.toLocaleLowerCase() === 'c'
            const v = event.key.toLocaleLowerCase() === 'v'
            const a = event.key.toLocaleLowerCase() === 'a'
            const left = event.key === 'ArrowLeft'
            const right = event.key === 'ArrowRight'
            const up = event.key === 'ArrowUp'
            const down = event.key === 'ArrowDown'
            const home = event.key === 'Home'
            const end = event.key === 'End'
            const pageup = event.key === 'PageUp'
            const pagedown = event.key === 'PageDown'
            const f2 = event.key === 'F2'
            // if (esc) this.deselectAll()
            // if (ctrl && c) this.copySelection()
            // if (ctrl && x) this.cutSelection()
            // if (ctrl && v) this.pasteSelection()
            // if (del) this.deleteSelection()

            const activeElement = document.activeElement
            if (activeElement) {
                const tree_folder = activeElement.classList.contains('plc-navigation-folder')
                const tree_file = activeElement.classList.contains('plc-navigation-program')
                const tree_item = tree_folder || tree_file
                const tab = activeElement.classList.contains('plc-tab')
                const online_button = activeElement.classList.contains('plc-device-online')

                const focusable_elements = this.get_focusable_elements()
                const length = focusable_elements.length
                const index = focusable_elements.indexOf(activeElement)
                const next = index >= 0 ? focusable_elements[(index + 1) % length] : null
                const prev = index >= 0 ? focusable_elements[(index - 1 + length) % length] : null

                const clickable = tree_item || tab || online_button
                if (clickable && (enter || space)) {
                    // @ts-ignore
                    // trigger click on the element
                    activeElement.click()
                }

                if (tree_item) {
                    if (f2) {
                        // Trigger rename
                        const item = this.tree_manager.findItem(activeElement)
                        if (item) {
                            // @ts-ignore
                            // item.requestRename()
                        }
                    }
                    if (up) {
                        const prev_item = this.tree_manager.findItem(prev)
                        if (!prev_item) return
                        event.preventDefault() // @ts-ignore
                        if (prev) prev.focus()
                    }
                    if (down) {
                        const next_item = this.tree_manager.findItem(next)
                        if (!next_item) return
                        event.preventDefault() // @ts-ignore
                        if (next) next.focus()
                    }
                }

                if (tree_folder) {
                    if (left) {
                        const item = this.tree_manager.findItem(activeElement)
                        // console.log('Left', item)
                        if (item) {
                            // @ts-ignore
                            item.item.collapse()
                        }
                    }
                    if (right) {
                        const item = this.tree_manager.findItem(activeElement)
                        // console.log('Right', item)
                        if (item) {
                            // @ts-ignore
                            item.item.expand()
                        }
                    }
                }

                if (tab) {
                    if (left) {
                        const prev_is_tab = this.tab_manager.isTabElement(prev)
                        if (prev_is_tab) {
                            event.preventDefault() // @ts-ignore
                            if (prev) prev.focus()
                        }
                    }
                    if (right) {
                        const next_is_tab = this.tab_manager.isTabElement(next)
                        if (next_is_tab) {
                            event.preventDefault() // @ts-ignore
                            if (next) next.focus()
                        }
                    }
                }
            }
        })

        workspace.addEventListener('mousedown', event => {
            const middle_mouse = event.button === 1

            const target = event.target
            // @ts-ignore
            const is_tab = target && target.closest('.plc-tab')

            if (middle_mouse && is_tab) {
                event.preventDefault()
                event.stopPropagation()
                const program = this.#editor.findProgram(event.target)
                if (program) {
                    const id = program.id
                    if (!id) throw new Error('Program ID not found')
                    this.#editor.window_manager.closeProgram(id)
                }
            }
        })

        workspace.addEventListener('mousemove', this.onMouseMove)
    }

    onMouseMove = event => {
        this.#on_debug_hover(event)
    }

    #on_debug_hover = event => {
        if (this.#editor.debug_hover) {
            this.footer = this.footer || this.#editor.workspace.querySelector('.plc-workspace-footer p')
            const footer = this.footer
            if (!footer) throw new Error('Footer not found')
            const path = getEventPath(event, 'plc-workspace')
            if (!path || !path.length) {
                // @ts-ignore
                footer.innerText = ''
                return
            }
            const root = path.shift()
            if (!root) throw new Error('Root not found')
            let trimmed = path.length > 3
            while (path.length > 3) path.shift()
            if (trimmed) path.unshift('...')
            path.unshift(root)
            const path_string = path.join(' > ') // @ts-ignore
            footer.innerText = path_string
        }
    }

    /** @param { PLC_Project } project */
    openProject(project) {
        this.project = project
        this.tree_manager.draw_navigation_tree(true)
        // this.tab_manager.draw_tabs()
        this.refreshDeviceOptions()
        // this.#editor.draw()

        // Open main program
        // if (project.files) {
        //     const main = project.files.find(f => f.name === 'main' && f.path === '/' && f.type === 'program')
        //     if (main && main.id) this.openProgram(main.id)
        // }
    }

    /** @type { (id: string) => (WindowType | undefined) } */
    createEditorWindow(id) {
        // Check if the program exists in 'this.windows'
        if (this.windows.has(id)) {
            // If it exists, return the existing editor UI
            return this.windows.get(id)
        }
        // If it doesn't exist, create a new editor UI
        /** @type { WindowType } */
        let editorUI
        if (id === 'symbols') {
            editorUI = new SymbolsUI(this.#editor)
        } else if (id === 'setup') {
            editorUI = new SetupUI(this.#editor)
        } else if (id === 'memory') {
            editorUI = new MemoryUI(this.#editor)
        } else {
            editorUI = new EditorUI(this.#editor, id)
        }
        if (editorUI && typeof editorUI.setLocked === 'function') {
            editorUI.setLocked(!!this.#editor.edit_locked)
        }
        if (editorUI && typeof editorUI.updateMonitoringState === 'function') {
            editorUI.updateMonitoringState(this._monitoringActive)
        }
        if (editorUI && typeof editorUI.updateMonitoringAvailability === 'function') {
            editorUI.updateMonitoringAvailability(this._monitoringAvailable)
        }
        this.windows.set(id, editorUI)
        // Append the editor UI to the workspace
        if (editorUI.div) this.window_frame.appendChild(editorUI.div)
        // Return the newly created editor UI
        return editorUI
    }

    /** @type { (id: string) => void } */
    closeProgram(id) {
        if (!id) throw new Error('Program ID not found')
        if (this._selectedProblemProgramId && this._selectedProblemProgramId === id) {
            if (typeof this.clearProblemSelection === 'function') {
                this.clearProblemSelection()
            }
        }
        // Remove highlight from the tree
        this.#editor.window_manager.removeHighlight()
        
        const exists = this.windows.get(id)
        exists?.close()
        this.windows.delete(id)
        if (id === 'symbols') {
            this.updateLiveMonitorState()
        }
        
        const active_program = this.#editor.findProgram(id)
        if (active_program) active_program.host = undefined
        const next_id = this.#editor.window_manager.tab_manager.closeTab(id)
        if (next_id) {
            this.#editor.window_manager.openProgram(next_id)
        } else {
            this.#editor.window_manager.active_program = undefined
        }
    }

    isMonitoringActive() {
        return !!this._monitoringActive
    }

    isMonitoringAvailable() {
        return !!this._monitoringAvailable
    }

    setMonitoringActive(active = false) {
        const next = !!active
        if (this._monitoringActive === next) return
        this._monitoringActive = next
        for (const win of this.windows.values()) {
            if (win && typeof win.updateMonitoringState === 'function') {
                win.updateMonitoringState(next)
            }
        }
        this.updateLiveMonitorState()
    }

    toggleMonitoringActive() {
        this.setMonitoringActive(!this._monitoringActive)
    }

    updateMonitoringAvailability(available = false) {
        this._monitoringAvailable = !!available
        for (const win of this.windows.values()) {
            if (win && typeof win.updateMonitoringAvailability === 'function') {
                win.updateMonitoringAvailability(this._monitoringAvailable)
            }
        }
    }

    updateLiveMonitorState() {
        const editor = this.#editor
        const connected = !!editor?.device_manager?.connected
        const shouldMonitor = !!connected && this._monitoringActive
        if (shouldMonitor) {
            this._startLiveMemoryMonitor()
            return
        }
        if (this._liveMemoryTimer || (editor?.live_symbol_values && editor.live_symbol_values.size)) {
            this._stopLiveMemoryMonitor()
        }
    }

    _startLiveMemoryMonitor() {
        if (this._liveMemoryTimer) return
        this._pollLiveSymbols()
        this._liveMemoryTimer = setInterval(() => {
            this._pollLiveSymbols()
        }, 100)
    }

    _stopLiveMemoryMonitor() {
        if (this._liveMemoryTimer) {
            clearInterval(this._liveMemoryTimer)
            this._liveMemoryTimer = null
        }
        this._liveMemoryInFlight = false
        const editor = this.#editor
        if (editor && editor.live_symbol_values) {
            editor.live_symbol_values = new Map()
        }
        const symbols = this.windows.get('symbols')
        if (symbols && typeof symbols.updateLiveValues === 'function') {
            symbols.updateLiveValues(new Map())
        }
    }

    async _pollLiveSymbols() {
        const editor = this.#editor
        if (!editor?.device_manager?.connected) return
        if (!this._monitoringActive) return
        if (this._liveMemoryInFlight) return
        const projectSymbols = editor.project?.symbols || []
        const offsets = normalizeOffsets(editor.project?.offsets || {})
        const addressRefs = typeof editor._getAsmAddressRefsForLive === 'function'
            ? editor._getAsmAddressRefsForLive(offsets)
            : []
        const symbolEntries = []
        const seenNames = new Set()
        projectSymbols.forEach(symbol => {
            if (!symbol || !symbol.name) return
            seenNames.add(symbol.name)
            symbolEntries.push(symbol)
        })
        addressRefs.forEach(ref => {
            if (!ref || !ref.name) return
            if (seenNames.has(ref.name)) return
            seenNames.add(ref.name)
            symbolEntries.push({
                name: ref.name,
                location: ref.location,
                type: ref.type || 'bit',
                address: ref.address,
                absoluteAddress: ref.absoluteAddress,
                bit: typeof ref.bit === 'number' ? ref.bit : null,
            })
        })
        if (!symbolEntries.length) return
        const memoryLimitValue = Number(editor.device_manager?.deviceInfo?.memory)
        const memoryLimit = Number.isFinite(memoryLimitValue) && memoryLimitValue > 0
            ? memoryLimitValue
            : null

        const groups = new Map()
        const typeSizes = {
            bit: 1,
            byte: 1,
            int: 2,
            dint: 4,
            real: 4,
        }
        const normalizeAddress = (symbol) => {
            const locationKey = symbol?.location === 'memory' ? 'marker' : symbol?.location
            const baseOffset = locationKey && offsets[locationKey]
                ? (offsets[locationKey].offset || 0)
                : 0
            const addrVal = parseFloat(symbol?.address) || 0
            if (symbol?.type === 'bit') {
                const byte = Math.floor(addrVal)
                const bit = Math.round((addrVal - byte) * 10)
                return { absolute: baseOffset + byte, bit, size: 1 }
            }
            const size = typeSizes[symbol?.type] || 1
            return { absolute: baseOffset + Math.floor(addrVal), bit: null, size }
        }

        symbolEntries.forEach(symbol => {
            if (!symbol || !symbol.name) return
            const layout = normalizeAddress(symbol)
            const end = layout.absolute + layout.size
            const key = (symbol.location === 'memory' ? 'marker' : symbol.location) || 'marker'
            if (!groups.has(key)) {
                groups.set(key, { min: layout.absolute, max: end, items: [] })
            }
            const group = groups.get(key)
            group.min = Math.min(group.min, layout.absolute)
            group.max = Math.max(group.max, end)
            group.items.push({ symbol, layout })
        })

        this._liveMemoryInFlight = true
        try {
            const liveValues = new Map()
            for (const group of groups.values()) {
                const readStart = Math.max(0, group.min)
                const readEnd = memoryLimit !== null ? Math.min(group.max, memoryLimit) : group.max
                const size = Math.max(0, readEnd - readStart)
                if (!size) continue
                let raw = await editor.device_manager.readMemory(readStart, size)
                let bytes = null
                if (raw instanceof Uint8Array) {
                    bytes = raw
                } else if (Array.isArray(raw)) {
                    bytes = Uint8Array.from(raw)
                } else if (raw && raw.buffer) {
                    bytes = new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength || raw.length || 0)
                }
                if (!bytes || !bytes.length) continue
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

                group.items.forEach(({ symbol, layout }) => {
                    const offset = layout.absolute - readStart
                    const type = symbol.type || 'byte'
                    let value = null
                    let text = '-'
                    if (offset < 0 || offset >= bytes.length) {
                        liveValues.set(symbol.name, { value: null, text, type })
                        return
                    }
                    if (type === 'bit') {
                        const byteVal = bytes[offset]
                        const bit = layout.bit || 0
                        value = (byteVal >> bit) & 1
                        text = value ? 'ON' : 'OFF'
                    } else if (type === 'byte') {
                        value = bytes[offset]
                        text = String(value)
                    } else if (type === 'int') {
                        if (offset + 2 <= bytes.length) {
                            value = view.getInt16(offset, true)
                            text = String(value)
                        }
                    } else if (type === 'dint') {
                        if (offset + 4 <= bytes.length) {
                            value = view.getInt32(offset, true)
                            text = String(value)
                        }
                    } else if (type === 'real') {
                        if (offset + 4 <= bytes.length) {
                            value = view.getFloat32(offset, true)
                            text = Number.isFinite(value) ? value.toFixed(3) : String(value)
                        }
                    } else {
                        value = bytes[offset]
                        text = String(value)
                    }
                    liveValues.set(symbol.name, { value, text, type })
                })
            }
            editor.live_symbol_values = liveValues
            const symbolsUI = this.windows.get('symbols')
            if (symbolsUI && typeof symbolsUI.updateLiveValues === 'function') {
                symbolsUI.updateLiveValues(liveValues)
            }
        } catch (e) {
            // Ignore transient read errors while connected
        } finally {
            this._liveMemoryInFlight = false
        }
    }

    focusCodeLocation(entry) {
        if (!entry || !entry.programId || !entry.blockId) return false
        const editor = this.#editor
        const waitForLayout = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const findTarget = () => {
            const program = editor.findProgram(entry.programId)
            if (program) {
                const block = program?.blocks?.find(b => b.id === entry.blockId)
                if (block) return { program, block }
            }
            const programs = editor._getLintPrograms?.() || []
            for (const prog of programs) {
                const block = prog?.blocks?.find(b => b.id === entry.blockId)
                if (block) return { program: prog, block }
            }
            return { program: null, block: null }
        }
        const waitForVisible = async block => {
            for (let i = 0; i < 6; i++) {
                if (block?.div) {
                    const rect = block.div.getBoundingClientRect()
                    if (rect.width > 0 && rect.height > 0) return true
                }
                await waitForLayout()
            }
            return false
        }
        const waitForEditor = async block => {
            for (let i = 0; i < 6; i++) {
                if (block?.props?.text_editor) return block.props.text_editor
                await waitForLayout()
            }
            return block?.props?.text_editor || null
        }
        const expandBlock = block => {
            if (!block?.div) return
            if (!block.div.classList.contains('minimized')) return
            block.div.classList.remove('minimized')
            block.minimized = false
            const minimizeBtn = block.div.querySelector('.menu-button.minimize')
            if (minimizeBtn) minimizeBtn.innerText = '-'
        }
        const scrollBlockIntoView = (blockDiv, ratio = 0.33) => {
            if (!blockDiv) return
            const body = blockDiv.closest('.plc-editor-body')
            if (!body) return
            const bodyRect = body.getBoundingClientRect()
            const blockRect = blockDiv.getBoundingClientRect()
            const blockTop = blockRect.top - bodyRect.top + body.scrollTop
            const targetTop = Math.max(0, blockTop - body.clientHeight * ratio)
            if (Math.abs(body.scrollTop - targetTop) > 1) {
                body.scrollTop = targetTop
            }
            const nextBlockRect = blockDiv.getBoundingClientRect()
            if (nextBlockRect.top < bodyRect.top || nextBlockRect.bottom > bodyRect.bottom) {
                blockDiv.scrollIntoView({ block: 'center' })
            }
        }
        const scrollBodyToCode = (blockDiv, codeEditor, index, ratio = 0.33) => {
            if (!blockDiv || !codeEditor || typeof codeEditor.getCodePosition !== 'function') return
            const body = blockDiv.closest('.plc-editor-body')
            if (!body) return
            const bodyRect = body.getBoundingClientRect()
            const pos = codeEditor.getCodePosition(index)
            const delta = pos.viewportY - bodyRect.top
            const targetTop = Math.max(0, body.scrollTop + delta - body.clientHeight * ratio)
            if (Math.abs(body.scrollTop - targetTop) > 1) {
                body.scrollTop = targetTop
            }
        }
        const getIndexFromLine = (text, line) => {
            if (!line || line <= 1) return 0
            let current = 1
            for (let i = 0; i < text.length; i++) {
                if (text.charCodeAt(i) === 10) {
                    current += 1
                    if (current === line) return i + 1
                }
            }
            return text.length
        }
        const getTargetIndex = codeEditor => {
            const text = typeof codeEditor?.getValue === 'function' ? codeEditor.getValue() : ''
            if (typeof entry.index === 'number') {
                return Math.max(0, Math.min(entry.index, text.length))
            }
            if (typeof entry.line === 'number') {
                return getIndexFromLine(text, entry.line)
            }
            return 0
        }
        const run = async () => {
            let { program, block } = findTarget()
            if (!block) return

            if (program?.id) {
                this.openProgram(program.id)
                await waitForLayout()
                ;({ program, block } = findTarget())
                if (!block) return
            }

            expandBlock(block)
            if (!block?.div) return

            await waitForVisible(block)
            scrollBlockIntoView(block.div, 0.33)
            await waitForLayout()

            const codeEditor = await waitForEditor(block)
            if (!codeEditor) return

            const index = getTargetIndex(codeEditor)
            if (typeof codeEditor.setCursor === 'function') {
                codeEditor.setCursor(index, { reveal: true, suppressHistory: true, ratio: 0.33 })
            } else if (typeof codeEditor.revealRange === 'function') {
                codeEditor.revealRange({ start: index, end: index + 1 }, { ratio: 0.33, highlight: false })
            }
            await waitForLayout()
            scrollBodyToCode(block.div, codeEditor, index, 0.33)
        }

        run()
        return true
    }

    /** @param {string} id */
    restoreLazyTab(id) {
         const prog = this.#editor.findProgram(id)
         if (!prog) return
         this.tab_manager.addLazyTab(id)
    }

    /** @param { string | null | undefined } id */
    openProgram(id) {
        const editor = this.#editor
        if (!id) throw new Error('Program ID not found')

        if (id === 'symbols' || id === 'setup' || id === 'memory') {
            if (typeof editor._pushWindowHistory === 'function') {
                editor._pushWindowHistory(id)
            }
        }

        const existingTab = this.tab_manager.tabs.get(id)
        const existingProgram = editor.findProgram(id)
        const existingHost = existingProgram?.host || existingTab?.host
        if (existingTab && existingHost && existingProgram) {
            this.active_tab = id
            this.active_program = existingProgram
            existingProgram.host = existingHost
            this.tab_manager.switchTo(id)
            return
        }

        if (!existingTab && existingHost && existingProgram) {
            this.active_tab = id
            this.active_program = existingProgram
            existingProgram.host = existingHost
            this.tab_manager.openTab(id, existingHost)
            existingHost.show()
            return
        }

        if (this.active_program) {
            this.active_program.host?.hide()
        }
        this.active_tab = id
        this.active_program = editor.findProgram(id)
        if (!this.active_program) throw new Error(`Program not found: ${id}`)
        const host = this.active_program.host || this.createEditorWindow(id)
        if (!host) throw new Error('Host not found')
        if (!this.active_program.host) this.active_program.host = host
        this.tab_manager.openTab(id, host)
        this.active_program.host.program = this.active_program
        this.active_tab = id
        this.active_program.host.reloadProgram()
        this.active_program.host.show()
        const frame = this.active_program.host.frame
        if (!frame) throw new Error('Frame not found')
        const frame_width = frame.clientWidth
        if (frame_width <= 500) {
            // minimize navigation
            const navigation = this.workspace.querySelector('.plc-navigation')
            if (!navigation) throw new Error('Navigation not found')
            navigation.classList.add('minimized')
            const minimize = navigation.querySelector('.plc-navigation-bar .menu-button')
            if (!minimize) throw new Error('Minimize button not found')
            minimize.innerHTML = '+'
        }
        // this.draw()
    }
}
