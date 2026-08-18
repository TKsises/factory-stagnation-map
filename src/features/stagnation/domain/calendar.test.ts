import { describe, expect, it } from 'vitest'
import { calendarHoursBetween, prepareCalendar, workingHoursBetween } from './calendar'
import { DEFAULT_CALENDAR } from './types'
import type { WorkCalendar } from './types'

// 既定：月〜金 8:30-17:30（1日9時間）
const CAL = DEFAULT_CALENDAR

// 2026-05-08 は金曜、2026-05-11 は月曜（曜日は手で確認済み）
const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m - 1, day, h, min)

describe('曜日の前提が崩れていないこと', () => {
  it('2026-05-08 は金曜、2026-05-11 は月曜', () => {
    expect(d(2026, 5, 8).getDay()).toBe(5)
    expect(d(2026, 5, 11).getDay()).toBe(1)
  })
})

describe('calendarHoursBetween', () => {
  it('そのままの経過時間を返す', () => {
    expect(calendarHoursBetween(d(2026, 5, 11, 10, 0), d(2026, 5, 11, 12, 30))).toBe(2.5)
  })

  it('逆転していたら 0（負の値を返さない）', () => {
    expect(calendarHoursBetween(d(2026, 5, 11, 12, 0), d(2026, 5, 11, 10, 0))).toBe(0)
  })
})

describe('★金曜17:00 → 月曜8:30（必ず通すべきケース）', () => {
  const from = d(2026, 5, 8, 17, 0) // 金
  const to = d(2026, 5, 11, 8, 30) // 月

  it('暦時間は 63.5 時間', () => {
    expect(calendarHoursBetween(from, to)).toBe(63.5)
  })

  it('稼働時間は 0.5 時間（金曜の17:00-17:30だけ。土日は工場が動いていない）', () => {
    expect(workingHoursBetween(from, to, CAL)).toBe(0.5)
  })
})

describe('workingHoursBetween ― 基本', () => {
  it('同じ日の稼働時間内', () => {
    expect(workingHoursBetween(d(2026, 5, 11, 10, 0), d(2026, 5, 11, 12, 0), CAL)).toBe(2)
  })

  it('稼働時間の外にはみ出した分は数えない', () => {
    // 7:00 開始 → 実際に数えるのは 8:30 から
    expect(workingHoursBetween(d(2026, 5, 11, 7, 0), d(2026, 5, 11, 10, 0), CAL)).toBe(1.5)
  })

  it('夜をまたぐと、その分は数えない', () => {
    // 月17:00 → 火9:00：月の 0.5h ＋ 火の 0.5h
    expect(workingHoursBetween(d(2026, 5, 11, 17, 0), d(2026, 5, 12, 9, 0), CAL)).toBe(1)
  })

  it('土日だけの区間は 0 時間', () => {
    expect(workingHoursBetween(d(2026, 5, 9, 10, 0), d(2026, 5, 10, 14, 0), CAL)).toBe(0)
  })

  it('逆転していたら 0', () => {
    expect(workingHoursBetween(d(2026, 5, 12, 10, 0), d(2026, 5, 11, 10, 0), CAL)).toBe(0)
  })

  it('同時刻なら 0', () => {
    expect(workingHoursBetween(d(2026, 5, 11, 10, 0), d(2026, 5, 11, 10, 0), CAL)).toBe(0)
  })
})

describe('workingHoursBetween ― 長い期間', () => {
  it('1週間（月8:30 → 翌月8:30）は 45 時間（9時間 × 平日5日）', () => {
    expect(workingHoursBetween(d(2026, 5, 11, 8, 30), d(2026, 5, 18, 8, 30), CAL)).toBe(45)
  })

  it('休業日を差し引く', () => {
    const withHoliday: WorkCalendar = { ...CAL, holidays: ['2026-05-13'] } // 水曜
    expect(workingHoursBetween(d(2026, 5, 11, 8, 30), d(2026, 5, 18, 8, 30), withHoliday)).toBe(36)
  })

  it('壊れた日付（何十年もの差）でも固まらず、値を返す', () => {
    const t0 = performance.now()
    const hours = workingHoursBetween(d(1900, 1, 1, 9, 0), d(2026, 5, 11, 9, 0), CAL)
    const elapsed = performance.now() - t0
    expect(hours).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(50) // 日を1つずつ回していたら固まる
  })
})

describe('回帰: 休業日を増やしても遅くならない', () => {
  it('休業日300件でも、0件のときと比べて極端に遅くならない', () => {
    const many: string[] = []
    const cursor = new Date(2025, 0, 1)
    for (let i = 0; i < 300; i++) {
      cursor.setDate(cursor.getDate() + 4)
      const p = (n: number) => String(n).padStart(2, '0')
      many.push(`${cursor.getFullYear()}-${p(cursor.getMonth() + 1)}-${p(cursor.getDate())}`)
    }

    // 工程間が数日にまたがる呼び出しを1万回。実データの滞留（平均5日前後）に近い形
    const measure = (cal: WorkCalendar) => {
      const prepared = prepareCalendar(cal)
      const t0 = performance.now()
      for (let i = 0; i < 10000; i++) {
        const from = new Date(2026, 3, 1 + (i % 60), 9, 0)
        const to = new Date(from.getTime() + 5 * 86400000)
        workingHoursBetween(from, to, prepared)
      }
      return performance.now() - t0
    }

    measure(CAL) // ウォームアップ
    const withHolidays = measure({ ...CAL, holidays: many })
    // 絶対値で見る。比率だと計測ノイズで揺れて、意味の無い失敗が出る。
    // 前処理せず休業日を毎回走査していた頃は、この条件で秒単位かかっていた。
    expect(withHolidays).toBeLessThan(500)
  })

  it('前処理しても結果が変わらない', () => {
    const cal: WorkCalendar = { ...CAL, holidays: ['2026-05-13'] }
    const from = d(2026, 5, 11, 8, 30)
    const to = d(2026, 5, 18, 8, 30)
    expect(workingHoursBetween(from, to, prepareCalendar(cal))).toBe(
      workingHoursBetween(from, to, cal)
    )
  })

  it('休業日が区間の端の日でも引かれる', () => {
    // 火曜(12日)を休業日にする。月8:30→水8:30 のうち、月9h ＋ 火0h
    const cal: WorkCalendar = { ...CAL, holidays: ['2026-05-12'] }
    expect(workingHoursBetween(d(2026, 5, 11, 8, 30), d(2026, 5, 13, 8, 30), cal)).toBe(9)
  })
})

describe('workingHoursBetween ― カレンダーの設定を変える', () => {
  it('土曜も稼働日にできる', () => {
    const sixDays: WorkCalendar = { ...CAL, workdays: [1, 2, 3, 4, 5, 6] }
    // 金17:00 → 月8:30 のうち、金0.5h ＋ 土9h
    expect(workingHoursBetween(d(2026, 5, 8, 17, 0), d(2026, 5, 11, 8, 30), sixDays)).toBe(9.5)
  })

  it('稼働日が1日も無ければ 0', () => {
    const none: WorkCalendar = { ...CAL, workdays: [] }
    expect(workingHoursBetween(d(2026, 5, 11, 9, 0), d(2026, 5, 18, 9, 0), none)).toBe(0)
  })
})
