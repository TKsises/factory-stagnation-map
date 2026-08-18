// ============================================================
// レイアウト図の座標変換と形
//
// ★描画先は SVG（画面）と Canvas（書き出し画像）の2系統。
//   ここだけが「メートル → 画面座標」の変換と形を持つ。
// ============================================================

import { layoutExtent, type LayoutItem, type LayoutView } from '../domain/layout'
import type { Pt, StagnationBand } from '../domain/layoutLink'

export type LayoutTransform = {
  /** 1メートルが何ピクセルか */
  pxPerM: number
  offsetX: number
  offsetY: number
  width: number
  height: number
  toPx: (p: Pt) => Pt
}

/** レイアウト全体が指定の幅・高さに収まる変換を作る */
export function fitLayout(
  layout: LayoutView,
  maxWidth: number,
  maxHeight: number
): LayoutTransform {
  const e = layoutExtent(layout)
  const wM = Math.max(1, e.maxX - e.minX)
  const hM = Math.max(1, e.maxY - e.minY)
  const pxPerM = Math.min(maxWidth / wM, maxHeight / hM)

  const width = wM * pxPerM
  const height = hM * pxPerM
  const offsetX = -e.minX * pxPerM
  const offsetY = -e.minY * pxPerM

  return {
    pxPerM,
    offsetX,
    offsetY,
    width,
    height,
    toPx: (p: Pt) => ({ x: p.x * pxPerM + offsetX, y: p.y * pxPerM + offsetY }),
  }
}

export type Rect = { x: number; y: number; w: number; h: number }

export function itemRect(item: LayoutItem, t: LayoutTransform): Rect {
  return {
    x: item.x * t.pxPerM + t.offsetX,
    y: item.y * t.pxPerM + t.offsetY,
    w: item.w * t.pxPerM,
    h: item.h * t.pxPerM,
  }
}

/**
 * 帯の経路。直線だと重なって見分けがつかないので、
 * 中点を垂直方向にずらした曲線にする。ずらす量は本数と順番で変える。
 */
export function bandCurve(
  band: StagnationBand,
  t: LayoutTransform,
  index: number,
  total: number
): { from: Pt; ctrl: Pt; to: Pt } {
  const from = t.toPx(band.from)
  const to = t.toPx(band.to)

  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1

  // 経路の中点から、直交方向へずらす
  const spread = total <= 1 ? 0 : (index - (total - 1) / 2) * 26
  const bow = len * 0.16 + Math.abs(spread)
  const nx = -dy / len
  const ny = dx / len
  const shift = spread === 0 ? bow : spread + Math.sign(spread) * len * 0.08

  return {
    from,
    ctrl: { x: (from.x + to.x) / 2 + nx * shift, y: (from.y + to.y) / 2 + ny * shift },
    to,
  }
}

/** 曲線上の点（ラベルを置く位置に使う）。2次ベジェの t=0.5 */
export function curveMidpoint(c: { from: Pt; ctrl: Pt; to: Pt }): Pt {
  return {
    x: 0.25 * c.from.x + 0.5 * c.ctrl.x + 0.25 * c.to.x,
    y: 0.25 * c.from.y + 0.5 * c.ctrl.y + 0.25 * c.to.y,
  }
}

/** SVG の path 用 */
export function bandPathD(c: { from: Pt; ctrl: Pt; to: Pt }): string {
  return `M ${c.from.x} ${c.from.y} Q ${c.ctrl.x} ${c.ctrl.y} ${c.to.x} ${c.to.y}`
}

/** Canvas 用。呼び出し側で stroke する */
export function traceBand(
  ctx: CanvasRenderingContext2D,
  c: { from: Pt; ctrl: Pt; to: Pt }
): void {
  ctx.beginPath()
  ctx.moveTo(c.from.x, c.from.y)
  ctx.quadraticCurveTo(c.ctrl.x, c.ctrl.y, c.to.x, c.to.y)
}

/** 要素の種類ごとの色。設備は濃く、構造物は薄く */
export function itemFill(type: string): { fill: string; stroke: string } {
  switch (type) {
    case 'machine':
    case 'robot':
    case 'inspect':
      return { fill: '#e5eaf0', stroke: '#8c9bab' }
    case 'shelf':
    case 'pallet':
      return { fill: '#f2ecdd', stroke: '#c2b48d' }
    case 'aisle':
      return { fill: '#f7f8fa', stroke: '#e0e4e9' }
    case 'wall':
    case 'pillar':
      return { fill: '#d5d9de', stroke: '#a9b0b8' }
    case 'dock':
    case 'shutter':
      return { fill: '#e3eee6', stroke: '#95b7a1' }
    default:
      return { fill: '#eceff2', stroke: '#b3bcc6' }
  }
}
