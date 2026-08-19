import { useEffect, useRef, useState } from 'react'
import { formatDays, type Metrics } from '../domain/metrics'
import { formatManYen } from '../domain/money'
import { C, R, S } from '../domain/theme'
import {
  humpPathD,
  humpShape,
  humpSize,
  layoutMap,
  MAP,
  skipArc,
  wrapPathD,
} from '../render/mapShape'
import type { Selection } from './SelectionDetail'
import { panelStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  metrics: Metrics
  selection: Selection
  onSelect: (s: Selection) => void
}

export const SEV_COLOR: Record<1 | 2 | 3, string> = { 1: C.sev1, 2: C.sev2, 3: C.sev3 }
const SEV_LABEL: Record<1 | 2 | 3, string> = { 1: '軽い', 2: '中くらい', 3: '重い' }

/** 幅に合わせて折り返すため、実際の表示幅を測る */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(1080)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width && width > 0) setW(width)
    })
    ro.observe(el)
    setW(el.clientWidth || 1080)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function StagnationMap({ metrics, selection, onSelect }: Props) {
  const [boxRef, availWidth] = useWidth()
  const { flow, pairs } = metrics

  const selectedKey = selection?.kind === 'gap' ? selection.key : null
  const selectedNode = selection?.kind === 'process' ? selection.code : null
  const toggleGap = (key: string) => onSelect(selectedKey === key ? null : { kind: 'gap', key })
  const toggleNode = (code: string) =>
    onSelect(selectedNode === code ? null : { kind: 'process', code })

  const byKey = new Map(pairs.map(p => [p.key, p]))
  const worstMean = metrics.worstCalendarDaysMean
  const layout = layoutMap(flow, availWidth)

  // 流れの上で隣り合わない工程間（工程飛ばし）。捨てずに別に描く
  const rank = new Map(flow.map((n, i) => [n.code, i]))
  const skipping = pairs.filter(p => {
    const a = rank.get(p.fromProcess)
    const b = rank.get(p.toProcess)
    return a !== undefined && b !== undefined && b - a !== 1
  })

  return (
    <section style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md, flexWrap: 'wrap' }}>
        <h2 style={titleStyle}>滞留マップ</h2>
        <span style={{ fontSize: 11.5, color: C.textSub }}>
          {flow.length} 工程
          {layout.rows > 1 && ` ／ ${layout.rows} 段に折り返し`}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: S.md, alignItems: 'center' }}>
          {([3, 2, 1] as const).map(sev => (
            <span
              key={`legend-${sev}`}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: C.textSub }}
            >
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 2,
                  background: SEV_COLOR[sev],
                  display: 'inline-block',
                }}
              />
              {SEV_LABEL[sev]}
            </span>
          ))}
        </div>
      </div>

      <p style={{ ...subTextStyle, marginTop: S.xs }}>
        工程と工程を結ぶ線の上に立つ<strong>山が滞留</strong>です。高いほど長く止まっています。
        <strong>山も工程の箱も押せます。</strong>
      </p>

      <div ref={boxRef} style={{ marginTop: S.md }}>
        {flow.length === 0 ? (
          <p style={{ ...subTextStyle, color: C.textFaint }}>表示できる工程がありません。</p>
        ) : (
          <svg
            width="100%"
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="xMidYMin meet"
            role="img"
            aria-label="工程間の滞留"
            style={{ display: 'block' }}
          >
            {/* 行をまたぐ渡り（折り返し） */}
            {layout.links
              .filter(l => l.kind === 'wrap' && l.path)
              .map(l => (
                <path
                  key={`wrap-${l.key}`}
                  d={wrapPathD(l.path!)}
                  fill="none"
                  stroke={C.borderStrong}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
              ))}

            {/* 工程を飛ばした流れ */}
            {skipping.map(pair => {
              const a = layout.byCode.get(pair.fromProcess)
              const b = layout.byCode.get(pair.toProcess)
              if (!a || !b) return null
              const arc = skipArc(a, b)
              const isSel = selectedKey === pair.key
              return (
                <g
                  key={`skip-${pair.key}`}
                  onClick={() => toggleGap(pair.key)}
                  style={{ cursor: 'pointer' }}
                >
                  <path
                    d={`M ${arc.from[0]} ${arc.from[1]} Q ${arc.ctrl[0]} ${arc.ctrl[1]} ${arc.to[0]} ${arc.to[1]}`}
                    fill="none"
                    stroke={SEV_COLOR[pair.severity]}
                    strokeOpacity={isSel ? 0.9 : 0.4}
                    strokeWidth={isSel ? 3 : 1.5}
                    strokeDasharray="5 3"
                  />
                </g>
              )
            })}

            {/* 同じ行の隣どうし：つなぎ線と、その上に立つ山 */}
            {layout.links
              .filter(l => l.kind === 'inline')
              .map(l => {
                const pair = byKey.get(l.key)
                const left = l.cx - MAP.gapW / 2
                const right = l.cx + MAP.gapW / 2

                if (!pair || pair.count === 0) {
                  return (
                    <g key={`nodata-${l.key}`}>
                      <line
                        x1={left}
                        y1={l.cy}
                        x2={right}
                        y2={l.cy}
                        stroke={C.border}
                        strokeWidth={1.5}
                        strokeDasharray="3 3"
                      />
                      <text
                        x={l.cx}
                        y={l.cy - 8}
                        textAnchor="middle"
                        fontSize={10}
                        fill={C.textFaint}
                      >
                        データなし
                      </text>
                    </g>
                  )
                }

                const ratio = worstMean === 0 ? 0 : pair.calendarDaysMean / worstMean
                const { height: h, width: w } = humpSize(ratio)
                const shape = humpShape(l.cx, l.cy, w, h)
                const isSel = selectedKey === l.key
                const color = SEV_COLOR[pair.severity]

                return (
                  <g key={`hump-${l.key}`} onClick={() => toggleGap(l.key)} style={{ cursor: 'pointer' }}>
                    {/* 当たり判定を広く取る */}
                    <rect
                      x={left}
                      y={l.cy - MAP.peakMax - 26}
                      width={MAP.gapW}
                      height={MAP.peakMax + 34}
                      fill="transparent"
                    />
                    {/* 工程と工程をつなぐ線 */}
                    <line x1={left} y1={l.cy} x2={right} y2={l.cy} stroke={color} strokeWidth={2} />
                    {/* その上に立つ山 */}
                    <path
                      d={humpPathD(shape)}
                      fill={color}
                      fillOpacity={isSel ? 0.95 : 0.62}
                      stroke={color}
                      strokeWidth={isSel ? 2 : 1}
                    />
                    {/* 件数（線の下） */}
                    <text
                      x={l.cx}
                      y={l.cy + 13}
                      textAnchor="middle"
                      fontSize={9.5}
                      fill={C.textFaint}
                    >
                      {pair.count.toLocaleString()} 件
                    </text>
                    {/* 日数と金額（山の上） */}
                    <rect
                      x={l.cx - 40}
                      y={shape.peakY - 30}
                      width={80}
                      height={pair.amountJPY === null ? 17 : 28}
                      rx={4}
                      fill="#fff"
                      fillOpacity={0.92}
                      stroke={color}
                      strokeWidth={isSel ? 1.5 : 1}
                    />
                    <text
                      x={l.cx}
                      y={shape.peakY - 18}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={700}
                      fill={C.text}
                    >
                      {formatDays(pair.calendarDaysMean)}
                    </text>
                    {pair.amountJPY !== null && (
                      <text
                        x={l.cx}
                        y={shape.peakY - 6}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight={650}
                        fill={C.accent}
                      >
                        {formatManYen(pair.amountJPY)}
                      </text>
                    )}
                  </g>
                )
              })}

            {/* 工程の箱 */}
            {layout.boxes.map(b => {
              const isSel = selectedNode === b.code
              return (
                <g key={`node-${b.code}`} onClick={() => toggleNode(b.code)} style={{ cursor: 'pointer' }}>
                  <rect
                    x={b.x}
                    y={b.y}
                    width={MAP.boxW}
                    height={MAP.boxH}
                    rx={R.md}
                    fill={isSel ? C.accentSoft : C.panelAlt}
                    stroke={isSel ? C.accent : C.borderStrong}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  <text
                    x={b.x + MAP.boxW / 2}
                    y={b.y + 23}
                    textAnchor="middle"
                    fontSize={12.5}
                    fontWeight={650}
                    fill={C.text}
                  >
                    {b.name.length > 9 ? `${b.name.slice(0, 8)}…` : b.name}
                  </text>
                  <text
                    x={b.x + MAP.boxW / 2}
                    y={b.y + 40}
                    textAnchor="middle"
                    fontSize={10}
                    fill={C.textFaint}
                  >
                    {b.code.length > 14 ? `${b.code.slice(0, 13)}…` : b.code}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>

      {skipping.length > 0 && (
        <p style={{ ...subTextStyle, marginTop: S.sm, color: C.warn }}>
          破線は<strong>工程を飛ばして流れたロット</strong>です（{skipping.length} 通り）。
          隣り合う工程の間ではないため山にはできませんが、滞留としては大きい場合があるので隠さず出しています。
        </p>
      )}
    </section>
  )
}
