import { VovkPLCEditor } from "../../editor/Editor.js"
import { PLC_Symbol } from "../../utils/types.js"
import { RendererModule } from "../types.js"
import { resolveBlockState } from "./evaluator.js"
import { PLC_Ladder, PLC_LadderBlock } from "./language.js"
import { getSymbolValue, setSymbolBit } from "../BlockLogic.js"
import { ensureOffsets } from "../../utils/offsets.js"
import { Popup } from "../../editor/UI/Elements/components/popup.js"


/** @typedef */
const memory_locations = [
    { short: 'K', name: 'control', label: 'Control' },
    { short: 'C', name: 'counter', label: 'Counter' },
    { short: 'T', name: 'timer', label: 'Timer' },
    { short: 'X', name: 'input', label: 'Input' },
    { short: 'Y', name: 'output', label: 'Output' },
    { short: 'S', name: 'system', label: 'System' },
    { short: 'M', name: 'marker', label: 'Marker' },
    { short: 'M', name: 'memory', label: 'Marker' },
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


/**
 * Parse address string like X0.0, Y0.0, M10.5 into a synthetic symbol object
 * @param {string} addressStr 
 * @returns {PLC_Symbol | null}
 */
const parseAddressToSymbol = (addressStr) => {
  if (!addressStr || typeof addressStr !== 'string') return null
  
  const trimmed = addressStr.trim()
  
  // Pattern: Letter + Number (e.g., X0.0, Y0, M100.2)
  const match = trimmed.match(/^([kKcCtTxXyYsSmM])([0-9]+(?:\.[0-9]+)?)$/i)
  if (!match) return null
  
  const code = match[1].toUpperCase()
  const valStr = match[2]
  const val = parseFloat(valStr)
  
  // Map letter to location
  const locationMap = {
    'K': 'control',
    'C': 'counter', 
    'T': 'timer',
    'X': 'input',
    'Y': 'output',
    'S': 'system',
    'M': 'marker'
  }
  
  const location = locationMap[code] || 'marker'
  const hasBit = valStr.includes('.')
  const type = hasBit ? 'bit' : 'byte'
  
  return {
    name: addressStr,
    location,
    type,
    address: val,
    initial_value: 0,
    comment: `Direct address ${addressStr}`
  }
}

/**
 * Resolve block state with symbol lookup
 * @param {VovkPLCEditor} editor
 * @param {PLC_LadderBlock} block
 * @returns {PLC_LadderBlock}
 */
const getBlockState = (editor, block) => {
  if (!block.state) {
    // First try to find symbol by name in system symbols or project symbols
    let symbol = system_symbols.find(symbol => symbol.name === block.symbol)
      || editor.project?.symbols?.find(symbol => symbol.name === block.symbol)
    
    // If not found, try to parse as direct address (e.g., X0.0, Y0.0, M10.5)
    if (!symbol && block.symbol) {
      symbol = parseAddressToSymbol(block.symbol)
    }
    
    block.state = { active: false, powered: false, evaluated: false, symbol, terminated_input: false, terminated_output: false }
  }
  return block
}


/** @type {(editor: VovkPLCEditor, like: 'symbol' | 'highlight', ctx: CanvasRenderingContext2D , block: PLC_LadderBlock) => void} */
const draw_contact = (editor, like, ctx, block) => {
  // input state: the left side of the contact (green when true)
  // output state: the right side of the contact (green when true)
  // value: the inner state of the contact (green when true)
  const { ladder_block_width, ladder_block_height, style } = editor.properties
  const { line_width, highlight_width, color, highlight_color, highlight_sim_color, font, font_color, font_error_color } = style
  block = getBlockState(editor, block)
  if (!block.state) return // Block state not found, skip
  const { x, y, type, inverted, trigger, state } = block
  const symbol = state?.symbol
  let value = symbol ? !!getSymbolValue(editor, symbol) : false
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
  block = getBlockState(editor, block)
  if (!block.state) return // Block state not found, skip
  const { x, y, type, inverted, trigger, state } = block
  const symbol = state?.symbol
  let value = symbol ? !!getSymbolValue(editor, symbol) : false
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
    block = getBlockState(editor, block)
    if (!block.state) return // Block state not found, skip
    const { state, inverted } = block
    const symbol = state.symbol
    let active = symbol ? !!getSymbolValue(editor, symbol) : false
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
    block.blocks = block.blocks || []
    block.connections = block.connections || []
    const { div, props, blocks, connections } = block
    const ladderId = block.id

    const scale = 1.4
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

    // Initialize canvas if not already present
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

      // Initialize event handlers (only once)
      initializeEventHandlers(editor, block, canvas, style)

      // Initialize live monitoring system
      initializeLiveMonitoring(editor, block, canvas)
    }

    const { ctx, canvas } = props
    if (!ctx) throw new Error('Canvas context not found')

    const {
      background_color_online,
      background_color_edit,
      grid_color,
      select_color,
      select_highlight_color,
    } = style

    const edit = !editor.device_manager.connected
    const live = editor.device_manager.connected

    // Check if this ladder has selection
    const hasSelection = editor.ladder_selection?.ladder_id === ladderId
    const selection = hasSelection ? (editor.ladder_selection?.selection || []) : []

    const minX = ladder_blocks_per_row
    const minY = 2
    const max_x = Math.max(minX, ...blocks.map(b => b.x), ...(edit && hasSelection ? [1] : [0]))
    const max_y = Math.max(minY, ...blocks.map(b => b.y), ...(edit && hasSelection ? [1] : [0]))

    const width = Math.max(max_x + 1, ladder_blocks_per_row) * ladder_block_width
    const height = (max_y + 1) * ladder_block_height
    canvas.style.width = (width / scale) + 'px'
    canvas.style.height = (height / scale) + 'px'
    canvas.width = width
    canvas.height = height

    // Canvas fill background
    ctx.fillStyle = live ? background_color_online : background_color_edit
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw selection highlight
    if (hasSelection) {
      ctx.fillStyle = select_color
      for (const sel of selection) {
        if (sel.type === 'block') {
          const { x, y } = sel
          ctx.fillRect(x * ladder_block_width, y * ladder_block_height, ladder_block_width, ladder_block_height)
        }
        if (sel.type === 'area') {
          const { x, y, width: w, height: h } = sel
          ctx.fillRect(x * ladder_block_width, y * ladder_block_height, w * ladder_block_width, h * ladder_block_height)
        }
      }
    }

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
    if (hasSelection && selection.length > 0) {
      const first_block = selection.find(s => s.type === 'block' || s.type === 'area')
      if (first_block) {
        const { x, y } = first_block
        ctx.strokeStyle = select_highlight_color
        ctx.lineWidth = 3
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.strokeRect(x * ladder_block_width, y * ladder_block_height, ladder_block_width, ladder_block_height)
        ctx.stroke()
      }
    }

    ctx.setLineDash([])

    // Draw the ladder blocks and connections
    evaluate_ladder(editor, block)

    // Draw the ladder highlights (for live values)
    blocks.forEach(b => {
      if (live) {
        if (b.type === 'contact') draw_contact(editor, 'highlight', ctx, b)
        if (['coil', 'coil_set', 'coil_rset'].includes(b.type)) draw_coil(editor, 'highlight', ctx, b)
      }
    })

    /** @type { LadderLink[] } */
    const links = []
    connections.forEach(con => {
      con.id = editor._generateID(con.id)
      const from = blocks.find(b => b.id === con.from.id)
      const to = blocks.find(b => b.id === con.to.id)
      if (from && to) links.push({ from, to, powered: !!con.state?.powered })
    })

    links.forEach(link => {
      if (live) {
        draw_connection(editor, 'highlight', ctx, link)
      }
    })

    // Draw the ladder symbols
    blocks.forEach(b => {
      if (b.type === 'contact') draw_contact(editor, 'symbol', ctx, b)
      if (['coil', 'coil_set', 'coil_rset'].includes(b.type)) draw_coil(editor, 'symbol', ctx, b)
    })
    links.forEach(link => {
      draw_connection(editor, 'symbol', ctx, link)
    })
  }
}


/**
 * Initialize mouse and touch event handlers for ladder canvas
 * @param {VovkPLCEditor} editor
 * @param {any} ladder
 * @param {HTMLCanvasElement} canvas
 * @param {any} style
 */
function initializeEventHandlers(editor, ladder, canvas, style) {
  const ladderId = ladder.id

  // Helper to get current scale and block dimensions
  const getScale = () => 1.4
  const getBlockWidth = () => editor.properties.ladder_block_width || 120
  const getBlockHeight = () => editor.properties.ladder_block_height || 80

  // Initialize ladder_selection on editor if not present
  if (!editor.ladder_selection) {
    editor.ladder_selection = {
      ladder_id: null,
      program_id: null,
      origin: { x: 0, y: 0 },
      selection: []
    }
  }

  let is_dragging = false
  let is_moving = false
  let moving_elements = []
  let was_dragging = false
  let start_x = 0
  let start_y = 0
  let end_x = 0
  let end_y = 0
  let temp_x = 0
  let temp_y = 0

  /** @type { PLC_Symbol | undefined } */
  let selected_for_toggle = undefined

  /** @param { MouseEvent } event */
  const onMouseDown = (event) => {
    const rect = canvas.getBoundingClientRect()

    // Right click opens context menu, if no selection is chosen, select the block below the cursor
    if (event.button === 2) {
      const start_x = Math.floor(event.clientX - rect.left)
      const start_y = Math.floor(event.clientY - rect.top)
      const x_raw = start_x * getScale() / getBlockWidth()
      const y_raw = start_y * getScale() / getBlockHeight()
      const x = Math.floor(x_raw)
      const y = Math.floor(y_raw)

      const selected = editor.ladder_selection?.ladder_id === ladderId ? editor.ladder_selection.selection : []
      const element_is_not_selected = !selected.find(sel => sel.type === 'block' && sel.x === x && sel.y === y)
      if (selected.length === 0 || element_is_not_selected) {
        const block = ladder.blocks.find(b => b.x === x && b.y === y)
        if (block) {
          editor.ladder_selection = {
            ladder_id: ladderId,
            program_id: ladder.program_id || '',
            origin: { x, y },
            selection: [{ type: 'block', x, y }]
          }
        }
      }
      return
    }

    if (event.button !== 0) return
    event.preventDefault()
    is_dragging = true
    start_x = Math.floor(event.clientX - rect.left)
    start_y = Math.floor(event.clientY - rect.top)
    end_x = start_x
    end_y = start_y

    const x_raw = start_x * getScale() / getBlockWidth()
    const y_raw = start_y * getScale() / getBlockHeight()
    const x = Math.floor(x_raw)
    const y = Math.floor(y_raw)

    const distance_from_block_center_x = Math.abs(2 * (Math.abs(x_raw - x) - 0.5))
    const distance_from_block_center_y = Math.abs(2 * (Math.abs(y_raw - y) - 0.5))
    const distance_from_block_center = Math.sqrt(distance_from_block_center_x ** 2 + distance_from_block_center_y ** 2)
    const near_center = distance_from_block_center <= 0.5

    const ctrl = event.ctrlKey
    const shift = event.shiftKey
    const ctrl_or_shift = ctrl || shift

    const selected = editor.ladder_selection?.ladder_id === ladderId ? editor.ladder_selection.selection : []
    const exists = selected.find(sel =>
      (sel.type === 'block' && sel.x === x && sel.y === y) ||
      (sel.type === 'area' && x >= sel.x && x < sel.x + sel.width && y >= sel.y && y < sel.y + sel.height)
    )

    let click_move = false
    if (!ctrl_or_shift && near_center && !exists) {
      // Select current block and start moving it
      const block = ladder.blocks.find(b => b.x === x && b.y === y)
      if (block) {
        editor.ladder_selection = {
          ladder_id: ladderId,
          program_id: ladder.program_id || '',
          origin: { x, y },
          selection: [{ type: 'block', x, y }]
        }
        click_move = true
      }
    }

    if (exists || click_move) {
      is_moving = true
      const elements = [...new Set(editor.ladder_selection.selection.map(sel => {
        if (sel.type === 'block') {
          return ladder.blocks.find(b => b.x === sel.x && b.y === sel.y)
        }
        if (sel.type === 'area') {
          return ladder.blocks.filter(b => b.x >= sel.x && b.x < sel.x + sel.width && b.y >= sel.y && b.y < sel.y + sel.height)
        }
        return null
      }).flat().filter(Boolean))]
      moving_elements = elements
      temp_x = x
      temp_y = y
    }
  }

  /** @param { MouseEvent } event */
  const onMove = (event) => {
    event.preventDefault()
    if (!is_dragging) return

    const rect = canvas.getBoundingClientRect()
    end_x = Math.floor(event.clientX - rect.left)
    end_y = Math.floor(event.clientY - rect.top)

    const distance_x = Math.abs(end_x - start_x)
    const distance_y = Math.abs(end_y - start_y)
    const distance = Math.sqrt(distance_x ** 2 + distance_y ** 2)
    if (distance < 10) return // Don't start dragging until the distance is greater than 10

    if (is_moving) {
      // Move the selection
      const end_x_block = Math.floor(end_x * getScale() / getBlockWidth())
      const end_y_block = Math.floor(end_y * getScale() / getBlockHeight())
      let dx = end_x_block - temp_x
      let dy = end_y_block - temp_y
      temp_x = end_x_block
      temp_y = end_y_block
      const x = editor.ladder_selection.origin.x
      const y = editor.ladder_selection.origin.y
      if (dx + x < 0) dx = 0
      if (dy + y < 0) dy = 0

      const selected = editor.ladder_selection?.ladder_id === ladderId ? editor.ladder_selection.selection : []
      for (const sel of selected) {
        if (sel.type === 'block') {
          sel.x += dx
          sel.y += dy
        }
        if (sel.type === 'area') {
          sel.x += dx
          sel.y += dy
        }
      }
      editor.ladder_selection.origin.x += dx
      editor.ladder_selection.origin.y += dy

      moving_elements.forEach(b => {
        if (!b) return
        b.x += dx
        b.y += dy
      })
      // Trigger redraw after moving elements
      ladderRenderer.render(editor, ladder)
      return
    }

    const x = Math.floor(start_x * getScale() / getBlockWidth())
    const y = Math.floor(start_y * getScale() / getBlockHeight())
    const width = Math.max(Math.round(1 + (end_x - start_x) * getScale() / getBlockWidth()), 1)
    const height = Math.max(Math.round(1 + (end_y - start_y) * getScale() / getBlockHeight()), 1)

    // Update selection area
    const ctrl = event.ctrlKey
    const shift = event.shiftKey
    const ctrl_or_shift = ctrl || shift
    if (ctrl_or_shift && editor.ladder_selection?.ladder_id === ladderId) {
      const exists = editor.ladder_selection.selection.find(sel => sel.type === 'area' && sel.x === x && sel.y === y)
      if (exists && exists.type === 'area') {
        exists.width = width
        exists.height = height
      } else {
        if (editor.ladder_selection.origin.x > x) editor.ladder_selection.origin.x = x
        if (editor.ladder_selection.origin.y > y) editor.ladder_selection.origin.y = y
        editor.ladder_selection.selection.push({ type: 'area', x, y, width, height })
      }
    } else {
      editor.ladder_selection = {
        ladder_id: ladderId,
        program_id: ladder.program_id || '',
        origin: { x, y },
        selection: [{ type: 'area', x, y, width, height }]
      }
    }
    // Trigger redraw to show selection area
    ladderRenderer.render(editor, ladder)
  }

  const onRelease = () => {
    is_dragging = false
    was_dragging = true
  }

  /** @param { MouseEvent } event */
  const onClick = (event) => {
    if (is_moving) {
      is_moving = false
      // Could add connectTouchingBlocks here if that method exists
    }
    if (was_dragging) {
      was_dragging = false
      const distance_x = Math.abs(end_x - start_x)
      const distance_y = Math.abs(end_y - start_y)
      const distance = Math.sqrt(distance_x ** 2 + distance_y ** 2)
      if (distance > 10) return // Prevent click event after dragging
    }

    const x = Math.floor(event.offsetX * getScale() / getBlockWidth())
    const y = Math.floor(event.offsetY * getScale() / getBlockHeight())

    const ctrl = event.ctrlKey
    const shift = event.shiftKey
    const ctrl_or_shift = ctrl || shift
    if (ctrl_or_shift && editor.ladder_selection?.ladder_id === ladderId) {
      const exists = editor.ladder_selection.selection.some(sel => sel.type === 'block' && sel.x === x && sel.y === y)
      if (exists) {
        if (ctrl) {
          // Remove selected block
          editor.ladder_selection.selection = editor.ladder_selection.selection.filter(sel => !(sel.type === 'block' && sel.x === x && sel.y === y))
        }
      } else {
        if (editor.ladder_selection.origin.x > x) editor.ladder_selection.origin.x = x
        if (editor.ladder_selection.origin.y > y) editor.ladder_selection.origin.y = y
        editor.ladder_selection.selection.push({ type: 'block', x, y })
      }
    } else {
      if (editor.ladder_selection?.selection?.[0]?.type === 'area') {
        // Deselect the area selection first
        editor.ladder_selection = {
          ladder_id: ladderId,
          program_id: ladder.program_id || '',
          origin: { x, y },
          selection: []
        }
      } else {
        editor.ladder_selection = {
          ladder_id: ladderId,
          program_id: ladder.program_id || '',
          origin: { x, y },
          selection: [{ type: 'block', x, y }]
        }
      }
    }
    // Trigger redraw to show selection
    ladderRenderer.render(editor, ladder)
  }

  // Mouse event listeners
  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMove)
  canvas.addEventListener('mouseup', onRelease)
  canvas.addEventListener('click', onClick)

  // Touch event handlers
  let last_touched = {}

  canvas.addEventListener('touchstart', event => {
    const edit = !editor.device_manager.connected
    if (!edit) return
    const touch = event.touches[0]
    last_touched = {
      clientX: touch.clientX,
      clientY: touch.clientY
    }
    const mouse_event = new MouseEvent('mousedown', last_touched)
    onMouseDown(mouse_event)
  })

  canvas.addEventListener('touchmove', event => {
    const edit = !editor.device_manager.connected
    if (!edit) return
    if (!is_dragging) return
    event.preventDefault()
    const touch = event.touches[0]
    last_touched = {
      clientX: touch.clientX,
      clientY: touch.clientY
    }
    const mouse_event = new MouseEvent('mousemove', last_touched)
    onMove(mouse_event)
  })

  canvas.addEventListener('touchend', event => {
    const edit = !editor.device_manager.connected
    if (!edit) return
    event.preventDefault()
    last_touched = {}
    onRelease()
    is_moving = false
    was_dragging = false
    moving_elements = []
  })

  // Context menu integration
  if (editor.context_manager) {
    let contextMenuX = 0
    let contextMenuY = 0

    // @ts-ignore - canvas type and menu return type are compatible at runtime
    editor.context_manager.addListener({
      // @ts-ignore
      target: canvas,
      // @ts-ignore
      onOpen: (event) => {
        const rect = canvas.getBoundingClientRect()
        contextMenuX = Math.floor((event.clientX - rect.left) * getScale() / getBlockWidth())
        contextMenuY = Math.floor((event.clientY - rect.top) * getScale() / getBlockHeight())

        const selected = editor.ladder_selection?.ladder_id === ladderId ? editor.ladder_selection.selection : []
        const live = editor.device_manager.connected
        const edit = !live

        // Check if there's already a block at this position
        const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
        const has_element = blockAtPosition || ladder.blocks.find(b => selected.find(sel => sel.type === 'block' && sel.x === b.x && sel.y === b.y))
          || ladder.blocks.find(b => selected.find(sel => sel.type === 'area' && sel.x <= b.x && sel.x + sel.width > b.x && sel.y <= b.y && sel.y + sel.height > b.y))

        const state = has_element?.state
        const symbol = state?.symbol
        selected_for_toggle = symbol

        // Build menu items
        const menuItems = []

        // Live mode toggle options (only if there's a symbol)
        if (live && typeof symbol !== 'undefined') {
          menuItems.push(
            { type: 'item', name: 'toggle', label: 'Toggle' },
            { type: 'item', name: 'set_on', label: 'Set ON' },
            { type: 'item', name: 'set_off', label: 'Set OFF' },
            { type: 'separator' }
          )
        }

        // Edit mode: Insert submenu (only if no block at position)
        if (edit && !blockAtPosition) {
          menuItems.push(
            {
              type: 'submenu', name: 'insert', label: 'Insert', items: [
                { type: 'item', name: 'insert_contact', label: 'Contact (NO)' },
                { type: 'item', name: 'insert_contact_nc', label: 'Contact (NC)' },
                { type: 'separator' },
                { type: 'item', name: 'insert_coil', label: 'Coil' },
                { type: 'item', name: 'insert_coil_set', label: 'Coil (Set)' },
                { type: 'item', name: 'insert_coil_reset', label: 'Coil (Reset)' },
              ]
            },
            { type: 'separator' }
          )
        }

        // Edit mode: Modify existing block
        if (edit && blockAtPosition) {
          menuItems.push(
            { type: 'item', name: 'edit_symbol', label: 'Edit Symbol...' },
            { type: 'item', name: 'toggle_inverted', label: blockAtPosition.inverted ? 'Make Normal' : 'Make Inverted' },
            {
              type: 'submenu', name: 'change_trigger', label: 'Trigger Type', items: [
                { type: 'item', name: 'trigger_normal', label: 'Normal', className: blockAtPosition.trigger === 'normal' ? 'selected' : '' },
                { type: 'item', name: 'trigger_rising', label: 'Rising Edge', className: blockAtPosition.trigger === 'rising' ? 'selected' : '' },
                { type: 'item', name: 'trigger_falling', label: 'Falling Edge', className: blockAtPosition.trigger === 'falling' ? 'selected' : '' },
                { type: 'item', name: 'trigger_change', label: 'Any Change', className: blockAtPosition.trigger === 'change' ? 'selected' : '' },
              ]
            },
            { type: 'separator' }
          )
        }

        // Edit mode: Delete, Cut, Copy, Paste
        if (edit && (selected.length > 0 || blockAtPosition)) {
          menuItems.push(
            { type: 'item', name: 'delete', label: 'Delete' },
            { type: 'separator' },
            { type: 'item', name: 'cut', label: 'Cut' },
            { type: 'item', name: 'copy', label: 'Copy' }
          )
        }

        if (edit) {
          menuItems.push({ type: 'item', name: 'paste', label: 'Paste' })
        }

        menuItems.push(
          { type: 'separator' },
          { type: 'item', name: 'properties', label: 'Properties' }
        )

        return menuItems
      },
      onClose: (selected_action) => {
        const modify = ['toggle', 'set_on', 'set_off'].includes(selected_action)
        if (modify && typeof selected_for_toggle !== 'undefined') {
          const value = !!getSymbolValue(editor, selected_for_toggle)
          const new_value = selected_action === 'toggle' ? !value : selected_action === 'set_on' ? true : selected_action === 'set_off' ? false : value
          setSymbolBit(editor, selected_for_toggle, new_value)
        }

        // Handle insert actions
        if (selected_action?.startsWith('insert_')) {
          /** @type {any} */
          const newBlock = {
            id: editor._generateID(),
            x: contextMenuX,
            y: contextMenuY,
            type: 'contact',
            inverted: false,
            trigger: 'normal',
            symbol: ''
          }

          if (selected_action === 'insert_contact') {
            newBlock.type = 'contact'
            newBlock.inverted = false
          } else if (selected_action === 'insert_contact_nc') {
            newBlock.type = 'contact'
            newBlock.inverted = true
          } else if (selected_action === 'insert_coil') {
            newBlock.type = 'coil'
          } else if (selected_action === 'insert_coil_set') {
            newBlock.type = 'coil_set'
          } else if (selected_action === 'insert_coil_reset') {
            newBlock.type = 'coil_rset'
          }

          ladder.blocks.push(newBlock)

          // Select the new block
          editor.ladder_selection = {
            ladder_id: ladderId,
            program_id: ladder.program_id || '',
            origin: { x: contextMenuX, y: contextMenuY },
            selection: [{ type: 'block', x: contextMenuX, y: contextMenuY }]
          }

          // Prompt for symbol name
          // @ts-ignore - newBlock type is correct at runtime
          promptForSymbol(editor, newBlock, ladder)
        }

        // Handle trigger change
        if (selected_action?.startsWith('trigger_')) {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            const trigger = selected_action.replace('trigger_', '')
            // @ts-ignore
            blockAtPosition.trigger = trigger
          }
        }

        // Handle toggle inverted
        if (selected_action === 'toggle_inverted') {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            blockAtPosition.inverted = !blockAtPosition.inverted
          }
        }

        // Handle edit symbol
        if (selected_action === 'edit_symbol') {
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            promptForSymbol(editor, blockAtPosition, ladder)
          }
        }

        // Handle delete action
        if (selected_action === 'delete') {
          // First check if there's a block at the context menu position
          const blockAtPosition = ladder.blocks.find(b => b.x === contextMenuX && b.y === contextMenuY)
          if (blockAtPosition) {
            const idx = ladder.blocks.indexOf(blockAtPosition)
            if (idx >= 0) ladder.blocks.splice(idx, 1)
          }

          // Also delete selected blocks
          const sel = editor.ladder_selection?.selection || []
          sel.forEach(s => {
            if (s.type === 'block') {
              const idx = ladder.blocks.findIndex(b => b.x === s.x && b.y === s.y)
              if (idx >= 0) ladder.blocks.splice(idx, 1)
            }
            if (s.type === 'area') {
              ladder.blocks = ladder.blocks.filter(b => !(b.x >= s.x && b.x < s.x + s.width && b.y >= s.y && b.y < s.y + s.height))
            }
          })
          if (editor.ladder_selection) {
            editor.ladder_selection.selection = []
          }
        }

        // Trigger redraw after any context menu action
        ladderRenderer.render(editor, ladder)
      }
    })
  }
}


/**
 * Initialize live monitoring for ladder canvas - handles memory listeners and visibility
 * @param {VovkPLCEditor} editor
 * @param {any} ladder
 * @param {HTMLCanvasElement} canvas
 */
function initializeLiveMonitoring(editor, ladder, canvas) {
  const ladderId = ladder.id
  const props = ladder.props

  // Store monitoring state in props
  props._liveMonitor = {
    isVisible: true,
    wasConnected: false,
    registeredAddresses: new Map(), // Map<address, { size, callback }>
    updateTimer: null,
    lastSymbolsHash: null
  }

  const monitor = props._liveMonitor

  /**
   * Get all symbols used by ladder blocks and their memory addresses
   */
  const collectSymbolAddresses = () => {
    const addresses = new Map() // Map<baseAddress, { size, symbols: Set<symbol> }>
    const offsets = ensureOffsets(editor.project?.offsets || {})

    const blocks = ladder.blocks || []
    for (const block of blocks) {
      if (!block.symbol) continue

      // Find symbol from project or system symbols, or parse as direct address
      let symbol = system_symbols.find(s => s.name === block.symbol)
        || editor.project?.symbols?.find(s => s.name === block.symbol)
      
      // If not found, try to parse as direct address (e.g., X0.0, Y0.0)
      if (!symbol) {
        symbol = parseAddressToSymbol(block.symbol)
      }

      if (!symbol) continue

      // Calculate absolute address
      const locationKey = symbol.location === 'memory' ? 'marker' : symbol.location
      const baseOffset = offsets[locationKey]?.offset || 0
      const addrVal = parseFloat(String(symbol.address)) || 0
      const byteAddr = Math.floor(addrVal)
      const absoluteAddr = baseOffset + byteAddr

      // Determine size based on type
      const typeSizes = {
        bit: 1, bool: 1, byte: 1, u8: 1, i8: 1,
        int: 2, u16: 2, i16: 2, word: 2,
        dint: 4, u32: 4, i32: 4, real: 4, float: 4, dword: 4,
        u64: 8, i64: 8, f64: 8, lword: 8
      }
      const size = typeSizes[symbol.type || 'bit'] || 1

      // Group nearby addresses for efficient fetching
      if (!addresses.has(absoluteAddr)) {
        addresses.set(absoluteAddr, { size, symbols: new Set() })
      }
      const entry = addresses.get(absoluteAddr)
      entry.size = Math.max(entry.size, size)
      entry.symbols.add(symbol.name)
    }

    return addresses
  }

  /**
   * Create a hash of current symbols for change detection
   */
  const getSymbolsHash = () => {
    const blocks = ladder.blocks || []
    return blocks.map(b => b.symbol || '').sort().join('|')
  }

  /**
   * Register memory listeners with DataFetcher
   */
  const registerMemoryListeners = () => {
    // @ts-ignore - data_fetcher exists at runtime
    if (!editor.data_fetcher) return
    if (!monitor.isVisible) return

    // Unregister old listeners first
    unregisterMemoryListeners()

    const addresses = collectSymbolAddresses()
    if (addresses.size === 0) return

    // Register each address range with a callback that updates editor.memory
    for (const [addr, entry] of addresses) {
      const listenerId = `ladder-${ladderId}-${addr}`
      
      // Create callback that updates editor.memory and triggers re-render
      const onMemoryChange = (data) => {
        // Only process if visible and connected
        if (!monitor.isVisible) return
        if (!editor.device_manager?.connected) return
        if (!editor.window_manager?.isMonitoringActive?.()) return

        // Update editor.memory with the fetched data
        if (data && editor.memory) {
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
          for (let i = 0; i < bytes.length && (addr + i) < editor.memory.length; i++) {
            editor.memory[addr + i] = bytes[i]
          }
        }

        // Clear block state caches so values are re-read
        const blocks = ladder.blocks || []
        for (const block of blocks) {
          if (block.state) {
            block.state = undefined
          }
        }

        // Request re-render
        ladderRenderer.render(editor, ladder)
      }
      
      // @ts-ignore - data_fetcher exists at runtime
      editor.data_fetcher.register(listenerId, addr, entry.size, onMemoryChange)
      monitor.registeredAddresses.set(addr, { size: entry.size, callback: onMemoryChange, listenerId })
    }

    monitor.lastSymbolsHash = getSymbolsHash()
  }

  /**
   * Unregister all memory listeners
   */
  const unregisterMemoryListeners = () => {
    // @ts-ignore - data_fetcher exists at runtime
    if (!editor.data_fetcher) return

    for (const [addr, entry] of monitor.registeredAddresses) {
      // @ts-ignore - data_fetcher exists at runtime
      editor.data_fetcher.unregister(entry.listenerId, addr, entry.size, entry.callback)
    }
    monitor.registeredAddresses.clear()
  }

  /**
   * Update monitoring state based on connection and visibility
   */
  const updateMonitoringState = () => {
    const isConnected = !!editor.device_manager?.connected
    const isMonitoring = !!editor.window_manager?.isMonitoringActive?.()
    const shouldMonitor = isConnected && isMonitoring && monitor.isVisible

    // Check if symbols changed
    const currentHash = getSymbolsHash()
    const symbolsChanged = currentHash !== monitor.lastSymbolsHash

    if (shouldMonitor) {
      // Re-register if connection state changed or symbols changed
      if (!monitor.wasConnected || symbolsChanged) {
        registerMemoryListeners()
        // Trigger initial render when going online
        ladderRenderer.render(editor, ladder)
      }
    } else {
      // Unregister when not monitoring
      if (monitor.wasConnected || monitor.registeredAddresses.size > 0) {
        unregisterMemoryListeners()
        // Re-render to show offline state
        if (monitor.isVisible) {
          ladderRenderer.render(editor, ladder)
        }
      }
    }

    monitor.wasConnected = shouldMonitor
  }

  // Set up IntersectionObserver to detect visibility
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const wasVisible = monitor.isVisible
      monitor.isVisible = entry.isIntersecting

      if (monitor.isVisible && !wasVisible) {
        // Became visible - restart monitoring
        updateMonitoringState()
      } else if (!monitor.isVisible && wasVisible) {
        // Became hidden - stop monitoring
        unregisterMemoryListeners()
      }
    }
  }, { threshold: 0.1 })

  // @ts-ignore - canvas is valid for IntersectionObserver
  observer.observe(canvas)

  // Set up periodic check for connection/monitoring state changes
  monitor.updateTimer = setInterval(() => {
    if (monitor.isVisible) {
      updateMonitoringState()
    }
  }, 500)

  // Store cleanup function in props
  props._cleanupLiveMonitor = () => {
    observer.disconnect()
    if (monitor.updateTimer) {
      clearInterval(monitor.updateTimer)
      monitor.updateTimer = null
    }
    unregisterMemoryListeners()
  }

  // Initial state update
  updateMonitoringState()
}


/**
 * Prompt user to enter a symbol name for a ladder block
 * @param {VovkPLCEditor} editor
 * @param {PLC_LadderBlock} block
 * @param {any} ladder - The ladder block to re-render after symbol change
 */
async function promptForSymbol(editor, block, ladder) {
  const symbols = editor.project?.symbols || []
  const blockTypeLabels = {
    'contact': 'Contact',
    'coil': 'Coil',
    'coil_set': 'Coil (Set)',
    'coil_rset': 'Coil (Reset)'
  }
  const blockTypeLabel = blockTypeLabels[block.type] || block.type
  const currentSymbol = block.symbol || ''

  const result = await Popup.form({
    title: `Edit ${blockTypeLabel}`,
    description: 'Enter symbol name or direct address (e.g. X0.0, Y0.0, M10.5)',
    inputs: [
      { 
        name: 'symbol', 
        label: 'Symbol / Address', 
        type: 'text', 
        value: currentSymbol,
        placeholder: 'e.g. Start_Button or X0.0'
      }
    ],
    buttons: [
      { text: 'OK', value: 'ok' },
      { text: 'Cancel', value: 'cancel' }
    ]
  })

  if (result && result.symbol !== undefined) {
    block.symbol = result.symbol.trim()
    // Clear cached state so it gets re-resolved
    block.state = undefined
    // Re-render the ladder
    if (ladder) {
      ladderRenderer.render(editor, ladder)
    }
  }
}


export default ladderRenderer
