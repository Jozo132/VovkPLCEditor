// @ts-check
/**
 * @file BytecodePatcher.js
 * @description
 * Bytecode Patcher - Allows runtime modification of immediate constant values in compiled bytecode
 * 
 * Uses the IR (Intermediate Representation) system from VovkPLC Runtime to identify patchable constants.
 * The IR is generated during compilation and provides precise information about each instruction,
 * including bytecode offsets, operand types, and editability flags.
 * 
 * Two distinct memory spaces exist in the PLC:
 * - Memory Space: Read/write uint8_t array for IO and variables (accessed via readMemory/writeMemory)
 * - Program Space: Read-only uint8_t array containing compiled bytecode
 * 
 * This patcher targets the PROGRAM SPACE to modify immediate constants embedded in bytecode
 * (e.g., timer preset values like #500 in "TON M69 #500").
 * 
 * For example, in "TON M69 #500":
 * - M69 is a memory address (timer storage location) - NOT patched
 * - #500 is an immediate value in the bytecode - THIS IS PATCHED
 * 
 * IR-based approach:
 * - Queries ir_get_count(), ir_get_pointer(), ir_get_entry_size() from WASM
 * - Filters entries with IR_FLAG_EDITABLE (0x40) flag
 * - Extracts operand positions and types for precise patching
 * - Maintains source line/column information for UI display
 */

// IR Entry Flags (from runtime-instructions.h)
const IR_FLAG_NONE = 0x00
const IR_FLAG_READ = 0x01        // Instruction reads from memory
const IR_FLAG_WRITE = 0x02       // Instruction writes to memory
const IR_FLAG_CONST = 0x04       // Instruction uses an embedded constant
const IR_FLAG_JUMP = 0x08        // Instruction is a jump/call
const IR_FLAG_TIMER = 0x10       // Instruction is a timer
const IR_FLAG_LABEL_TARGET = 0x20 // This address is a jump target (label)
const IR_FLAG_EDITABLE = 0x40    // Constant can be edited in-place

// IR Operand Types (from plcasm-compiler.h)
const IR_OP_NONE = 0
const IR_OP_BOOL = 1
const IR_OP_I8 = 2
const IR_OP_U8 = 3
const IR_OP_I16 = 4
const IR_OP_U16 = 5
const IR_OP_I32 = 6
const IR_OP_U32 = 7
const IR_OP_I64 = 8
const IR_OP_U64 = 9
const IR_OP_F32 = 10
const IR_OP_F64 = 11
const IR_OP_PTR = 12      // Pointer/address
const IR_OP_LABEL = 13    // Jump target label

const IR_OPERAND_TYPE_NAMES = {
    [IR_OP_NONE]: 'none',
    [IR_OP_BOOL]: 'bool',
    [IR_OP_I8]: 'i8',
    [IR_OP_U8]: 'u8',
    [IR_OP_I16]: 'i16',
    [IR_OP_U16]: 'u16',
    [IR_OP_I32]: 'i32',
    [IR_OP_U32]: 'u32',
    [IR_OP_I64]: 'i64',
    [IR_OP_U64]: 'u64',
    [IR_OP_F32]: 'f32',
    [IR_OP_F64]: 'f64',
    [IR_OP_PTR]: 'ptr',
    [IR_OP_LABEL]: 'label',
}

// Timer instruction opcodes (for display names)
const TIMER_OPCODES = {
    TON_CONST: 0x30,  // Timer On-Delay with constant preset
    TOF_CONST: 0x32,  // Timer Off-Delay with constant preset
    TP_CONST: 0x34,   // Timer Pulse with constant preset
}

const OPCODE_NAMES = {
    0x30: 'TON',
    0x32: 'TOF',
    0x34: 'TP',
}

/**
 * @typedef {{
 *     name: string,
 *     type: string,
 *     current_value: number,
 *     bytecode_offset: number,
 *     bytecode_size: number,
 *     instruction_name: string,
 *     opcode: number,
 *     source_line: number,
 *     source_column: number,
 *     flags: number,
 *     operand_index: number,
 *     operand_type: string,
 *     timer_address?: number,
 * }} PatchableConstant
 */

export default class LivePatcher {
    #editor = null
    
    constructor(editor) {
        this.#editor = editor
        /** @type {Map<number, PatchableConstant>} */
        this.patchableConstants = new Map() // keyed by bytecode_offset
    }

    /**
     * Read IR entries from WASM runtime
     * @returns {Promise<Array<{bytecode_offset: number, source_line: number, source_column: number, bytecode_size: number, opcode: number, flags: number, operand_count: number, operands: Array<{type: number, bytecode_pos: number, value: number}>}>>}
     */
    async _readIREntries() {
        const runtime = this.#editor?.runtime
        if (!runtime) {
            console.warn('[LivePatcher] No runtime available')
            return []
        }

        try {
            // Get IR data from WASM
            const count = await runtime.callExport('ir_get_count')
            if (!count || count === 0) {
                return []
            }

            const pointer = await runtime.callExport('ir_get_pointer')
            const entrySize = await runtime.callExport('ir_get_entry_size')

            if (!pointer || !entrySize) {
                return []
            }

            // Read IR entries from WASM memory
            const entries = []
            const memory = new Uint8Array(runtime.wasm.exports.memory.buffer)

            for (let i = 0; i < count; i++) {
                const offset = pointer + (i * entrySize)
                
                // Parse IR_Entry struct (48 bytes)
                // Location info (12 bytes) - all little-endian
                const bytecode_offset = memory[offset] | (memory[offset + 1] << 8) | 
                                       (memory[offset + 2] << 16) | (memory[offset + 3] << 24)
                const source_line = memory[offset + 4] | (memory[offset + 5] << 8)
                const source_column = memory[offset + 6] | (memory[offset + 7] << 8)
                const bytecode_size = memory[offset + 8]
                const opcode = memory[offset + 9]
                const flags = memory[offset + 10]
                const operand_count = memory[offset + 11]

                // Parse operands (3 operands max, 16 bytes each due to alignment)
                // Actual layout: type(1) + bytecode_pos(1) + padding(6) + value(8) = 16 bytes
                const operands = []
                for (let j = 0; j < operand_count && j < 3; j++) {
                    const op_offset = offset + 12 + (j * 16) // 16-byte stride per operand
                    const type = memory[op_offset]
                    const bytecode_pos = memory[op_offset + 1]
                    // skip padding at offset 2-7 (6 bytes!)
                    
                    // Read value from union at offset 8 (not 4!) - little-endian
                    let value = memory[op_offset + 8] | (memory[op_offset + 9] << 8) | 
                               (memory[op_offset + 10] << 16) | (memory[op_offset + 11] << 24)
                    value = value >>> 0

                    operands.push({
                        type,
                        bytecode_pos,
                        value
                    })
                }

                entries.push({
                    bytecode_offset,
                    source_line,
                    source_column,
                    bytecode_size,
                    opcode,
                    flags,
                    operand_count,
                    operands
                })
            }

            console.log(`Successfully read ${entries.length} IR entries`)
            return entries
        } catch (error) {
            console.error('Error reading IR entries:', error)
            return []
        }
    }

    /**
     * Parse bytecode string to Uint8Array
     */
    _parseBytecode(bytecodeStr) {
        if (!bytecodeStr || typeof bytecodeStr !== 'string') return null
        
        // Remove whitespace and convert hex string to bytes
        const hexStr = bytecodeStr.replace(/\s+/g, '')
        if (hexStr.length % 2 !== 0) return null // Must be even length
        
        const bytes = new Uint8Array(hexStr.length / 2)
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hexStr.substr(i * 2, 2), 16)
        }
        return bytes
    }

    /**
     * Convert Uint8Array to hex string
     */
    _bytesToHexString(bytes) {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    }

    /**
     * Read u32 value from bytecode at offset (big-endian)
     */
    _readU32BigEndian(bytes, offset) {
        return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
    }

    /**
     * Read u16 value from bytecode at offset (big-endian)
     */
    _readU16BigEndian(bytes, offset) {
        return (bytes[offset] << 8) | bytes[offset + 1]
    }

    /**
     * Write value to bytecode at offset with proper endianness based on type size
     */
    _writeValueBigEndian(bytes, offset, value, size) {
        if (size === 1) {
            bytes[offset] = value & 0xFF
        } else if (size === 2) {
            bytes[offset] = (value >> 8) & 0xFF
            bytes[offset + 1] = value & 0xFF
        } else if (size === 4) {
            bytes[offset] = (value >> 24) & 0xFF
            bytes[offset + 1] = (value >> 16) & 0xFF
            bytes[offset + 2] = (value >> 8) & 0xFF
            bytes[offset + 3] = value & 0xFF
        } else if (size === 8) {
            // For 64-bit values, handle as two 32-bit chunks
            const high = Math.floor(value / 0x100000000)
            const low = value >>> 0
            bytes[offset] = (high >> 24) & 0xFF
            bytes[offset + 1] = (high >> 16) & 0xFF
            bytes[offset + 2] = (high >> 8) & 0xFF
            bytes[offset + 3] = high & 0xFF
            bytes[offset + 4] = (low >> 24) & 0xFF
            bytes[offset + 5] = (low >> 16) & 0xFF
            bytes[offset + 6] = (low >> 8) & 0xFF
            bytes[offset + 7] = low & 0xFF
        }
    }

    /**
     * Read value from bytecode at offset with proper endianness based on type size
     */
    _readValueBigEndian(bytes, offset, size) {
        if (size === 1) {
            return bytes[offset]
        } else if (size === 2) {
            return (bytes[offset] << 8) | bytes[offset + 1]
        } else if (size === 4) {
            return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | 
                   (bytes[offset + 2] << 8) | bytes[offset + 3]
        } else if (size === 8) {
            // For 64-bit values, return as number (may lose precision beyond 2^53)
            const high = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | 
                        (bytes[offset + 2] << 8) | bytes[offset + 3]
            const low = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | 
                       (bytes[offset + 6] << 8) | bytes[offset + 7]
            return high * 0x100000000 + (low >>> 0)
        }
        return 0
    }

    /**
     * Scan compiled bytecode for patchable constants using IR data
     * Returns array of PatchableConstant
     */
    async scanPatchableConstants() {
        const patches = []
        const project = this.#editor?.project
        if (!project?.compiledBytecode) {
            return patches
        }

        // Read IR entries from WASM runtime
        const irEntries = await this._readIREntries()
        if (irEntries.length === 0) {
            return patches
        }
        
        // Filter entries with EDITABLE flag
        for (const entry of irEntries) {
            if (!(entry.flags & IR_FLAG_EDITABLE)) continue

            const isTimer = (entry.flags & IR_FLAG_TIMER) !== 0

            // Find the editable operand (usually the constant value)
            for (let opIdx = 0; opIdx < entry.operands.length; opIdx++) {
                const operand = entry.operands[opIdx]
                
                // Skip pointer operands (memory addresses), we only want constants
                if (operand.type === IR_OP_PTR || operand.type === IR_OP_LABEL) continue

                // For timer instructions, skip the first operand (timer address) and only patch the second (preset)
                if (isTimer && opIdx === 0) continue

                // Calculate absolute bytecode offset for this operand
                let operandBytecodeOffset
                
                if (isTimer && opIdx === 1) {
                    // Timer preset: [opcode:1][timer_addr:u16][preset:u32]
                    // Preset is at offset 3 (1 byte opcode + 2 bytes timer address)
                    operandBytecodeOffset = entry.bytecode_offset + 3
                } else {
                    // Use IR bytecode_pos for other operands
                    operandBytecodeOffset = entry.bytecode_offset + operand.bytecode_pos
                }

                // Determine type name
                const typeName = IR_OPERAND_TYPE_NAMES[operand.type] || 'unknown'
                
                // Read actual value from bytecode (IR operand values are unreliable)
                const bytecode = this._parseBytecode(project.compiledBytecode)
                let currentValue = operand.value // fallback to IR value
                
                if (bytecode && operandBytecodeOffset + 4 <= bytecode.length) {
                    // Read value from bytecode (big-endian)
                    const size = this._getTypeSize(operand.type)
                    if (size === 4) {
                        currentValue = (bytecode[operandBytecodeOffset] << 24) | 
                                      (bytecode[operandBytecodeOffset + 1] << 16) | 
                                      (bytecode[operandBytecodeOffset + 2] << 8) | 
                                      bytecode[operandBytecodeOffset + 3]
                        currentValue = currentValue >>> 0 // convert to unsigned
                    } else if (size === 2) {
                        currentValue = (bytecode[operandBytecodeOffset] << 8) | bytecode[operandBytecodeOffset + 1]
                    } else if (size === 1) {
                        currentValue = bytecode[operandBytecodeOffset]
                    }
                }

                // Create name based on instruction type
                let name = `@${entry.bytecode_offset.toString(16).toUpperCase()}`
                let instructionName = 'CONST'
                let timerAddress = undefined

                if (entry.flags & IR_FLAG_TIMER) {
                    // Timer instruction - extract timer address from bytecode
                    instructionName = OPCODE_NAMES[entry.opcode] || 'TIMER'
                    
                    if (bytecode && entry.bytecode_offset + 3 <= bytecode.length) {
                        // Read 2-byte timer address at offset+1 (BIG-ENDIAN)
                        timerAddress = (bytecode[entry.bytecode_offset + 1] << 8) | bytecode[entry.bytecode_offset + 2]
                        name = `${instructionName}_M${timerAddress}_@${entry.bytecode_offset.toString(16).toUpperCase()}`
                    } else {
                        name = `${instructionName}_@${entry.bytecode_offset.toString(16).toUpperCase()}`
                    }
                } else {
                    name = `CONST_@${entry.bytecode_offset.toString(16).toUpperCase()}_L${entry.source_line}`
                }

                patches.push({
                    name,
                    type: typeName,
                    current_value: currentValue,
                    bytecode_offset: operandBytecodeOffset,
                    bytecode_size: this._getTypeSize(operand.type),
                    instruction_name: instructionName,
                    opcode: entry.opcode,
                    source_line: entry.source_line,
                    source_column: entry.source_column,
                    flags: entry.flags,
                    operand_index: opIdx,
                    operand_type: typeName,
                    timer_address: timerAddress,
                })
            }
        }

        console.log(`[LivePatcher] Found ${patches.length} patchable constant(s)`)

        // Update internal map
        this.patchableConstants.clear()
        patches.forEach(p => this.patchableConstants.set(p.bytecode_offset, p))

        return patches
    }

    /**
     * Get byte size for an IR operand type
     */
    _getTypeSize(irType) {
        switch (irType) {
            case IR_OP_BOOL:
            case IR_OP_U8:
            case IR_OP_I8:
                return 1
            case IR_OP_U16:
            case IR_OP_I16:
            case IR_OP_PTR:
                return 2
            case IR_OP_U32:
            case IR_OP_I32:
            case IR_OP_F32:
                return 4
            case IR_OP_U64:
            case IR_OP_I64:
            case IR_OP_F64:
                return 8
            default:
                return 4 // Default to 4 bytes
        }
    }

    /**
     * Read the current value of a constant from bytecode
     * @param {number} bytecodeOffset - Offset in bytecode where the value is stored
     * @returns {Promise<{success: boolean, value?: number, message?: string}>}
     */
    async readConstant(bytecodeOffset) {
        const constant = this.patchableConstants.get(bytecodeOffset)
        if (!constant) {
            return { success: false, message: `No patchable constant at offset ${bytecodeOffset}` }
        }

        const project = this.#editor?.project
        if (!project?.compiledBytecode) {
            return { success: false, message: 'No compiled bytecode available' }
        }

        const bytecode = this._parseBytecode(project.compiledBytecode)
        if (!bytecode) {
            return { success: false, message: 'Failed to parse bytecode' }
        }

        if (bytecodeOffset + constant.bytecode_size > bytecode.length) {
            return { success: false, message: 'Offset out of range' }
        }

        const value = this._readValueBigEndian(bytecode, bytecodeOffset, constant.bytecode_size)
        return { success: true, value }
    }

    /**
     * Patch a constant value in the bytecode and re-upload to device
     * @param {number} bytecodeOffset - Offset in bytecode where the value is stored
     * @param {number} newValue - New value to set
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async patchConstant(bytecodeOffset, newValue) {
        const constant = this.patchableConstants.get(bytecodeOffset)
        if (!constant) {
            return { success: false, message: `No patchable constant at offset ${bytecodeOffset}` }
        }

        // Validate value based on type
        const validation = this._validateValueForType(newValue, constant.operand_type, constant.bytecode_size)
        if (!validation.valid) {
            return { success: false, message: validation.message }
        }

        // Check if we're connected
        const connected = this.#editor.device_manager?.connected
        if (!connected) {
            return { success: false, message: 'Not connected to device' }
        }

        const project = this.#editor?.project
        if (!project?.compiledBytecode) {
            return { success: false, message: 'No compiled bytecode available' }
        }

        try {
            // Parse current bytecode
            const bytecode = this._parseBytecode(project.compiledBytecode)
            if (!bytecode) {
                return { success: false, message: 'Failed to parse bytecode' }
            }

            if (bytecodeOffset + constant.bytecode_size > bytecode.length) {
                return { success: false, message: 'Offset out of range' }
            }

            // Modify the bytecode
            this._writeValueBigEndian(bytecode, bytecodeOffset, newValue, constant.bytecode_size)

            // Convert back to hex string
            const modifiedBytecode = this._bytesToHexString(bytecode)

            // Update project's compiled bytecode
            project.compiledBytecode = modifiedBytecode

            // Re-upload the modified bytecode to the device
            const connection = this.#editor.device_manager.connection
            await connection.downloadProgram(modifiedBytecode)

            // Update the constant's stored value
            constant.current_value = newValue

            // Format message based on type
            let msg = `Successfully patched ${constant.name} to ${newValue}`
            if (constant.flags & IR_FLAG_TIMER) {
                msg = `Successfully patched ${constant.instruction_name} preset at M${constant.timer_address} to ${newValue}ms`
            }

            return { success: true, message: msg }
        } catch (error) {
            return { 
                success: false, 
                message: `Failed to patch: ${error.message}` 
            }
        }
    }

    /**
     * Validate value for a specific type
     */
    _validateValueForType(value, typeName, size) {
        if (!Number.isFinite(value)) {
            return { valid: false, message: 'Value must be a finite number' }
        }

        if (!Number.isInteger(value)) {
            // Allow floats for f32/f64 types
            if (typeName !== 'f32' && typeName !== 'f64') {
                return { valid: false, message: `Value must be an integer for type ${typeName}` }
            }
        }

        // Check bounds based on type
        switch (typeName) {
            case 'u8':
                if (value < 0 || value > 0xFF) {
                    return { valid: false, message: 'Value must be between 0 and 255 (u8)' }
                }
                break
            case 'i8':
                if (value < -128 || value > 127) {
                    return { valid: false, message: 'Value must be between -128 and 127 (i8)' }
                }
                break
            case 'u16':
                if (value < 0 || value > 0xFFFF) {
                    return { valid: false, message: 'Value must be between 0 and 65535 (u16)' }
                }
                break
            case 'i16':
                if (value < -32768 || value > 32767) {
                    return { valid: false, message: 'Value must be between -32768 and 32767 (i16)' }
                }
                break
            case 'u32':
                if (value < 0 || value > 0xFFFFFFFF) {
                    return { valid: false, message: 'Value must be between 0 and 4294967295 (u32)' }
                }
                break
            case 'i32':
                if (value < -2147483648 || value > 2147483647) {
                    return { valid: false, message: 'Value must be between -2147483648 and 2147483647 (i32)' }
                }
                break
            case 'u64':
                if (value < 0 || value > Number.MAX_SAFE_INTEGER) {
                    return { valid: false, message: `Value must be between 0 and ${Number.MAX_SAFE_INTEGER} (u64, limited by JavaScript)` }
                }
                break
            case 'i64':
                if (value < -Number.MAX_SAFE_INTEGER || value > Number.MAX_SAFE_INTEGER) {
                    return { valid: false, message: `Value must be between ${-Number.MAX_SAFE_INTEGER} and ${Number.MAX_SAFE_INTEGER} (i64, limited by JavaScript)` }
                }
                break
        }

        return { valid: true }
    }

    /**
     * Patch multiple constants at once
     * @param {Array<{bytecodeOffset: number, value: number}>} patches
     * @returns {Promise<{success: boolean, message: string, results: Array<{offset: number, success: boolean, message: string}>}>}
     */
    async patchMultiple(patches) {
        if (!patches || patches.length === 0) {
            return { success: false, message: 'No patches provided', results: [] }
        }

        // Check if we're connected
        const connected = this.#editor.device_manager?.connected
        if (!connected) {
            return { success: false, message: 'Not connected to device', results: [] }
        }

        const project = this.#editor?.project
        if (!project?.compiledBytecode) {
            return { success: false, message: 'No compiled bytecode available', results: [] }
        }

        try {
            // Parse current bytecode
            const bytecode = this._parseBytecode(project.compiledBytecode)
            if (!bytecode) {
                return { success: false, message: 'Failed to parse bytecode', results: [] }
            }

            const results = []
            let errorCount = 0

            // Apply all patches to the bytecode
            for (const patch of patches) {
                const constant = this.patchableConstants.get(patch.bytecodeOffset)
                if (!constant) {
                    results.push({
                        offset: patch.bytecodeOffset,
                        success: false,
                        message: `No patchable constant at offset ${patch.bytecodeOffset}`
                    })
                    errorCount++
                    continue
                }

                // Validate value
                const validation = this._validateValueForType(patch.value, constant.operand_type, constant.bytecode_size)
                if (!validation.valid) {
                    results.push({
                        offset: patch.bytecodeOffset,
                        success: false,
                        message: validation.message
                    })
                    errorCount++
                    continue
                }

                if (patch.bytecodeOffset + constant.bytecode_size > bytecode.length) {
                    results.push({
                        offset: patch.bytecodeOffset,
                        success: false,
                        message: 'Offset out of range'
                    })
                    errorCount++
                    continue
                }

                // Apply patch
                this._writeValueBigEndian(bytecode, patch.bytecodeOffset, patch.value, constant.bytecode_size)
                constant.current_value = patch.value
                
                results.push({
                    offset: patch.bytecodeOffset,
                    success: true,
                    message: `Patched ${constant.name} to ${patch.value}`
                })
            }

            // Convert back to hex string
            const modifiedBytecode = this._bytesToHexString(bytecode)

            // Update project's compiled bytecode
            project.compiledBytecode = modifiedBytecode

            // Re-upload the modified bytecode to the device
            const connection = this.#editor.device_manager.connection
            await connection.downloadProgram(modifiedBytecode)

            const successCount = patches.length - errorCount
            return {
                success: errorCount === 0,
                message: `Patched ${successCount}/${patches.length} constants successfully`,
                results
            }
        } catch (error) {
            return {
                success: false,
                message: `Failed to patch: ${error.message}`,
                results: []
            }
        }
    }
}
