// @ts-check
"use strict"

import { RendererModule } from "../types.js"
import { resolveBlockState } from "./evaluator.js"

/** @type { RendererModule } */
export const ladderRenderer = {
  id: 'ladder',

  render(editor, ctx, block) {
    if (block.type !== 'ladder') return
    const { blocks, connections } = block
    const gridSize = 80

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.font = '14px Consolas'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    for (const blk of blocks) {
      resolveBlockState(editor, blk)
      const { x, y, symbol, type } = blk
      const px = x * gridSize
      const py = y * gridSize
      const powered = blk.state?.powered
      ctx.strokeStyle = powered ? '#0F0' : '#AAA'
      ctx.fillStyle = powered ? '#0F0' : '#DDD'

      if (type === 'contact') {
        ctx.strokeRect(px, py, 40, 20)
        ctx.fillText(symbol, px + 45, py + 10)
      } else if (type.startsWith('coil')) {
        ctx.beginPath()
        ctx.arc(px + 20, py + 10, 10, 0, 2 * Math.PI)
        ctx.stroke()
        ctx.fillText(symbol, px + 35, py + 10)
      }
    }

    for (const c of connections) {
      const from = blocks.find(b => b.id === c.from.id)
      const to = blocks.find(b => b.id === c.to.id)
      if (!from || !to) continue

      const x0 = from.x * gridSize + 40
      const y0 = from.y * gridSize + 10
      const x1 = to.x * gridSize
      const y1 = to.y * gridSize + 10
      ctx.strokeStyle = c.state?.powered ? '#0F0' : '#888'
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
    }
  }
}

export default ladderRenderer
