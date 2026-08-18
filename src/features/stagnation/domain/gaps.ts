// ============================================================
// 滞留の計算（このアプリの主役）
//
//   滞留 = 次工程の実績開始 − 前工程の実績終了
//
// ★ excluded を 0 として集計に混ぜてはいけない。
//   混ぜると滞留が実際より小さく出て、「思ったより悪くないですね」という
//   逆効果の資料になる。計算できないものは件数として別に数える。
// ============================================================

import { calendarHoursBetween, prepareCalendar, workingHoursBetween } from './calendar'
import type { Gap, GapBasis, Lot, Step, WorkCalendar } from './types'

export type GapStats = {
  lotsTotal: number
  /** 滞留を1件以上計算できたロット */
  lotsUsed: number
  /** 工程が1つしかない等で、工程"間"が存在しないロット */
  lotsNoPair: number
  /** 工程間の総数（ロットごとの工程数-1の合計） */
  pairsTotal: number
  basisCounts: Record<GapBasis, number>
  /** 次工程が前工程の終了より前に始まっている＝工程の重なり。0として扱うが隠さない */
  overlaps: number
}

export type GapResult = {
  gaps: Gap[]
  stats: GapStats
  /**
   * 全ての工程間を計算できたロットのID。
   * ★リードタイムや滞留率の母数はこれに限る。
   *   一部が除外されたロットを母数に入れると、分子（滞留）だけが欠けて分母は満額残り、
   *   滞留率が実際より小さく出る（＝実態より良く見える資料になる）。
   */
  completeLotIds: Set<string>
}

const emptyBasisCounts = (): Record<GapBasis, number> => ({
  actual: 0,
  derived: 0,
  'date-only': 0,
  excluded: 0,
})

/** 同じ暦日か（日付だけのデータで「同日内は0」を判定するため） */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * 次工程の開始時刻を決める。
 * 実績が無ければ「終了 − 標準時間」で近似する（§5-2 の derived）。
 * どちらもできなければ null（0にしない）。
 */
function resolveNextStart(next: Step): { at: Date | null; basis: 'actual' | 'derived' | null } {
  if (next.actualStart !== null) return { at: next.actualStart, basis: 'actual' }

  if (next.actualEnd !== null && next.standardMinutes !== null && next.standardMinutes > 0) {
    const approx = new Date(next.actualEnd.getTime() - next.standardMinutes * 60000)
    return { at: approx, basis: 'derived' }
  }

  return { at: null, basis: null }
}

/**
 * ロットの一覧から、工程間の滞留をすべて出す。
 * 1ロットにつき「工程数 - 1」個の工程間を見る。
 */
export function computeGaps(lots: Lot[], calendar: WorkCalendar): GapResult {
  // カレンダーの前処理は1回だけ。工程間ごとにやると休業日の件数だけ遅くなる
  const cal = prepareCalendar(calendar)

  const gaps: Gap[] = []
  const completeLotIds = new Set<string>()
  const stats: GapStats = {
    lotsTotal: lots.length,
    lotsUsed: 0,
    lotsNoPair: 0,
    pairsTotal: 0,
    basisCounts: emptyBasisCounts(),
    overlaps: 0,
  }

  for (const lot of lots) {
    if (lot.steps.length < 2) {
      stats.lotsNoPair++
      continue
    }

    let usedInThisLot = false
    let excludedInThisLot = 0

    for (let i = 0; i < lot.steps.length - 1; i++) {
      const prev = lot.steps[i]
      const next = lot.steps[i + 1]
      stats.pairsTotal++

      const prevEnd = prev.actualEnd
      const resolved = resolveNextStart(next)

      // 前工程の終了が無い、または次工程の開始を決められない → 除外
      if (prevEnd === null || resolved.at === null || resolved.basis === null) {
        stats.basisCounts.excluded++
        excludedInThisLot++
        continue
      }

      const nextStart = resolved.at
      const dateOnly = prev.dateOnly || next.dateOnly
      const basis: GapBasis = dateOnly ? 'date-only' : resolved.basis

      let calendarHours: number
      let workingHours: number

      if (nextStart.getTime() < prevEnd.getTime()) {
        // 工程の重なり。滞留は0だが、データ品質の情報として件数を残す
        stats.overlaps++
        calendarHours = 0
        workingHours = 0
      } else if (dateOnly && isSameDay(prevEnd, nextStart)) {
        // 日付しか無いので、同日内の滞留は測りようがない。0とする
        calendarHours = 0
        workingHours = 0
      } else {
        calendarHours = calendarHoursBetween(prevEnd, nextStart)
        workingHours = workingHoursBetween(prevEnd, nextStart, cal)
      }

      stats.basisCounts[basis]++
      usedInThisLot = true

      gaps.push({
        lotId: lot.id,
        fromProcess: prev.processCode,
        toProcess: next.processCode,
        start: prevEnd,
        end: nextStart,
        calendarHours,
        workingHours,
        basis,
      })
    }

    if (usedInThisLot) stats.lotsUsed++
    if (excludedInThisLot === 0) completeLotIds.add(lot.id)
  }

  return { gaps, stats, completeLotIds }
}
