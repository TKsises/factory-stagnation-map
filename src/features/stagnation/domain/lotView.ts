// ============================================================
// ロット一覧（1行1ロット）と、そのドリルダウン
//
// 目的は「この4.2日という平均が、実際にはどのロットで起きているのか」を追えること。
// 平均だけ見せて終わりにすると、目利きの決裁者に「で、それは本当か」で止められる。
//
// 金額はここで計算しない。money.ts が出したものを引くだけ（計算元は1箇所）。
// ============================================================

import type { Gap, GapBasis, Lot, Step } from './types'
import type { LotAmount } from './money'

const HOURS_PER_DAY = 24

/** 帯の1区間。加工と滞留を同じ時間軸の上に並べる */
export type LotSegment = {
  kind: 'process' | 'gap'
  label: string
  start: Date
  end: Date
  hours: number
  /** 滞留のときだけ。どうやって出した数字か */
  basis?: GapBasis
}

export type LotStepView = {
  order: number | null
  processCode: string
  processName: string
  actualStart: Date | null
  actualEnd: Date | null
  dateOnly: boolean
  /** この工程の後ろにある滞留（最後の工程には無い） */
  gapAfter: Gap | null
  /** 次工程との間が計算できなかった */
  gapExcluded: boolean
}

export type LotRow = {
  lotId: string
  itemCode: string | null
  quantity: number | null
  /** 原価設定側の単位（正） */
  unit: string | null
  amountJPY: number | null
  firstStart: Date | null
  lastEnd: Date | null
  /** 総リードタイム（暦・時間）。開始か終了が欠けていれば null */
  leadHours: number | null
  stagnationHours: number
  workingStagnationHours: number
  /** 帯を描くための区間。時系列に並んでいる */
  segments: LotSegment[]
  steps: LotStepView[]
  /** 近似・日付のみが混ざっている（一覧に印を付ける） */
  hasApprox: boolean
  hasDateOnly: boolean
  /** 計算できなかった工程間の数 */
  excludedPairs: number
  /** 全ての工程間を計算できた */
  complete: boolean
}

const hoursBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 3600000)

/**
 * ロットごとの表示用の行を作る。
 * gaps は computeGaps が出したものをそのまま渡す（滞留の計算をやり直さない）。
 */
export function buildLotRows(
  lots: Lot[],
  gaps: Gap[],
  completeLotIds: Set<string>,
  amountByLot: Map<string, LotAmount>
): LotRow[] {
  // ロットIDごとに滞留を引けるようにする。工程の並び順に対応づける
  const gapsByLot = new Map<string, Gap[]>()
  for (const gap of gaps) {
    const list = gapsByLot.get(gap.lotId)
    if (list) list.push(gap)
    else gapsByLot.set(gap.lotId, [gap])
  }

  return lots.map(lot => {
    const lotGaps = gapsByLot.get(lot.id) ?? []
    // 「前工程→次工程」で引けるようにする
    const gapByPair = new Map<string, Gap>()
    for (const g of lotGaps) gapByPair.set(`${g.fromProcess}→${g.toProcess}`, g)

    const segments: LotSegment[] = []
    const steps: LotStepView[] = []
    let stagnationHours = 0
    let workingStagnationHours = 0
    let hasApprox = false
    let hasDateOnly = false
    let excludedPairs = 0

    lot.steps.forEach((step: Step, i) => {
      // 加工の区間（実績の開始と終了が両方あるときだけ描ける）
      if (step.actualStart !== null && step.actualEnd !== null) {
        segments.push({
          kind: 'process',
          label: step.processName,
          start: step.actualStart,
          end: step.actualEnd,
          hours: hoursBetween(step.actualStart, step.actualEnd),
        })
      }

      const next = lot.steps[i + 1]
      let gapAfter: Gap | null = null
      let gapExcluded = false

      if (next) {
        const found = gapByPair.get(`${step.processCode}→${next.processCode}`) ?? null
        if (found) {
          gapAfter = found
          stagnationHours += found.calendarHours
          workingStagnationHours += found.workingHours
          if (found.basis === 'derived') hasApprox = true
          if (found.basis === 'date-only') hasDateOnly = true
          if (found.calendarHours > 0) {
            segments.push({
              kind: 'gap',
              label: `${step.processName} → ${next.processName}`,
              start: found.start,
              end: found.end,
              hours: found.calendarHours,
              basis: found.basis,
            })
          }
        } else {
          gapExcluded = true
          excludedPairs++
        }
      }

      steps.push({
        order: step.order,
        processCode: step.processCode,
        processName: step.processName,
        actualStart: step.actualStart,
        actualEnd: step.actualEnd,
        dateOnly: step.dateOnly,
        gapAfter,
        gapExcluded,
      })
    })

    const firstStart = lot.steps.find(s => s.actualStart !== null)?.actualStart ?? null
    let lastEnd: Date | null = null
    for (const s of lot.steps) if (s.actualEnd !== null) lastEnd = s.actualEnd

    const amount = amountByLot.get(lot.id)

    return {
      lotId: lot.id,
      itemCode: lot.itemCode,
      quantity: lot.quantity,
      unit: amount?.unit ?? null,
      amountJPY: amount?.amountJPY ?? null,
      firstStart,
      lastEnd,
      leadHours: firstStart !== null && lastEnd !== null ? hoursBetween(firstStart, lastEnd) : null,
      stagnationHours,
      workingStagnationHours,
      segments,
      steps,
      hasApprox,
      hasDateOnly,
      excludedPairs,
      complete: completeLotIds.has(lot.id),
    }
  })
}

// ── 並べ替えと絞り込み ───────────────────────────────────

export type SortKey = 'stagnation' | 'leadTime' | 'amount' | 'lotId'

export type LotFilter = {
  itemCode: string
  processCode: string
  /** 'YYYY-MM-DD'。空なら制限しない */
  from: string
  to: string
}

export const EMPTY_FILTER: LotFilter = { itemCode: '', processCode: '', from: '', to: '' }

function parseDayStart(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0)
}

function parseDayEnd(ymd: string): Date | null {
  const d = parseDayStart(ymd)
  if (d === null) return null
  d.setHours(23, 59, 59, 999)
  return d
}

export function filterLotRows(rows: LotRow[], filter: LotFilter): LotRow[] {
  const from = parseDayStart(filter.from)
  const to = parseDayEnd(filter.to)

  return rows.filter(row => {
    if (filter.itemCode !== '' && row.itemCode !== filter.itemCode) return false
    if (filter.processCode !== '' && !row.steps.some(s => s.processCode === filter.processCode)) {
      return false
    }
    // 期間は「そのロットが流れ始めた日」で判定する
    if (from !== null && (row.firstStart === null || row.firstStart < from)) return false
    if (to !== null && (row.firstStart === null || row.firstStart > to)) return false
    return true
  })
}

export function sortLotRows(rows: LotRow[], key: SortKey): LotRow[] {
  const copy = [...rows]
  switch (key) {
    case 'stagnation':
      // 既定。滞留の長い順
      return copy.sort((a, b) => b.stagnationHours - a.stagnationHours)
    case 'leadTime':
      return copy.sort((a, b) => (b.leadHours ?? -1) - (a.leadHours ?? -1))
    case 'amount':
      // 金額が出せないロットは後ろに置く（0円として上位に混ぜない）
      return copy.sort((a, b) => (b.amountJPY ?? -1) - (a.amountJPY ?? -1))
    case 'lotId':
      return copy.sort((a, b) => a.lotId.localeCompare(b.lotId))
  }
}

export const toDays = (hours: number) => hours / HOURS_PER_DAY

/** basis に付ける印。近似や日付のみを黙って混ぜない */
export const BASIS_MARK: Record<GapBasis, string> = {
  actual: '',
  derived: '≈',
  'date-only': '📅',
  excluded: '—',
}
