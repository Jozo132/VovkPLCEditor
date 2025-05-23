// @ts-check
"use strict"

import { VovkPLCEditor } from "../../editor/Editor.js"
import { PLC_Symbol } from "../../utils/types.js"
import { RendererModule } from "../types.js"
import { resolveBlockState } from "./evaluator.js"
import { PLC_Ladder, PLC_LadderBlock } from "./language.js"



/** @typedef */
const memory_locations = [
    { short: 'C', name: 'control', label: 'Control' },
    { short: 'I', name: 'input', label: 'Input' },
    { short: 'Q', name: 'output', label: 'Output' },
    { short: 'M', name: 'memory', label: 'Memory' },
]

/** @type { PLC_Symbol[] } */
const system_symbols = [
    { name: 'P_100ms', location: 'control', type: 'bit', address: 2.0, initial_value: 0, comment: '100ms pulse' },
    { name: 'P_200ms', location: 'control', type: 'bit', address: 2.1, initial_value: 0, comment: '200ms pulse' },
    { name: 'P_300ms', location: 'control', type: 'bit', address: 2.2, initial_value: 0, comment: '300ms pulse' },
    { name: 'P_500ms', location: 'control', type: 'bit', address: 2.3, initial_value: 0, comment: '500ms pulse' },
    { name: 'P_1s', location: 'control', type: 'bit', address: 2.4, initial_value: 0, comment: '1 second pulse' },
    { name: 'P_2s', location: 'control', type: 'bit', address: 2.5, initial_value: 0, comment: '2 second pulse' },
    { name: 'P_5s', location: 'control', type: 'bit', address: 2.6, initial_value: 0, comment: '5 second pulse' },
    { name: 'P_10s', location: 'control', type: 'bit', address: 2.7, initial_value: 0, comment: '10 second pulse' },
    { name: 'P_30s', location: 'control', type: 'bit', address: 3.0, initial_value: 0, comment: '30 second pulse' },
    { name: 'P_1min', location: 'control', type: 'bit', address: 3.1, initial_value: 0, comment: '1 minute pulse' },
    { name: 'P_2min', location: 'control', type: 'bit', address: 3.2, initial_value: 0, comment: '2 minute pulse' },
    { name: 'P_5min', location: 'control', type: 'bit', address: 3.3, initial_value: 0, comment: '5 minute pulse' },
    { name: 'P_10min', location: 'control', type: 'bit', address: 3.4, initial_value: 0, comment: '10 minute pulse' },
    { name: 'P_15min', location: 'control', type: 'bit', address: 3.5, initial_value: 0, comment: '15 minute pulse' },
    { name: 'P_30min', location: 'control', type: 'bit', address: 3.6, initial_value: 0, comment: '30 minute pulse' },
    { name: 'P_1hr', location: 'control', type: 'bit', address: 3.7, initial_value: 0, comment: '1 hour pulse' },
    { name: 'P_2hr', location: 'control', type: 'bit', address: 4.0, initial_value: 0, comment: '2 hour pulse' },
    { name: 'P_3hr', location: 'control', type: 'bit', address: 4.1, initial_value: 0, comment: '3 hour pulse' },
    { name: 'P_4hr', location: 'control', type: 'bit', address: 4.2, initial_value: 0, comment: '4 hour pulse' },
    { name: 'P_5hr', location: 'control', type: 'bit', address: 4.3, initial_value: 0, comment: '5 hour pulse' },
    { name: 'P_6hr', location: 'control', type: 'bit', address: 4.4, initial_value: 0, comment: '6 hour pulse' },
    { name: 'P_12hr', location: 'control', type: 'bit', address: 4.5, initial_value: 0, comment: '12 hour pulse' },
    { name: 'P_1day', location: 'control', type: 'bit', address: 4.6, initial_value: 0, comment: '1 day pulse' },

    { name: 'S_100ms', location: 'control', type: 'bit', address: 5.0, initial_value: 0, comment: '100ms square wave' },
    { name: 'S_200ms', location: 'control', type: 'bit', address: 5.1, initial_value: 0, comment: '200ms square wave' },
    { name: 'S_300ms', location: 'control', type: 'bit', address: 5.2, initial_value: 0, comment: '300ms square wave' },
    { name: 'S_500ms', location: 'control', type: 'bit', address: 5.3, initial_value: 0, comment: '500ms square wave' },
    { name: 'S_1s', location: 'control', type: 'bit', address: 5.4, initial_value: 0, comment: '1 second square wave' },
    { name: 'S_2s', location: 'control', type: 'bit', address: 5.5, initial_value: 0, comment: '2 second square wave' },
    { name: 'S_5s', location: 'control', type: 'bit', address: 5.6, initial_value: 0, comment: '5 second square wave' },
    { name: 'S_10s', location: 'control', type: 'bit', address: 5.7, initial_value: 0, comment: '10 second square wave' },
    { name: 'S_30s', location: 'control', type: 'bit', address: 6.0, initial_value: 0, comment: '30 second square wave' },
    { name: 'S_1min', location: 'control', type: 'bit', address: 6.1, initial_value: 0, comment: '1 minute square wave' },
    { name: 'S_2min', location: 'control', type: 'bit', address: 6.2, initial_value: 0, comment: '2 minute square wave' },
    { name: 'S_5min', location: 'control', type: 'bit', address: 6.3, initial_value: 0, comment: '5 minute square wave' },
    { name: 'S_10min', location: 'control', type: 'bit', address: 6.4, initial_value: 0, comment: '10 minute square wave' },
    { name: 'S_15min', location: 'control', type: 'bit', address: 6.5, initial_value: 0, comment: '15 minute square wave' },
    { name: 'S_30min', location: 'control', type: 'bit', address: 6.6, initial_value: 0, comment: '30 minute square wave' },
    { name: 'S_1hr', location: 'control', type: 'bit', address: 6.7, initial_value: 0, comment: '1 hour square wave' },

    { name: 'elapsed_days', location: 'control', type: 'byte', address: 8.0, initial_value: 0, comment: 'Elapsed days' },
    { name: 'elapsed_hours', location: 'control', type: 'byte', address: 9.0, initial_value: 0, comment: 'Elapsed hours' },
    { name: 'elapsed_minutes', location: 'control', type: 'byte', address: 10.0, initial_value: 0, comment: 'Elapsed minutes' },
    { name: 'elapsed_seconds', location: 'control', type: 'byte', address: 11.0, initial_value: 0, comment: 'Elapsed seconds' },

    { name: 'system_uptime', location: 'control', type: 'dint', address: 12.0, initial_value: 0, comment: 'System uptime in seconds' },
]




/** @type {(editor: VovkPLCEditor, like: 'symbol' | 'highlight', ctx: CanvasRenderingContext2D , block: PLC_LadderBlock) => void} */
const draw_contact = (editor, like, ctx, block) => {
  // input state: the left side of the contact (green when true)
  // output state: the right side of the contact (green when true)
  // value: the inner state of the contact (green when true)
  const { ladder_block_width, ladder_block_height, style } = editor.properties
  const { line_width, highlight_width, color, highlight_color, highlight_sim_color, font, font_color, font_error_color } = style
  // block = getBlockState(editor, block) // TODO: Uncomment and fix
  // if (!block.state) throw new Error(`Block state not found: ${block.symbol}`)
  const { x, y, type, inverted, trigger, state } = block
  const symbol = state?.symbol
  // if (!symbol) throw new Error(`Symbol not found: ${block.symbol}`)
  // let value = symbol ? get_symbol_value(editor, symbol) : false // TODO: Uncomment and fix
  let value = false
  if (inverted) value = !value

  const x0 = x * ladder_block_width
  const y0 = y * ladder_block_height
  const x1 = x0 + ladder_block_width
  const y1 = y0 + ladder_block_height

  const x_mid = x0 + ladder_block_width / 2
  const y_mid = y0 + ladder_block_height / 2

  const cl = x0 + ladder_block_width * 2 / 5
  const cr = x0 + ladder_block_width * 3 / 5
  const ct = y0 + ladder_block_height * 1 / 3
  const cb = y0 + ladder_block_height * 2 / 3

  // console.log(`Drawing contact: ${block.symbol} at ${x}, ${y}`)

  //        Symbol Name
  //   --------|   |--------
  //      Location Address


  // Draw thick green line for the contact to symbolize the input state if true for the left and the right side of the contact
  if (like === 'highlight') {
    ctx.strokeStyle = editor.window_manager.active_device === 'simulation' ? highlight_sim_color : highlight_color
    ctx.lineWidth = highlight_width
    ctx.beginPath()
    if (state?.powered) {
      if (state.terminated_input) {
        ctx.moveTo(x0 + 1, y_mid - 12)
        ctx.lineTo(x0 + 1, y_mid + 12)
      }
      ctx.moveTo(x0, y_mid)
      ctx.lineTo(cl, y_mid)
    }

    const momentary = type === 'contact' && block.trigger !== 'normal'
    if (state?.powered && value && !momentary) {
      ctx.moveTo(cr, y_mid)
      ctx.lineTo(x1, y_mid)
    }
    if (value) {
      ctx.fillStyle = ctx.strokeStyle
      // Draw box inside the contact
      if (state?.powered) {
        ctx.roundRect(cl, ct, cr - cl, cb - ct, 2)
        ctx.fillRect(cl - 1, ct - 1, cr - cl + 2, cb - ct + 2)
      } else {
        ctx.fillRect(cl - 1, ct, cr - cl + 2, cb - ct)
      }
    }
    ctx.stroke()
    return
  }

  if (like === 'symbol') {
    ctx.strokeStyle = color
    ctx.lineWidth = line_width

    // Draw horizontal line from the left side of the contact
    ctx.beginPath()
    if (state?.terminated_input) {
      ctx.moveTo(x0 + 1, y_mid - 8)
      ctx.lineTo(x0 + 1, y_mid + 8)
    }
    ctx.moveTo(x0, y_mid)
    ctx.lineTo(cl, y_mid)
    ctx.moveTo(cr, y_mid)
    ctx.lineTo(x1, y_mid)

    // Draw vertical line for the contact
    if (inverted) {
      ctx.moveTo(cl, ct)
      ctx.lineTo(cl, cb)
      ctx.moveTo(cl, cb - 1)
      ctx.lineTo(cr, ct + 1)
      ctx.moveTo(cr, ct)
      ctx.lineTo(cr, cb)
    } else {
      ctx.moveTo(cl, ct)
      ctx.lineTo(cl, cb)
      ctx.moveTo(cr, ct)
      ctx.lineTo(cr, cb)
    }
    if (trigger !== 'normal') {
      ctx.moveTo(x_mid, ct)
      ctx.lineTo(x_mid, cb)
      if (trigger === 'rising' || trigger === 'change') {
        ctx.moveTo(x_mid - 4, ct + 4)
        ctx.lineTo(x_mid, ct)
        ctx.lineTo(x_mid + 4, ct + 4)
      }
      if (trigger === 'falling' || trigger === 'change') {
        ctx.moveTo(x_mid - 4, cb - 4)
        ctx.lineTo(x_mid, cb)
        ctx.lineTo(x_mid + 4, cb - 4)
      }
    }
    ctx.stroke()

    const short_location = symbol ? memory_locations.find(loc => loc.name === symbol.location)?.short || '?' : '?'

    // Draw the symbol name
    if (symbol) ctx.fillStyle = font_color
    else ctx.fillStyle = font_error_color
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(block.symbol, x_mid, ct - 13)
    if (symbol) ctx.fillText(`${short_location}${symbol.address.toFixed(1)}`, x_mid, cb + 13)
    return
  }

  throw new Error(`Invalid style: ${style}`)
}


/** @type {(editor: VovkPLCEditor, like: 'symbol' | 'highlight', ctx: CanvasRenderingContext2D, block: PLC_LadderBlock) => void} */
const draw_coil = (editor, like, ctx, block) => {
  // input state: the left side of the contact (green when true)
  // output state: the right side of the contact is equal to the input state
  // value: the inner state of the contact (green when true)
  const { ladder_block_width, ladder_block_height, style } = editor.properties
  const { line_width, highlight_width, color, highlight_color, highlight_sim_color, font, font_color, font_error_color } = style
  // block = getBlockState(editor, block) // TODO: Uncomment and fix
  // if (!block.state) throw new Error(`Block state not found: ${block.symbol}`)
  const { x, y, type, inverted, trigger, state } = block
  const symbol = state?.symbol
  // if (!symbol) throw new Error(`Symbol not found: ${block.symbol}`)
  // let value = symbol ? get_symbol_value(editor, symbol) : false
  let value = false
  if (inverted) value = !value

  const x0 = x * ladder_block_width
  const y0 = y * ladder_block_height
  const x1 = x0 + ladder_block_width
  const y1 = y0 + ladder_block_height

  const x_mid = x0 + ladder_block_width / 2
  const y_mid = y0 + ladder_block_height / 2

  const cl = x0 + ladder_block_width * 2 / 5
  const cr = x0 + ladder_block_width * 3 / 5
  const ct = y0 + ladder_block_height * 1 / 3
  const cb = y0 + ladder_block_height * 2 / 3

  // console.log(`Drawing coil: ${block.symbol} at ${x}, ${y}`)

  //        Symbol Name
  //   ---------O--------
  //      Location Address

  // The coil is a circle 

  // Draw thick green line for the contact to symbolize the input state if true for the left and the right side of the contact
  if (like === 'highlight') {
    ctx.strokeStyle = editor.window_manager.active_device === 'simulation' ? highlight_sim_color : highlight_color
    ctx.lineWidth = highlight_width
    ctx.beginPath()
    if (state?.powered) {
      ctx.moveTo(x0, y_mid)
      ctx.lineTo(cl, y_mid)
      ctx.moveTo(cr, y_mid)
      ctx.lineTo(x1, y_mid)
    }
    if (value) {
      ctx.fillStyle = ctx.strokeStyle
      // Draw circle inside the coil
      ctx.arc(x_mid, y_mid, (cr - cl) / 2, 0, Math.PI * 2)
      ctx.fill()
    }
    if (state?.terminated_output) {
      ctx.moveTo(x1 - 2, y_mid - 12)
      ctx.lineTo(x1 - 2, y_mid + 12)
    }
    if (state?.powered) {
      ctx.stroke()
    }
    return
  }

  if (like === 'symbol') {
    ctx.strokeStyle = color
    ctx.lineWidth = line_width

    // Draw horizontal line from the left side of the contact
    ctx.beginPath()

    ctx.moveTo(x0, y_mid)
    ctx.lineTo(cl, y_mid)
    ctx.moveTo(cr, y_mid)
    ctx.lineTo(x1, y_mid)

    // Draw circle for the coil
    ctx.arc(x_mid, y_mid, (cr - cl) / 2, 0, Math.PI * 2)


    if (state?.terminated_output) {
      ctx.moveTo(x1 - 2, y_mid - 8)
      ctx.lineTo(x1 - 2, y_mid + 8)
    }

    ctx.stroke()


    const short_location = symbol ? memory_locations.find(loc => loc.name === symbol.location)?.short || '?' : '?'

    // Draw the symbol name
    if (symbol) ctx.fillStyle = font_color
    else ctx.fillStyle = font_error_color
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(block.symbol, x_mid, ct - 13)
    if (symbol) ctx.fillText(`${short_location}${symbol.address.toFixed(1)}`, x_mid, cb + 13)

    ctx.fillStyle = color
    ctx.font = '18px Arial Black'
    if (type === 'coil_set') ctx.fillText('S', x_mid, y_mid + 1)
    if (type === 'coil_rset') ctx.fillText('R', x_mid, y_mid + 1)
    return
  }

  throw new Error(`Invalid style: ${style}`)
}


// Draw links between blocks

/** @typedef {{ from: PLC_LadderBlock , to: PLC_LadderBlock, powered: boolean }} LadderLink */
/** @type {(editor: VovkPLCEditor, like: 'symbol' | 'highlight', ctx: CanvasRenderingContext2D , link: LadderLink) => void} */
const draw_connection = (editor, like, ctx, link) => {
  // Draw a connection line from the output of the from block to the input of the to block
  // If the target block is bellow the source block, draw the vertical line first
  // If the target block is above the source block, draw the horizontal line first
  // If the target block is to the right, just draw a straight line
  const { ladder_block_width, ladder_block_height, style } = editor.properties
  const { line_width, highlight_width, highlight_color, highlight_sim_color, color } = style
  const { from, to, powered } = link
  const x0 = from.x * ladder_block_width + ladder_block_width
  const y0 = from.y * ladder_block_height + ladder_block_height / 2
  const x1 = to.x * ladder_block_width
  const y1 = to.y * ladder_block_height + ladder_block_height / 2

  const x_direction = x0 < x1 ? 1 : x0 > x1 ? -1 : 0
  const y_direction = y0 < y1 ? 1 : y0 > y1 ? -1 : 0
  if (x_direction === 0 && y_direction === 0) return // elements are touching, no need to draw a connection
  if (like === 'highlight') {
    if (powered) {
      ctx.strokeStyle = editor.window_manager.active_device === 'simulation' ? highlight_sim_color : highlight_color
      ctx.lineWidth = highlight_width
      ctx.beginPath()
      if (x_direction === 0) {
        if (y_direction > 0) ctx.moveTo(x0, y0 - 4)
        if (y_direction < 0) ctx.moveTo(x0, y0 + 4)
      } else {
        ctx.moveTo(x0, y0)
      }
      if (x_direction > 0) ctx.lineTo(x1, y0)
      if (y_direction > 0) ctx.lineTo(x1, y1 + 4)
      if (y_direction < 0) ctx.lineTo(x1, y1 - 4)
      ctx.stroke()
    }
    return
  }

  if (like === 'symbol') {
    ctx.strokeStyle = color
    ctx.lineWidth = line_width
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    // if (y0 < y1) ctx.lineTo(x0, y1)
    // if (y0 > y1)
    ctx.lineTo(x1, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    return
  }

  throw new Error(`Invalid style: ${style}`)
}

/** @type {(editor: VovkPLCEditor, ladder: PLC_Ladder) => void} */
const evaluate_ladder = (editor, ladder) => {
  const { blocks, connections } = ladder
  // Reset the state of all blocks and connections
  const blockHasInputConnection = (block) => connections.some(connection => connection.to.id === block.id)
  blocks.forEach(block => {
    // block = getBlockState(editor, block) // TODO: Uncomment and fix
    // if (!block.state) throw new Error(`Block state not found: ${block.symbol}`)
    if (!block.state) return // Block state not found, skip
    const { state, inverted } = block
    const symbol = state.symbol
    // if (!symbol) throw new Error(`Symbol not found: ${block.symbol}`)
    // let active = symbol ? !!get_symbol_value(editor, symbol) : false
    // let active = symbol ? !!get_symbol_value(editor, symbol) : false // TODO: Uncomment and fix
    let active = false
    if (inverted) active = !active
    state.active = active // The actual state of the block
    // All blocks that have no input are powered by the power rail
    // state.powered = !blockHasInputConnection(block)
    state.powered = block.type === 'contact' && block.x === 0
    state.evaluated = false
    block.state.terminated_input = false
    block.state.terminated_output = false
  })
  connections.forEach(con => {
    con.state = con.state || {
      powered: false,
      evaluated: false
    }
    con.state.powered = false
    con.state.evaluated = false
  })

  // const starting_blocks = blocks.filter(block => !blockHasInputConnection(block))
  const starting_blocks = blocks.filter(block => block.type === 'contact' && block.x === 0)
  starting_blocks.forEach(block => {
    // if (!block.state) throw new Error(`Block state not found: ${block.symbol}`)
    if (!block.state) return // Block state not found, skip
    block.state.terminated_input = true
  })
  const ending_blocks = blocks.filter(block => !connections.some(con => con.from.id === block.id))
  ending_blocks.forEach(block => {
    // if (!block.state) throw new Error(`Block state not found: ${block.symbol}`)
    if (!block.state) return // Block state not found, skip
    block.state.terminated_output = true
  })

  /** @type {(block: PLC_LadderBlock, first: boolean) => void} */
  const evaluate_powered_block = (block, first) => {
    // if (!block.state) throw new Error(`Block state not found: ${block.symbol}`)
    if (!block.state) return // Block state not found, skip
    if (block.state.evaluated) return
    const { state } = block
    const isContact = block.type === 'contact'
    const isCoil = ['coil', 'coil_set', 'coil_rset'].includes(block.type)
    const pass_through = isCoil && !first
    state.powered = isContact || (pass_through && !first)
    if (isCoil && first) return
    const momentary = block.trigger !== 'normal'
    if ((!momentary && state.active) || pass_through) {
      state.evaluated = true
      const outgoing_connections = connections.filter(con => con.from.id === block.id)
      outgoing_connections.forEach(con => {
        if (!con.state) throw new Error(`Connection state not found: ${con.from.id} -> ${con.to.id}`)
        const to_block = blocks.find(block => block.id === con.to.id)
        // if (!to_block) throw new Error(`Block not found: ${con.to.id}`)
        if (!to_block) return // Block not found, skip
        con.state.powered = true
        con.state.evaluated = true
        evaluate_powered_block(to_block, false)
      })
    }
  }

  starting_blocks.forEach(block => {
    evaluate_powered_block(block, true)
  })
}




/** @type { RendererModule } */
export const ladderRenderer = {
  id: 'ladder',

  render(editor, block) {
    if (block.type !== 'ladder') return
    const { div, props, blocks, connections } = block
    if (!props.ctx) {
      if (!div) throw new Error('Block div not found')
      const block_container = div.querySelector('.plc-program-block-code')
      if (!block_container) throw new Error('Block code not found')
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 600

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas context not found')
      props.ctx = ctx
      props.canvas = canvas
      block_container.appendChild(canvas)
    }
    const { ctx, canvas } = props

    if (!ctx) throw new Error('Canvas context not found')

    const scale = 1.4

    // Update canvas size based on the max block coordinates

    const ladder_block_width = editor.properties.ladder_block_width || 120
    const ladder_block_height = editor.properties.ladder_block_height || 80
    const ladder_blocks_per_row = editor.properties.ladder_blocks_per_row || 7
    const style = editor.properties.style || {
      background_color_alt: '#333',
      background_color_online: '#444',
      background_color_edit: '#666',
      color: '#000',
      highlight_color: '#3C3',
      highlight_sim_color: '#4AD',
      grid_color: '#FFF4',
      select_highlight_color: '#7AF',
      select_color: '#456',
      hover_color: '#456',
      font: '16px Consolas',
      font_color: '#DDD',
      font_error_color: '#FCC',
      line_width: 3,
      highlight_width: 8,
    }
    const {
      background_color_alt,
      background_color_online,
      background_color_edit,
      color,
      highlight_color,
      highlight_sim_color,
      grid_color,
      select_highlight_color,
      select_color,
      hover_color,
      font,
      font_color,
      font_error_color,
      line_width,
      highlight_width,
    } = style

    const minX = ladder_blocks_per_row
    const minY = 2
    const max_x = Math.max(minX, ...blocks.map(b => b.x))
    const max_y = Math.max(minY, ...blocks.map(b => b.y))

    const width = Math.max(max_x + 1, ladder_blocks_per_row) * ladder_block_width
    const height = (max_y + 1) * ladder_block_height
    canvas.style.width = (width / scale) + 'px';
    canvas.style.height = (height / scale) + 'px';
    canvas.width = width
    canvas.height = height

    const live = editor.device_manager.connected

    // Canvas fill background
    ctx.fillStyle = live ? background_color_online : background_color_edit
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // if (editor.program_block_selection.program_block === id) {
    //     ctx.fillStyle = style.select_color
    //     for (const selection of editor.program_block_selection.selection) {
    //         if (selection.type === 'block') {
    //             const { x, y } = selection
    //             ctx.fillRect(x * ladder_block_width, y * ladder_block_height, ladder_block_width, ladder_block_height)
    //         }
    //         if (selection.type === 'area') {
    //             const { x, y, width, height } = selection
    //             ctx.fillRect(x * ladder_block_width, y * ladder_block_height, width * ladder_block_width, height * ladder_block_height)
    //         }
    //     }
    // }

    // Draw grid
    ctx.strokeStyle = grid_color
    ctx.lineWidth = 0.5
    ctx.setLineDash([5, 5])
    ctx.lineDashOffset = 2.5
    ctx.beginPath()
    for (let x = 1; x < Math.max(max_x + 1, ladder_blocks_per_row); x++) {
      ctx.moveTo(x * ladder_block_width, 0)
      ctx.lineTo(x * ladder_block_width, canvas.height)
    }
    for (let y = 1; y < max_y + 1; y++) {
      ctx.moveTo(0, y * ladder_block_height)
      ctx.lineTo(canvas.width, y * ladder_block_height)
    }
    ctx.stroke()

    // Check if this ladder has a selection and highlight the first selected block origin
    // if (editor.program_block_selection.program_block === id) {
    //     const first_block = editor.program_block_selection.selection.find(s => s.type === 'block' || s.type === 'area')
    //     if (first_block) {
    //         const { x, y } = first_block
    //         ctx.strokeStyle = style.select_highlight_color
    //         ctx.lineWidth = 3
    //         ctx.beginPath()
    //         ctx.strokeRect(x * ladder_block_width, y * ladder_block_height, ladder_block_width, ladder_block_height)
    //         ctx.stroke()
    //     }
    // }

    ctx.setLineDash([])

    // manual_plc_cycle()

    // Draw the ladder blocks and connections
    evaluate_ladder(editor, block)

    // Draw the ladder
    blocks.forEach(block => {
      if (live) {
        if (block.type === 'contact') draw_contact(editor, 'highlight', ctx, block)
        if (['coil', 'coil_set', 'coil_rset'].includes(block.type)) draw_coil(editor, 'highlight', ctx, block)
      }
    })
    /** @type { LadderLink[] } */
    const links = []
    connections.forEach(con => {
      con.id = editor._generateID(con.id)
      const from = blocks.find(block => block.id === con.from.id)
      const to = blocks.find(block => block.id === con.to.id)
      // if (!from || !to) throw new Error(`Connection block not found`)
      if (from && to) links.push({ from, to, powered: !!con.state?.powered })
    })
    links.forEach(link => {
      if (live) {
        draw_connection(editor, 'highlight', ctx, link)
      }
    })


    blocks.forEach(block => {
      if (block.type === 'contact') draw_contact(editor, 'symbol', ctx, block)
      if (['coil', 'coil_set', 'coil_rset'].includes(block.type)) draw_coil(editor, 'symbol', ctx, block)
    })
    links.forEach(link => {
      draw_connection(editor, 'symbol', ctx, link)
    })
  }
}

export default ladderRenderer
