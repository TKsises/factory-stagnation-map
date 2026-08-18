import { describe, expect, it } from 'vitest'
import { buildRawTable } from './csv'
import { buildLots } from './lots'
import { guessMapping } from './mapping'
import type { ColumnMapping, RawTable } from './types'

const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

/**
 * 手で計算した小さなCSV（3ロット × 4工程）。
 * 2026-05-11(月) 〜 05-14(木) に収めてある。
 *
 * LOT-A … 素直に全工程が埋まっている
 * LOT-B … 2工程目の開始が空（標準時間から近似する）／4工程目は開始も終了も空
 * LOT-C … 1〜2工程目が日付だけ／4工程目が前工程の終了より前に始まる（重なり）
 */
export const SMALL_CSV = `製造指示番号,工程順,工程コード,工程名,品目コード,指示数,標準時間,作業開始日時,作業終了日時
LOT-A,1,P010,鋳造,MA1,100,60,2026/05/11 08:30:00,2026/05/11 09:30:00
LOT-A,2,P020,加工,MA1,100,60,2026/05/12 10:00:00,2026/05/12 11:00:00
LOT-A,3,P030,塗装,MA1,100,60,2026/05/13 09:00:00,2026/05/13 10:00:00
LOT-A,4,P040,検査,MA1,100,60,2026/05/13 14:00:00,2026/05/13 15:00:00
LOT-B,1,P010,鋳造,MA2,50,60,2026/05/11 08:30:00,2026/05/11 09:30:00
LOT-B,2,P020,加工,MA2,50,60,,2026/05/12 12:00:00
LOT-B,3,P030,塗装,MA2,50,60,2026/05/13 09:00:00,2026/05/13 10:00:00
LOT-B,4,P040,検査,MA2,50,60,,
LOT-C,1,P010,鋳造,MA3,20,60,2026/05/11,2026/05/11
LOT-C,2,P020,加工,MA3,20,60,2026/05/13,2026/05/13
LOT-C,3,P030,塗装,MA3,20,60,2026/05/14 09:00:00,2026/05/14 10:00:00
LOT-C,4,P040,検査,MA3,20,60,2026/05/14 08:00:00,2026/05/14 11:00:00
`

export function smallTable(): RawTable {
  return buildRawTable('small.csv', utf8(SMALL_CSV))
}

export function smallMapping(): ColumnMapping {
  return guessMapping(smallTable().headers)
}

describe('buildLots ― 小さなCSV', () => {
  const table = smallTable()
  const { lots, stats } = buildLots(table, guessMapping(table.headers))

  it('3ロットに組み立てる', () => {
    expect(stats.lotsBuilt).toBe(3)
    expect(lots.map(l => l.id)).toEqual(['LOT-A', 'LOT-B', 'LOT-C'])
  })

  it('12行すべてを使う', () => {
    expect(stats.totalRows).toBe(12)
    expect(stats.usedRows).toBe(12)
    expect(stats.skippedNoLot).toBe(0)
    expect(stats.skippedNoProcess).toBe(0)
  })

  it('工程順の列を使って並べる', () => {
    expect(stats.orderSource).toBe('column')
    expect(lots[0].steps.map(s => s.processCode)).toEqual(['P010', 'P020', 'P030', 'P040'])
  })

  it('ロット単位の属性を1回だけ拾う', () => {
    expect(lots[0].itemCode).toBe('MA1')
    expect(lots[0].quantity).toBe(100)
    expect(lots[2].quantity).toBe(20)
  })

  it('単位の列が無いので unitFromCsv は null（勝手に埋めない）', () => {
    expect(lots[0].unitFromCsv).toBeNull()
  })

  it('空の実績を 0 ではなく null にする', () => {
    const b = lots[1]
    expect(b.steps[1].actualStart).toBeNull()
    expect(b.steps[1].actualEnd).not.toBeNull()
    expect(b.steps[3].actualStart).toBeNull()
    expect(b.steps[3].actualEnd).toBeNull()
  })

  it('日付だけの行に dateOnly の印を付ける', () => {
    const c = lots[2]
    expect(c.steps[0].dateOnly).toBe(true)
    expect(c.steps[1].dateOnly).toBe(true)
    expect(c.steps[2].dateOnly).toBe(false)
  })

  it('標準時間を分として読む', () => {
    expect(lots[0].steps[0].standardMinutes).toBe(60)
  })
})

describe('buildLots ― 並べ替え', () => {
  it('行の並びがばらばらでも工程順に並べ直す', () => {
    const csv = `製造指示番号,工程順,工程コード,作業開始日時,作業終了日時
L1,3,P030,2026/05/13 09:00:00,2026/05/13 10:00:00
L1,1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,2026/05/12 09:00:00,2026/05/12 10:00:00
`
    const t = buildRawTable('x.csv', utf8(csv))
    const { lots } = buildLots(t, guessMapping(t.headers))
    expect(lots[0].steps.map(s => s.processCode)).toEqual(['P010', 'P020', 'P030'])
  })

  it('工程順の列が無ければ実績の時刻順に並べる', () => {
    const csv = `製造指示番号,工程コード,作業開始日時,作業終了日時
L1,P030,2026/05/13 09:00:00,2026/05/13 10:00:00
L1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,P020,2026/05/12 09:00:00,2026/05/12 10:00:00
`
    const t = buildRawTable('x.csv', utf8(csv))
    const { lots, stats } = buildLots(t, guessMapping(t.headers))
    expect(stats.orderSource).toBe('time')
    expect(lots[0].steps.map(s => s.processCode)).toEqual(['P010', 'P020', 'P030'])
  })

  it('時刻が無い工程は末尾に置く（前に来て順序を壊さない）', () => {
    const csv = `製造指示番号,工程コード,作業開始日時,作業終了日時
L1,P099,,
L1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
`
    const t = buildRawTable('x.csv', utf8(csv))
    const { lots } = buildLots(t, guessMapping(t.headers))
    expect(lots[0].steps.map(s => s.processCode)).toEqual(['P010', 'P099'])
  })
})

describe('buildLots ― 敵対的なデータ', () => {
  it('ロットIDが空の行を捨てて件数を残す', () => {
    const csv = `製造指示番号,工程順,工程コード,作業開始日時,作業終了日時
,1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
`
    const t = buildRawTable('x.csv', utf8(csv))
    const { lots, stats } = buildLots(t, guessMapping(t.headers))
    expect(stats.skippedNoLot).toBe(1)
    expect(lots).toHaveLength(1)
  })

  it('工程の識別子が空の行を捨てる', () => {
    const csv = `製造指示番号,工程順,工程コード,作業開始日時,作業終了日時
L1,1,,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,2026/05/12 09:00:00,2026/05/12 10:00:00
`
    const t = buildRawTable('x.csv', utf8(csv))
    const { lots, stats } = buildLots(t, guessMapping(t.headers))
    expect(stats.skippedNoProcess).toBe(1)
    expect(lots[0].steps).toHaveLength(1)
  })

  it('工程が1つしかないロットを数える（工程"間"が無い）', () => {
    const csv = `製造指示番号,工程順,工程コード,作業開始日時,作業終了日時
L1,1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
`
    const t = buildRawTable('x.csv', utf8(csv))
    const { stats } = buildLots(t, guessMapping(t.headers))
    expect(stats.lotsSingleStep).toBe(1)
  })

  it('同じロットIDで工程が重複していても落ちない', () => {
    const csv = `製造指示番号,工程順,工程コード,作業開始日時,作業終了日時
L1,1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
`
    const t = buildRawTable('x.csv', utf8(csv))
    const { lots } = buildLots(t, guessMapping(t.headers))
    expect(lots[0].steps).toHaveLength(2)
  })

  // 回帰: ヘッダー末尾のカンマ（＝空の列名）で並べ替えが黙って無効になっていた
  it('ヘッダー末尾にカンマがあっても、工程順の列が無いと正しく判定する', () => {
    const csv = `製造指示番号,工程コード,作業開始日時,作業終了日時,
L1,P030,2026/05/13 09:00:00,2026/05/13 10:00:00,
L1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00,
L1,P020,2026/05/12 09:00:00,2026/05/12 10:00:00,
`
    const t = buildRawTable('x.csv', utf8(csv))
    const { lots, stats } = buildLots(t, guessMapping(t.headers))
    expect(stats.orderSource).toBe('time')
    expect(lots[0].steps.map(s => s.processCode)).toEqual(['P010', 'P020', 'P030'])
  })

  it('行が1つも無くても落ちない', () => {
    const t = buildRawTable('x.csv', utf8('製造指示番号,工程コード,作業開始日時,作業終了日時\r\n'))
    const { lots, stats } = buildLots(t, guessMapping(t.headers))
    expect(lots).toEqual([])
    expect(stats.lotsBuilt).toBe(0)
  })
})
