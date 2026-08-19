import { describe, expect, it } from 'vitest'
import { normalizeConfig } from './storage'
import { CONFIG_VERSION, DEFAULT_CALENDAR, EMPTY_MAPPING } from './types'

describe('normalizeConfig ― 壊れた入力でクラッシュしない', () => {
  it('null / undefined を既定値にする', () => {
    expect(normalizeConfig(null).mapping).toEqual(EMPTY_MAPPING)
    expect(normalizeConfig(undefined).calendar).toEqual(DEFAULT_CALENDAR)
  })

  it('配列や文字列を渡されても既定値にする', () => {
    expect(normalizeConfig([1, 2, 3]).mapping).toEqual(EMPTY_MAPPING)
    expect(normalizeConfig('壊れています').seq).toBe(0)
  })

  it('mapping の未知の鍵を捨てる', () => {
    const c = normalizeConfig({ mapping: { lotKey: '製造指示番号', 知らない鍵: 'x' } })
    expect(c.mapping.lotKey).toBe('製造指示番号')
    expect(Object.keys(c.mapping).sort()).toEqual(Object.keys(EMPTY_MAPPING).sort())
  })

  it('mapping の値が文字列でなければ空にする', () => {
    const c = normalizeConfig({ mapping: { lotKey: 42, actualStart: null } })
    expect(c.mapping.lotKey).toBe('')
    expect(c.mapping.actualStart).toBe('')
  })
})

describe('normalizeConfig ― seq（ID採番カウンタ）', () => {
  it('保存された値をそのまま使う', () => {
    expect(normalizeConfig({ seq: 57 }).seq).toBe(57)
  })

  it('負の数・小数・文字列は 0 に戻す', () => {
    expect(normalizeConfig({ seq: -1 }).seq).toBe(0)
    expect(normalizeConfig({ seq: 3.5 }).seq).toBe(0)
    expect(normalizeConfig({ seq: '10' }).seq).toBe(0)
  })
})

describe('normalizeConfig ― 稼働カレンダー', () => {
  it('正しい値を保つ', () => {
    const c = normalizeConfig({
      calendar: { workdays: [1, 2, 3], startHM: '09:00', endHM: '18:00', holidays: ['2026-05-03'] },
    })
    expect(c.calendar).toEqual({
      workdays: [1, 2, 3],
      startHM: '09:00',
      endHM: '18:00',
      holidays: ['2026-05-03'],
    })
  })

  it('範囲外の曜日を捨て、重複を除く', () => {
    const c = normalizeConfig({ calendar: { workdays: [1, 1, 7, -2, 5] } })
    expect(c.calendar.workdays).toEqual([1, 5])
  })

  // 回帰: 稼働日0日だと稼働時間が常に0になり「改善余地ゼロ」という嘘が黙って出る
  it('稼働日が空なら既定（月〜金）に戻す', () => {
    expect(normalizeConfig({ calendar: { workdays: [] } }).calendar.workdays).toEqual([1, 2, 3, 4, 5])
    expect(normalizeConfig({ calendar: { workdays: [9, -1] } }).calendar.workdays).toEqual([
      1, 2, 3, 4, 5,
    ])
  })

  it('時刻の形式が不正なら既定に戻す', () => {
    const c = normalizeConfig({ calendar: { startHM: '25:00', endHM: 'あさ' } })
    expect(c.calendar.startHM).toBe('08:30')
    expect(c.calendar.endHM).toBe('17:30')
  })

  it('開始が終了以降なら既定に戻す（稼働0時間でゼロ除算しないため）', () => {
    const c = normalizeConfig({ calendar: { startHM: '18:00', endHM: '09:00' } })
    expect(c.calendar.startHM).toBe('08:30')
    expect(c.calendar.endHM).toBe('17:30')
  })

  it('休日の形式が不正なものを捨てる', () => {
    const c = normalizeConfig({ calendar: { holidays: ['2026-05-03', '5/3', 42, null] } })
    expect(c.calendar.holidays).toEqual(['2026-05-03'])
  })
})

describe('normalizeConfig ― 原価', () => {
  it('正しい単価を保つ', () => {
    const c = normalizeConfig({ costs: { MA000001: { unitCost: 1200, unit: 'ピース' } } })
    expect(c.costs.MA000001).toEqual({ unitCost: 1200, unit: 'ピース' })
  })

  it('0円・負・非数値の単価を捨てる（未設定と区別できないため）', () => {
    const c = normalizeConfig({
      costs: {
        A: { unitCost: 0, unit: 'kg' },
        B: { unitCost: -5, unit: 'kg' },
        C: { unitCost: '1200', unit: 'kg' },
        D: { unitCost: Number.NaN, unit: 'kg' },
        E: { unitCost: 100, unit: 'kg' },
      },
    })
    expect(Object.keys(c.costs)).toEqual(['E'])
  })
})

describe('normalizeConfig ― 版', () => {
  // 回帰: version を保存していながら一度も見ておらず、古い設定がそのまま流れ込んでいた
  it('読み込んだ設定は必ず現行版として書き戻す', () => {
    expect(normalizeConfig({ version: 0 }).version).toBe(CONFIG_VERSION)
    expect(normalizeConfig({ version: 'x' }).version).toBe(CONFIG_VERSION)
    expect(normalizeConfig(null).version).toBe(CONFIG_VERSION)
  })
})

describe('normalizeConfig ― レイアウト対応表', () => {
  it('文字列の対応だけを残す', () => {
    const c = normalizeConfig({ processLayout: { P010: 'EQ-001', P020: 42, P030: '' } })
    expect(c.processLayout).toEqual({ P010: 'EQ-001' })
  })

  it('対応キーの種類が不正なら process に戻す', () => {
    expect(normalizeConfig({ layoutKeyKind: 'でたらめ' }).layoutKeyKind).toBe('process')
    expect(normalizeConfig({ layoutKeyKind: 'workCenter' }).layoutKeyKind).toBe('workCenter')
  })
})

describe('normalizeConfig ― API中継サーバーのURL', () => {
  it('http / https は通す', () => {
    expect(normalizeConfig({ apiRelayBase: 'https://r.workers.dev' }).apiRelayBase).toBe(
      'https://r.workers.dev'
    )
    expect(normalizeConfig({ apiRelayBase: 'http://localhost:8787' }).apiRelayBase).toBe(
      'http://localhost:8787'
    )
  })

  it('★http / https 以外は捨てる', () => {
    // 設定はJSONで書き出し・読み込みできるので、外から来る値として扱う。
    // javascript: を仕込まれたものをそのまま fetch しない
    expect(normalizeConfig({ apiRelayBase: 'javascript:alert(1)' }).apiRelayBase).toBe('')
    expect(normalizeConfig({ apiRelayBase: 'data:text/html,x' }).apiRelayBase).toBe('')
    expect(normalizeConfig({ apiRelayBase: 'ふつうの文字列' }).apiRelayBase).toBe('')
    expect(normalizeConfig({ apiRelayBase: 42 }).apiRelayBase).toBe('')
  })

  it('末尾のスラッシュを落とす', () => {
    expect(normalizeConfig({ apiRelayBase: 'https://r.workers.dev///' }).apiRelayBase).toBe(
      'https://r.workers.dev'
    )
  })

  it('未設定なら空', () => {
    expect(normalizeConfig(null).apiRelayBase).toBe('')
  })
})
