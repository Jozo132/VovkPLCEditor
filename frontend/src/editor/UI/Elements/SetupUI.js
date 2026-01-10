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
    locked = false

    /** @param { import("../../Editor.js").VovkPLCEditor } master */
    constructor(master) {
        this.master = master
        
        const div = document.createElement('div')
        div.classList.add('plc-editor', 'setup-editor')
        this.div = div
        
        const frame = master.workspace.querySelector('.plc-window-frame')
        if (!frame) throw new Error('Frame not found')
        this.frame = frame
        this.frame.appendChild(div)

        this.render()
        
        this._handleDeviceUpdate = () => {
             if (!this.hidden) this.render()
        }

        // Listen for device updates (connection status, info loaded, etc)
        this.master.workspace.addEventListener('plc-device-update', this._handleDeviceUpdate)
    }

    close() {
        if (this.div) this.div.remove()
        if (this._handleDeviceUpdate) {
            this.master.workspace.removeEventListener('plc-device-update', this._handleDeviceUpdate)
        }
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
        } else if (this.master.device_manager && this.master.device_manager.deviceInfo) {
             // Retain old info if available
             deviceInfo = this.master.device_manager.deviceInfo
        }

        // Default to placeholders if no info
        const dInfo = deviceInfo || {
            device: '-', arch: '-', version: '-', date: '-',
            program: '-', memory: '-', stack: '-', 
            input_size: '-', input_offset: '-',
            output_size: '-', output_offset: '-'
        }
        
        // Custom SVG Icons
        const iconCompile = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 0-1 0v6z"/><path d="M3 11.5h2v2h-2zM7 11.5h2v2h-2zM11 11.5h2v2h-2zM5 8.5h2v2h-2zM9 8.5h2v2h-2z"/></svg>` // Tray with parts
        const iconUpload = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12a.5.5 0 0 1-.5-.5V5.707l-2.146 2.147a.5.5 0 0 1-.708-.708l3-3a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 5.707V11.5a.5.5 0 0 1-.5.5z"/><path d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 0-1 0v6z"/></svg>` // Arrow up
        const iconDownload = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4a.5.5 0 0 1 .5.5v5.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 10.293V4.5A.5.5 0 0 1 8 4z"/><path d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 0-1 0v6z"/></svg>` // Arrow down

        const lockSettings = this.locked
        this.div.innerHTML = /*HTML*/`
            <div class="plc-editor-top">
                <div class="plc-editor-header">
                    <h2 style="margin-top: 0px; margin-bottom: 3px;">Device Configuration</h2>
                    <p>System Settings and Memory Map</p>
                </div>
            </div>
            <div class="plc-editor-body setup-body">
                
                <!-- Main Configuration Card -->
                <div class="setup-card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h3 style="margin:0; color: #fff; font-size: 15px;">Configuration & Status</h3>
                        <div id="setup-device-status-badge" style="padding: 2px 8px; border-radius: 3px; font-weight: bold; font-size: 10px; letter-spacing: 0.5px; ${connected ? 'background: #0e639c; color: #fff;' : 'background: #3a1d1d; color: #f48771; border: 1px solid #5a1d1d;'}">
                            ${connected ? 'DEVICE CONNECTED' : 'NO DEVICE'}
                        </div>
                    </div>

                    <!-- Comparison Table -->
                    <table class="setup-comparison-table">
                        <thead>
                            <tr style="text-align: left; border-bottom: 1px solid #333; color: #888;">
                                <th style="width: 25%;">Property</th>
                                <th style="width: 37.5%; color: #4ec9b0;">Project</th>
                                <th style="width: 37.5%; color: #ce9178;">Device</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.renderCompareRow('Device Type', info.type || '-', dInfo.device, connected)}
                            ${this.renderCompareRow('Architecture', info.arch || '-', dInfo.arch, connected)}
                            ${this.renderCompareRow('Firmware Ver', info.version || '-', dInfo.version, connected)}
                            ${this.renderCompareRow('Built Date', info.date || '-', dInfo.date, connected)}
                            ${this.renderCompareRow('Capacity', (info.capacity || 0) + ' bytes', dInfo.program !== '-' ? (parseInt(dInfo.program) || 0) + ' bytes' : '-', connected)}
                            ${this.renderCompareRow('IO Inputs', `${offsets.input.size}B @ ${offsets.input.offset}`, dInfo.input_size !== '-' ? `${dInfo.input_size}B @ ${dInfo.input_offset}` : '-', connected)}
                            ${this.renderCompareRow('IO Outputs', `${offsets.output.size}B @ ${offsets.output.offset}`, dInfo.output_size !== '-' ? `${dInfo.output_size}B @ ${dInfo.output_offset}` : '-', connected)}
                        </tbody>
                    </table>

                    <!-- Action Buttons -->
                    <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 15px; padding-top: 15px; border-top: 1px solid #333;">
                        <button id="setup-read-config" class="plc-btn setup-btn" ${(!connected || lockSettings) ? 'disabled' : ''} style="background: #3c3c3c; color: #eee; border: 1px solid #555;">
                            <span style="margin-right: 8px; display: flex; transform: translateY(-1.5px);">${iconUpload}</span> Load PLC Configuration
                        </button>
                        
                        <div style="width: 1px; background: #444; margin: 0 5px;"></div>

                        <button id="setup-upload-plc" title="Upload program from PLC to PC" class="plc-btn setup-btn" ${(!connected || lockSettings) ? 'disabled' : ''} style="background: #3c3c3c; color: #eee; border: 1px solid #555;">
                            <span style="margin-right: 8px; display: flex; transform: translateY(-1.5px);">${iconUpload}</span> Upload from PLC
                        </button>

                         <button id="setup-compile" class="plc-btn setup-btn" ${!connected ? 'disabled' : ''} style="background: #3c3c3c; color: #eee; border: 1px solid #555;">
                            <span style="margin-right: 8px; display: flex; transform: translateY(-1.5px);">${iconCompile}</span> Compile Project
                        </button>

                        <button id="setup-download-plc" title="Download compiled program to PLC" class="plc-btn setup-btn" ${!connected ? 'disabled' : ''} style="background: #0078d4; color: white; border: 1px solid #0078d4;">
                            <span style="margin-right: 8px; display: flex; transform: translateY(-1.5px);">${iconDownload}</span> Download to PLC
                        </button>
                    </div>
                </div>

                <!-- Memory Map -->
                <div class="setup-card" style="border-top: 3px solid #3c3c3c;">
                    <h4 style="color: #fff; font-size: 13px; margin: 0 0 15px 0; font-weight: 600;">Memory Map Settings</h4>
                    <table class="setup-comparison-table">
                        <thead>
                            <tr style="text-align: left; border-bottom: 1px solid #333; color: #888;">
                                <th>Area</th>
                                <th>Start Offset (decimal)</th>
                                <th>Size (bytes)</th>
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

    renderCompareRow(label, projVal, devVal, connected = true) {
        const isDiff = projVal !== devVal && devVal !== '-' && projVal !== '-'
        const style = isDiff ? 'color: #fce9a6;' : 'color: #ccc;'
        const devStyle = connected ? (isDiff ? 'color: #f48771;' : 'color: #aaa;') : 'color: #666;'
        
        return `
            <tr style="border-bottom: 1px solid #333;">
                <td style="padding: 8px; color: #bbb;">${label}</td>
                <td style="padding: 8px; font-family: consolas, monospace; ${style}">${projVal}</td>
                <td style="padding: 8px; font-family: consolas, monospace; ${devStyle}">${devVal}</td>
            </tr>
        `
    }

    renderReadOnlyField(label, value) {
        const labelStyle = `display: block; font-weight: 600; margin-bottom: 4px; color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;`
        const valueStyle = `width: 100%; padding: 0; color: #ddd; font-family: consolas, monospace; font-size: 12px; height: 26px; display: flex; align-items: center; box-sizing: border-box;`
        return `<div><label style="${labelStyle}">${label}</label><div style="${valueStyle}">${value || '-'}</div></div>`
    }

    renderOffsetRow(label, key, data) {
        return `
            <tr style="border-bottom: 1px solid #333;">
                <td style="padding: 8px 10px; color: #bbb;">${label}</td>
                <td style="padding: 4px 10px;">
                    <input type="number" data-key="${key}" data-field="offset" value="${data ? data.offset : 0}" class="tc-input setup-offset-input" ${this.locked ? 'disabled' : ''}>
                </td>
                <td style="padding: 4px 10px;">
                    <input type="number" data-key="${key}" data-field="size" value="${data ? data.size : 0}" class="tc-input setup-offset-input" ${this.locked ? 'disabled' : ''}>
                </td>
            </tr>
        `
    }

    bindEvents() {
        const project = this.master.project

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
        const uploadPlcBtn = this.div.querySelector('#setup-upload-plc')
        
        const compileBtn = this.div.querySelector('#setup-compile')
        const downloadPlcBtn = this.div.querySelector('#setup-download-plc')

        if (readConfigBtn) {
            readConfigBtn.onclick = async () => {
                if (!this.master.device_manager.connected) return

                const confirm1 = await Popup.confirm({
                    title: 'Load PLC Configuration',
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
        
        if (uploadPlcBtn) {
             uploadPlcBtn.onclick = async () => {
                 console.log('Upload from PLC clicked')
                 // Only log for now as reading program source back is not fully implemented
                  await Popup.confirm({ title: 'Upload from PLC', description: 'Reading program from PLC is not yet supported.' })
             }
        }

        if (compileBtn) {
            compileBtn.onclick = async () => {
                // Delegate to centralized handler
                await this.master.window_manager.handleCompile()
            }
        }

        if (downloadPlcBtn) {
             downloadPlcBtn.onclick = async () => {
                 // Delegate to centralized handler
                 await this.master.window_manager.handleDownload()
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

    updateConnectionStatus(connected) {
        // Update badge
        const badge = this.div.querySelector('#setup-device-status-badge')
        if (badge) {
            if (connected) {
                badge.style.background = '#0e639c'
                badge.style.color = '#fff'
                badge.style.border = 'none'
                badge.innerText = 'DEVICE CONNECTED'
            } else {
                badge.style.background = '#3a1d1d'
                badge.style.color = '#f48771'
                badge.style.border = '1px solid #5a1d1d'
                badge.innerText = 'NO DEVICE'
            }
        }

        // Update Buttons
        const btns = ['#setup-read-config', '#setup-upload-plc']
        btns.forEach(sel => {
            const btn = this.div.querySelector(sel)
            if (btn) {
                if (connected && !this.locked) {
                    btn.removeAttribute('disabled')
                } else {
                    btn.setAttribute('disabled', 'disabled')
                }
            }
        })

        const compileBtn = this.div.querySelector('#setup-compile')
        if (compileBtn) {
            if (connected) {
                compileBtn.removeAttribute('disabled')
            } else {
                compileBtn.setAttribute('disabled', 'disabled')
            }
        }
        const downloadBtn = this.div.querySelector('#setup-download-plc')
        if (downloadBtn) {
            if (connected) {
                downloadBtn.removeAttribute('disabled')
            } else {
                downloadBtn.setAttribute('disabled', 'disabled')
            }
        }

        const offsetInputs = this.div.querySelectorAll('.setup-offset-input')
        offsetInputs.forEach(input => {
            if (this.locked) {
                input.setAttribute('disabled', 'disabled')
            } else {
                input.removeAttribute('disabled')
            }
        })
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

    setLocked(locked = true) {
        this.locked = !!locked
        this.render()
    }
}
