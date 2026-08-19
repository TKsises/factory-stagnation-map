import { useRef, useState } from 'react'
import { normalizeLayout, type LayoutView } from '../domain/layout'
import { bandWidth, hasNoLinks, type LinkReport } from '../domain/layoutLink'
import { formatDays, type Metrics } from '../domain/metrics'
import { formatManYen } from '../domain/money'
import { C, R, S } from '../domain/theme'
import {
  bandCurve,
  bandPathD,
  curveMidpoint,
  fitLayout,
  itemFill,
  itemRect,
} from '../render/layoutShape'
import { SEV_COLOR } from './StagnationMap'
import { panelStyle, selectStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  metrics: Metrics
  layout: LayoutView | null
  onLayoutLoaded: (layout: LayoutView, fileName: string) => void
  layoutFileName: string | null
  processLayout: Record<string, string>
  onLinkChange: (processCode: string, itemCode: string) => void
  /** 帯の計算は App が1箇所で行い、書き出し画像と同じものを使う */
  link: LinkReport | null
  onOpenFullView?: () => void
}

const VIEW_W = 1090
const VIEW_H = 470

export function LayoutPanel({
  metrics,
  layout,
  onLayoutLoaded,
  layoutFileName,
  processLayout,
  onLinkChange,
  link,
  onOpenFullView,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const readFile = async (file: File) => {
    setError(null)
    try {
      const text = await file.text()
      const view = normalizeLayout(JSON.parse(text))
      if (view.items.length === 0) {
        setError(`${file.name} に配置された要素がありません。レイアウトの書き出しファイルか確認してください。`)
        return
      }
      onLayoutLoaded(view, file.name)
    } catch (e) {
      setError(`読み込めませんでした：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const loadSample = async () => {
    setError(null)
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}fixtures/layout-sample.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onLayoutLoaded(normalizeLayout(await res.json()), 'layout-sample.json')
    } catch (e) {
      setError(`検証用レイアウトを読めませんでした：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <section style={panelStyle}>
      <h2 style={titleStyle}>工場レイアウトに重ねる</h2>
      <p style={{ ...subTextStyle, marginTop: S.xs }}>
        滞留を<strong>場所の上に置く</strong>と、「その仕掛はどの経路に積まれるのか」「遠い工程と
        長い滞留が重なっていないか」が分かります。表やグラフでは見えない部分だけを載せています。
      </p>

      {/* ── 取り込み ── */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          const f = e.dataTransfer.files[0]
          if (f) void readFile(f)
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          marginTop: S.md,
          padding: S.md,
          border: `2px dashed ${C.borderStrong}`,
          borderRadius: R.md,
          background: C.panelAlt,
          textAlign: 'center',
          cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {layoutFileName ?? 'レイアウトの書き出しJSONをここにドロップ'}
        </div>
        <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 2 }}>
          {layout
            ? `${layout.items.length} 要素（管理番号あり ${layout.codedItems.length}）`
            : '工場レイアウトアプリの「書き出し」で作ったファイルを使います'}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) void readFile(f)
            e.target.value = ''
          }}
        />
      </div>

      <div style={{ marginTop: S.sm }}>
        <button
          type="button"
          onClick={() => void loadSample()}
          style={{
            fontSize: 12,
            padding: '6px 11px',
            borderRadius: R.sm,
            border: `1px solid ${C.borderStrong}`,
            background: '#fff',
            color: C.textSub,
            cursor: 'pointer',
          }}
        >
          検証用のレイアウトを読む（機械加工8工程に対応）
        </button>
      </div>

      {error && (
        <div style={{ marginTop: S.sm, fontSize: 12.5, color: C.error }}>{error}</div>
      )}

      {layout && link && (
        <>
          {/* ── 対応表 ── */}
          <div style={{ marginTop: S.lg }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: S.sm, flexWrap: 'wrap' }}>
              <h3 style={{ ...titleStyle, fontSize: 13 }}>工程とレイアウトの対応表</h3>
              <span style={{ fontSize: 11.5, color: C.textSub }}>
                {link.linkedCount} / {metrics.flow.length} 工程が対応済み
              </span>
            </div>
            <p style={{ ...subTextStyle, marginTop: 2, color: C.textFaint }}>
              <strong>名前が似ていても自動では紐づけません。</strong>
              「表面処理」と「表面処理機A」を勝手に結ぶと、誰も気づかないまま別の場所に金額が乗った図が出て行きます。
            </p>

            <div
              style={{
                marginTop: S.sm,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: S.sm,
              }}
            >
              {metrics.flow.map(node => {
                const value = processLayout[node.code] ?? ''
                return (
                  <label key={`lk-${node.code}`} style={{ display: 'grid', gap: 3 }}>
                    <span style={{ fontSize: 11.5, color: C.textSub }}>
                      {node.name}
                      <span style={{ color: C.textFaint }}>（{node.code}）</span>
                    </span>
                    <select
                      value={value}
                      onChange={e => onLinkChange(node.code, e.target.value)}
                      style={{ ...selectStyle, borderColor: value ? C.borderStrong : C.warn }}
                    >
                      <option value="">（未対応）</option>
                      {layout.codedItems.map(item => (
                        <option key={`op-${node.code}-${item.id}`} value={item.code ?? ''}>
                          {item.code}：{item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              })}
            </div>
          </div>

          {/* ── 未対応の明示 ── */}
          {link.unlinked.length > 0 && (
            <div
              style={{
                marginTop: S.md,
                padding: S.sm,
                background: C.warnSoft,
                borderRadius: R.sm,
                fontSize: 12,
                color: C.warn,
                lineHeight: 1.7,
              }}
            >
              ▲ <strong>未対応の工程：{link.unlinked.length} 件</strong>（
              {link.unlinked.map(u => u.name).join('、')}）。
              {link.undrawablePairs > 0 && (
                <>
                  {' '}
                  そのため <strong>{link.undrawablePairs} 本の工程間</strong>
                  （平均 {formatDays(link.undrawableDaysMean / link.undrawablePairs)} の滞留）
                  がこの図に出ていません。図だけを見ると実態より少なく見えます。
                </>
              )}
            </div>
          )}

          {onOpenFullView && (
            <div style={{ marginTop: S.md }}>
              <button
                type="button"
                onClick={onOpenFullView}
                style={{
                  fontSize: 13,
                  fontWeight: 650,
                  padding: '9px 16px',
                  borderRadius: R.md,
                  border: 'none',
                  background: C.accent,
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                全画面で見る（ズーム・移動ができます）
              </button>
            </div>
          )}

          {/* ── 重ね図 ── */}
          {hasNoLinks(processLayout) ? (
            <p style={{ ...subTextStyle, marginTop: S.md, color: C.textFaint }}>
              対応表を1件以上作ると、ここに滞留の帯が出ます。
            </p>
          ) : (
            <LayoutOverlay layout={layout} link={link} />
          )}

          {/* ── 位置の上で見て初めて分かること ── */}
          {link.worstByDistance.length > 0 && (
            <div
              style={{
                marginTop: S.md,
                padding: S.md,
                background: C.panelAlt,
                border: `1px solid ${C.border}`,
                borderRadius: R.md,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 650 }}>
                「遠い」と「待つ」が重なっている区間
              </div>
              <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 2, lineHeight: 1.7 }}>
                動線が長いほど運搬の手間が増え、滞留が長いほど仕掛が積まれます。
                両方が重なる区間は、置き場と運搬の両面から効きます。
              </div>
              <div style={{ marginTop: S.sm, display: 'grid', gap: 4 }}>
                {link.worstByDistance.map(b => (
                  <div
                    key={`wd-${b.key}`}
                    style={{ fontSize: 12.5, display: 'flex', gap: S.sm, flexWrap: 'wrap' }}
                  >
                    <span style={{ fontWeight: 650, minWidth: 190 }}>
                      {b.fromName} → {b.toName}
                    </span>
                    <span style={{ color: C.textSub }}>
                      距離 {b.distanceM.toFixed(1)} m ／ 滞留 {formatDays(b.calendarDaysMean)}
                      {b.amountJPY !== null && ` ／ ${formatManYen(b.amountJPY)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function LayoutOverlay({ layout, link }: { layout: LayoutView; link: LinkReport }) {
  const t = fitLayout(layout, VIEW_W, VIEW_H)
  const bands = link.bands

  return (
    <div style={{ marginTop: S.md, overflowX: 'auto' }}>
      <svg
        width={t.width}
        height={t.height}
        viewBox={`0 0 ${t.width} ${t.height}`}
        role="img"
        aria-label="レイアウト上の滞留"
        style={{ display: 'block', background: '#fbfcfd', borderRadius: R.md }}
      >
        {/* 工場範囲 */}
        {layout.boundary && (
          <polygon
            points={layout.boundary.map(p => {
              const q = t.toPx(p)
              return `${q.x},${q.y}`
            }).join(' ')}
            fill="none"
            stroke={C.borderStrong}
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        )}

        {/* 設備・構造物 */}
        {layout.items.map(item => {
          const r = itemRect(item, t)
          const paint = itemFill(item.type)
          return (
            <g key={`it-${item.id}`}>
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx={3}
                fill={paint.fill}
                stroke={paint.stroke}
                strokeWidth={1}
              />
              {r.w > 46 && r.h > 16 && (
                <text
                  x={r.x + r.w / 2}
                  y={r.y + r.h / 2 + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fill={C.textSub}
                >
                  {item.name}
                </text>
              )}
            </g>
          )
        })}

        {/* 滞留の帯（太さ＝金額または滞留、色＝深刻度） */}
        {bands.map((band, i) => {
          const c = bandCurve(band, t, i, bands.length)
          const mid = curveMidpoint(c)
          const w = bandWidth(band, bands)
          const color = SEV_COLOR[band.severity]
          return (
            <g key={`bd-${band.key}`}>
              <path
                d={bandPathD(c)}
                fill="none"
                stroke={color}
                strokeOpacity={0.5}
                strokeWidth={w}
                strokeLinecap="round"
              />
              <rect
                x={mid.x - 52}
                y={mid.y - 15}
                width={104}
                height={30}
                rx={4}
                fill="#ffffff"
                fillOpacity={0.88}
                stroke={color}
                strokeWidth={1}
              />
              <text
                x={mid.x}
                y={mid.y - 2}
                textAnchor="middle"
                fontSize={12}
                fontWeight={700}
                fill={C.text}
              >
                {formatDays(band.calendarDaysMean)}
              </text>
              <text
                x={mid.x}
                y={mid.y + 11}
                textAnchor="middle"
                fontSize={10.5}
                fill={band.amountJPY === null ? C.textFaint : C.accent}
                fontWeight={band.amountJPY === null ? 400 : 650}
              >
                {formatManYen(band.amountJPY)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
