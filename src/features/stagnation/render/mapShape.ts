// ============================================================
// 滞留マップの形と寸法
//
// ★描画先は「SVG（画面）」と「Canvas（書き出し画像）」の2系統ある。
//   形をそれぞれで書くと、片方だけ古くなって
//   「画面では山なのに、書き出した画像では別の形」になる。
//   だから寸法と形はこのファイルだけが持ち、両方がここを使う。
// ============================================================

export const MAP = {
  boxW: 116,
  boxH: 54,
  gapW: 150,
  /** 山の最大の高さ */
  peakMax: 104,
  /** 山の裾＝基準線 */
  baseY: 126,
  /** 工程を飛ばした流れを描く帯の高さ */
  skipLane: 62,
} as const

export const MAP_BOX_Y = MAP.baseY + 6
export const MAP_BASE_HEIGHT = MAP_BOX_Y + MAP.boxH + 30

/** 工程の数から地図の幅を出す */
export function mapWidth(nodeCount: number): number {
  return nodeCount * MAP.boxW + Math.max(0, nodeCount - 1) * MAP.gapW
}

export function mapHeight(hasSkipping: boolean): number {
  return MAP_BASE_HEIGHT + (hasSkipping ? MAP.skipLane : 0)
}

/** i 番目の工程の箱の左端 */
export function boxLeft(index: number): number {
  return index * (MAP.boxW + MAP.gapW)
}

/** i 番目の工程の箱の中心 */
export function boxCenter(index: number): number {
  return boxLeft(index) + MAP.boxW / 2
}

/** i 番目と i+1 番目の工程の「間」の中心 */
export function gapCenter(index: number): number {
  return (index + 1) * MAP.boxW + index * MAP.gapW + MAP.gapW / 2
}

/** 滞留の大きさ（0〜1）から山の高さと幅を出す */
export function humpSize(ratio: number): { height: number; width: number } {
  return {
    height: Math.max(8, ratio * MAP.peakMax),
    // 太さも滞留の大きさに応じて変える（細い山＝小さい滞留）
    width: MAP.gapW * (0.5 + 0.34 * ratio),
  }
}

/**
 * 山の輪郭。左右対称のなだらかな形を3次ベジェ2本で作る。
 * SVG も Canvas もこの点列から描く。
 */
export type HumpShape = {
  start: [number, number]
  curve1: [number, number, number, number, number, number]
  curve2: [number, number, number, number, number, number]
}

export function humpShape(cx: number, width: number, height: number): HumpShape {
  const half = width / 2
  const base = MAP.baseY
  const top = base - height
  return {
    start: [cx - half, base],
    curve1: [cx - half * 0.45, base, cx - half * 0.4, top, cx, top],
    curve2: [cx + half * 0.4, top, cx + half * 0.45, base, cx + half, base],
  }
}

/** SVG の path 用 */
export function humpPathD(shape: HumpShape): string {
  const [sx, sy] = shape.start
  const [a1, a2, a3, a4, a5, a6] = shape.curve1
  const [b1, b2, b3, b4, b5, b6] = shape.curve2
  return `M ${sx} ${sy} C ${a1} ${a2} ${a3} ${a4} ${a5} ${a6} C ${b1} ${b2} ${b3} ${b4} ${b5} ${b6} Z`
}

/** Canvas 用。呼び出し側で fill/stroke する */
export function traceHump(ctx: CanvasRenderingContext2D, shape: HumpShape): void {
  const [sx, sy] = shape.start
  const [a1, a2, a3, a4, a5, a6] = shape.curve1
  const [b1, b2, b3, b4, b5, b6] = shape.curve2
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.bezierCurveTo(a1, a2, a3, a4, a5, a6)
  ctx.bezierCurveTo(b1, b2, b3, b4, b5, b6)
  ctx.closePath()
}

/** 工程を飛ばした流れの弧。基準線の下に描く */
export function skipArc(x1: number, x2: number): { from: [number, number]; ctrl: [number, number]; to: [number, number] } {
  const y0 = MAP_BOX_Y + MAP.boxH
  const dip = y0 + MAP.skipLane * 0.72 + 14
  return { from: [x1, y0], ctrl: [(x1 + x2) / 2, dip], to: [x2, y0] }
}

export function skipLabelY(): number {
  return MAP_BOX_Y + MAP.boxH + MAP.skipLane * 0.72 + 2
}
