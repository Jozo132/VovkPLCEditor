// @ts-check
"use strict"

import { MenuElement, PLC_Program, PLC_ProjectItem, PLCEditor } from "../../../utils/types.js"
import { ElementSynthesis, CSSimporter, toCapitalCase } from "../../../utils/tools.js"
import { Popup } from "./components/popup.js"

import "./components/icons.js"
import "./components/popup.js"

const initial_tree_minimized = false

const importCSS = CSSimporter(import.meta.url)

await importCSS('./NavigationTreeManager.css')

/** @type { (minimized: boolean) => string } */
const folder_item_html = minimized => /*HTML*/`
    <div class="plc-navigation-item ${minimized ? 'minimized' : ''}">
        <div class="plc-navigation-folder" tabindex="0">
            <div class="minimize">${minimized ? '+' : '-'}</div>
            <div class="plc-icon plc-icon-folder"></div>
            <div class="plc-title">empty</div>
        </div>
        <div class="plc-navigation-children">
            <!-- Children will be added here dynamically -->
        </div>
    </div>
`

const program_item_html = /*HTML*/`
    <div class="plc-navigation-item">
        <div class="plc-navigation-program" tabindex="0">
            <div class="plc-void"></div>
            <div class="plc-icon plc-icon-gears"></div>
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
 * @typedef { { path: string, full_path: string, div: Element, name: string, expand?: Function, collapse?: Function } } PLC_FolderChild_Base
 * @typedef { PLC_FolderChild_Base & { type: 'folder', item: null } } PLC_FolderChild_Folder
 * @typedef { PLC_FolderChild_Base & { type: 'item', item: PLC_ProjectItem } } PLC_FolderChild_Program
 * @typedef { PLC_FolderChild_Folder | PLC_FolderChild_Program } PLC_FolderChild
 */
class PLC_Folder {
    type = 'folder'
    path = ''
    full_path = ''
    div
    name
    /** @type { PLC_FolderChild[] } */
    children = []

    item = null

    navigation

    /** @param { NavigationTreeManager } navigation * @param { string } path */
    constructor(navigation, path) {
        this.navigation = navigation
        path = sanitizePath(path)
        if (!path) throw new Error('Path is empty')
        this.path = path
        this.full_path = path
        this.name = path.split('/').pop() || ''
        if (!this.name) throw new Error('Folder name not found')
        if (typeof this.navigation.minimized_folders[path] === 'undefined') {
            this.navigation.minimized_folders[path] = initial_tree_minimized
        }
        this.div = ElementSynthesis(folder_item_html(this.navigation.minimized_folders[path]))
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

    onClick = () => { // @ts-ignore
        this.header.focus()
        this.div.classList.toggle('minimized')
        const minimized = this.div.classList.contains('minimized')
        this.navigation.minimized_folders[this.path] = minimized // @ts-ignore
        this.minimize.innerText = minimized ? '+' : '-'
    }

    collapse = () => {
        this.div.classList.add('minimized')
        this.navigation.minimized_folders[this.path] = true // @ts-ignore
        this.minimize.innerText = '+'
    }

    expand = () => {
        this.div.classList.remove('minimized')
        this.navigation.minimized_folders[this.path] = false // @ts-ignore
        this.minimize.innerText = '-'
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

    /** @param { string } new_path */
    rename = (new_path) => {
        const exists = this.navigation.folders.find(f => f.path === new_path)
        if (exists) throw new Error('Folder already exists')
        const name = new_path.split('/').pop() || ''
        if (!name) throw new Error('Folder name not found')
        const old_path = this.path
        this.path = new_path
        this.full_path = new_path
        this.name = name // @ts-ignore
        this.title.innerText = name

        const minimized = this.navigation.minimized_folders[old_path]
        delete this.navigation.minimized_folders[old_path]
        this.navigation.minimized_folders[new_path] = minimized
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
    folders = []

    state

    /** @type { { [path: string]: boolean } } */
    minimized_folders = {}

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

        this.state = new Proxy({
            highlighted: null,
            focused: null,
        }, {
            set: (target, prop, value) => {
                const prev_highlighted = target.highlighted
                const prev_focused = target.focused
                target[prop] = value
                return true
            }
        })
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
        let folder = this.folders.find(f => f.path === path)
        if (folder) return
        let walker = ''
        while (tree.length) {
            const name = tree.shift() || ''
            walker += '/' + name
            const parent = folder
            folder = this.folders.find(f => f.path === walker)
            if (!folder) {
                this.#editor.project.folders = this.#editor.project.folders || []
                if (!this.#editor.project.folders.includes(walker)) {
                    this.#editor.project.folders.push(walker)
                }
                folder = new PLC_Folder(this, walker)
                this.folders.push(folder)
                /** @type { PLC_FolderChild } */
                const child = { type: 'folder', path: walker, full_path: walker, div: folder.div, name: folder.name, item: null }
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

    #onContextMenu = async (action, event, element) => {
        const item = this.findItem(element)
        if (!item) return console.error('Item not found in folders or root')
        const type = item.type === 'folder' ? 'folder' : item.item?.type || item.type
        const full_path = item.type === 'folder' ? item.path : ((item.item?.path + '/' + item.item?.name) || '').replace('//', '/') || item.path
        console.log(`Action ${action} on ${type}`, item)
        if (item.name === 'main') {
            return
        }
        if (action === 'delete') {
            const confirm = await Popup.confirm({
                title: 'Delete item',
                description: `<b>${full_path}</b>\n\nAre you sure you want to delete ${type} "${item.name}"?\nThis action cannot be undone.`,
                confirm_text: 'Delete',
                cancel_text: 'Cancel',
            })
            if (!confirm) return
            if (item.type === 'item') this.deleteFile(item.path)
            if (item.type === 'folder') this.deleteFolder(item.path)
        }
        if (action === 'add_folder') {
            const path = await Popup.createItem('folder', full_path) // Returns full path
            if (!path) return
            this.#recursivelyCreateFolder(path)
        }
        if (action === 'add_program') {
            const path = await Popup.createItem('program', full_path, (path) => {  // Returns full path
                if (path.endsWith('/main')) return false
                return true
            })
            if (!path) return
            const segments = path.split('/')
            const name = segments.pop()
            if (!name) throw new Error('Program name not found')
            const folder_path = segments.join('/')
            this.#editor.project.files.push({ type: 'program', name, comment: '', blocks: [], path: folder_path })
            this.draw_navigation_tree()
        }
        if (action === 'rename') {
            if (full_path.endsWith('/main')) throw new Error('Cannot rename main program')
            const path = await Popup.renameItem(type, full_path, (path) => {  // Returns full path
                if (path.endsWith('/main')) return false
                return true
            })
            if (!path) return
            const segments = path.split('/')
            const name = segments.pop()
            if (!name) throw new Error(toCapitalCase(type) + ' name not found')
            if (type === 'folder') { // @ts-ignore
                item.name = name // @ts-ignore
                item.rename(path)
                this.renameFolder(full_path, path)
            } else if (type === 'program') {
                if (item.item) item.item.name = name
            }
            this.draw_navigation_tree()
        }
    }

    /** @param { string } old_path @param { string } new_path */
    renameFolder = (old_path, new_path) => {
        // In all files that are in the folder, change the path to the new path
        const files = this.#editor.project.files
        files.forEach(file => {
            if (!file.path.startsWith(old_path)) return
            file.path = file.path.replace(old_path, new_path)
        })
        this.#editor.project.folders = this.#editor.project.folders.map(folder => {
            if (!folder.startsWith(old_path)) return folder
            return folder.replace(old_path, new_path)
        })
        // Delete the old folder from the list of folders
        this.folders = this.folders.filter(folder => folder.path !== old_path)
    }

    draw_navigation_tree = () => {
        const editor = this.#editor
        // [ + ] [icon] [title]   < ------ folder
        //       [icon] [title]   < ------ item
        const files = editor.project.files
        editor.project.folders = editor.project.folders || []
        const empty_folders = editor.project.folders
        const container = this.#container
        // Reset folder list
        this.folders.forEach(f => f.destroy())
        this.folders = []
        container.innerHTML = ''

        this.#root = []
        const root = this.#root

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
            const folder = this.folders.find(f => f.path === file.path)
            if (folder) {
                const full_path = `${folder.path}/${file.name}`.replace('//', '/')
                folder.addChild({ type: 'item', path: full_path, full_path, name: file.name, div, item: file })
            } else {
                const full_path = `${file.path}/${file.name}`.replace('//', '/')
                root.push({ type: 'item', path: file.path, full_path, name: file.name, div, item: file })
            }
        })

        root.sort(sortTree)
        root.forEach(item => container.appendChild(item.div))

        this.folders.forEach(folder => folder.sortChildren())

        console.log(root)
        editor.initial_program = null // Prevent opening the initial program again on redraw
    }

    /** @type { (filter: any) => (PLC_Folder | PLC_FolderChild | null) }  */
    findItem(filter) { // Find item (folder, program, ...) by path or matching element
        if (!filter) return null // @ts-ignore
        if (filter && filter.full_path) return filter
        if (typeof filter === 'string') {
            filter = sanitizePath(filter)
            /** @type { (items: PLC_Folder | PLC_FolderChild) => (PLC_Folder | PLC_FolderChild | null) } */
            const recursiveSearch = (item) => {
                if (item.full_path === filter) return item // @ts-ignore
                if (item.type === 'folder' && item.children) {
                    /** @type { PLC_Folder } *///@ts-ignore
                    const folder = item
                    for (let i = 0; i < folder.children.length; i++) {
                        const found_in_children = recursiveSearch(folder.children[i])
                        if (found_in_children) return found_in_children
                    }
                }
                return null
            }
            for (let i = 0; i < this.folders.length; i++) {
                const found_in_folders = recursiveSearch(this.folders[i])
                if (found_in_folders) return found_in_folders
            }
            for (let i = 0; i < this.#root.length; i++) {
                const found_in_root = recursiveSearch(this.#root[i])
                if (found_in_root) return found_in_root
            }
            return null
        }


        const findTreeItemByElement = (element) => {
            const classes = element.classList
            const className = classes[0] // Get the first class name
            // console.log(`Navigation tree selected [${className}]: ${selected}, element:`, element, `event:`, event)
            const matches = [
                'plc-navigation-item',
                'plc-navigation-folder',
                'plc-navigation-program',
                'plc-navigation-tree',
            ]
            const isMatch = matches.some(match => className === match)
            if (!isMatch) return console.error('Element does not match any of the expected classes', classes, matches, element)
            const is_navigation_item = className === 'plc-navigation-item'
            if (is_navigation_item) {
                const child0 = element.childNodes[0] // @ts-ignore
                return findTreeItemByElement(child0)
            }
            const is_navigation = className === 'plc-navigation-tree'
            if (is_navigation) {
                console.log('Empty navigation tree clicked')
                return
            }
            const container = element.parentElement
            let found = false
            let item = null
            // console.log('Folders', this.folders)
            for (const folder of this.folders) {
                // selected -> 'delete' | 'rename' | 'add_program' | 'add_folder' | ...
                if (folder.div === container) {
                    found = true
                    item = folder
                    break
                }
                folder.children.forEach(child => {
                    if (!found && child.div === container) {
                        found = true
                        item = child
                    }
                })
            }
            if (!found) {
                for (let i = 0; i < this.#root.length; i++) {
                    const root = this.#root[i]
                    if (root.div === container) {
                        found = true
                        item = root
                        break
                    }
                }
            }
            if (!found) return console.error('Item not found in folders or root')
            if (!item) throw new Error('Item not found')
            return item
        }

        const item = findTreeItemByElement(filter)

        if (!item) return null
        return item
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
        const subfolders = this.folders.filter(f => f.path.startsWith(path) && f.path !== path)
        subfolders.forEach(folder => this.deleteFolder(folder.path, true))
        this.folders = this.folders.filter(f => f.path !== path)
        this.#editor.project.folders = this.#editor.project.folders.filter(f => f !== path)
        if (!was_recursive) this.draw_navigation_tree()
    }
}