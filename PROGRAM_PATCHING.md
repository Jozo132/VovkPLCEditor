# Program Patching Feature

The Program Patching feature allows you to modify constant values in the PLC's **memory space** at runtime without recompiling. This is useful for quickly adjusting timer presets, setpoints, or other constant parameters.

## Architecture Understanding

The PLC has two separate memory arrays:

1. **Program Space** (Read-Only)
   - `uint8_t program[]` - Compiled bytecode that executes
   - Cannot be modified at runtime
   - Updated only via full program download

2. **Memory Space** (Read/Write)
   - `uint8_t memory[]` - IO, variables, markers, timers
   - Can be modified at runtime
   - **This is what the patcher modifies**

When you declare `const TIMER_PRESET 3000`, it allocates a location in the memory space (not program space). The patcher writes directly to this memory location.

## How It Works

1. **Scan for Constants**: The system scans your ASM code blocks for `const` declarations
2. **Direct Memory Write**: Patches are applied directly to device memory
3. **Type-Safe**: Values are validated against the constant's data type before writing
4. **Live Updates**: Changes take effect immediately when monitoring is active

## Usage

### Via UI (Setup Page)

1. Compile and download your program to the PLC
2. Go to the **Setup** page
3. Click the **"Patch Constants"** button
4. Select a constant from the list
5. Enter the new value
6. Click OK to apply

### Via Code

```javascript
// Scan for patchable constants
const constants = await editor.window_manager.scanPatchableConstants()
console.log('Available constants:', constants)

// Patch a single constant
const result = await editor.window_manager.patchConstant('TIMER_PRESET', 5000)
if (result.success) {
    console.log('Successfully patched!')
} else {
    console.error('Patch failed:', result.message)
}

// Read current value from device
const readResult = await editor.window_manager.readConstant('TIMER_PRESET')
if (readResult.success) {
    console.log('Current value:', readResult.value)
}
```

## Supported Data Types

- **Integers**: `u8`, `i8`, `u16`, `i16`, `u32`, `i32`, `u64`, `i64`, `byte`, `int`, `dint`, `word`, `dword`, `lword`
- **Floating Point**: `real`, `float`, `f32`, `f64`

## Example

```asm
// Define timer constants
const TIMER_PRESET 3000
const MAX_TEMP 75
const MIN_SPEED 10

// Use in your program
u32.const TIMER_PRESET
// ... timer logic
```

After compilation and download, you can patch these values:
- `TIMER_PRESET`: Change timer duration without recompiling
- `MAX_TEMP`: Adjust temperature threshold
- `MIN_SPEED`: Modify speed limits

## Limitations

- **Must be connected**: Device must be online to apply patches
- **const declarations only**: Only values declared with `const` keyword are patchable
- **Type constraints**: New values must fit within the constant's data type range
- **Symbol required**: Constant must have a corresponding symbol definition in the project

## Technical Details

### Memory Location

Constants are stored in memory based on their symbol's location:
- **Control (C)**: Control memory area
- **Marker (M)**: General marker memory
- **Input/Output**: Can be used but not recommended for constants
- **System (S)**: System memory area

### Byte Ordering

All values are written in little-endian byte order to match the PLC architecture.

### Value Validation

Before writing, values are checked:
1. **Type range**: Must fit in the datatype (e.g., u8: 0-255)
2. **Finite**: Must be a valid, finite number
3. **Connection**: Device must be connected

## API Reference

### WindowManager Methods

#### `scanPatchableConstants()`
Returns array of patchable constants found in the project.

**Returns**: `Promise<Array<{name, type, value, location, address, size}>>`

#### `patchConstant(constantName, newValue)`
Patches a single constant value.

**Parameters**:
- `constantName` (string): Name of the constant
- `newValue` (number): New value to set

**Returns**: `Promise<{success: boolean, message: string}>`

#### `readConstant(constantName)`
Reads the current value from device memory.

**Parameters**:
- `constantName` (string): Name of the constant

**Returns**: `Promise<{success: boolean, value?: number, message?: string}>`

#### `openPatchDialog(constantName?)`
Opens a dialog to patch constants interactively.

**Parameters**:
- `constantName` (string, optional): Pre-select a constant

**Returns**: `Promise<void>`

### ProgramPatcher Class

Located in `frontend/src/editor/ProgramPatcher.js`

Direct access via `editor.program_patcher` if you need low-level control.

## Best Practices

1. **Test values offline first**: Use simulation mode to verify new values
2. **Document changes**: Keep track of patched values outside the code
3. **Backup**: Save your project before patching critical values
4. **Monitor after patching**: Enable monitoring to verify the change took effect
5. **Type awareness**: Be mindful of integer overflow/underflow

## Troubleshooting

### "Constant not found"
- Ensure the constant is declared with `const` keyword
- Check that a symbol exists for the constant name
- Rescan constants after code changes

### "Value out of range"
- Check the constant's data type
- Verify the value fits within type limits
- Consider using a larger data type if needed

### "Not connected to device"
- Ensure device is online
- Check connection status in Setup page
- Reconnect if necessary

### Patch doesn't take effect
- Enable monitoring to see live values
- Check if the constant's memory location is being overwritten
- Verify the correct constant was patched
