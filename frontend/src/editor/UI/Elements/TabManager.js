import { ElementSynthesis } from "../../../utils/tools.js";
import { PLCEditor } from "../../../utils/types.js";
import { getIconType } from "./components/icons.js";
import EditorUI from "./EditorUI.js";

export default class TabManager {
    #editor
    /** @param {PLCEditor} editor */
    constructor(editor) {
        this.#editor = editor
        /** @type { Map<string, { tabEl: Element, host: EditorUI }> } */
        this.tabs = new Map(); // filePath → { tabEl, host }
        this.active = null;

        this._tabBar = editor.workspace.querySelector(".plc-window-tabs");
        if (!this._tabBar) throw new Error("Tab bar not found")

        this._editorHost = editor.workspace.querySelector(".plc-window-frame");
        if (!this._editorHost) throw new Error("Editor host not found")
    }

    _createTabElement(id) {
        const program = this.#editor.findProgram(id);
        if (!program) throw new Error(`Program not found: ${id}`)
        const { name } = program

        const tabEl = ElementSynthesis(/*HTML*/`<div class="plc-tab" tabindex="0" draggable="true"><div class="plc-tab-title plc-icon ${getIconType(program.type)}">${name}</div><div class="plc-tab-close">×</div></div>`)
        const closeEl = tabEl.querySelector(".plc-tab-close");
        if (!tabEl || !closeEl) throw new Error("Failed to create tab element")

        // @ts-ignore
        tabEl.onclick = () => this.switchTo(id);
        
        // Setup Drag and Drop
        this.setupDragHandlers(tabEl, id);
        
        // @ts-ignore
        closeEl.onclick = (e) => {
            e.stopPropagation();
            this.closeTab(id);
        }
        
        return tabEl
    }

    /** @type { (id: string, host: EditorUI) => void } */
    openTab(id, host) {

        if (this.tabs.has(id)) {
            const entry = this.tabs.get(id)
            if (entry && !entry.host) {
                 entry.host = host;
            }
            this.switchTo(id);
            return;
        }

        const tabEl = this._createTabElement(id);
        this._tabBar.appendChild(tabEl);
        this.tabs.set(id, { tabEl, host });
        this.switchTo(id);
    }

    addLazyTab(id) {
        if (this.tabs.has(id)) return;
        try {
            const tabEl = this._createTabElement(id)
            this._tabBar.appendChild(tabEl);
            this.tabs.set(id, { tabEl, host: null });
        } catch (e) {
            console.error("Failed to add lazy tab", e)
        }
    }

    /** @type { (id: string) => void } */
    switchTo(id) {
        if (!this.tabs.has(id)) return;

        // Lazy Load
        const entry = this.tabs.get(id);
        if (!entry.host) {
            this.#editor.window_manager.openProgram(id)
            return
        }

        const program = this.#editor.findProgram(id);
        if (!program) throw new Error(`Program not found: ${id}`)

        this.#editor.window_manager.highlightItem(id)

        for (const [path, { tabEl, host }] of this.tabs) {
            const isActive = path === id;
            tabEl.classList.toggle("active", isActive);
            // editorEl.style.display = isActive ? "block" : "none";
            if (host) {
                if (isActive) host.show();
                else host.hide();
            }
        }

        if (entry.tabEl) {
             entry.tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }

        this.active = id;
    }

    /** @type { (id: string) => (string | null) } */
    closeTab(id) {
        const tab = this.tabs.get(id);
        if (!tab) return null;
        this.tabs.delete(id);
        this.#editor.window_manager.closeProgram(id)
        if (tab.host) tab.host.close();
        tab.tabEl.remove();
        if (this.active === id) {
            const next = this.tabs.keys().next().value || null;
            if (next) this.switchTo(next);
            else this.active = null;
        }
        return this.active;
    }


    /** @type { (id: string, name: string, comment?: string) => void } */
    updateTab(id, name, comment) {
        const tab = this.tabs.get(id);
        console.log('updateTab:', tab, id, name)
        if (!tab) return;
        const { tabEl, host } = tab;
        const titleEl = tabEl.querySelector(".plc-tab-title")
        if (!titleEl) throw new Error("Tab title not found")
        titleEl.textContent = name;
    }


    getOpenTabsOrdered() {
        if (!this._tabBar) return []
        return Array.from(this._tabBar.children)
            .map(el => this.findProgramIdByTab(el))
            .filter(id => id !== null) // Filter out any elements that aren't tabs or failed lookup
    }

    findProgramIdByTab(tabEl) {
        if (!tabEl) return null
        const closest = tabEl.closest(".plc-tab")
        if (!closest) return null
        const tab = [...this.tabs].find(([_, { tabEl }]) => tabEl === closest)
        if (!tab) return null
        const [id, { host }] = tab
        return id
    }

    /** @type { (element: Element | null) => boolean } */
    isTabElement(element) {
        if (!element) return false
        return element.classList.contains("plc-tab")
    }

    setupDragHandlers(tabEl, id) {
        tabEl.addEventListener('dragstart', (e) => {
            this.draggedTab = tabEl;
            this.draggedId = id;
            e.dataTransfer.effectAllowed = 'move';
            tabEl.classList.add('dragging');
            // Required for Firefox
            e.dataTransfer.setData('text/plain', id);
        });

        tabEl.addEventListener('dragend', () => {
             tabEl.classList.remove('dragging');
             this.draggedTab = null;
             this.draggedId = null;
        });

        tabEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!this.draggedTab || this.draggedTab === tabEl) return;

            const container = this._tabBar;
            const bounding = tabEl.getBoundingClientRect();
            const midpoint = bounding.x + bounding.width / 2;
            
            // Check if we are to the left or right of the midpoint
            if (e.clientX < midpoint) {
                // Insert before the target if it's not already there
                if (tabEl.previousSibling !== this.draggedTab) {
                    container.insertBefore(this.draggedTab, tabEl);
                }
            } else {
                // Insert after the target
                if (tabEl.nextSibling !== this.draggedTab) {
                    container.insertBefore(this.draggedTab, tabEl.nextSibling);
                }
            }
        });
    }
}