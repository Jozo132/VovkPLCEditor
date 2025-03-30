// @ts-check
"use strict"

import { PLCEditor } from "../../utils/types.js"
import { ElementSynthesis } from "../../utils/tools.js"
import { ConnectionOptions } from "../../connection/index.js"





export default class WindowManager {

    /** @type {'edit' | 'online'} */
    active_mode = 'edit'

    /** @type {'simulation' | 'device'} */
    active_device = 'simulation'

    workspace_body

    #editor
    /** @param {PLCEditor} editor */
    constructor(editor) {
        this.#editor = editor
        const workspace = this.#editor.workspace


        this.workspace_body = ElementSynthesis(/*HTML*/`
            <div class="plc-workspace-header">
                <p>VovkPLC Editor - Preview</p>
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
        navigation_minimize_button.addEventListener('click', () => {
            const navigation = workspace.querySelector('.plc-navigation')
            if (!navigation) throw new Error('Navigation not found')
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
        })
        tools_minimize_button.addEventListener('click', () => {
            const tools = workspace.querySelector('.plc-tools')
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
        })

        this.setDeviceOptions(this.#editor.device_manager.devices)

        const device_info = workspace.querySelector('.plc-device-info')
        if (!device_info) throw new Error('Device info element not found')

        const device_select_element = workspace.querySelector('.plc-device-dropdown select')
        if (!device_select_element) throw new Error('Device select element not found')
        device_select_element.addEventListener('change', () => { // @ts-ignore
            const value = device_select_element.value
            this.active_device = value
        })

        const device_online_button = workspace.querySelector('.plc-device-online')
        if (!device_online_button) throw new Error('Device online button not found')
        device_online_button.addEventListener('click', async () => {
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
        })
    }


    /** @type { (device: string) => Promise<boolean> } */
    requestConnect = async (device) => {
        /** @type { ConnectionOptions | null } */
        let options = null
        if (device === 'simulation') {
            options = {
                target: 'simulation'
            }
        }
        if (device === 'serial') {
            options = {
                target: 'serial',
                baudrate: 115200
            }
        }
        if (!options) {
            console.error('No connection options provided')
            return false
        }
        const connection = await this.#editor.device_manager.connect(options)
        const connected = connection && !this.#editor.device_manager.error
        return !!connected
    }

    setMode = (mode) => {
        this.mode = mode
        const workspace = this.#editor.workspace
    }
    setDevice = (device) => {
        this.device = device
    }

    /** @param { { name: string, key: string, disabled?: string }[] } options */
    setDeviceOptions = (options) => {
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
        const workspace = this.#editor.workspace


    }
}