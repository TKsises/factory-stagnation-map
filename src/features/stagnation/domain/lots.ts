// ============================================================
// 正規化：CSVの行 → ロット（製造指示）単位の工程の並び
//
// ★ロット単位で追うことが肝。機械単位で追うと「1台の機械で複数品目」で破綻する。
//   ロット単位なら、複数ロットが同じ機械を並行して流れても滞留は独立に計算できる。
//
// ★外から入るデータはここを必ず通す。ここで
//   ①壊れた日付を null にする ②空のロットを除去する ③工程順に並べ替える
// ============================================================

import { columnIndex } from './csv'
import { parseNumber, parseTimestamp } from './datetime'
import type { ColumnMapping, Lot, RawTable, Step } from './types'

export type BuildStats = {
  totalRows: number
  /** ロットに組み込めた行 */
  usedRows: number
  /** ロットIDが空で捨てた行 */
  skippedNoLot: number
  /** 工程の識別子が空で捨てた行 */
  skippedNoProcess: number
  lotsBuilt: number
  /** 工程が1つしかないロット。工程"間"が無いので滞留は定義できない */
  lotsSingleStep: number
  /** 何を根拠に工程を並べたか */
  orderSource: 'column' | 'time'
}

export type BuildResult = {
  lots: Lot[]
  stats: BuildStats
}

/** 並べ替えの基準にする時刻。開始が無ければ終了で代用する（並べ替えのためだけ） */
function sortKeyOf(step: Step): number | null {
  const d = step.actualStart ?? step.actualEnd
  return d === null ? null : d.getTime()
}

/**
 * 工程を並べる。
 * 工程順の列があればそれを使う（Smart Craft では必ず取れる）。
 * 無ければ実績の時刻順。どちらも無い工程は末尾に、元の並びのまま置く。
 *
 * Array.prototype.sort は安定なので、同じ値のときは元の順序が保たれる。
 * （同じロットIDで工程が重複していても、順序が入れ替わって落ちることはない）
 */
function sortSteps(steps: Step[], useOrderColumn: boolean): Step[] {
  return [...steps].sort((a, b) => {
    if (useOrderColumn) {
      const ao = a.order
      const bo = b.order
      if (ao !== null && bo !== null) return ao - bo
      if (ao !== null) return -1
      if (bo !== null) return 1
      return 0
    }
    const ak = sortKeyOf(a)
    const bk = sortKeyOf(b)
    if (ak !== null && bk !== null) return ak - bk
    if (ak !== null) return -1
    if (bk !== null) return 1
    return 0
  })
}

/**
 * CSVからロットの一覧を組み立てる。
 * 例外を投げない。読めないものは捨てて、捨てた件数を stats で返す。
 */
export function buildLots(table: RawTable, mapping: ColumnMapping): BuildResult {
  // ★ headers.indexOf(mapping[role]) を直接使わない。
  // 未割当は '' なので、空の列名がCSVにあると実在の添字を掴み、
  // 「工程順の列が無いのに有ると誤認 →並べ替えが効かず、行順のまま計算される」事故になる。
  const col = (role: keyof ColumnMapping) => columnIndex(table.headers, mapping[role])

  const iLot = col('lotKey')
  const iProcess = col('processKey')
  const iOrder = col('processOrder')
  const iStart = col('actualStart')
  const iEnd = col('actualEnd')
  const iName = col('processName')
  const iItem = col('itemCode')
  const iQty = col('quantity')
  const iUnit = col('unit')
  const iStd = col('standardTime')
  const iTotalStd = col('totalStandardTime')
  const iWc = col('workCenter')
  const iEq = col('equipment')

  const cell = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? '').trim() : '')

  const stats: BuildStats = {
    totalRows: table.rows.length,
    usedRows: 0,
    skippedNoLot: 0,
    skippedNoProcess: 0,
    lotsBuilt: 0,
    lotsSingleStep: 0,
    orderSource: iOrder >= 0 ? 'column' : 'time',
  }

  // ロットIDごとに工程を集める。Map なので出現順が保たれる
  const grouped = new Map<string, { lot: Lot; steps: Step[] }>()

  for (const row of table.rows) {
    const lotId = cell(row, iLot)
    if (lotId === '') {
      stats.skippedNoLot++
      continue
    }
    const processCode = cell(row, iProcess)
    if (processCode === '') {
      stats.skippedNoProcess++
      continue
    }

    const start = parseTimestamp(cell(row, iStart))
    const end = parseTimestamp(cell(row, iEnd))

    const step: Step = {
      lotId,
      processCode,
      processName: cell(row, iName) || processCode,
      order: parseNumber(cell(row, iOrder)),
      actualStart: start.date,
      actualEnd: end.date,
      dateOnly: start.dateOnly || end.dateOnly,
      standardMinutes: parseNumber(cell(row, iStd)),
      totalStandardMinutes: parseNumber(cell(row, iTotalStd)),
      workCenter: cell(row, iWc) || null,
      equipment: cell(row, iEq) || null,
    }

    let entry = grouped.get(lotId)
    if (!entry) {
      entry = {
        lot: {
          id: lotId,
          itemCode: null,
          quantity: null,
          unitFromCsv: null,
          steps: [],
        },
        steps: [],
      }
      grouped.set(lotId, entry)
    }

    // ロット単位の属性は各行に繰り返し入っている。最初に見つかった値を採用する
    if (entry.lot.itemCode === null) entry.lot.itemCode = cell(row, iItem) || null
    if (entry.lot.quantity === null) entry.lot.quantity = parseNumber(cell(row, iQty))
    if (entry.lot.unitFromCsv === null) entry.lot.unitFromCsv = cell(row, iUnit) || null

    entry.steps.push(step)
    stats.usedRows++
  }

  const useOrderColumn = stats.orderSource === 'column'
  const lots: Lot[] = []

  for (const { lot, steps } of grouped.values()) {
    if (steps.length === 0) continue // 空のロットは持たない
    lot.steps = sortSteps(steps, useOrderColumn)
    if (lot.steps.length === 1) stats.lotsSingleStep++
    lots.push(lot)
  }

  stats.lotsBuilt = lots.length
  return { lots, stats }
}
