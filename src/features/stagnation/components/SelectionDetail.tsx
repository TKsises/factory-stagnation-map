import { formatDays, type Metrics, type PairMetric, type ProcessMetric } from '../domain/metrics'
import { formatManYen } from '../domain/money'
import { C, R, S } from '../domain/theme'
import { badge, subTextStyle } from './ui'

/** いま何を触っているか */
export type Selection =
  | { kind: 'process'; code: string }
  | { kind: 'gap'; key: string }
  | null

type Props = {
  metrics: Metrics
  selection: Selection
  onSelect: (s: Selection) => void
}


/**
 * 触ったものの詳細だけを出す。
 * 何も触っていないときは「まずどこを見ればいいか」の1行だけ。
 */
export function SelectionDetail({ metrics, selection, onSelect }: Props) {
  if (selection === null) return <Hint metrics={metrics} onSelect={onSelect} />

  if (selection.kind === 'gap') {
    const pair = metrics.pairs.find(p => p.key === selection.key)
    if (!pair) return <Hint metrics={metrics} onSelect={onSelect} />
    return <GapDetail pair={pair} onSelect={onSelect} />
  }

  const proc = metrics.processes.find(p => p.code === selection.code)
  if (!proc) return <Hint metrics={metrics} onSelect={onSelect} />
  return <ProcessDetail proc={proc} metrics={metrics} onSelect={onSelect} />
}

function Shell({
  title,
  tag,
  children,
  onClose,
}: {
  title: string
  tag: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <section
      style={{
        background: C.panel,
        border: `1px solid ${C.accent}55`,
        borderTop: `3px solid ${C.accent}`,
        borderRadius: R.lg,
        padding: S.lg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
        <span style={badge(C.accentSoft, C.accent)}>{tag}</span>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>{title}</h2>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            fontSize: 11.5,
            padding: '4px 10px',
            borderRadius: R.sm,
            border: `1px solid ${C.borderStrong}`,
            background: '#fff',
            color: C.textSub,
            cursor: 'pointer',
          }}
        >
          閉じる
        </button>
      </div>
      {children}
    </section>
  )
}

function Facts({ rows }: { rows: [string, string, string?][] }) {
  return (
    <div
      style={{
        marginTop: S.md,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: S.md,
      }}
    >
      {rows.map(([label, value, sub]) => (
        <div key={`f-${label}`}>
          <div style={{ fontSize: 11.5, color: C.textSub }}>{label}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: C.textFaint }}>{sub}</div>}
        </div>
      ))}
    </div>
  )
}

function GapDetail({ pair, onSelect }: { pair: PairMetric; onSelect: (s: Selection) => void }) {
  return (
    <Shell
      tag="工程と工程の間"
      title={`${pair.fromName} → ${pair.toName}`}
      onClose={() => onSelect(null)}
    >
      <Facts
        rows={[
          ['滞留の平均（暦）', formatDays(pair.calendarDaysMean), `中央値 ${formatDays(pair.calendarDaysMedian)}`],
          ['最も長かったもの', formatDays(pair.calendarDaysMax), '暦'],
          ['滞留の平均（稼働）', formatDays(pair.workingDaysMean), '夜間・休日を除く'],
          ['ここに凍っている金額', formatManYen(pair.amountJPY), pair.amountJPY === null ? '原価を入れると出ます' : undefined],
          ['対象ロット', `${pair.count.toLocaleString()} 件`],
        ]}
      />
      <p style={{ ...subTextStyle, marginTop: S.md, color: C.textFaint }}>
        <strong>暦</strong>は休日も含めた実際の経過時間です（在庫は休日も凍っているので、金額はこちらで
        計算します）。<strong>稼働</strong>は夜間・休日を除いた時間です（休日は縮められないので、
        改善余地の議論はこちらで行います）。
      </p>
      <div style={{ marginTop: S.sm, display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
        <LinkButton label={`← ${pair.fromName} を見る`} onClick={() => onSelect({ kind: 'process', code: pair.fromProcess })} />
        <LinkButton label={`${pair.toName} を見る →`} onClick={() => onSelect({ kind: 'process', code: pair.toProcess })} />
      </div>
    </Shell>
  )
}

function ProcessDetail({
  proc,
  metrics,
  onSelect,
}: {
  proc: ProcessMetric
  metrics: Metrics
  onSelect: (s: Selection) => void
}) {
  const inbound = proc.inboundKey ? metrics.pairs.find(p => p.key === proc.inboundKey) : null
  const outbound = proc.outboundKey ? metrics.pairs.find(p => p.key === proc.outboundKey) : null

  return (
    <Shell tag="工程" title={`${proc.name}（${proc.code}）`} onClose={() => onSelect(null)}>
      <Facts
        rows={[
          ['通ったロット', `${proc.lots.toLocaleString()} 件`],
          [
            '加工時間の平均（実績）',
            proc.workHoursMean === null ? '—' : `${proc.workHoursMean.toFixed(1)} 時間`,
            proc.workHoursMedian === null ? undefined : `中央値 ${proc.workHoursMedian.toFixed(1)} 時間`,
          ],
          [
            '標準時間',
            proc.standardHoursMean === null ? '—' : `${proc.standardHoursMean.toFixed(1)} 時間`,
            '参考値',
          ],
          [
            '実績が欠けている',
            `${proc.incomplete.toLocaleString()} 件`,
            proc.dateOnly > 0 ? `うち日付のみ ${proc.dateOnly.toLocaleString()} 件` : undefined,
          ],
        ]}
      />

      <div
        style={{
          marginTop: S.md,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: S.sm,
        }}
      >
        <NeighborCard label="この工程に入るまでの滞留" pair={inbound} onSelect={onSelect} />
        <NeighborCard label="この工程を出てからの滞留" pair={outbound} onSelect={onSelect} />
      </div>

      {(proc.workCenters.length > 0 || proc.equipments.length > 0) && (
        <p style={{ ...subTextStyle, marginTop: S.md, color: C.textFaint }}>
          実績に出てくる
          {proc.workCenters.length > 0 && <> 作業区：{proc.workCenters.slice(0, 4).join('、')}</>}
          {proc.equipments.length > 0 && <>／設備：{proc.equipments.slice(0, 4).join('、')}</>}
          。レイアウトと対応づけるときの手がかりになります。
        </p>
      )}
    </Shell>
  )
}

function NeighborCard({
  label,
  pair,
  onSelect,
}: {
  label: string
  pair: PairMetric | null | undefined
  onSelect: (s: Selection) => void
}) {
  if (!pair) {
    return (
      <div style={{ padding: S.md, background: C.panelAlt, borderRadius: R.md }}>
        <div style={{ fontSize: 11.5, color: C.textSub }}>{label}</div>
        <div style={{ fontSize: 13, color: C.textFaint, marginTop: 2 }}>
          流れの端なのでありません
        </div>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onSelect({ kind: 'gap', key: pair.key })}
      style={{
        padding: S.md,
        background: C.panelAlt,
        border: `1px solid ${C.border}`,
        borderRadius: R.md,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <div style={{ fontSize: 11.5, color: C.textSub }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: C.text, marginTop: 2 }}>
        {formatDays(pair.calendarDaysMean)}
      </div>
      <div style={{ fontSize: 11.5, color: C.accent }}>{formatManYen(pair.amountJPY)}</div>
      <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2 }}>
        {pair.fromName} → {pair.toName}（押すと詳しく）
      </div>
    </button>
  )
}

function LinkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: '5px 10px',
        borderRadius: R.sm,
        border: `1px solid ${C.borderStrong}`,
        background: '#fff',
        color: C.textSub,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

/** 何も触っていないとき。どこから見ればいいかだけを言う */
function Hint({ metrics, onSelect }: { metrics: Metrics; onSelect: (s: Selection) => void }) {
  const worst = metrics.pairs[0]
  if (!worst) return null
  return (
    <section
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${C.sev3}`,
        borderRadius: R.lg,
        padding: S.lg,
      }}
    >
      <div style={{ fontSize: 14.5, lineHeight: 1.8, color: C.text }}>
        一番長く止まっているのは{' '}
        <strong style={{ fontSize: 16 }}>
          {worst.fromName} と {worst.toName} の間
        </strong>
        。平均 <strong>{formatDays(worst.calendarDaysMean)}</strong>、対象{' '}
        {worst.count.toLocaleString()} 件
        {worst.amountJPY !== null && (
          <>
            、ここに <strong>{formatManYen(worst.amountJPY)}</strong> が凍っています
          </>
        )}
        。
      </div>
      <div style={{ marginTop: S.md, display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
        <LinkButton
          label="この工程間を詳しく見る"
          onClick={() => onSelect({ kind: 'gap', key: worst.key })}
        />
      </div>
      <p style={{ ...subTextStyle, marginTop: S.sm, color: C.textFaint }}>
        地図の<strong>工程の箱</strong>や<strong>山</strong>を押すと、そこだけの数字が出ます。
      </p>
    </section>
  )
}

