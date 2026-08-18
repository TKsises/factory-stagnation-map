// ============================================================
// 暦時間と稼働時間
//
// 金曜17時に工程Aが終わり、月曜8時30分に工程Bが始まったとする。
//   暦時間  = 63.5 時間
//   稼働時間 = 0.5 時間（金曜の17:00-17:30だけ。土日は工場が動いていない）
//
// 暦時間だけで「63.5時間止まっています」と出すと、現場を知っている決裁者に見抜かれる。
// 一方で、金額の計算に使うのは暦時間である（在庫は休日も凍っているため）。
// 改善余地の議論に使うのは稼働時間（休日は縮められないため）。この使い分けを画面に明記する。
// ============================================================

import type { WorkCalendar } from './types'

const MS_PER_HOUR = 3600000
const MS_PER_DAY = 86400000

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':')
  return Number(h) * 60 + Number(m)
}

/** ローカル日付を「日番号」にする。ミリ秒の割り算だと夏時間でずれる国があるため */
function dayIndex(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY)
}

function dateFromDayIndex(index: number): Date {
  const utc = new Date(index * MS_PER_DAY)
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate())
}

// ── 前処理 ───────────────────────────────────────────────
// ★カレンダーは「1回だけ」前処理して、工程間ごとの計算には前処理済みの形を渡す。
//   毎回 Set を作り直し、休業日ごとに文字列を分解して Date を作っていたため、
//   休業日90件（日本の製造業3年分の現実的な件数）で集計が 59ms → 862ms に落ちていた。

export type PreparedCalendar = {
  workdays: Set<number>
  /** 稼働曜日にあたる休業日だけを「日番号」にして昇順で持つ。二分探索で数える */
  holidayDays: number[]
  startMin: number
  endMin: number
  minutesPerDay: number
}

export function prepareCalendar(cal: WorkCalendar): PreparedCalendar {
  const workdays = new Set(cal.workdays)
  const holidayDays: number[] = []

  for (const h of cal.holidays) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(h)
    if (!m) continue
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    // もともと非稼働の曜日にある休業日は数えても引く分が無いので、ここで捨てる
    if (!workdays.has(d.getDay())) continue
    holidayDays.push(dayIndex(d))
  }
  holidayDays.sort((a, b) => a - b)

  const startMin = hmToMinutes(cal.startHM)
  const endMin = hmToMinutes(cal.endHM)
  return { workdays, holidayDays, startMin, endMin, minutesPerDay: endMin - startMin }
}

const isPrepared = (c: WorkCalendar | PreparedCalendar): c is PreparedCalendar =>
  Array.isArray((c as PreparedCalendar).holidayDays)

/** 昇順配列の中で value 以上が最初に現れる位置 */
function lowerBound(xs: number[], value: number): number {
  let lo = 0
  let hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (xs[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 日番号 [a,b]（両端含む）にある休業日の件数。二分探索なので件数に依存しない */
function countHolidaysInRange(holidayDays: number[], a: number, b: number): number {
  if (holidayDays.length === 0) return 0
  return lowerBound(holidayDays, b + 1) - lowerBound(holidayDays, a)
}

/** その日が稼働日か */
function isWorkingDay(d: Date, cal: PreparedCalendar): boolean {
  if (!cal.workdays.has(d.getDay())) return false
  return countHolidaysInRange(cal.holidayDays, dayIndex(d), dayIndex(d)) === 0
}

/** 暦時間（そのままの経過時間） */
export function calendarHoursBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  return ms <= 0 ? 0 : ms / MS_PER_HOUR
}

/**
 * 稼働時間（夜間・休日・休業日を除いた時間）。
 *
 * 日を1つずつ回すと、壊れた日付（1900年など）を渡されたときに何万回も回って固まる。
 * そのため、間に挟まる完全な日は「週の掛け算」で数え、
 * 端の2日だけを個別に計算する。計算量が期間の長さに依存しない。
 */
export function workingHoursBetween(
  from: Date,
  to: Date,
  calendar: WorkCalendar | PreparedCalendar
): number {
  if (to.getTime() <= from.getTime()) return 0

  // 呼び出しごとに前処理してしまうと元の遅さに戻る。
  // 大量に呼ぶ側（computeGaps）は prepareCalendar() の結果を渡すこと。
  const cal = isPrepared(calendar) ? calendar : prepareCalendar(calendar)

  if (cal.workdays.size === 0 || cal.minutesPerDay <= 0) return 0

  /** その日の稼働窓と [from,to] の重なり（分） */
  const overlapOn = (day: Date): number => {
    if (!isWorkingDay(day, cal)) return 0
    const winStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, cal.startMin)
    const winEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, cal.endMin)
    const lo = Math.max(from.getTime(), winStart.getTime())
    const hi = Math.min(to.getTime(), winEnd.getTime())
    return hi <= lo ? 0 : (hi - lo) / 60000
  }

  const fromDay = dayIndex(from)
  const toDay = dayIndex(to)

  if (fromDay === toDay) {
    return overlapOn(dateFromDayIndex(fromDay)) / 60
  }

  let minutes = overlapOn(dateFromDayIndex(fromDay)) + overlapOn(dateFromDayIndex(toDay))

  // 間に完全に挟まる日を数える（両端は上で処理済み）
  const innerFrom = fromDay + 1
  const innerTo = toDay - 1
  if (innerTo >= innerFrom) {
    minutes += countWorkingDays(innerFrom, innerTo, cal) * cal.minutesPerDay
  }

  return minutes / 60
}

/** 日番号 [a, b]（両端含む）の稼働日数。週の掛け算＋二分探索なので期間にも休業日数にも依存しない */
function countWorkingDays(a: number, b: number, cal: PreparedCalendar): number {
  const totalDays = b - a + 1
  if (totalDays <= 0) return 0

  const fullWeeks = Math.floor(totalDays / 7)
  let count = fullWeeks * cal.workdays.size

  // 端数の日（最大6日）だけ個別に見る
  const remainder = totalDays - fullWeeks * 7
  for (let i = 0; i < remainder; i++) {
    const d = dateFromDayIndex(b - i)
    if (cal.workdays.has(d.getDay())) count++
  }

  count -= countHolidaysInRange(cal.holidayDays, a, b)

  return Math.max(0, count)
}
