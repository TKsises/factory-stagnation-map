// ============================================================
// 日時の解析
//
// new Date(文字列) には絶対に渡さない。
// '2023/1/1' の解釈がブラウザ・環境で揺れるため、自前で分解して組み立てる。
//
// 受け付ける形（フェーズ0で確認した実物 + 顧客がExcelで加工した場合の備え）:
//   2026/08/17 14:30:00   ← エクスポートの書式
//   2026/8/17 14:30       ← 取り込みテンプレートの書式（0埋め無し・秒無し）
//   2026-08-17 14:30:00
//   2026-08-17T14:30:00
//   2026/08/17            ← 日付だけ（Excelで丸められた場合）
// ============================================================

export type ParsedTime = {
  date: Date | null
  /** 日付だけで時刻が無かった */
  dateOnly: boolean
}

const PATTERN =
  /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?\s*$/

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28
  return DAYS_IN_MONTH[m - 1]
}

/**
 * 文字列を日時にする。解釈できないものは null を返す。
 * ここで「0にする」「今日にする」といった補完をしてはいけない。
 * 計算できないものを0にすると、滞留が実際より小さく出る。
 */
export function parseTimestamp(raw: string | null | undefined): ParsedTime {
  if (raw == null) return { date: null, dateOnly: false }
  const s = raw.trim()
  if (s === '') return { date: null, dateOnly: false }

  const m = PATTERN.exec(s)
  if (!m) return { date: null, dateOnly: false }

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hasTime = m[4] !== undefined
  const hour = hasTime ? Number(m[4]) : 0
  const minute = hasTime ? Number(m[5]) : 0
  const second = m[6] !== undefined ? Number(m[6]) : 0

  if (month < 1 || month > 12) return { date: null, dateOnly: false }
  if (day < 1 || day > daysInMonth(year, month)) return { date: null, dateOnly: false }
  if (hour > 23 || minute > 59 || second > 59) return { date: null, dateOnly: false }

  const date = new Date(year, month - 1, day, hour, minute, second, 0)
  return { date, dateOnly: !hasTime }
}

/** 数値の列を読む。空文字・解釈できない文字は null（0にしない） */
export function parseNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const s = raw.trim().replace(/,/g, '')
  if (s === '') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}
