import { initializeConnection, disconnectConnection, ConnectionOptions } from "../connection/index.js"
import { PLCEditor } from "../utils/types.js"

export default class DeviceManager {
  error = ''
  connected = false
  #editor
  #intentionalDisconnect = false
  #lastSerialPortInfo = null  // Store port info instead of port reference
  #reconnectAttempting = false
  #reconnectInterval = null
  #reconnectListener = null
  #reconnectTimeout = null
  /** @param {PLCEditor} editor */
  constructor(editor) {
    this.#editor = editor
    this.connection = null
    this.options = null
    this.deviceInfo = null
  }

  /** @type { { name: string, key: string, disabled?: string }[] } */
  devices = [
    { name: 'Simulation', key: 'simulation' },
    { name: 'Serial Port', key: 'serial', disabled: 'serial' in navigator ? '' : 'Serial not supported' },
    // { name: 'REST', key: 'rest' },
  ]

  initialize = () => {
    const editor = this.#editor
    editor.window_manager.requestConnect = async (device) => {
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
      const connection = await editor.device_manager.connect(options)
      const connected = connection && !editor.device_manager.error
      this.connected = !!connected
      return this.connected
    }
  }

  #emitUpdate() {
      const event = new CustomEvent('plc-device-update', { 
          detail: { 
            connected: this.connected, 
            info: this.deviceInfo,
            reconnecting: this.#reconnectAttempting
          } 
      })
      this.#editor.workspace.dispatchEvent(event)
  }

  #setError(err) {
    if (err) {
      this.error = err.message || err.toString() || "Unknown error"
      if (this.error.includes('ReadableStreamDefaultReader constructor can only accept readable streams that are not yet locked to a reader')) {
        this.error = "Device is already connected"
      }
      if (this.error.includes('No port selected by the user')) {
        this.error = "No port selected by the user"
      }
    } else {
      this.error = ''
    }
  }

  /**
   * Initialize a new device connection
   * @param { ConnectionOptions } [options]
   */
  async connect(options) {
    try {
      await this.disconnect()
      this.options = options || this.options
      if (!this.options) throw new Error("Connection options required")
      
      const targetName = this.options.target === 'serial' ? 'Serial Port' : this.options.target === 'simulation' ? 'Simulation' : this.options.target
      if (this.#editor.window_manager?.logToConsole) {
        this.#editor.window_manager.logToConsole(`Connecting to ${targetName}...`)
      }

      // Use options as-is if port is provided (for auto-reconnect), otherwise clean copy
      const connectionOptions = this.options
      
      this.connection = await initializeConnection(connectionOptions, this.#editor)
      this.connected = true
      this.#intentionalDisconnect = false
      
      // Store serial port info for auto-reconnect
      if (this.options.target === 'serial' && this.connection?.serial?.port) {
        try {
          const port = this.connection.serial.port
          const info = port.getInfo()
          this.#lastSerialPortInfo = {
            vendorId: info.usbVendorId,
            productId: info.usbProductId,
            baudRate: this.options.baudrate || 115200
          }
          // Save to project
          if (this.#editor.project) {
            this.#editor.project.lastSerialDevice = this.#lastSerialPortInfo
          }
        } catch (e) {
          console.warn('Could not save serial port info:', e)
        }
      }
      
      this.connection.onDisconnected = (err) => {
          console.warn("Connection lost:", err);
          const wasUnexpected = !this.#intentionalDisconnect
          if (this.#editor.window_manager?.logToConsole) {
            const msg = err ? `Connection lost: ${err.message || err}` : "Connection lost"
            this.#editor.window_manager.logToConsole(msg, 'error')
            if (wasUnexpected && this.options?.target === 'serial') {
              this.#editor.window_manager.logToConsole('Will attempt to reconnect when device is available...', 'warning')
            }
          }
          if (wasUnexpected && this.options?.target === 'serial') {
            this.#startAutoReconnect()
          } else {
             this.disconnect();
          }
      };

      this.#emitUpdate()
      try {
        this.deviceInfo = await this.connection.getInfo(true)
        this.#emitUpdate()
        if (this.options && this.options.debug) {
          console.log("Device info:", this.deviceInfo)
        }
        if (this.#editor.window_manager?.logToConsole) {
          this.#editor.window_manager.logToConsole(`Connected to ${targetName} successfully.`, 'success')
        }
        this.error = ''
        
        // For physical devices, fetch and store transport info and symbols after valid PI response
        if (this.options.target === 'serial' && this.#editor.project) {
          await this.#fetchAndStoreDeviceDetails()
        }
      } catch (err) {
        this.connected = false
        const msg = `Failed to get device info: ${err?.message || err}`
        console.error(msg)
        if (this.#editor.window_manager?.logToConsole) {
          this.#editor.window_manager.logToConsole(msg, 'error')
        }
        this.#setError(err)
        this.#emitUpdate()
      }
    } catch (err) {
      this.connected = false
      const no_port_selected = err && err.message && err.message.includes('No port selected by the user')
      if (!no_port_selected) {
        const msg = `Failed to connect to device: ${err?.message || err}`
        console.error(msg)
        if (this.#editor.window_manager?.logToConsole) {
          this.#editor.window_manager.logToConsole(msg, 'error')
        }
        this.#setError(err)
      }
      this.#emitUpdate()
    }
    return this.connection
  }

  /**
   * Fetch transport info and symbols from device and store in project
   * This runs after successful connection to a physical device (after valid PI response)
   */
  async #fetchAndStoreDeviceDetails() {
    try {
      const project = this.#editor.project
      if (!project || !this.connection) return

      // Store device info
      project.lastPhysicalDevice = {
        deviceInfo: this.deviceInfo ? { ...this.deviceInfo } : null,
        transports: [],
        symbols: [],
        timestamp: new Date().toISOString()
      }

      // Fetch transport info (TI command)
      if (typeof this.connection.getTransportInfo === 'function') {
        try {
          console.log('[DeviceManager] Fetching transport info (TI)...')
          const transports = await this.connection.getTransportInfo()
          project.lastPhysicalDevice.transports = transports || []
          console.log('[DeviceManager] Transport info:', transports)
          if (this.#editor.window_manager?.logToConsole && transports?.length > 0) {
            this.#editor.window_manager.logToConsole(`Device has ${transports.length} interface(s): ${transports.map(t => t.name || `Type ${t.type}`).join(', ')}`, 'info')
          }
        } catch (e) {
          console.warn('[DeviceManager] Could not fetch transport info:', e)
        }
      }

      // Fetch symbols (SL command)
      if (typeof this.connection.getSymbolList === 'function') {
        try {
          console.log('[DeviceManager] Fetching symbol list (SL)...')
          const symbols = await this.connection.getSymbolList()
          project.lastPhysicalDevice.symbols = symbols || []
          console.log('[DeviceManager] Symbol list:', symbols)
          if (this.#editor.window_manager?.logToConsole && symbols?.length > 0) {
            this.#editor.window_manager.logToConsole(`Device has ${symbols.length} registered symbol(s)`, 'info')
          }
        } catch (e) {
          console.warn('[DeviceManager] Could not fetch device symbols:', e)
        }
      }

      // Trigger project save
      if (this.#editor.project_manager?.forceSave) {
        this.#editor.project_manager.forceSave()
      }
    } catch (e) {
      console.warn('[DeviceManager] Could not store device details:', e)
    }
  }

  /**
   * Disconnect from current device
   */
  async disconnect(intentional = false) {
    this.#intentionalDisconnect = intentional
    await disconnectConnection(this.connection)
    this.connection = null
    this.connected = false
    this.deviceInfo = null
    // Clear port info on intentional disconnect
    if (intentional) {
      this.#lastSerialPortInfo = null
    }
    this.#emitUpdate()
  }

  async getInfo() {
    if (!this.connection) throw new Error("Device not connected")
    this.deviceInfo = this.connection.getInfo()
    if (this.options && this.options.debug) {
      console.log("Device info:", this.deviceInfo)
    }
    return this.deviceInfo
  }

  /**
   * Proxy memory read
   */
  async readMemory(address, size) {
    if (!this.connection) throw new Error("Device not connected")
    const start = Math.max(0, Math.floor(Number(address) || 0))
    const requestedSize = Math.max(0, Math.floor(Number(size) || 0))
    if (!requestedSize) return new Uint8Array(0)

    const memoryLimitValue = Number(this.deviceInfo?.memory)
    const memoryLimit = Number.isFinite(memoryLimitValue) && memoryLimitValue > 0
      ? memoryLimitValue
      : null
    const end = memoryLimit !== null ? Math.min(start + requestedSize, memoryLimit) : start + requestedSize
    const finalSize = Math.max(0, end - start)
    if (!finalSize) return new Uint8Array(0)

    const maxChunk = 64
    const chunks = []
    let total = 0
    for (let offset = 0; offset < finalSize; offset += maxChunk) {
      const chunkSize = Math.min(maxChunk, finalSize - offset)
      const part = await this.connection.readMemory(start + offset, chunkSize)
      let bytes = null
      if (part instanceof Uint8Array) {
        bytes = part
      } else if (Array.isArray(part)) {
        bytes = Uint8Array.from(part)
      } else if (part && part.buffer) {
        bytes = new Uint8Array(part.buffer, part.byteOffset || 0, part.byteLength || part.length || 0)
      }
      if (bytes && bytes.length) {
        chunks.push(bytes)
        total += bytes.length
      }
    }
    if (!chunks.length) return new Uint8Array(0)
    const merged = new Uint8Array(total)
    let cursor = 0
    for (const chunk of chunks) {
      merged.set(chunk, cursor)
      cursor += chunk.length
    }
    return merged
  }

  async writeMemory(address, data) {
    if (!this.connection) throw new Error("Device not connected")
    return this.connection.writeMemory(address, data)
  }

  async formatMemory(address, size, value) {
    if (!this.connection) throw new Error("Device not connected")
    return this.connection.formatMemory(address, size, value)
  }

  async getHealth() {
    if (!this.connection) throw new Error("Device not connected")
    if (typeof this.connection.getHealth !== 'function') throw new Error("Device health not supported")
    return this.connection.getHealth()
  }

  async resetHealth() {
    if (!this.connection) throw new Error("Device not connected")
    if (typeof this.connection.resetHealth !== 'function') throw new Error("Device health not supported")
    return this.connection.resetHealth()
  }

  async getSymbolList() {
    if (!this.connection) throw new Error("Device not connected")
    if (typeof this.connection.getSymbolList !== 'function') throw new Error("Device symbol list not supported")
    return this.connection.getSymbolList()
  }

  async getTransportInfo() {
    if (!this.connection) throw new Error("Device not connected")
    if (typeof this.connection.getTransportInfo !== 'function') throw new Error("Device transport info not supported")
    return this.connection.getTransportInfo()
  }

  async downloadProgram(bytecode) {
    if (!this.connection) throw new Error("Device not connected")
    return this.connection.downloadProgram(bytecode)
  }

  async uploadProgram() {
    if (!this.connection) throw new Error("Device not connected")
    return this.connection.uploadProgram()
  }

  async run() {
    if (!this.connection) throw new Error("Device not connected")
    return this.connection.run()
  }

  async stop() {
    if (!this.connection) throw new Error("Device not connected")
    return this.connection.stop()
  }

  async reboot() {
    if (!this.connection) throw new Error("Device not connected")
    return this.connection.reboot()
  }

  async monitor() {
    if (!this.connection) throw new Error("Device not connected")
    return this.connection.monitor()
  }

  async disconnect(intentional = false) {
    this.#intentionalDisconnect = intentional
    this.connected = false
    this.#emitUpdate()
    
    // Only clear connection if we are not attempting to reconnect or if intentional
    if (intentional || !this.#reconnectAttempting) {
        if (this.connection) {
            await this.connection.disconnect()
            this.connection = null
        }
        this.deviceInfo = null
    }
    this.error = ''
  }

  async destroy() {
    if (this.connection) {
      await this.connection.disconnect()
      this.connection = null
    }
    this.devices = []
    this.deviceInfo = null
    this.error = ''
  }

  cancelReconnect() {
    if (!this.#reconnectAttempting) return

    if (this.#reconnectInterval) {
      clearInterval(this.#reconnectInterval)
      this.#reconnectInterval = null
    }
    if (this.#reconnectListener) {
      navigator.serial.removeEventListener('connect', this.#reconnectListener)
      this.#reconnectListener = null
    }
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout)
      this.#reconnectTimeout = null
    }
    
    this.#reconnectAttempting = false
    
    if (this.#editor.window_manager?.logToConsole) {
      this.#editor.window_manager.logToConsole('Auto-reconnection cancelled.', 'warning')
    }
    
    // Ensure we are fully disconnected and UI is reset
    this.disconnect(true)
  }

  #startAutoReconnect() {
    if (this.#reconnectAttempting) return
    if (!('serial' in navigator)) return
    if (!this.#lastSerialPortInfo) return
    
    this.#reconnectAttempting = true
    this.#emitUpdate() // Notify UI that we are reconnecting

    const portInfo = this.#lastSerialPortInfo
    const lastOptions = {...this.options}
    
    // Auto-cancel after 30 seconds
    this.#reconnectTimeout = setTimeout(() => {
        if (this.#reconnectAttempting) {
            if (this.#editor.window_manager?.logToConsole) {
                this.#editor.window_manager.logToConsole('Auto-reconnection timed out after 30s.', 'warning')
            }
            this.cancelReconnect()
        }
    }, 30000)

    // Helper to find matching port from getPorts()
    const findMatchingPort = async () => {
      try {
        const ports = await navigator.serial.getPorts()
        return ports.find(port => {
          const info = port.getInfo()
          return info.usbVendorId === portInfo.vendorId && 
                 info.usbProductId === portInfo.productId
        })
      } catch (e) {
        return null
      }
    }
    
    // Helper to attempt reconnection with fresh port
    const attemptReconnect = async () => {
      const matchingPort = await findMatchingPort()
      if (!matchingPort) return false
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      if (this.#editor.window_manager?.logToConsole) {
        this.#editor.window_manager.logToConsole('Device detected, attempting to reconnect...', 'info')
      }
      
      try {
        // Pass the fresh port object
        const reconnectOptions = {...lastOptions, port: matchingPort}
        await this.connect(reconnectOptions)
        if (this.connected) {
          if (this.#editor.window_manager?.logToConsole) {
            this.#editor.window_manager.logToConsole('Successfully reconnected to device!', 'success')
          }
          this.cancelReconnect() // Clean up listeners but state is now "connected"
        }
        return true
      } catch (err) {
        if (this.#editor.window_manager?.logToConsole) {
          this.#editor.window_manager.logToConsole(`Failed to reconnect: ${err.message || err}`, 'error')
        }
        return false
      }
    }
    
    // Listen for connect events
    this.#reconnectListener = async () => {
      const success = await attemptReconnect()
      if (success) {
       // Handled inside attemptReconnect success path
      }
    }
    
    navigator.serial.addEventListener('connect', this.#reconnectListener)
    
    // Poll for port availability as fallback
    this.#reconnectInterval = setInterval(async () => {
      if (!this.#reconnectAttempting) {
        this.cancelReconnect()
        return
      }
      
      const success = await attemptReconnect()
      if (success) {
        // Handled inside attemptReconnect success path
      }
    }, 2000)
  }
}

