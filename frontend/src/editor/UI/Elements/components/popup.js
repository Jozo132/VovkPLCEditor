// @ts-check
"use strict"

import { CSSimporter, ElementSynthesis } from "../../../../utils/tools.js"

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
 *     draggable?: boolean,
 *     container?: Element | HTMLElement,
 *     backdrop?: boolean,
 *     closeButton?: boolean,
 *     closeOnESC?: boolean,
 *     verify?: () => boolean,
 *     onOpen?: () => void,
 *     onClose?: (value?: string) => void,
 *     closeHandler?: (callback: (value?: string) => void) => void,
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


const importCSS = CSSimporter(import.meta.url)
await importCSS('./popup.css')

const popup_template = /*HTML*/`
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
    /** @type {Element} */ modal
    /** @type {Element} */ header
    /** @type {Element} */ body
    /** @type {Element} */ footer

    /** @param {PopupOptions} options */
    constructor(options) {
        options = options || {}
        if (typeof options.backdrop === 'undefined') options.backdrop = true
        if (typeof options.draggable === 'undefined') options.draggable = true
        if (typeof options.closeButton === 'undefined') options.closeButton = true
        if (typeof options.closeOnESC === 'undefined') options.closeOnESC = true
        this.options = options
        const modal = ElementSynthesis(popup_template)
        this.modal = modal

        const container = options.container || document.body

        modal.addEventListener('keydown', (e) => { // @ts-ignore
            if (e.key === 'Escape') {
                e.preventDefault()
                if (options.closeOnESC) this.close()
            }
        })

        const header = this.header = querySelect(modal, '.plc-popup-header')
        const footer = this.footer = querySelect(modal, '.plc-popup-footer')

        const title = querySelect(modal, '.plc-popup-title')
        const description = querySelect(modal, '.plc-popup-description')
        const content = querySelect(modal, '.plc-popup-content')
        const closeButton = querySelect(modal, '.plc-popup-close')
        if (!options.closeButton) closeButton.remove()
        if (options.title) title.innerHTML = options.title
        else title.remove()
        if (options.description) description.innerHTML = options.description
        else description.remove()
        const popup_styles = []
        if (options.width) popup_styles.push(`width: ${options.width};`)
        if (options.height) popup_styles.push(`height: ${options.height};`)
        if (popup_styles.length > 0) modal.setAttribute('style', popup_styles.join(' '))

        if (options.backdrop) {
            let backdropClick = false;
            modal.addEventListener('mousedown', (e) => backdropClick = e.target === modal)
            modal.addEventListener('mouseup', (e) => {
                if (backdropClick && e.target === modal) { // Confirmed backdrop click
                    this.close()
                }
                backdropClick = false;
            })
        }
        closeButton.addEventListener('click', () => {
            this.close()
        })

        // Allow the popup to be closed with code after it has been opened
        if (options.closeHandler) {
            options.closeHandler((value) => {
                this.close(value)
            })
        }

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
        container.appendChild(this.modal)

        if (options.onOpen) options.onOpen() // @ts-ignore
        this.modal.style.display = 'block'


        if (options.draggable) {
            const x = 0
            const y = 0

            // @ts-ignore
            modal.style.left = `${x}px` // @ts-ignore
            modal.style.top = `${y}px` // @ts-ignore
            modal.style.display = 'block'

            const drag = {
                dragging: false,
                x,
                y,
                startX: 0,
                startY: 0,
                start: e => {
                    drag.dragging = true
                    drag.startX = e.clientX * 2 - drag.x
                    drag.startY = e.clientY * 2 - drag.y
                },
                stop: () => {
                    drag.dragging = false
                },
                move: e => {
                    if (drag.dragging) {
                        drag.x = e.clientX * 2 - drag.startX
                        drag.y = e.clientY * 2 - drag.startY // @ts-ignore
                        modal.style.left = `${drag.x}px` // @ts-ignore
                        modal.style.top = `${drag.y}px`
                    }
                }
            }
            header.classList.add('draggable')
            header.addEventListener('mousedown', drag.start)
            header.addEventListener('mouseup', drag.stop)
            modal.addEventListener('mouseup', drag.stop)
            modal.addEventListener('mousemove', drag.move)
        }

        // Show modal
        // @ts-ignore
        modal.showModal()

        const observer = new MutationObserver(() => {
            if (!container.contains(modal)) {
                this.close('destroyed')
            }
        })
        observer.observe(container, { childList: true, subtree: true })
    }

    /** @param {string} [value] */
    close(value) {
        if (typeof value === 'undefined') value = 'closed'
        if (this.options.verify) {
            const ok = this.options.verify()
            if (!ok) return
        }
        if (this.options.onClose) this.options.onClose(value)
        this.modal.remove()
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