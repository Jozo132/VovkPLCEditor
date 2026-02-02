export default class DataFetcher {
    /** @type { number } */
    max_batch_size = 512

    /** @type { Uint8Array } */
    last_known_memory = new Uint8Array(65536)

    /** @type { Map<string, { start: number, size: number, callbacks: Set<(data: Uint8Array) => void> }> } */
    registry = new Map()

    /** @type { import('../Editor.js').VovkPLCEditor } */
    editor

    /** @type { boolean } */
    fetching = false

    /** @type { number | null } */
    timer = null

    /** @type { number } */
    interval = 200

    /** @type { number } */
    batch_index = 0

    /** @param {import('../Editor.js').VovkPLCEditor} editor */
    constructor(editor) {
        this.editor = editor
    }

    /**
     * Register interest in a memory range
     * @param {string} id - Unique ID for the requester (e.g. 'watch-panel')
     * @param {number} start - Start address
     * @param {number} size - Size in bytes
     * @param {(data: Uint8Array) => void} callback - Callback with data
     */
    register(id, start, size, callback) {
        if (size <= 0) return
        const key = `${id}:${start}:${size}`
        // Simplified key logic for now, ideally we merge overlapping ranges
        // But for distinct UI components requesting distinct things, this is okay.
        // Better: store requests and cluster them before fetch.
        
        let entry = this.registry.get(key)
        if (!entry) {
            entry = { start, size, callbacks: new Set() }
            this.registry.set(key, entry)
        }
        entry.callbacks.add(callback)
        
        if (!this.fetching && this.editor.window_manager.isMonitoringActive()) {
            this.start()
        }
    }

    /**
     * Unregister interest
     * @param {string} id 
     * @param {number} start 
     * @param {number} size 
     * @param {(data: Uint8Array) => void} callback 
     */
    unregister(id, start, size, callback) {
        const key = `${id}:${start}:${size}`
        const entry = this.registry.get(key)
        if (entry) {
            entry.callbacks.delete(callback)
            if (entry.callbacks.size === 0) {
                this.registry.delete(key)
            }
        }
        
        // Check empty
        if (this.registry.size === 0) {
            this.stop()
        }
    }

    /**
     * Unregister all interests for a given ID
     * @param {string} id 
     */
    unregisterAll(id) {
        for (const [key, entry] of this.registry.entries()) {
            if (key.startsWith(`${id}:`)) {
                this.registry.delete(key)
            }
        }
        if (this.registry.size === 0) {
            this.stop()
        }
    }

    start() {
        if (this.timer) return
        this.fetching = true
        this.timer = setInterval(() => this.tick(), this.interval)
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
        this.fetching = false
    }

    /**
     * Reset the fetcher state - clears cache and forces re-evaluation of all registrations
     * Call this after program download or offset changes
     */
    reset() {
        // Clear memory cache
        this.last_known_memory = new Uint8Array(65536)
        
        // Clear batch index
        this.batch_index = 0
        
        // Re-trigger all callbacks with empty data to force UI updates
        // This will cause all consumers to re-register with fresh addresses
        for (const entry of this.registry.values()) {
            const emptyData = new Uint8Array(entry.size)
            entry.callbacks.forEach(cb => {
                try {
                    cb(emptyData)
                } catch (e) {
                    console.warn('Callback error during reset:', e)
                }
            })
        }
    }

    /**
     * Resolve symbol or address string to { address, size, type, bit }
     * @param {string | object} input 
     */
    resolve(input) {
        const project = this.editor.project
        if (!project) return null
        
        const offsets = this.editor.project?.offsets || {}
        const getOffset = (key) => {
             const k = key === 'memory' ? 'marker' : key
             return (offsets[k] && offsets[k].offset) || 0
        }

        // If input is symbol object
        let symbol = input
        if (typeof input === 'string') {
            // Find symbol
            const s = (project.symbols || []).find(x => x.name === input)
            if (s) {
                symbol = s
            } else {
                const inputTrimmed = input.trim()
                
                // Pattern: Letter + Number (e.g., M100, M100.2)
                const matchLetter = inputTrimmed.match(/^([cCxXyYsSmM])([0-9]+(?:\.[0-9]+)?)$/)
                if (matchLetter) {
                    const code = matchLetter[1].toUpperCase()
                    const valStr = matchLetter[2]
                    const val = parseFloat(valStr)
                    
                    let key = 'marker'
                    if (code === 'K') key = 'system'
                    else if (code === 'C') key = 'counter'
                    else if (code === 'T') key = 'timer'
                    else if (code === 'X') key = 'input'
                    else if (code === 'Y') key = 'output'
                    else if (code === 'S') key = 'system'
                    else if (code === 'M') key = 'marker'
                    
                    const base = getOffset(key)
                    // Timer (T) uses 9 bytes per unit, Counter (C) uses 5 bytes per unit
                    const structSize = (code === 'T') ? 9 : (code === 'C') ? 5 : 1
                    
                    if (valStr.includes('.')) {
                        const byte = Math.floor(val)
                        const bit = Math.round((val - byte) * 10)
                        return { address: base + (byte * structSize), size: 1, bit, type: 'bit' }
                    } else {
                        return { address: base + (val * structSize), size: structSize, bit: null, type: 'byte' }
                    }
                }
                
                // Pattern: Absolute Number (e.g. 100, 100.2)
                const matchNumber = inputTrimmed.match(/^([0-9]+(?:\.[0-9]+)?)$/)
                if (matchNumber) {
                     const valStr = matchNumber[1]
                     const val = parseFloat(valStr)
                     if (valStr.includes('.')) {
                        const byte = Math.floor(val)
                        const bit = Math.round((val - byte) * 10)
                        return { address: byte, size: 1, bit, type: 'bit' }
                     } else {
                        return { address: val, size: 1, bit: null, type: 'byte' }
                     }
                }

                return null
            }
        }
        
        if (!symbol) return null
        
        const typeSizes = {
            bit: 1, bool: 1, BOOL: 1,
            byte: 1, u8: 1, i8: 1, SINT: 1, USINT: 1,
            int: 2, u16: 2, i16: 2, UINT: 2, WORD: 2, word: 2,
            dint: 4, u32: 4, i32: 4, UDINT: 4, DWORD: 4, dword: 4, REAL: 4, float: 4, f32: 4,
            real: 4,
            u64: 8, i64: 8, f64: 8, lword: 8, LWORD: 8
        } // Extended types
        
        const baseOffset = getOffset(symbol.location)
        const addrVal = parseFloat(symbol.address) || 0
        
        // Handle bits
        let size = 1
        let bit = null
        const type = (symbol.type || 'byte').toLowerCase()
        
        if (type === 'bit' || type === 'bool') {
             const byte = Math.floor(addrVal)
             bit = Math.round((addrVal - byte) * 10) // 100.2 -> 2
             return { address: baseOffset + byte, size: 1, bit, type }
        } else {
             size = typeSizes[type] || 1
             return { address: baseOffset + Math.floor(addrVal), size, bit: null, type }
        }
    }

    async tick() {
        if (!this.editor.device_manager?.connected) return
        if (!this.editor.window_manager.isMonitoringActive()) return
        if (this.registry.size === 0) return

        // Create batches
        // 1. Convert registry to flat list of ranges
        const ranges = []
        for (const entry of this.registry.values()) {
             ranges.push({ start: entry.start, size: entry.size, entry })
        }
        
        // 2. Sort by start address
        ranges.sort((a, b) => a.start - b.start)
        
        // 3. Cluster nearby
        const batches = []
        let currentBatch = null
        
        for (const range of ranges) {
            if (!currentBatch) {
                currentBatch = { start: range.start, end: range.start + range.size, items: [range] }
                batches.push(currentBatch)
                continue
            }
            
            // Check gap
            const gap = range.start - currentBatch.end
            const projectedSize = (range.start + range.size) - currentBatch.start
            
            if (gap < 64 && projectedSize <= this.max_batch_size) { // Allow small gaps to merge
                currentBatch.end = Math.max(currentBatch.end, range.start + range.size)
                currentBatch.items.push(range)
            } else {
                currentBatch = { start: range.start, end: range.start + range.size, items: [range] }
                batches.push(currentBatch)
            }
        }

        // 4. Fetch Round Robin
        // If we have batches > MAX_BATCHES_PER_TICK, we rotate.
        
        const MAX_BATCHES = 4
        let batchesToFetch = batches
        
        if (batches.length > MAX_BATCHES) {
             const start = this.batch_index % batches.length
             const end = start + MAX_BATCHES
             if (end > batches.length) {
                 batchesToFetch = [...batches.slice(start), ...batches.slice(0, end - batches.length)]
             } else {
                 batchesToFetch = batches.slice(start, end)
             }
             this.batch_index = (start + MAX_BATCHES) % batches.length
        } else {
             this.batch_index = 0
        }
        
        try {
            await Promise.all(batchesToFetch.map(async batch => {
                const size = batch.end - batch.start
                if (size <= 0) return
                
                try {
                    const data = await this.editor.device_manager.readMemory(batch.start, size)
                    
                    // Distribute to items
                    // batch.items has original ranges
                    
                    // data can be array or Uint8Array
                    const bytes = (data instanceof Uint8Array) ? data : new Uint8Array(data.buffer || data)
                    
                    // Update cache
                    if (batch.start < this.last_known_memory.length) {
                        const copyLen = Math.min(bytes.length, this.last_known_memory.length - batch.start)
                        this.last_known_memory.set(bytes.subarray(0, copyLen), batch.start)
                    }

                    batch.items.forEach(item => {
                        const offset = item.start - batch.start
                        if (offset >= 0 && offset + item.size <= bytes.length) {
                             const slice = bytes.subarray(offset, offset + item.size)
                             item.entry.callbacks.forEach(cb => cb(slice))
                        }
                    })
                    
                } catch (e) {
                    // console.warn('Fetch failed', e)
                }
            }))
            
        } catch (e) {
            console.error('Polling error', e)
        }
    }
}
