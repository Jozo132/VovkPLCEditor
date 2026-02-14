/**
 * @file plc-protocol.ts
 * @description PLC protocol utilities for building commands and parsing responses.
 * This implements the VovkPLC serial protocol used by the runtime.
 */

// CRC8 lookup table (polynomial 0x31)
const crc8Table: number[] = []
let crc8TableLoaded = false

function initCrc8Table(): void {
    if (crc8TableLoaded) return
    crc8TableLoaded = true
    for (let i = 0; i < 256; i++) {
        let crc8 = i
        for (let j = 0; j < 8; j++) {
            crc8 = crc8 & 0x80 ? ((crc8 << 1) ^ 0x31) : (crc8 << 1)
        }
        crc8Table[i] = crc8 & 0xff
    }
}

/**
 * Calculate CRC8 checksum
 */
export function crc8(data: number | number[], initialCrc = 0): number {
    initCrc8Table()
    const bytes = Array.isArray(data) ? data : [data]
    let crc = initialCrc
    for (const byte of bytes) {
        if (byte < 0 || byte > 255) throw new Error(`Invalid byte: ${byte}`)
        const index = (crc ^ byte) & 0xff
        crc = crc8Table[index] & 0xff
    }
    return crc
}

/**
 * Convert string to hex bytes
 */
export function stringToHex(str: string): string {
    return str.split('').map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
}

/**
 * Parse hex string to byte array
 */
export function parseHex(hexString: string): number[] {
    const clean = hexString.replace(/[^0-9a-fA-F]/g, '')
    if (clean.length % 2 !== 0) throw new Error(`Invalid hex string length: ${clean.length}`)
    const result: number[] = []
    for (let i = 0; i < clean.length; i += 2) {
        result.push(parseInt(clean.substring(i, i + 2), 16))
    }
    return result
}

/**
 * Build memory read command
 * Format: MR<address_u32><size_u32><checksum>
 */
export function buildMemoryReadCommand(address: number, size: number): string {
    const cmd = 'MR'
    const cmdHex = stringToHex(cmd)
    const addressHex = address.toString(16).padStart(8, '0')
    const sizeHex = size.toString(16).padStart(8, '0')
    
    let checksum = crc8(parseHex(cmdHex))
    checksum = crc8(parseHex(addressHex), checksum)
    checksum = crc8(parseHex(sizeHex), checksum)
    
    const checksumHex = checksum.toString(16).padStart(2, '0')
    return (cmd + addressHex + sizeHex + checksumHex).toUpperCase()
}

/**
 * Build memory write command
 * Format: MW<address_u32><size_u32><data><checksum>
 */
export function buildMemoryWriteCommand(address: number, data: number[]): string {
    const cmd = 'MW'
    const cmdHex = stringToHex(cmd)
    const addressHex = address.toString(16).padStart(8, '0')
    const sizeHex = data.length.toString(16).padStart(8, '0')
    const dataHex = data.map(b => b.toString(16).padStart(2, '0')).join('')
    
    let checksum = crc8(parseHex(cmdHex))
    checksum = crc8(parseHex(addressHex), checksum)
    checksum = crc8(parseHex(sizeHex), checksum)
    checksum = crc8(data, checksum)
    
    const checksumHex = checksum.toString(16).padStart(2, '0')
    return (cmd + addressHex + sizeHex + dataHex + checksumHex).toUpperCase()
}

/**
 * Build program info command (PI)
 * Format: PI<checksum>
 */
export function buildProgramInfoCommand(): string {
    const cmd = 'PI'
    const cmdHex = stringToHex(cmd)
    const checksum = crc8(parseHex(cmdHex))
    const checksumHex = checksum.toString(16).padStart(2, '0')
    return (cmd + checksumHex).toUpperCase()
}

/**
 * Parse memory read response
 * Response format: OK<hex_data> or just <hex_data>
 */
export function parseMemoryResponse(response: string): Uint8Array | null {
    let raw = response.trim()
    if (raw.startsWith('OK')) {
        raw = raw.substring(2).trim()
    }
    if (!raw || raw.startsWith('ERR') || raw.startsWith('E:')) {
        return null
    }
    try {
        const bytes = parseHex(raw)
        return new Uint8Array(bytes)
    } catch {
        return null
    }
}

/**
 * Memory subscription entry
 */
export interface MemorySubscription {
    address: number
    size: number
    command: string // Pre-built command string
}

/**
 * Create subscription entry with pre-built command
 */
export function createMemorySubscription(address: number, size: number): MemorySubscription {
    return {
        address,
        size,
        command: buildMemoryReadCommand(address, size)
    }
}
