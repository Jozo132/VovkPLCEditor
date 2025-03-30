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


/** @type { (html_code: string) => Element[] }  */
export const ElementSynthesis = (html_code) => {
    if (typeof html_code !== 'string') throw new Error(`Invalid HTML code: ${html_code}`)
    html_code = html_code.split('\n').map(line => line.trim()).filter(Boolean).join('')
    if (!html_code) return []
    const parser = new DOMParser()
    const doc = parser.parseFromString(html_code, 'text/html')
    return Array.from(doc.body.children)
}

export class ImageRenderer {
    canvas = document.createElement('canvas')
    constructor() { }
    /** @type { (options: { width: number, height: number, scale?: number, data: string }) => HTMLImageElement } */
    static renderSVG(options) {
        const canvas = document.createElement('canvas')
        const { width, height, data } = options
        const scale = options.scale || 1
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error(`Failed to get 2D context from canvas`)
        const img = new Image()
        img.src = `data:image/svg+xml;base64,${btoa(`
            <svg width="${width * scale}" height="${height * scale}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}">
                ${data}
            </svg>            
        `.split('\n').map(line => line.trim()).filter(Boolean).join(''))}`
        ctx.drawImage(img, 0, 0)
        return img
    }
}