// ============================================================
// 金額（このアプリが既存ダッシュボードにできない唯一のこと）
//
// 在庫の「数」ではなく「原価 × 滞留時間」で出す。
//
// ★責任の3層を守る:
//   事実   … 滞留の日数            「御社の記録から算出」
//   凍結額 … 滞留 × 原価           「現在、工程間に滞留している金額」
//   試算   … ◯日短縮したら◯円動く  「御社の入力値に基づく試算です」
//   責任が生じるのは「◯円節約できます」と約束したときだけ。事実と試算は約束ではない。
//
// ★原価が未設定の品目は金額を出さない。0円にしない。
//   0円にすると、原価を入れていない品目が「タダで置いてある」ことになり、
//   凍結額が実際より小さく出る。
//
// ★単位（kg / ピース）が違う数量を合計しない。金額に変換してから合計する。
//   単位の正は Config.costs[品目コード].unit。CSVの単位列は参考表示にとどめる。
// ============================================================

import type { CostEntry, Gap, Lot } from './types'

const HOURS_PER_DAY = 24

export type AmountStatus =
  | 'ok'
  | 'no-item' // 品目コードが読めない
  | 'no-cost' // その品目の単価が未設定
  | 'no-quantity' // 数量が読めない

export type LotAmount = {
  lotId: string
  itemCode: string | null
  quantity: number | null
  /** 原価設定側の単位（こちらが正） */
  unit: string | null
  unitCost: number | null
  /** ロット金額 ＝ 数量 × 単価。出せなければ null */
  amountJPY: number | null
  status: AmountStatus
  /** CSVの単位列と原価設定の単位が食い違っている */
  unitMismatch: boolean
}

/**
 * ロット1件の金額。
 * ★この関数だけがロット金額を出す。画面もPNGもドリルダウンもここを通る。
 */
export function computeLotAmount(lot: Lot, costs: Record<string, CostEntry>): LotAmount {
  const itemCode = lot.itemCode
  const base = {
    lotId: lot.id,
    itemCode,
    quantity: lot.quantity,
    unit: null as string | null,
    unitCost: null as number | null,
    amountJPY: null as number | null,
    unitMismatch: false,
  }

  if (itemCode === null || itemCode === '') return { ...base, status: 'no-item' }

  const cost = costs[itemCode]
  if (!cost) return { ...base, status: 'no-cost' }

  const unitMismatch =
    lot.unitFromCsv !== null && cost.unit !== '' && lot.unitFromCsv !== cost.unit

  if (lot.quantity === null) {
    return { ...base, unit: cost.unit, unitCost: cost.unitCost, status: 'no-quantity', unitMismatch }
  }

  return {
    ...base,
    unit: cost.unit,
    unitCost: cost.unitCost,
    amountJPY: lot.quantity * cost.unitCost,
    status: 'ok',
    unitMismatch,
  }
}

/** 原価入力の画面を作るための、データに出てくる品目の一覧 */
export type ItemSummary = {
  code: string
  /** その品目のロット件数 */
  lots: number
  /** 代表的な数量（入力の目安として見せる） */
  sampleQuantity: number | null
  hasCost: boolean
}

export type MoneyReport = {
  /** データに出てくる品目。単価の入力欄をここから作る */
  items: ItemSummary[]
  /** 金額を出せたロット */
  lotsPriced: number
  /** 品目コードが読めない／単価未設定／数量が読めない */
  lotsNoItem: number
  lotsNoCost: number
  lotsNoQuantity: number
  /** 単価が未設定の品目コード（入力を促すために出す） */
  itemsMissingCost: string[]
  /** 原価設定に出てくる単位。混在していても金額に直してから足すので問題ない */
  unitsUsed: string[]
  /** CSVの単位と原価設定の単位が食い違うロット数 */
  unitMismatchLots: number

  /** ① 凍結額。この期間、平均していくら分の仕掛が工程間で止まりっぱなしだったか */
  frozenJPY: number | null
  /** D ＝ 1日あたり製造原価。③の試算に使う */
  dailyThroughputJPY: number | null
  /** 金額の計算に使えた滞留の件数／全体 */
  gapsPriced: number
  gapsTotal: number
}

export type MoneyInput = {
  lots: Lot[]
  gaps: Gap[]
  costs: Record<string, CostEntry>
  /** 対象期間の日数 T */
  periodDays: number | null
  /** 金額の母数にするロット（リードタイムの母数と同じ集合を使い、数字の出所を揃える） */
  targetLotIds: Set<string>
}

export type MoneyResult = {
  report: MoneyReport
  /** ロットID → 金額。工程間ごとの内訳を出すときに引く */
  amountByLot: Map<string, LotAmount>
  /** 工程間キー → 凍結額 */
  frozenByPair: Map<string, number>
}

const pairKeyOf = (gap: Gap) => `${gap.fromProcess}→${gap.toProcess}`

/**
 * 凍結額と1日あたり製造原価を出す。
 *
 *   凍結額 = Σ(すべての滞留)[ ロット金額 × 滞留の暦日数 ] ÷ T
 *
 * 意味：「この期間、平均していくら分の仕掛が工程間で止まりっぱなしだったか」＝運転資金。
 * 将来の節約ではなく現在の状態なので、約束にはならない。
 */
export function computeMoney(input: MoneyInput): MoneyResult {
  const { lots, gaps, costs, periodDays, targetLotIds } = input

  const amountByLot = new Map<string, LotAmount>()
  const missingCost = new Set<string>()
  const unitsUsed = new Set<string>()
  const itemMap = new Map<string, ItemSummary>()

  let lotsPriced = 0
  let lotsNoItem = 0
  let lotsNoCost = 0
  let lotsNoQuantity = 0
  let unitMismatchLots = 0
  let throughputJPY = 0

  for (const lot of lots) {
    const amount = computeLotAmount(lot, costs)
    amountByLot.set(lot.id, amount)

    if (amount.unitMismatch) unitMismatchLots++
    if (amount.unit !== null && amount.unit !== '') unitsUsed.add(amount.unit)

    // 集計の母数は、他の数字と同じロット集合に揃える
    if (!targetLotIds.has(lot.id)) continue

    if (lot.itemCode !== null && lot.itemCode !== '') {
      const entry = itemMap.get(lot.itemCode)
      if (entry) {
        entry.lots++
        if (entry.sampleQuantity === null) entry.sampleQuantity = lot.quantity
      } else {
        itemMap.set(lot.itemCode, {
          code: lot.itemCode,
          lots: 1,
          sampleQuantity: lot.quantity,
          hasCost: costs[lot.itemCode] !== undefined,
        })
      }
    }

    switch (amount.status) {
      case 'ok':
        lotsPriced++
        // 単位が違っても、ここで金額に直しているので合計してよい
        throughputJPY += amount.amountJPY ?? 0
        break
      case 'no-item':
        lotsNoItem++
        break
      case 'no-cost':
        lotsNoCost++
        if (amount.itemCode) missingCost.add(amount.itemCode)
        break
      case 'no-quantity':
        lotsNoQuantity++
        break
    }
  }

  // ── 凍結額 ──
  const frozenByPair = new Map<string, number>()
  let frozenNumerator = 0
  let gapsPriced = 0
  let gapsTotal = 0

  for (const gap of gaps) {
    if (!targetLotIds.has(gap.lotId)) continue
    gapsTotal++

    const amount = amountByLot.get(gap.lotId)
    if (!amount || amount.amountJPY === null) continue // 原価未設定は0円にせず、数えない

    const days = gap.calendarHours / HOURS_PER_DAY
    const value = amount.amountJPY * days
    frozenNumerator += value
    gapsPriced++

    const key = pairKeyOf(gap)
    frozenByPair.set(key, (frozenByPair.get(key) ?? 0) + value)
  }

  const usable = periodDays !== null && periodDays > 0 && gapsPriced > 0
  const frozenJPY = usable ? frozenNumerator / periodDays : null

  // 期間で割ってから返す（工程間ごとの内訳も同じ割り方にしないと合計が合わない）
  if (usable) {
    for (const [key, value] of frozenByPair) frozenByPair.set(key, value / periodDays)
  } else {
    frozenByPair.clear()
  }

  const dailyThroughputJPY =
    periodDays !== null && periodDays > 0 && lotsPriced > 0 ? throughputJPY / periodDays : null

  return {
    report: {
      // 件数の多い品目から並べる。金額への効き方が大きい順に入力してもらうため
      items: [...itemMap.values()].sort((a, b) => b.lots - a.lots || a.code.localeCompare(b.code)),
      lotsPriced,
      lotsNoItem,
      lotsNoCost,
      lotsNoQuantity,
      itemsMissingCost: [...missingCost].sort(),
      unitsUsed: [...unitsUsed].sort(),
      unitMismatchLots,
      frozenJPY,
      dailyThroughputJPY,
      gapsPriced,
      gapsTotal,
    },
    amountByLot,
    frozenByPair,
  }
}

/**
 * ③ 削減試算額 ＝ 1日あたり製造原価 × 短縮できた日数。
 * ★短縮日数はユーザーが決める。こちらで勝手に決めない。
 * ★これは試算であって約束ではない。画面には必ずその旨を出す。
 */
export function estimateReleasedJPY(
  dailyThroughputJPY: number | null,
  shortenDays: number
): number | null {
  if (dailyThroughputJPY === null || shortenDays <= 0) return null
  return dailyThroughputJPY * shortenDays
}

// ── 表示の書式（画面とPNGで同じ見え方にするため、ここに集約）──

export function formatJPY(value: number | null): string {
  if (value === null) return '原価未設定'
  return `${Math.round(value).toLocaleString('ja-JP')} 円`
}

/** 提案図で使う「◯◯万円」。細かい桁は意思決定に効かないので落とす */
export function formatManYen(value: number | null): string {
  if (value === null) return '原価未設定'
  const man = value / 10000
  if (Math.abs(man) >= 1000) return `${Math.round(man).toLocaleString('ja-JP')} 万円`
  if (Math.abs(man) >= 10) return `${man.toFixed(0)} 万円`
  return `${man.toFixed(1)} 万円`
}

/**
 * 変化率。元の値が0のときは % を出さない（「∞%改善」を避ける）。
 */
export function formatChangeRate(before: number | null, after: number | null): string | null {
  if (before === null || after === null || before === 0) return null
  return `${(((after - before) / before) * 100).toFixed(1)}%`
}
