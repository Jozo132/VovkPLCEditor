// @ts-check
"use strict"

import { ImageRenderer, importCSSCode } from "../../../../utils/tools.js"

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

const folder_icon_source ={
    width: 12,
    height: 12,
    data: `
        <path fill="#FF0" d="M1,1 L4,1 L6,2 L11,2 L12,3 L12,11 L11,12 L1,12 L0,11 L0,2 L1,1 Z" />
        <path fill="#AA0" d="M1,1 L4,1 L6,2 L4,3 L0,3 L0,2 L1,1 Z" />
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

const folder_icon_svg = ImageRenderer.renderSVGImage(folder_icon_source)
export const folder_icon = folder_icon_svg.outerHTML

// Round gear icon with 6 teeth in blue color
const program_icon_svg = ImageRenderer.renderSVGImage(program_icon_source)
export const program_icon = program_icon_svg.outerHTML


export const folder_icon_url = `url('${ImageRenderer.renderSVG(folder_icon_source)}')`
export const program_icon_url = `url('${ImageRenderer.renderSVG(program_icon_source)}')`

// Import icons into CSS
await importCSSCode(/*CSS*/`
    :root {
        --plc-folder-icon: ${folder_icon_url};
        --plc-program-icon: ${program_icon_url};
    }
    
    .plc-icon-folder::before { background-image: var(--plc-folder-icon); }
    .plc-icon-gears::before { background-image: var(--plc-program-icon); }
`)

/** @type { (type: string) => string } */
export const getIconType = (type) => {
    if (type === 'folder') return 'plc-icon-folder'
    if (type === 'program') return 'plc-icon-gears'
    return ''
}