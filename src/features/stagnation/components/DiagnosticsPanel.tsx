import { C, R, S } from '../domain/theme'
import { formatPct, type MappingDiagnostics } from '../domain/mapping'
import { panelStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  diag: MappingDiagnostics
}

const LEVEL_STYLE = {
  error: { bg: C.errorSoft, fg: C.error, mark: '■' },
  warn: { bg: C.warnSoft, fg: C.warn, mark: '▲' },
  info: { bg: C.panelAlt, fg: C.textSub, mark: '●' },
} as const

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div
      style={{
        padding: S.md,
        background: C.panelAlt,
        border: `1px solid ${C.border}`,
        borderRadius: R.md,
      }}
    >
      <div style={{ fontSize: 11.5, color: C.textSub }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: C.text, marginTop: 2 }}>{value}</div>
      {note && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2 }}>{note}</div>}
    </div>
  )
}

export function DiagnosticsPanel({ diag }: Props) {
  const rows = diag.rowCount

  return (
    <section style={panelStyle}>
      <h2 style={titleStyle}>4. このデータで何が言えるか（診断）</h2>
      <p style={{ ...subTextStyle, marginTop: S.xs }}>
        欠けていることを隠しません。<strong>どこがどれだけ欠けているかを先に出します。</strong>
        これを説明できることが、この資料の信用そのものになります。
      </p>

      {!diag.canCompute && (
        <div
          style={{
            marginTop: S.md,
            padding: S.md,
            background: C.errorSoft,
            border: `1.5px solid ${C.error}`,
            borderRadius: R.md,
            color: C.error,
            fontSize: 14,
            fontWeight: 700,
            lineHeight: 1.7,
          }}
        >
          このデータでは滞留を計算できません。
          <div style={{ fontSize: 12.5, fontWeight: 500, marginTop: S.xs }}>
            実績の開始時刻・終了時刻が指定されていないため、数字を出しません。
            「開始予定日時」で代用すると、それは滞留ではなく計画とのズレになります。
          </div>
        </div>
      )}

      {diag.plannedUsedAsActual && (
        <div
          style={{
            marginTop: S.md,
            padding: S.md,
            background: C.warnSoft,
            border: `1.5px solid ${C.warn}`,
            borderRadius: R.md,
            color: C.warn,
            fontSize: 13.5,
            fontWeight: 700,
          }}
        >
          予定ベース（参考値）
          <div style={{ fontSize: 12, fontWeight: 500, marginTop: 2 }}>
            実績ではなく予定の列で計算しています。書き出す画像にも同じ表示が入ります。
          </div>
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
        <Stat label="読み込んだロット数" value={diag.lotCount.toLocaleString()} />
        <Stat label="読み込んだ行数（工程）" value={rows.toLocaleString()} />
        <Stat
          label="実績が両方そろった行"
          value={diag.bothPresent.toLocaleString()}
          note={formatPct(diag.bothPresent, rows)}
        />
        <Stat
          label="実績開始が空"
          value={diag.actualStartEmpty.toLocaleString()}
          note={formatPct(diag.actualStartEmpty, rows)}
        />
        <Stat
          label="実績終了が空"
          value={diag.actualEndEmpty.toLocaleString()}
          note={formatPct(diag.actualEndEmpty, rows)}
        />
        <Stat
          label="日付だけ（時刻が無い）"
          value={diag.dateOnlyRows.toLocaleString()}
          note={formatPct(diag.dateOnlyRows, rows)}
        />
        <Stat
          label="日時として読めない"
          value={diag.unparsableRows.toLocaleString()}
          note={formatPct(diag.unparsableRows, rows)}
        />
        <Stat
          label="工程順が取れないロット"
          value={diag.lotsWithoutOrder.toLocaleString()}
          note={formatPct(diag.lotsWithoutOrder, diag.lotCount)}
        />
      </div>

      {diag.issues.length > 0 && (
        <div style={{ marginTop: S.md, display: 'grid', gap: S.sm }}>
          {diag.issues.map((issue, i) => {
            const st = LEVEL_STYLE[issue.level]
            return (
              <div
                key={`issue-${i}-${issue.level}`}
                style={{
                  display: 'flex',
                  gap: S.sm,
                  padding: S.sm,
                  background: st.bg,
                  borderRadius: R.sm,
                  fontSize: 12,
                  lineHeight: 1.7,
                  color: st.fg,
                }}
              >
                <span aria-hidden>{st.mark}</span>
                <span>{issue.message}</span>
              </div>
            )
          })}
        </div>
      )}

      <p style={{ ...subTextStyle, marginTop: S.md, color: C.textFaint }}>
        次のフェーズで、ここに「この数字は {diag.lotCount.toLocaleString()} 件のロットのうち ◯◯ 件から
        算出しています」という一文と、実績／近似／日付のみ／除外の内訳が加わります。
      </p>
    </section>
  )
}
