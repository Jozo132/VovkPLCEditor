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

/** @type { (params: { minimized: boolean, draggable: boolean, selected: boolean }) => string } */
const folder_item_html = ({ minimized, draggable, selected }) => /*HTML*/`
    <div class="plc-navigation-item ${minimized ? 'minimized' : ''} ${selected ? 'selected' : ''}">
        <div class="plc-navigation-folder" tabindex="0" draggable="${draggable}">
            <div class="minimize">${minimized ? '+' : '-'}</div>
            <div class="plc-icon plc-icon-folder"></div>
            <div class="plc-title">empty</div>
        </div>
        <div class="plc-navigation-children">
            <!-- Children will be added here dynamically -->
        </div>
    </div>
`

/** @type { (params: { draggable: boolean, selected: boolean }) => string } */
const program_item_html = ({ draggable, selected }) => /*HTML*/`
    <div class="plc-navigation-item ${selected ? 'selected' : ''}">
        <div class="plc-navigation-program" tabindex="0" draggable="${draggable}">
            <div class="plc-void"></div>
            <div class="plc-icon plc-icon-gears"></div>
            <div class="plc-title">empty</div>
        </div>
    </div>
`


const sanitizePath = path => '/' + (path.replace(/\/+/g, '/').split('/').map(p => p.trim()).filter(Boolean).join('/') || '')
const sortTree = (a, b) => {
    // Sort by depth, where higher depth has higher priority
    if (a.depth !== b.depth) return a.depth - b.depth
    if (b.type === 'file' && b.item.name === 'main') return 1
    if (a.type === 'file' && a.item.name === 'main') return -1
    if (a.type === 'folder' && b.type !== 'folder') return -1
    if (a.type !== 'folder' && b.type === 'folder') return 1
    const a_name = (a.full_path || a.path).split('/').pop() || ''
    const b_name = (b.full_path || b.path).split('/').pop() || ''
    return a_name.localeCompare(b_name)
}


class PLC_File {
    type = 'file'
    path = ''
    full_path = ''
    div
    name = ''
    comment = ''
    blocks = []
    item
    /** @param { PLC_ProjectItem } item */

    #editor
    navigation

    /** @param { PLCEditor } editor * @param { NavigationTreeManager } navigation * @param { PLC_ProjectItem } item */
    constructor(editor, navigation, item) {
        if (!editor) throw new Error('Editor not found')
        if (!navigation) throw new Error('Navigation not found')
        if (!item) throw new Error('Item not found')
        this.#editor = editor
        this.navigation = navigation
        item.id = item.id || editor._generateID()
        this.item = item
        this.path = sanitizePath(item.path)
        this.full_path = sanitizePath(item.full_path)
        this.name = item.name || ''
        this.comment = item.comment || ''
        if (!this.name) throw new Error('File name not found')
        if (!this.path) throw new Error('File path not found')
        if (!this.full_path) throw new Error('File full path not found')
        const draggable = true
        const selected = this.navigation.state.selected === this.full_path
        this.div = ElementSynthesis(program_item_html({ draggable, selected }))
        const program_div = this.div.querySelector('.plc-navigation-program'); if (!program_div) throw new Error('Program div not found')
        const title = this.div.querySelector('.plc-title'); if (!title) throw new Error('Title not found')
        this.title = title
        program_div.addEventListener('click', this.onClick)



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
        this.div.classList.toggle('selected')
        this.navigation.state.selected = this.div.classList.contains('selected') ? this.full_path : null
        this.navigation.state.focused = this.full_path
        // TODO: Open the program in the editor
        const is_highlighted = this.navigation.state.selected === this.full_path
        // if (!is_highlighted) {
        this.navigation.highlightItem(this.full_path)
        // return
        // }
        this.open()
    }

    open = () => {
        this.#editor.window_manager.openProgram(this.item.id)
    }

    /** @param { string } new_path */
    rename = (new_path) => {
        if (!new_path) throw new Error('New path is empty')
        const parts = new_path.split('/')
        const new_name = parts.pop() || ''
        const path = parts.join('/')
        if (!new_name) throw new Error('File name not found')
        const old_path = this.full_path
        this.name = new_name
        this.full_path = new_path
        this.path = path
        this.item.name = new_name
        this.item.full_path = new_path
        this.item.path = path
        const root_child = this.navigation.root.find(f => f.full_path === old_path)
        if (root_child) {
            root_child.full_path = new_path
            root_child.item.name = new_name
            root_child.item.full_path = new_path
            root_child.item.path = path
        }
    }

    destroy() {
        this.div.remove()
    }
}

class PLC_Folder {
    type = 'folder'
    path = ''
    full_path = ''
    div
    name

    depth = -1

    item = null

    /** @type { PLC_TreeItem[] } */
    children = []

    navigation

    /** @param { NavigationTreeManager } navigation * @param { string } path */
    constructor(navigation, path) {
        this.navigation = navigation
        path = sanitizePath(path)
        if (!path) throw new Error('Path is empty')
        this.path = path
        this.full_path = path
        const parts = path.split('/')
        this.name = parts.pop() || ''
        this.depth = parts.length - 1
        if (!this.name) throw new Error('Folder name not found')
        if (typeof this.navigation.minimized_folders[path] === 'undefined') {
            this.navigation.minimized_folders[path] = initial_tree_minimized
        }
        const minimized = this.navigation.minimized_folders[path]
        const draggable = true
        const selected = this.navigation.state.selected === path
        this.div = ElementSynthesis(folder_item_html({ minimized, draggable, selected }))
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
        // const is_selected = this.navigation.state.selected === this.full_path
        // if (!is_selected) {
        this.navigation.highlightItem(this.full_path)
        // return
        // }
        this.div.classList.toggle('minimized')
        const minimized = this.div.classList.contains('minimized')
        this.navigation.minimized_folders[this.path] = minimized // @ts-ignore
        this.minimize.innerText = minimized ? '+' : '-'
    }

    /** @param { PLC_TreeItem } child */
    appendChild = (child) => {
        if (this.children.find(c => c.full_path === child.full_path)) return
        this.children.push(child)
        if (this.list) this.list.appendChild(child.div)
        else throw new Error('Children list not found')
    }
    clearChildren = () => {
        this.children = []
        if (this.list) this.list.innerHTML = ''
        else throw new Error('Children list not found')
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

    /** @param { string } new_path */
    rename = (new_path) => {
        if (!new_path) throw new Error('New path is empty')
        const parts = new_path.split('/')
        const new_name = parts.pop() || ''
        const path = parts.join('/')
        if (!new_name) throw new Error('Folder name not found')
        this.name = new_name
        this.full_path = new_path
        this.path = path
        for (const child of this.children) {
            const name = child.name
            const new_child_path = sanitizePath(`${new_path}/${name}`)
            child.rename(new_child_path)
        }
    }

    destroy() {
        this.div.remove()
    }
}


/** 
 * @typedef { PLC_Folder | PLC_File } PLC_TreeItem
 * 
 * @typedef { { fixed?: boolean, full_path: string, depth: number, type: 'file' | 'folder', minimized?: boolean, selected?: boolean, item: PLC_TreeItem } }  RootState
**/

/** @type {{ files: PLC_ProjectItem[], folders: string[] }} */
const default_root_state = {
    files: [
        { type: 'program', name: 'main', path: '/', full_path: '/main', comment: '', blocks: [] }
    ],
    folders: [
        '/programs',
    ]
}

export default class NavigationTreeManager {


    /*
        /main -> file (L0 - fixed)
        /programs/ -> folder (L0 - fixed)
        /porgrams/sample_1 -> file (L1)
        /programs/sample_2 -> file (L1)
        /programs/tests/ -> folder (L1)
        /programs/tests/sample_3 -> file (L2)
        /programs/tests/sample_4 -> file (L2)
        /programs/tests/sample_5 -> file (L2)
        /programs/tests/more tests/ -> folder (L2)
        /programs/tests/more tests/sample_6 -> file (L3)
        /programs/tests/more tests/sample_7 -> file (L3)
        /programs/tests/more tests/sample_8 -> file (L3)
    */

    /** @type { RootState[] } */
    root = []

    /** @type {{ [key: string]: string | null }} */
    state = {
        focused: null,
        selected: null,
    }

    /** @type { { [path: string]: boolean } } */
    minimized_folders = {}

    container
    #editor
    /** @param { PLCEditor } editor */
    constructor(editor) {
        this.#editor = editor
        const workspace = editor.workspace
        this.workspace = workspace

        const container = workspace.querySelector('.plc-navigation-tree')
        if (!container) throw new Error('Navigation tree container not found')
        container.innerHTML = ''
        this.container = container

        this.state = new Proxy({
            selected: null,
            focused: null,
        }, {
            set: (target, prop, value) => {
                const prev_highlighted = target.selected
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
            { type: 'item', name: 'open', label: 'Open' },
            // { type: 'item', name: 'cut', label: 'Cut' },
            // { type: 'item', name: 'copy', label: 'Copy' },
            // { type: 'item', name: 'paste', label: 'Paste' },
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
            { type: 'item', name: 'open', label: 'Open' },
            // { type: 'item', name: 'cut', label: 'Cut', disabled: true },
            // { type: 'item', name: 'copy', label: 'Copy' },
            // { type: 'item', name: 'paste', label: 'Paste', disabled: true },
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
            // { type: 'item', name: 'add_folder', label: 'Add Folder' },
        ]

        const on_context_open_empty = (event, element) => {
            const connected = editor.device_manager.connected
            return connected ? [] : ctx_edit_empty
        }
        const on_context_close_empty = (action, event, element) => {
            editor.window_manager.tree_manager.#onContextMenu(action, event, element)
        }
        editor.context_manager.addListener({
            target: this.container,
            className: 'plc-navigation-tree',
            onOpen: on_context_open_empty,
            onClose: on_context_close_empty,
        })

    }



    /** @param { { item?: PLC_Program | PLC_TreeItem, path?: string, recursive?: boolean, fixed?: boolean, redraw?: boolean } } params */
    createTreeItem = ({ item, path, recursive, fixed, redraw }) => {
        if (path) path = sanitizePath(path)
        if (item && item.path && item.name && !item.full_path) item.full_path = sanitizePath(item.path + '/' + item.name)
        if (item && item.full_path) path = item.full_path = sanitizePath(item.full_path)
        if (!path) throw new Error('Path is empty')
        fixed = fixed || false // @ts-ignore
        if (item && item.fixed) fixed = true
        if (typeof redraw === undefined) redraw = true

        const type = item ? (item.type === 'folder' ? 'folder' : 'file') : 'folder'

        // console.log(`Create tree item`, { item, path, recursive, fixed })

        // Recurively add folder structures to the tree
        // Example:
        // "/folder1/folder2/folder3" -> ["/folder1", "/folder1/folder2", "/folder1/folder2/folder3"]
        let exists = this.root.find(f => f.full_path === path)
        if (exists) return
        let walker = ''
        const tree = path.split('/').filter(Boolean)
        if (type === 'file') tree.pop() // Remove the file name from the path for folder generation
        let root_path = true
        while (root_path || tree.length) {
            const name = tree.shift() || ''
            walker += '/' + name
            exists = this.root.find(f => f.full_path === walker)

            if (walker !== '/' && (type === 'folder' || recursive) && (!exists || !exists.item)) {
                /** @type { RootState } */ // @ts-ignore
                const root_child = exists || {
                    fixed,
                    type: 'folder',
                    depth: -1,
                    full_path: walker
                }
                root_child.item = new PLC_Folder(this, walker)
                // console.log('Creating tree item', root_child)
                this.root.push(root_child)
            }
            if (item && type === 'file' && !tree.length) {
                /** @type { RootState } */
                const root_child = {
                    fixed,
                    type,
                    depth: -1,
                    full_path: path, // @ts-ignore
                    item: new PLC_File(this.#editor, this, item),
                }
                // console.log('Creating tree item', root_child)
                this.root.push(root_child)
            }
            root_path = false
        }
        if (redraw) {
            this.root.sort(sortTree)
            this.draw_navigation_tree()
        }
    }

    #onContextMenu = async (action, event, element) => {
        const rootItem = this.findItem(element)
        if (!rootItem) return console.error('Item not found in root')
        const item = rootItem.item
        if (!item) return console.error('Item not found in folders or root')
        const type = item.type === 'folder' ? 'folder' : item.item?.type || item.type
        const full_path = item.full_path
        console.log(`Action ${action} on ${type}`, item)
        if (item.name === 'main') {
            return
        }
        if (action === 'delete') {
            if (full_path === '/main') throw new Error('Cannot delete main program')
            if (full_path === '/programs') throw new Error('Cannot delete programs folder')
            const confirm = await Popup.confirm({
                title: 'Delete item',
                description: `<b>${full_path}</b>\n\nAre you sure you want to delete ${type} "${item.name}"?\nThis action cannot be undone.`,
                confirm_text: 'Delete',
                cancel_text: 'Cancel',
            })
            if (!confirm) return
            this.deleteItem(item.full_path)
        }
        if (action === 'add_folder') {
            const path = await Popup.createItem('folder', full_path, (path) => { // Returns full path
                if (path.endsWith('/main')) return false
                const exists = this.root.find(f => f.full_path === path)
                if (exists) return false
                return true
            })
            if (!path) return
            this.createTreeItem({ path, recursive: true, redraw: true })
        }
        if (action === 'add_program') {
            const path = await Popup.createItem('program', full_path, (path) => { // Returns full path
                if (path.endsWith('/main')) return false
                const exists = this.root.find(f => f.full_path === path)
                if (exists) return false
                return true
            })
            if (!path) return
            const parts = path.split('/')
            const name = parts.pop() || ''
            const dir = parts.join('/')
            if (!name) throw new Error('Program name not found')
            /** @type { PLC_ProjectItem } */
            const item = { type: 'program', name, full_path: path, path: dir, comment: '', blocks: [] }
            this.createTreeItem({ item, recursive: true, redraw: true })
        }
        if (action === 'rename') {
            if (full_path.endsWith('/main')) throw new Error('Cannot rename main program')
            if (full_path === '/programs') throw new Error('Cannot rename programs folder')
            const path = await Popup.renameItem(type, full_path, (path) => {  // Returns full path
                if (path.endsWith('/main')) return false
                return true
            })
            if (!path) return
            const segments = path.split('/')
            const name = segments.pop()
            if (!name) throw new Error(toCapitalCase(type) + ' name not found')
            this.renameItem(full_path, path)
            this.draw_navigation_tree()
        }
    }

    /** @param { string } old_path @param { string } new_path */
    renameItem = (old_path, new_path) => {
        // In all files that are in the folder, change the path to the new path
        const new_name = new_path.split('/').pop() || ''
        if (!new_name) throw new Error('Folder name not found')
        console.log('Renaming item', old_path, new_path)
        this.root.forEach(item => {
            const { type, full_path } = item
            const matches = full_path === old_path
            const is_child = !matches && full_path.startsWith(old_path) // @ts-ignore
            const id = item?.item?.item?.id || item?.item?.id || ''
            if (matches) {
                if (type === 'file' && id) {
                    this.#editor.window_manager.tab_manager.updateTab(id, new_name)
                    this.#editor.window_manager.windows.get(id)?.updateInfo({ name: new_name })
                }
                item.full_path = new_path
                item.item.name = new_name
                item.item.full_path = new_path
                item.item.rename(new_path)
                return
            }
            if (is_child) {
                if (type === 'file' && id) {
                    this.#editor.window_manager.tab_manager.updateTab(id, new_name)
                    this.#editor.window_manager.windows.get(id)?.updateInfo({ name: new_name })
                }
                const new_full_path = full_path.replace(old_path, new_path)
                item.full_path = new_full_path
                item.item.rename(new_full_path)
            }
        })
    }

    /** @param { boolean } [reload] */
    draw_navigation_tree = (reload) => {
        const editor = this.#editor
        // [ + ] [icon] [title]   < ------ folder
        //       [icon] [title]   < ------ item
        const files = editor.project.files
        editor.project.folders = editor.project.folders || []
        const empty_folders = editor.project.folders
        const container = this.container
        container.innerHTML = ''

        const container_handler = {
            depth: 0,
            appendChild: (child) => {
                // console.log(``, 'Appending child', child)
                container.appendChild(child.div)
            },
            clearChildren: () => {
                container.innerHTML = ''
            }
        }

        if (reload) {
            default_root_state.files.forEach(item => this.createTreeItem({ item, recursive: true, fixed: true, redraw: false }))
            default_root_state.folders.forEach(path => this.createTreeItem({ path, recursive: true, fixed: true, redraw: false }))

            empty_folders.forEach(path => this.createTreeItem({ path, recursive: true, redraw: false }))
            files.forEach(item => this.createTreeItem({ item, recursive: true, redraw: false }))
        }

        // Evaluate each item in the root and set the depth
        this.root.forEach((item, index) => {
            const { full_path } = item
            const parts = full_path.split('/').filter(Boolean)
            item.depth = parts.length - 1
        })

        console.log(this.root)

        this.root.sort(sortTree)

        const renderFolder = (folder, path) => {
            folder.clearChildren()
            const items = this.root.filter(f => {
                if (!f.full_path.startsWith(path)) return false // Filter only items that start with the path
                if (f.full_path === path) return false // Do not include the folder itself
                const depth = path === '/' ? 0 : (folder.depth + 1)
                if (f.depth !== depth) return false // Filter only items that are in the same depth level
                return true // Include the item
            })
            // console.log(`Items for folder filter path "${path}" and depth ${folder.depth} ->`, items)
            items.forEach(item => {
                if (item.type === 'folder') {
                    // console.log('Adding folder', item)
                    const subfolder = item.item // @ts-ignore
                    folder.appendChild(subfolder)
                    renderFolder(subfolder, item.full_path)
                } else if (item.type === 'file') {
                    // console.log('Adding file', item)
                    const file = item.item // @ts-ignore
                    folder.appendChild(file)
                }
            })
        }

        renderFolder(container_handler, '/')


        editor.initial_program = null // Prevent opening the initial program again on redraw
    }

    /** @type { (filter: any) => (RootState | null) }  */
    findItem(filter) { // Find item (folder, program, ...) by path or matching element
        if (!filter) return null // @ts-ignore
        if (filter && filter.full_path) return filter
        if (typeof filter === 'string') {
            // Search by program ID first
            for (let i = 0; i < this.root.length; i++) {
                const item = this.root[i] // @ts-ignore
                if (item.type === 'file' && item?.item?.item?.id === filter) return item
            }
            filter = sanitizePath(filter)
            const item = this.root.find(f => f.full_path === filter)
            if (item) return item
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
            if (!isMatch) return //console.error('Element does not match any of the expected classes', classes, matches, element)
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
            const item = this.root.find(f => f.item.div === element || f.item.div === container)
            if (!item) return console.error('Item not found in folders or root', element, container, this.root)
            return item
        }

        const item = findTreeItemByElement(filter)

        if (!item) return null // @ts-ignore
        return item
    }

    /** @type { (id: string | null) => (PLC_ProjectItem | null) } */
    findProgram = (id) => {
        if (!id) return null
        for (let i = 0; i < this.root.length; i++) {
            const item = this.root[i] // @ts-ignore
            if (item.type === 'file' && item.item.item.id === id) return item.item.item
        }
        const item = this.findItem(id) // @ts-ignore
        if (item && item.item?.item) return item.item.item
        return null
    }

    highlightItem = (filter) => {
        const rootItem = this.findItem(filter)
        if (!rootItem) return console.error('Item not found in root')
        const item = rootItem.item
        if (!item) return console.error('Item not found')
        this.root.forEach(item => {
            if (item.item.div) item.item.div.classList.remove('selected')
        })
        if (item.div) item.div.classList.add('selected')
        this.state.selected = item.full_path // @ts-ignore
    }

    removeHighlight = () => {
        this.root.forEach(item => {
            if (item.item.div) item.item.div.classList.remove('selected')
        })
        this.state.selected = null // @ts-ignore
    }

    /** @param { string } path */
    deleteItem = (path) => {
        console.log(`Deleting item "${path}"`)

        /** @type { (item: RootState) => void } */
        const deleteFile = item => {
            if (!item) return
            if (item.type === 'file') { // @ts-ignore
                const id = item.item?.item?.id || item.item?.id || ''
                console.log('Deleting file', item, id)
                if (id) this.#editor.window_manager.closeProgram(id) // Close the program if it is open
                item.item.destroy() // Destroy the item
            }
        }

        const exists = this.root.find(f => f.full_path === path)
        if (exists) deleteFile(exists) // Delete the file if it exists

        this.root = this.root.filter(f => {
            if (f.fixed) return true // Do not delete fixed items
            if (f.full_path.startsWith(path)) {
                deleteFile(f) // Delete the item
                return false // Delete all items that start with the path
            }
            return true // Keep all other items
        })
        this.#editor.project.files = this.#editor.project.files.filter(f => {
            if (f.full_path.startsWith(path)) return false // Delete all files that start with the path
            return true // Keep all other files
        }) // Delete all files that start with the path
        this.draw_navigation_tree()
    }
}