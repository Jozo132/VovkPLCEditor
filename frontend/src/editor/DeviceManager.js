// @ts-check
"use strict"

import { initializeConnection, disconnectConnection, ConnectionOptions } from "../connection/index.js"
import { PLCEditor } from "../utils/types.js"

// @ts-ignore
const serial_support = typeof navigator !== 'undefined' && navigator.serial && navigator.serial.getPorts && navigator.serial.requestPort

export default class DeviceManager {
  error = ''
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
      this.connection = await initializeConnection(this.#editor, this.options)
      try {
        this.deviceInfo = await this.connection.getInfo(true)
        if (this.options && this.options.debug) {
          console.log("Device info:", this.deviceInfo)
        }
        this.error = ''
      } catch (err) {
        console.error("Failed to get device info:", err)
        this.#setError(err)
      }
    } catch (err) {
      const no_port_selected = err && err.message && err.message.includes('No port selected by the user')
      if (!no_port_selected) {
        console.error("Failed to connect to device:", err)
        this.#setError(err)
      }
    }
    return this.connection
  }

  /**
   * Disconnect from current device
   */
  async disconnect() {
    await disconnectConnection(this.connection)
    this.connection = null
    this.deviceInfo = null
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
    return this.connection.readMemory(address, size)
  }

  async writeMemory(address, data) {
    if (!this.connection) throw new Error("Device not connected")
    return this.connection.writeMemory(address, data)
  }

  async formatMemory(address, size, value) {
    if (!this.connection) throw new Error("Device not connected")
    return this.connection.formatMemory(address, size, value)
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



  destroy(){
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
