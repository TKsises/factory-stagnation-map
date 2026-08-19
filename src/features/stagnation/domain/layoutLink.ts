// ============================================================
// 工程 ↔ レイアウト の接着
//
// ★対応づけは手で作る。名前の類似から自動で紐づけない（必ず間違える）。
//   「表面処理」と「表面処理機A」を勝手に結ぶと、誰も気づかないまま
//   別の場所に金額が乗った図が出て行く。
//
// ★対応が付いていない工程は地図に出さず、件数を明示する。
//   黙って描かないのが一番まずい（少なく見えてしまう）。
//
// 位置の上に載せてよいのは「位置の上で見ると判断が変わるもの」だけ（基準B）。
// 稼働率・不良率・時系列推移などは、表やグラフで見ればよいので載せない。
// ============================================================

import { itemCenter, type LayoutItem, type LayoutView } from './layout'
import type { Metrics } from './metrics'

export type Pt = { x: number; y: number }

/** 工程間の滞留を、レイアウトの上の帯として表したもの */
export type StagnationBand = {
  key: string
  fromProcess: string
  toProcess: string
  fromName: string
  toName: string
  /** 位置（メートル） */
  from: Pt
  to: Pt
  /** 動線の長さ（メートル）。位置が分かって初めて出せる数字 */
  distanceM: number
  calendarDaysMean: number
  amountJPY: number | null
  severity: 1 | 2 | 3
  count: number
  /** 距離 × 滞留日数。「遠い＋待つ」が重なる区間ほど大きい */
  distanceDayScore: number
}

export type LinkReport = {
  bands: StagnationBand[]
  /** 対応づけができている工程の数 */
  linkedCount: number
  /** 対応づけができていない工程（コードと名前） */
  unlinked: { code: string; name: string }[]
  /** 両端がそろわず、地図に描けなかった工程間の数 */
  undrawablePairs: number
  /** 描けなかった工程間に含まれる滞留の合計（暦・日）。隠さず出す */
  undrawableDaysMean: number
  /** 「遠い＋待つ」が重なる区間の上位。位置の上で見て初めて分かるもの */
  worstByDistance: StagnationBand[]
}

const distance = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)

/**
 * 対応表をもとに、滞留の帯を組み立てる。
 * processLayout は「工程コード → レイアウトの管理番号」。
 */
export function buildBands(
  metrics: Metrics,
  layout: LayoutView,
  processLayout: Record<string, string>
): LinkReport {
  // 管理番号 → レイアウト要素
  const byCode = new Map<string, LayoutItem>()
  for (const item of layout.codedItems) {
    // 同じ管理番号が複数あるときは最初のものを使う（対応表の選択肢も先頭に出る）
    if (item.code !== null && !byCode.has(item.code)) byCode.set(item.code, item)
  }

  /** 工程コード → レイアウト上の位置。対応が無ければ null */
  const posOf = (processCode: string): Pt | null => {
    const code = processLayout[processCode]
    if (!code) return null
    const item = byCode.get(code)
    return item ? itemCenter(item) : null
  }

  const unlinked: { code: string; name: string }[] = []
  let linkedCount = 0
  for (const node of metrics.flow) {
    if (posOf(node.code) === null) unlinked.push({ code: node.code, name: node.name })
    else linkedCount++
  }

  const bands: StagnationBand[] = []
  let undrawablePairs = 0
  let undrawableDaysMean = 0

  for (const pair of metrics.pairs) {
    const from = posOf(pair.fromProcess)
    const to = posOf(pair.toProcess)

    if (from === null || to === null) {
      undrawablePairs++
      undrawableDaysMean += pair.calendarDaysMean
      continue
    }

    const distanceM = distance(from, to)
    bands.push({
      key: pair.key,
      fromProcess: pair.fromProcess,
      toProcess: pair.toProcess,
      fromName: pair.fromName,
      toName: pair.toName,
      from,
      to,
      distanceM,
      calendarDaysMean: pair.calendarDaysMean,
      amountJPY: pair.amountJPY,
      severity: pair.severity,
      count: pair.count,
      distanceDayScore: distanceM * pair.calendarDaysMean,
    })
  }

  const worstByDistance = [...bands]
    .filter(b => b.distanceM > 0)
    .sort((a, b) => b.distanceDayScore - a.distanceDayScore)
    .slice(0, 3)

  return {
    bands,
    linkedCount,
    unlinked,
    undrawablePairs,
    undrawableDaysMean,
    worstByDistance,
  }
}

/**
 * 帯の太さの下限と上限。
 * ★下限が 2px だと、いちばん太い帯が 4.0日・他が 0.8〜1.3日 のような
 *   偏った工場で、細い側が「線」に見えて帯として読めなくなる。
 *   原価を入れる前でも図が読めるように、下限を上げる。
 */
export const BAND_MIN_WIDTH = 6
export const BAND_MAX_WIDTH = 22

/**
 * 帯の太さ。金額があれば金額、無ければ滞留日数を基準にする。
 * ★比率は歪めない（0.8日と0.9日を無理に描き分けようとすると図が嘘になる）。
 *   細かい差は帯の上の数字で読む。太さは「どこが重いか」だけを伝える。
 */
export function bandWidth(band: StagnationBand, bands: StagnationBand[]): number {
  const useAmount = bands.every(b => b.amountJPY !== null)
  const value = useAmount ? (band.amountJPY ?? 0) : band.calendarDaysMean
  const max = bands.reduce(
    (m, b) => Math.max(m, useAmount ? (b.amountJPY ?? 0) : b.calendarDaysMean),
    0
  )
  const ratio = max <= 0 ? 0 : value / max
  return BAND_MIN_WIDTH + ratio * (BAND_MAX_WIDTH - BAND_MIN_WIDTH)
}

/** 対応表がまだ1件も無いか */
export function hasNoLinks(processLayout: Record<string, string>): boolean {
  return Object.values(processLayout).every(v => !v)
}
