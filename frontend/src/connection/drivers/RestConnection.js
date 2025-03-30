// @ts-check
"use strict"

import ConnectionBase from "../ConnectionBase.js";

export default class RestConnection extends ConnectionBase {
    baseUrl = ''
    /** @param {string} [baseUrl] */
    constructor(baseUrl) {
        super();
        if (baseUrl) this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    }

    async connect() {
        // Optionally verify connection
        const info = await this.getInfo();
        if (!info) throw new Error("Failed to connect to REST device");
        return true;
    }

    async disconnect() {
        // REST has no persistent connection; no action needed
    }

    async getInfo() {
        const res = await fetch(`${this.baseUrl}/vovkplcruntime/device/info`);
        return await res.json();
    }

    async reboot() {
        await fetch(`${this.baseUrl}/vovkplcruntime/device/reboot`, { method: "POST" });
    }

    async run() {
        await fetch(`${this.baseUrl}/vovkplcruntime/device/run`, { method: "POST" });
    }

    async stop() {
        await fetch(`${this.baseUrl}/vovkplcruntime/device/stop`, { method: "POST" });
    }

    async monitor() {
        await fetch(`${this.baseUrl}/vovkplcruntime/device/monitor`, { method: "POST" });
    }

    async downloadProgram(bytecode) {
        await fetch(`${this.baseUrl}/vovkplcruntime/device/program-download`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: new Uint8Array(bytecode),
        });
    }

    async uploadProgram() {
        const res = await fetch(`${this.baseUrl}/vovkplcruntime/device/program-upload`);
        return await res.text();
    }

    async readMemory(address, size) {
        const res = await fetch(`${this.baseUrl}/vovkplcruntime/device/memory-read`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address, size }),
        });
        return new Uint8Array(await res.arrayBuffer());
    }

    async writeMemory(address, data) {
        await fetch(`${this.baseUrl}/vovkplcruntime/device/memory-write`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address, size: data.length, data: Array.from(data) }),
        });
    }

    async formatMemory(address, size, value) {
        await fetch(`${this.baseUrl}/vovkplcruntime/device/memory-format`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address, size, value }),
        });
    }
}
