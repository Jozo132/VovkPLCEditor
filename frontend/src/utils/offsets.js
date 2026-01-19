/** @param { any } offsets  */
export const ensureOffsets = (offsets = {}) => {
    /** @type {{ [key in OffsetKey]: { offset: number, size: number } }} */// @ts-ignore
    const normalized = { ...offsets }
    
    /** @typedef {'control' | 'counter' | 'timer' | 'input' | 'output' | 'system' | 'marker'} OffsetKey */
    const keys = ['control', 'counter', 'timer', 'input', 'output', 'system', 'marker']
    
    // Default values matching PLCRuntime standard layout
    // K: 0 (Size 64) - Control
    // X: 64 (Size 64) - Input
    // Y: 128 (Size 64) - Output
    // S: 192 (Size 256) - System
    // M: 448 (Size 256) - Marker
    // T: 704 (Size 64) - Timer
    // C: 768 (Size 64) - Counter
    const defaults = {
        control: { offset: 0, size: 64 },
        input: { offset: 64, size: 64 },
        output: { offset: 128, size: 64 },
        system: { offset: 192, size: 256 },
        marker: { offset: 448, size: 256 },
        timer: { offset: 704, size: 64 },
        counter: { offset: 768, size: 64 }
    }

    keys.forEach(key => {
        // Use default if missing or if it's a non-control area with 0-offset and 0-size
        if (!normalized[key] || (normalized[key].offset === 0 && normalized[key].size === 0)) {
            normalized[key] = { ...defaults[key] }
        } else if (key !== 'control' && normalized[key].offset === 0 && normalized[key].size > 0) {
            // If we have size but offset is 0 for non-control area, it's likely a project load bug or old format.
            // We'll update the offset while keeping the size if it's non-standard, or just use defaults if it matches.
            if (normalized[key].size === defaults[key].size) {
                normalized[key].offset = defaults[key].offset
            } else {
                // Non-standard size but 0 offset? This is very likely wrong for X/Y/S/M.
                // We'll just use defaults as they are safer.
                normalized[key] = { ...defaults[key] }
            }
        }
    })

    // Alias 'memory' to 'marker' if 'marker' is still zero or missing but 'memory' is present
    if (normalized.memory && (!normalized.marker || (normalized.marker.offset === 0 && normalized.marker.size === 0))) {
        normalized.marker = { ...normalized.memory }
    }

    return normalized
}
