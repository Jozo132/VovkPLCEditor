// @ts-check
"use strict"

import { PLCEditor } from "../utils/types.js"


/**
 *  @typedef {{ type: 'item', name: string, label: string, disabled?: boolean, hidden?: boolean }} MenuItem 
 *  @typedef {{ type: 'separator', name?: undefined, label?: undefined, hidden?: boolean }} MenuSeparator
 *  @typedef { MenuItem | MenuSeparator } MenuElement
 *  @typedef { (event: MouseEvent) => MenuElement[] | undefined } MenuOnOpen 
 *  @typedef { (selected: string) => void } MenuOnClose  
 *  @typedef { { target: HTMLElement | Element, onOpen: MenuOnOpen, onClose: MenuOnClose } } MenuListener  
*/

export default class Menu {
  /** @type { MenuListener[] } */ #listeners = []
  /** @type { MenuElement[] } */ #items = [{ type: 'item', name: 'test', label: '' }]
  /** @type { MenuOnOpen } */ #onOpen = (event) => undefined
  /** @type { MenuOnClose } */ #onClose = (selected) => undefined
  position = { x: 0, y: 0, width: 0, height: 0 }
  open = false

  #drawList() {
    this.menu.innerHTML = ''
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
        if (!item.disabled) div.addEventListener('click', () => {
          this.#onClose(item.name)
          this.menu.classList.add('hidden')
        })
        this.menu.appendChild(div)
      }
    })
  }

  #findListener = (event) => {
    let target = event.target
    let found = false
    let listener = this.#listeners.find(listener => listener.target === target)
    found = !!listener

    while (target && !found) {
      target = target.parentElement
      listener = this.#listeners.find(listener => listener.target === target)
      found = !!listener
    }
    return found ? listener : null
  }

  #handle_click_event = (event) => {
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
      const listener = this.#findListener(event)
      if (listener) {
        // console.log(`Listeners:`, this.#listeners)
        // console.log(`Found listener for target:`, listener)
        const items = listener.onOpen(event)
        this.#onClose = listener.onClose
        if (items) {
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

    window.addEventListener(`contextmenu`, this.#handle_click_event)
    window.addEventListener('click', this.#handle_click_event)
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
    window.removeEventListener('contextmenu', this.#handle_click_event)
    window.removeEventListener('click', this.#handle_click_event)
    this.menu.remove()
    this.#listeners = []
    this.#items = []
    this.#onOpen = () => undefined
    this.#onClose = () => undefined
  }
}
