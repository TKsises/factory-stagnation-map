import { describe, expect, it } from 'vitest'
import { buildRawTable } from '../domain/csv'
import { computeGaps } from '../domain/gaps'
import { buildLots } from '../domain/lots'
import { guessMapping } from '../domain/mapping'
import { computeMetrics } from '../domain/metrics'
import type { CostEntry } from '../domain/types'
import { DEFAULT_CALENDAR, EMPTY_MAPPING } from '../domain/types'
import { buildFootnotes, proposalFileName } from './renderProposalPng'

const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

const COSTS: Record<string, CostEntry> = {
  MA1: { unitCost: 1000, unit: 'ピース' },
  MA2: { unitCost: 500, unit: 'kg' },
}

// L1 は全工程間が計算可、L2 は工程間が除外される
const CSV = `製造指示番号,工程順,工程コード,工程名,品目コード,指示数,作業開始日時,作業終了日時
L1,1,P010,鋳造,MA1,100,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,加工,MA1,100,2026/05/13 10:00:00,2026/05/13 11:00:00
L2,1,P010,鋳造,MA2,200,2026/05/11 09:00:00,2026/05/11 10:00:00
L2,2,P020,加工,MA2,200,,
`

function metricsOf(costs: Record<string, CostEntry> = COSTS, mapping = guessMapping([])) {
  const t = buildRawTable('工程実績一覧.csv', utf8(CSV))
  const mp = mapping === EMPTY_MAPPING ? mapping : guessMapping(t.headers)
  const { lots } = buildLots(t, mp)
  const gr = computeGaps(lots, DEFAULT_CALENDAR)
  return computeMetrics(lots, gr, { costs })
}

const footnotesOf = (costs = COSTS, shortenDays = 1) =>
  buildFootnotes({
    metrics: metricsOf(costs),
    shortenDays,
    costs,
    sourceFileName: '工程実績一覧.csv',
  })

describe('脚注 ― 省略してはいけないもの', () => {
  const lines = footnotesOf()
  const all = lines.join('\n')

  it('算出に使った件数と、除外した件数を書く', () => {
    expect(all).toContain('2 件のロットのうち')
    expect(all).toContain('1 件から算出')
    expect(all).toContain('1 件は工程間に欠損があるため除外')
  })

  it('除外分を0として混ぜていないことを明記する', () => {
    expect(all).toContain('0として合計に混ぜていません')
  })

  it('データの内訳（basis）を割合で書く', () => {
    expect(all).toContain('実績')
    expect(all).toContain('近似')
    expect(all).toContain('日付のみ')
    expect(all).toContain('除外')
    expect(all).toMatch(/\d+\.\d%/)
  })

  it('工程間の数と重なりの件数を書く', () => {
    expect(all).toContain('工程間 2 か所')
    expect(all).toContain('工程の重なり 0 件')
  })

  it('暦と稼働の使い分けを書く', () => {
    expect(all).toContain('暦時間')
    expect(all).toContain('稼働時間')
    expect(all).toContain('休日は縮められない')
  })

  it('原価の入力値をそのまま書く（数字の出所を残す）', () => {
    expect(all).toContain('MA1 1,000円/ピース')
    expect(all).toContain('MA2 500円/kg')
  })

  it('試算の前提と、試算であることのラベルを書く', () => {
    expect(all).toContain('1日あたり製造原価')
    expect(all).toContain('短縮日数はお客様の入力値です')
    expect(all).toContain('御社の入力値に基づく試算です')
  })

  it('データの出所（ファイル名）を書く', () => {
    expect(all).toContain('工程実績一覧.csv')
  })

  it('★断定表現を含まない', () => {
    for (const word of ['削減できます', '節約できます', '実現します', '保証']) {
      expect(all).not.toContain(word)
    }
  })
})

describe('脚注 ― 原価が未設定のとき', () => {
  const all = footnotesOf({}).join('\n')

  it('金額を算出していないことを明記し、0円扱いしていないと書く', () => {
    expect(all).toContain('未設定のため金額は算出していません')
    expect(all).toContain('0円として扱ってはいません')
  })

  it('試算の前提は書かない（出せない数字の前提を書かない）', () => {
    expect(all).not.toContain('1日あたり製造原価')
  })
})

describe('脚注 ― 一部の品目だけ原価が設定されているとき', () => {
  // 上の CSV は L2 の工程間が除外されるため、L2 はそもそも金額の母数に入らない。
  // 「単価だけが無い」状態を作るには、両方のロットが計算可能である必要がある。
  const bothComplete = `製造指示番号,工程順,工程コード,工程名,品目コード,指示数,作業開始日時,作業終了日時
L1,1,P010,鋳造,MA1,100,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,加工,MA1,100,2026/05/13 10:00:00,2026/05/13 11:00:00
L2,1,P010,鋳造,MA2,200,2026/05/11 09:00:00,2026/05/11 10:00:00
L2,2,P020,加工,MA2,200,2026/05/14 10:00:00,2026/05/14 11:00:00
`

  it('未設定分を除外したこと、実際はもっと大きいことを書く', () => {
    const t = buildRawTable('x.csv', utf8(bothComplete))
    const { lots } = buildLots(t, guessMapping(t.headers))
    const costs = { MA1: COSTS.MA1 }
    const m = computeMetrics(lots, computeGaps(lots, DEFAULT_CALENDAR), { costs })
    expect(m.money.lotsNoCost).toBe(1) // MA2 だけ単価が無い

    const all = buildFootnotes({
      metrics: m,
      shortenDays: 1,
      costs,
      sourceFileName: 'x.csv',
    }).join('\n')
    expect(all).toContain('単価未設定 1 件')
    expect(all).toContain('実際の金額はこれより大きくなります')
  })
})

describe('脚注 ― 予定ベースのとき', () => {
  it('先頭に参考値であることを出す', () => {
    const t = buildRawTable('x.csv', utf8(CSV))
    const m = computeMetrics(
      buildLots(t, guessMapping(t.headers)).lots,
      computeGaps(buildLots(t, guessMapping(t.headers)).lots, DEFAULT_CALENDAR),
      { costs: COSTS, plannedAsActual: true }
    )
    const lines = buildFootnotes({
      metrics: m,
      shortenDays: 1,
      costs: COSTS,
      sourceFileName: 'x.csv',
    })
    expect(lines[0]).toContain('実績ではなく「予定」の列で計算した参考値')
    expect(lines[0]).toContain('計画とのズレ')
  })
})

describe('書き出しファイル名', () => {
  it('日付と種別が入る（2種類を取り違えないため）', () => {
    expect(proposalFileName(new Date(2026, 7, 17))).toBe('工程滞留_提案_流れ_20260817.png')
    expect(proposalFileName(new Date(2026, 7, 17), 'layout')).toBe(
      '工程滞留_提案_レイアウト_20260817.png'
    )
  })
})
