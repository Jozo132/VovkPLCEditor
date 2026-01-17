import {CSSimporter, debug_components, ElementSynthesis, ElementSynthesisMany, toCapitalCase} from '../../../../utils/tools.js'

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
 *     titleClass?: string,
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

const popup_template = /*HTML*/ `
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

    closed = false

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

        modal.addEventListener('keydown', e => {
            // @ts-ignore
            if (e.key === 'Escape') {
                e.preventDefault()
                if (options.closeOnESC) this.close()
            } // @ts-ignore
            // Enter should select the next element like TAB key inside .plc-popup-window
            if (e.key === 'Enter') {
                const focusableElements = modal.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"]), input, select, textarea, [contenteditable]')
                const index = Array.prototype.indexOf.call(focusableElements, e.target)
                const element = focusableElements[index]
                const next = focusableElements[index + 1] || focusableElements[0]
                const is_plc_popup_confirm_button = element && element.classList.contains('plc-popup-confirm-button')
                if (next && !is_plc_popup_confirm_button) {
                    e.preventDefault() // @ts-ignore
                    next.focus()
                }
            }
        })

        const header = (this.header = querySelect(modal, '.plc-popup-header'))
        const footer = (this.footer = querySelect(modal, '.plc-popup-footer'))

        const title = querySelect(modal, '.plc-popup-title')
        const description = querySelect(modal, '.plc-popup-description')
        const content = querySelect(modal, '.plc-popup-content')
        const closeButton = querySelect(modal, '.plc-popup-close')
        if (!options.closeButton) closeButton.remove()
        if (options.title) {
            title.innerHTML = options.title
            if (options.titleClass) {
                const titleClasses = options.titleClass
                    .split(' ')
                    .map(c => c.trim())
                    .filter(Boolean)
                title.classList.add(...titleClasses)
            }
        } else title.remove()
        if (options.description) description.innerHTML = options.description.replaceAll('\n', '<br>')
        else description.remove()
        const popup_styles = []
        if (options.width) popup_styles.push(`width: ${options.width};`)
        if (options.height) popup_styles.push(`height: ${options.height};`)
        if (popup_styles.length > 0) modal.setAttribute('style', popup_styles.join(' '))

        if (options.backdrop) {
            let backdropClick = false
            modal.addEventListener('mousedown', e => (backdropClick = e.target === modal))
            modal.addEventListener('mouseup', e => {
                if (backdropClick && e.target === modal) {
                    // Confirmed backdrop click
                    this.close()
                }
                backdropClick = false
            })
        }
        closeButton.addEventListener('click', () => {
            this.close()
        })

        // Allow the popup to be closed with code after it has been opened
        if (options.closeHandler) {
            options.closeHandler(value => {
                this.close(value)
            })
        }

        const appendContent = element => {
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
                btn.classList.add('plc-popup-confirm-button')
                btn.innerHTML = button.text || 'Button'
                if (button.color) btn.style.color = button.color
                if (button.background) btn.style.backgroundColor = button.background
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
                },
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
            if (!modal.hasAttribute('open')) {
                // @ts-ignore
                modal.showModal()
            }
        })
        observer.observe(container, {childList: true, subtree: true, attributes: true})
    }

    /** @param {string} [value] */
    async close(value) {
        if (this.closed) return
        if (typeof value === 'undefined') value = 'closed'
        if (value === 'destroyed') throw new Error('Popup destroyed')
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
            const ok = await this.options.verify(null)
            if (!ok) return
        }
        this.closed = true
        if (this.options.onClose) this.options.onClose(value)
        this.modal.remove()
    }

    /** @param { PopupOptions } options */
    static async promise(options) {
        options = options || {}
        const popup = new Popup(options)
        const promise = new Promise(resolve => (popup.options.onClose = value => resolve(value)))
        return promise
    }

    /**
     * @param {{
     *  title: string
     *  titleClass?: string
     *  description: string
     *  confirm_text: string
     *  confirm_text_color?: string
     *  confirm_button_color?: string
     *  cancel_text: string
     *  cancel_text_color?: string
     *  cancel_button_color?: string
     * }} options
     **/
    static async confirm(options) {
        // @ts-ignore
        options = options || {}
        const titleClass = options.titleClass || ''
        const title = options.title || 'Confirm'
        const description = options.description || 'Are you sure?'
        const confirm_text = options.confirm_text || 'OK'
        const confirm_text_color = options.confirm_text_color || 'black'
        const confirm_button_color = options.confirm_button_color || 'none'
        const cancel_text = options.cancel_text || 'Cancel'
        const cancel_text_color = options.cancel_text_color || 'black'
        const cancel_button_color = options.cancel_button_color || 'none'
        /** @type { PopupEndorseButton[] } */
        const buttons = [
            {text: confirm_text, value: 'confirm', background: confirm_button_color, color: confirm_text_color},
            {text: cancel_text, value: 'cancel', background: cancel_button_color, color: cancel_text_color},
        ]
        const selected = await Popup.promise({
            title,
            titleClass,
            description,
            buttons,
            // backdrop: false,
            // closeButton: false,
        })
        return selected === 'confirm'
    }

    /**
     * @typedef {{ name: string, label?: string, readonly?: boolean, margin?: string, onChange?: (data: any) => void }} InputCommon
     * @typedef {InputCommon & { type: 'text', value?: string, placeholder?: string }} TextInput
     * @typedef {InputCommon & { type: 'number', value?: number }} NumberInput
     * @typedef {InputCommon & { type: 'integer', value?: number }} IntegerInput
     * @typedef { TextInput | NumberInput | IntegerInput  } InputField
     *
     * @typedef { PopupOptions & { inputs: InputField[] }} FormOptions
     */

    /** @param { FormOptions } options */
    static async form(options) {
        options = options || {inputs: []}
        const inputs = options.inputs || []
        const _verify = options.verify
        options.verify = () => (_verify ? _verify(states) : true)

        const form = document.createElement('form') // Will be passed to the popup as content
        form.classList.add('plc-popup-form')
        options.content = form

        form.addEventListener('submit', e => {
            e.preventDefault()
        })

        const states = {}

        inputs.forEach(input => {
            const {type, label, name, value, margin, readonly, onChange} = input
            if (!['text', 'number', 'integer'].includes(type)) throw new Error(`Invalid input type: ${type}`)
            if (!input.name) throw new Error(`Input name is required`)
            if (input.value && typeof input.value !== 'string' && type === 'text') throw new Error(`Invalid input value: ${input.value}`)
            if (input.value && typeof input.value !== 'number' && (type === 'number' || type === 'integer')) throw new Error(`Invalid input value: ${input.value}`)
            const placeholder = type === 'text' ? input.placeholder || '' : ''

            let typeName = type
            if (type === 'integer') typeName = 'number'

            const label_element = readonly ? ElementSynthesis(/*HTML*/ `<div></div>`) : ElementSynthesis(/*HTML*/ `<label for="${name}">${typeof label !== 'undefined' ? label : label || toCapitalCase(name)}</label>`)
            const input_element = readonly ? ElementSynthesis(/*HTML*/ `<div class="readonly" id="${name}" name="${name}" readonly style="background: none;" tabindex="-1" disabled></div>`) : ElementSynthesis(/*HTML*/ `<input type="${typeName}" id="${name}" name="${name}" value="${value || ''}" placeholder="${placeholder}" autocomplete="off">`)
            if (typeof margin !== 'undefined') {
                // @ts-ignore
                input_element.style.margin = margin
            }
            if (readonly) {
                // @ts-ignore
                input_element.innerHTML = value || ''
            }
            states[name] = new Proxy(
                {
                    value: input.value || '',
                    setError: () => {
                        input_element.classList.add('error')
                        return false
                    },
                    clearError: () => {
                        input_element.classList.remove('error')
                        return false
                    },
                },
                {
                    set: (target, prop, value) => {
                        if (prop === 'value_in') {
                            target.value = value
                        }
                        if (prop === 'value') {
                            target.value = value // @ts-ignore
                            if (readonly) input_element.innerText = value
                            else {
                                // @ts-ignore
                                input_element.value = value
                            }
                        }
                        return true
                    },
                }
            )
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
            if (!readonly) {
                input_element.addEventListener('input', onInput)
                input_element.addEventListener('change', onInput)
                input_element.addEventListener('keydown', e => {
                    // @ts-ignore
                    if (e.key === 'Enter') {
                        e.preventDefault()
                        if (onChange) onChange(states)
                    }
                })
            }
            if (label_element) form.appendChild(label_element)
            form.appendChild(input_element)
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

    /** @type { (type: string, directory: string, verify?: (path: string) => boolean) => Promise<string | null> } */
    static createItem = async (type, directory, verify) => {
        const Type = toCapitalCase(type)
        const default_name = `New ${Type}`
        const res = await Popup.form({
            title: `Create ${Type}`,
            description: `Enter new ${Type} name`,
            //draggable: false,
            backdrop: false,
            //closeHandler: close => c = close,
            //closeButton: false,
            //closeOnESC: false,
            //confirmClose: true,
            confirmCloseText: 'Are you sure?',
            inputs: [
                {type: 'text', name: 'preview', label: '', value: `${directory}/${default_name}`, readonly: true},
                {
                    type: 'text',
                    name: 'name',
                    value: default_name,
                    onChange: data => {
                        data.name.value = data.name.value.replaceAll('  ', ' ')
                        data.name.value = data.name.value.replaceAll(/[^a-zA-Z0-9-_ ]/g, '')
                        while (data.name.value.startsWith(' ')) {
                            data.name.value = data.name.value.substring(1)
                        }
                        data.preview.value = `${directory}/${data.name.value.trim()}`
                    },
                },
            ],
            verify: values => {
                const name = values.name
                const preview = values.preview
                if (!name.value.trim()) return name.setError('Name is empty')
                if (verify) {
                    const valid = verify(preview.value)
                    if (!valid) return name.setError(`Name already exists`)
                }
                return true
            },
            buttons: [
                {text: 'Create', value: 'confirm'},
                {text: 'Cancel', value: 'cancel'},
            ],
        })

        if (!res) return null
        return res.preview
    }

    /** @type { (type: string, path: string, verify?: (path: string) => boolean) => Promise<string | null> } */
    static renameItem = async (type, path, verify) => {
        const Type = toCapitalCase(type)
        const segments = path.split('/')
        const default_name = segments.pop()
        const res = await Popup.form({
            title: `Rename ${Type}`,
            description: `Enter new ${Type} name`,
            //draggable: false,
            backdrop: false,
            //closeHandler: close => c = close,
            //closeButton: false,
            //closeOnESC: false,
            //confirmClose: true,
            confirmCloseText: 'Are you sure?',
            inputs: [
                {type: 'text', name: 'preview', label: '', value: `${path}`, readonly: true},
                {
                    type: 'text',
                    name: 'name',
                    value: default_name,
                    onChange: data => {
                        data.name.value = data.name.value.replaceAll('  ', ' ')
                        data.name.value = data.name.value.replaceAll(/[^a-zA-Z0-9-_ ]/g, '')
                        while (data.name.value.startsWith(' ')) {
                            data.name.value = data.name.value.substring(1)
                        }
                        data.preview.value = `${path.split('/').slice(0, -1).join('/')}/${data.name.value.trim()}`
                    },
                },
            ],
            verify: values => {
                const name = values.name
                const preview = values.preview
                if (!name.value.trim()) return name.setError('Name is empty')
                if (verify) {
                    const valid = verify(preview.value)
                    if (!valid) return name.setError(`Name already exists`)
                }
                return true
            },
            buttons: [
                {text: 'Rename', value: 'confirm'},
                {text: 'Cancel', value: 'cancel'},
            ],
        })

        if (!res) return null
        return res.preview
    }
}

if (debug_components) {
    Object.assign(window, {Popup})
}
