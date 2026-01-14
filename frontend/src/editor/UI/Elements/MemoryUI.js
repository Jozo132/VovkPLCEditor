import { CSSimporter } from "../../../utils/tools.js"
import { ensureOffsets } from "../../../utils/offsets.js"

const importCSS = CSSimporter(import.meta.url)
await importCSS('./EditorUI.css')
await importCSS('./MemoryUI.css')

export default class MemoryUI {
    id = 'memory'
    hidden = false
    div
    header
    body
    master
    displayMode = 'hex'
    scope = 'full'
    monitoringActive = false
    monitoringAvailable = false
    monitor_buttons = []
    outputHost
    outputWrap
    outputSpacer
    canvas
    ctx
    _pollTimer = null
    _pollInFlight = false
    _lastSnapshot = null
    _scopeEntries = []
    _scrollFrame = null
    _activeRange = null
    _lastStatus = null
    _drawFrame = null
    _resizeObserver = null

    /** @param { import("../../Editor.js").VovkPLCEditor } master */
    constructor(master) {
        this.master = master

        const div = document.createElement('div')
        div.classList.add('plc-editor', 'memory-editor')
        this.div = div

        const frame = master.workspace.querySelector('.plc-window-frame')
        if (!frame) throw new Error('Frame not found')
        this.frame = frame
        this.frame.appendChild(div)

        this.render()

        this._handleDeviceUpdate = () => {
            if (!this.hidden) {
                this.updateSidebar()
                this.updateMemory(true)
            }
        }
        this.master.workspace.addEventListener('plc-device-update', this._handleDeviceUpdate)
    }

    close() {
        this._stopPoll()
        if (this._resizeObserver) {
            this._resizeObserver.disconnect()
            this._resizeObserver = null
        }
        if (this._drawFrame) {
            cancelAnimationFrame(this._drawFrame)
            this._drawFrame = null
        }
        if (this.div) this.div.remove()
        if (this._handleDeviceUpdate) {
            this.master.workspace.removeEventListener('plc-device-update', this._handleDeviceUpdate)
        }
    }

    render() {
        this.div.innerHTML = /*HTML*/`
            <div class="plc-editor-top">
                <div class="plc-editor-header">
                    <h2 style="margin-top: 0px; margin-bottom: 3px;">Memory Map</h2>
                    <p>Device memory inspection</p>
                    <button class="plc-btn monitor-btn" data-monitor-toggle="true">Monitor</button>
                </div>
            </div>
            <div class="plc-editor-body memory-body">
                <div class="memory-toolbar">
                    <span class="memory-toolbar-label">Display</span>
                    <button class="memory-mode-btn" data-mode="hex">HEX</button>
                    <button class="memory-mode-btn" data-mode="bin">BIN</button>
                    <button class="memory-mode-btn" data-mode="byte">BYTE</button>
                </div>
                <div class="memory-layout">
                    <div class="memory-sidebar"></div>
                    <div class="memory-content">
                        <div class="memory-status"></div>
                        <div class="memory-output-host">
                            <div class="memory-output-wrap">
                                <div class="memory-output-spacer"></div>
                            </div>
                            <canvas class="memory-canvas"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        `

        this.header = this.div.querySelector('.plc-editor-header')
        this.body = this.div.querySelector('.plc-editor-body')
        this.sidebar = this.div.querySelector('.memory-sidebar')
        this.outputHost = this.div.querySelector('.memory-output-host')
        this.outputWrap = this.div.querySelector('.memory-output-wrap')
        this.outputSpacer = this.div.querySelector('.memory-output-spacer')
        this.canvas = this.div.querySelector('.memory-canvas')
        this.ctx = this.canvas?.getContext('2d') || null
        this.content = this.div.querySelector('.memory-content')
        this.status = this.div.querySelector('.memory-status')

        this._modeButtons = Array.from(this.div.querySelectorAll('.memory-mode-btn'))
        this._modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.setDisplayMode(btn.dataset.mode || 'hex')
            })
        })

        this.monitor_buttons = Array.from(this.div.querySelectorAll('[data-monitor-toggle="true"]'))
        this.monitor_buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.master?.window_manager?.toggleMonitoringActive?.()
            })
        })
        this.updateMonitoringState(this.master?.window_manager?.isMonitoringActive?.() || false)
        this.updateMonitoringAvailability(this.master?.window_manager?.isMonitoringAvailable?.() || false)

        this.updateSidebar()
        this.updateDisplayButtons()
        this.updateMemory(true)

        requestAnimationFrame(() => {
            this._resizeCanvas()
            this._scheduleDraw()
        })

        if (this.outputWrap) {
            this.outputWrap.addEventListener('scroll', () => {
                if (this._scrollFrame) return
                this._scrollFrame = requestAnimationFrame(() => {
                    this._scrollFrame = null
                    this.updateMemory()
                })
            })
        }
        if (this.outputHost && typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => {
                this._resizeCanvas()
                this._scheduleDraw()
            })
            this._resizeObserver.observe(this.outputHost)
        }
    }

    setDisplayMode(mode) {
        const next = (mode || '').toLowerCase()
        if (!['hex', 'bin', 'byte'].includes(next)) return
        if (this.displayMode === next) return
        this.displayMode = next
        this.updateDisplayButtons()
        if (this._lastSnapshot) {
            this.renderSnapshot(
                this._lastSnapshot.bytes,
                this._lastSnapshot.start,
                this._lastSnapshot.size,
                this._lastSnapshot.placeholder,
                this._activeRange
            )
        } else {
            this.updateMemory(true)
        }
    }

    setScope(scope) {
        if (!scope) return
        if (this.scope === scope) return
        this.scope = scope
        this.updateSidebar()
        this.updateMemory(true)
    }

    updateDisplayButtons() {
        this._modeButtons.forEach(btn => {
            const isActive = btn.dataset.mode === this.displayMode
            btn.classList.toggle('active', isActive)
        })
    }

    updateMonitoringState(active = false) {
        this.monitoringActive = !!active
        this.monitor_buttons.forEach(btn => {
            btn.textContent = this.monitoringActive ? 'Monitoring' : 'Monitor'
            btn.classList.toggle('active', this.monitoringActive)
        })
        if (!this.hidden) {
            this.updateMemory(true)
        }
    }

    updateMonitoringAvailability(available = false) {
        this.monitoringAvailable = !!available
        this.monitor_buttons.forEach(btn => {
            btn.style.display = this.monitoringAvailable ? '' : 'none'
        })
        if (!this.monitoringAvailable) {
            this.updateMonitoringState(false)
        }
    }

    setMonitoringState(isMonitoring) {
        // Called by WindowManager
        const wasActive = this.monitoringActive
        this.monitoringActive = !!isMonitoring
        
        // Remove canvas opacity if it was set previously, we handle it in render now
        if (this.canvas) {
             this.canvas.style.opacity = ''
        }

        this.monitor_buttons.forEach(btn => {
            btn.classList.toggle('active', this.monitoringActive)
            btn.textContent = this.monitoringActive ? 'Monitoring' : 'Monitor'
        })
        
        if (wasActive !== this.monitoringActive) {
            this._scheduleDraw()
        }
    }

    updateSidebar() {
        if (!this.sidebar) return
        const project = this.master.project || {}
        const offsets = ensureOffsets(project.offsets || {})
        const size = this._getMemoryLimit()
        const entries = []

        entries.push({
            id: 'full',
            label: 'Full',
            start: 0,
            size
        })

        const order = ['control', 'input', 'output', 'system', 'marker']
        order.forEach(key => {
            const cfg = offsets[key]
            if (!cfg) return
            const start = Number(cfg.offset) || 0
            const len = Number(cfg.size) || 0
            if (len <= 0) return
            entries.push({
                id: key,
                label: `${key} ${start}`,
                start,
                size: len
            })
        })

        this._scopeEntries = entries
        if (!entries.find(e => e.id === this.scope)) {
            this.scope = 'full'
        }

        this.sidebar.innerHTML = ''
        entries.forEach(entry => {
            const item = document.createElement('div')
            item.className = 'memory-sidebar-item'
            if (entry.id === this.scope) item.classList.add('active')
            item.dataset.scope = entry.id

            const label = document.createElement('span')
            label.textContent = entry.label

            const sizeEl = document.createElement('span')
            sizeEl.className = 'memory-size'
            sizeEl.textContent = `${entry.size}B`

            item.appendChild(label)
            item.appendChild(sizeEl)
            item.addEventListener('click', () => {
                this.setScope(entry.id)
            })
            this.sidebar.appendChild(item)
        })
    }

    _getMemoryLimit() {
        const info = this.master.device_manager?.deviceInfo
        const deviceMemory = Number(info?.memory)
        if (Number.isFinite(deviceMemory) && deviceMemory > 0) return deviceMemory
        const offsets = ensureOffsets(this.master.project?.offsets || {})
        let max = 0
        Object.values(offsets).forEach(cfg => {
            if (!cfg) return
            const start = Number(cfg.offset) || 0
            const size = Number(cfg.size) || 0
            max = Math.max(max, start + size)
        })
        return max
    }

    _getScopeRange() {
        if (this.scope === 'full') {
            const size = this._getMemoryLimit()
            return { start: 0, size }
        }
        const entry = this._scopeEntries.find(e => e.id === this.scope)
        if (!entry) return { start: 0, size: 0 }
        return { start: entry.start, size: entry.size }
    }

    _getBytesPerRow() {
        return this.displayMode === 'bin' ? 1 : 16
    }

    _getLineHeight() {
        const metrics = this._getFontMetrics()
        return metrics.lineHeight
    }

    _getFontMetrics() {
        const fallback = {
            font: '12px Consolas, monospace',
            lineHeight: 16,
            charWidth: 8
        }
        if (!this.canvas || !this.ctx) return fallback
        const style = getComputedStyle(this.canvas)
        const fontSize = parseFloat(style.fontSize || '12')
        const lineHeight = parseFloat(style.lineHeight || '0')
        const family = style.fontFamily || 'Consolas, monospace'
        const font = `${fontSize}px ${family}`
        if (this.ctx.font !== font) this.ctx.font = font
        const width = this.ctx.measureText('0').width || fallback.charWidth
        const resolvedLineHeight = Number.isFinite(lineHeight) && lineHeight > 0
            ? lineHeight
            : Math.max(14, fontSize * 1.4)
        return {
            font,
            lineHeight: resolvedLineHeight,
            charWidth: width
        }
    }

    _getLayoutMetrics(baseRange) {
        const range = baseRange || this._getScopeRange()
        const maxAddr = range.size > 0 ? range.start + range.size - 1 : range.start
        const addrWidth = Math.max(2, String(maxAddr).length)
        const metrics = this._getFontMetrics()
        const cols = this.displayMode === 'bin' ? 8 : 16
        const cellChars = this.displayMode === 'hex' ? 2 : (this.displayMode === 'byte' ? 3 : 1)
        const gap = metrics.charWidth
        const addrWidthPx = addrWidth * metrics.charWidth
        const cellWidth = cellChars * metrics.charWidth + gap
        const contentWidth = addrWidthPx + gap + cols * cellWidth
        return {
            ...metrics,
            addrWidth,
            addrWidthPx,
            cols,
            cellChars,
            cellWidth,
            gap,
            contentWidth
        }
    }

    _resizeCanvas() {
        if (!this.canvas || !this.outputHost || !this.ctx) return
        const width = this.outputHost.clientWidth
        const height = this.outputHost.clientHeight
        if (!width || !height) return
        const dpr = window.devicePixelRatio || 1
        const nextWidth = Math.ceil(width * dpr)
        const nextHeight = Math.ceil(height * dpr)
        if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
            this.canvas.width = nextWidth
            this.canvas.height = nextHeight
            this.canvas.style.width = `${width}px`
            this.canvas.style.height = `${height}px`
        }
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    _scheduleDraw() {
        if (this._drawFrame) return
        this._drawFrame = requestAnimationFrame(() => {
            this._drawFrame = null
            this._drawCanvas()
        })
    }

    _getRenderRange() {
        const base = this._getScopeRange()
        if (!base.size || base.size <= 0) return { ...base, virtual: false }
        if (this.scope !== 'full') {
            const bytesPerRow = this._getBytesPerRow()
            const totalRows = Math.ceil(base.size / bytesPerRow)
            return { ...base, virtual: false, bytesPerRow, totalRows, rowIndex: 0 }
        }
        const bytesPerRow = this._getBytesPerRow()
        const maxSize = Math.min(128, base.size)
        const lineHeight = this._getLineHeight()
        const scrollTop = this.outputWrap ? this.outputWrap.scrollTop : 0
        const rowIndex = Math.max(0, Math.floor(scrollTop / lineHeight))
        let start = base.start + rowIndex * bytesPerRow
        const maxStart = base.start + Math.max(0, base.size - maxSize)
        if (start > maxStart) start = maxStart
        const size = Math.min(maxSize, base.size - (start - base.start))
        const totalRows = Math.ceil(base.size / bytesPerRow)
        return { start, size, virtual: true, bytesPerRow, totalRows, rowIndex }
    }

    _applyLayout(range) {
        if (!this.outputWrap || !this.outputSpacer) return
        const base = this._getScopeRange()
        if (!base.size || base.size <= 0) {
            this.outputSpacer.style.height = '0px'
            this.outputSpacer.style.width = '0px'
            return
        }
        const layout = this._getLayoutMetrics(base)
        const bytesPerRow = range?.bytesPerRow || this._getBytesPerRow()
        const totalRows = range?.totalRows || Math.ceil(base.size / bytesPerRow)
        this.outputSpacer.style.height = `${Math.max(totalRows * layout.lineHeight, layout.lineHeight)}px`
        this.outputSpacer.style.width = `${layout.contentWidth}px`
    }

    _setStatus(text) {
        if (!this.status) return
        if (this._lastStatus === text) return
        this._lastStatus = text
        this.status.textContent = text || ''
        this.status.style.display = text ? '' : 'none'
    }

    async updateMemory(force = false) {
        if (this.hidden) return
        const deviceManager = this.master.device_manager
        const connected = !!(deviceManager && deviceManager.connected)
        const range = this._getRenderRange()
        this._activeRange = range
        if (!range.size || range.size <= 0) {
            this._setStatus('Memory size not available.')
            return
        }
        this._applyLayout(range)
        const canRead = connected && this.monitoringActive
        if (!canRead) {
            this._setStatus('')
            const snapshot = this._lastSnapshot
            if (snapshot && snapshot.placeholder && snapshot.start === range.start && snapshot.size === range.size && !force) {
                this._scheduleDraw()
                return
            }
            this.renderSnapshot(null, range.start, range.size, true, range)
            return
        }
        if (this._pollInFlight && !force) {
            this._scheduleDraw()
            return
        }

        this._pollInFlight = true
        try {
            const raw = await deviceManager.readMemory(range.start, range.size)
            const bytes = raw instanceof Uint8Array
                ? raw
                : raw && raw.buffer
                    ? new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength || raw.length || 0)
                    : Uint8Array.from(raw || [])
            this.renderSnapshot(bytes, range.start, range.size, false, range)
        } catch (e) {
            this._setStatus('')
            const snapshot = this._lastSnapshot
            if (snapshot && !snapshot.placeholder) {
                this.renderSnapshot(snapshot.bytes, snapshot.start, snapshot.size, false, range)
            } else {
                this.renderSnapshot(null, range.start, range.size, true, range)
            }
        } finally {
            this._pollInFlight = false
        }
    }

    renderSnapshot(bytes, startAddress, sizeOverride, placeholder = false, rangeOverride = null) {
        if (!this.canvas) return
        const size = typeof sizeOverride === 'number'
            ? sizeOverride
            : (bytes ? bytes.length : 0)
        if (!size || size <= 0) {
            this._setStatus('No memory data.')
            return
        }
        if (!placeholder) {
            this._setStatus('')
        }
        const range = rangeOverride || this._activeRange || { virtual: false }
        this._applyLayout(range)
        this._lastSnapshot = { bytes, start: startAddress, size, placeholder }
        this._scheduleDraw()
    }

    _drawCanvas() {
        if (!this.canvas || !this.ctx || !this.outputHost || !this.outputWrap) return
        const base = this._getScopeRange()
        if (!base.size || base.size <= 0) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
            return
        }
        this._resizeCanvas()
        const width = this.outputHost.clientWidth
        const height = this.outputHost.clientHeight
        if (!width || !height) return
        const range = this._activeRange || this._getRenderRange()
        const layout = this._getLayoutMetrics(base)
        const bytesPerRow = range?.bytesPerRow || this._getBytesPerRow()
        const totalRows = range?.totalRows || Math.ceil(base.size / bytesPerRow)
        const scrollTop = this.outputWrap.scrollTop
        const scrollLeft = this.outputWrap.scrollLeft
        const startRow = Math.max(0, Math.floor(scrollTop / layout.lineHeight))
        const visibleRows = Math.max(1, Math.ceil((height - layout.lineHeight) / layout.lineHeight) + 1)
        const endRow = Math.min(totalRows, startRow + visibleRows)
        const offsetX = -scrollLeft
        const placeholderColor = '#666'

        this.ctx.clearRect(0, 0, width, height)
        this.ctx.font = layout.font
        this.ctx.textBaseline = 'top'

        const headerX = offsetX + layout.addrWidthPx + layout.gap
        this.ctx.fillStyle = '#888'
        for (let col = 0; col < layout.cols; col++) {
            const label = this.displayMode === 'bin'
                ? String(col)
                : String(col).padStart(2, '0')
            const x = headerX + col * layout.cellWidth
            this.ctx.fillText(label, x, 0)
        }

        const snapshot = this._lastSnapshot
        const snapshotStart = snapshot?.start ?? range.start
        const snapshotBytes = snapshot?.bytes || null
        const placeholder = snapshot?.placeholder ?? true
        
        // Monitoring Paused state: Dim the values
        const isPaused = !this.monitoringActive
        const valueAlpha = isPaused ? 0.5 : 1.0

        for (let row = startRow; row < endRow; row++) {
            const rowAddr = base.start + row * bytesPerRow
            if (rowAddr >= base.start + base.size) break
            const y = layout.lineHeight + (row - startRow) * layout.lineHeight
            const addrLabel = String(rowAddr).padStart(layout.addrWidth, '0')
            
             // Address is always opaque
            this.ctx.globalAlpha = 1.0
            this.ctx.fillStyle = '#888'
            this.ctx.fillText(addrLabel, offsetX, y)

            // Apply transparency to values if paused
            this.ctx.globalAlpha = valueAlpha

            if (this.displayMode === 'bin') {
                const byteIndex = rowAddr - snapshotStart
                const rawVal = snapshotBytes ? snapshotBytes[byteIndex] : undefined
                const hasByte = !placeholder && typeof rawVal === 'number' && Number.isFinite(rawVal)
                const byteVal = hasByte ? rawVal : 0
                for (let bit = 0; bit < layout.cols; bit++) {
                    const bitVal = hasByte ? ((byteVal >> bit) & 1) : 0
                    const text = placeholder || !hasByte ? '-' : String(bitVal)
                    const color = placeholder || !hasByte
                        ? placeholderColor
                        : (bitVal === 0 ? '#000' : '#fff')
                    const x = headerX + bit * layout.cellWidth
                    this.ctx.fillStyle = color
                    this.ctx.fillText(text, x, y)
                }
                continue
            }

            for (let col = 0; col < layout.cols; col++) {
                const addr = rowAddr + col
                if (addr >= base.start + base.size) break
                const byteIndex = addr - snapshotStart
                const rawVal = snapshotBytes ? snapshotBytes[byteIndex] : undefined
                const hasByte = !placeholder && typeof rawVal === 'number' && Number.isFinite(rawVal)
                const val = hasByte ? rawVal : 0
                const text = placeholder || !hasByte
                    ? (this.displayMode === 'byte' ? '---' : '--')
                    : (this.displayMode === 'byte'
                        ? String(val).padStart(3, '0')
                        : val.toString(16).padStart(2, '0').toUpperCase())
                const color = placeholder || !hasByte
                    ? placeholderColor
                    : (val === 0 ? '#000' : '#fff')
                const x = headerX + col * layout.cellWidth
                this.ctx.fillStyle = color
                this.ctx.fillText(text, x, y)
            }
            this.ctx.globalAlpha = 1.0 // Reset alpha for next iteration
        }
    }

    _startPoll() {
        if (this._pollTimer) return
        this._pollTimer = setInterval(() => {
            this.updateMemory()
        }, 250)
    }

    _stopPoll() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer)
            this._pollTimer = null
        }
    }

    hide() {
        this.hidden = true
        this.div.classList.add('hidden')
        this._stopPoll()
    }

    show() {
        this.hidden = false
        this.div.classList.remove('hidden')
        this._startPoll()
        requestAnimationFrame(() => {
            this._resizeCanvas()
            this.updateMemory(true)
        })
    }

    reloadProgram() {
        this.updateSidebar()
        this.updateMemory(true)
    }

    setLocked() {
        // Memory view is read-only.
    }
}
