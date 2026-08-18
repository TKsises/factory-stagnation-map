// ============================================================
// 工場レイアウトの取り込み
//
// レイアウトアプリ（factory-layout-v2）が書き出す JSON を読む。
// 必要なのは「どの設備がどこにあるか」だけなので、要る部分だけ取り出す。
//
// ★外から入るデータなので、必ず normalizeLayout() を通す。
//   相手のアプリの型をそのまま信用しない（版が違えば形も違う）。
//
// ★外部システムとの対応づけは管理番号（code）で行う。
//   内部ID（i12 のような値）は配置のたびに変わるので、キーには使えない。
// ============================================================

/** 座標の単位はメートル。左上基準 */
export type LayoutItem = {
  id: string
  name: string
  /** 管理番号（例 EQ-001）。これだけが外部システムとの対応キー */
  code: string | null
  x: number
  y: number
  w: number
  h: number
  rot: number
  type: string
}

export type LayoutView = {
  items: LayoutItem[]
  /** グリッドの大きさ（m） */
  gridW: number
  gridH: number
  boundary: { x: number; y: number }[] | null
  /** 管理番号を持つ要素だけを集めたもの（対応表の選択肢に使う） */
  codedItems: LayoutItem[]
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** 0・負・NaN は既定に戻す。0サイズの要素は描画で潰れて掴めなくなる */
const posNum = (v: unknown, fallback: number): number => {
  const n = num(v, fallback)
  return n > 0 ? n : fallback
}

export function emptyLayout(): LayoutView {
  return { items: [], gridW: 40, gridH: 25, boundary: null, codedItems: [] }
}

/**
 * 外から来た何かを、必ず正しい形の LayoutView にする。
 * 壊れていても例外を投げない（読み込みでアプリが落ちないこと優先）。
 */
export function normalizeLayout(raw: unknown): LayoutView {
  const base = emptyLayout()
  if (!isObj(raw)) return base

  const rawItems: unknown[] = Array.isArray(raw.items) ? raw.items : []
  const items: LayoutItem[] = []
  const seen = new Set<string>()

  rawItems.forEach((r, index) => {
    if (!isObj(r)) return
    const type = str(r.type)
    if (type === '') return // 種類が無いものは描けないので捨てる

    // ID が重複していると、選択やハイライトで別の要素を掴む
    let id = str(r.id) || `x${index}`
    if (seen.has(id)) id = `${id}#${index}`
    seen.add(id)

    const rot = (((Math.round(num(r.rot, 0) / 90) * 90) % 360) + 360) % 360
    const code = str(r.code).trim()

    items.push({
      id,
      name: str(r.name) || type,
      code: code === '' ? null : code,
      x: num(r.x, 0),
      y: num(r.y, 0),
      w: posNum(r.w, 1),
      h: posNum(r.h, 1),
      rot,
      type,
    })
  })

  return {
    items,
    gridW: posNum(raw.gridW, base.gridW),
    gridH: posNum(raw.gridH, base.gridH),
    boundary: normalizeBoundary(raw.boundary),
    codedItems: items.filter(i => i.code !== null),
  }
}

function normalizeBoundary(raw: unknown): { x: number; y: number }[] | null {
  if (!Array.isArray(raw)) return null
  const pts = raw
    .filter(isObj)
    .map(p => ({ x: num(p.x, 0), y: num(p.y, 0) }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
  // 3点未満は多角形にならない
  return pts.length >= 3 ? pts : null
}

/** 要素の中心（メートル） */
export function itemCenter(item: LayoutItem): { x: number; y: number } {
  return { x: item.x + item.w / 2, y: item.y + item.h / 2 }
}

/** レイアウト全体が収まる範囲（メートル）。余白を少し足す */
export function layoutExtent(layout: LayoutView): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  if (layout.items.length === 0) {
    return { minX: 0, minY: 0, maxX: layout.gridW, maxY: layout.gridH }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const it of layout.items) {
    if (it.x < minX) minX = it.x
    if (it.y < minY) minY = it.y
    if (it.x + it.w > maxX) maxX = it.x + it.w
    if (it.y + it.h > maxY) maxY = it.y + it.h
  }
  for (const p of layout.boundary ?? []) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const pad = 2
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}
