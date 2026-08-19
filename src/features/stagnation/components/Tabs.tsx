import type { ReactNode } from 'react'
import { C, R, S } from '../domain/theme'

export type TabDef = {
  id: string
  label: string
  /** 開かなくても分かる短い状態（件数・未設定など） */
  badge?: string
  attention?: boolean
}

type Props = {
  tabs: TabDef[]
  active: string
  onChange: (id: string) => void
  children: ReactNode
}

/**
 * タブ。★折りたたみの積み重ねをやめてこれにした。
 * 折りたたみは「開くまで何があるか分からない」ので、
 * どこに何があるかを常に見せるタブの方が迷わない。
 */
export function Tabs({ tabs, active, onChange, children }: Props) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 2,
          flexWrap: 'wrap',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        {tabs.map(tab => {
          const on = tab.id === active
          return (
            <button
              key={`tab-${tab.id}`}
              type="button"
              onClick={() => onChange(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: `9px ${S.md}px`,
                fontSize: 13,
                fontWeight: on ? 700 : 500,
                color: on ? C.accent : tab.attention ? C.warn : C.textSub,
                background: on ? C.panel : 'transparent',
                border: `1px solid ${on ? C.border : 'transparent'}`,
                borderBottom: on ? `1px solid ${C.panel}` : `1px solid ${C.border}`,
                borderRadius: `${R.md}px ${R.md}px 0 0`,
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {tab.label}
              {tab.badge && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: tab.attention ? C.warn : C.textFaint,
                    background: tab.attention ? C.warnSoft : C.panelAlt,
                    padding: '1px 6px',
                    borderRadius: 999,
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderTop: 'none',
          borderRadius: `0 0 ${R.lg}px ${R.lg}px`,
          padding: S.lg,
        }}
      >
        {children}
      </div>
    </div>
  )
}
