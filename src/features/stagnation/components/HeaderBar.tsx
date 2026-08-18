import { formatDays, formatRate, type Metrics } from '../domain/metrics'
import { formatManYen } from '../domain/money'
import { C, R, S, WORDING } from '../domain/theme'

type Props = {
  metrics: Metrics
  fileName: string
  onReset: () => void
}

const fmtDate = (d: Date | null) =>
  d === null ? '—' : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`

/**
 * 画面上部の細いバー。★数字は3つだけ。
 * 最初から全部出すと、どこを見ればいいのか分からなくなる。
 * 内訳は、地図で工程や工程間を触ったときに出す。
 */
export function HeaderBar({ metrics, fileName, onReset }: Props) {
  const { summary, money, quality } = metrics

  const cells: Array<{ label: string; value: string; sub: string; accent?: boolean }> = [
    {
      label: '総リードタイム（暦）',
      value: formatDays(summary.leadTimeMeanDays),
      sub: `中央値 ${formatDays(summary.leadTimeMedianDays)}`,
    },
    {
      label: 'うち滞留',
      value: formatDays(summary.stagnationMeanDays),
      sub: `滞留率 ${formatRate(summary.stagnationRate)}`,
      accent: true,
    },
    {
      label: '工程間に凍っている金額',
      value: formatManYen(money.frozenJPY),
      sub: money.frozenJPY === null ? '原価を入れると出ます' : WORDING.frozenNote,
    },
  ]

  return (
    <header
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: R.lg,
        padding: `${S.md}px ${S.lg}px`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: S.md,
          flexWrap: 'wrap',
          fontSize: 11.5,
          color: C.textSub,
        }}
      >
        <strong style={{ fontSize: 15, color: C.text, fontWeight: 700 }}>工程滞留マップ</strong>
        <span>{fileName}</span>
        <span>
          {fmtDate(summary.periodFrom)} 〜 {fmtDate(summary.periodTo)}
        </span>
        <span>
          対象 {summary.rateLots.toLocaleString()} / {quality.lotsTotal.toLocaleString()} ロット
        </span>
        <button
          type="button"
          onClick={onReset}
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
          別のCSVを読む
        </button>
      </div>

      {summary.plannedAsActual && (
        <div
          style={{
            marginTop: S.sm,
            padding: `${S.xs}px ${S.sm}px`,
            background: C.warnSoft,
            border: `1px solid ${C.warn}`,
            borderRadius: R.sm,
            color: C.warn,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          予定ベース（参考値）― 実績ではなく予定の列で計算しています
        </div>
      )}

      <div
        style={{
          marginTop: S.md,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: S.md,
        }}
      >
        {cells.map(cell => (
          <div key={`h-${cell.label}`}>
            <div style={{ fontSize: 11.5, color: C.textSub }}>{cell.label}</div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: cell.accent ? C.accent : C.text,
                lineHeight: 1.25,
              }}
            >
              {cell.value}
            </div>
            <div style={{ fontSize: 11, color: C.textFaint }}>{cell.sub}</div>
          </div>
        ))}
      </div>
    </header>
  )
}
