// @ts-check
"use strict"

export default class TabManager {
    /**
     * @param {HTMLElement} editorContainer
     */
    constructor(editorContainer) {
        this.editorContainer = editorContainer;
        this.tabs = new Map(); // filePath → { tabEl, editorEl }
        this.active = null;

        this._tabBar = document.createElement("div");
        this._tabBar.className = "tab-bar";
        this.editorContainer.appendChild(this._tabBar);

        this._editorHost = document.createElement("div");
        this._editorHost.className = "editor-host";
        this.editorContainer.appendChild(this._editorHost);
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