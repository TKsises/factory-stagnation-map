import { describe, expect, it } from 'vitest'
import { parseNumber, parseTimestamp } from './datetime'

/** 期待値を先に書くためのヘルパー。Date の中身を人が読める形で比べる */
const iso = (d: Date | null) =>
  d === null
    ? null
    : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ` +
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`

describe('parseTimestamp', () => {
  it('エクスポートの書式（0埋め・秒あり）を読む', () => {
    const r = parseTimestamp('2026/08/17 14:30:05')
    expect(iso(r.date)).toBe('2026/08/17 14:30:05')
    expect(r.dateOnly).toBe(false)
  })

  it('取り込みテンプレートの書式（0埋め無し・秒無し）を読む', () => {
    const r = parseTimestamp('2023/1/1 10:00')
    expect(iso(r.date)).toBe('2023/01/01 10:00:00')
    expect(r.dateOnly).toBe(false)
  })

  it('ハイフン区切りを読む', () => {
    expect(iso(parseTimestamp('2026-08-17 14:30:00').date)).toBe('2026/08/17 14:30:00')
  })

  it('T区切りを読む', () => {
    expect(iso(parseTimestamp('2026-08-17T14:30:00').date)).toBe('2026/08/17 14:30:00')
  })

  it('日付だけの場合は dateOnly を立てる', () => {
    const r = parseTimestamp('2026/08/17')
    expect(iso(r.date)).toBe('2026/08/17 00:00:00')
    expect(r.dateOnly).toBe(true)
  })

  it('前後の空白を無視する', () => {
    expect(iso(parseTimestamp('  2026/08/17 14:30:00  ').date)).toBe('2026/08/17 14:30:00')
  })

  it('空文字は null（0時ではない）', () => {
    expect(parseTimestamp('').date).toBeNull()
    expect(parseTimestamp('   ').date).toBeNull()
  })

  it('null / undefined でも壊れない', () => {
    expect(parseTimestamp(null).date).toBeNull()
    expect(parseTimestamp(undefined).date).toBeNull()
  })

  it('存在しない月日を弾く', () => {
    expect(parseTimestamp('2026/13/01 10:00').date).toBeNull()
    expect(parseTimestamp('2026/02/30 10:00').date).toBeNull()
    expect(parseTimestamp('2026/00/10 10:00').date).toBeNull()
  })

  it('うるう年を正しく扱う', () => {
    expect(iso(parseTimestamp('2024/02/29').date)).toBe('2024/02/29 00:00:00')
    expect(parseTimestamp('2026/02/29').date).toBeNull()
  })

  it('ありえない時刻を弾く', () => {
    expect(parseTimestamp('2026/08/17 25:00').date).toBeNull()
    expect(parseTimestamp('2026/08/17 10:70').date).toBeNull()
  })

  it('日時でない文字列を弾く（0や今日に化けさせない）', () => {
    expect(parseTimestamp('未実施').date).toBeNull()
    expect(parseTimestamp('-').date).toBeNull()
    expect(parseTimestamp('2026/08').date).toBeNull()
  })
})

describe('parseNumber', () => {
  it('数値を読む', () => {
    expect(parseNumber('300')).toBe(300)
    expect(parseNumber('12.5')).toBe(12.5)
  })

  it('桁区切りのカンマを外す', () => {
    expect(parseNumber('1,234')).toBe(1234)
  })

  it('空は null（0ではない）', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('  ')).toBeNull()
    expect(parseNumber(null)).toBeNull()
  })

  it('数値でない文字列は null', () => {
    expect(parseNumber('該当なし')).toBeNull()
  })
})
