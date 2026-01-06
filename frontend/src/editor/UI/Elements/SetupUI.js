import { CSSimporter } from "../../../utils/tools.js"
import { Popup } from "./components/popup.js"

const importCSS = CSSimporter(import.meta.url)
await importCSS('./EditorUI.css')

export default class SetupUI {
    id = 'setup'
    hidden = false
    div
    header
    body
    master

    /** @param { import("../../Editor.js").VovkPLCEditor } master */
    constructor(master) {
        this.master = master
        
        const div = document.createElement('div')
        div.classList.add('plc-editor', 'setup-editor')
        this.div = div
        
        const frame = master.workspace.querySelector('.plc-window-frame')
        if (!frame) throw new Error('Frame not found')
        this.frame = frame
        frame.appendChild(div)

        this.render()
        
        // Poll for connection status changes since DeviceManager doesn't emit events
        this._pollInterval = setInterval(() => {
            if (this.hidden) return
            const wasConnected = this._lastConnectedState
            const isConnected = !!(this.master.device_manager && this.master.device_manager.connected)
            
            if (wasConnected !== isConnected) {
                this._lastConnectedState = isConnected
                this.render()
            }
        }, 1000)
    }

    async render() {
        // Ensure default values exist in project
        const project = this.master.project
        if (!project.info) project.info = { type: 'VovkPLC', version: '1.0.0', capacity: 1024 }
        if (!project.offsets) {
            project.offsets = {
                control: { offset: 0, size: 1024 },
                input: { offset: 1024, size: 1024 },
                output: { offset: 2048, size: 1024 },
                memory: { offset: 3072, size: 4096 },
                system: { offset: 7168, size: 1024 }
            }
        }

        const info = project.info
        const offsets = project.offsets
        
        let deviceInfo = null
        let connected = false
        if (this.master.device_manager && this.master.device_manager.connected && this.master.device_manager.connection) {
             connected = true
             // Use cached device info if available, otherwise it will show placeholders until next update
             if (this.master.device_manager.deviceInfo) {
                 deviceInfo = this.master.device_manager.deviceInfo
             }
        }

        // Default to placeholders if no info
        const dInfo = deviceInfo || {
            device: '-', arch: '-', version: '-', date: '-',
            program: '-', memory: '-', stack: '-', 
            input_size: '-', input_offset: '-',
            output_size: '-', output_offset: '-'
        }

        const cardStyle = `background: #252526; padding: 15px; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); margin-bottom: 15px; border: 1px solid #333;`
        const labelStyle = `display: block; font-weight: 600; margin-bottom: 4px; color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;`
        const inputStyle = `width: 100%; padding: 4px 6px; background: #3c3c3c; border: 1px solid #333; border-radius: 3px; color: #fff; font-family: consolas, monospace; font-size: 12px; height: 26px; box-sizing: border-box;`
        const headerStyle = `margin-top: 0; margin-bottom: 15px; color: #fff; font-size: 14px; border-bottom: 1px solid #333; padding-bottom: 8px; font-weight: 600;`
        const gridStyle = `display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; align-items: end;`
        const btnStyle = `display: inline-flex; align-items: center; justify-content: center; height: 26px; padding: 0 15px; cursor: pointer; border-radius: 3px; font-size: 12px; border: none; outline: none; box-sizing: border-box;`

        this.div.innerHTML = /*HTML*/`
            <div class="plc-editor-top">
                <div class="plc-editor-header">
                    <h2 style="margin-top: 0px; margin-bottom: 3px;">Device Configuration</h2>
                    <p>System Settings, Memory Map, and Device Synchronization</p>
                </div>
            </div>
            <div class="plc-editor-body" style="padding: 15px; overflow: auto; background: #1e1e1e; color: #ccc;">
                
                <!-- Synchronization Card -->
                <div style="${cardStyle}">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h3 style="margin:0; color: #fff; font-size: 15px;">Device Synchronization</h3>
                        <div style="padding: 2px 8px; border-radius: 3px; font-weight: bold; font-size: 10px; letter-spacing: 0.5px; ${connected ? 'background: #0e639c; color: #fff;' : 'background: #3a1d1d; color: #f48771; border: 1px solid #5a1d1d;'}">
                            ${connected ? 'CONNECTED' : 'DISCONNECTED'}
                        </div>
                    </div>
                    
                    <p style="color: #bbb; font-size: 12px; margin-bottom: 15px; line-height: 1.4;">
                        Manage configuration sync between local project and PLC. 
                    </p>

                    <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px;">
                        <button id="setup-read-config" class="plc-btn" ${!connected ? 'disabled' : ''} style="${btnStyle} background: #3c3c3c; color: #fff; border: 1px solid #555;">
                            <span class="plc-icon plc-icon-download" style="margin-right: 6px;"></span> Read Config
                        </button>
                         <button id="setup-read-program" class="plc-btn" ${!connected ? 'disabled' : ''} style="${btnStyle} background: #3c3c3c; color: #fff; border: 1px solid #555;">
                            <span class="plc-icon plc-icon-download" style="margin-right: 6px;"></span> Read Program
                        </button>
                         <button id="setup-read-project" class="plc-btn" ${!connected ? 'disabled' : ''} style="${btnStyle} background: #3c3c3c; color: #fff; border: 1px solid #555;">
                            <span class="plc-icon plc-icon-download" style="margin-right: 6px;"></span> Read Project
                        </button>
                    </div>

                    <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px;">
                        <button id="setup-compile" class="plc-btn" style="${btnStyle} background: #3c3c3c; color: #fff; border: 1px solid #555;">
                            <span class="plc-icon plc-icon-gears" style="margin-right: 6px;"></span> Compile
                        </button>
                        <button id="setup-write-config" class="plc-btn" ${!connected ? 'disabled' : ''} style="${btnStyle} background: #3a3d41; color: #fff; border: 1px solid #454545;">
                            <span class="plc-icon plc-icon-upload" style="margin-right: 6px;"></span> Write Config
                        </button>
                        <button id="setup-write-program" class="plc-btn" ${!connected ? 'disabled' : ''} style="${btnStyle} background: #3a3d41; color: #fff; border: 1px solid #454545;">
                            <span class="plc-icon plc-icon-upload" style="margin-right: 6px;"></span> Write Program
                        </button>
                        <button id="setup-write-project" class="plc-btn" ${!connected ? 'disabled' : ''} style="${btnStyle} background: #0078d4; color: white; border: 1px solid #0078d4;">
                            <span class="plc-icon plc-icon-upload" style="margin-right: 6px;"></span> Write Project
                        </button>
                    </div>

                    <div style="padding-top: 15px; border-top: 1px solid #333;">
                        <h4 style="${headerStyle} border: none; padding: 0;">Connected Device Info</h4>
                        <div style="${gridStyle} margin-top: 10px;">
                             ${this.renderReadOnlyField('Device Name', dInfo.device)}
                             ${this.renderReadOnlyField('Architecture', dInfo.arch)}
                             ${this.renderReadOnlyField('Firmware', dInfo.version)}
                             ${this.renderReadOnlyField('Built', dInfo.date)}
                             ${this.renderReadOnlyField('Program Size', dInfo.program !== '-' ? dInfo.program + ' bytes' : '-')}
                             ${this.renderReadOnlyField('Memory Size', dInfo.memory !== '-' ? dInfo.memory + ' bytes' : '-')}
                             ${this.renderReadOnlyField('Stack Size', dInfo.stack !== '-' ? dInfo.stack + ' bytes' : '-')}
                             ${this.renderReadOnlyField('IO Inputs', dInfo.input_size !== '-' ? `${dInfo.input_size} bytes @ ${dInfo.input_offset}` : '-')}
                             ${this.renderReadOnlyField('IO Outputs', dInfo.output_size !== '-' ? `${dInfo.output_size} bytes @ ${dInfo.output_offset}` : '-')}
                        </div>
                    </div>
                </div>

                <!-- Project Settings Card -->
                <div style="${cardStyle}">
                    <h3 style="${headerStyle}">Active Project Configuration</h3>
                    
                    <!-- Header Fields Grid -->
                    <div style="${gridStyle} margin-bottom: 25px;">
                        <div>
                            <label style="${labelStyle}">Target PLC Type</label>
                            <input type="text" id="setup-type" value="${info.type || ''}" style="${inputStyle}">
                        </div>
                        
                        ${this.renderReadOnlyField('Architecture', 'WASM (Emulated)')}

                        <div>
                            <label style="${labelStyle}">Required Version</label>
                            <input type="text" id="setup-version" value="${info.version || ''}" style="${inputStyle}">
                        </div>

                        ${this.renderReadOnlyField('Built', info.date || '-')}

                        <div>
                            <label style="${labelStyle}">Allocated Capacity</label>
                            <input type="number" id="setup-capacity" value="${info.capacity || 0}" style="${inputStyle}">
                        </div>

                         ${this.renderReadOnlyField('Memory Size', (offsets.memory.size + offsets.control.size + offsets.system.size) + ' bytes (est)')}
                         ${this.renderReadOnlyField('Stack Size', info.stack ? info.stack + ' bytes' : '-')}

                         ${this.renderReadOnlyField('IO Inputs', `${offsets.input.size} bytes @ ${offsets.input.offset}`)}
                         ${this.renderReadOnlyField('IO Outputs', `${offsets.output.size} bytes @ ${offsets.output.offset}`)}
                    </div>

                    <h4 style="color: #fff; font-size: 13px; margin-bottom: 10px; font-weight: 600;">Memory Map</h4>
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                        <thead>
                            <tr style="text-align: left; border-bottom: 1px solid #333; color: #888;">
                                <th style="padding: 8px;">Area</th>
                                <th style="padding: 8px;">Start Offset (decimal)</th>
                                <th style="padding: 8px;">Size (bytes)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.renderOffsetRow('Control (C)', 'control', offsets.control)}
                            ${this.renderOffsetRow('Input (I)', 'input', offsets.input)}
                            ${this.renderOffsetRow('Output (Q)', 'output', offsets.output)}
                            ${this.renderOffsetRow('Memory (M)', 'memory', offsets.memory)}
                            ${this.renderOffsetRow('System (S)', 'system', offsets.system)}
                        </tbody>
                    </table>
                </div>

            </div>
        `

        this.bindEvents()
    }

    renderReadOnlyField(label, value) {
        const labelStyle = `display: block; font-weight: 600; margin-bottom: 4px; color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;`
        const valueStyle = `width: 100%; padding: 0; color: #ddd; font-family: consolas, monospace; font-size: 12px; height: 26px; display: flex; align-items: center; box-sizing: border-box;`
        return `<div><label style="${labelStyle}">${label}</label><div style="${valueStyle}">${value || '-'}</div></div>`
    }

    renderOffsetRow(label, key, data) {
        const inputStyle = `width: 120px; padding: 4px 6px; background: #3c3c3c; border: 1px solid #333; border-radius: 3px; color: #ccc; font-family: consolas, monospace; height: 24px; box-sizing: border-box;`
        return `
            <tr style="border-bottom: 1px solid #333;">
                <td style="padding: 8px 10px; color: #bbb;">${label}</td>
                <td style="padding: 4px 10px;">
                    <input type="number" data-key="${key}" data-field="offset" value="${data ? data.offset : 0}" class="tc-input setup-offset-input" style="${inputStyle}">
                </td>
                <td style="padding: 4px 10px;">
                    <input type="number" data-key="${key}" data-field="size" value="${data ? data.size : 0}" class="tc-input setup-offset-input" style="${inputStyle}">
                </td>
            </tr>
        `
    }

    bindEvents() {
        const project = this.master.project
        
        const typeInput = this.div.querySelector('#setup-type')
        const versionInput = this.div.querySelector('#setup-version')
        const capacityInput = this.div.querySelector('#setup-capacity')

        typeInput.onchange = (e) => { project.info.type = e.target.value }
        versionInput.onchange = (e) => { project.info.version = e.target.value }
        capacityInput.onchange = (e) => { project.info.capacity = parseInt(e.target.value) || 0 }

        const offsetInputs = this.div.querySelectorAll('.setup-offset-input')
        offsetInputs.forEach(input => {
            input.onchange = (e) => {
                const key = e.target.dataset.key
                const field = e.target.dataset.field
                const val = parseInt(e.target.value) || 0
                
                if (!project.offsets[key]) project.offsets[key] = { offset: 0, size: 0 }
                project.offsets[key][field] = val
            }
        })

        const readConfigBtn = this.div.querySelector('#setup-read-config')
        const readProgramBtn = this.div.querySelector('#setup-read-program')
        const readProjectBtn = this.div.querySelector('#setup-read-project')

        const compileBtn = this.div.querySelector('#setup-compile')
        const writeConfigBtn = this.div.querySelector('#setup-write-config')
        const writeProgramBtn = this.div.querySelector('#setup-write-program')
        const writeProjectBtn = this.div.querySelector('#setup-write-project')

        if (readConfigBtn) {
            readConfigBtn.onclick = async () => {
                if (!this.master.device_manager.connected) return

                const confirm1 = await Popup.confirm({
                    title: 'Read Device Configuration',
                    description: 'This will overwrite your local project configuration (Type, Offsets, Sizes) with the settings from the connected device.\n\nAre you sure you want to continue?'
                })
                if (!confirm1) return

                try {
                     // Force refresh info
                     const info = await this.master.device_manager.connection.getInfo(true)
                     // If fresh info obtained, update
                     if (info) this.updateProjectConfig(info)
                } catch (e) {
                    console.error('Failed to read config', e)
                }
            }
        }
        
        if (readProgramBtn) {
             readProgramBtn.onclick = async () => {
                 console.log('Read program clicked')
                 // Only log for now
             }
        }
        if (readProjectBtn) {
             readProjectBtn.onclick = async () => {
                 console.log('Read project clicked')
             }
        }

        if (compileBtn) {
            compileBtn.onclick = async () => {
                if (!this.master.runtime_ready) {
                     await Popup.confirm({ title: 'Compiler Error', description: 'WASM Runtime is not ready yet.' })
                     return
                }

                try {
                    console.log('Compiling...')
                    const result = this.master.project_manager.compile()
                    
                    this.compiledBytecode = result.output
                    this.compiledSize = result.size
                    
                    console.log('Compilation successful', result)
                    await Popup.confirm({ title: 'Compilation Successful', description: `Compiled ${result.size} bytes.` })
                } catch (e) {
                    console.error('Compilation failed', e)
                    await Popup.confirm({ title: 'Compilation Failed', description: e.message })
                }
            }
        }

        if (writeConfigBtn) {
            writeConfigBtn.onclick = async () => {
                 console.log('Write config clicked')
                 await Popup.confirm({ title: 'Write Config', description: 'Writing configuration is not supported by the current firmware protocol.' })
            }
        }

        if (writeProgramBtn) {
             writeProgramBtn.onclick = async () => {
                 if (!this.master.device_manager.connected) return
                 if (!this.compiledBytecode) {
                      await Popup.confirm({ title: 'Write Program', description: 'No compiled program found. Please Compile first.' })
                      return
                 }
                 
                 const confirm = await Popup.confirm({
                    title: 'Write Program',
                    description: `Upload ${this.compiledSize} bytes to the device? This will stop the current program.`
                 })
                 if (!confirm) return

                 try {
                     // Pass the HEX string directly. 
                     // The runtime (Simulation) and buildCommand (Serial) both handle hex strings or plain arrays better than Uint8Array.
                     await this.master.device_manager.connection.downloadProgram(this.compiledBytecode)
                     await Popup.confirm({ title: 'Success', description: 'Program uploaded successfully.' })
                 } catch (e) {
                      console.error('Write failed', e)
                      await Popup.confirm({ title: 'Upload Failed', description: e.message })
                 }
             }
        }

        if (writeProjectBtn) {
             writeProjectBtn.onclick = async () => {
                 console.log('Write project clicked')
                  await Popup.confirm({ title: 'Write Project', description: 'Write Program + Config.' })
             }
        }
    }

    updateProjectConfig(info) {
        const project = this.master.project
        if (info.device) project.info.type = info.device
        if (info.arch) project.info.arch = info.arch
        if (info.version) project.info.version = info.version
        if (info.program) project.info.capacity = info.program
        if (info.date) project.info.date = info.date
        if (info.stack) project.info.stack = info.stack
        
        // Map known offsets if available in info
        if (typeof info.input_offset !== 'undefined') {
            project.offsets.input = { offset: info.input_offset, size: info.input_size }
        }
        if (typeof info.output_offset !== 'undefined') {
            project.offsets.output = { offset: info.output_offset, size: info.output_size }
        }
        
        this.render() // Refresh UI
    }
    
    hide() {
        this.hidden = true
        this.div.classList.add('hidden')
    }
    
    show() {
        this.hidden = false
        this.div.classList.remove('hidden')
        // Refresh values in case they changed externally
        this.render() 
    }

    reloadProgram() {
        this.render()
    }
}
