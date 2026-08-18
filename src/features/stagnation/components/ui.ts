// 小さな共有スタイル。見た目の重複をここに集める。
import type { CSSProperties } from 'react'
import { C, FONT, R, S } from '../domain/theme'

export const panelStyle: CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: R.lg,
  padding: S.lg,
}

export const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 650,
  color: C.text,
  letterSpacing: 0.2,
}

export const subTextStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.7,
  color: C.textSub,
}

export const selectStyle: CSSProperties = {
  width: '100%',
  fontFamily: FONT,
  fontSize: 13,
  padding: '6px 8px',
  borderRadius: R.sm,
  border: `1px solid ${C.borderStrong}`,
  background: '#fff',
  color: C.text,
}

export const badge = (bg: string, fg: string): CSSProperties => ({
  display: 'inline-block',
  background: bg,
  color: fg,
  fontSize: 11,
  fontWeight: 650,
  padding: '2px 7px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
})
