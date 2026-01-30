import { ImageRenderer, importCSSCode } from "../../../../utils/tools.js"

class IconDealer {
    /** @type { Map<string, string> } */
    icons = new Map()

    static getInstance() {
        window['____vovkplceditor_icon_dealer'] = window['____vovkplceditor_icon_dealer'] || new IconDealer()
        return window['____vovkplceditor_icon_dealer']
    }

    async importIcon({ type, name, image }) {
        if (type && this.icons.has(type)) throw new Error(`Icon for ${type} already exists`)
        this.icons.set(type, name)
        await importCSSCode(`.${name}::before { background-image: ${image}; }`)
    }

    /** @param { string } type */
    getIconType(type) {
        if (this.icons.has(type)) return this.icons.get(type) || ''
        return ''
    }
}
const icon_dealer = IconDealer.getInstance()
/** @type { (name: string, type: string, image: string) => Promise<void> } */
export const importIcon = (name, type, image) => icon_dealer.importIcon({ name, type, image })
/** @type { (type: string) => string } */
export const getIconType = (type) => icon_dealer.getIconType(type)


// Simple 12x12 folder icon in yellow color, with the ear sticking out on the top left in dark yellow
//
//  +------\
//  |       +------+
//  +------/       |
//  |              |
//  |              |
//  +--------------+
//
//  Use path to draw the icon
//  start at 0,0
//  line to 4,0 
//  diagonal to 6,2
//  line to 10,2 
//  diagonal to 12,4 
//  line to 12,10 
//  diagonal to 10,12
//  line to 2,12
//  diagonal to 0,10
//  line to 0,0
//  close path
//  Now the top left ear:
//  start at 0,0
//  line to 4,0
//  diagonal to 6,2
//  diagonal to 4,4
//  line to 0,4
//  close path

const folder_icon_source = {
    width: 120,
    height: 120,
    data: `
        <path fill="#AA0" stroke="#000" stroke-width="4" d="M60,20 L105,20 L115,30 L115,105 L105,115 L15,115 L5,105 L5,20 L15,5 L15,5 L40,5 Z" />
        <path fill="#FF5" stroke="#000" stroke-width="4" d="M60,20 L105,20 L115,30 L115,105 L105,115 L15,115 L5,105 L5,35 L40,35 Z" />
    `
}

const program_icon_source = {
    width: 26,
    height: 26,
    scale: 0.5,
    data: `
        <path fill="#3AD" d="M30.088 12.102l-1.722 2.998c-1.051-0.449-2.172-0.764-3.344-0.919v-3.463h-3.353v3.461c-1.141 0.148-2.236 0.447-3.263 0.873l-1.693-2.95-2.247 1.264-0.927-1.298c0.306-0.425 0.547-0.903 0.708-1.423l3.383-0.37-0.333-3.386-3.237 0.32c-0.253-0.581-0.615-1.108-1.065-1.552l1.293-2.888-3.081-1.379-1.28 2.86c-0.656-0.054-1.297 0.024-1.895 0.213l-1.806-2.529-2.747 2.007 1.859 2.603c-0.313 0.496-0.541 1.056-0.662 1.662l-3.266 0.357 0.333 3.386 3.451-0.378c0.244 0.442 0.555 0.844 0.921 1.193l-1.46 3.261 3.080 1.379 1.472-3.288c0.507 0.033 1.004-0.013 1.478-0.128l2.127 2.914 1.979-1.446 0.728 1.258c-0.918 0.701-1.739 1.522-2.441 2.439l-3.071-1.769-1.603 2.915 3.002 1.744c-0.441 1.056-0.747 2.183-0.895 3.358h-3.492v3.353h3.507c0.104 0.752 0.274 1.481 0.502 2.186h10.566c0 0 0 0 0 0v0c-1.493-0.671-2.533-2.17-2.533-3.913 0-2.369 1.92-4.289 4.289-4.289s4.289 1.92 4.289 4.289c0 1.743-1.040 3.242-2.533 3.913v0c0 0 0 0 0 0h5.71v-18.439l-0.729-0.401zM9.695 12.139c-1.515 0.092-2.818-1.060-2.91-2.575s1.061-2.818 2.576-2.91 2.818 1.061 2.91 2.575c0.092 1.515-1.061 2.817-2.576 2.91z"></path>
    `
}

const plus_icon_source = {
    width: 120,
    height: 120,
    data: `
        <path fill="#3AD" stroke="#3AD" stroke-width="20" d="M60,0 L60,120 M0,60 L120,60"  />
    `
}

const delete_icon_source = {
    width: 120,
    height: 120,
    data: `
        <path fill="#D33" stroke="#D33" stroke-width="20" d="M15,15 L105,105 M105,15 L15,105"  />
    `
}

const symbols_icon_source = {
    width: 24,
    height: 24,
    data: `
        <path fill="#4A7" d="M4 4h16v16H4V4zm2 2v3h12V6H6zm0 5v3h12v-3H6zm0 5v3h12v-3H6z"/>
    `
}

const setup_icon_source = {
    width: 24,
    height: 24,
    data: `
        <path fill="#E67e22" d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
    `
}

const memory_icon_source = {
    width: 24,
    height: 24,
    data: `
        <path fill="#9CDCFE" d="M5 6h14v10H5V6zm2 2v6h2V8H7zm4 0v6h2V8h-2zm4 0v6h2V8h-2z"/>
        <path fill="#9CDCFE" d="M7 4h2v2H7V4zm4 0h2v2h-2V4zm4 0h2v2h-2V4zM7 16h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z"/>
    `
}

const download_icon_source = {
    width: 24,
    height: 24,
    data: `
        <path fill="#ddd" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
    `
}

const upload_icon_source = {
    width: 24,
    height: 24,
    data: `
        <path fill="#ddd" d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>
    `
}

const sidebar_project_icon_source = {
    width: 24,
    height: 24,
    data: `
        <path fill="#C5C5C5" d="M19.005 3a.996.996 0 0 0-.995-.99H13.88l-2.022-2H2a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2.002 2.002 0 0 0-2-2zM12 18H4v-4h8zm0-6H4V8h8zm8 6h-6v-4h6zm0-6h-6V8h6z"/>
    `
}

const sidebar_health_icon_source = {
    width: 24,
    height: 24,
    data: `
        <path fill="#C5C5C5" d="M21 10.5h-5.2l-1.3 6.9-3.9-12.8-3.4 8.7H2v2h6.8l1.6-4.2 4 13.9 3.5-9.6H22v-2z"/>
    `
}

const sidebar_watch_icon_source = {
    width: 24,
    height: 24,
    data: `
        <path fill="#C5C5C5" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
    `
}

const monitor_icon_source = {
    width: 24,
    height: 24,
    data: `
        <ellipse fill="none" stroke="#ddd" stroke-width="2" cx="7" cy="12" rx="4.5" ry="4"/>
        <ellipse fill="none" stroke="#ddd" stroke-width="2" cx="17" cy="12" rx="4.5" ry="4"/>
        <line stroke="#ddd" stroke-width="2" x1="11.5" y1="12" x2="12.5" y2="12"/>
        <path fill="none" stroke="#ddd" stroke-width="2" d="M2.5 12 L1 11"/>
        <path fill="none" stroke="#ddd" stroke-width="2" d="M21.5 12 L23 11"/>
    `
}

// Ladder icon - Contact (NO) - two vertical lines with horizontal connections
const ladder_contact_icon_source = {
    width: 24,
    height: 24,
    data: `
        <line stroke="#3AD" stroke-width="2" x1="2" y1="12" x2="7" y2="12"/>
        <line stroke="#3AD" stroke-width="2" x1="7" y1="6" x2="7" y2="18"/>
        <line stroke="#3AD" stroke-width="2" x1="17" y1="6" x2="17" y2="18"/>
        <line stroke="#3AD" stroke-width="2" x1="17" y1="12" x2="22" y2="12"/>
    `
}

// Ladder icon - Coil - circle with horizontal connections
const ladder_coil_icon_source = {
    width: 24,
    height: 24,
    data: `
        <line stroke="#F93" stroke-width="2" x1="2" y1="12" x2="7" y2="12"/>
        <circle fill="none" stroke="#F93" stroke-width="2" cx="12" cy="12" r="5"/>
        <line stroke="#F93" stroke-width="2" x1="17" y1="12" x2="22" y2="12"/>
    `
}

// Ladder icon - Timer - box with clock symbol
const ladder_timer_icon_source = {
    width: 24,
    height: 24,
    data: `
        <rect fill="none" stroke="#9C7" stroke-width="2" x="4" y="4" width="16" height="16" rx="2"/>
        <circle fill="none" stroke="#9C7" stroke-width="1.5" cx="12" cy="12" r="5"/>
        <line stroke="#9C7" stroke-width="1.5" x1="12" y1="12" x2="12" y2="8"/>
        <line stroke="#9C7" stroke-width="1.5" x1="12" y1="12" x2="15" y2="12"/>
    `
}

// Ladder icon - Counter - box with counter symbol
const ladder_counter_icon_source = {
    width: 24,
    height: 24,
    data: `
        <rect fill="none" stroke="#C7A" stroke-width="2" x="4" y="4" width="16" height="16" rx="2"/>
        <line stroke="#C7A" stroke-width="2" x1="12" y1="7" x2="12" y2="13"/>
        <line stroke="#C7A" stroke-width="2" x1="9" y1="10" x2="15" y2="10"/>
        <line stroke="#C7A" stroke-width="2" x1="9" y1="17" x2="15" y2="17"/>
    `
}

// Ladder icon - Math operations - box with + and - signs
const ladder_math_icon_source = {
    width: 24,
    height: 24,
    data: `
        <rect fill="none" stroke="#7CF" stroke-width="2" x="4" y="4" width="16" height="16" rx="2"/>
        <line stroke="#7CF" stroke-width="2" x1="8" y1="9" x2="14" y2="9"/>
        <line stroke="#7CF" stroke-width="2" x1="11" y1="6" x2="11" y2="12"/>
        <line stroke="#7CF" stroke-width="2" x1="8" y1="16" x2="14" y2="16"/>
    `
}

// Ladder icon - Compare operations - box with < >
const ladder_compare_icon_source = {
    width: 24,
    height: 24,
    data: `
        <rect fill="none" stroke="#FA7" stroke-width="2" x="4" y="4" width="16" height="16" rx="2"/>
        <polyline fill="none" stroke="#FA7" stroke-width="2" points="10,8 7,12 10,16"/>
        <polyline fill="none" stroke="#FA7" stroke-width="2" points="14,8 17,12 14,16"/>
    `
}

// Ladder icon - Move/Transfer - box with arrow
const ladder_move_icon_source = {
    width: 24,
    height: 24,
    data: `
        <rect fill="none" stroke="#A9F" stroke-width="2" x="4" y="4" width="16" height="16" rx="2"/>
        <line stroke="#A9F" stroke-width="2" x1="8" y1="12" x2="16" y2="12"/>
        <polyline fill="none" stroke="#A9F" stroke-width="2" points="13,9 16,12 13,15"/>
    `
}

// Project Properties icon - document with lines
const project_properties_icon_source = {
    width: 24,
    height: 24,
    data: `
        <path fill="none" stroke="#ddd" stroke-width="2" d="M6 2 L6 22 L18 22 L18 8 L12 2 Z"/>
        <path fill="none" stroke="#ddd" stroke-width="2" d="M12 2 L12 8 L18 8"/>
        <line stroke="#ddd" stroke-width="1.5" x1="8" y1="12" x2="16" y2="12"/>
        <line stroke="#ddd" stroke-width="1.5" x1="8" y1="15" x2="16" y2="15"/>
        <line stroke="#ddd" stroke-width="1.5" x1="8" y1="18" x2="13" y2="18"/>
    `
}

// Cut icon - scissors
const cut_icon_source = {
    width: 24,
    height: 24,
    data: `
        <circle fill="none" stroke="#ddd" stroke-width="2" cx="7" cy="17" r="3"/>
        <circle fill="none" stroke="#ddd" stroke-width="2" cx="17" cy="17" r="3"/>
        <line stroke="#ddd" stroke-width="2" x1="9" y1="15" x2="17" y2="5"/>
        <line stroke="#ddd" stroke-width="2" x1="15" y1="15" x2="7" y2="5"/>
    `
}

// Copy icon - two overlapping documents
const copy_icon_source = {
    width: 24,
    height: 24,
    data: `
        <rect fill="none" stroke="#ddd" stroke-width="2" x="8" y="8" width="12" height="14" rx="1"/>
        <path fill="none" stroke="#ddd" stroke-width="2" d="M4 16 L4 4 L14 4"/>
    `
}

// Paste icon - clipboard
const paste_icon_source = {
    width: 24,
    height: 24,
    data: `
        <rect fill="none" stroke="#ddd" stroke-width="2" x="5" y="4" width="14" height="18" rx="1"/>
        <rect fill="#ddd" x="8" y="2" width="8" height="4" rx="1"/>
        <line stroke="#ddd" stroke-width="1.5" x1="8" y1="11" x2="16" y2="11"/>
        <line stroke="#ddd" stroke-width="1.5" x1="8" y1="14" x2="16" y2="14"/>
        <line stroke="#ddd" stroke-width="1.5" x1="8" y1="17" x2="12" y2="17"/>
    `
}

await icon_dealer.importIcon({ type: 'folder', name: 'plc-icon-folder', image: `url('${ImageRenderer.renderSVG(folder_icon_source)}')` })
await icon_dealer.importIcon({ type: 'program', name: 'plc-icon-gears', image: `url('${ImageRenderer.renderSVG(program_icon_source)}')` })
await icon_dealer.importIcon({ type: 'symbols', name: 'plc-icon-symbols', image: `url('${ImageRenderer.renderSVG(symbols_icon_source)}')` })
await icon_dealer.importIcon({ type: 'setup', name: 'plc-icon-setup', image: `url('${ImageRenderer.renderSVG(setup_icon_source)}')` })
await icon_dealer.importIcon({ type: 'memory', name: 'plc-icon-memory', image: `url('${ImageRenderer.renderSVG(memory_icon_source)}')` })
await icon_dealer.importIcon({ type: 'add', name: 'plc-icon-add', image: `url('${ImageRenderer.renderSVG(plus_icon_source)}')` })
await icon_dealer.importIcon({ type: 'delete', name: 'plc-icon-delete', image: `url('${ImageRenderer.renderSVG(delete_icon_source)}')` })
await icon_dealer.importIcon({ type: 'download', name: 'plc-icon-download', image: `url('${ImageRenderer.renderSVG(download_icon_source)}')` })
await icon_dealer.importIcon({ type: 'upload', name: 'plc-icon-upload', image: `url('${ImageRenderer.renderSVG(upload_icon_source)}')` })
await icon_dealer.importIcon({ type: 'sidebar-project', name: 'plc-icon-sidebar-project', image: `url('${ImageRenderer.renderSVG(sidebar_project_icon_source)}')` })
await icon_dealer.importIcon({ type: 'sidebar-health', name: 'plc-icon-sidebar-health', image: `url('${ImageRenderer.renderSVG(sidebar_health_icon_source)}')` })
await icon_dealer.importIcon({ type: 'sidebar-watch', name: 'plc-icon-sidebar-watch', image: `url('${ImageRenderer.renderSVG(sidebar_watch_icon_source)}')` })
await icon_dealer.importIcon({ type: 'monitor', name: 'plc-icon-monitor', image: `url('${ImageRenderer.renderSVG(monitor_icon_source)}')` })
await icon_dealer.importIcon({ type: 'ladder-contact', name: 'plc-icon-ladder-contact', image: `url('${ImageRenderer.renderSVG(ladder_contact_icon_source)}')` })
await icon_dealer.importIcon({ type: 'ladder-coil', name: 'plc-icon-ladder-coil', image: `url('${ImageRenderer.renderSVG(ladder_coil_icon_source)}')` })
await icon_dealer.importIcon({ type: 'ladder-timer', name: 'plc-icon-ladder-timer', image: `url('${ImageRenderer.renderSVG(ladder_timer_icon_source)}')` })
await icon_dealer.importIcon({ type: 'ladder-counter', name: 'plc-icon-ladder-counter', image: `url('${ImageRenderer.renderSVG(ladder_counter_icon_source)}')` })
await icon_dealer.importIcon({ type: 'ladder-math', name: 'plc-icon-ladder-math', image: `url('${ImageRenderer.renderSVG(ladder_math_icon_source)}')` })
await icon_dealer.importIcon({ type: 'ladder-compare', name: 'plc-icon-ladder-compare', image: `url('${ImageRenderer.renderSVG(ladder_compare_icon_source)}')` })
await icon_dealer.importIcon({ type: 'ladder-move', name: 'plc-icon-ladder-move', image: `url('${ImageRenderer.renderSVG(ladder_move_icon_source)}')` })
await icon_dealer.importIcon({ type: 'project-properties', name: 'plc-icon-project-properties', image: `url('${ImageRenderer.renderSVG(project_properties_icon_source)}')` })
await icon_dealer.importIcon({ type: 'cut', name: 'plc-icon-cut', image: `url('${ImageRenderer.renderSVG(cut_icon_source)}')` })
await icon_dealer.importIcon({ type: 'copy', name: 'plc-icon-copy', image: `url('${ImageRenderer.renderSVG(copy_icon_source)}')` })
await icon_dealer.importIcon({ type: 'paste', name: 'plc-icon-paste', image: `url('${ImageRenderer.renderSVG(paste_icon_source)}')` })
