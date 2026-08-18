import { C, R, S } from '../domain/theme'
import { isPlannedColumn, ROLE_DEFS } from '../domain/mapping'
import type { ColumnMapping, MappingRole, RawTable } from '../domain/types'
import { badge, panelStyle, selectStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  table: RawTable
  mapping: ColumnMapping
  onChange: (role: MappingRole, column: string) => void
  onReguess: () => void
}

// 「予定」の判定はドメイン側（mapping.ts）の1箇所に集約してある。
// ここで別に書くと、禁止語を足したときに画面の警告だけ古いままになる。
const isPlanned = isPlannedColumn

export function MappingPanel({ table, mapping, onChange, onReguess }: Props) {
  return (
    <section style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md, flexWrap: 'wrap' }}>
        <h2 style={titleStyle}>3. 列の対応づけ</h2>
        <button
          type="button"
          onClick={onReguess}
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            padding: '5px 10px',
            borderRadius: R.sm,
            border: `1px solid ${C.borderStrong}`,
            background: '#fff',
            color: C.textSub,
            cursor: 'pointer',
          }}
        >
          推測をやり直す
        </button>
      </div>

      <p style={{ ...subTextStyle, marginTop: S.xs }}>
        初期値は列名から推測したものです。<strong>確定するのはあなたです。</strong>
        列名が違う顧客でも、ここを変えるだけで動きます。
      </p>

      <div style={{ marginTop: S.lg, display: 'grid', gap: S.md }}>
        {ROLE_DEFS.map(def => {
          const value = mapping[def.role]
          const plannedInActual =
            (def.role === 'actualStart' || def.role === 'actualEnd') && isPlanned(value)
          const missingEssential = def.essential && value === ''

          return (
            <div
              key={`role-${def.role}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(180px, 240px) minmax(200px, 1fr)',
                gap: S.md,
                alignItems: 'start',
                padding: S.sm,
                borderRadius: R.md,
                background: missingEssential
                  ? C.errorSoft
                  : plannedInActual
                    ? C.warnSoft
                    : 'transparent',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 650,
                    color: def.essential ? C.text : C.textSub,
                    display: 'flex',
                    alignItems: 'center',
                    gap: S.sm,
                    flexWrap: 'wrap',
                  }}
                >
                  {def.label}
                  {def.essential && <span style={badge(C.accentSoft, C.accent)}>必須</span>}
                </div>
                <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 2, lineHeight: 1.6 }}>
                  {def.hint}
                </div>
              </div>

              <div>
                <select
                  value={value}
                  onChange={e => onChange(def.role, e.target.value)}
                  style={{
                    ...selectStyle,
                    borderColor: missingEssential
                      ? C.error
                      : plannedInActual
                        ? C.warn
                        : C.borderStrong,
                  }}
                >
                  <option value="">（指定しない）</option>
                  {table.headers.map((h, i) => (
                    <option key={`opt-${def.role}-${i}-${h}`} value={h}>
                      {h}
                      {isPlanned(h) ? '  ※予定' : ''}
                    </option>
                  ))}
                </select>

                {plannedInActual && (
                  <div style={{ fontSize: 11.5, color: C.warn, marginTop: S.xs, lineHeight: 1.6 }}>
                    「予定」の列が実績に選ばれています。これで出る数字は滞留ではなく計画とのズレです。
                  </div>
                )}
                {missingEssential && (
                  <div style={{ fontSize: 11.5, color: C.error, marginTop: S.xs, lineHeight: 1.6 }}>
                    この列が無いと滞留を計算できません。
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
