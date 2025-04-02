// @ts-check
"use strict"

import { MenuElement, PLC_Program, PLC_ProjectItem, PLCEditor } from "../../../utils/types.js"
import { ElementSynthesis } from "../../../utils/tools.js"
import { folder_icon, program_icon } from "./components/icons.js"

const minimized = false

const folder_item_html = /*HTML*/`
    <div class="plc-navigation-item ${minimized ? 'minimized' : ''}">
        <div class="plc-navigation-folder">
            <div class="minimize">${minimized ? '+' : '-'}</div>
            <div class="plc-icon">${folder_icon}</div>
            <div class="plc-title">empty</div>
        </div>
        <div class="plc-navigation-children">
            <!-- Children will be added here dynamically -->
        </div>
    </div>
`

const program_item_html = /*HTML*/`
    <div class="plc-navigation-item">
        <div class="plc-navigation-program">
            <div class="plc-void"></div>
            <div class="plc-icon">${program_icon}</div>
            <div class="plc-title">empty</div>
        </div>
    </div>
`


const sanitizePath = path => '/' + (path.replace(/\/+/g, '/').split('/').map(p => p.trim()).filter(Boolean).join('/') || '')
const sortTree = (a, b) => {
    if (b.type === 'item' && b.item.name === 'main') return 1
    if (a.type === 'item' && a.item.name === 'main') return -1
    if (a.type === 'folder' && b.type !== 'folder') return -1
    if (a.type !== 'folder' && b.type === 'folder') return 1
    const a_name = a.path.split('/').pop() || ''
    const b_name = b.path.split('/').pop() || ''
    return a_name.localeCompare(b_name)
}

/**
 * @typedef { { path: string, div: Element } } PLC_FolderChild_Base
 * @typedef { PLC_FolderChild_Base & { type: 'folder' } } PLC_FolderChild_Folder
 * @typedef { PLC_FolderChild_Base & { type: 'item', item: PLC_ProjectItem } } PLC_FolderChild_Program
 * @typedef { PLC_FolderChild_Folder | PLC_FolderChild_Program } PLC_FolderChild
 */
class PLC_Folder {
    type = 'folder'
    path = ''
    div
    name
    /** @type { PLC_FolderChild[] } */
    children = []

    /** @param { string } path */
    constructor(path) {
        path = sanitizePath(path)
        if (!path) throw new Error('Path is empty')
        this.path = path
        this.name = path.split('/').pop() || ''
        if (!this.name) throw new Error('Folder name not found')
        this.div = ElementSynthesis(folder_item_html)
        const minimize = this.div.querySelector('.minimize'); if (!minimize) throw new Error('Minimize button not found')
        const header = this.div.querySelector('.plc-navigation-folder'); if (!header) throw new Error('Navigation folder not found')
        const title = this.div.querySelector('.plc-title'); if (!title) throw new Error('Title not found')
        const list = this.div.querySelector('.plc-navigation-children'); if (!list) throw new Error('Children not found')
        this.minimize = minimize
        this.header = header
        this.title = title
        this.list = list

        this.header.addEventListener('click', this.onClick)

        // Use proxy to update the folder name change dynamically
        const proxy = new Proxy(this, {
            set(target, prop, value) {
                if (prop === 'name') { // @ts-ignore
                    target.title.innerText = value
                    return true
                }
                return Reflect.set(target, prop, value)
            }
        })

        proxy.name = this.name // Update the name property to trigger the setter
        return proxy
    }

    onClick = () => {
        this.div.classList.toggle('minimized') // @ts-ignore
        this.minimize.innerText = this.div.classList.contains('minimized') ? '+' : '-'
    }

    sortChildren = () => {
        this.children.sort(sortTree)
        this.list.innerHTML = ''
        this.children.forEach(child => this.list.appendChild(child.div))
    }

    /** @param { PLC_FolderChild } child */
    addChild = (child) => {
        if (!child) throw new Error('Child not found')
        if (this.children.some(c => c.path === child.path)) return
        this.children.push(child)
        this.list.appendChild(child.div)
    }

    /** @param { PLC_FolderChild } child */
    removeChild = (child) => {
        if (!child) throw new Error('Child not found')
        const index = this.children.findIndex(c => c.path === child.path)
        if (index === -1) return
        this.children.splice(index, 1)
        child.div.remove()
    }

    destroy() {
        this.children.forEach(child => child.div.remove())
        this.children = []
        this.div.remove()
    }
}


export default class NavigationTreeManager {

    /** @type { PLC_FolderChild[] } */
    #root = []

    /** @type { PLC_Folder[] } */
    #folders = []

    #container
    #editor
    /** @param { PLCEditor } editor */
    constructor(editor) {
        this.#editor = editor
        const workspace = editor.workspace
        this.workspace = workspace

        const container = workspace.querySelector('.plc-navigation-tree')
        if (!container) throw new Error('Navigation tree container not found')
        container.innerHTML = ''
        this.#container = container
    }


    initialize() {
        const editor = this.#editor

        /** @type { MenuElement[] } */
        const ctx_edit_folder = [
            {
                type: 'submenu', name: 'add', label: 'Add item', items: [
                    { type: 'item', name: 'add_program', label: 'Program' },
                    { type: 'item', name: 'add_folder', label: 'Folder' },
                ]
            },
            { type: 'separator' },
            { type: 'item', name: 'delete', label: 'Delete' },
            { type: 'item', name: 'rename', label: 'Rename' },
        ]
        /** @type { MenuElement[] } */
        const ctx_edit_program = [
            { type: 'item', name: 'cut', label: 'Cut' },
            { type: 'item', name: 'copy', label: 'Copy' },
            { type: 'item', name: 'paste', label: 'Paste' },
            { type: 'separator' },
            { type: 'item', name: 'delete', label: 'Delete' },
            { type: 'item', name: 'rename', label: 'Rename' },
        ]

        /** @type { MenuElement[] } */
        const ctx_online_folder = [
            { type: 'item', name: 'add', label: 'Add item', disabled: true },
            { type: 'separator' },
            { type: 'item', name: 'delete', label: 'Delete', disabled: true },
            { type: 'item', name: 'rename', label: 'Rename', disabled: true },
        ]
        /** @type { MenuElement[] } */
        const ctx_online_program = [
            { type: 'item', name: 'cut', label: 'Cut', disabled: true },
            { type: 'item', name: 'copy', label: 'Copy' },
            { type: 'item', name: 'paste', label: 'Paste', disabled: true },
            { type: 'separator' },
            { type: 'item', name: 'delete', label: 'Delete', disabled: true },
            { type: 'item', name: 'rename', label: 'Rename', disabled: true },
        ]

        /** @type { (event: any, element: any) => MenuElement[] } */
        const on_context_open_navigation_tree = (event, element) => {
            const connected = editor.device_manager.connected
            const classes = element.classList
            const className = classes[0] // Get the first class name
            if (className === 'plc-navigation-folder') {
                return connected ? ctx_online_folder : ctx_edit_folder
            }
            if (className === 'plc-navigation-program') {
                return connected ? ctx_online_program : ctx_edit_program
            }
            throw new Error(`Invalid class name: ${className}`)
        }

        const on_context_close_navigation_tree = (action, event, element) => {
            editor.window_manager.tree_manager.#onContextMenu(action, event, element)
        }

        editor.context_manager.addListener({
            className: 'plc-navigation-folder',
            onOpen: on_context_open_navigation_tree,
            onClose: on_context_close_navigation_tree,
        })
        editor.context_manager.addListener({
            className: 'plc-navigation-program',
            onOpen: on_context_open_navigation_tree,
            onClose: on_context_close_navigation_tree,
        })



        /** @type { MenuElement[] } */
        const ctx_edit_empty = [
            { type: 'item', name: 'add_folder', label: 'Add Folder' },
        ]

        const on_context_open_empty = (event, element) => {
            const connected = editor.device_manager.connected
            return connected ? [] : ctx_edit_empty
        }
        const on_context_close_empty = (action, event, element) => {
            editor.window_manager.tree_manager.#onContextMenu(action, event, element)
        }
        editor.context_manager.addListener({
            target: this.#container,
            className: 'plc-navigation-tree',
            onOpen: on_context_open_empty,
            onClose: on_context_close_empty,
        })

    }

    /** @param { PLC_ProjectItem } item */
    #draw_structure = (item) => {
        if (item.type === 'program') return this.#draw_item(item)
        if (item.type === 'item') return this.#draw_item(item)
    }



    /** @param { string } path */
    #recursivelyCreateFolder = (path) => {
        path = sanitizePath(path)
        // Recurively add folder structures to the tree
        // Example:
        // "/folder1/folder2/folder3" -> ["/folder1", "/folder1/folder2", "/folder1/folder2/folder3"]
        const tree = path.split('/').filter(Boolean)
        let folder = this.#folders.find(f => f.path === path)
        if (folder) return
        let walker = ''
        while (tree.length) {
            const name = tree.shift() || ''
            walker += '/' + name
            const parent = folder
            folder = this.#folders.find(f => f.path === walker)
            if (!folder) {
                this.#editor.project.folders = this.#editor.project.folders || []
                if (!this.#editor.project.folders.includes(walker)) {
                    this.#editor.project.folders.push(walker)
                }
                folder = new PLC_Folder(walker)
                this.#folders.push(folder)
                /** @type { PLC_FolderChild } */
                const child = { type: 'folder', path: walker, div: folder.div }
                if (parent) parent.addChild(child)
                else this.#root.push(child)
            }
        }
    }

    /** @param { PLC_Program } program */
    #draw_item = (program) => {
        const div = ElementSynthesis(program_item_html)
        const title = div.querySelector('.plc-title'); if (!title) throw new Error('Title not found') // @ts-ignore
        title.innerText = program.name
        div.addEventListener('click', () => {
            if (!program.id) throw new Error('Program ID not found')
            this.#editor.window_manager.openProgram(program.id)
        })
        if (this.#editor.initial_program && program.name === this.#editor.initial_program) {
            this.#editor.initial_program = null
            setTimeout(() => this.#editor.window_manager.openProgram(program.id), 50)
        }
        return div
    }

    #onContextMenu = (action, event, element) => {
        const classes = element.classList
        const className = classes[0] // Get the first class name
        // console.log(`Navigation tree selected [${className}]: ${selected}, element:`, element, `event:`, event)
        const matches = [
            'plc-navigation-folder',
            'plc-navigation-program',
            'plc-navigation-tree',
        ]
        const isMatch = matches.some(match => className === match)
        if (!isMatch) return console.error('Element does not match any of the expected classes', classes, matches, element)
        const is_navigation = className === 'plc-navigation-tree'
        if (is_navigation) {
            console.log('Empty navigation tree clicked')
            console.log(`Action ${action} on empty navigation tree`)
            return
        }
        const container = element.parentElement
        let found = false
        let item = null
        // console.log('Folders', this.#folders)
        for (const folder of this.#folders) {
            // selected -> 'delete' | 'rename' | 'add_program' | 'add_folder' | ...
            if (folder.div === container) {
                found = true
                item = folder
                break
            }
            folder.children.forEach(child => {
                if (child.div === container) {
                    found = true
                    item = child
                }
            })
        }
        if (!found) {
            for (const item of this.#root) {
                if (item.div === container) {
                    found = true
                    break
                }
            }
        }
        if (!found) return console.error('Item not found in folders or root')
        if (!item) throw new Error('Item not found')
        const type = item.type
        console.log(`Action ${action} on ${type}`, item)
        if (action === 'delete') {
            if (type === 'item') this.deleteFile(item.path)
            if (type === 'folder') this.deleteFolder(item.path)
        }
    }

    draw_navigation_tree = () => {
        const editor = this.#editor
        // [ + ] [icon] [title]   < ------ folder
        //       [icon] [title]   < ------ item
        const files = editor.project.files
        const empty_folders = editor.project.folders
        const container = this.#container
        // Reset folder list
        this.#folders.forEach(f => f.destroy())
        this.#folders = []
        container.innerHTML = ''

        this.#root = []
        const root = this.#root

        if (empty_folders && empty_folders.length)
            empty_folders.forEach(path => {
                path = sanitizePath(path)
                this.#recursivelyCreateFolder(path)
            })
        files.forEach(file => {
            file.path = sanitizePath(file.path)
            this.#recursivelyCreateFolder(file.path)
        })


        files.forEach(file => {
            const div = this.#draw_structure(file)
            if (!div) throw new Error('Div not found')
            const folder = this.#folders.find(f => f.path === file.path)
            if (folder) {
                const full_path = folder.path + '/' + file.name
                folder.addChild({ type: 'item', path: full_path, div, item: file })
            } else {
                root.push({ type: 'item', path: file.path, div, item: file })
            }
        })

        root.sort(sortTree)
        root.forEach(item => container.appendChild(item.div))

        this.#folders.forEach(folder => folder.sortChildren())

        console.log(root)
        editor.initial_program = null // Prevent opening the initial program again on redraw
    }



    /** @param { string } path */
    deleteFile = (path, was_recursive = false) => {
        path = sanitizePath(path)
        console.log('Deleting file', path)
        const segments = path.split('/')
        const name = segments.pop()
        const folder_path = segments.join('/')
        this.#recursivelyCreateFolder(folder_path)
        this.#editor.project.files = this.#editor.project.files.filter(f => !(sanitizePath(f.path) === folder_path && f.name === name))
        if (!was_recursive) this.draw_navigation_tree()
    }

    /** @param { string } path */
    deleteFolder = (path, was_recursive = false) => {
        path = sanitizePath(path)
        console.log('Deleting folder', path)
        const files = this.#editor.project.files.filter(f => sanitizePath(f.path).startsWith(path))
        if (files.length) files.forEach(file => this.deleteFile(file.path + '/' + file.name, true))
        const subfolders = this.#folders.filter(f => f.path.startsWith(path) && f.path !== path)
        subfolders.forEach(folder => this.deleteFolder(folder.path, true))
        this.#folders = this.#folders.filter(f => f.path !== path)
        this.#editor.project.folders = (this.#editor.project.folders || []).filter(f => f !== path)
        if (!was_recursive) this.draw_navigation_tree()
    }
}