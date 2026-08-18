import { C, R, S } from '../domain/theme'
import { formatDays, type Metrics, type PairMetric } from '../domain/metrics'
import { formatManYen } from '../domain/money'
import {
  boxCenter,
  gapCenter,
  humpPathD,
  humpShape,
  humpSize,
  MAP,
  MAP_BOX_Y,
  mapHeight,
  mapWidth,
  skipArc,
  skipLabelY,
} from '../render/mapShape'
import type { Selection } from './SelectionDetail'
import { panelStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  metrics: Metrics
  selection: Selection
  onSelect: (s: Selection) => void
}

// 寸法と形は render/mapShape.ts が持つ。
// Canvas（書き出し画像）も同じものを使うので、ここで別に定義しない。
const BOX_W = MAP.boxW
const BOX_H = MAP.boxH
const GAP_W = MAP.gapW
const BASE_Y = MAP.baseY
const BOX_Y = MAP_BOX_Y

export const SEV_COLOR: Record<1 | 2 | 3, string> = { 1: C.sev1, 2: C.sev2, 3: C.sev3 }
const SEV_LABEL: Record<1 | 2 | 3, string> = { 1: '軽い', 2: '中くらい', 3: '重い' }

export function StagnationMap({ metrics, selection, onSelect }: Props) {
  const selectedKey = selection?.kind === 'gap' ? selection.key : null
  const selectedNode = selection?.kind === 'process' ? selection.code : null
  const toggleGap = (key: string) =>
    onSelect(selectedKey === key ? null : { kind: 'gap', key })
  const toggleNode = (code: string) =>
    onSelect(selectedNode === code ? null : { kind: 'process', code })

  const { flow, pairs } = metrics
  const byKey = new Map(pairs.map(p => [p.key, p]))
  // 山の高さの基準は computeMetrics が出したものを使う。
  // ここで別に求めると、色（深刻度）と高さが別々の基準で決まってしまう。
  const worstMean = metrics.worstCalendarDaysMean

  // ★流れの上で隣り合わない工程間（工程飛ばし）を捨てない。
  //   捨てると「サマリーが名指しした最悪の工程間が、図に描かれていない」が起きる。
  const rank = new Map(flow.map((n, i) => [n.code, i]))
  const distanceOf = (p: PairMetric) => {
    const a = rank.get(p.fromProcess)
    const b = rank.get(p.toProcess)
    return a === undefined || b === undefined ? null : b - a
  }
  const skipping = pairs.filter(p => {
    const d = distanceOf(p)
    return d !== null && d !== 1
  })

  if (flow.length === 0) {
    return (
      <section style={panelStyle}>
        <h2 style={titleStyle}>滞留マップ</h2>
        <p style={{ ...subTextStyle, marginTop: S.sm }}>表示できる工程がありません。</p>
      </section>
    )
  }

  const width = mapWidth(flow.length)
  const svgHeight = mapHeight(skipping.length > 0)
  const centerOf = (code: string) => boxCenter(rank.get(code) ?? 0)

  return (
    <section style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md, flexWrap: 'wrap' }}>
        <h2 style={titleStyle}>滞留マップ</h2>
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
        工程と工程の<strong>間</strong>にできた山が滞留です。高いほど長く止まっています。
        <strong>山も工程の箱も押せます。</strong>押したものの数字だけが下に出ます。
      </p>

      <div style={{ marginTop: S.md, overflowX: 'auto' }}>
        <svg
          width={width}
          height={svgHeight}
          viewBox={`0 0 ${width} ${svgHeight}`}
          role="img"
          aria-label="工程間の滞留"
          style={{ display: 'block' }}
        >
          {/* 流れの基準線 */}
          <line
            x1={0}
            y1={BASE_Y}
            x2={width}
            y2={BASE_Y}
            stroke={C.border}
            strokeWidth={1.5}
          />

          {/* 山（工程と工程の間） */}
          {flow.slice(0, -1).map((node, i) => {
            const next = flow[i + 1]
            const key = `${node.code}→${next.code}`
            const pair = byKey.get(key)
            const cx = gapCenter(i)

            if (!pair || pair.count === 0) {
              return (
                <text
                  key={`nodata-${key}`}
                  x={cx}
                  y={BASE_Y - 12}
                  textAnchor="middle"
                  fontSize={11}
                  fill={C.textFaint}
                >
                  データなし
                </text>
              )
            }

            const ratio = worstMean === 0 ? 0 : pair.calendarDaysMean / worstMean
            const { height: h, width: w } = humpSize(ratio)
            const isSel = selectedKey === key
            const color = SEV_COLOR[pair.severity]

            return (
              <g
                key={`hump-${key}`}
                onClick={() => toggleGap(key)}
                style={{ cursor: 'pointer' }}
              >
                {/* 当たり判定を広く取る。細い山でも掴めるように */}
                <rect
                  x={cx - GAP_W / 2}
                  y={BASE_Y - MAP.peakMax - 18}
                  width={GAP_W}
                  height={MAP.peakMax + 18}
                  fill="transparent"
                />
                <path
                  d={humpPathD(humpShape(cx, w, h))}
                  fill={color}
                  fillOpacity={isSel ? 0.95 : 0.72}
                  stroke={color}
                  strokeWidth={isSel ? 2 : 1}
                />
                <text
                  x={cx}
                  y={BASE_Y - h - 16}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={700}
                  fill={C.text}
                >
                  {formatDays(pair.calendarDaysMean)}
                </text>
                <text
                  x={cx}
                  y={BASE_Y - h - 4}
                  textAnchor="middle"
                  fontSize={10.5}
                  fill={pair.amountJPY === null ? C.textFaint : C.accent}
                  fontWeight={pair.amountJPY === null ? 400 : 650}
                >
                  {formatManYen(pair.amountJPY)}
                </text>
              </g>
            )
          })}

          {/* 工程の箱 */}
          {flow.map((node, i) => {
            const x = boxCenter(i) - BOX_W / 2
            const isSel = selectedNode === node.code
            return (
              <g
                key={`node-${node.code}`}
                onClick={() => toggleNode(node.code)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={x}
                  y={BOX_Y}
                  width={BOX_W}
                  height={BOX_H}
                  rx={R.md}
                  fill={isSel ? C.accentSoft : C.panelAlt}
                  stroke={isSel ? C.accent : C.borderStrong}
                  strokeWidth={isSel ? 2 : 1}
                />
                <text
                  x={x + BOX_W / 2}
                  y={BOX_Y + 22}
                  textAnchor="middle"
                  fontSize={12.5}
                  fontWeight={650}
                  fill={C.text}
                >
                  {node.name.length > 8 ? `${node.name.slice(0, 7)}…` : node.name}
                </text>
                <text
                  x={x + BOX_W / 2}
                  y={BOX_Y + 39}
                  textAnchor="middle"
                  fontSize={10.5}
                  fill={C.textFaint}
                >
                  {node.code}
                </text>
              </g>
            )
          })}

          {/* 工程を飛ばした流れ。基準線の下に弧で描く。
              ここを描かないと、サマリーが名指しした最悪の工程間が図に無い状態になる */}
          {skipping.map(pair => {
            const arc = skipArc(centerOf(pair.fromProcess), centerOf(pair.toProcess))
            const isSel = selectedKey === pair.key
            const color = SEV_COLOR[pair.severity]
            return (
              <g
                key={`skip-${pair.key}`}
                onClick={() => toggleGap(pair.key)}
                style={{ cursor: 'pointer' }}
              >
                <path
                  d={`M ${arc.from[0]} ${arc.from[1]} Q ${arc.ctrl[0]} ${arc.ctrl[1]} ${arc.to[0]} ${arc.to[1]}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={isSel ? 3 : 2}
                  strokeDasharray="5 3"
                />
                <text
                  x={arc.ctrl[0]}
                  y={skipLabelY()}
                  textAnchor="middle"
                  fontSize={11.5}
                  fontWeight={650}
                  fill={C.text}
                >
                  {formatDays(pair.calendarDaysMean)}（工程飛ばし）
                </text>
              </g>
            )
          })}
        </svg>
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

