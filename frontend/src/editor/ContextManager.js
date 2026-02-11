import { getEventPath } from "../utils/tools.js"
import { PLCEditor } from "../utils/types.js"

/**
 *  @typedef {{ type: 'item', name: string, label: string, icon?: string, disabled?: boolean, hidden?: boolean, className?: string }} MenuItem 
 *  @typedef {{ type: 'separator', name?: undefined, label?: undefined, hidden?: boolean, className?: string }} MenuSeparator
 *  @typedef {{ type: 'submenu', name: string, label: string, icon?: string, items: MenuElement[], disabled?: boolean, hidden?: boolean, className?: string }} MenuSubmenu
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
      if (item.disabled) div.classList.add('disabled')
      
      // Icon area (always present for alignment)
      const iconWrap = document.createElement('span')
      iconWrap.classList.add('menu-icon')
      if (className) {
        const icon = document.createElement('span')
        icon.classList.add(...className.split(' '))
        iconWrap.appendChild(icon)
      }
      div.appendChild(iconWrap)

      // Label
      const labelSpan = document.createElement('span')
      labelSpan.classList.add('menu-label')
      labelSpan.textContent = item.label
      div.appendChild(labelSpan)

      // Shortcut hint (if provided via icon field as "shortcut:...")
      if (item.icon && item.icon.startsWith('shortcut:')) {
        const shortcutSpan = document.createElement('span')
        shortcutSpan.classList.add('menu-shortcut')
        shortcutSpan.textContent = item.icon.substring(9)
        div.appendChild(shortcutSpan)
      }

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
        
        // Add submenu arrow indicator
        const arrow = document.createElement('span')
        arrow.classList.add('menu-submenu-arrow')
        arrow.textContent = '\u25B8'
        div.appendChild(arrow)

        const submenu = document.createElement('div')
        submenu.classList.add('menu', 'submenu-container')
        submenu.style.position = 'absolute'
        submenu.style.zIndex = '12'
        submenu.style.display = 'none'
        document.body.appendChild(submenu)
        this.#submenus.push(submenu)
        
        // Track parent-child relationship for nested submenus
        // Store reference to child submenus that are opened from this submenu
        /** @type {HTMLDivElement[]} */
        const childSubmenus = []
        submenu._childSubmenus = childSubmenus
        submenu._parentSubmenu = menu.classList.contains('submenu-container') ? menu : null
        submenu._hideTimeout = null
        submenu._triggerDiv = div
        
        // Register this submenu as a child of the parent
        if (submenu._parentSubmenu && submenu._parentSubmenu._childSubmenus) {
          submenu._parentSubmenu._childSubmenus.push(submenu)
        }

        item.items.forEach(subitem => this.#addItem(subitem, submenu))
        
        // Check if any descendant submenu is being hovered
        const isAnyDescendantHovered = (sub) => {
          if (sub.matches(':hover')) return true
          const children = sub._childSubmenus || []
          return children.some(child => child.style.display !== 'none' && isAnyDescendantHovered(child))
        }
        
        // Clear hide timeouts for this submenu and all ancestors
        const clearAncestorTimeouts = (sub) => {
          if (sub._hideTimeout) {
            clearTimeout(sub._hideTimeout)
            sub._hideTimeout = null
          }
          if (sub._parentSubmenu) {
            clearAncestorTimeouts(sub._parentSubmenu)
          }
        }

        const showSubmenu = () => {
          clearAncestorTimeouts(submenu)
          
          // Immediately hide all sibling submenus (those that share the same parent)
          // Siblings are submenus with the same _parentSubmenu reference
          // For top-level submenus, _parentSubmenu is null, so they're all siblings
          this.#submenus.forEach(otherSub => {
            if (otherSub !== submenu && otherSub._parentSubmenu === submenu._parentSubmenu) {
              // Clear any pending hide timeout
              if (otherSub._hideTimeout) {
                clearTimeout(otherSub._hideTimeout)
                otherSub._hideTimeout = null
              }
              // Immediately hide this sibling and its children
              otherSub.style.display = 'none'
              const hideChildren = (sub) => {
                const children = sub._childSubmenus || []
                children.forEach(child => {
                  child.style.display = 'none'
                  hideChildren(child)
                })
              }
              hideChildren(otherSub)
            }
          })
          
          const rect = div.getBoundingClientRect()
          const subWidth = submenu.offsetWidth
          const spaceRight = window.innerWidth - rect.right
          submenu.style.top = rect.top + 'px'
          submenu.style.left = (spaceRight > subWidth ? rect.right : rect.left - subWidth) + 'px'
          submenu.style.display = 'block'
        }

        const hideSubmenu = () => {
          submenu._hideTimeout = setTimeout(() => {
            // Don't hide if this submenu or any of its descendants are hovered
            // Also don't hide if the trigger div is hovered
            if (!isAnyDescendantHovered(submenu) && !div.matches(':hover')) {
              submenu.style.display = 'none'
              // Also hide all child submenus
              const hideChildren = (sub) => {
                const children = sub._childSubmenus || []
                children.forEach(child => {
                  child.style.display = 'none'
                  hideChildren(child)
                })
              }
              hideChildren(submenu)
            }
          }, 100)
        }

        div.addEventListener('mouseenter', showSubmenu)
        div.addEventListener('mouseleave', hideSubmenu)
        submenu.addEventListener('mouseenter', () => {
          clearAncestorTimeouts(submenu)
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

  /**
   * Manually show context menu at event position
   * @param {MouseEvent} event 
   * @param {MenuElement[]} items 
   * @param {(selected: string) => void} onClose 
   */
  show(event, items, onClose) {
    if (!items || items.length === 0) return
    
    // Use the class internals
    this.#items = items
    this.#onClose = onClose || (() => {})
    this.#path = []
    
    this.#drawList()
    
    const mouseX = event.clientX
    const mouseY = event.clientY
    
    // Temporarily show to get dimensions
    this.menu.style.visibility = 'hidden' 
    this.menu.classList.remove('hidden')

    const menu_width = this.menu.offsetWidth
    const menu_height = this.menu.offsetHeight
    const offset = 5
    
    const x = (mouseX + menu_width + offset > window.innerWidth) ? (mouseX - menu_width - offset) : (mouseX + offset)
    const y = (mouseY + menu_height + offset > window.innerHeight) ? (mouseY - menu_height - offset) : (mouseY + offset)
    
    this.menu.style.left = x + 'px'
    this.menu.style.top = y + 'px'
    this.menu.style.visibility = ''
    
    this.position = { x, y, width: menu_width, height: menu_height }
    this.open = true
    
    // We need to stop propagation so the document click listener doesn't immediately close it
    // if the event bubbled there.
    event.stopPropagation()
    event.preventDefault()
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