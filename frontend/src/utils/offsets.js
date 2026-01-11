export const normalizeOffsets = (offsets = {}) => {
    const normalized = { ...offsets }
    if (normalized.memory && !normalized.marker) normalized.marker = normalized.memory
    if (normalized.marker && !normalized.memory) normalized.memory = normalized.marker
    return normalized
}

export const ensureOffsets = (offsets = {}) => {
    const normalized = normalizeOffsets(offsets)
    const keys = ['control', 'input', 'output', 'system', 'marker']
    keys.forEach(key => {
        if (!normalized[key]) normalized[key] = { offset: 0, size: 0 }
    })
    return normalized
}
