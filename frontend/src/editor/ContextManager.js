// @ts-check
"use strict"

import { getEventPath } from "../utils/tools.js"
import { PLCEditor } from "../utils/types.js"


/**
 *  @typedef {{ type: 'item', name: string, label: string, disabled?: boolean, hidden?: boolean }} MenuItem 
 *  @typedef {{ type: 'separator', name?: undefined, label?: undefined, hidden?: boolean }} MenuSeparator
 *  @typedef { MenuItem | MenuSeparator } MenuElement
 *  @typedef { (event: MouseEvent, element: any) => MenuElement[] | undefined } MenuOnOpen 
 *  @typedef { (selected: string, event: MouseEvent, element: any) => void } MenuOnClose  
 *  @typedef { { target?: HTMLElement | Element, className?: string, onOpen: MenuOnOpen, onClose: MenuOnClose } } MenuListener
*/


export default class Menu {
  /** @type { MenuListener[] } */ #listeners = []
  /** @type { MenuElement[] } */ #items = [{ type: 'item', name: 'test', label: '' }]
  /** @type { string[] } */ #path = []
  /** @type { MenuOnOpen } */ #onOpen = (event) => undefined
  /** @type { (selected: string) => void } */ #onClose = (selected) => undefined
  position = { x: 0, y: 0, width: 0, height: 0 }
  open = false

  #drawList() {
    this.menu.innerHTML = ''
    const debug = this.#editor.debug_context
    if (debug) {
      const path = [...this.#path]
      while (path.length > 3) path.shift()
      const path_string = path.join(' > ')
      const path_div = document.createElement('div')
      path_div.classList.add('path')
      path_div.innerText = path_string
      this.menu.appendChild(path_div)
    }
    let was_separator = false
    this.#items.forEach(item => {
      if (item.hidden) return
      if (item.type === 'separator' && !was_separator) {
        const hr = document.createElement('hr')
        this.menu.appendChild(hr)
        was_separator = true
      }
      if (item.type === 'item') {
        was_separator = false
        const div = document.createElement('div')
        div.classList.add('item')
        if (item.disabled) div.classList.add('disabled')
        div.innerText = item.label
        div.addEventListener('click', (e) => {
          if (item.disabled) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          this.#onClose(item.name)
          this.menu.classList.add('hidden')
        })
        this.menu.appendChild(div)
      }
    })
  }

  #findListener = (event) => {
    let element = event.target
    let found = false
    const search = element => {
      for (let i = 0; i < this.#listeners.length; i++) {
        const listener = this.#listeners[i]
        if (listener.target && listener.target === element) {
          found = true
          return listener
        }
        if (listener.className && element.classList.contains(listener.className)) {
          found = true
          return listener
        }
      }
    }
    let listener = search(element)
    found = !!listener

    while (element && !found) {
      element = element.parentElement
      listener = search(element)
      found = !!listener
    }
    return found && listener ? { listener, element } : null
  }

  #handle_click_event = (event) => {
    const debug = this.#editor.debug_context
    // Get mouse X and Y from the event
    const mouseX = event.clientX
    const mouseY = event.clientY
    const lmb = event.button === 0 || event.type === 'touchstart'
    const rmb = event.button === 2 || event.type === 'contextmenu'
    // console.log(`Mouse event:`, { mouseX, mouseY, lmb, rmb })
    if (this.open && lmb) {
      this.close()
    } else if (rmb) {
      // Check if the click was on one of the targets
      const found = this.#findListener(event)
      if (found) {
        const { listener, element } = found
        this.#path = getEventPath(event, 'plc-workspace')
        // console.log(`Listeners:`, this.#listeners)
        // console.log(`Found listener for target:`, listener)
        event.preventDefault()
        event.stopPropagation()
        const items = listener.onOpen(event, element)
        this.#onClose = (item) => listener.onClose(item, event, element)
        if (items && (items.length > 0 || debug)) {
          this.#items = items
          this.#drawList()
          const menu_width = this.menu.clientWidth
          const menu_height = this.menu.clientHeight
          const window_width = window.innerWidth
          const window_height = window.innerHeight
          const offset = 5
          const x = (mouseX + menu_width + offset > window_width) ? (mouseX - menu_width - offset) : (mouseX + offset)
          const y = (mouseY + menu_height + offset > window_height) ? (mouseY - menu_height - offset) : (mouseY + offset)
          this.menu.style.left = x + 'px'
          this.menu.style.top = y + 'px'
          this.menu.classList.remove('hidden')
          this.position = { x, y, width: menu_width, height: menu_height }
          event.preventDefault()
          this.open = true
          return false
        } else if (this.open) {
          this.menu.classList.add('hidden')
          this.open = false
          this.#path = []
          this.#items = []
        }
      } else {
        console.log(`No listener found for target:`, event.target)
        this.close()
      }
    }
  }

  #editor
  /** @param {PLCEditor} editor */
  constructor(editor) {
    this.#editor = editor
    const menu = document.createElement('div')
    menu.classList.add('menu')
    menu.classList.add('items-with-context-menu')
    document.body.appendChild(menu)
    this.menu = menu
    this.#drawList()
    this.menu.classList.add('hidden')


    this.addListener({
      target: editor.workspace,
      onOpen: () => [
        // { type: 'item', name: 'edit', label: 'Edit' },
        // { type: 'item', name: 'delete', label: 'Delete' },
        // { type: 'separator' },
        // { type: 'item', name: 'copy', label: 'Copy' },
        // { type: 'item', name: 'paste', label: 'Paste' },
      ],
      onClose: (selected, event, element) => {
        // console.log(`Workspace selected: ${selected}`)
      },
    })
  }

  initialize() {
    this.#editor.workspace.addEventListener(`contextmenu`, this.#handle_click_event)
    this.#editor.workspace.addEventListener('click', this.#handle_click_event)
  }

  /** @type { (listeners: MenuListener | MenuListener[]) => void } */
  addListener(listeners) {
    if (Array.isArray(listeners)) this.#listeners.push(...listeners)
    else this.#listeners.push(listeners)
  }
  /** @type { (target: HTMLElement | Element) => void } */
  removeListener(target) { this.#listeners = this.#listeners.filter(listener => listener.target !== target) }
  removeAllListeners() { this.#listeners = [] }

  close() {
    this.menu.classList.add('hidden')
    this.open = false
  }

  destroy() {
    this.#editor.workspace.removeEventListener('contextmenu', this.#handle_click_event)
    this.#editor.workspace.removeEventListener('click', this.#handle_click_event)
    this.menu.remove()
    this.#listeners = []
    this.#items = []
    this.#onOpen = () => undefined
    this.#onClose = () => undefined
  }
}
