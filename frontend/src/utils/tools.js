export const debug_components = true

export const generateID = () => {
    return Math.random().toString(36).substring(2, 9)
}

export const trimWhitespace = (str) => {
    const rows_with_content = str.split('\n').filter(row => row.trim())
    let least_amount_of_spaces = 1000
    rows_with_content.forEach(row => {
        const spaces = row.match(/^\s*/)[0].length
        if (spaces < least_amount_of_spaces) least_amount_of_spaces = spaces
    })
    const trimmed = least_amount_of_spaces > 0 ? rows_with_content.map(row => row.slice(least_amount_of_spaces)).join('\n') : str
    return trimmed
}

/** @type { (str: string) => string } */
export const toCapitalCase = (str) => {
    if (typeof str !== 'string') throw new Error(`Invalid string: ${str}`)
    return str.charAt(0).toUpperCase() + str.slice(1)
}


/** @type { (href: string) => Promise<void> } */
export const importCSS = async (href) => {
    // Import style from path './VovkPLCEditor.css'
    const style = document.createElement('link')
    style.rel = 'stylesheet'
    style.href = href
    const styleLoadPromise = new Promise((resolve, reject) => {
        style.onload = () => resolve(1);
        style.onerror = () => reject(new Error('Failed to load stylesheet'));
    });
    document.head.appendChild(style)
    await styleLoadPromise
}

/** @type { (css_code: string) => Promise<void> } */
export const importCSSCode = async (css_code) => {
    // Import style from code
    const style = document.createElement('style')
    style.type = 'text/css'
    style.textContent = trimWhitespace(css_code)
    const styleLoadPromise = new Promise((resolve, reject) => {
        style.onload = () => resolve(1);
        style.onerror = () => reject(new Error('Failed to load stylesheet'));
    });
    document.head.appendChild(style)
    await styleLoadPromise
}


/** @param { string } src */
export const CSSimporter = src => {
    /** @param { string } path */
    return (path) => {
        const url = new URL(path, src).href
        return importCSS(url)
    }
}

/** @type { (html_code: string) => Element[] }  */
export const ElementSynthesisMany = (html_code) => {
    if (typeof html_code !== 'string') throw new Error(`Invalid HTML code: ${html_code}`)
    html_code = html_code.split('\n').map(line => line.trim()).filter(Boolean).join('')
    if (!html_code) return []
    const parser = new DOMParser()
    const doc = parser.parseFromString(html_code, 'text/html')
    return Array.from(doc.body.children)
}


/** @type { (html_code: string) => Element }  */
export const ElementSynthesis = (html_code) => ElementSynthesisMany(html_code)[0]

/** @type { (event: any, stop_class?: string) => string[] } */
export const getEventPath = (event, stop_class) => {
    // Trace the event path from the PLCEditor root to the target element
    // Step 1: recursively trace parentElement until div with class "plc-workspace" is found
    // Step 2: reverse the Element array
    //     [<div class="plc-workspace">, <div class="plc-workspace-body">, <div class="plc-window">, <div class="plc-window-frame">]
    // Step 3: map each element to its first class name
    //     ["plc-workspace", "plc-workspace-body", "plc-window", "plc-window-frame"]
    // Step 4: return the array of class names
    const path = []
    let target = event.target
    while (target) {
        path.push(target)
        if (stop_class && target.classList.contains(stop_class)) break
        target = target.parentElement
    }
    path.reverse()
    const classNames = path.map(element => {
        const classes = Array.from(element.classList)
        return classes.length > 0 ? classes[0] : element.tagName.toLowerCase()
    })
    return classNames
}

export class ImageRenderer {
    canvas = document.createElement('canvas')
    constructor() { }
    /** @type { (options: { width: number, height: number, scale?: number, data: string }) => string } */
    static renderSVG(options) {
        const { width, height, data } = options
        const scale = options.scale || 1
        const src = `data:image/svg+xml;base64,${btoa(`
            <svg width="${width * scale}" height="${height * scale}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}">
                ${data}
            </svg>            
        `.split('\n').map(line => line.trim()).filter(Boolean).join(''))}`
        return src
    }
    /** @type { (options: { width: number, height: number, scale?: number, data: string }) => HTMLImageElement } */
    static renderSVGImage(options) {
        const canvas = document.createElement('canvas')
        const { width, height } = options
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error(`Failed to get 2D context from canvas`)
        const img = new Image()
        img.src = ImageRenderer.renderSVG(options)
        ctx.drawImage(img, 0, 0)
        return img
    }
}

/** @type { (elem: HTMLElement | Element) => boolean } */
export const isVisible = (elem) => {
    const style = getComputedStyle(elem)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    let parent = elem.parentElement
    while (parent) {
        const parentStyle = getComputedStyle(parent)
        if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') return false
        parent = parent.parentElement
    }
    return true
}

/**
 * Read a typed value from a DataView with endianness support
 * @param {DataView} view - The DataView to read from
 * @param {number} offset - Byte offset within the view
 * @param {string} type - Value type: 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'f32', 'f64', 'i64', 'u64'
 * @param {boolean} [littleEndian=true] - Endianness (true for little-endian, false for big-endian)
 * @returns {number|bigint|null} The value read, or null if out of bounds
 */
export const readTypedValue = (view, offset, type, littleEndian = true) => {
    try {
        switch (type) {
            case 'i8':
                return view.getInt8(offset)
            case 'u8':
            case 'byte':
                return view.getUint8(offset)
            case 'i16':
            case 'int':
                if (offset + 2 > view.byteLength) return null
                return view.getInt16(offset, littleEndian)
            case 'u16':
            case 'word':
                if (offset + 2 > view.byteLength) return null
                return view.getUint16(offset, littleEndian)
            case 'i32':
            case 'dint':
                if (offset + 4 > view.byteLength) return null
                return view.getInt32(offset, littleEndian)
            case 'u32':
            case 'dword':
                if (offset + 4 > view.byteLength) return null
                return view.getUint32(offset, littleEndian)
            case 'f32':
            case 'real':
            case 'float':
                if (offset + 4 > view.byteLength) return null
                return view.getFloat32(offset, littleEndian)
            case 'f64':
                if (offset + 8 > view.byteLength) return null
                return view.getFloat64(offset, littleEndian)
            case 'i64':
                if (offset + 8 > view.byteLength) return null
                return view.getBigInt64(offset, littleEndian)
            case 'u64':
            case 'lword':
                if (offset + 8 > view.byteLength) return null
                return view.getBigUint64(offset, littleEndian)
            default:
                return view.getUint8(offset)
        }
    } catch (e) {
        return null
    }
}

/**
 * Write a typed value to a DataView with endianness support
 * @param {DataView} view - The DataView to write to
 * @param {number} offset - Byte offset within the view
 * @param {string} type - Value type: 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'f32', 'f64', 'i64', 'u64'
 * @param {number|bigint} value - The value to write
 * @param {boolean} [littleEndian=true] - Endianness (true for little-endian, false for big-endian)
 * @returns {boolean} True if successful, false if out of bounds
 */
export const writeTypedValue = (view, offset, type, value, littleEndian = true) => {
    try {
        switch (type) {
            case 'i8':
                view.setInt8(offset, Number(value))
                return true
            case 'u8':
            case 'byte':
                view.setUint8(offset, Number(value))
                return true
            case 'i16':
            case 'int':
                if (offset + 2 > view.byteLength) return false
                view.setInt16(offset, Number(value), littleEndian)
                return true
            case 'u16':
            case 'word':
                if (offset + 2 > view.byteLength) return false
                view.setUint16(offset, Number(value), littleEndian)
                return true
            case 'i32':
            case 'dint':
                if (offset + 4 > view.byteLength) return false
                view.setInt32(offset, Number(value), littleEndian)
                return true
            case 'u32':
            case 'dword':
                if (offset + 4 > view.byteLength) return false
                view.setUint32(offset, Number(value), littleEndian)
                return true
            case 'f32':
            case 'real':
            case 'float':
                if (offset + 4 > view.byteLength) return false
                view.setFloat32(offset, Number(value), littleEndian)
                return true
            case 'f64':
                if (offset + 8 > view.byteLength) return false
                view.setFloat64(offset, Number(value), littleEndian)
                return true
            case 'i64':
                if (offset + 8 > view.byteLength) return false
                view.setBigInt64(offset, BigInt(value), littleEndian)
                return true
            case 'u64':
            case 'lword':
                if (offset + 8 > view.byteLength) return false
                view.setBigUint64(offset, BigInt(value), littleEndian)
                return true
            default:
                view.setUint8(offset, Number(value))
                return true
        }
    } catch (e) {
        return false
    }
}

if (debug_components) {
    Object.assign(window, {
        generateID,
        trimWhitespace,
        importCSS,
        importCSSCode,
        ElementSynthesisMany,
        ElementSynthesis,
        getEventPath,
        ImageRenderer,
        CSSimporter,
        isVisible,
        readTypedValue,
        writeTypedValue,
        debug_components,
    })
}