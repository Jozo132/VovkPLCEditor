// @ts-check
"use strict"

import { ElementSynthesisMany, importCSSCode } from "../../../../utils/tools.js"

/** 
 * 
 * @typedef {{ 
 *     text?: string,
 *     color?: string,
 *     background?: string,
 *     value?: string
 *     verify?: () => boolean,
 * }} PopupEndorseButton
 * 
 * @typedef {{
 *     title?: string,
 *     description?: string,
 *     width?: string,
 *     height?: string,
 *     container?: Element | HTMLElement,
 *     backdrop?: boolean,
 *     verify?: () => boolean,
 *     onOpen?: () => void,
 *     onClose?: (value?: string) => void,
 *     content?: string | string[] | HTMLElement | HTMLElement[] | Element | Element[],
 *     buttons?: PopupEndorseButton[],
 * }} PopupOptions
**/

/** @type { (parent: Element, selector: string) => Element } */
const querySelect = (parent, selector) => {
    const el = parent.querySelector(selector)
    if (!el) throw new Error(`Element not found: ${selector}`)
    return el
}



await importCSSCode(/*CSS*/`
    /* backdrop should prevent selection in the background */
    .plc-popup-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.2);
        z-index: 9999;
    }
    .plc-popup-window {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #fff;
        border: 1px solid #000;
        border-radius: 8px;
        box-shadow: 0 4px 8px #FFF1;
        width: auto;
        max-width: 90%;
        z-index: 10000;
        font-family: Arial, sans-serif;
        padding: 4px;
    }
    .plc-popup-header {
        padding: 2px;
        height: 28px;
        background-color: #f1f1f1;
        position: relative;
        display: flex;
        user-select: none;
    }
    .plc-popup-body {
        padding: 4px;
    }
    .plc-popup-footer {
        padding: 4px;
        text-align: right;
    }
    .plc-popup-close {
        cursor: pointer;
        font-size: 24px;
        color: #333;
        position: absolute;
        right: 16px;
        align-items: center;
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        font-weight: bold;
        user-select: none;
    }
    .plc-popup-close:hover {
        color: #f00;
    }
    .plc-popup-title {
        margin: 0;
        font-size: 24px;
        position: absolute;
        left: 16px;

    }
    .plc-popup-description {
        margin: 0;
        font-size: 16px;
        color: #666;
    }
    .plc-popup-content {
        margin-top: 16px;
    }
    .plc-popup-footer button {
        margin-left: 8px;
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        user-select: none;
    }
    .plc-popup-footer button:hover {
        background-color: #ddd;
    }
    .plc-popup-footer button:focus {
        outline: none;
    }
    .plc-popup-footer button[disabled] {
        background-color: #ccc;
        cursor: not-allowed;
    }
    .plc-popup-footer button[disabled]:hover {
        background-color: #ccc;
    }
    .plc-popup-footer button[disabled]:focus {
        outline: none;
    }
`)

const popup_template = /*HTML*/`
    <div class="plc-popup-backdrop">
        <!-- Backdrop, if enabled, the popup will be closed, otherwise it will prevent the popup from closing -->
    </div>
    <dialog class="plc-popup-window">
        <div class="plc-popup-header">
            <h2 class="plc-popup-title">Popup Title</h2>
            <button class="plc-popup-close">&times;</button>
        </div>
        <div class="plc-popup-body">
            <p class="plc-popup-description">This is a description of the popup.</p>
            <div class="plc-popup-content">
                <!-- Content will be added here dynamically -->
            </div>
        </div>
        <div class="plc-popup-footer">
            <!-- Buttons will be added here dynamically -->
        </div>
    </dialog>
`

export class Popup {
    /** @type {Element} */ popup
    /** @type {Element} */ header
    /** @type {Element} */ body
    /** @type {Element} */ footer
    /** @type {Element} */ backdrop

    /** @param {PopupOptions} options */
    constructor(options) {
        options = options || {}
        if (typeof options.backdrop === 'undefined') options.backdrop = true
        this.options = options
        const [backdrop, popup] = ElementSynthesisMany(popup_template)
        this.backdrop = backdrop
        this.popup = popup

        // Prevent the TAB button from selecting the background
        popup.addEventListener('keydown', (e) => { // @ts-ignore
            if (e.key === 'Tab') e.preventDefault()
        })
        backdrop.addEventListener('keydown', (e) => { // @ts-ignore
            if (e.key === 'Tab') e.preventDefault()
        })

        const header = this.header = querySelect(popup, '.plc-popup-header')
        const footer = this.footer = querySelect(popup, '.plc-popup-footer')

        const title = querySelect(popup, '.plc-popup-title')
        const description = querySelect(popup, '.plc-popup-description')
        const content = querySelect(popup, '.plc-popup-content')
        const closeButton = querySelect(popup, '.plc-popup-close')
        if (options.title) title.innerHTML = options.title
        else title.remove()
        if (options.description) description.innerHTML = options.description
        else description.remove()
        const popup_styles = []
        if (options.width) popup_styles.push(`width: ${options.width};`)
        if (options.height) popup_styles.push(`height: ${options.height};`)
        if (popup_styles.length > 0) popup.setAttribute('style', popup_styles.join(' '))

        if (options.backdrop) {
            backdrop.addEventListener('click', () => {
                this.close()
            })
        }
        closeButton.addEventListener('click', () => {
            this.close()
        })

        const appendContent = (content) => {
            if (Array.isArray(content)) {
                content.forEach(c => appendContent(c))
            } else if (typeof content === 'string') {
                const div = document.createElement('div')
                div.innerHTML = content
                this.body.appendChild(div)
            } else if (content instanceof HTMLElement || content instanceof Element) {
                this.body.appendChild(content)
            } else {
                throw new Error(`Invalid content type: ${typeof content}`)
            }
        }
        if (options.content) appendContent(options.content)
        else content.remove()
        if (options.buttons) {
            options.buttons.forEach(button => {
                const btn = document.createElement('button')
                btn.innerHTML = button.text || 'Button'
                btn.style.color = button.color || '#000'
                btn.style.backgroundColor = button.background || '#fff'
                const verify = button.verify
                if (verify) {
                    btn.addEventListener('click', () => {
                        if (verify()) this.close(button.value)
                    })
                } else {
                    btn.addEventListener('click', () => {
                        this.close(button.value)
                    })
                }
                this.footer.appendChild(btn)
            })
        } else footer.remove()

        // Add the popup to the custom container or document body
        const container = options.container || document.body
        container.appendChild(this.backdrop)
        container.appendChild(this.popup)

        if (options.onOpen) options.onOpen() // @ts-ignore
        this.popup.style.display = 'block'
    }

    /** @param {string} [value] */
    close(value) {
        if (typeof value === 'undefined') value = 'closed'
        if (this.options.verify) {
            const ok = this.options.verify()
            if (!ok) return
        }
        if (this.options.onClose) this.options.onClose(value)
        this.popup.remove()
        this.backdrop.remove()
    }

    /** @param { PopupOptions } options */
    static async form(options) {
        options = options || {}
        const popup = new Popup(options)
        const promise = new Promise((resolve) => popup.options.onClose = (value) => resolve(value))
        const selected = await promise
        return selected
    }


}




Object.assign(window, { Popup })