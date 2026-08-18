import { C, MONO, R, S } from '../domain/theme'
import type { ColumnMapping, RawTable } from '../domain/types'
import { panelStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  table: RawTable
  mapping: ColumnMapping
}

const PREVIEW_ROWS = 20

/** その列がどの役割に割り当てられているか（見出しに印を付けるため） */
function roleLabelOf(mapping: ColumnMapping, header: string): string | null {
  if (mapping.actualStart === header) return '実績開始'
  if (mapping.actualEnd === header) return '実績終了'
  if (mapping.lotKey === header) return 'ロットID'
  if (mapping.processKey === header) return '工程'
  if (mapping.processOrder === header) return '工程順'
  if (mapping.plannedStart === header || mapping.plannedEnd === header) return '予定（使わない）'
  return null
}

export function PreviewTable({ table, mapping }: Props) {
  const rows = table.rows.slice(0, PREVIEW_ROWS)

  return (
    <section style={panelStyle}>
      <h2 style={titleStyle}>2. 中身を確認する（先頭 {PREVIEW_ROWS} 行）</h2>
      <p style={{ ...subTextStyle, marginTop: S.xs }}>
        色の付いた列が、いま滞留の計算に使われる列です。
        <span style={{ color: C.error, fontWeight: 600 }}>赤い列は「予定」</span>
        なので計算には使いません。
      </p>

      <div
        style={{
          marginTop: S.md,
          overflowX: 'auto',
          border: `1px solid ${C.border}`,
          borderRadius: R.md,
        }}
      >
        <table style={{ borderCollapse: 'collapse', fontSize: 11.5, fontFamily: MONO }}>
          <thead>
            <tr>
              {table.headers.map((h, i) => {
                const role = roleLabelOf(mapping, h)
                const isPlanned = role === '予定（使わない）'
                const isActual = role === '実績開始' || role === '実績終了'
                return (
                  <th
                    key={`h-${i}-${h}`}
                    style={{
                      position: 'sticky',
                      top: 0,
                      background: isActual ? C.accentSoft : isPlanned ? C.errorSoft : C.panelAlt,
                      color: isActual ? C.accent : isPlanned ? C.error : C.textSub,
                      borderBottom: `1px solid ${C.border}`,
                      borderRight: `1px solid ${C.border}`,
                      padding: '6px 8px',
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                      fontWeight: role ? 700 : 500,
                    }}
                  >
                    {h}
                    {role && (
                      <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>{role}</div>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={`r-${ri}`} style={{ background: ri % 2 ? C.panelAlt : '#fff' }}>
                {row.map((cell, ci) => (
                  <td
                    key={`c-${ri}-${ci}`}
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      borderRight: `1px solid ${C.border}`,
                      padding: '4px 8px',
                      whiteSpace: 'nowrap',
                      color: cell === '' ? C.textFaint : C.text,
                    }}
                  >
                    {cell === '' ? '—' : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
