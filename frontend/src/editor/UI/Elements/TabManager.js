// @ts-check
"use strict"

import { PLCEditor } from "../../../utils/types.js";

export default class TabManager {
    #editor
    /** @param {PLCEditor} editor */
    constructor(editor) {
        this.#editor = editor
        this.tabs = new Map(); // filePath → { tabEl, editorEl }
        this.active = null;

        this._tabBar = editor.workspace.querySelector(".plc-window-tabs");
        if (!this._tabBar) throw new Error("Tab bar not found")

        this._editorHost = editor.workspace.querySelector(".plc-window-frame");
        if (!this._editorHost) throw new Error("Editor host not found")
    }

    /** @type { (id: string, content: string) => void } */
    openTab(id, content) {

        if (this.tabs.has(id)) {
            this.switchTo(id);
            return;
        }

        const program = this.#editor.findProgram(id);
        if (!program) throw new Error(`Program not found: ${id}`)
        const { name, comment } = program

        const tabEl = document.createElement("div");
        tabEl.className = "plc-tab";
        tabEl.textContent = name;
        tabEl.onclick = () => this.switchTo(id);
        this._tabBar.appendChild(tabEl);

        const editorEl = document.createElement("div");
        editorEl.className = "editor";
        editorEl.textContent = content;
        editorEl.style.display = "none";
        this._editorHost.appendChild(editorEl);

        this.tabs.set(id, { tabEl, editorEl });
        this.switchTo(id);
    }

    /** @type { (id: string) => void } */
    switchTo(id) {
        if (!this.tabs.has(id)) return;

        const program = this.#editor.findProgram(id);
        if (!program) throw new Error(`Program not found: ${id}`)

        this.#editor.window_manager.highlightItem(id)

        for (const [path, { tabEl, editorEl }] of this.tabs) {
            const isActive = path === id;
            tabEl.classList.toggle("active", isActive);
            editorEl.style.display = isActive ? "block" : "none";
        }

        this.active = id;
    }

    /** @type { () => string | null } */
    getActiveTab() {
        return this.active;
    }

    /** @type { (id: string, content: string) => void } */
    updateTab(id, content) {
        const tab = this.tabs.get(id);
        if (tab) tab.editorEl.textContent = content;
    }

    /** @type { (id: string) => void } */
    closeTab(id) {
        const tab = this.tabs.get(id);
        if (!tab) return;
        tab.tabEl.remove();
        tab.editorEl.remove();
        this.tabs.delete(id);
        if (this.active === id) {
            const next = this.tabs.keys().next().value || null;
            if (next) this.switchTo(next);
            else this.active = null;
        }
    }
}