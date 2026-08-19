// ============================================================
// 滞留マップの配置と形
//
// ★描画先は「SVG（画面）」と「Canvas（書き出し画像）」の2系統ある。
//   形をそれぞれで書くと、片方だけ古くなって
//   「画面では山なのに、書き出した画像では別の形」になる。
//   だから配置も形もこのファイルだけが持ち、両方がここを使う。
//
// ★横に伸ばさない。
//   工程が26個あると幅6,766pxになり、実データでは画面外まで一直線に伸びた。
//   読める大きさを保ったまま「折り返す」。行は蛇行させて、流れが目で追えるようにする。
// ============================================================

export const MAP = {
  boxW: 132,
  boxH: 58,
  /** 工程と工程の間（ここに山が立つ） */
  gapW: 122,
  /** 山の最大の高さ */
  peakMax: 72,
  /** 行と行の間（折り返しの渡り） */
  rowGap: 86,
  /** 上の余白（山とラベルのぶん） */
  padTop: 104,
  padX: 8,
  padBottom: 20,
} as const

export type FlowNode = { code: string; name: string }

/** 箱の位置（左上） */
export type NodeBox = {
  code: string
  name: string
  x: number
  y: number
  row: number
  col: number
  /** その行で最後の箱か（折り返しの渡りを描くため） */
  lastInRow: boolean
}

/** 工程と工程のつなぎ。同じ行の隣どうしか、行をまたぐ渡りか */
export type LinkSlot = {
  key: string
  fromCode: string
  toCode: string
  kind: 'inline' | 'wrap'
  /** 山を立てる中心（inline のとき） */
  cx: number
  /** 箱の縦中央。つなぎ線の高さ */
  cy: number
  /** wrap のときの経路 */
  path?: { fromX: number; fromY: number; toX: number; toY: number }
}

export type MapLayout = {
  width: number
  height: number
  perRow: number
  rows: number
  boxes: NodeBox[]
  links: LinkSlot[]
  byCode: Map<string, NodeBox>
}

/** 箱の縦中央（その行の） */
function rowCenterY(row: number): number {
  return MAP.padTop + row * (MAP.boxH + MAP.rowGap) + MAP.boxH / 2
}

/**
 * 工程を「読める大きさのまま折り返して」並べる。
 * maxWidth に収まる数だけ1行に置き、次の行は逆向きに進める（蛇行）。
 */
export function layoutMap(nodes: FlowNode[], maxWidth: number): MapLayout {
  const unit = MAP.boxW + MAP.gapW
  const usable = Math.max(unit, maxWidth - MAP.padX * 2)
  // 1行に何個置けるか。最低2個は置く（1個ずつだと流れに見えない）
  const perRow = Math.max(2, Math.floor((usable + MAP.gapW) / unit))
  const rows = Math.max(1, Math.ceil(nodes.length / perRow))
  const cols = Math.min(nodes.length, perRow)

  const boxes: NodeBox[] = nodes.map((n, i) => {
    const row = Math.floor(i / perRow)
    const idxInRow = i % perRow
    const countInRow = Math.min(perRow, nodes.length - row * perRow)
    // 偶数行は左→右、奇数行は右→左（蛇行）
    const col = row % 2 === 0 ? idxInRow : countInRow - 1 - idxInRow
    return {
      code: n.code,
      name: n.name,
      x: MAP.padX + col * unit,
      y: MAP.padTop + row * (MAP.boxH + MAP.rowGap),
      row,
      col,
      lastInRow: idxInRow === countInRow - 1,
    }
  })

  const byCode = new Map(boxes.map(b => [b.code, b]))

  const links: LinkSlot[] = []
  for (let i = 0; i < boxes.length - 1; i++) {
    const a = boxes[i]
    const b = boxes[i + 1]
    const key = `${a.code}→${b.code}`
    const cy = rowCenterY(a.row)

    if (a.row === b.row) {
      // 同じ行：箱と箱のあいだに山を立てる
      const left = Math.min(a.x, b.x) + MAP.boxW
      links.push({ key, fromCode: a.code, toCode: b.code, kind: 'inline', cx: left + MAP.gapW / 2, cy })
    } else {
      // 行をまたぐ：下へ回り込む渡り
      const fromX = a.col === 0 ? a.x : a.x + MAP.boxW
      const toX = b.col === 0 ? b.x : b.x + MAP.boxW
      links.push({
        key,
        fromCode: a.code,
        toCode: b.code,
        kind: 'wrap',
        cx: (fromX + toX) / 2,
        cy,
        path: { fromX, fromY: cy, toX, toY: rowCenterY(b.row) },
      })
    }
  }

  return {
    width: MAP.padX * 2 + cols * MAP.boxW + Math.max(0, cols - 1) * MAP.gapW,
    height: MAP.padTop + rows * MAP.boxH + (rows - 1) * MAP.rowGap + MAP.padBottom,
    perRow,
    rows,
    boxes,
    links,
    byCode,
  }
}

/** 滞留の大きさ（0〜1）から山の高さと幅を出す */
export function humpSize(ratio: number): { height: number; width: number } {
  const r = Math.max(0, Math.min(1, ratio))
  return {
    height: Math.max(10, r * MAP.peakMax),
    // 太さも滞留の大きさに応じて変える（細い山＝小さい滞留）
    width: MAP.gapW * (0.62 + 0.3 * r),
  }
}

/**
 * 山の輪郭。つなぎ線の上に乗る左右対称のなだらかな形。
 * SVG も Canvas もこの点列から描く。
 */
export type HumpShape = {
  start: [number, number]
  curve1: [number, number, number, number, number, number]
  curve2: [number, number, number, number, number, number]
  baseY: number
  peakY: number
}

export function humpShape(cx: number, baseY: number, width: number, height: number): HumpShape {
  const half = width / 2
  const top = baseY - height
  return {
    start: [cx - half, baseY],
    curve1: [cx - half * 0.45, baseY, cx - half * 0.4, top, cx, top],
    curve2: [cx + half * 0.4, top, cx + half * 0.45, baseY, cx + half, baseY],
    baseY,
    peakY: top,
  }
}

/** SVG の path 用 */
export function humpPathD(s: HumpShape): string {
  const [sx, sy] = s.start
  const [a1, a2, a3, a4, a5, a6] = s.curve1
  const [b1, b2, b3, b4, b5, b6] = s.curve2
  return `M ${sx} ${sy} C ${a1} ${a2} ${a3} ${a4} ${a5} ${a6} C ${b1} ${b2} ${b3} ${b4} ${b5} ${b6} Z`
}

/** Canvas 用。呼び出し側で fill/stroke する */
export function traceHump(ctx: CanvasRenderingContext2D, s: HumpShape): void {
  const [sx, sy] = s.start
  const [a1, a2, a3, a4, a5, a6] = s.curve1
  const [b1, b2, b3, b4, b5, b6] = s.curve2
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.bezierCurveTo(a1, a2, a3, a4, a5, a6)
  ctx.bezierCurveTo(b1, b2, b3, b4, b5, b6)
  ctx.closePath()
}

/** 行をまたぐ渡りの経路（下に回り込む） */
export function wrapPathD(p: NonNullable<LinkSlot['path']>): string {
  const dip = p.fromY + MAP.boxH / 2 + MAP.rowGap * 0.45
  return `M ${p.fromX} ${p.fromY} C ${p.fromX + 40} ${dip} ${p.toX + 40} ${dip} ${p.toX} ${p.toY}`
}

export function traceWrap(
  ctx: CanvasRenderingContext2D,
  p: NonNullable<LinkSlot['path']>
): void {
  const dip = p.fromY + MAP.boxH / 2 + MAP.rowGap * 0.45
  ctx.beginPath()
  ctx.moveTo(p.fromX, p.fromY)
  ctx.bezierCurveTo(p.fromX + 40, dip, p.toX + 40, dip, p.toX, p.toY)
}

/** 工程を飛ばした流れの弧。箱の下に描く */
export function skipArc(
  from: NodeBox,
  to: NodeBox
): { from: [number, number]; ctrl: [number, number]; to: [number, number] } {
  const y = from.y + MAP.boxH
  const x1 = from.x + MAP.boxW / 2
  const x2 = to.x + MAP.boxW / 2
  return {
    from: [x1, y],
    ctrl: [(x1 + x2) / 2, y + MAP.rowGap * 0.5],
    to: [x2, to.y + MAP.boxH],
  }
}
