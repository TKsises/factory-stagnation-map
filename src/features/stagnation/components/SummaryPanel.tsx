import { C, R, S, WORDING } from '../domain/theme'
import { formatDays, formatRate, type Metrics } from '../domain/metrics'
import { formatManYen } from '../domain/money'
import { panelStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  metrics: Metrics
}

function Cell({
  label,
  value,
  sub,
  strong,
}: {
  label: string
  value: string
  sub?: string
  strong?: boolean
}) {
  return (
    <div
      style={{
        padding: S.md,
        background: strong ? C.accentSoft : C.panelAlt,
        border: `1px solid ${strong ? `${C.accent}44` : C.border}`,
        borderRadius: R.md,
      }}
    >
      <div style={{ fontSize: 11.5, color: C.textSub }}>{label}</div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: strong ? C.accent : C.text,
          marginTop: 2,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const fmtDate = (d: Date | null) =>
  d === null ? '—' : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`

export function SummaryPanel({ metrics }: Props) {
  const { summary, quality, pairs } = metrics
  const worst = pairs[0] ?? null

  return (
    <section style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.sm, flexWrap: 'wrap' }}>
        <h2 style={titleStyle}>サマリー</h2>
        <span style={{ fontSize: 11.5, color: C.textFaint }}>{WORDING.factNote}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: C.textSub }}>
          対象期間 {fmtDate(summary.periodFrom)} 〜 {fmtDate(summary.periodTo)}
          {summary.periodDays !== null && `（${Math.round(summary.periodDays)} 日間）`}
        </span>
      </div>

      {summary.plannedAsActual && (
        <div
          style={{
            marginTop: S.md,
            padding: S.sm,
            background: C.warnSoft,
            border: `1.5px solid ${C.warn}`,
            borderRadius: R.md,
            color: C.warn,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          予定ベース（参考値）― 実績ではなく予定の列で計算しています
        </div>
      )}

      {worst && (
        <div
          style={{
            marginTop: S.md,
            padding: S.md,
            background: C.panelAlt,
            border: `1px solid ${C.border}`,
            borderLeft: `4px solid ${C.sev3}`,
            borderRadius: R.md,
            fontSize: 14,
            lineHeight: 1.7,
            color: C.text,
          }}
        >
          一番長く止まっているのは{' '}
          <strong style={{ fontSize: 15 }}>
            {worst.fromName} と {worst.toName} の間
          </strong>
          。平均 <strong>{formatDays(worst.calendarDaysMean)}</strong>（中央値{' '}
          {formatDays(worst.calendarDaysMedian)}）、対象 {worst.count.toLocaleString()} 件。
          {worst.amountJPY !== null && (
            <>
              {' '}
              ここに <strong>{formatManYen(worst.amountJPY)}</strong> が凍っています。
            </>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: S.md,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: S.sm,
        }}
      >
        <Cell
          label="総リードタイム（暦）平均"
          value={formatDays(summary.leadTimeMeanDays)}
          sub={`中央値 ${formatDays(summary.leadTimeMedianDays)}`}
        />
        <Cell
          label="うち加工など（実績）"
          value={formatDays(summary.processingActualMeanDays)}
          sub="リードタイム − 滞留。検査・運搬・段取りを含む"
        />
        <Cell
          label="うち滞留時間（暦）"
          value={formatDays(summary.stagnationMeanDays)}
          sub={`中央値 ${formatDays(summary.stagnationMedianDays)}`}
          strong
        />
        <Cell label="滞留率" value={formatRate(summary.stagnationRate)} sub="滞留 ÷ 総リードタイム" />
        <Cell
          label="凍結額"
          value={formatManYen(metrics.money.frozenJPY)}
          sub={
            metrics.money.frozenJPY === null
              ? '原価を入力すると出ます'
              : `${WORDING.frozenNote}（${metrics.money.lotsPriced.toLocaleString()} 件から）`
          }
          strong={metrics.money.frozenJPY !== null}
        />
        <Cell
          label="算出に使ったロット"
          value={summary.rateLots.toLocaleString()}
          sub={`読み込み ${quality.lotsTotal.toLocaleString()} 件／除外 ${summary.rateExcludedLots.toLocaleString()} 件`}
        />
      </div>

      <p style={{ ...subTextStyle, marginTop: S.sm, color: C.textFaint }}>
        上の3つは <strong>総リードタイム ＝ 加工など ＋ 滞留</strong> で足し算が合います。
        いずれも実績の時刻から出しています。
        {summary.standardTimeMeanDays !== null && (
          <>
            {' '}
            参考までに、<strong>標準時間の合計は {formatDays(summary.standardTimeMeanDays)}</strong>
            （全工程に標準時間があった {summary.standardTimeLots.toLocaleString()} 件で算出）。
            上の「加工など（実績）」には検査・運搬・段取り・手待ちも含まれるため、
            標準時間より大きくなるのが普通です。
          </>
        )}
      </p>

      <p style={{ ...subTextStyle, marginTop: S.sm, color: C.textFaint }}>
        平均だけでなく中央値も併記しています。外れ値が1件あるだけで平均は崩れるためです。
        {summary.rateExcludedLots > 0 && (
          <>
            {' '}
            工程間に1か所でも欠損があるロット（{summary.rateExcludedLots.toLocaleString()} 件）は、
            <strong>リードタイムと滞留率の計算から外しています</strong>。
            分母だけ残して分子が欠けると、滞留が実際より小さく出てしまうためです。
          </>
        )}{' '}
        金額は原価を入力すると出ます（次のフェーズ）。
      </p>
    </section>
  )
}
