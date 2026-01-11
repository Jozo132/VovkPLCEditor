import { initializeConnection, disconnectConnection, ConnectionOptions } from "../connection/index.js"
import { PLCEditor } from "../utils/types.js"

export default class DeviceManager {
  error = ''
  connected = false
  #editor
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
          detail: { connected: this.connected, info: this.deviceInfo } 
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
      this.connection = await initializeConnection(this.options, this.#editor)
      this.connected = true
      this.#emitUpdate()
      try {
        this.deviceInfo = await this.connection.getInfo(true)
        this.#emitUpdate()
        if (this.options && this.options.debug) {
          console.log("Device info:", this.deviceInfo)
        }
        this.error = ''
      } catch (err) {
        this.connected = false
        console.error("Failed to get device info:", err)
        this.#setError(err)
        this.#emitUpdate()
      }
    } catch (err) {
      this.connected = false
      const no_port_selected = err && err.message && err.message.includes('No port selected by the user')
      if (!no_port_selected) {
        console.error("Failed to connect to device:", err)
        this.#setError(err)
      }
      this.#emitUpdate()
    }
    return this.connection
  }

  /**
   * Disconnect from current device
   */
  async disconnect() {
    await disconnectConnection(this.connection)
    this.connection = null
    this.connected = false
    this.deviceInfo = null
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



  destroy() {
    if (this.connection) {
      this.connection.disconnect()
      this.connection = null
    }
    this.devices = []
    this.deviceInfo = null
    this.error = ''
    this.options = null
  }
}
