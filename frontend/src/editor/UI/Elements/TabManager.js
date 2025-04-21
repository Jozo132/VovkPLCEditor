// @ts-check
"use strict"

import { ElementSynthesis } from "../../../utils/tools.js";
import { PLCEditor } from "../../../utils/types.js";
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

    /** @type { (id: string, host: EditorUI) => void } */
    openTab(id, host) {

        if (this.tabs.has(id)) {
            this.switchTo(id);
            return;
        }

        const program = this.#editor.findProgram(id);
        if (!program) throw new Error(`Program not found: ${id}`)
        const { name, comment } = program

        // const tabEl = document.createElement("div");
        // tabEl.className = "plc-tab";
        // tabEl.textContent = name;
        // tabEl.onclick = () => this.switchTo(id);
        // this._tabBar.appendChild(tabEl);

        const tabEl = ElementSynthesis(/*HTML*/`<div class="plc-tab"><div class="plc-tab-title">${name}</div><div class="plc-tab-close">×</div></div>`)
        const closeEl = tabEl.querySelector(".plc-tab-close");
        if (!tabEl) throw new Error("Tab title not found")
        if (!closeEl) throw new Error("Tab close button not found")

        // @ts-ignore
        tabEl.onclick = () => this.switchTo(id);
        this._tabBar.appendChild(tabEl);

        // @ts-ignore
        closeEl.onclick = (e) => {
            e.stopPropagation();
            this.closeTab(id);
        }

        this.tabs.set(id, { tabEl, host });
        this.switchTo(id);
    }

    /** @type { (id: string) => void } */
    switchTo(id) {
        if (!this.tabs.has(id)) return;

        const program = this.#editor.findProgram(id);
        if (!program) throw new Error(`Program not found: ${id}`)

        this.#editor.window_manager.highlightItem(id)

        for (const [path, { tabEl, host }] of this.tabs) {
            const isActive = path === id;
            tabEl.classList.toggle("active", isActive);
            // editorEl.style.display = isActive ? "block" : "none";
            if (isActive) host.show();
            else host.hide();
        }

        this.active = id;
    }

    /** @type { (id: string) => void } */
    closeTab(id) {
        const tab = this.tabs.get(id);
        if (!tab) return;
        this.tabs.delete(id);
        tab.host.close();
        tab.tabEl.remove();
        if (this.active === id) {
            const next = this.tabs.keys().next().value || null;
            if (next) this.switchTo(next);
            else this.active = null;
        }
        this.#editor.window_manager.closeProgram(id)
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
}