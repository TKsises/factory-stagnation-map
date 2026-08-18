// ============================================================
// 集計（画面とPNGが共通で使う唯一の計算）
//
// ★同じ指標を2箇所で計算しない。
//   画面のサマリーと書き出し画像の数字が食い違ったら、その時点で信用を失う。
//   ここで作った値を両方が読む。
// ============================================================

import type { CostEntry, Gap, GapBasis, Lot } from './types'
import type { GapResult } from './gaps'
import { computeMoney, type LotAmount, type MoneyReport } from './money'

const HOURS_PER_DAY = 24

export type ProcessNode = {
  code: string
  name: string
}

/** 工程間ごとの集計（＝どこを直せば一番効くか） */
export type PairMetric = {
  key: string
  fromProcess: string
  toProcess: string
  fromName: string
  toName: string
  /** 滞留を計算できたロット数 */
  count: number
  calendarDaysMean: number
  calendarDaysMedian: number
  calendarDaysMax: number
  workingDaysMean: number
  /** 期間全体で積み上がった滞留（暦・時間）。金額の按分に使う */
  totalCalendarHours: number
  /** 原価が未設定なら null（0円にしない） */
  amountJPY: number | null
  /** 深刻度 1〜3。7色に分けない */
  severity: 1 | 2 | 3
}

export type QualityReport = {
  lotsTotal: number
  lotsUsed: number
  lotsNoPair: number
  pairsTotal: number
  basisCounts: Record<GapBasis, number>
  basisPercents: Record<GapBasis, number>
  overlaps: number
  /** 「この数字は ◯◯件のロットのうち ◯◯件から算出しています」 */
  sentence: string
}

export type Summary = {
  /** 総リードタイム（暦）。平均だけ出さない。外れ値1件で崩れるため */
  leadTimeMeanDays: number | null
  leadTimeMedianDays: number | null
  /**
   * うち加工など（実績）＝ リードタイム − 滞留。
   * ★実績の時刻から出すので、リードタイム＝加工など＋滞留 が必ず成り立つ。
   *   標準時間から出すと足し算が合わず、「この3つ、合わないですよね」で信用を失う。
   *   なお「加工など」には検査・運搬・段取りも含まれる（実績が工程単位なので分離できない）。
   */
  processingActualMeanDays: number | null
  /** 参考：標準時間の合計。実績と比べる材料であって、上の3つの内訳ではない */
  standardTimeMeanDays: number | null
  /** 標準時間を算出できたロット数（母数が違うので必ず併記する） */
  standardTimeLots: number
  /** うち滞留時間 */
  stagnationMeanDays: number | null
  stagnationMedianDays: number | null
  /** 滞留 ÷ 総リードタイム */
  stagnationRate: number | null
  /** リードタイム・滞留率の母数になったロット数 */
  rateLots: number
  /**
   * 母数から外したロット数（工程間に除外があった／工程が1つだけ／実績が片方欠け）。
   * 隠さずに画面に出す。
   */
  rateExcludedLots: number
  /** 実績ではなく予定の列で計算している。画面と書き出し画像の両方に出す */
  plannedAsActual: boolean
  /** 対象期間（実績の最初と最後） */
  periodFrom: Date | null
  periodTo: Date | null
  periodDays: number | null
}

export type Metrics = {
  /** 金額の内訳。原価が未設定なら金額はすべて null（0円にしない） */
  money: MoneyReport
  /** ロットID → 金額。ロット一覧はこれを読む（金額の計算元は money.ts の1箇所だけ） */
  amountByLot: Map<string, LotAmount>
  /** 全ての工程間を計算できたロット。一覧で「欠損あり」を示すのに使う */
  completeLotIds: Set<string>
  flow: ProcessNode[]
  /** 観測された全ての工程間。流れの上で隣り合わないもの（工程飛ばし）も含む */
  pairs: PairMetric[]
  /** 深刻度と山の高さの基準。2箇所で別々に求めると色と高さが食い違う */
  worstCalendarDaysMean: number
  summary: Summary
  quality: QualityReport
}

// ── 小さな道具 ───────────────────────────────────────────

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  let sum = 0
  for (const x of xs) sum += x
  return sum / xs.length
}

/** 中央値。平均だけでは外れ値1件で崩れるので必ず併記する */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * 工程を流れの順に並べる。
 * 各工程コードが何番目に現れるかの中央値で並べる
 * （ロットによって工程が飛ぶことがあるので、平均より中央値が安定する）。
 */
export function buildFlow(lots: Lot[]): ProcessNode[] {
  const positions = new Map<string, { name: string; orders: number[] }>()

  for (const lot of lots) {
    lot.steps.forEach((step, index) => {
      const pos = step.order ?? index + 1
      let entry = positions.get(step.processCode)
      if (!entry) {
        entry = { name: step.processName, orders: [] }
        positions.set(step.processCode, entry)
      }
      entry.orders.push(pos)
    })
  }

  return [...positions.entries()]
    .map(([code, v]) => ({ code, name: v.name, rank: median(v.orders) ?? 0 }))
    .sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code))
    .map(({ code, name }) => ({ code, name }))
}

// ── 本体 ─────────────────────────────────────────────────

export type MetricsOptions = {
  /** 実績の欄に「予定」の列が選ばれているか */
  plannedAsActual?: boolean
  /** 品目コード → 単価と単位（手入力）。未設定なら金額は出さない */
  costs?: Record<string, CostEntry>
}

export function computeMetrics(
  lots: Lot[],
  result: GapResult,
  options: MetricsOptions = {}
): Metrics {
  const { gaps, stats, completeLotIds } = result
  const flow = buildFlow(lots)
  const nameOf = new Map(flow.map(n => [n.code, n.name]))

  // ── ロットごとのリードタイムと滞留 ──
  const stagnationByLot = new Map<string, number>()
  for (const gap of gaps) {
    stagnationByLot.set(gap.lotId, (stagnationByLot.get(gap.lotId) ?? 0) + gap.calendarHours)
  }

  const leadTimes: number[] = []
  const stagnations: number[] = []
  const processingActual: number[] = []
  const processing: number[] = []
  let periodFrom: Date | null = null
  let periodTo: Date | null = null
  let leadSum = 0
  let stagSum = 0
  let rateExcludedLots = 0

  for (const lot of lots) {
    const firstStart = lot.steps.find(s => s.actualStart !== null)?.actualStart ?? null
    let lastEnd: Date | null = null
    for (const step of lot.steps) if (step.actualEnd !== null) lastEnd = step.actualEnd

    // 対象期間は「読めた実績の端」なので、母数から外すロットの分も見る
    if (firstStart !== null && (periodFrom === null || firstStart < periodFrom)) {
      periodFrom = firstStart
    }
    if (lastEnd !== null && (periodTo === null || lastEnd > periodTo)) {
      periodTo = lastEnd
    }

    // ★母数に入れるのは「全ての工程間を計算できたロット」だけ。
    //   一部でも除外があったロットを入れると、分子（滞留）だけが欠けて分母は満額残り、
    //   滞留率が実際より小さく出る。工程が1つだけのロットも completeLotIds に入らない。
    if (!completeLotIds.has(lot.id)) {
      rateExcludedLots++
      continue
    }

    // 実績が片方でも欠けていればリードタイムは出せない
    if (firstStart === null || lastEnd === null) {
      rateExcludedLots++
      continue
    }
    const leadHours = (lastEnd.getTime() - firstStart.getTime()) / 3600000
    if (leadHours <= 0) {
      rateExcludedLots++
      continue
    }

    const stagHours = stagnationByLot.get(lot.id) ?? 0
    leadTimes.push(leadHours / HOURS_PER_DAY)
    stagnations.push(stagHours / HOURS_PER_DAY)
    leadSum += leadHours
    stagSum += stagHours

    // 加工など（実績）＝ リードタイム − 滞留。負にはならないが念のため下限を置く
    processingActual.push(Math.max(0, leadHours - stagHours) / HOURS_PER_DAY)

    // ★標準時間の欠損を 0 分として足さない。
    //   1工程でも欠けていれば、そのロットの正味加工時間は出さない（0で埋めると黙って短く出る）。
    //   合計標準時間（標準時間＋段取り標準時間）があればそちらを優先する。
    const perStep = lot.steps.map(s => s.totalStandardMinutes ?? s.standardMinutes)
    if (perStep.length > 0 && perStep.every(v => v !== null)) {
      const stdMinutes = perStep.reduce((a, v) => a + (v as number), 0)
      if (stdMinutes > 0) processing.push(stdMinutes / 60 / HOURS_PER_DAY)
    }
  }

  const periodDays =
    periodFrom !== null && periodTo !== null
      ? Math.max(1, (periodTo.getTime() - periodFrom.getTime()) / 86400000)
      : null

  // ── 金額 ──
  // 母数はリードタイムと同じロット集合に揃える。
  // 別々の集合で出すと「対象2,105件」と書いてある横で違う件数の金額が並ぶ。
  const targetLotIds = new Set<string>()
  for (const lot of lots) {
    if (completeLotIds.has(lot.id)) targetLotIds.add(lot.id)
  }
  const money = computeMoney({
    lots,
    gaps,
    costs: options.costs ?? {},
    periodDays,
    targetLotIds,
  })

  // ── 工程間ごとにまとめる（金額の内訳もここで載せる）──
  const buckets = new Map<string, Gap[]>()
  for (const gap of gaps) {
    const key = `${gap.fromProcess}→${gap.toProcess}`
    const list = buckets.get(key)
    if (list) list.push(gap)
    else buckets.set(key, [gap])
  }

  const rawPairs = [...buckets.entries()].map(([key, list]) => {
    const calendarDays = list.map(g => g.calendarHours / HOURS_PER_DAY)
    const workingDays = list.map(g => g.workingHours / HOURS_PER_DAY)
    const totalCalendarHours = list.reduce((a, g) => a + g.calendarHours, 0)
    // Math.max(...配列) を使わない。1つの工程間に20万件たまるとスタックが溢れる
    let maxDays = 0
    for (const d of calendarDays) if (d > maxDays) maxDays = d
    return {
      key,
      fromProcess: list[0].fromProcess,
      toProcess: list[0].toProcess,
      fromName: nameOf.get(list[0].fromProcess) ?? list[0].fromProcess,
      toName: nameOf.get(list[0].toProcess) ?? list[0].toProcess,
      count: list.length,
      calendarDaysMean: mean(calendarDays) ?? 0,
      calendarDaysMedian: median(calendarDays) ?? 0,
      calendarDaysMax: maxDays,
      workingDaysMean: mean(workingDays) ?? 0,
      totalCalendarHours,
      // 原価が未設定の工程間は null のまま。0円にしない
      amountJPY: money.frozenByPair.get(key) ?? null,
    }
  })

  // 深刻度は「一番ひどい工程間」を基準にした相対評価。3段階に留める
  const worst = rawPairs.reduce((m, p) => Math.max(m, p.calendarDaysMean), 0)
  const pairs: PairMetric[] = rawPairs
    .map(p => ({
      ...p,
      severity: (worst === 0
        ? 1
        : p.calendarDaysMean >= worst * 0.6
          ? 3
          : p.calendarDaysMean >= worst * 0.3
            ? 2
            : 1) as 1 | 2 | 3,
    }))
    .sort((a, b) => b.calendarDaysMean - a.calendarDaysMean)

  const summary: Summary = {
    leadTimeMeanDays: mean(leadTimes),
    leadTimeMedianDays: median(leadTimes),
    processingActualMeanDays: mean(processingActual),
    standardTimeMeanDays: mean(processing),
    standardTimeLots: processing.length,
    stagnationMeanDays: mean(stagnations),
    stagnationMedianDays: median(stagnations),
    stagnationRate: leadSum > 0 ? stagSum / leadSum : null,
    rateLots: leadTimes.length,
    rateExcludedLots,
    plannedAsActual: options.plannedAsActual === true,
    periodFrom,
    periodTo,
    periodDays,
  }

  // ── 品質（隠さずに出す）──
  const totalBasis =
    stats.basisCounts.actual +
    stats.basisCounts.derived +
    stats.basisCounts['date-only'] +
    stats.basisCounts.excluded

  const percentOf = (n: number) => (totalBasis === 0 ? 0 : (n / totalBasis) * 100)

  const quality: QualityReport = {
    lotsTotal: stats.lotsTotal,
    lotsUsed: stats.lotsUsed,
    lotsNoPair: stats.lotsNoPair,
    pairsTotal: stats.pairsTotal,
    basisCounts: stats.basisCounts,
    basisPercents: {
      actual: percentOf(stats.basisCounts.actual),
      derived: percentOf(stats.basisCounts.derived),
      'date-only': percentOf(stats.basisCounts['date-only']),
      excluded: percentOf(stats.basisCounts.excluded),
    },
    overlaps: stats.overlaps,
    // 「◯件から算出」は、実際に率の母数になった件数を言う。
    // ここで lotsUsed（1件でも滞留を出せたロット）を書くと、
    // 表示している件数と、率を割っている件数が食い違う。
    sentence:
      `この数字は ${stats.lotsTotal.toLocaleString()} 件のロットのうち ` +
      `${leadTimes.length.toLocaleString()} 件から算出しています。` +
      (rateExcludedLots > 0
        ? `（${rateExcludedLots.toLocaleString()} 件は工程間に欠損があるため除いています）`
        : ''),
  }

  return {
    money: money.report,
    amountByLot: money.amountByLot,
    completeLotIds,
    flow,
    pairs,
    worstCalendarDaysMean: worst,
    summary,
    quality,
  }
}

// ── 表示用の書式（画面とPNGで同じ見え方にするため、ここに集約）──

export function formatDays(days: number | null): string {
  if (days === null) return '—'
  return `${days.toFixed(1)} 日`
}

export function formatRate(rate: number | null): string {
  if (rate === null) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

export const BASIS_LABEL: Record<GapBasis, string> = {
  actual: '実績',
  derived: '近似',
  'date-only': '日付のみ',
  excluded: '除外',
}
