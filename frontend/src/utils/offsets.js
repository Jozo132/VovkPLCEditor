/** @param { any } offsets  */
export const ensureOffsets = (offsets = {}) => {
    /** @type {{ [key in OffsetKey]: { offset: number, size: number } }} */// @ts-ignore
    const normalized = { ...offsets }
    
    /** @typedef {'counter' | 'timer' | 'input' | 'output' | 'system' | 'marker'} OffsetKey */
    const keys = ['counter', 'timer', 'input', 'output', 'system', 'marker']
    
    // Default values matching PLCRuntime standard layout (after K→S refactor)
    // S: 0 (Size 64) - System (formerly K/Control)
    // X: 64 (Size 64) - Input
    // Y: 128 (Size 64) - Output
    // M: 192 (Size 256) - Marker
    // T and C are now compiler-defined based on usage
    const defaults = {
        system: { offset: 0, size: 64 },
        input: { offset: 64, size: 64 },
        output: { offset: 128, size: 64 },
        marker: { offset: 192, size: 256 },
        timer: { offset: 448, size: 0 },    // Compiler-defined based on usage
        counter: { offset: 448, size: 0 }   // Compiler-defined based on usage
    }

    // Migrate old 'control' to 'system' if present
    if (normalized.control && !normalized.system) {
        normalized.system = { ...normalized.control }
    }
    delete normalized.control

    keys.forEach(key => {
        // Use default if missing or if it's a non-system area with 0-offset and 0-size
        if (!normalized[key] || (normalized[key].offset === 0 && normalized[key].size === 0)) {
            normalized[key] = { ...defaults[key] }
        } else if (key !== 'system' && normalized[key].offset === 0 && normalized[key].size > 0) {
            // If we have size but offset is 0 for non-system area, it's likely a project load bug or old format.
            // We'll update the offset while keeping the size if it's non-standard, or just use defaults if it matches.
            if (normalized[key].size === defaults[key].size) {
                normalized[key].offset = defaults[key].offset
            } else {
                // Non-standard size but 0 offset? This is very likely wrong for X/Y/M.
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
