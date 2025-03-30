// @ts-check
"use strict"

import { PLC_Project, PLCEditor } from "../../utils/types.js"
import { ElementSynthesis } from "../../utils/tools.js"
import NavigationTreeManager from "./Elements/NavigationTreeManager.js"
import TabManager from "./Elements/TabManager.js"
import EditorUI from "./Elements/EditorUI.js"

export default class WindowManager {

    /** @type {'edit' | 'online'} */
    active_mode = 'edit'

    /** @type {'simulation' | 'device'} */
    active_device = 'simulation'

    workspace_body

    /** @type { (device: string) => Promise<boolean> } */
    requestConnect = async (device) => false

    #editor
    /** @param {PLCEditor} editor */
    constructor(editor) {
        this.#editor = editor
        const workspace = this.#editor.workspace
        this.workspace = workspace

        this.workspace_body = ElementSynthesis(/*HTML*/`
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
                            <div class="plc-device-online green">Go online</div>
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


    initialize() {
        this.refreshDeviceOptions()

        const workspace = this.#editor.workspace

        // On ESC remove all selections
        workspace.addEventListener('keydown', (event) => {
            const esc = event.key === 'Escape'
            const ctrl = event.ctrlKey
            const shift = event.shiftKey
            const alt = event.altKey
            const del = event.key === 'Delete'
            const x = event.key.toLocaleLowerCase() === 'x'
            const c = event.key.toLocaleLowerCase() === 'c'
            const v = event.key.toLocaleLowerCase() === 'v'
            const a = event.key.toLocaleLowerCase() === 'a'
            // if (esc) this.deselectAll()
            // if (ctrl && c) this.copySelection()
            // if (ctrl && x) this.cutSelection()
            // if (ctrl && v) this.pasteSelection()
            // if (del) this.deleteSelection()
        })
    }

    /** @param { PLC_Project } project */
    open(project) {
        this.project = project
        this.tree_manager.draw_navigation_tree()
        // this.tab_manager.draw_tabs()
        this.refreshDeviceOptions()
        // this.#editor.draw()
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
        this.tab_manager.openTab(id, this.active_program.name)
        if (!this.active_program.host) {
            const host = new EditorUI(editor, id)
            this.active_program.host = host
            host.div.setAttribute('id', id)
        }
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