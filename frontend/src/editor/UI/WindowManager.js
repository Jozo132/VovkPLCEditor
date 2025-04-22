// @ts-check
"use strict"

import { PLC_Project, PLCEditor } from "../../utils/types.js"
import { ElementSynthesisMany, getEventPath, isVisible } from "../../utils/tools.js"
import NavigationTreeManager from "./Elements/NavigationTreeManager.js"
import TabManager from "./Elements/TabManager.js"
import EditorUI from "./Elements/EditorUI.js"


/** @typedef { EditorUI } WindowType */

export default class WindowManager {

    /** @type {'edit' | 'online'} */
    active_mode = 'edit'

    /** @type {'simulation' | 'device'} */
    active_device = 'simulation'

    workspace_body


    /** @type { Map<string, WindowType> } */
    windows = new Map(); // filePath → { tabEl, editorEl }

    window_frame

    /** @type { (device: string) => Promise<boolean> } */
    requestConnect = async (device) => false

    highlightItem = (element) => this.tree_manager.highlightItem(element)
    removeHighlight = () => this.tree_manager.removeHighlight()

    #editor
    /** @param {PLCEditor} editor */
    constructor(editor) {
        this.#editor = editor
        const workspace = this.#editor.workspace
        this.workspace = workspace

        this.workspace_body = ElementSynthesisMany(/*HTML*/`
            <div class="plc-workspace-header">
                <p>VovkPLC Editor</p>
            </div>
            <div class="plc-workspace-body">
                <div class="plc-navigation no-select resizable" style="width: 220px">
                    <div class="plc-navigation-container">
                        <!--h3>Navigation</h3-->
                        <div class="plc-device">
                            <!-- Left side: dropdown with options 'Device' and 'Simulation,  the right side: button for going online with text content 'Go online'  -->
                            <div class="plc-device-dropdown">
                                <select>
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
                    </div>
                    <div class="resizer right"></div>
                    <div class="plc-navigation-bar">
                        <div class="menu-button">-</div>
                        <span class="thick text-rotate" style="margin: auto auto; margin-top: 5px; font-size: 0.6em;">Navigation</span>
                    </div>
                </div>
                <div class="plc-window">
                    <div class="plc-window-tabs"></div>
                    <div class="plc-window-frame"></div>
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
            <div class="plc-workspace-footer">
                <p>Footer</p>
            </div>
        `)

        this.workspace_body.forEach(element => workspace.appendChild(element))


        const navigation_minimize_button = workspace.querySelector('.plc-navigation-bar .menu-button')
        const tools_minimize_button = workspace.querySelector('.plc-tools-bar .menu-button')
        if (!navigation_minimize_button) throw new Error('Navigation minimize button not found')
        if (!tools_minimize_button) throw new Error('Tools minimize button not found')
        navigation_minimize_button.addEventListener('click', () => this.#on_navigation_minimize_toggle())
        tools_minimize_button.addEventListener('click', () => this.#on_tools_minimize_toggle())

        const device_info = workspace.querySelector('.plc-device-info')
        if (!device_info) throw new Error('Device info element not found')
        this.device_info = device_info

        const device_select_element = workspace.querySelector('.plc-device-dropdown select')
        if (!device_select_element) throw new Error('Device select element not found')
        device_select_element.addEventListener('change', () => this.#on_device_select_change())
        this.device_select_element = device_select_element

        const device_online_button = workspace.querySelector('.plc-device-online')
        if (!device_online_button) throw new Error('Device online button not found')
        device_online_button.addEventListener('click', async () => this.#on_device_online_click())
        this.device_online_button = device_online_button


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

    #on_device_select_change = () => { // @ts-ignore
        const value = this.device_select_element.value
        this.active_device = value
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
        if (mode === 'online') { // @ts-ignore
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
                return
            }
            const info = editor.device_manager.deviceInfo
            if (info) device_info.innerHTML = `${info.arch} v${info.version.split(' ')[0]}`
            else device_info.innerHTML = 'Unknown device'
        } else {
            device_info.innerHTML = ''
            await editor.device_manager.disconnect()
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

    setMode = (mode) => {
        this.mode = mode
        const workspace = this.#editor.workspace
    }
    setDevice = (device) => {
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
            const { name, key, disabled } = option
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

    get_focusable_elements = () => {
        const workspace = this.#editor.workspace
        const elems = [...workspace.querySelectorAll('[tabindex]')]
        return elems.filter((elem) => { // @ts-ignore
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
        workspace.addEventListener('keydown', (event) => {
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

                const focusable_elements = this.get_focusable_elements()
                const length = focusable_elements.length
                const index = focusable_elements.indexOf(activeElement)
                const next = index >= 0 ? focusable_elements[(index + 1) % length] : null
                const prev = index >= 0 ? focusable_elements[(index - 1 + length) % length] : null

                const clickable = tree_item || tab
                if (clickable && (enter || space)) {// @ts-ignore
                    // trigger click on the element
                    activeElement.click()
                }

                if (tree_item) {
                    if (f2) { // Trigger rename
                        const item = this.tree_manager.findItem(activeElement)
                        if (item) { // @ts-ignore
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
                        if (item) { // @ts-ignore
                            item.item.collapse()
                        }
                    }
                    if (right) {
                        const item = this.tree_manager.findItem(activeElement)
                        // console.log('Right', item)
                        if (item) { // @ts-ignore
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

        
        workspace.addEventListener('mousedown', (event) => {
            
            const middle_mouse = event.button === 1 
            
            const target = event.target
            // @ts-ignore
            const is_tab = target && target.closest(".plc-tab")

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

    onMouseMove = (event) => {
        this.#on_debug_hover(event)
    }

    #on_debug_hover = (event) => {
        if (this.#editor.debug_hover) {
            this.footer = this.footer || this.#editor.workspace.querySelector('.plc-workspace-footer p')
            const footer = this.footer
            if (!footer) throw new Error('Footer not found')
            const path = getEventPath(event, 'plc-workspace')
            if (!path || !path.length) { // @ts-ignore
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
    }

    /** @type { (id: string) => (EditorUI | undefined) } */
    createEditorWindow(id) {
        // Check if the program exists in 'this.windows'
        if (this.windows.has(id)) {
            // If it exists, return the existing editor UI
            return this.windows.get(id)
        }
        // If it doesn't exist, create a new editor UI
        const editorUI = new EditorUI(this.#editor, id)
        this.windows.set(id, editorUI)
        // Append the editor UI to the workspace
        this.window_frame.appendChild(editorUI.div)
        // Return the newly created editor UI
        return editorUI
    }

    /** @type { (id: string) => void } */
    closeProgram(id) {
        if (!id) throw new Error('Program ID not found')
        // Remove highlight from the tree
        this.#editor.window_manager.removeHighlight()
        this.windows.delete(id)
        const exists = this.windows.get(id)
        exists?.close()
        const active_program = this.#editor.findProgram(id)
        if (active_program) active_program.host = undefined
        const next_id = this.#editor.window_manager.tab_manager.closeTab(id)
        if (next_id) {
            this.#editor.window_manager.openProgram(next_id)
        } else {
            this.#editor.window_manager.active_program = undefined
        }
    }

    /** @param { string | null | undefined } id */
    openProgram(id) {
        const editor = this.#editor
        if (!id) throw new Error('Program ID not found')
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