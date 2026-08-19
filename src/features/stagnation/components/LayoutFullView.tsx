import { useCallback, useEffect, useRef, useState } from 'react'
import { layoutExtent, type LayoutView } from '../domain/layout'
import { bandWidth, type LinkReport, type StagnationBand } from '../domain/layoutLink'
import { formatDays } from '../domain/metrics'
import { formatManYen } from '../domain/money'
import { C, R, S } from '../domain/theme'
import { itemFill } from '../render/layoutShape'
import { SEV_COLOR } from './StagnationMap'

type Props = {
  layout: LayoutView
  link: LinkReport
  onClose: () => void
  onOpenLinkTable: () => void
}

/** レイアウトアプリと揃える。1メートルを何ピクセルで描くか */
const PX_PER_M = 40
const ZOOM_MIN = 0.15
const ZOOM_MAX = 3

/**
 * 注記（帯のラベル）は画面上の大きさを保つ。
 * ワールド座標に固定サイズで描くと、引いたときに潰れて読めなくなる
 * （先行実装で z=0.16 のとき状態ドットが約1.6px になり実質不可視だった）。
 * 0.25 刻みに量子化して、拡大縮小のたびに文字がガタつかないようにする。
 */
function uiScale(z: number): number {
  const raw = Math.min(6, Math.max(1, 1 / z))
  return Math.round(raw * 4) / 4
}

export function LayoutFullView({ layout, link, onClose, onOpenLinkTable }: Props) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const areaRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  const extent = layoutExtent(layout)
  const worldW = (extent.maxX - extent.minX) * PX_PER_M
  const worldH = (extent.maxY - extent.minY) * PX_PER_M

  /** 画面に収まる倍率に戻す */
  const fit = useCallback(() => {
    const el = areaRef.current
    if (!el) return
    const z = Math.min(
      (el.clientWidth - 40) / Math.max(1, worldW),
      (el.clientHeight - 40) / Math.max(1, worldH)
    )
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
    setZoom(next)
    setPan({
      x: (el.clientWidth - worldW * next) / 2,
      y: (el.clientHeight - worldH * next) / 2,
    })
  }, [worldW, worldH])

  useEffect(() => {
    // 開いた直後は全体が見える倍率にする
    const id = setTimeout(fit, 0)
    return () => clearTimeout(id)
  }, [fit])

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const zoomBy = (factor: number) => {
    const el = areaRef.current
    if (!el) return
    setZoom(z => {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor))
      // 画面中央を保ったまま拡大縮小する
      const cx = el.clientWidth / 2
      const cy = el.clientHeight / 2
      setPan(p => ({
        x: cx - ((cx - p.x) / z) * next,
        y: cy - ((cy - p.y) / z) * next,
      }))
      return next
    })
  }

  const toPx = (m: { x: number; y: number }) => ({
    x: (m.x - extent.minX) * PX_PER_M,
    y: (m.y - extent.minY) * PX_PER_M,
  })

  const u = uiScale(zoom)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: C.bg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── 上のバー ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: S.md,
          padding: `${S.sm}px ${S.lg}px`,
          background: C.panel,
          borderBottom: `1px solid ${C.border}`,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 14.5, fontWeight: 700 }}>
          工場レイアウト × 工程間の滞留
        </strong>
        {/* ★縮尺と倍率を常に出す。これが無いと図の大きさが分からない */}
        <span style={{ fontSize: 11.5, color: C.textSub, fontFamily: 'monospace' }}>
          1m = {(PX_PER_M * zoom).toFixed(1)}px ／ ズーム {Math.round(zoom * 100)}%
        </span>
        <span style={{ fontSize: 11.5, color: C.textSub }}>
          {link.linkedCount} 工程が対応済み
          {link.unlinked.length > 0 && (
            <strong style={{ color: C.warn }}>／未対応 {link.unlinked.length} 件</strong>
          )}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
          <Btn onClick={() => zoomBy(1.25)}>拡大 +</Btn>
          <Btn onClick={() => zoomBy(0.8)}>縮小 −</Btn>
          <Btn onClick={fit}>全体を表示</Btn>
          <Btn onClick={onOpenLinkTable}>工程 ↔ 設備 の対応</Btn>
          <Btn onClick={onClose} primary>
            閉じる
          </Btn>
        </div>
      </div>

      {/* ── 図 ── */}
      <div
        ref={areaRef}
        onPointerDown={e => {
          if (e.button !== 0) return
          dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
        }}
        onPointerMove={e => {
          const d = dragRef.current
          if (!d) return
          // ウィンドウの外で離すと pointerup が届かず張り付くので、ボタンの状態で見る
          if (e.buttons === 0) {
            dragRef.current = null
            return
          }
          setPan({ x: d.panX + (e.clientX - d.x), y: d.panY + (e.clientY - d.y) })
        }}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
        onWheel={e => {
          if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return
          zoomBy(e.deltaY < 0 ? 1.1 : 0.9)
        }}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          cursor: dragRef.current ? 'grabbing' : 'grab',
          // 方眼。図の大きさの手がかりになる
          backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
          backgroundSize: `${PX_PER_M * zoom}px ${PX_PER_M * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <svg width={worldW} height={worldH} style={{ display: 'block', overflow: 'visible' }}>
            {/* 工場範囲 */}
            {layout.boundary && (
              <polygon
                points={layout.boundary
                  .map(p => {
                    const q = toPx(p)
                    return `${q.x},${q.y}`
                  })
                  .join(' ')}
                fill="none"
                stroke={C.borderStrong}
                strokeWidth={1.5 * u}
                strokeDasharray={`${6 * u} ${4 * u}`}
              />
            )}

            {/* 設備・構造物 */}
            {layout.items.map(item => {
              const p = toPx(item)
              const w = item.w * PX_PER_M
              const h = item.h * PX_PER_M
              const paint = itemFill(item.type)
              return (
                <g key={`it-${item.id}`}>
                  <rect
                    x={p.x}
                    y={p.y}
                    width={w}
                    height={h}
                    rx={3}
                    fill={paint.fill}
                    stroke={paint.stroke}
                    strokeWidth={1 * u}
                  />
                  {w > 40 / zoom && (
                    <text
                      x={p.x + w / 2}
                      y={p.y + h / 2 + 4 * u}
                      textAnchor="middle"
                      fontSize={11 * u}
                      fill={C.textSub}
                    >
                      {item.name}
                    </text>
                  )}
                  {item.code && (
                    <text x={p.x + 4 * u} y={p.y + 12 * u} fontSize={9 * u} fill={C.textFaint}>
                      {item.code}
                    </text>
                  )}
                </g>
              )
            })}

            {/* 滞留の帯 */}
            {link.bands.map((band, i) => (
              <Band
                key={`bd-${band.key}`}
                band={band}
                bands={link.bands}
                index={i}
                toPx={toPx}
                u={u}
                selected={selected === band.key}
                onSelect={() => setSelected(selected === band.key ? null : band.key)}
              />
            ))}
          </svg>
        </div>

        {/* 使い方 */}
        <div
          style={{
            position: 'absolute',
            left: S.md,
            bottom: S.md,
            fontSize: 11,
            color: C.textFaint,
            background: `${C.panel}dd`,
            padding: `${S.xs}px ${S.sm}px`,
            borderRadius: R.sm,
          }}
        >
          ドラッグで移動／ホイールで拡大縮小／Esc で閉じる
        </div>

        {/* 未対応の明示 */}
        {link.unlinked.length > 0 && (
          <div
            style={{
              position: 'absolute',
              right: S.md,
              bottom: S.md,
              maxWidth: 420,
              fontSize: 11.5,
              lineHeight: 1.7,
              color: C.warn,
              background: C.warnSoft,
              border: `1px solid ${C.warn}`,
              padding: S.sm,
              borderRadius: R.sm,
            }}
          >
            ▲ 未対応の工程 {link.unlinked.length} 件のため、
            <strong>{link.undrawablePairs} 本の工程間がこの図に出ていません。</strong>
            図だけを見ると実態より少なく見えます。
          </div>
        )}
      </div>
    </div>
  )
}

function Band({
  band,
  bands,
  index,
  toPx,
  u,
  selected,
  onSelect,
}: {
  band: StagnationBand
  bands: StagnationBand[]
  index: number
  toPx: (m: { x: number; y: number }) => { x: number; y: number }
  u: number
  selected: boolean
  onSelect: () => void
}) {
  const from = toPx(band.from)
  const to = toPx(band.to)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const spread = bands.length <= 1 ? 0 : (index - (bands.length - 1) / 2) * 26
  const bow = len * 0.16 + Math.abs(spread)
  const shift = spread === 0 ? bow : spread + Math.sign(spread) * len * 0.08
  const ctrl = {
    x: (from.x + to.x) / 2 + (-dy / len) * shift,
    y: (from.y + to.y) / 2 + (dx / len) * shift,
  }
  const mid = {
    x: 0.25 * from.x + 0.5 * ctrl.x + 0.25 * to.x,
    y: 0.25 * from.y + 0.5 * ctrl.y + 0.25 * to.y,
  }
  const color = SEV_COLOR[band.severity]
  const w = bandWidth(band, bands)

  return (
    <g onClick={onSelect} style={{ cursor: 'pointer' }}>
      <path
        d={`M ${from.x} ${from.y} Q ${ctrl.x} ${ctrl.y} ${to.x} ${to.y}`}
        fill="none"
        stroke={color}
        strokeOpacity={selected ? 0.85 : 0.45}
        strokeWidth={w}
        strokeLinecap="round"
      />
      {/* ラベルは画面上の大きさを保つ（引いても読めるように） */}
      <g transform={`translate(${mid.x}, ${mid.y}) scale(${u})`}>
        <rect
          x={-54}
          y={-17}
          width={108}
          height={selected ? 46 : 34}
          rx={4}
          fill="#fff"
          fillOpacity={0.92}
          stroke={color}
          strokeWidth={selected ? 1.5 : 1}
        />
        <text textAnchor="middle" y={-2} fontSize={12} fontWeight={700} fill={C.text}>
          {formatDays(band.calendarDaysMean)}
        </text>
        <text
          textAnchor="middle"
          y={11}
          fontSize={10}
          fontWeight={650}
          fill={band.amountJPY === null ? C.textFaint : C.accent}
        >
          {formatManYen(band.amountJPY)}
        </text>
        {selected && (
          <text textAnchor="middle" y={24} fontSize={9.5} fill={C.textSub}>
            {band.distanceM.toFixed(1)}m ／ {band.count.toLocaleString()}件
          </text>
        )}
      </g>
    </g>
  )
}

function Btn({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: '6px 12px',
        borderRadius: R.sm,
        border: primary ? 'none' : `1px solid ${C.borderStrong}`,
        background: primary ? C.accent : '#fff',
        color: primary ? '#fff' : C.textSub,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
