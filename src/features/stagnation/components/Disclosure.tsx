import { useState, type ReactNode } from 'react'
import { C, R, S } from '../domain/theme'

type Props = {
  title: string
  /** 開かなくても分かる短い状態（例「5品目のうち5件に単価あり」） */
  status?: string
  /** 注意を引く必要があるとき（未設定・警告など） */
  attention?: boolean
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * 折りたたみ。★既定は閉じる。
 * 最初から全部並べると、どこを見ればいいのか分からなくなる。
 * 見出しに「開かなくても分かる状態」を出しておき、必要な人だけ開く。
 */
export function Disclosure({ title, status, attention, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section
      style={{
        background: C.panel,
        border: `1px solid ${attention ? C.warn : C.border}`,
        borderRadius: R.lg,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: S.sm,
          padding: `${S.md}px ${S.lg}px`,
          background: open ? C.panelAlt : 'transparent',
          border: 'none',
          borderBottom: open ? `1px solid ${C.border}` : 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 14,
            color: C.textFaint,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms',
          }}
        >
          ▶
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 650, color: C.text }}>{title}</span>
        {status && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11.5,
              color: attention ? C.warn : C.textSub,
              fontWeight: attention ? 650 : 400,
            }}
          >
            {status}
          </span>
        )}
      </button>
      {open && <div style={{ padding: S.lg }}>{children}</div>}
    </section>
  )
}
