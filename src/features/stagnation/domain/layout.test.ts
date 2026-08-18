import { describe, expect, it } from 'vitest'
import { buildRawTable } from './csv'
import { computeGaps } from './gaps'
import { itemCenter, layoutExtent, normalizeLayout } from './layout'
import { bandWidth, buildBands, hasNoLinks } from './layoutLink'
import { buildLots } from './lots'
import { guessMapping } from './mapping'
import { computeMetrics } from './metrics'
import { DEFAULT_CALENDAR } from './types'

const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

// レイアウトアプリが書き出す JSON の形（LayoutDoc をそのまま stringify したもの）
const DOC = {
  version: 1,
  items: [
    { id: 'i1', type: 'machine', name: '鋳造機', x: 0, y: 0, w: 4, h: 3, rot: 0, code: 'EQ-001' },
    { id: 'i2', type: 'machine', name: 'MC前半', x: 20, y: 0, w: 4, h: 3, rot: 90, code: 'EQ-002' },
    { id: 'i3', type: 'machine', name: '塗装', x: 20, y: 20, w: 4, h: 3, rot: 0, code: 'EQ-003' },
    { id: 'i4', type: 'shelf', name: '棚', x: 8, y: 8, w: 2, h: 1, rot: 0 },
  ],
  connections: [],
  gridW: 40,
  gridH: 25,
  boundary: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 25 },
    { x: 0, y: 25 },
  ],
  catalog: [],
  clip: false,
  layers: {},
  seq: 4,
}

describe('normalizeLayout ― 外から来た JSON を安全に読む', () => {
  const v = normalizeLayout(DOC)

  it('要素を読める', () => {
    expect(v.items).toHaveLength(4)
    expect(v.items[0].name).toBe('鋳造機')
    expect(v.gridW).toBe(40)
  })

  it('管理番号を持つ要素だけを別に集める（対応表の選択肢になる）', () => {
    expect(v.codedItems.map(i => i.code)).toEqual(['EQ-001', 'EQ-002', 'EQ-003'])
  })

  it('管理番号が無い要素は code を null にする（空文字にしない）', () => {
    expect(v.items[3].code).toBeNull()
  })

  it('工場範囲を読める', () => {
    expect(v.boundary).toHaveLength(4)
  })

  it('null / 配列 / 文字列を渡しても落ちない', () => {
    expect(normalizeLayout(null).items).toEqual([])
    expect(normalizeLayout([1, 2]).items).toEqual([])
    expect(normalizeLayout('壊れています').gridW).toBe(40)
  })

  it('種類の無い要素は捨てる（描けないため）', () => {
    expect(normalizeLayout({ items: [{ id: 'a', x: 1, y: 1 }] }).items).toEqual([])
  })

  it('0・負のサイズは既定に戻す（潰れて掴めなくなるのを防ぐ）', () => {
    const v2 = normalizeLayout({ items: [{ id: 'a', type: 'machine', w: 0, h: -3 }] })
    expect(v2.items[0].w).toBe(1)
    expect(v2.items[0].h).toBe(1)
  })

  it('IDが重複していても別々の要素として扱う', () => {
    const v2 = normalizeLayout({
      items: [
        { id: 'i1', type: 'machine' },
        { id: 'i1', type: 'machine' },
      ],
    })
    expect(new Set(v2.items.map(i => i.id)).size).toBe(2)
  })

  it('角度を90度刻みに丸める', () => {
    expect(normalizeLayout({ items: [{ id: 'a', type: 'machine', rot: 100 }] }).items[0].rot).toBe(90)
  })

  it('管理番号の前後の空白を落とす', () => {
    const v2 = normalizeLayout({ items: [{ id: 'a', type: 'machine', code: '  EQ-9 ' }] })
    expect(v2.items[0].code).toBe('EQ-9')
  })
})

describe('itemCenter / layoutExtent', () => {
  it('要素の中心を出す', () => {
    expect(itemCenter(normalizeLayout(DOC).items[0])).toEqual({ x: 2, y: 1.5 })
  })

  it('全体が収まる範囲を出す（余白つき）', () => {
    const e = layoutExtent(normalizeLayout(DOC))
    expect(e.minX).toBeLessThanOrEqual(0)
    expect(e.maxX).toBeGreaterThanOrEqual(40)
  })

  it('要素が無くてもグリッドの大きさを返す', () => {
    expect(layoutExtent(normalizeLayout({ items: [], gridW: 30, gridH: 20 })).maxX).toBe(30)
  })
})

// ── 接着 ────────────────────────────────────────────────

const CSV = `製造指示番号,工程順,工程コード,工程名,品目コード,指示数,作業開始日時,作業終了日時
L1,1,P010,鋳造,MA1,100,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,加工,MA1,100,2026/05/12 10:00:00,2026/05/12 11:00:00
L1,3,P030,塗装,MA1,100,2026/05/15 10:00:00,2026/05/15 11:00:00
`

function metricsOf() {
  const t = buildRawTable('x.csv', utf8(CSV))
  const { lots } = buildLots(t, guessMapping(t.headers))
  return computeMetrics(lots, computeGaps(lots, DEFAULT_CALENDAR), {
    costs: { MA1: { unitCost: 1000, unit: 'ピース' } },
  })
}

const layout = normalizeLayout(DOC)

describe('buildBands ― 対応表が無いとき', () => {
  const r = buildBands(metricsOf(), layout, {})

  it('★勝手に紐づけない。1本も帯を描かない', () => {
    expect(r.bands).toEqual([])
    expect(r.linkedCount).toBe(0)
  })

  it('未対応の工程を隠さず列挙する', () => {
    expect(r.unlinked.map(u => u.code)).toEqual(['P010', 'P020', 'P030'])
  })

  it('描けなかった工程間の数と滞留を残す', () => {
    expect(r.undrawablePairs).toBe(2)
    expect(r.undrawableDaysMean).toBeGreaterThan(0)
  })
})

describe('buildBands ― 対応表があるとき', () => {
  const link = { P010: 'EQ-001', P020: 'EQ-002', P030: 'EQ-003' }
  const r = buildBands(metricsOf(), layout, link)

  it('工程間ごとに帯ができる', () => {
    expect(r.bands.map(b => b.key).sort()).toEqual(['P010→P020', 'P020→P030'])
    expect(r.linkedCount).toBe(3)
    expect(r.unlinked).toEqual([])
    expect(r.undrawablePairs).toBe(0)
  })

  it('レイアウト上の位置（中心）を持つ', () => {
    const b = r.bands.find(x => x.key === 'P010→P020')!
    expect(b.from).toEqual({ x: 2, y: 1.5 })
    expect(b.to).toEqual({ x: 22, y: 1.5 })
  })

  it('★動線の長さ（m）を出す。位置が分かって初めて出る数字', () => {
    expect(r.bands.find(x => x.key === 'P010→P020')!.distanceM).toBeCloseTo(20, 6)
    expect(r.bands.find(x => x.key === 'P020→P030')!.distanceM).toBeCloseTo(20, 6)
  })

  it('距離 × 滞留 を出す（遠い＋待つ が重なる区間）', () => {
    const b = r.bands[0]
    expect(b.distanceDayScore).toBeCloseTo(b.distanceM * b.calendarDaysMean, 6)
    expect(r.worstByDistance.length).toBeGreaterThan(0)
  })

  it('金額と深刻度を引き継ぐ', () => {
    const b = r.bands.find(x => x.key === 'P020→P030')!
    expect(b.amountJPY).not.toBeNull()
    expect([1, 2, 3]).toContain(b.severity)
  })
})

describe('buildBands ― 一部だけ対応しているとき', () => {
  const r = buildBands(metricsOf(), layout, { P010: 'EQ-001', P020: 'EQ-002' })

  it('描ける分だけ描き、残りは件数で示す', () => {
    expect(r.bands.map(b => b.key)).toEqual(['P010→P020'])
    expect(r.unlinked.map(u => u.code)).toEqual(['P030'])
    expect(r.undrawablePairs).toBe(1)
  })
})

describe('buildBands ― 存在しない管理番号を指しているとき', () => {
  it('黙って描かず、未対応として扱う', () => {
    const r = buildBands(metricsOf(), layout, { P010: 'EQ-999' })
    expect(r.bands).toEqual([])
    expect(r.unlinked.map(u => u.code)).toContain('P010')
  })
})

describe('bandWidth', () => {
  const bands = buildBands(metricsOf(), layout, {
    P010: 'EQ-001',
    P020: 'EQ-002',
    P030: 'EQ-003',
  }).bands

  it('太さは下限を持ち、0で消えない', () => {
    for (const b of bands) expect(bandWidth(b, bands)).toBeGreaterThanOrEqual(2)
  })

  it('滞留が大きいほど太い', () => {
    const sorted = [...bands].sort((a, b) => b.calendarDaysMean - a.calendarDaysMean)
    expect(bandWidth(sorted[0], bands)).toBeGreaterThanOrEqual(bandWidth(sorted[1], bands))
  })
})

describe('hasNoLinks', () => {
  it('対応表が空か、値が全て空なら true', () => {
    expect(hasNoLinks({})).toBe(true)
    expect(hasNoLinks({ P010: '' })).toBe(true)
    expect(hasNoLinks({ P010: 'EQ-001' })).toBe(false)
  })
})
