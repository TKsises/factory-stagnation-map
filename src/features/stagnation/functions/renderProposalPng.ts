// ============================================================
// 稟議に貼れる一枚（PNG書き出し）★このアプリの出口
//
// ゴールは「経営者が感心する画面」ではない。
// 「担当者が上司に説明でき、稟議に貼れる一枚」を吐き出すこと。
// 画像は口頭説明なしで渡るので、根拠が図の中に無いと決裁の場で必ず止まる。
//
// ★DOMを画像化しない。状態から Canvas に描き直す。
//   （外部ライブラリ不要で高解像度に出せる）
// ★純粋関数として dataURL を返す。ダウンロードは呼び出し側の責務。
// ★山の形は render/mapShape.ts を画面と共有する。
//   別々に描くと「画面では山なのに書き出すと別の形」になる。
// ============================================================

import type { LayoutView } from '../domain/layout'
import { bandWidth, type LinkReport } from '../domain/layoutLink'
import { BASIS_LABEL, formatDays, formatRate, type Metrics } from '../domain/metrics'
import { estimateReleasedJPY, formatJPY, formatManYen } from '../domain/money'
import { C, WORDING } from '../domain/theme'
import type { CostEntry, GapBasis } from '../domain/types'
import {
  bandCurve,
  curveMidpoint,
  fitLayout,
  itemFill,
  itemRect,
  traceBand,
} from '../render/layoutShape'
import {
  humpShape,
  humpSize,
  layoutMap,
  MAP,
  skipArc,
  traceHump,
  traceWrap,
} from '../render/mapShape'

const FONT_STACK = '"Yu Gothic UI", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif'

const SEV_COLOR: Record<1 | 2 | 3, string> = { 1: C.sev1, 2: C.sev2, 3: C.sev3 }

export type ProposalInput = {
  metrics: Metrics
  /** 削減試算に使う短縮日数（ユーザーがスライダーで決めた値） */
  shortenDays: number
  /** 元にしたCSVのファイル名。出所を図の中に残す */
  sourceFileName: string
  costs: Record<string, CostEntry>
  /** 出力の倍率。既定は2倍（印刷しても脚注が潰れない） */
  scale?: number
  /** 出力日。テストのために差し込めるようにしておく */
  now?: Date
  /**
   * 本体に何を描くか。
   * flow   … 工程の流れの上に滞留の山（経営・流れの話向け）
   * layout … 工場レイアウトの上に滞留の帯（現場責任者・位置の話向け）
   * 提案の相手によって効く一枚が違うので、2種類とも出せるようにする。
   */
  variant?: 'flow' | 'layout'
  layout?: LayoutView | null
  link?: LinkReport | null
}

const PAGE_W = 1180
const PAD = 40

const fmtDate = (d: Date | null) =>
  d === null ? '—' : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`

/** 脚注の本文を組み立てる。★ここを省略しない */
export function buildFootnotes(input: ProposalInput): string[] {
  const { metrics, costs, shortenDays, sourceFileName } = input
  const { summary, quality, money } = metrics

  const basisParts = (['actual', 'derived', 'date-only', 'excluded'] as GapBasis[])
    .map(b => `${BASIS_LABEL[b]} ${quality.basisPercents[b].toFixed(1)}%`)
    .join(' ／ ')

  const costParts = Object.entries(costs)
    .map(([code, c]) => `${code} ${c.unitCost.toLocaleString('ja-JP')}円/${c.unit || '単位未設定'}`)
    .join('、')

  const lines: string[] = [
    `算出根拠：読み込んだ ${quality.lotsTotal.toLocaleString()} 件のロットのうち、` +
      `全ての工程間を計算できた ${summary.rateLots.toLocaleString()} 件から算出。` +
      `${summary.rateExcludedLots.toLocaleString()} 件は工程間に欠損があるため除外（0として合計に混ぜていません）。`,
    `データの内訳：工程間 ${quality.pairsTotal.toLocaleString()} か所　${basisParts}` +
      `　工程の重なり ${quality.overlaps.toLocaleString()} 件`,
    '時間の数え方：金額は暦時間（在庫は休日も凍っているため）。改善余地の議論は稼働時間（休日は縮められないため）。',
  ]

  if (money.frozenJPY !== null) {
    lines.push(
      `原価の入力値：${costParts || '（未設定）'}　` +
        `金額を算出できたロット ${money.lotsPriced.toLocaleString()} 件` +
        (money.lotsNoCost > 0
          ? `　単価未設定 ${money.lotsNoCost.toLocaleString()} 件は計算から除外（実際の金額はこれより大きくなります）`
          : '')
    )
    lines.push(
      `試算の前提：1日あたり製造原価 ${formatJPY(money.dailyThroughputJPY)} × ${shortenDays.toFixed(1)} 日。` +
        `短縮日数はお客様の入力値です。${WORDING.estimateNote}`
    )
  } else {
    lines.push('原価の入力値：未設定のため金額は算出していません（0円として扱ってはいません）。')
  }

  // レイアウト重ね版のときは、地図に出ていない工程間があることを必ず書く。
  // 図だけを見ると実態より少なく見えるため。
  if (input.variant === 'layout' && input.link) {
    const { unlinked, undrawablePairs, undrawableDaysMean, linkedCount } = input.link
    if (unlinked.length > 0) {
      lines.push(
        `この図に出ていないもの：工程 ${metrics.flow.length} のうち ${linkedCount} だけをレイアウトに対応づけています。` +
          `未対応 ${unlinked.length} 件（${unlinked.map(u => u.name).join('、')}）のため、` +
          `${undrawablePairs} 本の工程間（平均 ${formatDays(undrawableDaysMean / Math.max(1, undrawablePairs))} の滞留）` +
          'をこの図では描いていません。図だけでは実態より少なく見えます。'
      )
    } else {
      lines.push(
        `レイアウト対応：工程 ${metrics.flow.length} 件すべてをレイアウト上の設備に対応づけています（対応づけは手作業）。`
      )
    }
  }

  lines.push(`データ出所：${sourceFileName}`)

  if (summary.plannedAsActual) {
    lines.unshift(
      '※この図は実績ではなく「予定」の列で計算した参考値です。滞留ではなく計画とのズレを表しています。'
    )
  }

  return lines
}

/** 折り返しながら文字を描き、次の y を返す */
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  let line = ''
  let cursorY = y
  for (const ch of text) {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line !== '') {
      ctx.fillText(line, x, cursorY)
      cursorY += lineHeight
      line = ch
    } else {
      line = test
    }
  }
  if (line !== '') {
    ctx.fillText(line, x, cursorY)
    cursorY += lineHeight
  }
  return cursorY
}

/** 折り返し後の行数を数える（高さを先に決めるため） */
function countWrapped(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): number {
  let line = ''
  let lines = 1
  for (const ch of text) {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line !== '') {
      lines++
      line = ch
    } else {
      line = test
    }
  }
  return lines
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * 提案図を描いて dataURL を返す。
 * ダウンロードはしない（呼び出し側の責務）。
 */
export function renderProposalPng(input: ProposalInput): string {
  const { metrics, shortenDays, scale = 2, now = new Date(), variant = 'flow' } = input
  const { flow, pairs, summary, money, worstCalendarDaysMean } = metrics
  const isLayout = variant === 'layout' && input.layout != null && input.link != null

  const rank = new Map(flow.map((n, i) => [n.code, i]))
  const skipping = pairs.filter(p => {
    const a = rank.get(p.fromProcess)
    const b = rank.get(p.toProcess)
    return a !== undefined && b !== undefined && b - a !== 1
  })

  const footnotes = buildFootnotes(input)

  // ── 高さを先に決める ──
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) throw new Error('Canvas を使えません')
  probe.font = `12px ${FONT_STACK}`
  const footWidth = PAGE_W - PAD * 2
  const footLines = footnotes.reduce((a, t) => a + countWrapped(probe, t, footWidth), 0)

  const headerH = 108
  const bandH = 118
  const LAYOUT_AREA_H = 470
  // 折り返した結果の実際の高さを使う。工程数が多いと段が増える
  const flowLayout = layoutMap(flow, PAGE_W - PAD * 2)
  const flowScale = Math.min(1, (PAGE_W - PAD * 2) / Math.max(1, flowLayout.width))
  const mapAreaH = isLayout ? LAYOUT_AREA_H + 20 : flowLayout.height * flowScale + 24
  const footH = 30 + footLines * 19 + 16
  const PAGE_H = headerH + mapAreaH + bandH + footH + PAD

  // ── 描画 ──
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_W * scale
  canvas.height = PAGE_H * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas を使えません')
  ctx.scale(scale, scale)
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)

  // ── ① ヘッダー ──
  ctx.fillStyle = C.text
  ctx.font = `bold 26px ${FONT_STACK}`
  ctx.fillText(
    isLayout ? '工場のどこで、いくらが止まっているか' : '工程間の滞留と、そこに凍っている金額',
    PAD,
    PAD + 22
  )

  ctx.font = `13px ${FONT_STACK}`
  ctx.fillStyle = C.textSub
  const period = `対象期間 ${fmtDate(summary.periodFrom)} 〜 ${fmtDate(summary.periodTo)}`
  const lots = `対象ロット ${summary.rateLots.toLocaleString()} 件（読み込み ${metrics.quality.lotsTotal.toLocaleString()} 件）`
  const printed = `出力日 ${fmtDate(now)}`
  ctx.fillText(`${period}　／　${lots}　／　${printed}`, PAD, PAD + 46)

  ctx.fillStyle = C.textFaint
  ctx.font = `12px ${FONT_STACK}`
  ctx.fillText(WORDING.factNote, PAD, PAD + 68)

  if (summary.plannedAsActual) {
    ctx.fillStyle = C.warnSoft
    roundRect(ctx, PAGE_W - PAD - 210, PAD + 6, 210, 30, 6)
    ctx.fill()
    ctx.fillStyle = C.warn
    ctx.font = `bold 14px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.fillText('予定ベース（参考値）', PAGE_W - PAD - 105, PAD + 26)
    ctx.textAlign = 'left'
  }

  ctx.strokeStyle = C.border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, headerH - 6)
  ctx.lineTo(PAGE_W - PAD, headerH - 6)
  ctx.stroke()

  // ── ② 本体 ──
  if (isLayout) {
    drawLayoutBody(ctx, input.layout!, input.link!, headerH + 10, PAGE_W - PAD * 2, LAYOUT_AREA_H)
  } else {
  // 画面と同じ layoutMap を使う。別々に配置を決めると図がずれる
  const mapLayout = layoutMap(flow, PAGE_W - PAD * 2)
  const mapScale = Math.min(1, (PAGE_W - PAD * 2) / Math.max(1, mapLayout.width))
  ctx.save()
  ctx.translate(PAD + ((PAGE_W - PAD * 2) - mapLayout.width * mapScale) / 2, headerH + 10)
  ctx.scale(mapScale, mapScale)

  // 行をまたぐ渡り
  for (const l of mapLayout.links) {
    if (l.kind !== 'wrap' || !l.path) continue
    ctx.strokeStyle = C.borderStrong
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    traceWrap(ctx, l.path)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 工程を飛ばした流れ
  for (const pair of skipping) {
    const a = mapLayout.byCode.get(pair.fromProcess)
    const b = mapLayout.byCode.get(pair.toProcess)
    if (!a || !b) continue
    const arc = skipArc(a, b)
    ctx.strokeStyle = SEV_COLOR[pair.severity]
    ctx.globalAlpha = 0.4
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 3])
    ctx.beginPath()
    ctx.moveTo(arc.from[0], arc.from[1])
    ctx.quadraticCurveTo(arc.ctrl[0], arc.ctrl[1], arc.to[0], arc.to[1])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  const byKey = new Map(pairs.map(p => [p.key, p]))

  // 同じ行の隣どうし：つなぎ線と、その上に立つ山
  for (const l of mapLayout.links) {
    if (l.kind !== 'inline') continue
    const pair = byKey.get(l.key)
    const left = l.cx - MAP.gapW / 2
    const right = l.cx + MAP.gapW / 2

    if (!pair || pair.count === 0) {
      ctx.strokeStyle = C.border
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(left, l.cy)
      ctx.lineTo(right, l.cy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = C.textFaint
      ctx.font = `10px ${FONT_STACK}`
      ctx.textAlign = 'center'
      ctx.fillText('データなし', l.cx, l.cy - 8)
      ctx.textAlign = 'left'
      continue
    }

    const ratio = worstCalendarDaysMean === 0 ? 0 : pair.calendarDaysMean / worstCalendarDaysMean
    const { height, width } = humpSize(ratio)
    const shape = humpShape(l.cx, l.cy, width, height)
    const color = SEV_COLOR[pair.severity]

    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(left, l.cy)
    ctx.lineTo(right, l.cy)
    ctx.stroke()

    traceHump(ctx, shape)
    ctx.globalAlpha = 0.62
    ctx.fillStyle = color
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.fillStyle = C.textFaint
    ctx.font = `9.5px ${FONT_STACK}`
    ctx.fillText(`${pair.count.toLocaleString()} 件`, l.cx, l.cy + 13)

    const boxH = pair.amountJPY === null ? 17 : 28
    ctx.fillStyle = '#ffffff'
    ctx.globalAlpha = 0.92
    roundRect(ctx, l.cx - 40, shape.peakY - 30, 80, boxH, 4)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    roundRect(ctx, l.cx - 40, shape.peakY - 30, 80, boxH, 4)
    ctx.stroke()

    ctx.fillStyle = C.text
    ctx.font = `bold 12px ${FONT_STACK}`
    ctx.fillText(formatDays(pair.calendarDaysMean), l.cx, shape.peakY - 18)
    if (pair.amountJPY !== null) {
      ctx.fillStyle = C.accent
      ctx.font = `bold 10px ${FONT_STACK}`
      ctx.fillText(formatManYen(pair.amountJPY), l.cx, shape.peakY - 6)
    }
    ctx.textAlign = 'left'
  }

  // 工程の箱
  for (const b of mapLayout.boxes) {
    ctx.fillStyle = C.panelAlt
    ctx.strokeStyle = C.borderStrong
    ctx.lineWidth = 1
    roundRect(ctx, b.x, b.y, MAP.boxW, MAP.boxH, 6)
    ctx.fill()
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.fillStyle = C.text
    ctx.font = `bold 12.5px ${FONT_STACK}`
    ctx.fillText(b.name.length > 9 ? `${b.name.slice(0, 8)}…` : b.name, b.x + MAP.boxW / 2, b.y + 23)
    ctx.fillStyle = C.textFaint
    ctx.font = `10px ${FONT_STACK}`
    ctx.fillText(b.code.length > 14 ? `${b.code.slice(0, 13)}…` : b.code, b.x + MAP.boxW / 2, b.y + 40)
    ctx.textAlign = 'left'
  }
  ctx.restore()
  }

  // ── ③ 数字の帯 ──
  const bandY = headerH + mapAreaH
  ctx.fillStyle = C.panelAlt
  ctx.strokeStyle = C.border
  roundRect(ctx, PAD, bandY, PAGE_W - PAD * 2, bandH - 18, 8)
  ctx.fill()
  ctx.stroke()

  const released = estimateReleasedJPY(money.dailyThroughputJPY, shortenDays)
  const cells: Array<{ label: string; value: string; note: string; accent?: boolean }> = [
    {
      label: '工程間の滞留（暦）平均',
      value: formatDays(summary.stagnationMeanDays),
      note: `中央値 ${formatDays(summary.stagnationMedianDays)}／滞留率 ${formatRate(summary.stagnationRate)}`,
    },
    {
      label: WORDING.frozenNote,
      value: formatManYen(money.frozenJPY),
      note: money.frozenJPY === null ? '原価が未設定です' : `${formatJPY(money.frozenJPY)}`,
      accent: true,
    },
    {
      label: `${shortenDays.toFixed(1)} 日短縮できた場合`,
      value: released === null ? '—' : `${formatManYen(released)} が動く`,
      note: WORDING.estimateNote,
    },
  ]

  const cellW = (PAGE_W - PAD * 2) / cells.length
  cells.forEach((cell, i) => {
    const x = PAD + cellW * i + 18
    ctx.fillStyle = C.textSub
    ctx.font = `12px ${FONT_STACK}`
    ctx.fillText(cell.label, x, bandY + 26)
    ctx.fillStyle = cell.accent ? C.accent : C.text
    ctx.font = `bold 27px ${FONT_STACK}`
    ctx.fillText(cell.value, x, bandY + 60)
    ctx.fillStyle = C.textFaint
    ctx.font = `11px ${FONT_STACK}`
    ctx.fillText(cell.note, x, bandY + 80)
  })

  // ── ④ 根拠の脚注（省略しない）──
  let y = bandY + bandH + 6
  ctx.fillStyle = C.textSub
  ctx.font = `bold 12px ${FONT_STACK}`
  ctx.fillText('この図の根拠', PAD, y)
  y += 18

  ctx.font = `12px ${FONT_STACK}`
  ctx.fillStyle = C.textFaint
  for (const line of footnotes) {
    y = drawWrapped(ctx, line, PAD, y, footWidth, 19)
  }

  return canvas.toDataURL('image/png')
}

/**
 * レイアウトの上に滞留の帯を描く。
 * 座標変換と形は render/layoutShape.ts を画面と共有する
 * （別々に描くと「画面と書き出しで別の図」になる）。
 */
function drawLayoutBody(
  ctx: CanvasRenderingContext2D,
  layout: LayoutView,
  link: LinkReport,
  top: number,
  maxWidth: number,
  maxHeight: number
): void {
  const t = fitLayout(layout, maxWidth, maxHeight)
  ctx.save()
  ctx.translate(PAD + (maxWidth - t.width) / 2, top)

  // 工場範囲
  if (layout.boundary) {
    ctx.strokeStyle = C.borderStrong
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    layout.boundary.forEach((p, i) => {
      const q = t.toPx(p)
      if (i === 0) ctx.moveTo(q.x, q.y)
      else ctx.lineTo(q.x, q.y)
    })
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 設備・構造物
  for (const item of layout.items) {
    const r = itemRect(item, t)
    const paint = itemFill(item.type)
    ctx.fillStyle = paint.fill
    ctx.strokeStyle = paint.stroke
    ctx.lineWidth = 1
    roundRect(ctx, r.x, r.y, r.w, r.h, 3)
    ctx.fill()
    ctx.stroke()
    if (r.w > 46 && r.h > 16) {
      ctx.fillStyle = C.textSub
      ctx.font = `11px ${FONT_STACK}`
      ctx.textAlign = 'center'
      ctx.fillText(item.name, r.x + r.w / 2, r.y + r.h / 2 + 4)
      ctx.textAlign = 'left'
    }
  }

  // 滞留の帯（太さ＝金額または滞留、色＝深刻度）
  link.bands.forEach((band, i) => {
    const c = bandCurve(band, t, i, link.bands.length)
    const color = SEV_COLOR[band.severity]
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.5
    ctx.lineWidth = bandWidth(band, link.bands)
    ctx.lineCap = 'round'
    traceBand(ctx, c)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.lineCap = 'butt'

    const mid = curveMidpoint(c)
    ctx.fillStyle = '#ffffff'
    ctx.globalAlpha = 0.88
    roundRect(ctx, mid.x - 52, mid.y - 15, 104, 30, 4)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    roundRect(ctx, mid.x - 52, mid.y - 15, 104, 30, 4)
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.fillStyle = C.text
    ctx.font = `bold 12px ${FONT_STACK}`
    ctx.fillText(formatDays(band.calendarDaysMean), mid.x, mid.y - 2)
    ctx.fillStyle = band.amountJPY === null ? C.textFaint : C.accent
    ctx.font = `bold 11px ${FONT_STACK}`
    ctx.fillText(formatManYen(band.amountJPY), mid.x, mid.y + 11)
    ctx.textAlign = 'left'
  })

  ctx.restore()
}

/** 書き出したファイルの名前 */
export function proposalFileName(now = new Date(), variant: 'flow' | 'layout' = 'flow'): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const kind = variant === 'layout' ? 'レイアウト' : '流れ'
  return `工程滞留_提案_${kind}_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.png`
}
