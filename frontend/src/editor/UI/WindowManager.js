import {PLC_Project, PLCEditor} from '../../utils/types.js'
import VOVKPLCEDITOR_VERSION_BUILD, {VOVKPLCEDITOR_VERSION} from '../BuildNumber.js'
import {ElementSynthesisMany, getEventPath, isVisible, readTypedValue} from '../../utils/tools.js'
import {ensureOffsets} from '../../utils/offsets.js'
import {Popup} from './Elements/components/popup.js'
import NavigationTreeManager from './Elements/NavigationTreeManager.js'
import WatchPanel from './Elements/WatchPanel.js'
import DataFetcher from '../DataFetcher.js'
import TabManager from './Elements/TabManager.js'
import EditorUI from './Elements/EditorUI.js'
import SymbolsUI from './Elements/SymbolsUI.js'
import SetupUI from './Elements/SetupUI.js'
import MemoryUI from './Elements/MemoryUI.js'
import DataBlocksUI from './Elements/DataBlocksUI.js'
import DataBlockUI from './Elements/DataBlockUI.js'
import {CustomDropdown} from './Elements/CustomDropdown.js'

/** @typedef { EditorUI | SymbolsUI | SetupUI | DataBlocksUI | DataBlockUI } WindowType */

export default class WindowManager {
    /** @type {'edit' | 'online'} */
    active_mode = 'edit'

    /** @type {'simulation' | 'device'} */
    active_device = 'simulation'
    _monitoringActive = false
    _monitoringAvailable = true // Always available - can toggle in any state
    _liveEditEnabled = false
    _monitoringConnectionState = null
    _healthConnectionState = null
    _healthTimer = null
    _healthInFlight = false
    _healthResetInFlight = false
    _healthSnapshot = null

    // Loading bar state
    _loadingBar = null
    _loadingBarProgress = null
    _loadingBarText = null
    _loadingCount = 0
    _loadingTimeout = null

    workspace_body

    /** @type { Map<string, WindowType> } */
    windows = new Map() // filePath → { tabEl, editorEl }

    window_frame

    /** @type { (device: string) => Promise<boolean> } */
    requestConnect = async device => false

    highlightItem = element => this.tree_manager.highlightItem(element)
    removeHighlight = () => this.tree_manager.removeHighlight()

    // Serial Polling Methods
    _handleSerialEvent = event => {
        // console.log('[WindowManager] Serial event detected:', event.type)
        // Delay slightly to allow system to register port availability
        if (this.connectionMode === 'serial') {
            setTimeout(() => {
                this.updateDeviceDropdown()
            }, 200)
            setTimeout(() => {
                this.updateDeviceDropdown()
            }, 1000)
        }
    }

    _startSerialPolling = () => {
        const hasSerial = 'serial' in navigator
        // console.log(`[WindowManager] _startSerialPolling called. Existing Timer: ${this.serialDevicePollingTimer}, Has Serial: ${hasSerial}`)

        // Always clear to ensure fresh start
        if (this.serialDevicePollingTimer) {
            clearInterval(this.serialDevicePollingTimer)
            this.serialDevicePollingTimer = null
        }

        // Remove existing listeners just in case
        if (hasSerial) {
            navigator.serial.removeEventListener('connect', this._handleSerialEvent)
            navigator.serial.removeEventListener('disconnect', this._handleSerialEvent)

            // Add listeners
            navigator.serial.addEventListener('connect', this._handleSerialEvent)
            navigator.serial.addEventListener('disconnect', this._handleSerialEvent)
            // console.log('[WindowManager] Serial Event Listeners Attached')
        } else {
            // console.warn('[WindowManager] serial API not available in navigator')
        }

        // Poll for changes
        this.serialDevicePollingTimer = setInterval(() => {
            // Only update if mode is serial
            if (this.connectionMode === 'serial' && hasSerial) {
                const isReconnecting = this.device_online_button && this.device_online_button.title === 'Cancel reconnect'
                if (!isReconnecting) {
                    this.updateDeviceDropdown()
                }
            }
        }, 1000)
    }

    _stopSerialPolling = () => {
        // console.log('[WindowManager] Stopping Serial Polling')
        if (this.serialDevicePollingTimer) {
            clearInterval(this.serialDevicePollingTimer)
            this.serialDevicePollingTimer = null
        }
        if ('serial' in navigator) {
            navigator.serial.removeEventListener('connect', this._handleSerialEvent)
            navigator.serial.removeEventListener('disconnect', this._handleSerialEvent)
        }
    }

    #editor
    /** @param {PLCEditor} editor */
    constructor(editor) {
        this.#editor = editor
        const workspace = this.#editor.workspace
        this.workspace = workspace

        this.workspace_body = ElementSynthesisMany(/*HTML*/ `
            <div class="plc-workspace-header">
                <div class="plc-menu-bar">
                    <div class="plc-menu-item" data-menu="file">
                        <span class="plc-menu-label">File</span>
                        <div class="plc-menu-dropdown">
                            <div class="plc-menu-option" data-action="new-project"><span class="plc-icon plc-icon-add" style="margin-right:8px;"></span>New Project</div>
                            <div class="plc-menu-option" data-action="open-project"><span class="plc-icon plc-icon-folder" style="margin-right:8px;"></span>Open Project...</div>
                            <div class="plc-menu-separator"></div>
                            <div class="plc-menu-option" data-action="export-project"><span class="plc-icon plc-icon-download" style="margin-right:8px;"></span>Export Project...</div>
                            <div class="plc-menu-separator"></div>
                            <div class="plc-menu-option" data-action="project-properties"><span class="plc-icon plc-icon-project-properties" style="margin-right:8px;"></span>Project Properties...</div>
                        </div>
                    </div>
                    <div class="plc-menu-item" data-menu="settings">
                        <span class="plc-menu-label">Settings</span>
                        <div class="plc-menu-dropdown">
                            <div class="plc-menu-option" data-action="setup"><span class="plc-icon plc-icon-setup" style="margin-right:8px;"></span>Device Setup</div>
                            <div class="plc-menu-option" data-action="memory"><span class="plc-icon plc-icon-memory" style="margin-right:8px;"></span>Memory Map</div>
                            <div class="plc-menu-separator"></div>
                            <div class="plc-menu-option" data-action="load-plc-config"><span class="plc-icon plc-icon-upload" style="margin-right:8px;"></span>Load PLC Configuration</div>
                        </div>
                    </div>
                    <div class="plc-menu-item" data-menu="help">
                        <span class="plc-menu-label">Help</span>
                        <div class="plc-menu-dropdown">
                            <div class="plc-menu-option" data-action="about"><span class="codicon codicon-info" style="margin-right:8px;"></span>About</div>
                            <div class="plc-menu-option" data-action="version-history"><span class="codicon codicon-history" style="margin-right:8px;"></span>Change History</div>
                            <div class="plc-menu-separator"></div>
                            <div class="plc-menu-option" data-action="disclaimer"><span class="codicon codicon-warning" style="margin-right:8px;"></span>Disclaimer</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="plc-workspace-body">
                <div class="plc-navigation no-select resizable">
                    <div class="plc-navigation-container">
                        <!--h3>Navigation</h3-->
                        
                        <div class="plc-sidebar-panels" style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
                             
                             <div class="plc-sidebar-panel-wrapper" id="wrapper-connection" style="display: flex; flex-direction: column; flex: 0 0 auto;">
                                <div class="plc-connection-header" title="Click to toggle collapse">
                                    <span class="codicon codicon-chevron-down plc-connection-chevron" style="margin-right: 6px;"></span>
                                    <span class="plc-connection-title" style="font-weight: bold; color: #bbb;">CONNECTION</span>
                                </div>
                                <div class="plc-connection-body" style="padding: 4px; display: flex; flex-direction: column;">
                                    <!-- Connection Mode Selector -->
                                    <div class="plc-connection-mode" style="display: flex; gap: 4px; margin-bottom: 4px;">
                                        <select class="plc-mode-select" style="flex: 1; height: 30px; font-size: 11px; background: #3c3c3c; border: 1px solid #3c3c3c; color: #f0f0f0;">
                                            <option value="simulation">Simulation</option>
                                            <option value="serial">Serial/USB</option>
                                        </select>
                                    </div>
                                    
                                    <!-- New Device Button (for serial mode) -->
                                    <button class="plc-new-device-btn" style="display: none; height: 30px; font-size: 11px; background: #0e639c; border: 1px solid #0e639c; color: #fff; cursor: pointer; padding: 0 6px; margin-bottom: 4px;">+ Connect New Device...</button>
                                    
                                    <!-- Device selector and connect button -->
                                    <div class="plc-device-row" style="display: flex; gap: 4px; margin-bottom: 4px; justify-content: flex-end;">
                                        <div class="plc-device-select-container" style="flex: 1;"></div>
                                        <div class="plc-simulation-label" style="flex: 1; display: none; align-items: center; color: #888; font-size: 11px; padding-left: 2px;">WASM PLC Simulator</div>
                                        <div class="plc-device-online green" tabindex="0" title="Connect" style="width: 30px; height: 30px; font-size: 14px; font-weight: bold; display: flex; align-items: center; justify-content: center; border: 1px solid transparent; cursor: pointer; background: #1fba5f;">○</div>
                                    </div>
                                    
                                    <div class="plc-device-info">
                                        <!-- Device info will be displayed here -->
                                    </div>
                                </div>
                             </div>

                             <div class="plc-panel-resizer" style="height: 1px; cursor: ns-resize; background: #2b2b2b; min-height: 1px; z-index: 10;"></div>

                             <div class="plc-sidebar-panel-wrapper" id="wrapper-project" style="display: flex; flex-direction: column; flex: 1; min-height: 22px; overflow: hidden;">
                                <div class="plc-navigation-tree" style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
                                    <!-- Navigation tree will be displayed here -->
                                </div>
                             </div>
                            
                            <div class="plc-panel-resizer" style="height: 1px; cursor: ns-resize; background: #2b2b2b; min-height: 1px; z-index: 10;"></div>

                            <div class="plc-sidebar-panel-wrapper" id="wrapper-health" style="display: flex; flex-direction: column; flex: 0 0 auto; min-height: 22px;">
                                <div class="plc-device-health resizable-panel" id="panel-health">
                                    <div class="plc-device-health-header" title="Click to toggle collapse">
                                        <span class="codicon codicon-chevron-down plc-device-health-chevron" style="margin-right: 6px;"></span>
                                        <span class="plc-icon plc-icon-sidebar-health" style="margin-right: 4px; transform: scale(0.8);"></span>
                                        <span class="plc-device-health-title" style="font-weight: bold; color: #bbb;">DEVICE HEALTH</span>
                                        <div style="flex:1"></div>
                                        <button class="plc-device-health-reset" title="Reset max values" style="background:none; border:none; color: #ccc; cursor: pointer;">Reset</button>
                                    </div>
                                    <div class="plc-device-health-body plc-health-charts">
                                        <div class="plc-health-chart" data-metric="cycle">
                                            <div class="health-label">CYCLE</div>
                                            <div class="health-bar-container">
                                                <div class="health-value-max"></div>
                                                <div class="health-bar-fill"></div>
                                                <div class="health-range-indicator"></div>
                                                <div class="health-value-min"></div>
                                            </div>
                                            <div class="health-value">-</div>
                                        </div>
                                        <div class="plc-health-chart" data-metric="period">
                                            <div class="health-label">PERIOD</div>
                                            <div class="health-bar-container">
                                                <div class="health-value-max"></div>
                                                <div class="health-bar-fill"></div>
                                                <div class="health-range-indicator"></div>
                                                <div class="health-value-min"></div>
                                            </div>
                                            <div class="health-value">-</div>
                                        </div>
                                        <div class="plc-health-chart" data-metric="jitter">
                                            <div class="health-label">JITTER</div>
                                            <div class="health-bar-container">
                                                <div class="health-value-max"></div>
                                                <div class="health-bar-fill"></div>
                                                <div class="health-range-indicator"></div>
                                                <div class="health-value-min"></div>
                                            </div>
                                            <div class="health-value">-</div>
                                        </div>
                                        <div class="plc-health-chart" data-metric="ram">
                                            <div class="health-label">RAM</div>
                                            <div class="health-bar-container">
                                                <div class="health-value-max"></div>
                                                <div class="health-bar-fill"></div>
                                                <div class="health-range-indicator"></div>
                                                <div class="health-value-min"></div>
                                            </div>
                                            <div class="health-value">-</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="plc-panel-resizer" style="height: 1px; cursor: ns-resize; background: #2b2b2b; min-height: 1px; z-index: 10;"></div>

                            <div class="plc-sidebar-panel-wrapper" id="wrapper-watch" style="display: flex; flex-direction: column; flex: 1; min-height: 22px; overflow: hidden;">
                                <div class="plc-watch-container" style="flex: 1; overflow: hidden; display: flex; flex-direction: column;"></div>
                            </div>
                        </div>
                    </div>
                    <div class="plc-navigation-bar" title="Toggle Sidebar">
                        <div class="menu-button">-</div>
                        <span class="thick text-rotate" style="margin: auto auto; margin-top: 5px; font-size: 0.6em;">Navigation</span>
                    </div>
                </div>

                <div class="plc-center-column" style="display: flex; flex-direction: column; flex: 1; overflow: hidden; position: relative;">
                    <div class="plc-window" style="flex: 1; min-height: 0;"> <!-- min-height: 0 is important for flex scrolling -->
                        <div class="plc-window-tabs mini-scrollbar"></div>
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
                                <button class="icon-btn clear-console" title="Clear Console">
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
                    <div class="plc-tools-bar" title="Toggle Sidebar">
                        <div class="menu-button">+</div>
                        <span class="thick text-rotate" style="margin: auto auto; margin-top: 5px; font-size: 0.6em;">Tools</span>
                    </div>
                    <div class="plc-tools-container">
                        <h3>Tools</h3>
                    </div>
                </div>
            </div>
            
            <div class="plc-workspace-footer" style="height: 22px; background: #007acc; color: #fff; display: flex; align-items: center; padding: 0px; margin: 0px; font-size: 12px; justify-content: space-between;">
                <div style="display: flex; gap: 10px; align-items: center; margin-left: 15px;">
                    <div class="footer-item footer-version" id="footer-version"><div class="footer-about no-select" style="cursor: default;">VovkPLC Editor</div></div>
                    <button id="footer-compile" class="footer-btn" style="background: none; border: none; color: white; cursor: pointer; display: flex; align-items: center; gap: 6px; opacity: 1; pointer-events: all; font-size: 11px;">
                        <span style="display: flex; transform: translateY(-1.5px);"><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 0-1 0v6z"/><path d="M3 11.5h2v2h-2zM7 11.5h2v2h-2zM11 11.5h2v2h-2zM5 8.5h2v2h-2zM9 8.5h2v2h-2z"/></svg></span> Compile
                    </button>
                    <button id="footer-download" class="footer-btn" style="background: none; border: none; color: white; cursor: pointer; display: flex; align-items: center; gap: 6px; opacity: 0.5; pointer-events: none; font-size: 11px;">
                        <span style="display: flex; transform: translateY(-1.5px);"><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4a.5.5 0 0 1 .5.5v5.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 10.293V4.5A.5.5 0 0 1 8 4z"/><path d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 0-1 0v6z"/></svg></span> Download
                    </button>
                </div>

                <div style="display: flex; gap: 15px; margin-right: 15px">
                     <span id="footer-device-status"></span>
                </div>
            </div>
        `)

        this.workspace_body.forEach(element => workspace.appendChild(element))

        this.#initOuterLayout(workspace)

        // Footer Events
        const compileBtn = workspace.querySelector('#footer-compile')
        const downloadBtn = workspace.querySelector('#footer-download')
        const footerVersion = workspace.querySelector('#footer-version')

        if (footerVersion) {
            this.footerTooltip = document.createElement('div')
            Object.assign(this.footerTooltip.style, {
                display: 'none',
                position: 'fixed',
                background: '#252526',
                color: '#cccccc',
                border: '1px solid #454545',
                padding: '8px 12px',
                fontSize: '11px',
                zIndex: '10000',
                boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                borderRadius: '3px',
                minWidth: '200px',
                pointerEvents: 'none',
            })
            workspace.appendChild(this.footerTooltip)

            // Remove native tooltip
            footerVersion.removeAttribute('title')

            footerVersion.addEventListener('mouseenter', () => this._updateFooterVersionTooltip(footerVersion, true))
            footerVersion.addEventListener('mouseleave', () => {
                if (this.footerTooltip) this.footerTooltip.style.display = 'none'
            })
            footerVersion.addEventListener('click', () => this._updateFooterVersionTooltip(footerVersion, true))
        }

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
        this._consoleState = this._consoleState || {activeTab: 'output', lastHeight: 150, minimized: true}
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
            const nextHeight = typeof height === 'number' && height > consoleHeaderHeight ? height : consoleState.lastHeight && consoleState.lastHeight > consoleHeaderHeight ? consoleState.lastHeight : 150
            consoleState.lastHeight = nextHeight
            consoleBody.style.height = `${nextHeight}px`
        }
        this.openConsole = openConsole

        const clearHoverHighlight = () => {
            if (this._activeProblemHover?.editor?.setHoverHighlight) {
                this._activeProblemHover.editor.setHoverHighlight(null)
            }
            if (this._activeProblemHover?.editor?.showLintTooltip) {
                this._activeProblemHover.editor.showLintTooltip(null)
            }
            // Clear ladder hover highlight
            if (this._activeProblemHover?.ladder?.props?.clearHoverHighlightCell) {
                this._activeProblemHover.ladder.props.clearHoverHighlightCell()
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
            // Clear ladder selection if it was set from problem panel
            if (this._selectedProblemHighlight?.ladder) {
                const ladder = this._selectedProblemHighlight.ladder
                const editor = this.#editor
                if (editor?.ladder_selection?.ladder_id === ladder.id) {
                    editor.ladder_selection = {
                        ladder_id: null,
                        program_id: null,
                        origin: {x: 0, y: 0},
                        selection: [],
                    }
                    // Re-render the ladder to clear the visual selection
                    if (ladder.props?.ctx) {
                        const renderer = editor.language_manager?.getRenderer?.('ladder')
                        if (renderer?.render) {
                            renderer.render(editor, ladder)
                        }
                    }
                }
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
            clearSelectedHighlight({hideTooltip: true})
        }

        const ensureProblemVisible = entry => {
            if (!entry) return
            const item = entry.element
            if (item && item.scrollIntoView) {
                item.scrollIntoView({block: 'nearest'})
            }
        }

        const applyProblemSelection = (index, opts = {}) => {
            if (!this._problemsFlat.length) return
            const max = this._problemsFlat.length - 1
            const nextIndex = Math.max(0, Math.min(index, max))
            if (this._selectedProblemIndex === nextIndex) {
                if (opts.showTooltip) {
                    this._selectedProblemShowTooltip = true
                    this._problemsFlat[nextIndex].show({showTooltip: true, focus: false, mode: 'selected'})
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
            entry.show({showTooltip: !!opts.showTooltip, focus: true, mode: 'selected'})
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
                openConsole(nextHeight, {force: true})
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
            const list = Array.isArray(input) ? input : input && Array.isArray(input.problems) ? input.problems : []
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
                clearSelectedHighlight({hideTooltip: true})
                return
            }

            if (!list.length) {
                const empty = document.createElement('div')
                empty.className = 'plc-problems-status'
                empty.textContent = 'No problems detected'
                problemsBody.appendChild(empty)
                clearHoverHighlight()
                clearSelectedHighlight({hideTooltip: true})
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
                    groups.set(key, {fileName, dir, blockId, blockName, blockType, key, items: []})
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

                // Sort items: errors first, then warnings
                const sortedItems = [...group.items].sort((a, b) => {
                    if (a.type === 'error' && b.type !== 'error') return -1
                    if (a.type !== 'error' && b.type === 'error') return 1
                    return 0
                })

                sortedItems.forEach(problem => {
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
                    const stack = Array.isArray(problem.languageStack) ? problem.languageStack : problem.language ? [problem.language] : []
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
                        const normalized = typeof opts === 'object' && opts ? opts : {showTooltip: !!opts}
                        const {showTooltip = false, focus = false, mode = 'hover'} = normalized
                        const isSelected = mode === 'selected'

                        if (!isSelected) {
                            clearHoverHighlight()
                        } else {
                            clearSelectedHighlight({hideTooltip: !showTooltip})
                        }

                        const run = async () => {
                            // For ladder blocks, we use token to find cell position
                            const isLadderBlock = problem.blockType === 'ladder'

                            // Text editors need start/end, ladder blocks can use token or line/column
                            if (!problem.blockId) return
                            if (!isLadderBlock && (typeof problem.start !== 'number' || typeof problem.end !== 'number')) return

                            const findTarget = () => {
                                const programs = this.#editor?._getLintPrograms?.() || []
                                for (const program of programs) {
                                    const found = program?.blocks?.find(b => b.id === problem.blockId)
                                    if (found) return {program, block: found}
                                }
                                return {program: null, block: null}
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
                                    blockDiv.scrollIntoView({block: 'center'})
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

                            let {program: targetProgram, block: targetBlock} = findTarget()
                            if (!targetBlock) return

                            if (focus && targetProgram?.id) {
                                this.openProgram(targetProgram.id)
                                await waitForLayout()
                                ;({program: targetProgram, block: targetBlock} = findTarget())
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

                            // Handle ladder blocks differently
                            if (isLadderBlock) {
                                // Resolve cell position from token or fallback to line/column
                                let cellX = (problem.column || 1) - 1
                                let cellY = (problem.line || 1) - 1

                                if (problem.token) {
                                    const nodes = targetBlock.nodes || targetBlock.blocks || []
                                    const node = nodes.find(n => n.id === problem.token)
                                    if (node) {
                                        cellX = node.x
                                        cellY = node.y
                                    }
                                }

                                if (isSelected) {
                                    // Select the cell
                                    if (typeof targetBlock.props?.selectCell === 'function') {
                                        targetBlock.props.selectCell(cellX, cellY)
                                        this._selectedProblemHighlight = {ladder: targetBlock}
                                    }
                                } else {
                                    // Hover highlight the cell
                                    if (typeof targetBlock.props?.setHoverHighlightCell === 'function') {
                                        targetBlock.props.setHoverHighlightCell({x: cellX, y: cellY})
                                        this._activeProblemHover = {ladder: targetBlock}
                                    }
                                }
                                return
                            }

                            const editor = await waitForEditor(targetBlock)
                            if (!editor) return

                            const range = {start: problem.start, end: problem.end}
                            if (focus && typeof editor.revealRange === 'function') {
                                editor.revealRange(range, {
                                    ratio: 0.33,
                                    showTooltip: !!showTooltip,
                                    highlight: !isSelected,
                                    tooltipHighlight: !isSelected,
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
                                    editor.showLintTooltip(range, {highlight: !isSelected})
                                }
                            }

                            if (isSelected && typeof editor.setSelectedHighlight === 'function') {
                                editor.setSelectedHighlight(range)
                                this._selectedProblemHighlight = {editor}
                            } else if (!isSelected && typeof editor.setHoverHighlight === 'function') {
                                this._activeProblemHover = {editor}
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
                        showProblem({showTooltip: true, focus: false, mode: 'hover'})
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
                                    mode: 'selected',
                                })
                                return
                            }
                        }
                    })

                    item.addEventListener('click', () => {
                        applyProblemSelection(this._problemsFlat.indexOf(entry), {showTooltip: true})
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
                if (idx >= 0) applyProblemSelection(idx, {showTooltip: false})
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
                    const dir = key === 'ArrowUp' || (key === 'Tab' && e.shiftKey) ? -1 : 1
                    const nextIndex = this._selectedProblemIndex >= 0 ? this._selectedProblemIndex + dir : dir > 0 ? 0 : this._problemsFlat.length - 1
                    applyProblemSelection(nextIndex, {showTooltip: false, keyboard: true})
                } else if (key === 'Enter') {
                    e.preventDefault()
                    if (this._selectedProblemIndex >= 0) {
                        applyProblemSelection(this._selectedProblemIndex, {showTooltip: true, keyboard: true})
                    }
                } else if (key === 'Escape') {
                    e.preventDefault()
                    clearProblemSelection()
                    clearHoverHighlight()
                }
            })
        }

        consoleHeader.style.touchAction = 'none'
        consoleHeader.addEventListener('pointerdown', e => {
            if (e.button !== 0) return
            if (e.target.closest('button') || e.target.closest('.plc-console-tab') || e.target.closest('.plc-console-actions')) return

            e.preventDefault()
            consoleHeader.setPointerCapture(e.pointerId)
            const startY = e.clientY
            const startHeight = consoleBody.getBoundingClientRect().height

            let isDragging = false

            const centerCol = workspace.querySelector('.plc-center-column')
            const rect = centerCol.getBoundingClientRect()

            const onPointerMove = evt => {
                const diff = startY - evt.clientY
                if (!isDragging && Math.abs(diff) > 5) {
                    isDragging = true
                    document.body.style.cursor = 'ns-resize'
                    consoleHeader.style.cursor = 'ns-resize'
                }

                if (isDragging) {
                    let newHeight = startHeight + diff

                    const minExpandedHeight = 150
                    const triggerThreshold = minExpandedHeight / 2 // 75px

                    // Snap Logic
                    if (newHeight < triggerThreshold) {
                        // Dragging below half min-height -> Visual Minimize
                        consoleBody.classList.add('minimized')
                        consoleState.minimized = true
                        // Force visual height to header height so it looks minimized
                        // But we might want to keep tracking 'newHeight' virtually?
                        // Actually, standard behavior is usually to clamp visual feedback till drop?
                        // User wants: "force it to minimize if we drag ... below 1/2"
                        // And "allow to unminimize it when dragging it back up"

                        // We will act immediately based on threshold
                        consoleBody.style.height = `${consoleHeaderHeight}px`
                    } else {
                        // Above threshold
                        consoleBody.classList.remove('minimized')
                        consoleState.minimized = false

                        // Clamp to min expanded height or max
                        if (newHeight < minExpandedHeight) newHeight = minExpandedHeight

                        const maxHeight = rect.height - 100
                        if (newHeight > maxHeight) newHeight = maxHeight

                        consoleBody.style.height = newHeight + 'px'
                        consoleState.lastHeight = newHeight
                    }
                }
            }

            const onPointerUp = evt => {
                consoleHeader.releasePointerCapture(evt.pointerId)
                consoleHeader.removeEventListener('pointermove', onPointerMove)
                consoleHeader.removeEventListener('pointerup', onPointerUp)
                document.body.style.cursor = ''
                consoleHeader.style.cursor = ''

                if (!isDragging) {
                    // Click Toggle
                    if (consoleBody.classList.contains('minimized')) {
                        openConsole()
                    } else {
                        consoleState.lastHeight = parseFloat(getComputedStyle(consoleBody).height) || 150
                        if (consoleState.lastHeight < 150) consoleState.lastHeight = 150

                        consoleState.minimized = true
                        consoleBody.classList.add('minimized')
                        consoleBody.style.height = `${consoleHeaderHeight}px`
                    }
                } else {
                    // Drag End
                    const h = parseFloat(consoleBody.style.height)
                    if (h <= consoleHeaderHeight + 5) {
                        consoleState.minimized = true
                        consoleBody.classList.add('minimized')
                        consoleBody.style.height = `${consoleHeaderHeight}px`
                    } else {
                        consoleState.minimized = false
                        consoleBody.classList.remove('minimized')
                        consoleState.lastHeight = h
                    }
                }
            }

            consoleHeader.addEventListener('pointermove', onPointerMove)
            consoleHeader.addEventListener('pointerup', onPointerUp)
        })

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

        // Removed old console resizer logic in favor of header drag
        if (consoleResizer) consoleResizer.style.display = 'none'

        const device_info = workspace.querySelector('.plc-device-info')
        if (!device_info) throw new Error('Device info element not found')
        this.device_info = device_info

        const device_health = workspace.querySelector('.plc-device-health')
        if (!device_health) throw new Error('Device health element not found')
        this.device_health = device_health

        const healthHeader = device_health.querySelector('.plc-device-health-header')
        const healthBody = device_health.querySelector('.plc-device-health-body')
        const healthChevron = device_health.querySelector('.plc-device-health-chevron')
        let healthMinimized = false
        /*
        healthHeader.addEventListener('click', (e) => {
             if (e.target.closest('button')) return
             healthMinimized = !healthMinimized
             if (healthMinimized) {
                 healthBody.style.display = 'none'
                 healthChevron.classList.replace('codicon-chevron-down', 'codicon-chevron-right')
             } else {
                 healthBody.style.display = 'flex'
                 healthChevron.classList.replace('codicon-chevron-right', 'codicon-chevron-down')
             }
        })
        */

        this.device_health_charts = {}
        const metrics = ['cycle', 'period', 'jitter', 'ram']

        // Create shared tooltip element
        let tooltip = document.getElementById('plc-health-tooltip')
        if (!tooltip) {
            tooltip = document.createElement('div')
            tooltip.id = 'plc-health-tooltip'
            tooltip.className = 'plc-health-tooltip'
            document.body.appendChild(tooltip)
        }

        for (const m of metrics) {
            const el = device_health.querySelector(`[data-metric="${m}"]`)
            if (el) {
                this.device_health_charts[m] = {
                    container: el,
                    fill: el.querySelector('.health-bar-fill'),
                    range: el.querySelector('.health-range-indicator'),
                    valMin: el.querySelector('.health-value-min'),
                    valMax: el.querySelector('.health-value-max'),
                    value: el.querySelector('.health-value'),
                }

                // Tooltip events
                el.addEventListener('mouseenter', () => {
                    const text = el.getAttribute('data-tooltip')
                    if (text) {
                        tooltip.textContent = text
                        tooltip.style.display = 'block'
                    }
                })
                el.addEventListener('mouseleave', () => {
                    tooltip.style.display = 'none'
                })
                el.addEventListener('mousemove', e => {
                    tooltip.style.left = e.pageX + 10 + 'px'
                    tooltip.style.top = e.pageY + 10 + 'px'
                })
            }
        }

        const device_health_reset = device_health.querySelector('.plc-device-health-reset')
        if (!device_health_reset) throw new Error('Device health reset button not found')
        device_health_reset.addEventListener('click', () => this.#on_device_health_reset_click())
        this.device_health_reset = device_health_reset
        this._renderDeviceHealth(null)
        this._setHealthConnected(false)

        const watchContainer = workspace.querySelector('.plc-watch-container')
        if (!watchContainer) throw new Error('Watch container not found')
        this.watch_panel = new WatchPanel(editor, watchContainer)

        // Restore monitoring state from localStorage
        try {
            const savedMonitoringState = localStorage.getItem('vovk_plc_monitoring_active')
            if (savedMonitoringState !== null) {
                this._monitoringActive = JSON.parse(savedMonitoringState)
                // Propagate the restored state to any existing windows
                setTimeout(() => {
                    for (const win of this.windows.values()) {
                        if (win && typeof win.updateMonitoringState === 'function') {
                            win.updateMonitoringState(this._monitoringActive)
                        }
                    }
                }, 0)
            }
        } catch (e) {
            console.warn('Failed to restore monitoring state', e)
        }

        // Save on change
        this.watch_panel.onListChange = items => {
            if (editor.project) {
                editor.project.watch = items
                if (editor.project_manager?.forceSave) {
                    editor.project_manager.forceSave()
                }
            }
        }

        // Connection mode switching
        this.connectionMode = 'simulation'
        const modeSelect = workspace.querySelector('.plc-mode-select')
        const deviceSelectContainer = workspace.querySelector('.plc-device-select-container')
        const simulationLabel = workspace.querySelector('.plc-simulation-label')
        const newDeviceBtn = workspace.querySelector('.plc-new-device-btn')

        if (!modeSelect || !deviceSelectContainer) throw new Error('Mode or device select not found')

        this.modeSelect = modeSelect
        this.deviceSelectContainer = deviceSelectContainer
        this.simulationLabel = simulationLabel
        this.newDeviceBtn = newDeviceBtn

        // Restore connection mode and device from project
        if (editor.project?.connectionMode) {
            this.connectionMode = editor.project.connectionMode
            modeSelect.value = this.connectionMode
            // Show/hide new device button based on mode
            if (newDeviceBtn) {
                newDeviceBtn.style.display = 'none' // button moved to dropdown
            }
            if (this.deviceSelectContainer) {
                this.deviceSelectContainer.style.display = this.connectionMode === 'serial' ? 'block' : 'none'
            }
            if (this.simulationLabel) {
                this.simulationLabel.style.display = this.connectionMode === 'simulation' ? 'flex' : 'none'
            }
        } else {
            // Default state (simulation)
            if (this.simulationLabel) {
                this.simulationLabel.style.display = 'flex'
            }
        }

        // Initialize CustomDropdown
        this.deviceDropdown = new CustomDropdown({
            container: deviceSelectContainer,
            placeholder: 'Select device...',
            onChange: async (value, label, subtitle) => {
                if (value === '_action_new_device') {
                    // Always disconnect first if connected
                    if (this.#editor.device_manager?.connected) {
                        await this.#editor.device_manager.disconnect(true)
                        this.active_mode = 'edit'
                    }

                    // Set device and connect
                    this.active_device = 'serial'
                    await this.#on_device_online_click()
                    return
                }

                // Store selected value for connect button
                this.selectedDeviceValue = value

                // Track serial preference separately
                if (value !== '_simulation' && value !== '_none' && value !== '_error' && !value.toString().startsWith('_action')) {
                    this._savedSerialDevice = value
                    if (editor.project) {
                        editor.project.selectedSerialDevice = value
                    }
                }

                // Trigger UI update to refresh button state immediately
                this.updateDeviceDropdown()

                // Save to project
                if (editor.project) {
                    editor.project.selectedDevice = value
                    if (editor.project_manager?.forceSave) {
                        editor.project_manager.forceSave()
                    }
                }
            },
        })

        // Restore selected device from project
        if (editor.project?.selectedDevice) {
            this.selectedDeviceValue = editor.project.selectedDevice
        }
        if (editor.project?.selectedSerialDevice) {
            this._savedSerialDevice = editor.project.selectedSerialDevice
        }

        // Serial device polling and events
        // this.serialDevicePollingTimer = null // Moved to initialization to avoid overwrite if startup happens early
        // Methods moved to class fields: _startSerialPolling, _stopSerialPolling, _handleSerialEvent

        modeSelect.addEventListener('change', () => {
            this.connectionMode = modeSelect.value
            // Save to project
            if (editor.project) {
                editor.project.connectionMode = this.connectionMode
                if (editor.project_manager?.forceSave) {
                    editor.project_manager.forceSave()
                }
            }
            this.updateDeviceDropdown()

            // Show/hide new device button based on mode
            if (newDeviceBtn) {
                newDeviceBtn.style.display = 'none' // button moved to dropdown
            }

            // Show/hide device dropdown container based on mode
            if (this.deviceSelectContainer) {
                this.deviceSelectContainer.style.display = modeSelect.value === 'serial' ? 'block' : 'none'
            }
            if (this.simulationLabel) {
                this.simulationLabel.style.display = modeSelect.value === 'simulation' ? 'flex' : 'none'
            }

            // Start/stop polling based on mode
            if (this.connectionMode === 'serial') {
                this._startSerialPolling()
            } else {
                this._stopSerialPolling()
            }
        })

        // Start polling if serial mode is active
        if (this.connectionMode === 'serial') {
            this._startSerialPolling()
        }

        // New device button handler
        if (newDeviceBtn) {
            newDeviceBtn.addEventListener('click', async () => {
                // Always disconnect first if connected
                if (this.#editor.device_manager?.connected) {
                    await this.#editor.device_manager.disconnect(true)
                    this.active_mode = 'edit'
                }

                // Set device and connect
                this.active_device = 'serial'
                await this.#on_device_online_click()
            })
        }

        // Device connect button
        const deviceButton = workspace.querySelector('.plc-device-row .plc-device-online')
        if (deviceButton) {
            deviceButton.addEventListener('click', async () => {
                // Ignore matching click if marked offline/disabled via style logic
                if (deviceButton.hasAttribute('data-offline')) {
                    return
                }

                // Check if in reconnecting state - click acts as cancel
                // We check the title or some flag, but checking innerText or just the DeviceManager state is safer
                // However, DeviceManager state is not directly exposed as public property, but we can check if button is orange/reconnecting
                if (deviceButton.title === 'Cancel reconnect') {
                    if (this.#editor.device_manager?.cancelReconnect) {
                        this.#editor.device_manager.cancelReconnect()
                    }
                    return
                }

                const selectedValue = this.selectedDeviceValue

                if (selectedValue === '_simulation') {
                    this.active_device = 'simulation'
                    await this.#on_device_online_click()
                } else if (selectedValue.startsWith('_port_')) {
                    // Paired device selected via index (legacy or fallback)
                    const portIndex = parseInt(selectedValue.replace('_port_', ''))
                    await this.connectToPairedDevice(portIndex)
                } else if (selectedValue.startsWith('_usb_')) {
                    // Paired device selected via USB Key
                    if (!('serial' in navigator)) return

                    const usbKey = selectedValue.replace('_usb_', '')
                    const [vidStr, pidStr] = usbKey.split(':')
                    const vid = parseInt(vidStr, 16)
                    const pid = parseInt(pidStr, 16)

                    try {
                        const ports = await navigator.serial.getPorts()
                        const targetPortIndex = ports.findIndex(p => {
                            const info = p.getInfo()
                            return info.usbVendorId === vid && info.usbProductId === pid
                        })

                        if (targetPortIndex >= 0) {
                            await this.connectToPairedDevice(targetPortIndex)
                            // Force an immediate update to reflect connection status
                            setTimeout(() => this.updateDeviceDropdown(), 500)
                        } else {
                            // Device is selected but physically offline
                            // We can't connect to it
                            this.logToConsole('Device is offline. Please plug it in.', 'warning')
                        }
                    } catch (e) {
                        this.logToConsole('Error finding device: ' + e.message, 'error')
                    }
                } else if (selectedValue && selectedValue.toString().startsWith('_offline_')) {
                    // Legacy Offline device (should be handled by _usb_ now, but keeping for safety)
                    return
                } else if (selectedValue === '_none' || selectedValue === '_error') {
                    // Do nothing for disabled options
                    return
                }
            })
            this.device_online_button = deviceButton
        }

        const device_select_element = null // Removed old dropdown
        const device_online_button = deviceButton
        this.device_online_button = device_online_button

        // Initial device dropdown population
        this.updateDeviceDropdown()

        // Listen for device info updates to refresh dropdown with device names
        workspace.addEventListener('plc-device-update', e => {
            const detail = e.detail || {}

            // Handle reconnection state (UI Feedback)
            if (this.device_online_button && (detail.reconnecting !== undefined || detail.connected !== undefined)) {
                if (detail.reconnecting) {
                    // Reconnecting state
                    this.device_online_button.innerHTML = '<span class="codicon codicon-loading plc-spin"></span>'
                    this.device_online_button.title = 'Cancel reconnect'
                    this.device_online_button.style.background = '#FFA500' // Orange
                    this.device_online_button.style.color = '#fff'
                    this.device_online_button.removeAttribute('disabled')

                    // Disable dropdown during reconnect
                    if (this.deviceDropdown) {
                        // We can't easily disable the whole custom dropdown, but we can make it ignore clicks or appear disabled
                        // For now let's just update the dropdown options to be disabled
                        // But updateDeviceDropdown might overwrite this.
                        // Best way: modify updateDeviceDropdown to respect reconnecting state
                    }
                } else if (!detail.connected) {
                    // Disconnected state (reset button)
                    if (this.device_online_button.innerHTML.includes('codicon-loading')) {
                        this.device_online_button.innerText = '○'
                        this.device_online_button.title = 'Connect'
                        this.device_online_button.style.background = '#1fba5f'
                        this.device_online_button.style.color = '#fff'
                    }
                }
            }

            // Update dropdown if reconnect state changes
            if (detail.reconnecting !== undefined) {
                this.updateDeviceDropdown()
            }

            // Store device name when info is received
            if (detail.connected && detail.info && this.connectionMode === 'serial') {
                const info = detail.info
                const editor = this.#editor

                if (editor.device_manager?.connection?.serial?.port) {
                    const port = editor.device_manager.connection.serial.port
                    const portInfo = port.getInfo()
                    if (portInfo.usbVendorId && portInfo.usbProductId) {
                        const portKey = `${portInfo.usbVendorId.toString(16).padStart(4, '0')}:${portInfo.usbProductId.toString(16).padStart(4, '0')}`
                        if (!editor.project.serialDeviceNames) {
                            editor.project.serialDeviceNames = {}
                        }
                        const deviceLabel = info.device || 'Unnamed'
                        const arch = info.arch || ''
                        const fullName = arch ? `${deviceLabel} [${arch}]` : deviceLabel

                        // Store as object with timestamps
                        const existing = editor.project.serialDeviceNames[portKey]
                        const now = Date.now()
                        let created = now

                        if (typeof existing === 'string') {
                            // Legacy string format
                            created = now // resetting created as we don't know
                        } else if (existing && existing.created) {
                            created = existing.created
                        }

                        editor.project.serialDeviceNames[portKey] = {
                            name: fullName,
                            created: created,
                            lastConnected: now,
                        }

                        // Save project to persist device names
                        if (editor.project_manager?.forceSave) {
                            editor.project_manager.forceSave()
                        }
                    }
                }

                // Device info received, update dropdown to show device name
                setTimeout(() => this.updateDeviceDropdown(), 100)
            }
        })

        // Listen for connection status changes
        const updateConnectionStatus = () => {
            const connected = this.#editor.device_manager && this.#editor.device_manager.connected
            const status = workspace.querySelector('#footer-device-status')
            if (status) {
                status.innerText = connected ? 'Connected' : ''
                status.style.display = connected ? 'flex' : 'none'
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

            // Disable mode selector, new device button, and device dropdown when connected
            if (this.modeSelect) {
                if (connected) {
                    this.modeSelect.setAttribute('disabled', 'disabled')
                } else {
                    this.modeSelect.removeAttribute('disabled')
                }
            }
            if (this.newDeviceBtn) {
                if (connected) {
                    this.newDeviceBtn.setAttribute('disabled', 'disabled')
                    this.newDeviceBtn.style.opacity = '0.5'
                    this.newDeviceBtn.style.cursor = 'not-allowed'
                } else {
                    this.newDeviceBtn.removeAttribute('disabled')
                    this.newDeviceBtn.style.opacity = '1'
                    this.newDeviceBtn.style.cursor = 'pointer'
                }
            }
            if (this.deviceDropdown) {
                if (connected) {
                    this.deviceDropdown.disable()
                } else {
                    this.deviceDropdown.enable()
                }
            }

            // Update Setup Window if active/exists
            const setupWin = this.windows.get('setup')
            // @ts-ignore
            if (setupWin && typeof setupWin.updateConnectionStatus === 'function') {
                // @ts-ignore
                setupWin.updateConnectionStatus(connected)
            }

            if (this._monitoringConnectionState !== connected) {
                this._monitoringConnectionState = connected
                // Don't enforce monitor state off - keep user's preference
                // Monitoring is always available - can be toggled in any state
                this.updateMonitoringAvailability(true)
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

            // Auto-transition to offline mode when connection is lost
            if (!connected && this.active_mode === 'online') {
                this.active_mode = 'edit'
                if (device_online_button) {
                    // @ts-ignore
                    device_online_button.innerText = '○'
                    device_online_button.title = 'Connect'
                    device_online_button.style.background = '#1fba5f'
                    device_online_button.style.color = '#fff'
                }
                if (device_select_element) {
                    device_select_element.removeAttribute('disabled')
                }
                if (device_info) {
                    // Show stored device info if available
                    const storedDevice = this.#editor.project?.lastPhysicalDevice
                    if (storedDevice?.deviceInfo) {
                        const info = storedDevice.deviceInfo
                        device_info.innerHTML = `
                            <div style="display: flex; align-items: flex-start; gap: 8px;">
                                <div style="flex: 1; min-width: 0;">
                                    <div class="device-name" style="color: #888;">${info.device || 'Unknown Device'} <span style="font-size: 9px; color: #666;">(stored)</span></div>
                                    <div class="device-meta" style="color: #666;">${info.arch} ${info.version ? 'v' + info.version : ''}</div>
                                </div>
                                <button class="plc-device-details-btn" title="View stored device details" style="background: #2a2a2a; border: 1px solid #444; color: #888; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                            </div>
                        `
                        const detailsBtn = device_info.querySelector('.plc-device-details-btn')
                        if (detailsBtn) {
                            detailsBtn.addEventListener('click', () => this._showDeviceDetails())
                        }
                    } else {
                        device_info.innerHTML = `
                            <div style="display: flex; align-items: flex-start; gap: 8px;">
                                <div style="flex: 1; min-width: 0;">
                                    <div class="device-name" style="color: #888;">No device connected</div>
                                    <div class="device-meta" style="color: #666;">Use the button below to connect</div>
                                </div>
                                <button class="plc-device-details-btn" title="Device Details" style="background: #2a2a2a; border: 1px solid #444; color: #666; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                            </div>
                        `
                        const detailsBtn = device_info.querySelector('.plc-device-details-btn')
                        if (detailsBtn) {
                            detailsBtn.addEventListener('click', () => this._showDeviceDetails())
                        }
                    }
                }
            }

            // Auto-transition to online mode when connection is restored (auto-reconnect)
            if (connected && this.active_mode === 'edit') {
                this.active_mode = 'online'
                if (device_online_button) {
                    // @ts-ignore
                    device_online_button.innerText = '✕'
                    device_online_button.title = 'Disconnect'
                    device_online_button.style.background = '#dc3545'
                    device_online_button.style.color = '#fff'
                }
                if (device_select_element) {
                    device_select_element.setAttribute('disabled', 'disabled')
                }
                if (device_info && this.#editor.device_manager?.deviceInfo) {
                    const info = this.#editor.device_manager.deviceInfo
                    device_info.innerHTML = `
                        <div style="display: flex; align-items: flex-start; gap: 8px;">
                            <div style="flex: 1; min-width: 0;">
                                <div class="device-name">${info.device || 'Unknown Device'}</div>
                                <div class="device-meta">${info.arch} ${info.version ? 'v' + info.version : ''}</div>
                            </div>
                            <button class="plc-device-details-btn" title="Device Details" style="background: #333; border: 1px solid #444; color: #ccc; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                        </div>
                    `
                    const detailsBtn = device_info.querySelector('.plc-device-details-btn')
                    if (detailsBtn) {
                        detailsBtn.addEventListener('click', () => this._showDeviceDetails())
                    }
                }
            }

            this.updateLiveMonitorState()

            // Update paired devices list when connection status changes
            if (this.connectionMode === 'serial') {
                this.updateDeviceDropdown()
            }
        }

        // Listen to device connection events
        workspace.addEventListener('plc-device-update', updateConnectionStatus)

        // Initial status update
        updateConnectionStatus()

        const navigation = this.workspace.querySelector('.plc-navigation')
        if (!navigation) throw new Error('Navigation not found')
        this.div_navigation = navigation

        const window_frame = this.workspace.querySelector('.plc-window-frame')
        if (!window_frame) throw new Error('Window frame not found')
        this.window_frame = window_frame

        // this.#initPanelResizables(workspace)

        const tools = this.workspace.querySelector('.plc-tools')
        if (!tools) throw new Error('Tools not found')
        this.div_tools = tools

        this.tree_manager = new NavigationTreeManager(editor)
        this.tab_manager = new TabManager(editor)

        this.data_fetcher = new DataFetcher(editor)
        editor.data_fetcher = this.data_fetcher

        // Horizontal scrolling for tabs
        const tabs_element = workspace.querySelector('.plc-window-tabs')
        if (tabs_element) {
            tabs_element.addEventListener(
                'wheel',
                evt => {
                    if (evt.deltaY !== 0) {
                        evt.preventDefault()
                        tabs_element.scrollLeft += evt.deltaY
                    }
                },
                {passive: false},
            )
        }

        // Clear problem selection when clicking anywhere in the program window area
        window_frame.addEventListener(
            'mousedown',
            evt => {
                // Clear problem panel selection to focus on user interaction
                if (typeof this.clearProblemSelection === 'function') {
                    this.clearProblemSelection()
                }
            },
            {capture: true},
        )

        this.#initPanelResizables(workspace)
        this.#initContextMenus(workspace)
        // Initialize initial state
        this.updateDeviceDropdown()
    }

    #initContextMenus(workspace) {
        if (!this.#editor.context_manager) return

        // Connection Panel
        const connectionHeader = workspace.querySelector('.plc-connection-header')
        if (connectionHeader) {
            this.#editor.context_manager.addListener({
                target: connectionHeader,
                onOpen: () => [
                    {type: 'item', label: this.active_device === 'simulation' ? 'Switch to Device' : 'Switch to Simulation', name: 'toggle_device'},
                    {type: 'item', label: this.active_mode === 'online' ? 'Disconnect' : 'Connect', name: 'toggle_online'},
                ],
                onClose: key => {
                    if (key === 'toggle_device') {
                        const next = this.active_device === 'simulation' ? 'device' : 'simulation'
                        this.setActiveDevice(next)
                    }
                    if (key === 'toggle_online') this.#on_device_online_click()
                },
            })
        }

        // Project Panel
        const projectHeader = workspace.querySelector('.plc-navigation-panel-header')
        if (projectHeader) {
            this.#editor.context_manager.addListener({
                target: projectHeader,
                onOpen: () => [
                    // { type: 'item', label: 'Refresh', name: 'refresh' },
                    {type: 'item', label: 'Collapse All', name: 'collapse_all'},
                ],
                onClose: key => {
                    // if (key === 'refresh') this.tree_manager?.refresh?.()
                    if (key === 'collapse_all') this.tree_manager?.collapseItems?.()
                },
            })
        }

        // Health Panel
        const healthHeader = workspace.querySelector('.plc-device-health-header')
        if (healthHeader) {
            this.#editor.context_manager.addListener({
                target: healthHeader,
                onOpen: () => [{type: 'item', label: 'Reset Max Values', name: 'reset'}],
                onClose: key => {
                    if (key === 'reset') this.#on_device_health_reset_click()
                },
            })
        }

        // Watch Panel Header
        const watchHeader = workspace.querySelector('.plc-device-watch-header')
        if (watchHeader) {
            this.#editor.context_manager.addListener({
                target: watchHeader,
                onOpen: () => [{type: 'item', label: 'Clear Watch Table', name: 'clear'}],
                onClose: key => {
                    if (key === 'clear') {
                        this.watch_panel?.setEntries?.([])
                    }
                },
            })
        }
    }

    #initPanelResizables(workspace) {
        const wrappers = [{el: workspace.querySelector('#wrapper-connection')}, {el: workspace.querySelector('#wrapper-project')}, {el: workspace.querySelector('#wrapper-health')}, {el: workspace.querySelector('#wrapper-watch')}]
        const resizers = Array.from(workspace.querySelectorAll('.plc-panel-resizer'))
        if (wrappers.some(w => !w.el)) return

        // State tracking: stored as normalized flex ratios (pixels)
        // Default: roughly equal or standard distribution
        let state = [
            {minimized: false, flex: 100},
            {minimized: false, flex: 200},
            {minimized: false, flex: 200},
            {minimized: false, flex: 200},
        ]

        // Load Persistence
        try {
            const saved = localStorage.getItem('vovk_plc_layout')
            if (saved) {
                const parsed = JSON.parse(saved)
                // If saved state length differs (old version), ignore it or migrate ideally.
                // Resetting if length doesn't match to avoid errors.
                if (Array.isArray(parsed) && parsed.length === wrappers.length) {
                    state = parsed
                }
            }
        } catch (e) {
            console.warn('Failed to load layout', e)
        }

        const applyLayout = () => {
            wrappers.forEach((w, i) => {
                const s = state[i]
                const header = w.el.querySelector('.plc-connection-header, .plc-navigation-panel-header, .plc-device-health-header, .plc-device-watch-header')
                const chevron = header ? header.querySelector('.codicon') : null
                const content = w.el.querySelector('.plc-connection-body, .plc-navigation-panel-content, .plc-device-health-body, .plc-device-watch-content')
                const isConnectionPanel = w.el.id === 'wrapper-connection'

                if (s.minimized) {
                    // Minimized: fixed height
                    w.el.style.flex = '0 0 22px'
                    w.el.style.minHeight = '22px'
                    w.el.style.overflow = 'hidden'
                    w.el.classList.add('minimized')

                    if (content) content.style.display = 'none'
                    if (chevron) chevron.classList.replace('codicon-chevron-down', 'codicon-chevron-right')
                } else {
                    // Expanded: flex grow proportional to last size
                    const flexVal = Math.max(s.flex, 50) // Ensure at least some weight
                    w.el.style.flex = `${flexVal} 1 0px`
                    w.el.style.minHeight = isConnectionPanel ? '150px' : '22px'
                    w.el.style.overflow = 'hidden' // Keep content contained
                    w.el.classList.remove('minimized')

                    if (content) content.style.display = ''
                    if (chevron) chevron.classList.replace('codicon-chevron-right', 'codicon-chevron-down')
                }
            })
            // Save state
            localStorage.setItem('vovk_plc_layout', JSON.stringify(state))
        }

        const togglePanel = index => {
            state[index].minimized = !state[index].minimized
            applyLayout()
        }

        // Initialize headers
        wrappers.forEach((w, i) => {
            const header = w.el.querySelector('.plc-connection-header, .plc-navigation-panel-header, .plc-device-health-header, .plc-device-watch-header')
            if (header) {
                header.onclick = e => {
                    if (e.target.closest('button, input, select')) return
                    togglePanel(i)
                }
                header.style.cursor = 'pointer'
            }
        })

        let isResizing = false
        let currentResizerIndex = -1

        const handleMouseDown = (e, index) => {
            isResizing = true
            currentResizerIndex = index
            document.body.style.cursor = 'ns-resize'
            e.preventDefault()
        }

        const handleMouseMove = e => {
            if (!isResizing) return
            e.preventDefault()

            // wrappers[index] vs wrappers[index+1]
            const topIndex = currentResizerIndex
            const bottomIndex = currentResizerIndex + 1
            const topWrapper = wrappers[topIndex].el
            const bottomWrapper = wrappers[bottomIndex].el

            const topRect = topWrapper.getBoundingClientRect()
            const bottomRect = bottomWrapper.getBoundingClientRect()

            const totalHeight = topRect.height + bottomRect.height
            const topTop = topRect.top

            let newTopHeight = e.clientY - topTop

            // Constraints
            if (newTopHeight < 22) newTopHeight = 22
            if (newTopHeight > totalHeight - 22) newTopHeight = totalHeight - 22

            const newBottomHeight = totalHeight - newTopHeight

            // Update State: Use pixel height as the new flex-grow weight
            state[topIndex].flex = newTopHeight
            state[bottomIndex].flex = newBottomHeight

            // Auto-expand/minimize based on drag
            if (newTopHeight > 28 && state[topIndex].minimized) {
                state[topIndex].minimized = false
            }
            if (newTopHeight <= 24 && !state[topIndex].minimized) {
                state[topIndex].minimized = true
            }

            if (newBottomHeight > 28 && state[bottomIndex].minimized) {
                state[bottomIndex].minimized = false
            }
            if (newBottomHeight <= 24 && !state[bottomIndex].minimized) {
                state[bottomIndex].minimized = true
            }

            applyLayout()
        }

        const handleMouseUp = () => {
            if (isResizing) {
                isResizing = false
                currentResizerIndex = -1
                document.body.style.cursor = ''
            }
        }

        resizers.forEach((resizer, i) => {
            resizer.addEventListener('mousedown', e => handleMouseDown(e, i))
        })

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        // Initial Draw
        applyLayout()
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

    // ========== Loading Bar Methods ==========
    
    /**
     * Creates the loading bar overlay if it doesn't exist
     * @private
     */
    _ensureLoadingBar() {
        if (this._loadingBar) return
        
        const overlay = document.createElement('div')
        overlay.className = 'plc-loading-overlay'
        overlay.innerHTML = /*HTML*/ `
            <div class="plc-loading-container">
                <div class="plc-loading-text">Loading...</div>
                <div class="plc-loading-bar-container">
                    <div class="plc-loading-bar-progress"></div>
                </div>
            </div>
        `
        
        this._loadingBar = overlay
        this._loadingBarText = overlay.querySelector('.plc-loading-text')
        this._loadingBarProgress = overlay.querySelector('.plc-loading-bar-progress')
        
        document.body.appendChild(overlay)
    }
    
    /**
     * Shows the loading bar with a message
     * @param {string} text - The loading message to display
     * @param {number} [progress] - Optional progress percentage (0-100). If omitted, shows indeterminate animation.
     * @param {number} [timeout] - Optional timeout in ms after which loading bar auto-hides (default: 30000)
     */
    showLoading(text = 'Loading...', progress = null, timeout = 30000) {
        this._ensureLoadingBar()
        this._loadingCount++
        
        // Clear any existing timeout
        if (this._loadingTimeout) {
            clearTimeout(this._loadingTimeout)
            this._loadingTimeout = null
        }
        
        if (this._loadingBarText) {
            this._loadingBarText.textContent = text
        }
        
        if (this._loadingBarProgress) {
            if (progress !== null && progress >= 0 && progress <= 100) {
                this._loadingBarProgress.classList.add('determinate')
                this._loadingBarProgress.style.width = `${progress}%`
            } else {
                this._loadingBarProgress.classList.remove('determinate')
                this._loadingBarProgress.style.width = '30%'
            }
        }
        
        this._loadingBar.classList.add('visible')
        
        // Safety timeout to prevent stuck loading bar
        if (timeout > 0) {
            this._loadingTimeout = setTimeout(() => {
                console.warn('Loading bar auto-hidden after timeout')
                this.forceHideLoading()
            }, timeout)
        }
    }
    
    /**
     * Updates the loading bar text and/or progress
     * @param {string} [text] - New text to display
     * @param {number} [progress] - New progress percentage (0-100)
     */
    updateLoading(text = null, progress = null) {
        if (!this._loadingBar) return
        
        if (text !== null && this._loadingBarText) {
            this._loadingBarText.textContent = text
        }
        
        if (progress !== null && this._loadingBarProgress) {
            if (progress >= 0 && progress <= 100) {
                this._loadingBarProgress.classList.add('determinate')
                this._loadingBarProgress.style.width = `${progress}%`
            }
        }
    }
    
    /**
     * Hides the loading bar
     */
    hideLoading() {
        this._loadingCount = Math.max(0, this._loadingCount - 1)
        
        if (this._loadingCount === 0) {
            if (this._loadingTimeout) {
                clearTimeout(this._loadingTimeout)
                this._loadingTimeout = null
            }
            if (this._loadingBar) {
                this._loadingBar.classList.remove('visible')
            }
        }
    }
    
    /**
     * Force hides the loading bar regardless of count
     */
    forceHideLoading() {
        this._loadingCount = 0
        if (this._loadingTimeout) {
            clearTimeout(this._loadingTimeout)
            this._loadingTimeout = null
        }
        if (this._loadingBar) {
            this._loadingBar.classList.remove('visible')
        }
    }

    // ========== End Loading Bar Methods ==========

    _formatHealthNumber(value) {
        if (!Number.isFinite(value)) return null
        return String(Math.trunc(Number(value)))
    }

    _renderDeviceHealth(health) {
        if (!this.device_health_charts) return

        const updateChart = (metric, last, min, max, unit, isRam = false) => {
            const chart = this.device_health_charts[metric]
            if (!chart) return

            if (!health || last === undefined) {
                chart.value.textContent = '-'
                chart.valMin.textContent = ''
                chart.valMax.textContent = ''
                chart.fill.style.height = '0%'
                chart.range.style.bottom = '0%'
                chart.range.style.height = '0%'
                chart.container.removeAttribute('data-tooltip')
                chart.container.removeAttribute('title')
                return
            }

            const fmt = v => {
                if (isRam) {
                    if (v >= 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + 'MB'
                    else if (v >= 1024) return (v / 1024).toFixed(1) + 'kB'
                    else return Math.trunc(v) + 'B'
                } else {
                    return Math.trunc(v) + unit
                }
            }

            let displayLast = last
            let displayMin = min
            let displayMax = max
            let scale = 1
            let tooltip = ''

            if (isRam) {
                const totalRam = health.total_ram_size || 0

                if (totalRam > 0) {
                    // Standard RAM Usage Bar Logic
                    scale = totalRam

                    // Calculate Used values
                    // Free is what comes in as last, min, max
                    // Used = Total - Free

                    const usedLast = totalRam - last
                    const usedMax = totalRam - min // Min free = Max used
                    const usedMin = totalRam - max // Max free = Min used

                    displayLast = usedLast
                    displayMin = usedMin
                    displayMax = usedMax

                    // Show total capacity on top
                    chart.valMin.textContent = ''
                    chart.valMax.textContent = fmt(totalRam)

                    // Show usage in % on bottom
                    const percent = Math.round((usedLast / totalRam) * 100)
                    chart.value.textContent = percent + '%'

                    // Comprehensive Tooltip
                    tooltip = `RAM USAGE\nUsed: ${fmt(usedLast)} / ${fmt(totalRam)} (${percent}%)\nFree: ${fmt(last)}\n\nHistory:\nMax Used: ${fmt(usedMax)}\nMin Used: ${fmt(usedMin)}`
                } else {
                    // Fallback if total_ram_size is missing (older firmware logic)
                    const bestCase = max // Max Free
                    scale = bestCase || 1
                    displayLast = bestCase - last
                    displayMin = bestCase - max // 0
                    displayMax = bestCase - min // Worst case used

                    chart.valMin.textContent = 'Min:' + fmt(displayMin)
                    chart.valMax.textContent = 'Max:' + fmt(displayMax)
                    chart.value.textContent = fmt(displayLast)

                    tooltip = `RAM (Relative)\nUsed Est: ${fmt(displayLast)}\nMin Used: ${fmt(displayMin)}\nMax Used: ${fmt(displayMax)}`
                }
            } else {
                // Non-RAM metrics: Scale is 0 to max
                // Bottom label shows min, top shows max
                // The red range indicator shows the min-max variance range
                chart.valMin.textContent = fmt(min)
                chart.valMax.textContent = fmt(max)
                chart.value.textContent = fmt(last)

                scale = max || 0
                if (scale === 0) scale = 100

                tooltip = `${metric.toUpperCase()}\nLast: ${fmt(last)}\nMin: ${fmt(min)}\nMax: ${fmt(max)}`
            }

            chart.container.setAttribute('data-tooltip', tooltip)
            chart.container.removeAttribute('title')

            // Remove title from children if present to prevent double tooltip
            if (chart.fill && chart.fill.parentElement) {
                chart.fill.parentElement.removeAttribute('title')
            }

            const pLast = Math.min(100, Math.max(0, (displayLast / scale) * 100))
            const pMin = Math.min(100, Math.max(0, (displayMin / scale) * 100))
            const pMax = Math.min(100, Math.max(0, (displayMax / scale) * 100))

            if (isRam) {
                // RAM: bar fills from 0 to used amount
                chart.fill.style.bottom = '0%'
                chart.fill.style.height = `${pLast}%`
            } else {
                // Timing metrics: bar fills from min to last (shows value above minimum)
                chart.fill.style.bottom = `${pMin}%`
                chart.fill.style.height = `${Math.max(1, pLast - pMin)}%`
            }
            chart.range.style.bottom = `${pMin}%`
            chart.range.style.height = `${Math.max(0, pMax - pMin)}%`

            // Color warning for RAM if usage is high (>90%)
            if (isRam && pLast > 90) {
                chart.fill.style.background = '#d63030' // Red warning
            } else if (isRam) {
                chart.fill.style.background = '' // Default
            }
        }

        if (!health) {
            updateChart('cycle')
            updateChart('period')
            updateChart('jitter')
            updateChart('ram')
            return
        }

        updateChart('cycle', health.last_cycle_time_us, health.min_cycle_time_us, health.max_cycle_time_us, 'us')
        updateChart('period', health.last_period_us, health.min_period_us, health.max_period_us, 'us')
        updateChart('jitter', health.last_jitter_us, health.min_jitter_us, health.max_jitter_us, 'us')
        updateChart('ram', health.ram_free, health.min_ram_free, health.max_ram_free, '', true)

        if (this._last_known_health_dimmed) {
            Object.values(this.device_health_charts).forEach(c => (c.container.style.opacity = '0.5'))
        } else {
            Object.values(this.device_health_charts).forEach(c => (c.container.style.opacity = '1'))
        }
    }

    setHealthDimmed(dimmed) {
        this._last_known_health_dimmed = dimmed
        if (this.device_health_charts) {
            Object.values(this.device_health_charts).forEach(c => (c.container.style.opacity = dimmed ? '0.5' : '1'))
        }
    }

    updateWatchValues() {
        this.watch_panel?.updateValues()
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
        if (!this._monitoringConnectionState) return // Requires connection
        if (!this._monitoringActive) return // Requires monitoring active (don't update if paused)
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

    focusDataBlockField(dbId, fieldName) {
        if (typeof dbId !== 'number' || !fieldName) return false
        const windowId = `db:${dbId}`
        this.openProgram(windowId)
        const dbUI = this.windows.get(windowId)
        if (dbUI && typeof dbUI.focusField === 'function') {
            // Small delay to let the window render
            setTimeout(() => dbUI.focusField(fieldName), 50)
            return true
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

    async handleCompile(options = {}) {
        const silent = !!options.silent
        const silentOnSuccess = !!options.silentOnSuccess
        const suppressInfo = silent || silentOnSuccess
        const showLoadingBar = !silent && !options.noLoadingBar

        if (!this.#editor.runtime_ready) {
            if (!silent) {
                if (silentOnSuccess && typeof this.setConsoleTab === 'function') this.setConsoleTab('output')
                this.logToConsole('WASM Runtime is not ready yet.', 'error')
                this.logToConsole('----------------------------------------', 'info')
            }
            return false
        }

        if (showLoadingBar) this.showLoading('Compiling project...')

        try {
            if (!suppressInfo) {
                if (typeof this.setConsoleTab === 'function') {
                    this.setConsoleTab('output')
                }
                this.logToConsole('Compiling project...', 'info')
            }
            const startTime = performance.now()
            const result = await this.#editor.project_manager.compile()
            const endTime = performance.now()

            // Check for compilation errors
            if (result.problem) {
                if (showLoadingBar) this.hideLoading()
                if (!silent) {
                    if (silentOnSuccess && typeof this.setConsoleTab === 'function') this.setConsoleTab('output')
                    const p = result.problem
                    this.logToConsole(`Compilation failed: ${p.message}`, 'error')

                    // Show location info if available
                    const locationParts = []
                    if (p.program) locationParts.push(`Program: ${p.program}`)
                    if (p.block) locationParts.push(`Block: ${p.block}`)
                    if (p.line) locationParts.push(`Line ${p.line}${p.column ? `:${p.column}` : ''}`)
                    if (p.compiler && p.compiler !== 'UNKNOWN') locationParts.push(`(${p.compiler})`)

                    if (locationParts.length > 0) {
                        this.logToConsole(`  ${locationParts.join(' | ')}`, 'error')
                    }
                    if (p.token) {
                        this.logToConsole(`  Token: "${p.token}"`, 'error')
                    }
                    this.logToConsole('----------------------------------------', 'info')
                }
                return false
            }

            // Store result for download
            this.#editor.project.binary = (str => {
                const matches = str.match(/.{1,2}/g) || []
                return matches.map(hex => parseInt(hex, 16))
            })(result.output)

            this.#editor.project.compiledBytecode = result.output
            this.#editor.project.compiledSize = result.size

            if (!suppressInfo) {
                // Determine capacity: Device Info -> Project Info -> 32KB default
                let capacity = 128
                if (this.#editor.device_manager?.deviceInfo?.program) {
                    capacity = Number(this.#editor.device_manager.deviceInfo.program) || capacity
                } else if (this.#editor.project?.info?.capacity) {
                    capacity = Number(this.#editor.project.info.capacity) || capacity
                }

                const MAX_PROGRAM_SIZE = capacity
                const percent = +((result.size / MAX_PROGRAM_SIZE) * 100).toFixed(1)
                const total_bars = 16
                const filled_bars = Math.round((Math.min(100, percent) / 100) * total_bars)
                const empty_bars = total_bars - filled_bars
                const bar = '[' + '='.repeat(filled_bars) + ' '.repeat(empty_bars) + ']'

                // Calculate Checksum
                let checksumMsg = ''
                let hexPreview = ''
                if (result.output && this.#editor.runtime && this.#editor.runtime.parseHex && this.#editor.runtime.crc8) {
                    try {
                        const bytes = this.#editor.runtime.parseHex(result.output)
                        const checksum = this.#editor.runtime.crc8(bytes)

                        if (this.lastCompiledChecksum === checksum) {
                            checksumMsg = ' No changes.'
                        }
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
                this.logToConsole(`Used ${result.size} / ${MAX_PROGRAM_SIZE} bytes.`, 'info')
                this.logToConsole(`${bar} ${percent}%`, 'info')
                if (hexPreview) {
                    this.logToConsole(hexPreview, 'info')
                }
                this.logToConsole('----------------------------------------', 'info')
            }

            // Store compiled datablock declarations for live monitoring
            if (result.datablockDecls && result.datablockDecls.length > 0) {
                this.#editor.project.compiledDatablocks = result.datablockDecls
                // Notify all DataBlock windows with compiled offset info
                this.notifyCompiledDatablocks(result.datablockDecls)
                if (!suppressInfo) {
                    this.logToConsole(`  ${result.datablockDecls.length} data block(s) compiled`, 'info')
                }
            } else {
                this.#editor.project.compiledDatablocks = []
            }

            // Auto-scan for patchable constants after successful compilation (always run, even in silent mode)
            if (this.#editor.program_patcher) {
                try {
                    const patchables = await this.#editor.program_patcher.scanPatchableConstants()
                    if (patchables.length > 0 && !suppressInfo) {
                        console.log(`Found ${patchables.length} patchable constant(s)`)
                    }
                } catch (e) {
                    console.warn('Failed to scan patchable constants:', e)
                }
            }

            if (showLoadingBar) this.hideLoading()
            return true
        } catch (e) {
            if (showLoadingBar) this.hideLoading()
            if (!silent) {
                if (silentOnSuccess && typeof this.setConsoleTab === 'function') this.setConsoleTab('output')
                this.logToConsole(`Compilation failed: ${e.message}`, 'error')
                this.logToConsole('----------------------------------------', 'info')
            }
            return false
        }
    }

    async handleDownload() {
        const connected = this.#editor.device_manager && this.#editor.device_manager.connected
        if (!connected) {
            this.logToConsole('Connect to a device to download.', 'warning')
            this.logToConsole('----------------------------------------', 'info')
            return
        }

        // Always compile before download, showing console only on error
        const compiled = await this.handleCompile({silentOnSuccess: true})
        if (!compiled) return

        const compiledBytecode = this.#editor.project.compiledBytecode
        const compiledSize = this.#editor.project.compiledSize

        // Determine capacity: Device Info -> Project Info -> 32KB default
        let capacity = 128
        if (this.#editor.device_manager.deviceInfo?.program) {
            capacity = Number(this.#editor.device_manager.deviceInfo.program) || capacity
        } else if (this.#editor.project?.info?.capacity) {
            capacity = Number(this.#editor.project.info.capacity) || capacity
        }

        const MAX_PROGRAM_SIZE = capacity
        if (compiledSize > MAX_PROGRAM_SIZE) {
            this.logToConsole(`Program too large! ${compiledSize} > ${MAX_PROGRAM_SIZE} bytes.`, 'error')
            this.logToConsole('Upload aborted.', 'error')
            this.logToConsole('----------------------------------------', 'info')
            this.setConsoleTab('output')
            return
        }

        const deviceInfo = this.#editor.device_manager.deviceInfo
        const projectInfo = this.#editor.project.info

        if (deviceInfo && typeof deviceInfo === 'object' && projectInfo) {
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

            // Check device flags against project requirements
            const flagWarnings = []
            if (typeof deviceInfo.flags === 'number' && typeof VovkPLC !== 'undefined' && VovkPLC.decodeRuntimeFlags) {
                const devDecoded = VovkPLC.decodeRuntimeFlags(deviceInfo.flags)
                const offsets = this.#editor.project?.offsets
                const projFlags = projectInfo.flags

                // If project has stored flags, do a precise per-bit comparison
                if (typeof projFlags === 'number') {
                    const projDecoded = VovkPLC.decodeRuntimeFlags(projFlags)
                    const flagDefs = [
                        ['strings', 'Strings', 'STRINGS'],
                        ['counters', 'Counters', 'COUNTERS'],
                        ['timers', 'Timers', 'TIMERS'],
                        ['ffi', 'FFI', 'FFI'],
                        ['x64Ops', '64-bit Ops', 'X64_OPS'],
                        ['safeMode', 'Safe Mode', 'SAFE_MODE'],
                        ['transport', 'Transport', 'TRANSPORT'],
                        ['floatOps', 'Float Ops', 'FLOAT_OPS'],
                        ['advancedMath', 'Advanced Math', 'ADVANCED_MATH'],
                        ['ops32bit', '32-bit Ops', 'OPS_32BIT'],
                        ['cvt', 'Type Conversion', 'CVT'],
                        ['stackOps', 'Stack Ops', 'STACK_OPS'],
                        ['bitwiseOps', 'Bitwise Ops', 'BITWISE_OPS'],
                    ]
                    for (const [key, label, constName] of flagDefs) {
                        if (projDecoded[key] && !devDecoded[key]) {
                            flagWarnings.push(`<span style="color: #f48771;">&#x26A0; ${label}</span> — Project expects <b>${constName}</b> but device has it disabled`)
                        }
                    }
                } else {
                    // No project flags — infer from offsets and warn about missing features
                    const usesTimers = offsets?.timer?.size > 0
                    const usesCounters = offsets?.counter?.size > 0

                    if (usesTimers && !devDecoded.timers) {
                        flagWarnings.push(`<span style="color: #f48771;">&#x26A0; Timers</span> — Project uses timers but device has <b>TIMERS</b> disabled`)
                    }
                    if (usesCounters && !devDecoded.counters) {
                        flagWarnings.push(`<span style="color: #f48771;">&#x26A0; Counters</span> — Project uses counters but device has <b>COUNTERS</b> disabled`)
                    }
                    if (!devDecoded.floatOps) {
                        flagWarnings.push(`<span style="color: #fce9a6;">&#x26A0; Float Ops</span> — Device has <b>FLOAT_OPS</b> disabled`)
                    }
                    if (!devDecoded.ops32bit) {
                        flagWarnings.push(`<span style="color: #fce9a6;">&#x26A0; 32-bit Ops</span> — Device has <b>OPS_32BIT</b> disabled`)
                    }
                    if (!devDecoded.cvt) {
                        flagWarnings.push(`<span style="color: #fce9a6;">&#x26A0; Type Conversion</span> — Device has <b>CVT</b> disabled`)
                    }
                    if (!devDecoded.stackOps) {
                        flagWarnings.push(`<span style="color: #fce9a6;">&#x26A0; Stack Ops</span> — Device has <b>STACK_OPS</b> disabled`)
                    }
                    if (!devDecoded.bitwiseOps) {
                        flagWarnings.push(`<span style="color: #fce9a6;">&#x26A0; Bitwise Ops</span> — Device has <b>BITWISE_OPS</b> disabled`)
                    }
                    if (!devDecoded.strings) {
                        flagWarnings.push(`<span style="color: #fce9a6;">&#x26A0; Strings</span> — Device has <b>STRINGS</b> disabled`)
                    }
                    if (!devDecoded.advancedMath) {
                        flagWarnings.push(`<span style="color: #fce9a6;">&#x26A0; Advanced Math</span> — Device has <b>ADVANCED_MATH</b> disabled`)
                    }
                    if (!devDecoded.x64Ops) {
                        flagWarnings.push(`<span style="color: #fce9a6;">&#x26A0; 64-bit Ops</span> — Device has <b>X64_OPS</b> disabled`)
                    }
                }
            }

            const allWarnings = [...mismatches, ...flagWarnings]

            if (allWarnings.length > 0) {
                const flagsHex = typeof deviceInfo.flags === 'number' ? ` | Flags: <b>0x${deviceInfo.flags.toString(16).toUpperCase().padStart(4, '0')}</b>` : ''
                const details = `<br><br><span style="color: #777; font-size: 0.9em;">Target: <b>${deviceInfo.type || '?'}</b> ${deviceInfo.arch ? '(' + deviceInfo.arch + ')' : ''} <span style="opacity: 0.7">${deviceInfo.version ? 'v' + deviceInfo.version : ''}</span>${flagsHex}</span>`
                const hasCritical = mismatches.length > 0 || flagWarnings.some(w => w.includes('#f48771'))
                const title = mismatches.length > 0 ? 'Device Mismatch' : 'Feature Warnings'
                const description = `${mismatches.length > 0 ? 'The connected device details do not match the project configuration:<br><br>' : ''}${mismatches.length > 0 ? mismatches.join('<br>') : ''}${mismatches.length > 0 && flagWarnings.length > 0 ? '<br><br>' : ''}${flagWarnings.length > 0 ? '<span style="font-size: 0.95em;">' + flagWarnings.join('<br>') + '</span>' : ''}<br><br>Upload anyway?${details}`
                const confirm = await Popup.confirm({
                    title,
                    description,
                    confirm_text: 'Upload',
                    cancel_text: 'Cancel',
                    confirm_button_color: hasCritical ? '#d1852e' : '#0078d4',
                    confirm_text_color: '#FFF',
                })
                if (!confirm) {
                    this.logToConsole('Upload aborted due to device mismatch.', 'warning')
                    this.logToConsole('----------------------------------------', 'info')
                    return
                }
            } else {
                const flagsHex = typeof deviceInfo.flags === 'number' ? ` | Flags: <b>0x${deviceInfo.flags.toString(16).toUpperCase().padStart(4, '0')}</b>` : ''
                const details = `<br><br><span style="color: #777; font-size: 0.9em;">Target: <b>${deviceInfo.type || '?'}</b> ${deviceInfo.arch ? '(' + deviceInfo.arch + ')' : ''} <span style="opacity: 0.7">${deviceInfo.version ? 'v' + deviceInfo.version : ''}</span>${flagsHex}</span>`
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
            const details = dInfo ? `<br><br><span style="color: #777; font-size: 0.9em;">Target: <b>${dInfo.type || '?'}</b> ${dInfo.arch ? '(' + dInfo.arch + ')' : ''} <span style="opacity: 0.7">${dInfo.version ? 'v' + dInfo.version : ''}</span></span>` : ''

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
            if (typeof this.setConsoleTab === 'function') this.setConsoleTab('output')
            this.logToConsole(`Uploading ${compiledSize} bytes to device...`, 'info')
            this.showLoading('Uploading program...')
            const startTime = performance.now()
            await this.#editor.device_manager.connection.downloadProgram(compiledBytecode)
            const endTime = performance.now()
            this.hideLoading()
            this.logToConsole('Program uploaded successfully.', 'success')
            this.logToConsole(`Upload took ${(endTime - startTime).toFixed(0)}ms`, 'info')

            // Configure T/C offsets on the device using the values from compilation
            // This ensures the device's timer/counter memory areas match the compiled bytecode
            const offsets = this.#editor.project?.offsets
            if (offsets && typeof this.#editor.device_manager.connection.configureTCOffsets === 'function') {
                const timerOffset = offsets.timer?.offset ?? 0
                const counterOffset = offsets.counter?.offset ?? 0
                if (timerOffset > 0 || counterOffset > 0) {
                    try {
                        await this.#editor.device_manager.connection.configureTCOffsets(timerOffset, counterOffset)
                        this.logToConsole(`T/C offsets configured: T=${timerOffset}, C=${counterOffset}`, 'info')
                    } catch (tcErr) {
                        console.warn('Failed to configure T/C offsets:', tcErr)
                    }
                }
            }

            // Refresh device info after upload for general status
            try {
                const newDeviceInfo = await this.#editor.device_manager.connection.getInfo()
                if (newDeviceInfo) {
                    this.#editor.device_manager.deviceInfo = newDeviceInfo
                }
            } catch (infoErr) {
                console.warn('Failed to refresh device info after upload:', infoErr)
            }

            this.logToConsole('----------------------------------------', 'info')

            // Reset data fetcher to clear stale memory cache
            if (this.#editor.data_fetcher) {
                this.#editor.data_fetcher.reset()
            }
        } catch (e) {
            this.hideLoading()
            this.logToConsole(`Upload failed: ${e.message}`, 'error')
            this.logToConsole('----------------------------------------', 'info')
        }
    }

    /**
     * Scans the project for patchable constants
     * @returns {Array<{name: string, type: string, current_value: number, bytecode_offset: number, instruction_name: string, timer_address: number}>}
     */
    async scanPatchableConstants() {
        if (!this.#editor.program_patcher) {
            console.error('Bytecode patcher not initialized')
            return []
        }
        return this.#editor.program_patcher.scanPatchableConstants()
    }

    /**
     * Patches a constant value in the bytecode and re-uploads
     * @param {number} bytecodeOffset - Offset in bytecode where the constant is stored
     * @param {number} newValue - New value to set
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async patchConstant(bytecodeOffset, newValue) {
        if (!this.#editor.program_patcher) {
            return {success: false, message: 'Bytecode patcher not initialized'}
        }

        const result = await this.#editor.program_patcher.patchConstant(bytecodeOffset, newValue)

        if (result.success) {
            this.logToConsole(result.message, 'success')
        } else {
            this.logToConsole(result.message, 'error')
        }

        return result
    }

    /**
     * Reads the current value of a constant from bytecode
     * @param {number} bytecodeOffset
     * @returns {Promise<{success: boolean, value?: number, message?: string}>}
     */
    async readConstant(bytecodeOffset) {
        if (!this.#editor.program_patcher) {
            return {success: false, message: 'Bytecode patcher not initialized'}
        }
        return await this.#editor.program_patcher.readConstant(bytecodeOffset)
    }

    /**
     * Opens a dialog to patch a constant value
     */
    async openPatchDialog() {
        // Scan for patchable constants
        const constants = await this.scanPatchableConstants()

        if (constants.length === 0) {
            new Popup({
                title: 'No Patchable Constants',
                description: 'No patchable constants found in the compiled program.',
                content: `<div style="color: #ccc; line-height: 1.6;">
                    Make sure you have:<br>
                    1. Compiled the project<br>
                    2. Used instructions with constant parameters<br>
                    <span style="color: #888;">(e.g., TON M69 #500, u8.const 100)</span>
                </div>`,
                buttons: [{text: 'OK', value: 'ok', background: '#007bff', color: 'white'}],
            })
            return
        }

        // Create list of constants
        const listContainer = document.createElement('div')
        listContainer.style.cssText = 'max-height: 300px; overflow-y: auto; margin: 10px 0;'

        const list = document.createElement('div')
        list.style.cssText = 'display: flex; flex-direction: column; gap: 5px;'

        let selectedIndex = -1

        constants.forEach((c, i) => {
            const item = document.createElement('div')
            item.style.cssText = `
                padding: 8px 12px;
                background: #2d2d2d;
                border: 1px solid #3c3c3c;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s;
                font-family: 'Consolas', 'Courier New', monospace;
            `

            let desc = `<div style="color: #4fc1ff; font-weight: 600; margin-bottom: 4px;">${c.name}</div>`
            desc += `<div style="color: #fff;">Value: <span style="color: #b5cea8;">${c.current_value}</span></div>`

            if (c.flags & 0x10) {
                // IR_FLAG_TIMER
                desc += `<div style="color: #888; font-size: 11px;">${c.instruction_name} at M${c.timer_address}, line ${c.source_line}</div>`
            } else {
                desc += `<div style="color: #888; font-size: 11px;">${c.operand_type}, line ${c.source_line}:${c.source_column}</div>`
            }

            item.innerHTML = desc

            item.addEventListener('mouseenter', () => {
                if (selectedIndex !== i) {
                    item.style.background = '#3c3c3c'
                    item.style.borderColor = '#555'
                }
            })
            item.addEventListener('mouseleave', () => {
                if (selectedIndex !== i) {
                    item.style.background = '#2d2d2d'
                    item.style.borderColor = '#3c3c3c'
                }
            })
            item.addEventListener('click', () => {
                // Deselect others
                list.querySelectorAll('div').forEach(el => {
                    el.style.background = '#2d2d2d'
                    el.style.borderColor = '#3c3c3c'
                })
                // Select this
                selectedIndex = i
                item.style.background = '#0078d4'
                item.style.borderColor = '#0078d4'
            })

            list.appendChild(item)
        })

        listContainer.appendChild(list)

        const selectedConstant = await Popup.promise({
            title: 'Select Constant to Patch',
            description: `Select a constant from the list below (${constants.length} found):`,
            content: listContainer,
            width: '500px',
            buttons: [
                {text: 'Next', value: 'next', background: '#007bff', color: 'white', verify: () => selectedIndex !== -1},
                {text: 'Cancel', value: 'cancel'},
            ],
        })

        if (selectedConstant !== 'next' || selectedIndex === -1) return

        const constant = constants[selectedIndex]

        // Create value input dialog
        const inputContainer = document.createElement('div')
        inputContainer.style.cssText = 'display: flex; flex-direction: column; gap: 12px;'

        // Info display
        const info = document.createElement('div')
        info.style.cssText = 'background: #2d2d2d; padding: 12px; border-radius: 4px; font-family: "Consolas", monospace; font-size: 12px; line-height: 1.6;'
        info.innerHTML = `
            <div style="color: #4fc1ff; font-weight: 600; margin-bottom: 8px;">${constant.name}</div>
            <div style="color: #ccc;">Type: <span style="color: #4ec9b0;">${constant.operand_type}</span></div>
            <div style="color: #ccc;">Current: <span style="color: #b5cea8;">${constant.current_value}</span></div>
            ${constant.timer_address !== undefined ? `<div style="color: #ccc;">Timer: <span style="color: #c586c0;">M${constant.timer_address}</span></div>` : ''}
            <div style="color: #888; font-size: 11px; margin-top: 6px;">Source: Line ${constant.source_line}, Column ${constant.source_column}</div>
            <div style="color: #666; font-size: 11px;">Bytecode: 0x${constant.bytecode_offset.toString(16).toUpperCase()}</div>
        `

        const valueInput = document.createElement('input')
        valueInput.type = 'number'
        valueInput.value = constant.current_value.toString()
        valueInput.style.cssText = `
            padding: 8px 12px;
            background: #1e1e1e;
            border: 1px solid #3c3c3c;
            border-radius: 4px;
            color: #fff;
            font-size: 14px;
            font-family: 'Consolas', monospace;
        `
        valueInput.placeholder = constant.flags & 0x10 ? 'Enter time in milliseconds' : `Enter ${constant.operand_type} value`

        inputContainer.appendChild(info)
        inputContainer.appendChild(valueInput)

        const result = await Popup.promise({
            title: 'Patch Constant Value',
            description: constant.flags & 0x10 ? 'Enter new preset time (milliseconds):' : `Enter new value (${constant.operand_type}):`,
            content: inputContainer,
            width: '450px',
            buttons: [
                {
                    text: 'Patch',
                    value: 'patch',
                    background: '#0078d4',
                    color: 'white',
                    verify: () => {
                        const val = constant.operand_type === 'f32' || constant.operand_type === 'f64' ? parseFloat(valueInput.value) : parseInt(valueInput.value)
                        if (!Number.isFinite(val)) {
                            valueInput.style.borderColor = 'red'
                            return false
                        }
                        valueInput.style.borderColor = '#3c3c3c'
                        return true
                    },
                },
                {text: 'Cancel', value: 'cancel'},
            ],
            onOpen: () => {
                valueInput.focus()
                valueInput.select()
            },
        })

        if (result !== 'patch') return

        const newValue = constant.operand_type === 'f32' || constant.operand_type === 'f64' ? parseFloat(valueInput.value) : parseInt(valueInput.value)

        const patchResult = await this.patchConstant(constant.bytecode_offset, newValue)

        new Popup({
            title: patchResult.success ? 'Success' : 'Error',
            description: patchResult.message,
            buttons: [{text: 'OK', value: 'ok', background: patchResult.success ? '#28a745' : '#dc3545', color: 'white'}],
        })

        if (patchResult.success && this.isMonitoringActive()) {
            this.updateWatchValues()
        }
    }

    #on_device_online_click = async () => {
        const editor = this.#editor
        const device_info = this.device_info
        const device_online_button = this.device_online_button
        // If attribute is disabled, return
        if (device_online_button.hasAttribute('disabled')) return
        const mode = this.active_mode === 'edit' ? 'online' : 'edit'

        // Determine device based on connection mode if going online
        if (mode === 'online') {
            // Only auto-set if active_device isn't already explicitly set
            if (!this.active_device || this.active_device === '') {
                if (this.connectionMode === 'simulation') {
                    this.active_device = 'simulation'
                } else if (this.connectionMode === 'serial') {
                    this.active_device = 'serial'
                }
            }
        }

        device_online_button.setAttribute('disabled', 'disabled')
        if (mode === 'online') {
            // @ts-ignore
            const before = device_online_button.innerText
            // @ts-ignore
            device_online_button.innerText = '----------'
            const connected = await this.requestConnect(this.active_device)
            if (!connected) {
                const errorMsg = editor.device_manager.error || 'Failed to connect to device'
                console.error('Failed to connect to device')
                this.logToConsole(errorMsg, 'error')
                await editor.device_manager.disconnect()
                device_online_button.removeAttribute('disabled')
                // @ts-ignore
                device_online_button.innerText = '○'
                device_online_button.title = 'Connect'
                device_online_button.style.background = '#1fba5f'
                device_online_button.style.color = '#fff'
                const displayErrorMsg = editor.device_manager.error || 'Connection error'
                device_info.innerHTML = `
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                        <div style="flex: 1; min-width: 0;">
                            <div class="device-name" style="color: #dc3545;">${displayErrorMsg}</div>
                            <div class="device-meta" style="color: #666;">Check connection and retry</div>
                        </div>
                        <button class="plc-device-details-btn" title="Device Details" style="background: #2a2a2a; border: 1px solid #444; color: #666; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                    </div>
                `
                const errorDetailsBtn = device_info.querySelector('.plc-device-details-btn')
                if (errorDetailsBtn) {
                    errorDetailsBtn.addEventListener('click', () => this._showDeviceDetails())
                }
                this._healthConnectionState = false
                this._stopHealthPolling()
                this._setHealthConnected(false)
                // Update paired devices list to refresh connection status
                if (this.connectionMode === 'serial') {
                    this.updateDeviceDropdown()
                }
                return
            }
            const info = editor.device_manager.deviceInfo
            if (info) {
                device_info.innerHTML = `
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                        <div style="flex: 1; min-width: 0;">
                            <div class="device-name">${info.device || 'Unknown Device'}</div>
                            <div class="device-meta">${info.arch} ${info.version ? 'v' + info.version : ''}</div>
                        </div>
                        <button class="plc-device-details-btn" title="Device Details" style="background: #333; border: 1px solid #444; color: #ccc; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                    </div>
                `
                const connectedDetailsBtn = device_info.querySelector('.plc-device-details-btn')
                if (connectedDetailsBtn) {
                    connectedDetailsBtn.addEventListener('click', () => this._showDeviceDetails())
                }

                // Store device name and info in project for future reference
                if (this.connectionMode === 'serial' && editor.device_manager?.connection?.serial?.port) {
                    const port = editor.device_manager.connection.serial.port
                    const portInfo = port.getInfo()
                    if (portInfo.usbVendorId && portInfo.usbProductId) {
                        const portKey = `${portInfo.usbVendorId.toString(16).padStart(4, '0')}:${portInfo.usbProductId.toString(16).padStart(4, '0')}`
                        if (!editor.project.serialDeviceNames) {
                            editor.project.serialDeviceNames = {}
                        }
                        const deviceLabel = info.device || 'Unnamed'
                        const arch = info.arch || ''
                        const fullName = arch ? `${deviceLabel} [${arch}]` : deviceLabel

                        // Store as object with timestamps
                        const existing = editor.project.serialDeviceNames[portKey]
                        const now = Date.now()
                        let created = now

                        if (typeof existing === 'string') {
                            created = now
                        } else if (existing && existing.created) {
                            created = existing.created
                        }

                        editor.project.serialDeviceNames[portKey] = {
                            name: fullName,
                            created: created,
                            lastConnected: now,
                        }

                        // Save project to persist device names
                        if (editor.project_manager?.forceSave) {
                            editor.project_manager.forceSave()
                        }
                        // Update dropdown after storing device name
                        this.updateDeviceDropdown()
                    }
                }
            } else {
                device_info.innerHTML = `
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                        <div style="flex: 1; min-width: 0;">
                            <div class="device-name">Unknown device</div>
                            <div class="device-meta" style="color: #666;">Device info unavailable</div>
                        </div>
                        <button class="plc-device-details-btn" title="Device Details" style="background: #333; border: 1px solid #444; color: #ccc; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                    </div>
                `
                const unknownDetailsBtn = device_info.querySelector('.plc-device-details-btn')
                if (unknownDetailsBtn) {
                    unknownDetailsBtn.addEventListener('click', () => this._showDeviceDetails())
                }
            }
            this._healthConnectionState = true
            this._setHealthConnected(true)
            this._startHealthPolling()

            // Simulation Auto-Load Sequence
            if (this.active_device === 'simulation') {
                const compileSuccess = await this.handleCompile({silent: true})

                // In simulation mode, stay connected even if compilation fails
                // This allows viewing/editing the project while connected
                if (!compileSuccess) {
                    this.logToConsole('Project compilation failed - simulation connected but no program loaded', 'warning')
                }

                const compiledBytecode = this.#editor.project?.binary
                if (compiledBytecode) {
                    // Delay 1: After Compile, Before Offsets
                    await new Promise(r => setTimeout(r, 200))

                    if (this.#editor.device_manager?.connection && typeof this.#editor.device_manager.connection.plc?.setRuntimeOffsets === 'function') {
                        const normalized = ensureOffsets(this.#editor.project.offsets || {})
                        await this.#editor.device_manager.connection.plc.setRuntimeOffsets(normalized.system.offset, normalized.input.offset, normalized.output.offset, normalized.marker.offset)
                    }

                    // Delay 2: After Offsets, Before Download
                    await new Promise(r => setTimeout(r, 200))
                    await this.#editor.device_manager.connection.downloadProgram(compiledBytecode)

                    // Reset data fetcher after program download
                    if (this.#editor.data_fetcher) {
                        this.#editor.data_fetcher.reset()
                    }

                    // Delay 3: After Download, Before Monitoring
                    await new Promise(r => setTimeout(r, 200))
                    this.setMonitoringActive(true)
                }
            }
        } else {
            device_info.innerHTML = `
                <div style="display: flex; align-items: flex-start; gap: 8px;">
                    <div style="flex: 1; min-width: 0;">
                        <div class="device-name" style="color: #888;">Disconnected</div>
                        <div class="device-meta" style="color: #666;">Click connect to go online</div>
                    </div>
                    <button class="plc-device-details-btn" title="Device Details" style="background: #2a2a2a; border: 1px solid #444; color: #666; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                </div>
            `
            const disconnectDetailsBtn = device_info.querySelector('.plc-device-details-btn')
            if (disconnectDetailsBtn) {
                disconnectDetailsBtn.addEventListener('click', () => this._showDeviceDetails())
            }
            await editor.device_manager.disconnect(true) // Mark as intentional
            this._healthConnectionState = false
            this._stopHealthPolling()
            this._setHealthConnected(false)
        }
        device_online_button.removeAttribute('disabled')

        // @ts-ignore
        if (mode === 'online') {
            device_online_button.innerText = '✕'
            device_online_button.title = 'Disconnect'
            device_online_button.style.background = '#dc3545'
            device_online_button.style.color = '#fff'
        } else {
            device_online_button.innerText = '○'
            device_online_button.title = 'Connect'
            device_online_button.style.background = '#1fba5f'
            device_online_button.style.color = '#fff'
        }
        this.active_mode = mode
        this.updateLiveMonitorState()

        // Only clear active_device when going offline, preserve it while online
        if (mode !== 'online') {
            this.active_device = null
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
        // This method is now handled by updateDeviceDropdown()
        // Keep for compatibility but make it a no-op or redirect
        if (this.updateDeviceDropdown) {
            this.updateDeviceDropdown()
        }
    }

    setActiveDevice(device) {
        // Legacy method - no longer needed with new connection UI
        // The device is now selected via mode dropdown and device dropdown
        this.active_device = device
    }

    _initializeMenuBar() {
        const workspace = this.#editor.workspace
        const menuBar = workspace.querySelector('.plc-menu-bar')
        if (!menuBar) return

        const menuItems = menuBar.querySelectorAll('.plc-menu-item')
        let openMenu = null

        // Close all menus
        const closeAllMenus = () => {
            menuItems.forEach(item => item.classList.remove('open'))
            openMenu = null
        }

        // Toggle menu on click
        menuItems.forEach(item => {
            const label = item.querySelector('.plc-menu-label')
            if (label) {
                label.addEventListener('click', e => {
                    e.stopPropagation()
                    if (item.classList.contains('open')) {
                        closeAllMenus()
                    } else {
                        closeAllMenus()
                        item.classList.add('open')
                        openMenu = item
                    }
                })

                // Hover to switch menus when one is open
                label.addEventListener('mouseenter', () => {
                    if (openMenu && openMenu !== item) {
                        closeAllMenus()
                        item.classList.add('open')
                        openMenu = item
                    }
                })
            }
        })

        // Close menus on click outside
        document.addEventListener('click', e => {
            if (!menuBar.contains(e.target)) {
                closeAllMenus()
            }
        })

        // Close menus on Escape key
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && openMenu) {
                closeAllMenus()
            }
        })

        // Handle menu option clicks
        menuBar.addEventListener('click', async e => {
            const option = e.target.closest('.plc-menu-option')
            if (!option) return

            const action = option.dataset.action
            closeAllMenus()

            switch (action) {
                case 'new-project':
                    this._menuNewProject()
                    break
                case 'open-project':
                    this._menuOpenProject()
                    break
                case 'export-project':
                    this._menuExportProject()
                    break
                case 'project-properties':
                    this._menuProjectProperties()
                    break
                case 'setup':
                    this.openProgram('setup')
                    break
                case 'memory':
                    this.openProgram('memory')
                    break
                case 'load-plc-config':
                    this._menuLoadPLCConfig()
                    break
                case 'about':
                    this._menuAbout()
                    break
                case 'version-history':
                    this._menuVersionHistory()
                    break
                case 'disclaimer':
                    this._menuDisclaimer()
                    break
            }
        })
    }

    async _menuLoadPLCConfig() {
        const editor = this.#editor
        if (!editor.device_manager.connected) {
            await Popup.confirm({
                title: 'Load PLC Configuration',
                description: 'No device is connected. Please connect to a device first.',
            })
            return
        }

        const confirmed = await Popup.confirm({
            title: 'Load PLC Configuration',
            description: 'This will overwrite your local project configuration (Type, Offsets, Sizes) with the settings from the connected device.\n\nAre you sure you want to continue?',
        })
        if (!confirmed) return

        try {
            const info = await editor.device_manager.connection.getInfo(true)
            if (info) {
                // Delegate to SetupUI if it exists
                const setupWin = this.windows.get('setup')
                if (setupWin && typeof setupWin.updateProjectConfig === 'function') {
                    setupWin.updateProjectConfig(info)
                } else {
                    // Apply config directly
                    const project = editor.project
                    if (info.device) project.info.type = info.device
                    if (info.arch) project.info.arch = info.arch
                    if (info.version) project.info.version = info.version
                    if (info.program) project.info.capacity = info.program
                    if (info.date) project.info.date = info.date
                    if (info.stack) project.info.stack = info.stack
                    if (typeof info.flags === 'number') project.info.flags = info.flags
                    if (typeof info.control_offset !== 'undefined') {
                        project.offsets.system = { offset: info.control_offset, size: info.control_size }
                    }
                    if (typeof info.system_offset !== 'undefined') {
                        project.offsets.system = { offset: info.system_offset, size: info.system_size }
                    }
                    if (typeof info.input_offset !== 'undefined') {
                        project.offsets.input = { offset: info.input_offset, size: info.input_size }
                    }
                    if (typeof info.output_offset !== 'undefined') {
                        project.offsets.output = { offset: info.output_offset, size: info.output_size }
                    }
                    if (typeof info.marker_offset !== 'undefined') {
                        project.offsets.marker = { offset: info.marker_offset, size: info.marker_size }
                    }
                }
                this.logToConsole?.('PLC configuration loaded successfully', 'success')
                this.refreshActiveEditor?.()
            }

            // Try to load device symbols if the connection supports it
            if (typeof editor.device_manager.connection.getSymbolList === 'function') {
                try {
                    const deviceSymbols = await editor.device_manager.connection.getSymbolList()
                    if (deviceSymbols && deviceSymbols.length > 0) {
                        editor.project_manager.setDeviceSymbols(deviceSymbols)
                        this.logToConsole?.(`Loaded ${deviceSymbols.length} device symbols`, 'success')
                        this.refreshActiveEditor?.()
                    }
                } catch (symErr) {
                    console.warn('Failed to load device symbols:', symErr)
                }
            }
        } catch (e) {
            console.error('Failed to read config', e)
        }
    }

    /**
     * Show disclaimer popup
     * @param {{ requireAcceptance?: boolean }} options
     */
    async _menuDisclaimer(options = {}) {
        const {requireAcceptance = false} = options

        // Create a dark overlay for required acceptance
        let overlay = null
        if (requireAcceptance) {
            overlay = document.createElement('div')
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.85); z-index: 9998;'
            document.body.appendChild(overlay)
        }

        await Popup.promise({
            title: 'Disclaimer',
            width: '600px',
            closeButton: !requireAcceptance,
            backdrop: !requireAcceptance,
            closeOnESC: !requireAcceptance,
            draggable: !requireAcceptance,
            buttons: [
                {
                    text: requireAcceptance ? 'I Understand' : 'OK',
                    value: 'accept',
                    background: '#0e639c',
                    color: 'white',
                },
            ],
            content: /*HTML*/ `
                <div style="line-height: 1.6; color: #ccc;">
                    <div style="background: #3a2a1a; border: 1px solid #ff9800; border-radius: 4px; padding: 12px; margin-bottom: 16px;">
                        <div style="color: #ff9800; font-weight: bold; margin-bottom: 8px;">⚠️ USE AT YOUR OWN RISK</div>
                        <p style="margin: 0; color: #ddd; font-size: 13px;">
                            This software is provided "as is", without warranty of any kind, express or implied. 
                            The authors are not responsible for any damage, data loss, or other issues that may arise from using this software.
                        </p>
                    </div>
                    
                    <div style="background: #2a2a3a; border: 1px solid #666; border-radius: 4px; padding: 12px; margin-bottom: 16px;">
                        <div style="color: #4ec9b0; font-weight: bold; margin-bottom: 8px;">🚧 Development Status</div>
                        <p style="margin: 0; color: #ddd; font-size: 13px;">
                            This is a project under active development. <strong>Breaking changes happen regularly.</strong> 
                            Project files, APIs, and features may change without notice between versions.
                        </p>
                    </div>
                    
                    <div style="background: #1e1e2e; border: 1px solid #555; border-radius: 4px; padding: 12px; margin-bottom: 16px;">
                        <div style="color: #dcdcaa; font-weight: bold; margin-bottom: 8px;">📜 License</div>
                        <p style="margin: 0; color: #ddd; font-size: 13px;">
                            This software is licensed under the <strong>GPL-3.0</strong> license. 
                            See the LICENSE file for full details.
                        </p>
                    </div>
                    
                    <div style="background: #1e2e1e; border: 1px solid #555; border-radius: 4px; padding: 12px;">
                        <div style="color: #9cdcfe; font-weight: bold; margin-bottom: 8px;">™ Trademarks & Affiliations</div>
                        <p style="margin: 0; color: #ddd; font-size: 13px;">
                            Product names and trademarks referenced in this project are the property of their respective owners. 
                            This project is an independent open-source work and is not affiliated with, endorsed by, sponsored by, 
                            or approved by any manufacturer or vendor. All implementations, designs, and source code are original 
                            and developed independently. Any similarities or references in comments are provided solely for familiarity 
                            and interoperability and are based on publicly known concepts and the IEC 61131-3 industrial controls standard.
                        </p>
                    </div>
                </div>
            `,
        })

        // Remove overlay if it was created
        if (overlay) {
            overlay.remove()
        }

        // If this was a required acceptance, store it
        if (requireAcceptance) {
            localStorage.setItem('vovkplc_disclaimer_accepted', 'true')
        }
    }

    _checkDisclaimerAcceptance() {
        const accepted = localStorage.getItem('vovkplc_disclaimer_accepted')
        if (!accepted) {
            // Show disclaimer with required acceptance
            this._menuDisclaimer({requireAcceptance: true})
        }
    }

    async _showDeviceDetails() {
        const isConnected = this.#editor.device_manager?.connected
        const liveDeviceInfo = this.#editor.device_manager?.deviceInfo
        const storedDevice = this.#editor.project?.lastPhysicalDevice
        
        // Use live data if connected, otherwise use stored data
        const deviceInfo = liveDeviceInfo || storedDevice?.deviceInfo
        const isStoredData = !liveDeviceInfo && storedDevice?.deviceInfo
        
        if (!deviceInfo) {
            new Popup({
                title: 'Device Details',
                description: 'No device connected and no previous device data stored.',
                buttons: [{text: 'OK', value: 'ok'}]
            })
            return
        }

        // Fetch additional info (transports and symbols)
        let transports = []
        let symbols = []
        let fetchError = null
        let dataSource = 'live'

        if (isConnected && this.#editor.device_manager?.connection) {
            // Show loading bar while fetching live data
            this.showLoading('Fetching device info...')
            
            // Fetch live data from connected device
            try {
                const dm = this.#editor.device_manager
                const results = await Promise.allSettled([
                    dm.getTransportInfo?.() || Promise.resolve([]),
                    dm.getSymbolList?.() || Promise.resolve([])
                ])
                transports = results[0].status === 'fulfilled' ? results[0].value || [] : []
                symbols = results[1].status === 'fulfilled' ? results[1].value || [] : []
            } catch (err) {
                fetchError = err.message || 'Failed to fetch device data'
            } finally {
                this.hideLoading()
            }
        } else if (storedDevice) {
            // Use stored data
            transports = storedDevice.transports || []
            symbols = storedDevice.symbols || []
            dataSource = 'stored'
        }

        // Transport type names
        const transportTypeNames = {
            0: 'Unknown',
            1: 'Serial',
            2: 'WiFi',
            3: 'Ethernet',
            4: 'Bluetooth'
        }

        // Format device info into sections
        const formatBytes = (bytes) => {
            if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
            if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB'
            return bytes + ' B'
        }

        // Stored data notice
        const storedNoticeHtml = isStoredData ? /*HTML*/ `
            <div style="color: #888; font-size: 11px; padding: 8px; background: #252525; border: 1px solid #444; border-radius: 4px; margin-bottom: 12px;">
                📁 Showing stored data from last connection${storedDevice.timestamp ? ` (${new Date(storedDevice.timestamp).toLocaleString()})` : ''}
            </div>
        ` : ''

        // Build device parameters table
        const deviceParamsHtml = /*HTML*/ `
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                <tr><td style="padding: 4px 8px; color: #888; width: 120px;">Device</td><td style="padding: 4px 8px; color: #ECECEC;">${deviceInfo.device || 'Unknown'}</td></tr>
                <tr><td style="padding: 4px 8px; color: #888;">Architecture</td><td style="padding: 4px 8px; color: #ECECEC;">${deviceInfo.arch || 'Unknown'}</td></tr>
                <tr><td style="padding: 4px 8px; color: #888;">Version</td><td style="padding: 4px 8px; color: #ECECEC;">${deviceInfo.version || '?'}</td></tr>
                <tr><td style="padding: 4px 8px; color: #888;">Build Date</td><td style="padding: 4px 8px; color: #ECECEC;">${deviceInfo.date || '?'}</td></tr>
                <tr><td style="padding: 4px 8px; color: #888;">Stack Size</td><td style="padding: 4px 8px; color: #ECECEC;">${formatBytes(deviceInfo.stack || 0)}</td></tr>
                <tr><td style="padding: 4px 8px; color: #888;">Memory Size</td><td style="padding: 4px 8px; color: #ECECEC;">${formatBytes(deviceInfo.memory || 0)}</td></tr>
                <tr><td style="padding: 4px 8px; color: #888;">Program Size</td><td style="padding: 4px 8px; color: #ECECEC;">${formatBytes(deviceInfo.program || 0)}</td></tr>
            </table>
        `

        // Build memory map table
        const memoryMapHtml = /*HTML*/ `
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                <tr style="background: #252525;">
                    <th style="padding: 4px 8px; text-align: left; color: #888; font-weight: normal;">Area</th>
                    <th style="padding: 4px 8px; text-align: right; color: #888; font-weight: normal;">Offset</th>
                    <th style="padding: 4px 8px; text-align: right; color: #888; font-weight: normal;">Size/Count</th>
                </tr>
                ${deviceInfo.system_offset !== undefined ? `<tr><td style="padding: 3px 8px; color: #ECECEC;">System</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.system_offset}</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.system_size || '?'}</td></tr>` : ''}
                ${deviceInfo.input_offset !== undefined ? `<tr><td style="padding: 3px 8px; color: #ECECEC;">Inputs</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.input_offset}</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.input_size || '?'}</td></tr>` : ''}
                ${deviceInfo.output_offset !== undefined ? `<tr><td style="padding: 3px 8px; color: #ECECEC;">Outputs</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.output_offset}</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.output_size || '?'}</td></tr>` : ''}
                ${deviceInfo.marker_offset !== undefined ? `<tr><td style="padding: 3px 8px; color: #ECECEC;">Markers</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.marker_offset}</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.marker_size || '?'}</td></tr>` : ''}
                ${deviceInfo.timer_offset !== undefined ? `<tr><td style="padding: 3px 8px; color: #ECECEC;">Timers</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.timer_offset}</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.timer_count || '?'} × ${deviceInfo.timer_struct_size || '?'}B</td></tr>` : ''}
                ${deviceInfo.counter_offset !== undefined ? `<tr><td style="padding: 3px 8px; color: #ECECEC;">Counters</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.counter_offset}</td><td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${deviceInfo.counter_count || '?'} × ${deviceInfo.counter_struct_size || '?'}B</td></tr>` : ''}
            </table>
        `

        // Build transports table
        // Determine active connection method to show as default when no transports reported
        const activeConnectionMode = this.connectionMode || 'simulation'
        const connectionModeLabels = { serial: 'Serial (USB)', simulation: 'Simulation (WASM)', rest: 'REST (HTTP)' }
        const activeConnectionLabel = connectionModeLabels[activeConnectionMode] || activeConnectionMode

        const transportsHtml = (() => {
            const activeRowHtml = `
                <tr style="background: #1e2a1e;">
                    <td style="padding: 3px 8px; color: #4ec9b0;">${activeConnectionLabel}</td>
                    <td style="padding: 3px 8px; color: #888;">Active connection</td>
                    <td style="padding: 3px 8px; text-align: center;">${isConnected ? '🟢' : '⚪'}</td>
                    <td style="padding: 3px 8px; color: #aaa; font-family: monospace; font-size: 10px;">Editor ↔ Device</td>
                </tr>`
            const transportRows = transports.map(t => {
                const typeName = transportTypeNames[t.type] || `Type ${t.type}`
                const statusIcon = t.isConnected ? '🟢' : '⚪'
                const authIcon = t.requiresAuth ? '🔒' : ''
                let config = ''
                if (t.baudrate) {
                    config = `${t.baudrate} baud`
                } else if (t.isNetwork) {
                    config = `${t.ip || '?'}:${t.port || '?'}`
                    if (t.mac) config += `<br><span style="color: #666; font-size: 10px;">MAC: ${t.mac}</span>`
                }
                return `<tr>
                    <td style="padding: 3px 8px; color: #ECECEC;">${t.name || typeName}</td>
                    <td style="padding: 3px 8px; color: #aaa;">${typeName} ${authIcon}</td>
                    <td style="padding: 3px 8px; text-align: center;">${statusIcon}</td>
                    <td style="padding: 3px 8px; color: #aaa; font-family: monospace; font-size: 10px;">${config || '-'}</td>
                </tr>`
            }).join('')
            return /*HTML*/ `
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                <tr style="background: #252525;">
                    <th style="padding: 4px 8px; text-align: left; color: #888; font-weight: normal;">Interface</th>
                    <th style="padding: 4px 8px; text-align: left; color: #888; font-weight: normal;">Type</th>
                    <th style="padding: 4px 8px; text-align: center; color: #888; font-weight: normal;">Status</th>
                    <th style="padding: 4px 8px; text-align: left; color: #888; font-weight: normal;">Configuration</th>
                </tr>
                ${activeRowHtml}
                ${transportRows ? `<tr><td colspan="4" style="padding: 0; border-top: 1px solid #333;"></td></tr>${transportRows}` : ''}
            </table>
        `
        })()

        // Build symbols table
        const formatSymbolAddress = (s) => {
            const addr = Number(s.address)
            const bit = s.bit !== undefined && s.bit !== null ? Number(s.bit) : null
            if (bit !== null) {
                return `${addr.toFixed(1).replace('.0', '')}.${bit}`
            }
            return addr.toFixed(1).replace('.0', '')
        }
        const symbolsHtml = symbols.length === 0 ?
            `<div style="color: #666; font-size: 11px; padding: 8px; text-align: center;">No device symbols defined</div>` :
            /*HTML*/ `
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                <tr style="background: #252525; position: sticky; top: 0;">
                    <th style="padding: 4px 8px; text-align: left; color: #888; font-weight: normal;">Name</th>
                    <th style="padding: 4px 8px; text-align: left; color: #888; font-weight: normal;">Area</th>
                    <th style="padding: 4px 8px; text-align: right; color: #888; font-weight: normal;">Address</th>
                    <th style="padding: 4px 8px; text-align: left; color: #888; font-weight: normal;">Type</th>
                    <th style="padding: 4px 8px; text-align: left; color: #888; font-weight: normal;">Comment</th>
                </tr>
                ${symbols.slice(0, 100).map(s => `<tr>
                    <td style="padding: 3px 8px; color: #4682B4; font-family: monospace;">${s.name || '?'}</td>
                    <td style="padding: 3px 8px; color: #aaa;">${s.area || '?'}</td>
                    <td style="padding: 3px 8px; text-align: right; color: #aaa; font-family: monospace;">${formatSymbolAddress(s)}</td>
                    <td style="padding: 3px 8px; color: #888;">${s.type || 'byte'}</td>
                    <td style="padding: 3px 8px; color: #666; font-size: 10px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${(s.comment || '').replace(/"/g, '&quot;')}">${s.comment || ''}</td>
                </tr>`).join('')}
                ${symbols.length > 100 ? `<tr><td colspan="5" style="padding: 4px 8px; color: #666; text-align: center; font-style: italic;">... and ${symbols.length - 100} more</td></tr>` : ''}
            </table>
        `

        // Error message if any
        const errorHtml = fetchError ? `<div style="color: #dc3545; font-size: 11px; padding: 8px; background: #2a1a1a; border: 1px solid #5a2a2a; border-radius: 4px; margin-bottom: 12px;">⚠️ ${fetchError}</div>` : ''

        // Build flags table
        const hasFlags = typeof deviceInfo.flags === 'number'
        const flagsHex = hasFlags ? '0x' + deviceInfo.flags.toString(16).toUpperCase().padStart(4, '0') : null
        const flagsHtml = (() => {
            if (!hasFlags) {
                return `<div style="color: #666; font-size: 11px; padding: 8px; text-align: center;">No flags information available</div>`
            }
            const hasDecoder = typeof VovkPLC !== 'undefined' && VovkPLC.decodeRuntimeFlags
            if (!hasDecoder) {
                return `<div style="color: #aaa; font-size: 11px; padding: 8px;">Flags: <span style="font-family: monospace;">${flagsHex}</span></div>`
            }
            const decoded = VovkPLC.decodeRuntimeFlags(deviceInfo.flags)
            const flagDefs = [
                ['LITTLE_ENDIAN', '0x0001', decoded.littleEndian,  'Endianness',        'Device uses little-endian byte order for multi-byte values in memory. Affects how u16/u32/f32 values are read and written.'],
                ['STRINGS',       '0x0002', decoded.strings,       'String Operations',  'Enables string manipulation instructions (SLEN, SCOPY, SCAT, SCMP). Required for programs that work with text data.'],
                ['COUNTERS',      '0x0004', decoded.counters,      'Counter Instructions','Enables up/down counter instructions (CTU, CTD, CTUD). Required for programs using counter memory area (C).'],
                ['TIMERS',        '0x0008', decoded.timers,        'Timer Instructions',  'Enables timer instructions (TON, TOF, TP). Required for programs using timer memory area (T).'],
                ['FFI',           '0x0010', decoded.ffi,           'Foreign Function Interface','Enables calling external native functions from PLC programs. Used for custom hardware drivers and platform-specific extensions.'],
                ['X64_OPS',       '0x0020', decoded.x64Ops,        '64-bit Operations',  'Enables 64-bit integer and double-precision float operations (u64, i64, f64). Increases precision at the cost of memory and speed.'],
                ['SAFE_MODE',     '0x0040', decoded.safeMode,      'Safe Mode',          'Enables runtime bounds checking and memory access validation. Catches out-of-range errors at the cost of slightly slower execution.'],
                ['TRANSPORT',     '0x0080', decoded.transport,      'Transport System',   'Enables the transport communication layer for multi-device networking and remote I/O over Serial, WiFi, Ethernet, or Bluetooth.'],
                ['FLOAT_OPS',     '0x0100', decoded.floatOps,       'Float Operations',   'Enables 32-bit floating point operations (f32.add, f32.mul, f32.cmp, etc.). Required for programs that use real/float values.'],
                ['ADVANCED_MATH', '0x0200', decoded.advancedMath,   'Advanced Math',      'Enables mathematical functions: POW, SQRT, SIN, COS, TAN, LOG, EXP, ABS. Required for scientific or motion control programs.'],
                ['OPS_32BIT',     '0x0400', decoded.ops32bit,       '32-bit Integer Ops', 'Enables 32-bit integer operations (u32, i32). Required for programs that need values beyond the 16-bit range (0–65535).'],
                ['CVT',           '0x0800', decoded.cvt,            'Type Conversion',    'Enables type conversion instructions (CVT) between different data types (int↔float, u8↔u16↔u32, etc.).'],
                ['STACK_OPS',     '0x1000', decoded.stackOps,       'Stack Manipulation',  'Enables stack manipulation instructions: SWAP, PICK, POKE, DUP, DROP. Useful for complex calculations without extra variables.'],
                ['BITWISE_OPS',   '0x2000', decoded.bitwiseOps,     'Bitwise Operations',  'Enables bitwise logic instructions: AND, OR, XOR, NOT, SHL, SHR. Required for bit manipulation and mask operations.'],
            ]
            const enabledCount = flagDefs.filter(f => f[2]).length
            return /*HTML*/ `
                <div style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #aaa; font-size: 11px;">Raw: <span style="font-family: monospace; color: #ddd;">${flagsHex}</span></span>
                    <span style="color: #888; font-size: 10px;">${enabledCount} / ${flagDefs.length} enabled</span>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                    ${flagDefs.map(([name, hex, enabled, label, desc]) => /*HTML*/ `
                        <tr style="border-bottom: 1px solid #2a2a2a;">
                            <td style="padding: 5px 8px; width: 20px; text-align: center;">
                                <span style="color: ${enabled ? '#4ec9b0' : '#555'}; font-size: 13px;">${enabled ? '●' : '○'}</span>
                            </td>
                            <td style="padding: 5px 6px;">
                                <div style="color: ${enabled ? '#ECECEC' : '#666'}; font-weight: 600; font-size: 11px;">${label}</div>
                                <div style="color: ${enabled ? '#888' : '#444'}; font-size: 10px; margin-top: 1px;">${desc}</div>
                            </td>
                            <td style="padding: 5px 8px; text-align: right; font-family: monospace; color: ${enabled ? '#888' : '#444'}; font-size: 10px; white-space: nowrap; vertical-align: top;">
                                ${name}<br><span style="color: ${enabled ? '#666' : '#383838'};">${hex}</span>
                            </td>
                        </tr>
                    `).join('')}
                </table>
            `
        })()

        // Tab CSS styles and switching script
        const tabStyles = /*HTML*/ `
            <style>
                .device-details-tabs { display: flex; gap: 2px; margin-bottom: 12px; border-bottom: 1px solid #333; padding-bottom: 0; }
                .device-details-tab { 
                    padding: 8px 16px; 
                    background: transparent; 
                    border: none; 
                    color: #888; 
                    cursor: pointer; 
                    font-size: 12px; 
                    border-bottom: 2px solid transparent;
                    transition: all 0.15s ease;
                    margin-bottom: -1px;
                }
                .device-details-tab:hover { color: #aaa; background: #2a2a2a; }
                .device-details-tab.active { color: #4682B4; border-bottom-color: #4682B4; background: transparent; }
                .device-details-panels-container { display: grid; }
                .device-details-panel { grid-area: 1 / 1; visibility: hidden; opacity: 0; transition: opacity 0.1s ease; }
                .device-details-panel.active { visibility: visible; opacity: 1; }
            </style>
        `
        
        // Tab switching function - attached to window temporarily
        const tabSwitchId = '_deviceDetailsTabSwitch_' + Date.now()
        window[tabSwitchId] = (tabName, btn) => {
            const container = btn.closest('.device-details-tabs').parentElement
            container.querySelectorAll('.device-details-tab').forEach(t => t.classList.remove('active'))
            container.querySelectorAll('.device-details-panel').forEach(p => p.classList.remove('active'))
            btn.classList.add('active')
            const targetPanel = container.querySelector(`.device-details-panel[data-panel="${tabName}"]`)
            if (targetPanel) targetPanel.classList.add('active')
        }

        const result = await Popup.promise({
            title: isStoredData ? 'Device Details (Stored)' : 'Device Details',
            width: '520px',
            content: /*HTML*/ `
                ${tabStyles}
                <div style="color: #ECECEC; line-height: 1.5;">
                    ${storedNoticeHtml}
                    ${errorHtml}
                    
                    <!-- Tab Navigation -->
                    <div class="device-details-tabs">
                        <button class="device-details-tab active" data-tab="device" onclick="${tabSwitchId}('device', this)">📋 Device</button>
                        <button class="device-details-tab" data-tab="memory" onclick="${tabSwitchId}('memory', this)">🗺️ Memory</button>
                        <button class="device-details-tab" data-tab="flags" onclick="${tabSwitchId}('flags', this)">🚩 Flags ${flagsHex ? `<span style="color: #666; font-size: 10px;">(${flagsHex})</span>` : ''}</button>
                        <button class="device-details-tab" data-tab="interfaces" onclick="${tabSwitchId}('interfaces', this)">🔌 Interfaces <span style="color: #666; font-size: 10px;">(${transports.length})</span></button>
                        <button class="device-details-tab" data-tab="symbols" onclick="${tabSwitchId}('symbols', this)">📌 Symbols <span style="color: #666; font-size: 10px;">(${symbols.length})</span></button>
                    </div>
                    
                    <!-- Tab Panels -->
                    <div class="device-details-panels-container">
                        <div class="device-details-panel active" data-panel="device">
                            <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 8px; overflow: hidden;">
                                ${deviceParamsHtml}
                            </div>
                        </div>
                        
                        <div class="device-details-panel" data-panel="memory">
                            <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 8px; overflow: hidden;">
                                ${memoryMapHtml}
                            </div>
                        </div>
                        
                        <div class="device-details-panel" data-panel="flags">
                            <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 8px; overflow: hidden; max-height: 350px; overflow-y: auto;">
                                ${flagsHtml}
                            </div>
                        </div>
                        
                        <div class="device-details-panel" data-panel="interfaces">
                            <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 8px; overflow: hidden;">
                                ${transportsHtml}
                            </div>
                        </div>
                        
                        <div class="device-details-panel" data-panel="symbols">
                            <div style="background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 8px; overflow: hidden; max-height: 300px; overflow-y: auto;">
                                ${symbolsHtml}
                            </div>
                        </div>
                    </div>
                </div>
            `,
            buttons: isStoredData ? [
                {text: 'Clear Stored Data', value: 'clear', style: 'background: #5a2a2a; color: #dc3545;'},
                {text: 'Close', value: 'close'}
            ] : [{text: 'Close', value: 'close'}]
        })
        
        // Clean up tab switch function
        delete window[tabSwitchId]

        // Handle clear stored data action
        if (isStoredData && result === 'clear') {
            // Clear stored device data from project
            if (this.#editor.project) {
                delete this.#editor.project.lastPhysicalDevice
                this.#editor.projectManager?.markDirty?.()
            }
            // Update device info panel
            if (this.device_info) {
                this.device_info.innerHTML = /*HTML*/ `
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                        <div style="flex: 1; min-width: 0;">
                            <div class="device-name" style="color: #888;">No device connected</div>
                            <div class="device-meta" style="color: #666;">Use the button below to connect</div>
                        </div>
                        <button class="plc-device-details-btn" title="Device Details" style="background: #2a2a2a; border: 1px solid #444; color: #666; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                    </div>
                `
                const clearDetailsBtn = this.device_info.querySelector('.plc-device-details-btn')
                if (clearDetailsBtn) {
                    clearDetailsBtn.addEventListener('click', () => this._showDeviceDetails())
                }
            }
        }
    }

    async _menuAbout() {
        const editorVersion = VOVKPLCEDITOR_VERSION || '0.1.0'
        const editorBuild = VOVKPLCEDITOR_VERSION_BUILD || ''
        const runtimeInfo = this.#editor?.runtime_info
        const runtimeVersion = runtimeInfo?.version || this.#editor.runtime?.version || '?'
        const runtimeArch = runtimeInfo?.arch || ''

        await Popup.promise({
            hideHeader: true,
            width: '640px',
            content: /*HTML*/ `
                <div style="line-height: 1.6; color: #ECECEC;">
                    <!-- Header -->
                    <div style="text-align: center; margin-bottom: 20px; padding: 20px; padding-bottom: 0px; padding-top: 0px;">
                        <div style="font-size: 28px; font-weight: bold; color: #4682B4;">VovkPLC</div>
                        <div style="color: #888; font-size: 12px; margin-top: 4px; letter-spacing: 2px;">EDITOR & RUNTIME</div>
                    </div>
                    
                    
                    <!-- Version boxes - Editor left, Runtime right -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                        <a href="https://github.com/jozo132/VovkPLCEditor" target="_blank" style="background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 12px; text-decoration: none; display: block; transition: border-color 0.2s;">
                            <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Editor</div>
                            <div style="font-weight: 600; color: #4682B4; margin-bottom: 4px;">VovkPLC Editor</div>
                            <div style="color: #aaa; font-size: 12px;">Version: ${editorVersion}${editorBuild ? ` Build ${editorBuild}` : ''}</div>
                        </a>
                        <a href="https://github.com/jozo132/VovkPLCRuntime" target="_blank" style="background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 12px; text-decoration: none; display: block; transition: border-color 0.2s;">
                            <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Runtime</div>
                            <div style="font-weight: 600; color: #4682B4; margin-bottom: 4px;">VovkPLC Runtime</div>
                            <div style="color: #aaa; font-size: 12px;">Version: ${runtimeVersion}${runtimeArch ? `<br>Arch: ${runtimeArch}` : ''}</div>
                        </a>
                    </div>
                    
                    <!-- Project Vision -->
                    <div style="background: #1a1a1a; border: 1px solid #4682B4; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                        <div style="color: #4682B4; font-weight: bold; margin-bottom: 10px; font-size: 13px;">🎯 Project Vision</div>
                        <p style="margin: 0 0 10px 0; color: #ECECEC; font-size: 12px; line-height: 1.7;">
                            This project was created to give <strong>anyone</strong> access to learn and use PLCs — with <strong>free simulation</strong> 
                            and very low-cost Arduino-compatible development boards that can run real PLC programs.
                        </p>
                        <p style="margin: 0 0 10px 0; color: #ECECEC; font-size: 12px; line-height: 1.7;">
                            Programs can be <strong>live inspected, diagnosed, debugged and patched</strong> in real-time, 
                            equivalent to advanced industrial systems - but without the cost.
                        </p>
                        <p style="margin: 0 0 10px 0; color: #aaa; font-size: 11px; line-height: 1.6;">
                            The VovkPLC Runtime is a C++ header-only stack based virtual machine executing specialized PLC bytecode. 
                            The WASM build of the runtime includes the compiler, simulator and unit tester. 
                            The embedded build of the runtime only includes the virtual machine which runs and was tested on the following devices: STM32 F1 F4 H7 G4 WB55, ESP8266, ESP32+C3 S3,
                            RP2040, RP2350, RA4M1.
                            It used to fit on the Arduino Nano but I need to reduce the extended instruction set for advanced PLC tasks to make it 
                            fit again and limit the compiler to avoid those instructions in tiny embedded devices.
                        </p>
                        <p style="margin: 0; color: #aaa; font-size: 11px; line-height: 1.6;">
                            The Editor provides deep insight into the device and program state. It's not yet professional-grade tooling 
                            — there are features missing and hidden bugs — but it's decent and getting better. 
                            Support for more text and graphical programming languages is coming soon.
                        </p>
                    </div>
                    
                    <!-- Footer -->
                    <div style="text-align: center; padding-top: 12px; border-top: 1px solid #333; color: #666; font-size: 10px;">
                        Licensed under GPL-3.0 • © 2024-2026 <a href="https://github.com/jozo132" target="_blank" style="color: #4682B4; text-decoration: none;">J.Vovk &lt;jozo132@gmail.com&gt;</a>
                    </div>
                </div>
            `,
        })
    }

    async _menuVersionHistory() {
        const cacheKey = 'vovkplc_commits_cache'
        const cacheDurationMinutes = 5

        const getCommitCount = async (username, repo, branch) => {
            const url = `https://api.github.com/repos/${username}/${repo}/commits?sha=${branch}&per_page=1&page=1`
            try {
                const response = await fetch(url)
                if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`)
                const linkHeader = response.headers.get('Link')
                if (!linkHeader) return 1
                const match = linkHeader.match(/&page=(\d+)>; rel="last"/)
                return match ? parseInt(match[1], 10) : 1
            } catch (error) {
                console.error('Error fetching commit count:', error)
                return 0
            }
        }

        const getCommits = async (username, repo, branch, limit = 10) => {
            const res = await fetch(`https://api.github.com/repos/${username}/${repo}/commits?sha=${branch}&per_page=${limit}`)
            const commits = await res.json()
            return commits
        }

        const formatCommits = (commits, total) => {
            if (!Array.isArray(commits)) return []
            return commits.map((c, i) => {
                const {commit, author, sha, html_url} = c
                const date = commit?.committer?.date || ''
                const message = commit?.message?.split('\n')[0] || '' // First line only
                const login = author?.login || 'unknown'
                const avatar = author?.avatar_url || ''
                const authorUrl = author?.html_url || '#'
                return {
                    index: total - i,
                    date: date.replace('T', ' ').replace('Z', '').slice(0, 16),
                    sha: sha?.substring(0, 7) || '',
                    shaUrl: html_url || '#',
                    login,
                    avatar,
                    authorUrl,
                    message,
                }
            })
        }

        const renderTable = (commits, loading = false, error = null) => {
            if (error) return `<div style="color: #f88; padding: 10px;">${error}</div>`
            if (loading) return `<div style="color: #888; padding: 10px;">Loading commits...</div>`
            if (!commits.length) return `<div style="color: #888; padding: 10px;">No commits found</div>`

            return `
                <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                    <thead>
                        <tr style="background: #151515; color: #888; text-align: left;">
                            <th style="padding: 6px 8px; width: 35px;">#</th>
                            <th style="padding: 6px 8px; width: 110px;">Date</th>
                            <th style="padding: 6px 8px; width: 70px;">Commit</th>
                            <th style="padding: 6px 8px; width: 100px;">Author</th>
                            <th style="padding: 6px 8px;">Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${commits
                            .map(
                                c => `
                            <tr style="border-bottom: 1px solid #333;">
                                <td style="padding: 5px 8px; color: #666;">${c.index}</td>
                                <td style="padding: 5px 8px; color: #aaa;">${c.date}</td>
                                <td style="padding: 5px 8px;"><a href="${c.shaUrl}" target="_blank" style="color: #4682B4; text-decoration: none;">${c.sha}</a></td>
                                <td style="padding: 5px 8px;">
                                    <a href="${c.authorUrl}" target="_blank" style="color: #ECECEC; text-decoration: none; display: flex; align-items: center; gap: 4px;">
                                        <img src="${c.avatar}" alt="${c.login}" style="width: 16px; height: 16px; border-radius: 50%;">
                                        <span style="color: #aaa;">${c.login}</span>
                                    </a>
                                </td>
                                <td style="padding: 5px 8px; color: #ECECEC; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;" title="${c.message.replace(/"/g, '&quot;')}">${c.message}</td>
                            </tr>
                        `,
                            )
                            .join('')}
                    </tbody>
                </table>
            `
        }

        // Show popup with loading state
        let runtimeCommits = []
        let editorCommits = []
        let runtimeTotal = 0
        let editorTotal = 0
        let runtimeError = null
        let editorError = null
        let loading = true

        const updateContent = () => `
            <div style="color: #ECECEC;">
                <div style="margin-bottom: 16px;">
                    <div style="color: #4682B4; font-weight: bold; margin-bottom: 8px; font-size: 12px;">⚙️ Runtime Changes (VovkPLCRuntime)</div>
                    <div style="background: #0d0d0d; border: 1px solid #555; border-radius: 6px; max-height: 200px; overflow-y: auto;">
                        ${renderTable(runtimeCommits, loading, runtimeError)}
                    </div>
                </div>
                <div>
                    <div style="color: #4682B4; font-weight: bold; margin-bottom: 8px; font-size: 12px;">📝 Editor Changes (VovkPLCEditor)</div>
                    <div style="background: #0d0d0d; border: 1px solid #555; border-radius: 6px; max-height: 200px; overflow-y: auto;">
                        ${renderTable(editorCommits, loading, editorError)}
                    </div>
                </div>
                <div style="text-align: center; margin-top: 12px; color: #555; font-size: 10px;">
                    Data cached for ${cacheDurationMinutes} minutes to avoid GitHub API rate limits
                </div>
            </div>
        `

        let closePopup = null
        const popup = new Popup({
            title: 'Change History',
            width: '800px',
            content: updateContent(),
            closeHandler: close => {
                closePopup = close
            },
        })

        // Check cache
        let useCache = false
        try {
            const cached = localStorage.getItem(cacheKey)
            if (cached) {
                const data = JSON.parse(cached)
                const age = (Date.now() - data.updated) / 1000 / 60
                if (age < cacheDurationMinutes) {
                    useCache = true
                    runtimeCommits = data.runtimeCommits || []
                    editorCommits = data.editorCommits || []
                    runtimeTotal = data.runtimeTotal || 0
                    editorTotal = data.editorTotal || 0
                    loading = false
                    popup.modal.querySelector('.plc-popup-content > div').innerHTML = updateContent()
                }
            }
        } catch (e) {
            console.warn('Failed to read commits cache:', e)
        }

        if (!useCache) {
            try {
                // Fetch both in parallel
                const [runtimeData, editorData, runtimeCount, editorCount] = await Promise.all([
                    getCommits('jozo132', 'VovkPLCRuntime', 'main', 10).catch(e => {
                        runtimeError = e.message
                        return []
                    }),
                    getCommits('jozo132', 'VovkPLCEditor', 'main', 10).catch(e => {
                        editorError = e.message
                        return []
                    }),
                    getCommitCount('jozo132', 'VovkPLCRuntime', 'main'),
                    getCommitCount('jozo132', 'VovkPLCEditor', 'main'),
                ])

                runtimeTotal = runtimeCount
                editorTotal = editorCount

                if (Array.isArray(runtimeData)) {
                    if (runtimeData.message) runtimeError = runtimeData.message
                    else runtimeCommits = formatCommits(runtimeData, runtimeTotal)
                }
                if (Array.isArray(editorData)) {
                    if (editorData.message) editorError = editorData.message
                    else editorCommits = formatCommits(editorData, editorTotal)
                }

                // Cache the results
                try {
                    localStorage.setItem(
                        cacheKey,
                        JSON.stringify({
                            updated: Date.now(),
                            runtimeCommits,
                            editorCommits,
                            runtimeTotal,
                            editorTotal,
                        }),
                    )
                } catch (e) {
                    console.warn('Failed to cache commits:', e)
                }
            } catch (e) {
                runtimeError = editorError = e.message
            }

            loading = false
            // Update popup content
            const contentDiv = popup.modal.querySelector('.plc-popup-content > div')
            if (contentDiv) contentDiv.innerHTML = updateContent()
        }
    }

    _menuNewProject() {
        const hasContent = this.#editor.project?.files?.some(f => f.type === 'program' && f.blocks?.length > 0)
        
        // Step 1: Ask to save current project if there's content
        const askToSave = () => {
            return new Promise(resolve => {
                if (!hasContent) {
                    resolve('dont_save')
                    return
                }
                
                new Popup({
                    title: 'Save Current Project?',
                    description: 'Do you want to save the current project before creating a new one?',
                    width: '400px',
                    buttons: [
                        { text: 'Save', value: 'save', background: '#1fba5f' },
                        { text: "Don't Save", value: 'dont_save', background: '#666' },
                        { text: 'Cancel', value: 'cancel', background: '#444' }
                    ],
                    onClose: value => resolve(value || 'cancel')
                })
            })
        }
        
        // Step 2: Ask for new project name
        const askProjectName = () => {
            return new Promise(resolve => {
                let projectName = 'New Project'
                let inputEl = null
                
                const content = document.createElement('div')
                content.innerHTML = `
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; color: #aaa; font-size: 11px; margin-bottom: 4px;">Project Name</label>
                        <input type="text" value="New Project" style="
                            width: 100%;
                            padding: 8px 10px;
                            background: #2a2a2a;
                            border: 1px solid #444;
                            border-radius: 4px;
                            color: #fff;
                            font-size: 13px;
                            outline: none;
                            box-sizing: border-box;
                        " />
                    </div>
                `
                inputEl = content.querySelector('input')
                inputEl.addEventListener('input', e => {
                    projectName = e.target.value.trim() || 'New Project'
                })
                
                new Popup({
                    title: 'New Project',
                    width: '350px',
                    content: content,
                    buttons: [
                        { text: 'Create', value: 'create', background: '#1fba5f' },
                        { text: 'Cancel', value: 'cancel', background: '#444' }
                    ],
                    onOpen: () => {
                        setTimeout(() => {
                            inputEl?.focus()
                            inputEl?.select()
                        }, 50)
                    },
                    onClose: value => {
                        if (value === 'create') {
                            resolve(projectName)
                        } else {
                            resolve(null)
                        }
                    }
                })
            })
        }
        
        // Execute the flow
        const executeNewProject = async () => {
            // Step 1: Ask to save
            const saveChoice = await askToSave()
            if (saveChoice === 'cancel') return
            
            if (saveChoice === 'save') {
                // Trigger save
                this._menuSaveProject()
            }
            
            // Step 2: Ask for project name
            const projectName = await askProjectName()
            if (!projectName) return  // User cancelled
            
            // Step 3: Create the new project
            this._createFreshProject(projectName)
        }
        
        executeNewProject()
    }
    
    _createFreshProject(projectName = 'New Project') {
        // Close all open tabs and their editor hosts
        if (this.tab_manager) {
            const tabIds = [...this.tab_manager.tabs.keys()]
            tabIds.forEach(id => {
                const tab = this.tab_manager.tabs.get(id)
                if (tab) {
                    if (tab.host) tab.host.close()
                    if (tab.tabEl) tab.tabEl.remove()
                }
            })
            this.tab_manager.tabs.clear()
            this.tab_manager.active = null
        }

        // Clear windows map (symbols, setup, memory windows)
        if (this.windows) {
            this.windows.forEach((win, key) => {
                if (win && typeof win.close === 'function') win.close()
            })
            this.windows.clear()
        }

        // Reset editor state
        this.#editor.active_tab = null
        this.#editor.active_program = null
        this.#editor.reserved_ids = []

        // Clear navigation tree
        if (this.tree_manager) {
            this.tree_manager.root = []
            this.tree_manager.minimized_folders = {}
            this.tree_manager.state.selected = null
            this.tree_manager.state.focused = null
        }

        // Get runtime info for default project settings (WASM simulator)
        const runtimeInfo = this.#editor.runtime_info || {}
        
        // Create a fresh empty project with WASM simulator defaults
        const freshProject = {
            info: {
                name: projectName,
                version: '1.0.0',
                author: '',
                description: '',
                type: runtimeInfo.device || 'Simulator',
                arch: runtimeInfo.arch || 'WASM',
                capacity: runtimeInfo.program || 104857
            },
            offsets: {
                system: { offset: runtimeInfo.system_offset ?? 0, size: runtimeInfo.system_size ?? 64 },
                input: { offset: runtimeInfo.input_offset ?? 64, size: runtimeInfo.input_size ?? 64 },
                output: { offset: runtimeInfo.output_offset ?? 128, size: runtimeInfo.output_size ?? 64 },
                marker: { offset: runtimeInfo.marker_offset ?? 192, size: runtimeInfo.marker_size ?? 256 },
                timer: { offset: runtimeInfo.timer_offset ?? 448, size: (runtimeInfo.timer_count ?? 16) * (runtimeInfo.timer_struct_size ?? 9) },
                counter: { offset: runtimeInfo.counter_offset ?? 592, size: (runtimeInfo.counter_count ?? 16) * (runtimeInfo.counter_struct_size ?? 5) }
            },
            symbols: [],           // Will be populated with system symbols by ensureSystemSymbols
            device_symbols: [],    // Clear device symbols
            folders: [],
            files: [
                {
                    id: null,      // Will be generated
                    path: '/',
                    type: 'program',
                    name: 'main',
                    full_path: '/main',
                    comment: 'Main program',
                    blocks: []
                }
            ],
            watch: [],
            lastPhysicalDevice: null,  // Clear stored device info
            _ui_state: null            // Clear UI state
        }

        // Clear project-specific localStorage items (but NOT paired devices)
        localStorage.removeItem('vovk_plc_project_autosave')
        localStorage.removeItem('vovk_plc_symbols_collapsed')
        localStorage.removeItem('vovk_plc_watch_values')
        // Keep these as they are user preferences, not project-specific:
        // - vovk_plc_layout
        // - vovk_plc_outer_layout
        // - vovk_plc_memory_display_mode
        // - vovk_plc_monitoring_active

        // Load the fresh project
        this.#editor.openProject(freshProject)

        // Reset project manager state
        if (this.#editor.project_manager) {
            this.#editor.project_manager.last_saved_state = ''
        }

        // Open the main program
        const mainFile = this.#editor.project?.files?.find(f => f.name === 'main')
        if (mainFile && mainFile.id) {
            this.openProgram(mainFile.id)
        }

        // Reset device info display (but keep paired devices)
        if (this.device_info) {
            this.device_info.innerHTML = `
                <div style="display: flex; align-items: flex-start; gap: 8px;">
                    <div style="flex: 1; min-width: 0;">
                        <div class="device-name" style="color: #888;">No device</div>
                        <div class="device-meta" style="color: #666;">Connect to a device to go online</div>
                    </div>
                    <button class="plc-device-details-btn" title="Device Details" style="background: #2a2a2a; border: 1px solid #444; color: #666; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                </div>
            `
            const detailsBtn = this.device_info.querySelector('.plc-device-details-btn')
            if (detailsBtn) {
                detailsBtn.addEventListener('click', () => this._showDeviceDetails())
            }
        }

        // Clear console
        if (this.console) {
            this.console.innerHTML = ''
        }

        // Refresh the watch panel with empty entries
        if (this.watch_panel && typeof this.watch_panel.setEntries === 'function') {
            this.watch_panel.setEntries([])
        }

        // Clear problems panel
        if (this._problemsContent) {
            this._problemsContent.innerHTML = ''
        }
        this._problemsFlat = []
        this._problemsByHoverKey = new Map()

        this.logToConsole?.(`Created new project: ${projectName}`, 'success')
    }

    _menuOpenProject() {
        // Create file input to select project file
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,.vovkplc,.project'
        input.style.display = 'none'

        input.addEventListener('change', async e => {
            const file = input.files?.[0]
            if (!file) return

            try {
                const text = await file.text()
                
                // Close all existing tabs and windows before loading new project
                this.tab_manager?.closeAllTabs()
                
                // Detect format based on content
                const trimmed = text.trim()
                
                if (trimmed.startsWith('VOVKPLCPROJECT')) {
                    // New portable text format
                    const project = this.#editor.project_manager.parseProjectText(text)
                    this.#editor.project_manager.ensureSystemSymbols(project)
                    this.#editor.project_manager.load(project)
                    this.#editor.project_manager.last_saved_state = ''
                    this.#editor.project_manager.checkAndSave()
                    
                    // Restore open tabs and active tab
                    // Tabs are stored as full_path (e.g. "main") or special window names (e.g. "symbols")
                    const specialWindows = ['symbols', 'setup', 'memory', 'datablocks']
                    const resolveTabId = (tabPath) => {
                        if (specialWindows.includes(tabPath) || tabPath.startsWith('db:')) return tabPath
                        // Find program by full_path
                        const fullPath = tabPath.startsWith('/') ? tabPath : '/' + tabPath
                        const program = project.files?.find(f => f.full_path === fullPath)
                        return program?.id || null
                    }
                    
                    if (project._ui_state?.openTabs?.length > 0) {
                        for (const tabPath of project._ui_state.openTabs) {
                            try {
                                const tabId = resolveTabId(tabPath)
                                if (tabId) {
                                    this.tab_manager?.addLazyTab(tabId)
                                }
                            } catch (e) {
                                console.warn('Could not restore tab:', tabPath, e)
                            }
                        }
                        // Switch to active tab if specified
                        if (project._ui_state.activeTab) {
                            try {
                                const activeId = resolveTabId(project._ui_state.activeTab)
                                if (activeId) {
                                    this.tab_manager?.switchTo(activeId)
                                }
                            } catch (e) {
                                console.warn('Could not switch to active tab:', project._ui_state.activeTab, e)
                            }
                        }
                    }
                    
                    this.logToConsole?.(`Imported project "${project.info?.name || 'Untitled'}" from ${file.name}`, 'success')
                } else if (trimmed.startsWith('{')) {
                    // Legacy JSON format
                    const project = JSON.parse(text)
                    if (!project || typeof project !== 'object') {
                        throw new Error('Invalid project file format')
                    }
                    this.#editor.project_manager.ensureSystemSymbols(project)
                    this.#editor.project_manager.load(project)
                    this.#editor.project_manager.last_saved_state = ''
                    this.#editor.project_manager.checkAndSave()
                    this.logToConsole?.(`Opened project from ${file.name}`, 'success')
                } else {
                    throw new Error('Unknown project file format')
                }
            } catch (err) {
                console.error('Failed to open project:', err)
                this.logToConsole?.(`Failed to open project: ${err.message}`, 'error')
                alert(`Failed to open project: ${err.message}`)
            }

            input.remove()
        })

        document.body.appendChild(input)
        input.click()
    }

    _menuExportProject() {
        try {
            // Force save current state
            this.#editor.project_manager.collectProjectState()

            // Build the portable VOVKPLCPROJECT format
            const projectText = this.#editor.project_manager.buildExportText()
            
            // Create filename from project info
            const project = this.#editor.project
            const projectName = (project.info?.name || 'project').replace(/[<>:"/\\|?*\s]+/g, '_')
            const projectVersion = (project.info?.version || '').replace(/[<>:"/\\|?*\s]+/g, '_')
            const timestamp = new Date().toISOString().slice(0, 10)
            const filename = projectVersion 
                ? `${projectName}_v${projectVersion}_${timestamp}.vovkplc`
                : `${projectName}_${timestamp}.vovkplc`

            // Create and download file
            const blob = new Blob([projectText], {type: 'text/plain'})
            const url = URL.createObjectURL(blob)

            const a = document.createElement('a')
            a.href = url
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)

            this.logToConsole?.(`Exported project to ${filename}`, 'success')
        } catch (err) {
            console.error('Failed to export project:', err)
            this.logToConsole?.(`Failed to export project: ${err.message}`, 'error')
        }
    }

    async _menuProjectProperties() {
        const project = this.#editor.project
        const info = project.info || {}

        const result = await Popup.form({
            title: 'Project Properties',
            width: '450px',
            buttons: [
                {text: 'Save', value: 'confirm', background: '#007acc', color: 'white'},
                {text: 'Cancel', value: 'cancel'},
            ],
            inputs: [
                {
                    name: 'name',
                    label: 'Project Title',
                    type: 'text',
                    value: info.name || '',
                    placeholder: 'My PLC Project',
                },
                {
                    name: 'version',
                    label: 'Version',
                    type: 'text',
                    value: info.version || '0.0.0',
                    placeholder: '0.0.0',
                },
                {
                    name: 'author',
                    label: 'Author',
                    type: 'text',
                    value: info.author || '',
                    placeholder: 'Your name',
                },
                {
                    name: 'description',
                    label: 'Description',
                    type: 'textarea',
                    value: info.description || '',
                    placeholder: 'Enter project description...',
                    rows: 4,
                },
            ],
        })

        if (!result) return

        // Update project info
        project.info = project.info || {}
        project.info.name = result.name?.trim() || ''
        project.info.version = result.version?.trim() || '0.0.0'
        project.info.author = result.author?.trim() || ''
        project.info.description = result.description?.trim() || ''

        // Trigger save
        this.#editor.project_manager.save()

        // Update tree title and page title
        this.tree_manager.draw_navigation_tree()
        this.updatePageTitle()

        this.logToConsole?.(`Project properties updated`, 'success')
    }

    /** Update the browser page title based on project name */
    updatePageTitle() {
        const projectName = this.#editor.project?.info?.name
        if (projectName) {
            document.title = `${projectName} - VovkPLC Editor`
        } else {
            document.title = 'VovkPLC Editor'
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

        // Initialize menu bar
        this._initializeMenuBar()

        // Set page title based on project name
        this.updatePageTitle()

        // Show disclaimer on first visit
        this._checkDisclaimerAcceptance()

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

        // Restore connection mode and device selection
        if (project.connectionMode) {
            this.connectionMode = project.connectionMode
            if (this.modeSelect) {
                this.modeSelect.value = this.connectionMode
            }
            if (this.newDeviceBtn) {
                this.newDeviceBtn.style.display = 'none' // Moved to dropdown
            }
            if (this.deviceSelectContainer) {
                this.deviceSelectContainer.style.display = this.connectionMode === 'serial' ? 'block' : 'none'
            }
            if (this.simulationLabel) {
                this.simulationLabel.style.display = this.connectionMode === 'simulation' ? 'flex' : 'none'
            }

            // Ensure polling state matches mode
            if (this.connectionMode === 'serial') {
                if (!this.serialDevicePollingTimer) this._startSerialPolling()
            } else {
                if (this.serialDevicePollingTimer) this._stopSerialPolling()
            }
        }

        if (project.selectedDevice) {
            this.selectedDeviceValue = project.selectedDevice

            // Validate selection against mode
            if (this.connectionMode === 'serial' && this.selectedDeviceValue === '_simulation') {
                this.selectedDeviceValue = null
            } else if (this.connectionMode === 'simulation' && this.selectedDeviceValue !== '_simulation') {
                this.selectedDeviceValue = '_simulation'
            }
        }

        this.tree_manager.draw_navigation_tree(true)
        // this.tab_manager.draw_tabs()
        this.refreshDeviceOptions()
        // this.#editor.draw()

        // Load Watch Items from project
        if (this.watch_panel) {
            try {
                const items = project?.watch || []
                if (Array.isArray(items) && items.length > 0) {
                    this.watch_panel.setEntries(items)
                } else if (typeof this.watch_panel.refresh === 'function') {
                    this.watch_panel.refresh()
                }
            } catch (e) {
                console.warn('Failed to load watch items', e)
            }
        }

        // Show stored device info if available and not connected
        if (!this.#editor.device_manager?.connected && project.lastPhysicalDevice?.deviceInfo) {
            const info = project.lastPhysicalDevice.deviceInfo
            if (this.device_info) {
                this.device_info.innerHTML = `
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                        <div style="flex: 1; min-width: 0;">
                            <div class="device-name" style="color: #888;">${info.device || 'Unknown Device'} <span style="font-size: 9px; color: #666;">(stored)</span></div>
                            <div class="device-meta" style="color: #666;">${info.arch} ${info.version ? 'v' + info.version : ''}</div>
                        </div>
                        <button class="plc-device-details-btn" title="View stored device details" style="background: #2a2a2a; border: 1px solid #444; color: #888; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                    </div>
                `
                const detailsBtn = this.device_info.querySelector('.plc-device-details-btn')
                if (detailsBtn) {
                    detailsBtn.addEventListener('click', () => this._showDeviceDetails())
                }
            }
        } else if (!this.#editor.device_manager?.connected && this.device_info) {
            // No stored data, not connected - still show Details button
            this.device_info.innerHTML = `
                <div style="display: flex; align-items: flex-start; gap: 8px;">
                    <div style="flex: 1; min-width: 0;">
                        <div class="device-name" style="color: #888;">No device connected</div>
                        <div class="device-meta" style="color: #666;">Use the button below to connect</div>
                    </div>
                    <button class="plc-device-details-btn" title="Device Details" style="background: #2a2a2a; border: 1px solid #444; color: #666; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                </div>
            `
            const noStoredDetailsBtn = this.device_info.querySelector('.plc-device-details-btn')
            if (noStoredDetailsBtn) {
                noStoredDetailsBtn.addEventListener('click', () => this._showDeviceDetails())
            }
        }

        // Compile project to generate IR data and scan for patchable constants
        // Wait for runtime to fully initialize and warmup to complete
        setTimeout(async () => {
            if (!this.#editor?.runtime_ready) {
                console.log('[WindowManager] Runtime not ready yet, waiting...')
                return
            }

            try {
                console.log('[WindowManager] Running automatic compilation for IR scan...')
                const success = await this.handleCompile({silent: true})
                console.log('[WindowManager] Automatic compilation result:', success)
            } catch (err) {
                console.warn('Failed to compile on project load:', err)
            }
        }, 3000)

        // Open main program for fresh projects (no UI state to restore)
        if (project.files && !project._ui_state) {
            const main = project.files.find(f => f.name === 'main' && f.path === '/' && f.type === 'program')
            if (main && main.id) this.openProgram(main.id)
        }
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
        } else if (id === 'datablocks') {
            editorUI = new DataBlocksUI(this.#editor)
        } else if (id.startsWith('db:')) {
            const dbNumber = parseInt(id.split(':')[1])
            editorUI = new DataBlockUI(this.#editor, dbNumber)
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
        if (id === 'symbols' || id === 'datablocks' || id.startsWith('db:')) {
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

    async _updateFooterVersionTooltip(el, show = false) {
        if (!el) return

        let runtimeInfo = '<span style="color: #888;">Loading runtime info...</span>'
        let deviceSection = ''
        const showTooltip = () => {
            if (this.footerTooltip && show) {
                const rect = el.getBoundingClientRect()
                const editorSection = `<div style="font-size:10px; color:#666; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Editor</div>`
                const editorInfo = `<div style="font-weight:600; color:#fff; margin-bottom:4px;">VovkPLC Editor</div><div style="color:#aaa;">Version: ${VOVKPLCEDITOR_VERSION} Build ${VOVKPLCEDITOR_VERSION_BUILD}</div>`
                this.footerTooltip.innerHTML = `${editorSection}${editorInfo}<div style="margin-top:8px;">${runtimeInfo}</div>${deviceSection}`
                this.footerTooltip.style.left = rect.left + 'px'
                this.footerTooltip.style.bottom = window.innerHeight - rect.top + 'px'
                this.footerTooltip.style.display = 'block'
            }
        }

        if (show) showTooltip()

        // Runtime info should always show the WASM compiler version (used for compiling)
        // Device info is shown separately if connected to a physical device
        const cachedInfo = this.#editor?.runtime_info
        const deviceInfo = this.#editor?.device_manager?.deviceInfo

        // Always show WASM compiler runtime info first
        if (cachedInfo && cachedInfo.version) {
            runtimeInfo = `<div style="font-weight:600; color:#fff; margin-bottom:4px;">VovkPLC Runtime <span style="font-weight:400; font-size:11px; color:#888;">(compiler and simulator)</span></div><div style="color:#aaa;">Version: ${cachedInfo.version}${cachedInfo.arch ? `<br>Arch: ${cachedInfo.arch}` : ''}</div>`
        } else if (this.#editor && this.#editor.runtime && this.#editor.runtime_ready) {
            try {
                const info = this.#editor.runtime.printInfo()
                if (info && info.version) {
                    runtimeInfo = `<div style="font-weight:600; color:#fff; margin-bottom:4px;">VovkPLC Runtime <span style="font-weight:400; font-size:11px; color:#888;">(compiler and simulator)</span></div><div style="color:#aaa;">Version: ${info.version}${info.arch ? `<br>Arch: ${info.arch}` : ''}</div>`
                } else if (typeof info === 'string' && info !== 'No info available') {
                    runtimeInfo = `<div style="font-weight:600; color:#fff;">VovkPLC Runtime <span style="font-weight:400; font-size:11px; color:#888;">(compiler and simulator)</span></div><div style="color:#aaa;">${info}</div>`
                } else {
                    runtimeInfo = `<div style="font-weight:600; color:#fff;">VovkPLC Runtime <span style="font-weight:400; font-size:11px; color:#888;">(compiler and simulator)</span></div><div style="color:#aaa;">Ready</div>`
                }
            } catch (e) {
                runtimeInfo = `<div style="font-weight:600; color:#fff;">VovkPLC Runtime <span style="font-weight:400; font-size:11px; color:#888;">(compiler and simulator)</span></div><div style="color:#d44;">Offline</div>`
            }
        } else if (this.#editor && this.#editor.runtime) {
            runtimeInfo = `<div style="font-weight:600; color:#fff;">VovkPLC Runtime <span style="font-weight:400; font-size:11px; color:#888;">(compiler and simulator)</span></div><div style="color:#888;">Initializing...</div>`
        } else {
            runtimeInfo = `<div style="font-weight:600; color:#fff;">VovkPLC Runtime <span style="font-weight:400; font-size:11px; color:#888;">(compiler and simulator)</span></div><div style="color:#888;">Not initialized</div>`
        }

        // Add connected device info if available (separate from compiler info)
        if (deviceInfo && deviceInfo.version) {
            const deviceName = deviceInfo.device || 'Unknown Device'
            deviceSection = `<hr style="border:0; border-top:1px solid #333; margin:8px 0;"><div style="font-size:10px; color:#666; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Connected device</div><div style="font-weight:600; color:#fff; margin-bottom:4px;">${deviceName}</div><div style="color:#aaa;">Version: ${deviceInfo.version}${deviceInfo.arch ? `<br>Arch: ${deviceInfo.arch}` : ''}</div>`
        }

        if (show && this.footerTooltip && this.footerTooltip.style.display !== 'none') {
            showTooltip()
        }
    }

    isMonitoringAvailable() {
        return !!this._monitoringAvailable
    }

    setMonitoringActive(active = false) {
        const next = !!active
        if (this._monitoringActive === next) return
        this._monitoringActive = next

        // Save state to localStorage
        try {
            localStorage.setItem('vovk_plc_monitoring_active', JSON.stringify(next))
        } catch (e) {
            console.warn('Failed to save monitoring state', e)
        }

        // Clear ALL render caches when toggling monitor mode to force fresh pill generation
        const editor = this.#editor
        if (editor?.project_manager?.project?.blocks) {
            for (const block of editor.project_manager.project.blocks) {
                block.cached_checksum = null
                block.cached_asm = null
                block.cached_asm_map = null
                block.cached_symbol_refs = null
                block.cached_address_refs = null
                block.cached_timer_refs = null
                block.cached_symbols_checksum = null
            }
        }

        // Don't auto-lock when monitoring starts - let user control lock explicitly

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

    toggleLiveEdit(enabled) {
        if (enabled !== undefined) {
            this._liveEditEnabled = !!enabled
        } else {
            this._liveEditEnabled = !this._liveEditEnabled
        }

        for (const win of this.windows.values()) {
            // Let updateLiveMonitorState handle the UI updates via setEditLock and other mechanisms
        }

        this.updateLiveMonitorState()
    }

    updateMonitoringAvailability(available = false) {
        this._monitoringAvailable = !!available
        for (const win of this.windows.values()) {
            if (win && typeof win.updateMonitoringAvailability === 'function') {
                win.updateMonitoringAvailability(this._monitoringAvailable)
            }
        }
    }

    /**
     * Forward device DataBlock info to any open DataBlocksUI windows
     * @param {{ slots: number, active: number, table_offset: number, free_space: number, lowest_address: number, entries: Array<{ db: number, offset: number, size: number }> }} dbInfo
     */
    notifyDataBlockInfo(dbInfo) {
        for (const win of this.windows.values()) {
            if (win && typeof win.receiveDeviceDBInfo === 'function') {
                win.receiveDeviceDBInfo(dbInfo)
            }
        }
    }

    /**
     * Forward compiled datablock declarations to any open DataBlocksUI/DataBlockUI windows
     * These contain the absolute memory offsets computed by the compiler
     * @param {{ db_number: number, alias: string, totalSize: number, computedOffset: number, fields: { name: string, typeName: string, typeSize: number, offset: number, hasDefault: boolean, defaultValue: number }[] }[]} decls
     */
    notifyCompiledDatablocks(decls) {
        for (const win of this.windows.values()) {
            if (win && typeof win.receiveCompiledDatablocks === 'function') {
                win.receiveCompiledDatablocks(decls)
            }
        }
    }

    updateLiveMonitorState() {
        const editor = this.#editor
        const connected = !!editor?.device_manager?.connected
        const monitoring = this._monitoringActive
        const shouldMonitor = !!connected && monitoring

        // Locking Logic:
        // Unlock editing when Connected (Online), but Lock when Monitoring.
        // If Live Edit is enabled, we force unlock.
        // User Request: Remove the option to unlock code editng in live monitor mode.
        // So we strictly lock when monitoring is active, ignoring liveEditEnabled for code editing.
        const isLocked = shouldMonitor // && !this._liveEditEnabled
        if (this._edit_lock_state !== isLocked) {
            this._edit_lock_state = isLocked
            if (typeof editor.setEditLock === 'function') {
                editor.setEditLock(isLocked)
            }
        }

        // Notify all windows about monitoring state (which updates the lock button visibility)
        for (const win of this.windows.values()) {
            if (win && typeof win.updateMonitoringState === 'function') {
                win.updateMonitoringState(monitoring)
            }
            if (win && typeof win.updateLiveEditState === 'function') {
                win.updateLiveEditState(this._liveEditEnabled)
            }
        }

        // Notify WatchPanel and MemoryUI
        const watchPanelInstance = this._getWatchPanelInstance()
        if (watchPanelInstance && typeof watchPanelInstance.setMonitoringState === 'function') {
            watchPanelInstance.setMonitoringState(shouldMonitor)
        }

        const memoryWin = this.windows.get('memory')
        if (memoryWin && typeof memoryWin.setMonitoringState === 'function') {
            memoryWin.setMonitoringState(shouldMonitor)
        }

        const datablocksWin = this.windows.get('datablocks')
        if (datablocksWin && typeof datablocksWin.updateMonitoringState === 'function') {
            datablocksWin.updateMonitoringState(monitoring)
        }

        if (shouldMonitor) {
            if (this.data_fetcher && !this.data_fetcher.fetching) this.data_fetcher.start()
            this._startLiveMemoryMonitor()
            if (editor && typeof editor.setMonitoringDimmed === 'function') {
                editor.setMonitoringDimmed(false)
            }
            // Enable visual feedback for monitoring
            if (editor && typeof editor.setMonitoringVisuals === 'function') {
                editor.setMonitoringVisuals(true)
            }
            this.setHealthDimmed(false)
            this._pollDeviceHealth()

            // Refresh all editor values
            if (editor.project && editor.project.files) {
                editor.project.files.forEach(file => {
                    if (file.blocks) {
                        file.blocks.forEach(block => {
                            if (block.props && block.props.text_editor && typeof block.props.text_editor.refreshLive === 'function') {
                                block.props.text_editor.refreshLive()
                            }
                        })
                    }
                })
            }
        } else {
            if (this.data_fetcher && this.data_fetcher.fetching) this.data_fetcher.stop()
            if (editor && typeof editor.setMonitoringDimmed === 'function') {
                editor.setMonitoringDimmed(true)
            }
            if (editor && typeof editor.setMonitoringVisuals === 'function') {
                editor.setMonitoringVisuals(false)
            }
            this.setHealthDimmed(true)

            // Refresh all editor values to hide pills when monitoring stops
            if (editor.project && editor.project.files) {
                editor.project.files.forEach(file => {
                    if (file.blocks) {
                        file.blocks.forEach(block => {
                            if (block.props && block.props.text_editor && typeof block.props.text_editor.refreshLive === 'function') {
                                block.props.text_editor.refreshLive()
                            }
                        })
                    }
                })
            }
        }
    }

    // Helper to find watch panel instance (since we didn't save it)
    _getWatchPanelInstance() {
        // It might be attached to the DOM element property if we were using web components, but we are not.
        // We should have saved it in constructor.
        // Let's assume we can fix constructor to save it.
        return this.watch_panel
    }

    _startLiveMemoryMonitor() {
        if (this._codeMonitorRegistered) return
        this._updateCodeMonitorRegistrations()
        this._codeMonitorRegistered = true
    }

    _stopLiveMemoryMonitor() {
        if (!this._codeMonitorRegistered) return
        this.data_fetcher.unregisterAll('code-monitor')
        this._codeMonitorRegistered = false
        const editor = this.#editor
        if (editor && editor.live_symbol_values) {
            editor.live_symbol_values.clear()
        }
        const symbols = this.windows.get('symbols')
        if (symbols && typeof symbols.updateLiveValues === 'function') {
            symbols.updateLiveValues(new Map())
        }
        const datablocks = this.windows.get('datablocks')
        if (datablocks && typeof datablocks.updateLiveValues === 'function') {
            datablocks.updateLiveValues(new Map())
        }
    }

    _updateCodeMonitorRegistrations() {
        const editor = this.#editor
        if (!editor?.device_manager?.connected) return

        const projectSymbols = editor.project?.symbols || []
        const offsets = ensureOffsets(editor.project?.offsets || {})
        const addressRefs = typeof editor._getAsmAddressRefsForLive === 'function' ? editor._getAsmAddressRefsForLive(offsets) : []
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
        const memoryLimit = Number.isFinite(memoryLimitValue) && memoryLimitValue > 0 ? memoryLimitValue : null

        const groups = new Map()
        const typeSizes = {
            bit: 1,
            byte: 1,
            u8: 1,
            i8: 1,
            int: 2,
            u16: 2,
            i16: 2,
            word: 2,
            dint: 4,
            u32: 4,
            i32: 4,
            real: 4,
            float: 4,
            f32: 4,
            dword: 4,
            u64: 8,
            i64: 8,
            f64: 8,
            lword: 8,
        }
        const normalizeAddress = symbol => {
            // If absoluteAddress is present, use it directly (refs from code)
            if (typeof symbol.absoluteAddress === 'number') {
                const explicitBit = typeof symbol?.bit === 'number' ? symbol.bit : null
                if (symbol.type === 'bit' || explicitBit !== null) {
                    return {absolute: symbol.absoluteAddress, bit: explicitBit, size: 1}
                }
                const size = typeSizes[symbol?.type] || 1
                return {absolute: symbol.absoluteAddress, bit: null, size}
            }

            const locationKey = symbol?.location === 'memory' ? null : symbol?.location
            const baseOffset = locationKey && offsets[locationKey] ? offsets[locationKey].offset || 0 : 0
            const addrVal = parseFloat(symbol?.address) || 0
            const explicitBit = typeof symbol?.bit === 'number' ? symbol.bit : null
            // Timer uses 9 bytes per unit, Counter uses 5 bytes per unit
            const structSize = locationKey === 'timer' ? 9 : locationKey === 'counter' ? 5 : 1

            if (symbol?.type === 'bit' || explicitBit !== null) {
                const byte = Math.floor(addrVal)
                const bit = explicitBit !== null ? explicitBit : Math.round((addrVal - byte) * 10)
                return {absolute: baseOffset + byte * structSize, bit, size: 1}
            }
            const size = typeSizes[symbol?.type] || 1
            return {absolute: baseOffset + Math.floor(addrVal) * structSize, bit: null, size}
        }

        symbolEntries.forEach(symbol => {
            if (!symbol || !symbol.name) return
            const layout = normalizeAddress(symbol)
            const end = layout.absolute + layout.size
            const key = (symbol.location === 'memory' ? 'marker' : symbol.location) || 'marker'
            if (!groups.has(key)) {
                groups.set(key, {min: layout.absolute, max: end, items: []})
            }
            const group = groups.get(key)
            group.min = Math.min(group.min, layout.absolute)
            group.max = Math.max(group.max, end)
            group.items.push({symbol, layout})
        })

        // Unregister any previous
        this.data_fetcher.unregisterAll('code-monitor')
        if (!editor.live_symbol_values) editor.live_symbol_values = new Map()

        for (const group of groups.values()) {
            const readStart = Math.max(0, group.min)
            const readEnd = memoryLimit !== null ? Math.min(group.max, memoryLimit) : group.max
            const size = Math.max(0, readEnd - readStart)
            if (!size) continue

            this.data_fetcher.register('code-monitor', readStart, size, data => {
                this._processMonitorData(data, readStart, group.items)
            })
        }
    }

    _processMonitorData(raw, readStart, items) {
        const editor = this.#editor
        let bytes = null
        if (raw instanceof Uint8Array) {
            bytes = raw
        } else if (Array.isArray(raw)) {
            bytes = Uint8Array.from(raw)
        } else if (raw && raw.buffer) {
            bytes = new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength || raw.length || 0)
        } // Missing else if raw is null?

        if (!bytes || !bytes.length) return
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const liveValues = editor.live_symbol_values || new Map()
        
        // Get device endianness (default to little-endian if unknown)
        const isLittleEndian = editor.device_manager?.deviceInfo?.isLittleEndian ?? true

        items.forEach(({symbol, layout}) => {
            const offset = layout.absolute - readStart
            const type = symbol.type || 'byte'
            let value = null
            let text = '-'

            if (offset < 0 || offset >= bytes.length) {
                // Do not overwrite with null if partial update fails for some reason,
                // but actually if offset is out of bounds of *this* chunk, it shouldn't happen
                // because we registered based on items range.
                return
            }

            // Check end bound - for strings, just need the header
            const isStringType = ['str8', 'cstr8', 'str16', 'cstr16'].includes(type)
            const size = isStringType ? (type === 'str8' || type === 'cstr8' ? 2 : 4) :
                ['bit', 'byte', 'u8', 'i8'].includes(type) || type === 'bit' || type === 'byte' ? 1 : 
                ['int', 'u16', 'i16', 'word'].includes(type) || type === 'int' ? 2 : 
                ['dint', 'u32', 'i32', 'real', 'float', 'f32', 'dword'].includes(type) || type === 'dint' || type === 'real' ? 4 : 
                ['u64', 'i64', 'f64', 'lword'].includes(type) ? 8 : 1

            if (offset + size > bytes.length) return

            if (type === 'bit') {
                const byteVal = bytes[offset]
                const bit = layout.bit || 0
                value = (byteVal >> bit) & 1
                text = value ? 'ON' : 'OFF'
            } else if (type === 'byte' || type === 'u8') {
                value = bytes[offset]
                text = String(value)
            } else if (type === 'i8') {
                value = view.getInt8(offset)
                text = String(value)
            } else if (type === 'int' || type === 'i16') {
                value = view.getInt16(offset, isLittleEndian)
                text = String(value)
            } else if (type === 'u16') {
                value = view.getUint16(offset, isLittleEndian)
                text = String(value)
            } else if (type === 'dint' || type === 'i32') {
                value = view.getInt32(offset, isLittleEndian)
                text = String(value)
            } else if (type === 'u32' || type === 'dword') {
                value = view.getUint32(offset, isLittleEndian)
                text = String(value)
            } else if (type === 'real' || type === 'float' || type === 'f32') {
                value = view.getFloat32(offset, isLittleEndian)
                text = Number.isFinite(value) ? value.toFixed(3) : String(value)
            } else if (type === 'f64') {
                value = view.getFloat64(offset, isLittleEndian)
                text = Number.isFinite(value) ? value.toFixed(3) : String(value)
            } else if (type === 'u64' || type === 'i64' || type === 'lword') {
                try {
                    value = type === 'u64' || type === 'lword' ? view.getBigUint64(offset, isLittleEndian) : view.getBigInt64(offset, isLittleEndian)
                    text = String(value)
                } catch (e) {
                    /* fallback */ value = 0n
                    text = '0'
                }
            } else if (type === 'str8' || type === 'cstr8') {
                // str8 format: [capacity:u8, length:u8, data...]
                if (offset + 2 <= bytes.length) {
                    const capacity = bytes[offset]
                    const length = Math.min(bytes[offset + 1], capacity, bytes.length - offset - 2)
                    const strBytes = bytes.slice(offset + 2, offset + 2 + length)
                    try {
                        value = new TextDecoder('utf-8', { fatal: false }).decode(strBytes)
                    } catch {
                        value = String.fromCharCode(...strBytes)
                    }
                    text = `"${value}"`
                }
            } else if (type === 'str16' || type === 'cstr16') {
                // str16 format: [capacity:u16, length:u16, data...]
                if (offset + 4 <= bytes.length) {
                    const capacity = view.getUint16(offset, isLittleEndian)
                    const length = Math.min(view.getUint16(offset + 2, isLittleEndian), capacity, bytes.length - offset - 4)
                    const strBytes = bytes.slice(offset + 4, offset + 4 + length)
                    try {
                        value = new TextDecoder('utf-8', { fatal: false }).decode(strBytes)
                    } catch {
                        value = String.fromCharCode(...strBytes)
                    }
                    text = `"${value}"`
                }
            } else {
                value = bytes[offset]
                text = String(value)
            }
            liveValues.set(symbol.name, {
                value,
                text,
                type,
                absoluteAddress: layout.absolute,
                timestamp: Date.now(),
            })
        })

        editor.live_symbol_values = liveValues // Ensure reference
        const symbolsUI = this.windows.get('symbols')
        if (symbolsUI && typeof symbolsUI.updateLiveValues === 'function') {
            symbolsUI.updateLiveValues(liveValues)
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
                if (block) return {program, block}
            }
            const programs = editor._getLintPrograms?.() || []
            for (const prog of programs) {
                const block = prog?.blocks?.find(b => b.id === entry.blockId)
                if (block) return {program: prog, block}
            }
            return {program: null, block: null}
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
                blockDiv.scrollIntoView({block: 'center'})
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
            let {program, block} = findTarget()
            if (!block) return

            if (program?.id) {
                this.openProgram(program.id)
                await waitForLayout()
                ;({program, block} = findTarget())
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
                codeEditor.setCursor(index, {reveal: true, suppressHistory: true, ratio: 0.33})
            } else if (typeof codeEditor.revealRange === 'function') {
                codeEditor.revealRange({start: index, end: index + 1}, {ratio: 0.33, highlight: false})
            }
            await waitForLayout()
            scrollBodyToCode(block.div, codeEditor, index, 0.33)
        }

        run()
        return true
    }

    /** @param {string} id */
    restoreLazyTab(id) {
        // Special windows (symbols, setup, memory, datablocks, db:N) that don't live in the project tree
        const isSpecialWindow = id === 'symbols' || id === 'setup' || id === 'memory' || id === 'datablocks' || id.startsWith('db:')
        const prog = this.#editor.findProgram(id)
        if (!prog && !isSpecialWindow) return
        this.tab_manager.addLazyTab(id)
    }

    /** @param { string | null | undefined } id */
    openProgram(id) {
        const editor = this.#editor
        if (!id) throw new Error('Program ID not found')

        // Special windows (symbols, setup, memory, datablocks, db:N) that don't live in the project tree
        const isSpecialWindow = id === 'symbols' || id === 'setup' || id === 'memory' || id === 'datablocks' || id.startsWith('db:')

        if (isSpecialWindow) {
            if (typeof editor._pushWindowHistory === 'function') {
                editor._pushWindowHistory(id)
            }
        }

        const existingTab = this.tab_manager.tabs.get(id)
        let existingProgram = editor.findProgram(id)

        // For special windows not in tree, create a virtual program entry
        if (!existingProgram && isSpecialWindow) {
            let name = id
            let comment = 'Memory Map'
            if (id === 'setup') { name = 'setup'; comment = 'Device Configuration' }
            else if (id === 'symbols') { name = 'symbols'; comment = 'Symbols Table' }
            else if (id === 'datablocks') { name = 'datablocks'; comment = 'Data Blocks' }
            else if (id.startsWith('db:')) {
                const dbNum = parseInt(id.split(':')[1])
                const db = (editor.project?.datablocks || []).find(d => d.id === dbNum)
                name = db ? (db.name || `DB${dbNum}`) : `DB${dbNum}`
                comment = 'Data Block'
            }
            existingProgram = {
                id,
                type: id.startsWith('db:') ? 'datablock' : id,
                name,
                path: '/',
                full_path: `/${id}`,
                comment,
                blocks: [],
            }
        }

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
        this.active_program = existingProgram || editor.findProgram(id)
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
            this._outerLayoutControl?.setNavMinimized(true)
        }
        // this.draw()
    }

    #initOuterLayout(workspace) {
        const nav = workspace.querySelector('.plc-navigation')
        const tools = workspace.querySelector('.plc-tools')
        // resizers removed from HTML
        const navBar = workspace.querySelector('.plc-navigation-bar')
        const toolsBar = workspace.querySelector('.plc-tools-bar')

        let state = {
            nav: {width: 300, minimized: false},
            tools: {width: 250, minimized: true},
        }

        try {
            const saved = localStorage.getItem('vovk_plc_outer_layout')
            if (saved) {
                const parsed = JSON.parse(saved)
                if (parsed.nav) state.nav = {...state.nav, ...parsed.nav}
                if (parsed.tools) state.tools = {...state.tools, ...parsed.tools}
            }
        } catch (e) {}

        const apply = () => {
            const navBtn = nav?.querySelector('.menu-button')
            const navContent = nav?.querySelector('.plc-navigation-container')

            if (state.nav.minimized) {
                nav.classList.add('minimized')
                nav.style.flex = '0 0 auto'
                nav.style.width = '30px'
                nav.style.overflow = 'hidden'
                if (navContent) navContent.style.display = 'none'
                if (navBtn) navBtn.innerText = '+'
                if (navBar) navBar.style.width = '100%'
            } else {
                nav.classList.remove('minimized')
                nav.style.flex = `0 0 ${state.nav.width}px`
                nav.style.width = `${state.nav.width}px`
                if (navContent) navContent.style.display = ''
                if (navBtn) navBtn.innerText = '-'
                if (navBar) navBar.style.width = ''
            }

            const toolsBtn = tools?.querySelector('.menu-button')
            const toolsContent = tools?.querySelector('.plc-tools-container')

            if (state.tools.minimized) {
                tools.classList.add('minimized')
                tools.style.flex = '0 0 auto'
                tools.style.width = '30px'
                tools.style.overflow = 'hidden'
                if (toolsContent) toolsContent.style.display = 'none'
                if (toolsBtn) toolsBtn.innerText = '+'
                if (toolsBar) toolsBar.style.width = '100%'
            } else {
                tools.classList.remove('minimized')
                tools.style.flex = `0 0 ${state.tools.width}px`
                tools.style.width = `${state.tools.width}px`
                if (toolsContent) toolsContent.style.display = ''
                if (toolsBtn) toolsBtn.innerText = '-'
                if (toolsBar) toolsBar.style.width = ''
            }

            localStorage.setItem('vovk_plc_outer_layout', JSON.stringify(state))
        }

        this._outerLayoutControl = {
            setNavMinimized: minimized => {
                state.nav.minimized = minimized
                apply()
            },
        }

        const setupDrag = (bar, side) => {
            if (!bar) return
            bar.style.touchAction = 'none'

            bar.addEventListener('pointerdown', e => {
                // Ignore clicks on buttons inside the bar if necessary, but we capture everything for drag
                // If user clicks the button explicitly, it might bubble.
                // e.target check?
                // The 'menu-button' is inside. If I capture pointer, button click might fail visual feedback?
                // Actually pointer capture allows events.

                // If it's a right click, ignore
                if (e.button !== 0) return

                e.preventDefault()
                bar.setPointerCapture(e.pointerId)

                const startX = e.clientX

                // Use current visual width as start point
                const panel = side === 'left' ? nav : tools
                const rect = panel.getBoundingClientRect()
                const startWidth = rect.width

                let isDragging = false

                const onPointerMove = evt => {
                    const diff = evt.clientX - startX
                    if (!isDragging && Math.abs(diff) > 5) {
                        isDragging = true
                        document.body.style.cursor = 'ew-resize'
                        bar.style.cursor = 'ew-resize'
                    }

                    if (isDragging) {
                        let newWidth = side === 'left' ? startWidth + diff : startWidth - diff

                        const min = 250
                        const trigger = min / 2

                        if (newWidth < trigger) {
                            if (side === 'left') state.nav.minimized = true
                            else state.tools.minimized = true
                        } else {
                            if (newWidth < min) newWidth = min
                            if (newWidth > 800) newWidth = 800

                            if (side === 'left') {
                                state.nav.width = newWidth
                                state.nav.minimized = false
                            } else {
                                state.tools.width = newWidth
                                state.tools.minimized = false
                            }
                        }

                        apply()
                    }
                }

                const onPointerUp = evt => {
                    document.body.style.cursor = ''
                    bar.style.cursor = ''
                    bar.releasePointerCapture(evt.pointerId)
                    bar.removeEventListener('pointermove', onPointerMove)
                    bar.removeEventListener('pointerup', onPointerUp)

                    if (!isDragging) {
                        // Treat as click/toggle
                        if (side === 'left') state.nav.minimized = !state.nav.minimized
                        else state.tools.minimized = !state.tools.minimized
                        apply()
                    }
                }

                bar.addEventListener('pointermove', onPointerMove)
                bar.addEventListener('pointerup', onPointerUp)
            })
        }

        setupDrag(navBar, 'left')
        setupDrag(toolsBar, 'right')

        apply()
    }

    async updateDeviceDropdown() {
        if (!this.deviceDropdown) {
            // console.warn('[WindowManager] updateDeviceDropdown skipped - no deviceDropdown')
            return
        }

        // Self-Healing: Ensure serial polling is active if we are in serial mode
        // This handles cases where mode was switched via Project Load or other means without triggering the change event
        if (this.connectionMode === 'serial' && !this.serialDevicePollingTimer && 'serial' in navigator) {
            // console.log('[WindowManager] Auto-starting serial polling found to be inactive')
            this._startSerialPolling()
        }

        // console.log('[WindowManager] updateDeviceDropdown called. Mode:', this.connectionMode)

        const mode = this.connectionMode
        let newOptions = []
        let selectedValueToSet = null

        if (mode === 'simulation') {
            newOptions.push({
                type: 'option',
                value: '_simulation',
                label: 'Simulation',
                subtitle: null,
                disabled: false,
                isConnected: false,
                isOffline: false,
            })
            selectedValueToSet = '_simulation'
        } else if (mode === 'serial') {
            if (!('serial' in navigator)) {
                newOptions.push({
                    type: 'option',
                    value: '_none',
                    label: 'Serial not supported',
                    subtitle: null,
                    disabled: true,
                })
                selectedValueToSet = '_none'
            } else {
                try {
                    const ports = await navigator.serial.getPorts()
                    // console.log('[WindowManager] Detected ports:', ports.length)
                    /*
                    if (ports.length > 0) {
                        ports.forEach((p, i) => {
                            const info = p.getInfo();
                            console.log(`[WindowManager] Port ${i}:`, info.usbVendorId, info.usbProductId)
                        })
                    }
                    */
                    const addedKeys = new Set()

                    // Helper to get stored device info safely (handles legacy string format)
                    const getStoredInfo = usbKey => {
                        const stored = this.#editor.project?.serialDeviceNames?.[usbKey]
                        if (!stored) return null
                        if (typeof stored === 'string') {
                            return {name: stored, created: 0, lastConnected: 0}
                        }
                        return stored
                    }

                    // Collect all potential options first
                    const allDevices = []

                    // 1. Online Ports
                    ports.forEach((port, index) => {
                        const info = port.getInfo()
                        const isConnected = this.#editor.device_manager?.connected && this.#editor.device_manager?.connection?.serial?.port === port

                        let value = `_port_${index}`
                        let label = `Serial Device ${index + 1}`
                        let subtitle = null
                        let lastConnected = 0
                        let usbKey = null

                        if (info.usbVendorId && info.usbProductId) {
                            const vendorId = info.usbVendorId.toString(16).padStart(4, '0')
                            const productId = info.usbProductId.toString(16).padStart(4, '0')
                            usbKey = `${vendorId}:${productId}`
                            value = `_usb_${usbKey}`

                            const stored = getStoredInfo(usbKey)
                            if (stored) {
                                label = stored.name
                                lastConnected = stored.lastConnected || 0
                            } else {
                                label = 'Unnamed Device' // Cleaner default
                            }
                            subtitle = `USB ${usbKey}`
                        }

                        if (usbKey) addedKeys.add(usbKey)

                        // Check if reconnecting - disable all options if so
                        const isReconnecting = this.device_online_button && this.device_online_button.title === 'Cancel reconnect'

                        allDevices.push({
                            type: 'option',
                            value,
                            label,
                            subtitle,
                            disabled: isReconnecting,
                            isConnected,
                            isOffline: false,
                            isAvailable: true,
                            lastConnected,
                            portIndex: index, // Helper for connection lookup fallback
                        })

                        if (isConnected) selectedValueToSet = value
                        else if (this.selectedDeviceValue === value) selectedValueToSet = value
                        else if (this._savedSerialDevice === value) selectedValueToSet = value // Restore preference
                    })

                    // console.log('[WindowManager] Online ports processing done. selectedValueToSet:', selectedValueToSet)

                    // 2. Offline History
                    const serialDeviceNames = this.#editor.project?.serialDeviceNames
                    if (serialDeviceNames && Object.keys(serialDeviceNames).length > 0) {
                        for (const [usbKey, entry] of Object.entries(serialDeviceNames)) {
                            // Check against already added keys
                            if (addedKeys.has(usbKey)) continue

                            const name = typeof entry === 'string' ? entry : entry.name
                            const lastConnected = typeof entry === 'string' ? 0 : entry.lastConnected || 0

                            const value = `_usb_${usbKey}`

                            // Check if reconnecting - disable all options if so
                            const isReconnecting = this.device_online_button && this.device_online_button.title === 'Cancel reconnect'

                            allDevices.push({
                                type: 'option',
                                value: value,
                                label: name,
                                subtitle: `USB ${usbKey}`,
                                disabled: isReconnecting,
                                isConnected: false,
                                isOffline: true, // Mark as offline visually
                                isAvailable: false,
                                lastConnected,
                            })

                            if (this.selectedDeviceValue === value) selectedValueToSet = value
                            else if (this._savedSerialDevice === value && !selectedValueToSet) selectedValueToSet = value
                        }
                    }

                    // console.log('[WindowManager] Offline history processing done. selectedValueToSet:', selectedValueToSet)

                    // Sort: (1) Connected first, (2) Available first, (3) Last connected DESC
                    allDevices.sort((a, b) => {
                        if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1
                        if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1
                        return b.lastConnected - a.lastConnected
                    })

                    // Add to options
                    newOptions = [...allDevices]

                    // If no devices found
                    if (newOptions.length === 0) {
                        newOptions.push({
                            type: 'option',
                            value: '_none',
                            label: 'No paired devices',
                            subtitle: null,
                            disabled: true,
                        })
                        if (!this.selectedDeviceValue || this.selectedDeviceValue.startsWith('_')) {
                            selectedValueToSet = '_none'
                        }
                    } else if (!selectedValueToSet) {
                        // Default to first available, or first item if none available
                        const firstAvailable = newOptions.find(o => o.isAvailable)
                        selectedValueToSet = firstAvailable ? firstAvailable.value : newOptions[0].value
                    }

                    // Add "Connect New Device" action
                    const isReconnecting = this.device_online_button && this.device_online_button.title === 'Cancel reconnect'
                    newOptions.push({type: 'separator', text: ''})
                    newOptions.push({
                        type: 'option',
                        value: '_action_new_device',
                        label: '+ Connect new device',
                        subtitle: null,
                        disabled: isReconnecting,
                        isConnected: false,
                        isOffline: false,
                    })
                } catch (err) {
                    console.error('Failed to get paired devices:', err)
                    newOptions.push({
                        type: 'option',
                        value: '_error',
                        label: 'Error loading devices',
                        subtitle: null,
                        disabled: true,
                    })
                }
            }
        }

        // Cache Check
        const newStateStr = JSON.stringify(newOptions) + mode + selectedValueToSet + (this.device_online_button?.title || '')
        // NON-BLOCKING CACHE CHECK FOR DEBUGGING
        if (this._lastDropdownState === newStateStr) {
            // console.log('[WindowManager] Cache hit, but forcing update to ensure button state')
        }
        this._lastDropdownState = newStateStr

        // Render
        this.deviceDropdown.clear()

        newOptions.forEach(opt => {
            if (opt.type === 'separator') {
                this.deviceDropdown.addSeparator(opt.text)
            } else {
                this.deviceDropdown.addOption(opt.value, opt.label, opt.subtitle, opt.disabled, opt.isConnected, opt.isOffline)
            }
        })

        // Ensure we preserve the selection even if device is offline (logic above handles it via selectedValueToSet)
        if (selectedValueToSet) {
            // Note: selectOption logic was updated to NOT trigger onChange callback by default
            // This prevents infinite loops when updateDeviceDropdown is called FROM onChange
            this.deviceDropdown.selectOption(selectedValueToSet)

            // Implicitly set valid selection for persistence
            if (selectedValueToSet !== this.selectedDeviceValue) {
                this.selectedDeviceValue = selectedValueToSet
                if (this.#editor.project) {
                    this.#editor.project.selectedDevice = selectedValueToSet
                }
            }
        }

        // Update Connect Button State based on selection availability
        if (this.device_online_button) {
            const isReconnecting = this.device_online_button.title === 'Cancel reconnect'
            const isBusy = this.device_online_button.innerText === '----------'
            const isConnected = this.#editor.device_manager?.connected

            if (!isReconnecting && !isBusy && !isConnected) {
                const selectedOption = newOptions.find(o => o.value === selectedValueToSet)
                const isOffline = !selectedOption || selectedOption.isOffline || selectedOption.value === '_none' || selectedOption.value === '_error' || (selectedOption.disabled && selectedOption.value !== '_simulation')

                // console.log(`[WindowManager] Button update check. selectedValue: ${selectedValueToSet}, isOffline: ${isOffline}`)

                if (isOffline) {
                    this.device_online_button.style.background = '#444' // Grey
                    this.device_online_button.style.color = '#888'
                    this.device_online_button.style.border = '1px solid #444'
                    this.device_online_button.style.cursor = 'not-allowed'
                    this.device_online_button.setAttribute('data-offline', 'true')
                } else {
                    this.device_online_button.style.background = '#1fba5f' // Green
                    this.device_online_button.style.color = '#fff'
                    this.device_online_button.style.border = '1px solid transparent'
                    this.device_online_button.style.cursor = 'pointer'
                    this.device_online_button.removeAttribute('data-offline')
                }
            }
        }
    }

    async connectToPairedDevice(portIndex) {
        if (!('serial' in navigator)) return

        try {
            const ports = await navigator.serial.getPorts()
            const port = ports[portIndex]
            if (!port) {
                this.logToConsole('Selected device not found', 'error')
                return
            }

            // Check if already connected to this device
            const alreadyConnected = this.#editor.device_manager?.connected && this.#editor.device_manager?.connection?.serial?.port === port

            if (alreadyConnected) {
                // Disconnect
                await this.#editor.device_manager.disconnect(true)
                this.active_mode = 'edit'
                this.device_online_button.innerText = '○'
                this.device_online_button.title = 'Connect'
                this.device_online_button.style.background = '#1fba5f'
                this.device_online_button.style.color = '#fff'
                this.device_info.innerHTML = `
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                        <div style="flex: 1; min-width: 0;">
                            <div class="device-name" style="color: #888;">Disconnected</div>
                            <div class="device-meta" style="color: #666;">Click connect to go online</div>
                        </div>
                        <button class="plc-device-details-btn" title="Device Details" style="background: #2a2a2a; border: 1px solid #444; color: #666; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                    </div>
                `
                const pairedDisconnectBtn = this.device_info.querySelector('.plc-device-details-btn')
                if (pairedDisconnectBtn) {
                    pairedDisconnectBtn.addEventListener('click', () => this._showDeviceDetails())
                }
                return
            }

            // Connect to the selected port
            this.device_online_button.setAttribute('disabled', 'disabled')
            this.device_online_button.innerText = '----------'
            this.showLoading('Connecting to device...')

            const dm = this.#editor.device_manager
            await dm.connect({
                target: 'serial',
                baudrate: 115200,
                port: port,
            })

            if (dm.connected) {
                this.active_mode = 'online'
                this.active_device = 'serial' // Set to serial for proper highlight colors
                this.device_online_button.innerText = '✕'
                this.device_online_button.title = 'Disconnect'
                this.device_online_button.style.background = '#dc3545'
                this.device_online_button.style.color = '#fff'

                const info = dm.deviceInfo
                if (info) {
                    this.device_info.innerHTML = `
                        <div style="display: flex; align-items: flex-start; gap: 8px;">
                            <div style="flex: 1; min-width: 0;">
                                <div class="device-name">${info.device || 'Unknown Device'}</div>
                                <div class="device-meta">${info.arch} ${info.version ? 'v' + info.version : ''}</div>
                            </div>
                            <button class="plc-device-details-btn" title="Device Details" style="background: #2a2a2a; border: 1px solid #444; color: #888; padding: 4px 8px; font-size: 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;">Details</button>
                        </div>
                    `
                    const connectedDetailsBtn = this.device_info.querySelector('.plc-device-details-btn')
                    if (connectedDetailsBtn) {
                        connectedDetailsBtn.addEventListener('click', () => this._showDeviceDetails())
                    }
                }

                // Don't call updateDeviceDropdown here - it's already called by the connection status handler
            }
        } catch (err) {
            this.forceHideLoading()
            console.error('Failed to connect to paired device:', err)
            this.logToConsole(`Failed to connect: ${err.message || err}`, 'error')
        } finally {
            this.forceHideLoading() // Ensure loading bar is always hidden
            this.device_online_button.removeAttribute('disabled')
            if (this.device_online_button.innerText === '----------') {
                this.device_online_button.innerText = '○'
                this.device_online_button.title = 'Connect'
                this.device_online_button.style.background = '#1fba5f'
                this.device_online_button.style.color = '#fff'
            }
        }
    }

    async updatePairedDevicesList() {
        // Legacy method - now redirects to updateDeviceDropdown
        await this.updateDeviceDropdown()
    }
}
