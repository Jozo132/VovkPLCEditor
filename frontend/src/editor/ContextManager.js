// @ts-check
"use strict"

import { getEventPath } from "../utils/tools.js"
import { PLCEditor } from "../utils/types.js"

/**
 *  @typedef {{ type: 'item', name: string, label: string, disabled?: boolean, hidden?: boolean, className?: string }} MenuItem 
 *  @typedef {{ type: 'separator', name?: undefined, label?: undefined, hidden?: boolean, className?: string }} MenuSeparator
 *  @typedef {{ type: 'submenu', name: string, label: string, items: MenuElement[], disabled?: boolean, hidden?: boolean, className?: string }} MenuSubmenu
 *  @typedef { MenuItem | MenuSeparator | MenuSubmenu } MenuElement
 *  @typedef { (event: MouseEvent, element: any) => MenuElement[] | undefined } MenuOnOpen 
 *  @typedef { (selected: string, event: MouseEvent, element: any) => void } MenuOnClose  
 *  @typedef { { target?: HTMLElement | Element, className?: string, onOpen: MenuOnOpen, onClose: MenuOnClose } } MenuListener
 */


export default class Menu {
  /** @type { MenuListener[] } */ #listeners = []
  /** @type { MenuElement[] } */ #items = []
  /** @type { string[] } */ #path = []
  /** @type { MenuOnOpen } */ #onOpen = (event) => undefined
  /** @type { (selected: string) => void } */ #onClose = (selected) => undefined
  position = { x: 0, y: 0, width: 0, height: 0 }
  open = false

  /** @type { HTMLDivElement[] } */ #submenus = []

  #editor
  /** @param { PLCEditor } editor */
  constructor(editor) {
    this.#editor = editor
    const menu = document.createElement('div')
    menu.classList.add('menu')
    document.body.appendChild(menu)
    this.menu = menu
    this.#drawList()
    this.menu.classList.add('hidden')

    this.addListener({
      target: editor.workspace,
      onOpen: () => [],
      onClose: (selected, event, element) => { },
    })
  }

  /** @type { (item: MenuElement, menu: Element) => void } */
  #addItem = (item, menu) => {
    if (item.hidden) return
    let className = item.className || item.name
    className = className ? className.split(' ').map(c => c.trim()).filter(Boolean).join(' ') : ''
    if (item.type === 'separator') {
      const hr = document.createElement('hr')
      if (className) hr.classList.add(...className.split(' '))
      menu.appendChild(hr)
    } else {
      const div = document.createElement('div')
      div.classList.add('item')
      if (className) div.classList.add(...className.split(' '))
      if (item.disabled) div.classList.add('disabled')
      div.innerText = item.label

      menu.appendChild(div)

      if (item.type === 'item') {
        div.addEventListener('click', (e) => {
          if (item.disabled) return
          this.#onClose(item.name)
          this.close()
        })
      }

      if (item.type === 'submenu') {
        div.classList.add('submenu')

        const submenu = document.createElement('div')
        submenu.classList.add('menu', 'submenu-container')
        if (className) submenu.classList.add(...className.split(' '))
        submenu.style.position = 'absolute'
        submenu.style.zIndex = '12'
        submenu.style.display = 'none'
        document.body.appendChild(submenu)
        this.#submenus.push(submenu)

        item.items.forEach(subitem => this.#addItem(subitem, submenu))

        let hideTimeout = null

        const showSubmenu = () => { // @ts-ignore
          clearTimeout(hideTimeout)
          const rect = div.getBoundingClientRect()
          const subWidth = submenu.offsetWidth
          const spaceRight = window.innerWidth - rect.right
          submenu.style.top = rect.top + 'px'
          submenu.style.left = (spaceRight > subWidth ? rect.right : rect.left - subWidth) + 'px'
          submenu.style.display = 'block'
        }

        const hideSubmenu = () => { // @ts-ignore
          hideTimeout = setTimeout(() => {
            if (!submenu.matches(':hover') && !Array.from(submenu.querySelectorAll('.submenu-container')).some(e => e.matches(':hover'))) {
              submenu.style.display = 'none'
            }
          }, 50)
        }

        div.addEventListener('mouseenter', showSubmenu)
        div.addEventListener('mouseleave', hideSubmenu)
        submenu.addEventListener('mouseenter', () => {
          clearTimeout(hideTimeout)
        })
        submenu.addEventListener('mouseleave', hideSubmenu)
      }
    }
  }

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

    const list = document.createElement('div')
    list.classList.add('menu-items')

    this.#items.forEach(item => this.#addItem(item, list))

    this.menu.appendChild(list)
  }

  #findListener = (event) => {
    let element = event.target
    let found = false
    const search = element => {
      for (let listener of this.#listeners) {
        if (listener.target === element || (listener.className && element.classList.contains(listener.className))) {
          found = true
          return listener
        }
      }
    }
    let listener = search(element)
    while (element && !listener) {
      element = element.parentElement
      listener = search(element)
    }
    return listener ? { listener, element } : null
  }

  #handle_click_event = (event) => {
    const debug = this.#editor.debug_context
    const mouseX = event.clientX
    const mouseY = event.clientY
    const lmb = event.button === 0 || event.type === 'touchstart'
    const rmb = event.button === 2 || event.type === 'contextmenu'

    if (this.open && lmb) {
      this.close()
    } else if (rmb) {
      const found = this.#findListener(event)
      if (found) {
        const { listener, element } = found
        this.#path = getEventPath(event, 'plc-workspace')
        event.preventDefault()
        event.stopPropagation()
        const items = listener.onOpen(event, element)
        this.#onClose = (item) => listener.onClose(item, event, element)
        if (items && (items.length > 0 || debug)) {
          this.#items = items
          this.#drawList()
          const menu_width = this.menu.offsetWidth
          const menu_height = this.menu.offsetHeight
          const offset = 5
          const x = (mouseX + menu_width + offset > window.innerWidth) ? (mouseX - menu_width - offset) : (mouseX + offset)
          const y = (mouseY + menu_height + offset > window.innerHeight) ? (mouseY - menu_height - offset) : (mouseY + offset)
          this.menu.style.left = x + 'px'
          this.menu.style.top = y + 'px'
          this.menu.classList.remove('hidden')
          this.position = { x, y, width: menu_width, height: menu_height }
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

  initialize() {
    this.#editor.workspace.addEventListener('contextmenu', this.#handle_click_event)
    this.#editor.workspace.addEventListener('click', this.#handle_click_event)
  }

  /** @type { (listeners: MenuListener | MenuListener[]) => void } */
  addListener(listeners) {
    if (Array.isArray(listeners)) this.#listeners.push(...listeners)
    else this.#listeners.push(listeners)
  }
  removeListener(target) { this.#listeners = this.#listeners.filter(listener => listener.target !== target) }
  removeAllListeners() { this.#listeners = [] }

  close() {
    this.menu.classList.add('hidden')
    this.#submenus.forEach(submenu => submenu.remove())
    this.#submenus = []
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