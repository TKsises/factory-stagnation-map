import { useMemo, useState } from 'react'
import type { Metrics } from '../domain/metrics'
import { formatDays } from '../domain/metrics'
import { formatJPY } from '../domain/money'
import {
  BASIS_MARK,
  EMPTY_FILTER,
  filterLotRows,
  sortLotRows,
  toDays,
  type LotFilter,
  type LotRow,
  type SortKey,
} from '../domain/lotView'
import { BASIS_LABEL } from '../domain/metrics'
import { C, MONO, R, S } from '../domain/theme'
import { badge, panelStyle, selectStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  rows: LotRow[]
  metrics: Metrics
}

/** 一度に描く行数。2,000件を一気に描くと操作がかくつく */
const PAGE = 30

const SORT_LABEL: Record<SortKey, string> = {
  stagnation: '滞留の長い順',
  leadTime: 'リードタイムの長い順',
  amount: '金額の大きい順',
  lotId: 'ロットID順',
}

const PROCESS_COLOR = '#37485c'

/** 滞留の帯。薄い色＋斜線で、加工（濃い無地）と一目で区別する */
function gapBackground(basis: string | undefined): string {
  const base = basis === 'actual' ? '#c9d6e4' : '#f0d9a8'
  return `repeating-linear-gradient(45deg, ${base}, ${base} 4px, #ffffff 4px, #ffffff 7px)`
}

export function LotListPanel({ rows, metrics }: Props) {
  const [filter, setFilter] = useState<LotFilter>(EMPTY_FILTER)
  const [sortKey, setSortKey] = useState<SortKey>('stagnation')
  const [shown, setShown] = useState(PAGE)
  const [openLot, setOpenLot] = useState<string | null>(null)

  const view = useMemo(
    () => sortLotRows(filterLotRows(rows, filter), sortKey),
    [rows, filter, sortKey]
  )

  // 帯は全ロット共通の時間軸で描く。ロットごとに幅を100%にすると
  // 「このロットは3倍長い」が見えなくなる
  const maxHours = useMemo(
    () => view.slice(0, shown).reduce((m, r) => Math.max(m, r.leadHours ?? 0), 0),
    [view, shown]
  )

  const items = metrics.money.items.map(i => i.code)
  const processes = metrics.flow

  const patch = (part: Partial<LotFilter>) => {
    setFilter(f => ({ ...f, ...part }))
    setShown(PAGE)
    setOpenLot(null)
  }

  return (
    <section style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md, flexWrap: 'wrap' }}>
        <h2 style={titleStyle}>ロット一覧</h2>
        <span style={{ fontSize: 11.5, color: C.textSub }}>
          {view.length.toLocaleString()} / {rows.length.toLocaleString()} 件
        </span>
      </div>
      <p style={{ ...subTextStyle, marginTop: S.xs }}>
        平均の裏にある1件ずつを追えます。<strong>濃い帯が加工、斜線の帯が滞留</strong>です。
        行をクリックすると工程ごとの実績時刻が出ます。
      </p>

      {/* ── 絞り込みと並べ替え ── */}
      <div
        style={{
          marginTop: S.md,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: S.sm,
        }}
      >
        <Field label="並べ替え">
          <select
            value={sortKey}
            onChange={e => {
              setSortKey(e.target.value as SortKey)
              setShown(PAGE)
            }}
            style={selectStyle}
          >
            {(Object.keys(SORT_LABEL) as SortKey[]).map(k => (
              <option key={`s-${k}`} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="品目">
          <select
            value={filter.itemCode}
            onChange={e => patch({ itemCode: e.target.value })}
            style={selectStyle}
          >
            <option value="">すべて</option>
            {items.map(code => (
              <option key={`i-${code}`} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="工程を通ったもの">
          <select
            value={filter.processCode}
            onChange={e => patch({ processCode: e.target.value })}
            style={selectStyle}
          >
            <option value="">すべて</option>
            {processes.map(p => (
              <option key={`p-${p.code}`} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="開始日（から）">
          <input
            type="date"
            value={filter.from}
            onChange={e => patch({ from: e.target.value })}
            style={selectStyle}
          />
        </Field>
        <Field label="開始日（まで）">
          <input
            type="date"
            value={filter.to}
            onChange={e => patch({ to: e.target.value })}
            style={selectStyle}
          />
        </Field>
      </div>

      {view.length === 0 && (
        <p style={{ ...subTextStyle, marginTop: S.md, color: C.textFaint }}>
          条件に合うロットがありません。絞り込みを緩めてください。
        </p>
      )}

      {/* ── 一覧 ── */}
      <div style={{ marginTop: S.md, display: 'grid', gap: 3 }}>
        {view.slice(0, shown).map(row => (
          <LotRowView
            key={`lot-${row.lotId}`}
            row={row}
            maxHours={maxHours}
            open={openLot === row.lotId}
            onToggle={() => setOpenLot(openLot === row.lotId ? null : row.lotId)}
          />
        ))}
      </div>

      {view.length > shown && (
        <button
          type="button"
          onClick={() => setShown(s => s + PAGE * 3)}
          style={{
            marginTop: S.md,
            width: '100%',
            fontSize: 12.5,
            padding: '8px 10px',
            borderRadius: R.sm,
            border: `1px solid ${C.borderStrong}`,
            background: '#fff',
            color: C.textSub,
            cursor: 'pointer',
          }}
        >
          さらに表示（残り {(view.length - shown).toLocaleString()} 件）
        </button>
      )}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 3 }}>
      <span style={{ fontSize: 11, color: C.textSub }}>{label}</span>
      {children}
    </label>
  )
}

function LotRowView({
  row,
  maxHours,
  open,
  onToggle,
}: {
  row: LotRow
  maxHours: number
  open: boolean
  onToggle: () => void
}) {
  const widthPct = (hours: number) => (maxHours <= 0 ? 0 : (hours / maxHours) * 100)

  return (
    <div style={{ border: `1px solid ${open ? C.accent : C.border}`, borderRadius: R.sm }}>
      <div
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(140px, 190px) 1fr 78px 96px',
          gap: S.sm,
          alignItems: 'center',
          padding: `6px ${S.sm}px`,
          cursor: 'pointer',
          background: open ? C.accentSoft : '#fff',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontFamily: MONO,
              fontWeight: 650,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.lotId}
          </div>
          <div style={{ fontSize: 10.5, color: C.textFaint, display: 'flex', gap: 4 }}>
            <span>{row.itemCode ?? '品目不明'}</span>
            {row.quantity !== null && (
              <span>
                {row.quantity}
                {row.unit ?? ''}
              </span>
            )}
            {row.hasApprox && <span title="標準時間から近似した工程間があります">≈</span>}
            {row.hasDateOnly && <span title="日付だけの工程があります">📅</span>}
            {row.excludedPairs > 0 && (
              <span title="計算できなかった工程間があります" style={{ color: C.warn }}>
                欠損{row.excludedPairs}
              </span>
            )}
          </div>
        </div>

        {/* 帯：加工＝濃い無地、滞留＝薄い斜線 */}
        <div style={{ display: 'flex', height: 18, background: C.panelAlt, borderRadius: 2 }}>
          {row.segments.map((seg, i) => (
            <div
              key={`seg-${row.lotId}-${i}`}
              title={`${seg.label}：${formatDays(toDays(seg.hours))}${
                seg.basis ? `（${BASIS_LABEL[seg.basis]}）` : ''
              }`}
              style={{
                width: `${widthPct(seg.hours)}%`,
                background: seg.kind === 'process' ? PROCESS_COLOR : gapBackground(seg.basis),
                borderRight: '1px solid #fff',
              }}
            />
          ))}
        </div>

        {/* 加工と滞留の比率。数字だけだと「4日」が長いのか短いのか分からない */}
        <div style={{ fontSize: 12, textAlign: 'right', fontWeight: 650 }}>
          {formatDays(toDays(row.stagnationHours))}
          {row.leadHours !== null && row.leadHours > 0 && (
            <div
              style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 3 }}
              title={`加工など ${formatDays(toDays(Math.max(0, row.leadHours - row.stagnationHours)))} ／ 滞留 ${formatDays(toDays(row.stagnationHours))}`}
            >
              <div
                style={{
                  width: `${Math.max(0, 100 - (row.stagnationHours / row.leadHours) * 100)}%`,
                  background: C.ok,
                }}
              />
              <div style={{ flex: 1, background: C.sev3 }} />
            </div>
          )}
        </div>
        <div style={{ fontSize: 11.5, textAlign: 'right', color: C.textSub }}>
          {row.amountJPY === null ? '原価未設定' : formatJPY(row.amountJPY)}
        </div>
      </div>

      {open && <LotDetail row={row} />}
    </div>
  )
}

const fmtTime = (d: Date | null) =>
  d === null
    ? '—'
    : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
        d.getMinutes()
      ).padStart(2, '0')}`

function LotDetail({ row }: { row: LotRow }) {
  return (
    <div style={{ padding: S.md, borderTop: `1px solid ${C.border}`, background: C.panelAlt }}>
      <div style={{ display: 'flex', gap: S.lg, flexWrap: 'wrap', marginBottom: S.sm }}>
        <Fact label="総リードタイム（暦）" value={formatDays(row.leadHours === null ? null : toDays(row.leadHours))} />
        <Fact label="うち滞留（暦）" value={formatDays(toDays(row.stagnationHours))} />
        <Fact label="うち滞留（稼働）" value={formatDays(toDays(row.workingStagnationHours))} />
        <Fact label="ロット金額" value={row.amountJPY === null ? '原価未設定' : formatJPY(row.amountJPY)} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11.5, width: '100%' }}>
          <thead>
            <tr>
              {['工程順', '工程', '実績開始', '実績終了', '次工程までの滞留', '暦/稼働', '根拠'].map(
                h => (
                  <th
                    key={`h-${h}`}
                    style={{
                      textAlign: 'left',
                      padding: '4px 8px',
                      borderBottom: `1px solid ${C.border}`,
                      color: C.textSub,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {row.steps.map(step => {
              const gap = step.gapAfter
              return (
                <tr key={`st-${row.lotId}-${step.processCode}-${step.order}`}>
                  <td style={cell}>{step.order ?? '—'}</td>
                  <td style={{ ...cell, fontWeight: 600 }}>{step.processName}</td>
                  <td style={{ ...cell, fontFamily: MONO }}>{fmtTime(step.actualStart)}</td>
                  <td style={{ ...cell, fontFamily: MONO }}>{fmtTime(step.actualEnd)}</td>
                  <td style={{ ...cell, fontWeight: 650 }}>
                    {gap ? formatDays(toDays(gap.calendarHours)) : step.gapExcluded ? '計算不可' : '—'}
                  </td>
                  <td style={{ ...cell, color: C.textSub }}>
                    {gap
                      ? `${toDays(gap.calendarHours).toFixed(1)} / ${toDays(gap.workingHours).toFixed(1)} 日`
                      : '—'}
                  </td>
                  <td style={cell}>
                    {gap ? (
                      <span
                        style={badge(
                          gap.basis === 'actual' ? C.okSoft : C.warnSoft,
                          gap.basis === 'actual' ? C.ok : C.warn
                        )}
                      >
                        {BASIS_MARK[gap.basis]} {BASIS_LABEL[gap.basis]}
                      </span>
                    ) : step.gapExcluded ? (
                      <span style={badge(C.errorSoft, C.error)}>除外</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {(row.hasApprox || row.hasDateOnly || row.excludedPairs > 0) && (
        <p style={{ ...subTextStyle, marginTop: S.sm, color: C.warn }}>
          このロットには、そのままの実績ではない値が含まれています。
          {row.hasApprox && '「近似」は開始が無いため終了から標準時間を引いた値です。'}
          {row.hasDateOnly && '「日付のみ」は時刻が無いため日をまたぐ分だけ数えています。'}
          {row.excludedPairs > 0 &&
            '「除外」は計算できないため0ではなく対象外にしています（合計に含めていません）。'}
        </p>
      )}
    </div>
  )
}

const cell = {
  padding: '4px 8px',
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: 'nowrap' as const,
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: C.textSub }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 650 }}>{value}</div>
    </div>
  )
}
