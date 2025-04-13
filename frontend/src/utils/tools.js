// @ts-check
"use strict"

export const generateID = () => {
    return Math.random().toString(36).substring(2, 9)
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
    style.textContent = css_code.split('\n').map(line => line.trim()).filter(Boolean).join('')
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