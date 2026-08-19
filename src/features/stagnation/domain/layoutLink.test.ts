import { describe, expect, it } from 'vitest'
import {
  BAND_MAX_WIDTH,
  BAND_MIN_WIDTH,
  bandWidth,
  hasNoLinks,
  type StagnationBand,
} from './layoutLink'

/** 太さの検証に要る項目だけ埋めた帯 */
function band(days: number, amountJPY: number | null = null): StagnationBand {
  return {
    key: `k${days}-${amountJPY}`,
    fromProcess: 'A',
    toProcess: 'B',
    fromName: 'A',
    toName: 'B',
    from: { x: 0, y: 0 },
    to: { x: 1, y: 0 },
    distanceM: 1,
    calendarDaysMean: days,
    amountJPY,
    severity: 1,
    count: 10,
    distanceDayScore: days,
  }
}

describe('帯の太さ', () => {
  // ★実データで出た並び。4.0日が1本だけ突出し、他は0.8〜1.3日に固まっている。
  //   下限が2pxだと細い側が「線」に見えて、原価を入れる前は図が読めなかった。
  const 偏った工場 = [band(0.8), band(0.9), band(0.9), band(1.1), band(1.3), band(4.0)]

  it('いちばん細い帯でも下限を割らない', () => {
    const widths = 偏った工場.map(b => bandWidth(b, 偏った工場))
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(BAND_MIN_WIDTH)
  })

  it('★細い帯が「線」に見えない太さになる', () => {
    // 0.8日（最大の2割）でも 9px 以上。以前の式では 5.2px だった
    expect(bandWidth(band(0.8), 偏った工場)).toBeGreaterThan(9)
  })

  it('いちばん太い帯が上限になる', () => {
    expect(bandWidth(band(4.0), 偏った工場)).toBeCloseTo(BAND_MAX_WIDTH)
  })

  it('★比率は歪めない（太さの比が値の比とずれない）', () => {
    // 下限を持ち上げたぶんを引くと、元の比率がそのまま残っている
    const w = (d: number) => bandWidth(band(d), 偏った工場) - BAND_MIN_WIDTH
    expect(w(2.0) / w(4.0)).toBeCloseTo(0.5)
    expect(w(1.0) / w(4.0)).toBeCloseTo(0.25)
  })

  it('金額が全部そろっていれば金額を基準にする', () => {
    // 日数は同じでも金額が違えば太さが変わる
    const bs = [band(1, 100), band(1, 400)]
    expect(bandWidth(bs[0], bs)).toBeLessThan(bandWidth(bs[1], bs))
  })

  it('金額が1つでも欠けていれば日数を基準にする', () => {
    // 未設定を0円として混ぜると、その区間が不当に細く出てしまう
    const bs = [band(4, null), band(1, 400)]
    expect(bandWidth(bs[0], bs)).toBeGreaterThan(bandWidth(bs[1], bs))
  })

  it('全部0でも消えない', () => {
    const bs = [band(0), band(0)]
    expect(bandWidth(bs[0], bs)).toBe(BAND_MIN_WIDTH)
  })
})

describe('対応表がまだ空か', () => {
  it('全部未選択なら空とみなす', () => {
    expect(hasNoLinks({ P010: '', P020: '' })).toBe(true)
  })

  it('1つでも選ばれていれば空ではない', () => {
    expect(hasNoLinks({ P010: '', P020: 'EQ-P020' })).toBe(false)
  })
})
