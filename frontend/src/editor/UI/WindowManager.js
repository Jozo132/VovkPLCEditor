import {PLC_Project, PLCEditor} from '../../utils/types.js'
import VOVKPLCEDITOR_VERSION_BUILD, { VOVKPLCEDITOR_VERSION } from '../BuildNumber.js'
import {ElementSynthesisMany, getEventPath, isVisible} from '../../utils/tools.js'
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
import {CustomDropdown} from './Elements/CustomDropdown.js'

/** @typedef { EditorUI | SymbolsUI | SetupUI } WindowType */

export default class WindowManager {
    /** @type {'edit' | 'online'} */
    active_mode = 'edit'

    /** @type {'simulation' | 'device'} */
    active_device = 'simulation'
    _monitoringActive = false
    _monitoringAvailable = true  // Always available - can toggle in any state
    _liveEditEnabled = false
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

    // Serial Polling Methods
    _handleSerialEvent = (event) => {
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
         const hasSerial = 'serial' in navigator;
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
                        </div>
                    </div>
                </div>
            </div>
            <div class="plc-workspace-body">
                <div class="plc-navigation no-select resizable">
                    <div class="plc-navigation-container">
                        <!--h3>Navigation</h3-->
                        
                        <div class="plc-sidebar-panels" style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
                             
                             <div class="plc-sidebar-panel-wrapper" id="wrapper-connection" style="display: flex; flex-direction: column; flex: 0 0 auto; min-height: 22px;">
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
                pointerEvents: 'none'
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
                        origin: { x: 0, y: 0 },
                        selection: []
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

        consoleHeader.style.touchAction = 'none';
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

            const onPointerMove = (evt) => {
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

            const onPointerUp = (evt) => {
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
                          consoleState.minimized = true;
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
                     value: el.querySelector('.health-value')
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
                 el.addEventListener('mousemove', (e) => {
                     tooltip.style.left = (e.pageX + 10) + 'px'
                     tooltip.style.top = (e.pageY + 10) + 'px'
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
        this.watch_panel.onListChange = (items) => {
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
            }
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
        workspace.addEventListener('plc-device-update', (e) => {
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
                            lastConnected: now
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
                    device_info.innerHTML = ''
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
                        <div class="device-name">${info.device || 'Unknown Device'}</div>
                        <div class="device-meta">${info.arch} ${info.version ? 'v' + info.version : ''}</div>
                    `
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
            tabs_element.addEventListener('wheel', (evt) => {
                if (evt.deltaY !== 0) {
                    evt.preventDefault()
                    tabs_element.scrollLeft += evt.deltaY
                }
            }, { passive: false })
        }

        // Clear problem selection when clicking anywhere in the program window area
        window_frame.addEventListener('mousedown', (evt) => {
            // Clear problem panel selection to focus on user interaction
            if (typeof this.clearProblemSelection === 'function') {
                this.clearProblemSelection()
            }
        }, { capture: true })
        
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
                    { type: 'item', label: this.active_device === 'simulation' ? 'Switch to Device' : 'Switch to Simulation', name: 'toggle_device' },
                    { type: 'item', label: this.active_mode === 'online' ? 'Disconnect' : 'Connect', name: 'toggle_online' }
                ],
                onClose: (key) => {
                    if (key === 'toggle_device') {
                       const next = this.active_device === 'simulation' ? 'device' : 'simulation'
                       this.setActiveDevice(next)
                    }
                    if (key === 'toggle_online') this.#on_device_online_click()
                }
            })
        }

        // Project Panel
        const projectHeader = workspace.querySelector('.plc-navigation-panel-header')
        if (projectHeader) {
            this.#editor.context_manager.addListener({
                 target: projectHeader,
                 onOpen: () => [
                     // { type: 'item', label: 'Refresh', name: 'refresh' },
                     { type: 'item', label: 'Collapse All', name: 'collapse_all' }
                 ],
                 onClose: (key) => {
                     // if (key === 'refresh') this.tree_manager?.refresh?.()
                     if (key === 'collapse_all') this.tree_manager?.collapseItems?.()
                 }
            })
        }

        // Health Panel
        const healthHeader = workspace.querySelector('.plc-device-health-header')
        if (healthHeader) {
            this.#editor.context_manager.addListener({
                target: healthHeader,
                onOpen: () => [
                    { type: 'item', label: 'Reset Max Values', name: 'reset' }
                ],
                onClose: (key) => {
                     if (key === 'reset') this.#on_device_health_reset_click()
                }
            })
        }
        
        // Watch Panel Header
        const watchHeader = workspace.querySelector('.plc-device-watch-header')
        if (watchHeader) {
             this.#editor.context_manager.addListener({
                target: watchHeader,
                onOpen: () => [
                     { type: 'item', label: 'Clear Watch Table', name: 'clear' }
                ],
                onClose: (key) => {
                    if (key === 'clear') {
                         this.watch_panel?.setEntries?.([])
                    }
                }
             })
        }
    }

    #initPanelResizables(workspace) {
        const wrappers = [
             { el: workspace.querySelector('#wrapper-connection') },
             { el: workspace.querySelector('#wrapper-project') },
             { el: workspace.querySelector('#wrapper-health') },
             { el: workspace.querySelector('#wrapper-watch') }
        ]
        const resizers = Array.from(workspace.querySelectorAll('.plc-panel-resizer'))
        if (wrappers.some(w => !w.el)) return

        // State tracking: stored as normalized flex ratios (pixels)
        // Default: roughly equal or standard distribution
        let state = [
            { minimized: false, flex: 100 },
            { minimized: false, flex: 200 },
            { minimized: false, flex: 200 },
            { minimized: false, flex: 200 }
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
        } catch(e) { console.warn('Failed to load layout', e) }

        const applyLayout = () => {
            wrappers.forEach((w, i) => {
                const s = state[i]
                const header = w.el.querySelector('.plc-connection-header, .plc-navigation-panel-header, .plc-device-health-header, .plc-device-watch-header')
                const chevron = header ? header.querySelector('.codicon') : null
                const content = w.el.querySelector('.plc-connection-body, .plc-navigation-panel-content, .plc-device-health-body, .plc-device-watch-content')
                
                if (s.minimized) {
                     // Minimized: fixed height
                     w.el.style.flex = "0 0 22px"
                     w.el.style.overflow = "hidden"
                     w.el.classList.add('minimized')
                     
                     if (content) content.style.display = 'none'
                     if (chevron) chevron.classList.replace('codicon-chevron-down', 'codicon-chevron-right')
                } else {
                     // Expanded: flex grow proportional to last size
                     const flexVal = Math.max(s.flex, 50) // Ensure at least some weight
                     w.el.style.flex = `${flexVal} 1 0px`
                     w.el.style.overflow = "hidden" // Keep content contained
                     w.el.classList.remove('minimized')
                     
                     if (content) content.style.display = ''
                     if (chevron) chevron.classList.replace('codicon-chevron-right', 'codicon-chevron-down')
                }
            })
            // Save state
            localStorage.setItem('vovk_plc_layout', JSON.stringify(state))
        }

        const togglePanel = (index) => {
            state[index].minimized = !state[index].minimized
            applyLayout()
        }

        // Initialize headers
        wrappers.forEach((w, i) => {
            const header = w.el.querySelector('.plc-connection-header, .plc-navigation-panel-header, .plc-device-health-header, .plc-device-watch-header')
            if (header) {
                header.onclick = (e) => {
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

        const handleMouseMove = (e) => {
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
            
            let newTopHeight = (e.clientY - topTop)
            
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
            resizer.addEventListener('mousedown', (e) => handleMouseDown(e, i))
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
             
             const fmt = (v) => {
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
                 
                 scale = (max || 0)
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
             Object.values(this.device_health_charts).forEach(c => c.container.style.opacity = '0.5')
        } else {
             Object.values(this.device_health_charts).forEach(c => c.container.style.opacity = '1')
        }
    }
    
    setHealthDimmed(dimmed) {
        this._last_known_health_dimmed = dimmed
        if (this.device_health_charts) {
              Object.values(this.device_health_charts).forEach(c => c.container.style.opacity = dimmed ? '0.5' : '1')
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

        if (!this.#editor.runtime_ready) {
            if (!silent) {
                if (silentOnSuccess && typeof this.setConsoleTab === 'function') this.setConsoleTab('output')
                this.logToConsole('WASM Runtime is not ready yet.', 'error')
                this.logToConsole('----------------------------------------', 'info')
            }
            return false
        }

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
            this.#editor.project.binary = ((str) => {
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
            
            return true
        } catch (e) {
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
        const compiled = await this.handleCompile({ silentOnSuccess: true })
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

            if (mismatches.length > 0) {
                const details = `<br><br><span style="color: #777; font-size: 0.9em;">Target: <b>${deviceInfo.type || '?'}</b> ${deviceInfo.arch ? '(' + deviceInfo.arch + ')' : ''} <span style="opacity: 0.7">${deviceInfo.version ? 'v' + deviceInfo.version : ''}</span></span>`
                const description = `The connected device details do not match the project configuration:<br><br>${mismatches.join('<br>')}<br><br>Upload anyway?${details}`
                const confirm = await Popup.confirm({
                    title: 'Device Mismatch',
                    description: description,
                    confirm_text: 'Upload',
                    cancel_text: 'Cancel',
                    confirm_button_color: '#d1852e',
                    confirm_text_color: '#FFF',
                })
                if (!confirm) {
                    this.logToConsole('Upload aborted due to device mismatch.', 'warning')
                    this.logToConsole('----------------------------------------', 'info')
                    return
                }
            } else {
                const details = `<br><br><span style="color: #777; font-size: 0.9em;">Target: <b>${deviceInfo.type || '?'}</b> ${deviceInfo.arch ? '(' + deviceInfo.arch + ')' : ''} <span style="opacity: 0.7">${deviceInfo.version ? 'v' + deviceInfo.version : ''}</span></span>`
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
            const startTime = performance.now()
            await this.#editor.device_manager.connection.downloadProgram(compiledBytecode)
            const endTime = performance.now()
            this.logToConsole('Program uploaded successfully.', 'success')
            this.logToConsole(`Upload took ${(endTime - startTime).toFixed(0)}ms`, 'info')
            this.logToConsole('----------------------------------------', 'info')
            
            // Reset data fetcher to clear stale memory cache
            if (this.#editor.data_fetcher) {
                this.#editor.data_fetcher.reset()
            }
        } catch (e) {
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
            return { success: false, message: 'Bytecode patcher not initialized' }
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
            return { success: false, message: 'Bytecode patcher not initialized' }
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
                buttons: [{ text: 'OK', value: 'ok', background: '#007bff', color: 'white' }]
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
            
            if (c.flags & 0x10) { // IR_FLAG_TIMER
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
                { text: 'Next', value: 'next', background: '#007bff', color: 'white', 
                  verify: () => selectedIndex !== -1 },
                { text: 'Cancel', value: 'cancel' }
            ]
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
                { text: 'Patch', value: 'patch', background: '#0078d4', color: 'white',
                  verify: () => {
                    const val = constant.operand_type === 'f32' || constant.operand_type === 'f64' 
                        ? parseFloat(valueInput.value) 
                        : parseInt(valueInput.value)
                    if (!Number.isFinite(val)) {
                        valueInput.style.borderColor = 'red'
                        return false
                    }
                    valueInput.style.borderColor = '#3c3c3c'
                    return true
                  }
                },
                { text: 'Cancel', value: 'cancel' }
            ],
            onOpen: () => {
                valueInput.focus()
                valueInput.select()
            }
        })
        
        if (result !== 'patch') return
        
        const newValue = constant.operand_type === 'f32' || constant.operand_type === 'f64' 
            ? parseFloat(valueInput.value) 
            : parseInt(valueInput.value)

        const patchResult = await this.patchConstant(constant.bytecode_offset, newValue)
        
        new Popup({
            title: patchResult.success ? 'Success' : 'Error',
            description: patchResult.message,
            buttons: [{ text: 'OK', value: 'ok', background: patchResult.success ? '#28a745' : '#dc3545', color: 'white' }]
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
                device_info.innerHTML = editor.device_manager.error || ''
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
                    <div class="device-name">${info.device || 'Unknown Device'}</div>
                    <div class="device-meta">${info.arch} ${info.version ? 'v' + info.version : ''}</div>
                `
                
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
                            lastConnected: now
                        }

                        // Save project to persist device names
                        if (editor.project_manager?.forceSave) {
                            editor.project_manager.forceSave()
                        }
                        // Update dropdown after storing device name
                        this.updateDeviceDropdown()
                    }
                }
            }
            else device_info.innerHTML = 'Unknown device'
            this._healthConnectionState = true
            this._setHealthConnected(true)
            this._startHealthPolling()

            // Simulation Auto-Load Sequence
            if (this.active_device === 'simulation') {
                const compileSuccess = await this.handleCompile({ silent: true })
                
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
                              await this.#editor.device_manager.connection.plc.setRuntimeOffsets(
                                  normalized.control.offset,
                                  normalized.input.offset,
                                  normalized.output.offset,
                                  normalized.system.offset,
                                  normalized.marker.offset
                              )
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
            device_info.innerHTML = ''
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
                label.addEventListener('click', (e) => {
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
        document.addEventListener('click', (e) => {
            if (!menuBar.contains(e.target)) {
                closeAllMenus()
            }
        })
        
        // Close menus on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && openMenu) {
                closeAllMenus()
            }
        })
        
        // Handle menu option clicks
        menuBar.addEventListener('click', async (e) => {
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
            }
        })
    }
    
    _menuNewProject() {
        // Confirm if there's existing work
        const hasContent = this.#editor.project?.files?.length > 0
        if (hasContent) {
            if (!confirm('Create a new project? Any unsaved changes will be lost.')) {
                return
            }
        }
        
        // Clear localStorage and reload
        localStorage.removeItem('vovk_plc_project')
        localStorage.removeItem('vovk_plc_symbols_collapsed')
        window.location.reload()
    }
    
    _menuOpenProject() {
        // Create file input to select JSON file
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,.vovkplc'
        input.style.display = 'none'
        
        input.addEventListener('change', async (e) => {
            const file = input.files?.[0]
            if (!file) return
            
            try {
                const text = await file.text()
                const project = JSON.parse(text)
                
                // Validate basic structure
                if (!project || typeof project !== 'object') {
                    throw new Error('Invalid project file format')
                }
                
                // Load the project
                this.#editor.project_manager.ensureSystemSymbols(project)
                this.#editor.project_manager.load(project)
                this.#editor.project_manager.last_saved_state = ''
                this.#editor.project_manager.checkAndSave()
                
                this.logToConsole?.(`Opened project from ${file.name}`, 'success')
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
            
            // Get the project data (same as saved to localStorage)
            const projectToExport = { ...this.#editor.project }
            
            // Filter out system symbols but keep user symbols
            if (projectToExport.symbols) {
                projectToExport.symbols = projectToExport.symbols.filter(s => !s.readonly && !s.device)
            }
            
            // Keep device_symbols in export so they can be restored
            // (they will be merged/updated when connecting to device)
            
            // Keep connectionMode and selectedDevice for device configuration
            // These are already in projectToExport
            
            // Create filename from project info or use default
            const projectName = projectToExport.info?.name || 'project'
            const projectVersion = projectToExport.info?.version || ''
            const timestamp = new Date().toISOString().slice(0, 10)
            // Escape version for valid filename (replace invalid chars with underscore)
            const safeVersion = projectVersion.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_')
            const filename = safeVersion 
                ? `${projectName}_v${safeVersion}_${timestamp}.vovkplc`
                : `${projectName}_${timestamp}.vovkplc`
            
            // Create and download file
            const json = JSON.stringify(projectToExport, null, 2)
            const blob = new Blob([json], { type: 'application/json' })
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
                { text: 'Save', value: 'confirm', background: '#007acc', color: 'white' },
                { text: 'Cancel', value: 'cancel' }
            ],
            inputs: [
                {
                    name: 'name',
                    label: 'Project Title',
                    type: 'text',
                    value: info.name || '',
                    placeholder: 'My PLC Project'
                },
                {
                    name: 'version',
                    label: 'Version',
                    type: 'text',
                    value: info.version || '0.0.0',
                    placeholder: '0.0.0'
                },
                {
                    name: 'author',
                    label: 'Author',
                    type: 'text',
                    value: info.author || '',
                    placeholder: 'Your name'
                },
                {
                    name: 'description',
                    label: 'Description',
                    type: 'textarea',
                    value: info.description || '',
                    placeholder: 'Enter project description...',
                    rows: 4
                }
            ]
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
            } catch(e) { console.warn('Failed to load watch items', e) }
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
                const success = await this.handleCompile({ silent: true })
                console.log('[WindowManager] Automatic compilation result:', success)
            } catch (err) {
                console.warn('Failed to compile on project load:', err)
            }
        }, 3000)

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
                this.footerTooltip.style.bottom = (window.innerHeight - rect.top) + 'px'
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
            const structSize = (locationKey === 'timer') ? 9 : (locationKey === 'counter') ? 5 : 1

            if (symbol?.type === 'bit' || explicitBit !== null) {
                const byte = Math.floor(addrVal)
                const bit = explicitBit !== null ? explicitBit : Math.round((addrVal - byte) * 10)
                return {absolute: baseOffset + (byte * structSize), bit, size: 1}
            }
            const size = typeSizes[symbol?.type] || 1
            return {absolute: baseOffset + (Math.floor(addrVal) * structSize), bit: null, size}
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

            this.data_fetcher.register('code-monitor', readStart, size, (data) => {
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
            
            // Check end bound
            const size = (['bit', 'byte', 'u8', 'i8'].includes(type) || type === 'bit' || type === 'byte') ? 1 : 
                         (['int', 'u16', 'i16', 'word'].includes(type) || type === 'int') ? 2 : 
                         (['dint', 'u32', 'i32', 'real', 'float', 'f32', 'dword'].includes(type) || type === 'dint' || type === 'real') ? 4 : 
                         (['u64', 'i64', 'f64', 'lword'].includes(type)) ? 8 : 1
            
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
                value = view.getInt16(offset, true)
                text = String(value)
            } else if (type === 'u16') {
                value = view.getUint16(offset, true)
                text = String(value)
            } else if (type === 'dint' || type === 'i32') {
                value = view.getInt32(offset, true)
                text = String(value)
            } else if (type === 'u32' || type === 'dword') {
                value = view.getUint32(offset, true)
                text = String(value)
            } else if (type === 'real' || type === 'float' || type === 'f32') {
                value = view.getFloat32(offset, true)
                text = Number.isFinite(value) ? value.toFixed(3) : String(value)
            } else if (type === 'f64') {
                value = view.getFloat64(offset, true)
                text = Number.isFinite(value) ? value.toFixed(3) : String(value)
            } else if (type === 'u64' || type === 'i64' || type === 'lword') {
                try {
                    value = (type === 'u64' || type === 'lword') ? view.getBigUint64(offset, true) : view.getBigInt64(offset, true)
                    text = String(value)
                } catch(e) { /* fallback */ value = 0n; text = '0' }
            } else {
                value = bytes[offset]
                text = String(value)
            }
            liveValues.set(symbol.name, {
                value, 
                text, 
                type, 
                absoluteAddress: layout.absolute, 
                timestamp: Date.now() 
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
        // Special windows (symbols, setup, memory) that don't live in the project tree
        const isSpecialWindow = id === 'symbols' || id === 'setup' || id === 'memory'
        const prog = this.#editor.findProgram(id)
        if (!prog && !isSpecialWindow) return
        this.tab_manager.addLazyTab(id)
    }

    /** @param { string | null | undefined } id */
    openProgram(id) {
        const editor = this.#editor
        if (!id) throw new Error('Program ID not found')

        // Special windows (symbols, setup, memory) that don't live in the project tree
        const isSpecialWindow = id === 'symbols' || id === 'setup' || id === 'memory'
        
        if (isSpecialWindow) {
            if (typeof editor._pushWindowHistory === 'function') {
                editor._pushWindowHistory(id)
            }
        }

        const existingTab = this.tab_manager.tabs.get(id)
        let existingProgram = editor.findProgram(id)
        
        // For special windows not in tree, create a virtual program entry
        if (!existingProgram && isSpecialWindow) {
            existingProgram = { 
                id, 
                type: id, 
                name: id, 
                path: '/', 
                full_path: `/${id}`, 
                comment: id === 'setup' ? 'Device Configuration' : id === 'symbols' ? 'Symbols Table' : 'Memory Map',
                blocks: [] 
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
        const nav = workspace.querySelector('.plc-navigation');
        const tools = workspace.querySelector('.plc-tools');
        // resizers removed from HTML
        const navBar = workspace.querySelector('.plc-navigation-bar');
        const toolsBar = workspace.querySelector('.plc-tools-bar');

        let state = {
            nav: { width: 300, minimized: false },
            tools: { width: 250, minimized: true }
        };

        try {
            const saved = localStorage.getItem('vovk_plc_outer_layout');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.nav) state.nav = { ...state.nav, ...parsed.nav };
                if (parsed.tools) state.tools = { ...state.tools, ...parsed.tools };
            }
        } catch(e) {}

        const apply = () => {
            const navBtn = nav?.querySelector('.menu-button');
            const navContent = nav?.querySelector('.plc-navigation-container');
            
            if (state.nav.minimized) {
                nav.classList.add('minimized');
                nav.style.flex = '0 0 auto';
                nav.style.width = '30px'; 
                nav.style.overflow = 'hidden';
                if (navContent) navContent.style.display = 'none';
                if (navBtn) navBtn.innerText = '+';
                if (navBar) navBar.style.width = '100%';
            } else {
                nav.classList.remove('minimized');
                nav.style.flex = `0 0 ${state.nav.width}px`;
                nav.style.width = `${state.nav.width}px`;
                if (navContent) navContent.style.display = '';
                if (navBtn) navBtn.innerText = '-';
                if (navBar) navBar.style.width = '';
            }

            const toolsBtn = tools?.querySelector('.menu-button');
            const toolsContent = tools?.querySelector('.plc-tools-container');

            if (state.tools.minimized) {
                tools.classList.add('minimized');
                tools.style.flex = '0 0 auto';
                tools.style.width = '30px';
                tools.style.overflow = 'hidden';
                if (toolsContent) toolsContent.style.display = 'none';
                if (toolsBtn) toolsBtn.innerText = '+';
                if (toolsBar) toolsBar.style.width = '100%';
            } else {
                tools.classList.remove('minimized');
                tools.style.flex = `0 0 ${state.tools.width}px`;
                tools.style.width = `${state.tools.width}px`;
                if (toolsContent) toolsContent.style.display = '';
                if (toolsBtn) toolsBtn.innerText = '-';
                if (toolsBar) toolsBar.style.width = '';
            }

            localStorage.setItem('vovk_plc_outer_layout', JSON.stringify(state));
        }

        this._outerLayoutControl = {
            setNavMinimized: (minimized) => {
                state.nav.minimized = minimized
                apply()
            }
        }

        const setupDrag = (bar, side) => {
            if (!bar) return; 
            bar.style.touchAction = 'none';

            bar.addEventListener('pointerdown', (e) => {
                // Ignore clicks on buttons inside the bar if necessary, but we capture everything for drag
                // If user clicks the button explicitly, it might bubble. 
                // e.target check?
                // The 'menu-button' is inside. If I capture pointer, button click might fail visual feedback?
                // Actually pointer capture allows events.
                
                // If it's a right click, ignore
                if (e.button !== 0) return;

                e.preventDefault();
                bar.setPointerCapture(e.pointerId);

                const startX = e.clientX;
                
                // Use current visual width as start point
                const panel = side === 'left' ? nav : tools;
                const rect = panel.getBoundingClientRect();
                const startWidth = rect.width;

                let isDragging = false;

                const onPointerMove = (evt) => {
                    const diff = evt.clientX - startX;
                    if (!isDragging && Math.abs(diff) > 5) {
                        isDragging = true;
                        document.body.style.cursor = 'ew-resize';
                        bar.style.cursor = 'ew-resize';
                    }

                    if (isDragging) {
                        let newWidth = side === 'left' ? startWidth + diff : startWidth - diff;
                        
                        const min = 250;
                        const trigger = min / 2;

                        if (newWidth < trigger) {
                            if (side === 'left') state.nav.minimized = true;
                            else state.tools.minimized = true;
                        } else {
                            if (newWidth < min) newWidth = min;
                            if (newWidth > 800) newWidth = 800;

                            if (side === 'left') {
                                state.nav.width = newWidth;
                                state.nav.minimized = false;
                            } else {
                                state.tools.width = newWidth;
                                state.tools.minimized = false;
                            }
                        }

                        apply();
                    }
                };

                const onPointerUp = (evt) => {
                    document.body.style.cursor = '';
                    bar.style.cursor = '';
                    bar.releasePointerCapture(evt.pointerId);
                    bar.removeEventListener('pointermove', onPointerMove);
                    bar.removeEventListener('pointerup', onPointerUp);
                    
                    if (!isDragging) {
                        // Treat as click/toggle
                        if (side === 'left') state.nav.minimized = !state.nav.minimized;
                        else state.tools.minimized = !state.tools.minimized;
                        apply();
                    }
                };

                bar.addEventListener('pointermove', onPointerMove);
                bar.addEventListener('pointerup', onPointerUp);
            });
        }

        setupDrag(navBar, 'left');
        setupDrag(toolsBar, 'right');

        apply();
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
                isOffline: false
            })
            selectedValueToSet = '_simulation'
        } else if (mode === 'serial') {
            if (!('serial' in navigator)) {
                newOptions.push({
                    type: 'option',
                    value: '_none',
                    label: 'Serial not supported',
                    subtitle: null,
                    disabled: true
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
                    const getStoredInfo = (usbKey) => {
                        const stored = this.#editor.project?.serialDeviceNames?.[usbKey]
                        if (!stored) return null
                        if (typeof stored === 'string') {
                            return { name: stored, created: 0, lastConnected: 0 }
                        }
                        return stored
                    }

                    // Collect all potential options first
                    const allDevices = []

                    // 1. Online Ports
                    ports.forEach((port, index) => {
                        const info = port.getInfo()
                        const isConnected = this.#editor.device_manager?.connected && 
                                           this.#editor.device_manager?.connection?.serial?.port === port
                        
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
                            portIndex: index // Helper for connection lookup fallback
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
                            const lastConnected = typeof entry === 'string' ? 0 : (entry.lastConnected || 0)
                            
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
                                lastConnected
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
                            disabled: true
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
                    newOptions.push({ type: 'separator', text: '' })
                    newOptions.push({
                        type: 'option',
                        value: '_action_new_device',
                        label: '+ Connect new device',
                        subtitle: null,
                        disabled: isReconnecting,
                        isConnected: false,
                        isOffline: false
                    })

                } catch (err) {
                    console.error('Failed to get paired devices:', err)
                    newOptions.push({
                        type: 'option',
                        value: '_error',
                        label: 'Error loading devices',
                        subtitle: null,
                        disabled: true
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
            const alreadyConnected = this.#editor.device_manager?.connected && 
                                     this.#editor.device_manager?.connection?.serial?.port === port
            
            if (alreadyConnected) {
                // Disconnect
                await this.#editor.device_manager.disconnect(true)
                this.active_mode = 'edit'
                this.device_online_button.innerText = '○'
                this.device_online_button.title = 'Connect'
                this.device_online_button.style.background = '#1fba5f'
                this.device_online_button.style.color = '#fff'
                this.device_info.innerHTML = ''
                return
            }
            
            // Connect to the selected port
            this.device_online_button.setAttribute('disabled', 'disabled')
            this.device_online_button.innerText = '----------'
            
            const dm = this.#editor.device_manager
            await dm.connect({
                target: 'serial',
                baudrate: 115200,
                port: port
            })
            
            if (dm.connected) {
                this.active_mode = 'online'
                this.active_device = 'serial'  // Set to serial for proper highlight colors
                this.device_online_button.innerText = '✕'
                this.device_online_button.title = 'Disconnect'
                this.device_online_button.style.background = '#dc3545'
                this.device_online_button.style.color = '#fff'
                
                const info = dm.deviceInfo
                if (info) {
                    this.device_info.innerHTML = `
                        <div class="device-name">${info.device || 'Unknown Device'}</div>
                        <div class="device-meta">${info.arch} ${info.version ? 'v' + info.version : ''}</div>
                    `
                }
                
                // Don't call updateDeviceDropdown here - it's already called by the connection status handler
            }
        } catch (err) {
            console.error('Failed to connect to paired device:', err)
            this.logToConsole(`Failed to connect: ${err.message || err}`, 'error')
        } finally {
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
