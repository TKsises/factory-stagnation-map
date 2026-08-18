import { useState } from 'react'
import type { LayoutView } from '../domain/layout'
import type { LinkReport } from '../domain/layoutLink'
import type { Metrics } from '../domain/metrics'
import { C, R, S } from '../domain/theme'
import type { CostEntry } from '../domain/types'
import {
  buildFootnotes,
  proposalFileName,
  renderProposalPng,
} from '../functions/renderProposalPng'
import { panelStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  metrics: Metrics
  shortenDays: number
  costs: Record<string, CostEntry>
  sourceFileName: string
  layout: LayoutView | null
  link: LinkReport | null
}

export function ExportPanel({
  metrics,
  shortenDays,
  costs,
  sourceFileName,
  layout,
  link,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [preview, setPreview] = useState<'flow' | 'layout'>('flow')

  const canLayout = layout !== null && link !== null && link.bands.length > 0

  const footnotes = buildFootnotes({
    metrics,
    shortenDays,
    costs,
    sourceFileName,
    variant: preview,
    layout,
    link,
  })

  const handleExport = (variant: 'flow' | 'layout') => {
    setError(null)
    try {
      // 描画は純粋関数。ダウンロードはこちらの責務
      const dataUrl = renderProposalPng({
        metrics,
        shortenDays,
        costs,
        sourceFileName,
        variant,
        layout,
        link,
      })
      const name = proposalFileName(new Date(), variant)
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = name
      a.click()
      setDone(name)
    } catch (e) {
      setError(`書き出しに失敗しました：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <section style={panelStyle}>
      <h2 style={titleStyle}>提案用の一枚を書き出す</h2>
      <p style={{ ...subTextStyle, marginTop: S.xs }}>
        画像は口頭の説明なしで相手に渡ります。だから
        <strong>数字の根拠を図の中に入れてあります</strong>
        （算出に使った件数・除外した件数・データの内訳・暦と稼働の別・原価の入力値）。
        これが無いと、決裁の場で「これは何のデータか」で止まります。
      </p>

      <p style={{ ...subTextStyle, marginTop: S.sm, color: C.textFaint }}>
        提案の相手によって効く一枚が違います。
        <strong>経営には流れと金額</strong>、<strong>現場責任者には位置</strong>。2種類とも出せます。
      </p>

      <div style={{ marginTop: S.md, display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => {
            setPreview('flow')
            handleExport('flow')
          }}
          style={exportButtonStyle(true)}
        >
          流れの図で書き出す
        </button>
        <button
          type="button"
          disabled={!canLayout}
          title={canLayout ? undefined : 'レイアウトを取り込み、対応表を作ると使えます'}
          onClick={() => {
            setPreview('layout')
            handleExport('layout')
          }}
          style={exportButtonStyle(canLayout)}
        >
          レイアウトに重ねた図で書き出す
        </button>
      </div>
      {!canLayout && (
        <div style={{ marginTop: S.xs, fontSize: 11.5, color: C.textFaint }}>
          レイアウト版は、「工場レイアウトに重ねる」でJSONを取り込み対応表を1件以上作ると使えます。
        </div>
      )}

      {done && (
        <div style={{ marginTop: S.sm, fontSize: 12, color: C.ok }}>
          {done} を書き出しました。
        </div>
      )}
      {error && (
        <div style={{ marginTop: S.sm, fontSize: 12, color: C.error }}>{error}</div>
      )}

      <div
        style={{
          marginTop: S.md,
          padding: S.md,
          background: C.panelAlt,
          border: `1px solid ${C.border}`,
          borderRadius: R.md,
        }}
      >
        <div style={{ fontSize: 11.5, fontWeight: 650, color: C.textSub }}>
          画像に入る脚注（{preview === 'layout' ? 'レイアウト版' : '流れの図'}／そのまま出ます）
        </div>
        <ul style={{ margin: `${S.sm}px 0 0`, paddingLeft: 18 }}>
          {footnotes.map((line, i) => (
            <li
              key={`fn-${i}`}
              style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.8, marginBottom: 2 }}
            >
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function exportButtonStyle(enabled: boolean) {
  return {
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 650,
    borderRadius: R.md,
    border: 'none',
    background: enabled ? C.accent : C.border,
    color: enabled ? '#fff' : C.textFaint,
    cursor: enabled ? 'pointer' : 'not-allowed',
  } as const
}
