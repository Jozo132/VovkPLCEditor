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

    /** @type { (filePath: string, content: string) => void } */
    openTab(filePath, content) {
        if (this.tabs.has(filePath)) {
            this.switchTo(filePath);
            return;
        }

        const tabEl = document.createElement("div");
        tabEl.className = "tab";
        tabEl.textContent = filePath.split("/").pop() || filePath;
        tabEl.onclick = () => this.switchTo(filePath);
        this._tabBar.appendChild(tabEl);

        const editorEl = document.createElement("div");
        editorEl.className = "editor";
        editorEl.textContent = content;
        editorEl.style.display = "none";
        this._editorHost.appendChild(editorEl);

        this.tabs.set(filePath, { tabEl, editorEl });
        this.switchTo(filePath);
    }

    /** @type { (filePath: string) => void } */
    switchTo(filePath) {
        if (!this.tabs.has(filePath)) return;

        for (const [path, { tabEl, editorEl }] of this.tabs) {
            const isActive = path === filePath;
            tabEl.classList.toggle("active", isActive);
            editorEl.style.display = isActive ? "block" : "none";
        }

        this.active = filePath;
    }

    /** @type { () => string | null } */
    getActiveTab() {
        return this.active;
    }

    /** @type { (filePath: string, content: string) => void } */
    updateTab(filePath, content) {
        const tab = this.tabs.get(filePath);
        if (tab) tab.editorEl.textContent = content;
    }

    /** @type { (filePath: string) => void } */
    closeTab(filePath) {
        const tab = this.tabs.get(filePath);
        if (!tab) return;
        tab.tabEl.remove();
        tab.editorEl.remove();
        this.tabs.delete(filePath);
        if (this.active === filePath) {
            const next = this.tabs.keys().next().value || null;
            if (next) this.switchTo(next);
            else this.active = null;
        }
    }
}