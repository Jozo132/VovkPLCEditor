// @ts-check
"use strict"

import { CSSimporter, debug_components, ElementSynthesis, ElementSynthesisMany, toCapitalCase } from "../../../../utils/tools.js"

/** 
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
 *     verify?: (data: any) => boolean,
 *     confirmClose?: boolean,
 *     confirmCloseText?: string,
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
            } // @ts-ignore
            // Enter should select the next element like TAB key
            if (e.key === 'Enter') {
                e.preventDefault()
                // const next = document.querySelector(':focus + *')
                const next = document.querySelector('.plc-popup-content :focus + *') // @ts-ignore
                if (next) next.focus()
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

        const appendContent = (element) => {
            if (Array.isArray(element)) {
                element.forEach(c => appendContent(c))
            } else if (typeof element === 'string') {
                const div = document.createElement('div')
                div.innerHTML = element
                content.appendChild(div)
            } else if (element instanceof HTMLElement || element instanceof Element) {
                content.appendChild(element)
            } else {
                throw new Error(`Invalid content type: ${typeof element}`)
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
        modal.showModal() // @ts-ignore
        modal.focus()

        const observer = new MutationObserver(() => {
            if (!container.contains(modal)) {
                this.close('destroyed')
            }
            // If the modal loses "open" attribute, reopen it
            if (!modal.hasAttribute('open')) { // @ts-ignore
                modal.showModal()
            }
        })
        observer.observe(container, { childList: true, subtree: true, attributes: true })
    }

    /** @param {string} [value] */
    async close(value) {
        if (typeof value === 'undefined') value = 'closed'
        const cancel = value === 'cancel' || value === 'closed'
        if (cancel) {
            if (this.options.confirmClose) {
                const confirmed = await Popup.confirm({
                    title: 'Confirm',
                    description: this.options.confirmCloseText || 'Are you sure you want to close this popup?',
                    confirm_text: 'Yes',
                    cancel_text: 'No',
                })
                if (!confirmed) return
            }
        }
        if (!cancel && this.options.verify) {
            const ok = this.options.verify(null)
            if (!ok) return
        }
        if (this.options.onClose) this.options.onClose(value)
        this.modal.remove()
    }


    /** @param { PopupOptions } options */
    static async promise(options) {
        options = options || {}
        const popup = new Popup(options)
        const promise = new Promise((resolve) => popup.options.onClose = (value) => resolve(value))
        return promise
    }

    /** @param {{ title: string, description: string, confirm_text: string, cancel_text: string }} options */
    static async confirm(options) { // @ts-ignore
        options = options || {}
        const title = options.title || 'Confirm'
        const description = options.description || 'Are you sure?'
        const confirm_text = options.confirm_text || 'OK'
        const cancel_text = options.cancel_text || 'Cancel'
        const buttons = [
            { text: confirm_text, value: 'confirm' },
            { text: cancel_text, value: 'cancel' },
        ]
        const selected = await Popup.promise({
            title,
            description,
            buttons,
            // backdrop: false,
            // closeButton: false,
        })
        return selected === 'confirm'
    }


    /**
     * @typedef {{ type: 'text', value?: string, placeholder?: string }} TextInput
     * @typedef {{ type: 'number', value?: number }} NumberInput
     * @typedef {{ type: 'integer', value?: number }} IntegerInput
     * @typedef { (TextInput | NumberInput | IntegerInput) & { name: string, label?: string, onChange: (data: any) => void } } InputField
     * 
     * @typedef { PopupOptions & { inputs: InputField[] }} FormOptions
     */

    /** @param { FormOptions } options */
    static async form(options) {
        options = options || { inputs: [] }
        const inputs = options.inputs || []
        const _verify = options.verify
        options.verify = () => _verify ? _verify(states) : true

        const form = document.createElement('form') // Will be passed to the popup as content
        form.classList.add('plc-popup-form')
        const formContent = document.createElement('div')
        formContent.classList.add('plc-popup-form-content')
        form.appendChild(formContent)
        const formLabels = document.createElement('div')
        formLabels.classList.add('plc-popup-form-labels')
        formContent.appendChild(formLabels)
        const formInputs = document.createElement('div')
        formInputs.classList.add('plc-popup-form-inputs')
        formContent.appendChild(formInputs)
        options.content = form

        form.addEventListener('submit', (e) => {
            e.preventDefault()
        })

        const states = {}

        inputs.forEach(input => {
            const { type, label, name, value, onChange } = input
            if (!['text', 'number', 'integer'].includes(type)) throw new Error(`Invalid input type: ${type}`)
            if (!input.name) throw new Error(`Input name is required`)
            if (input.value && typeof input.value !== 'string' && type === 'text') throw new Error(`Invalid input value: ${input.value}`)
            if (input.value && typeof input.value !== 'number' && (type === 'number' || type === 'integer')) throw new Error(`Invalid input value: ${input.value}`)
            const placeholder = type === 'text' ? input.placeholder || '' : ''

            let typeName = type
            if (type === 'integer') typeName = 'number'

            const [label_element, input_element] = ElementSynthesisMany(/*HTML*/`
                <label for="${name}">${label || toCapitalCase(name)}</label>
                <input type="${typeName}" name="${name}" value="${value || ''}" placeholder="${placeholder}">
            `)
            states[name] = new Proxy({
                value: input.value || '',
                setError: () => input_element.classList.add('error'),
                clearError: () => input_element.classList.remove('error'),
            }, {
                set: (target, prop, value) => {
                    if (prop === 'value_in') {
                        target.value = value
                    }
                    if (prop === 'value') {
                        target.value = value // @ts-ignore
                        input_element.value = value
                    }
                    return true
                }
            })
            const onInput = e => {
                const value = e.target.value
                // Use proxy value "value_in" to set the value in the state without triggering element value change
                if (type === 'number') {
                    states[name].value_in = parseFloat(value)
                } else if (type === 'integer') {
                    states[name].value_in = parseInt(value, 10)
                } else {
                    states[name].value_in = value
                }
                if (onChange) onChange(states)
            }
            input_element.addEventListener('input', onInput)
            input_element.addEventListener('change', onInput)
            formLabels.appendChild(label_element)
            formInputs.appendChild(input_element)
        })

        const selected = await Popup.promise(options)
        if (selected === 'closed') return null
        if (selected === 'destroyed') return null
        if (selected === 'cancel') return null
        const output = {}
        Object.keys(states).forEach(key => {
            const state = states[key]
            output[key] = state.value
        })
        return output
    }

}



if (debug_components) {
    Object.assign(window, { Popup })
}