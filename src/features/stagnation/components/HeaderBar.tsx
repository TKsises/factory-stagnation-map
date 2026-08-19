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
      label: 'うち滞留（待ち）',
      value: formatDays(summary.stagnationMeanDays),
      sub: `滞留率 ${formatRate(summary.stagnationRate)}／加工など ${formatDays(summary.processingActualMeanDays)}`,
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

      {/* ★いつからいつまでの話なのかを、数字より先に出す。
          これが無いと「その4日って、いつの話？」で最初に止まる。 */}
      <div
        style={{
          marginTop: S.sm,
          padding: `${S.sm}px ${S.md}px`,
          background: C.panelAlt,
          border: `1px solid ${C.border}`,
          borderRadius: R.md,
          display: 'flex',
          alignItems: 'baseline',
          gap: S.md,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 11.5, color: C.textSub }}>対象期間</span>
        <strong style={{ fontSize: 15, color: C.text, fontWeight: 700 }}>
          {fmtDate(summary.periodFrom)} 〜 {fmtDate(summary.periodTo)}
        </strong>
        {summary.periodDays !== null && (
          <span style={{ fontSize: 12, color: C.textSub }}>
            （{Math.round(summary.periodDays).toLocaleString()} 日間）
          </span>
        )}
        <span style={{ fontSize: 11.5, color: C.textSub, marginLeft: 'auto' }}>
          評価ロット{' '}
          <strong style={{ fontSize: 13, color: C.text }}>
            {summary.rateLots.toLocaleString()}
          </strong>{' '}
          / {quality.lotsTotal.toLocaleString()} 件
          {summary.rateExcludedLots > 0 && (
            <span style={{ color: C.warn }}>
              （{summary.rateExcludedLots.toLocaleString()} 件は欠損のため除外）
            </span>
          )}
        </span>
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
            {/* 滞留のところだけ、加工と滞留の比率を帯で見せる。
                「8.5日」だけだと長いのか短いのか分からない */}
            {cell.accent && summary.stagnationRate !== null && (
              <div
                style={{
                  marginTop: 5,
                  display: 'flex',
                  height: 7,
                  borderRadius: 4,
                  overflow: 'hidden',
                  background: C.border,
                }}
                title={`加工など ${formatDays(summary.processingActualMeanDays)} ／ 滞留 ${formatDays(summary.stagnationMeanDays)}`}
              >
                <div
                  style={{
                    width: `${(1 - summary.stagnationRate) * 100}%`,
                    background: C.ok,
                  }}
                />
                <div style={{ flex: 1, background: C.sev3 }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </header>
  )
}
