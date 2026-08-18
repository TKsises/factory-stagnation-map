import { useState } from 'react'
import { C, R, S } from '../domain/theme'
import type { BuildStats } from '../domain/lots'
import { BASIS_LABEL, type QualityReport } from '../domain/metrics'
import type { GapBasis } from '../domain/types'
import { panelStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  quality: QualityReport
  /** CSVの行のうち、ロットに組み込めなかった分。欠けを隠さないために出す */
  build: BuildStats
}

const BASIS_COLOR: Record<GapBasis, string> = {
  actual: C.ok,
  derived: C.accent,
  'date-only': C.warn,
  excluded: C.textFaint,
}

const BASIS_NOTE: Record<GapBasis, string> = {
  actual: '実績の終了→実績の開始。そのまま計算した',
  derived: '開始が無いので、終了から標準時間を引いて近似した',
  'date-only': '日付しか無いので、日をまたぐ分だけ数えた',
  excluded: '計算できないので除外した（0とはみなしていない）',
}

/**
 * データ品質パネル（§7-6）。
 * このパネルを開いて説明できることが、この道具の信用の全て。
 * 目利きの決裁者に「これ何のデータ？」で止められないための唯一の防具。
 */
export function QualityPanel({ quality, build }: Props) {
  const [open, setOpen] = useState(true)
  const order: GapBasis[] = ['actual', 'derived', 'date-only', 'excluded']
  const droppedRows = build.skippedNoLot + build.skippedNoProcess

  return (
    <section style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.md }}>
        <h2 style={titleStyle}>データ品質</h2>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
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
          {open ? '閉じる' : '開く'}
        </button>
      </div>

      <p
        style={{
          marginTop: S.sm,
          padding: S.md,
          background: C.okSoft,
          border: `1px solid ${C.ok}33`,
          borderRadius: R.md,
          fontSize: 13.5,
          fontWeight: 650,
          color: C.text,
          lineHeight: 1.7,
        }}
      >
        {quality.sentence}
      </p>

      {droppedRows > 0 && (
        <div
          style={{
            marginTop: S.sm,
            padding: S.sm,
            background: C.warnSoft,
            borderRadius: R.sm,
            fontSize: 12,
            lineHeight: 1.7,
            color: C.warn,
          }}
        >
          ▲ CSVの {build.totalRows.toLocaleString()} 行のうち{' '}
          <strong>{droppedRows.toLocaleString()} 行</strong>{' '}
          をロットに組み込めませんでした（ロットIDが空 {build.skippedNoLot.toLocaleString()} 行／工程の
          識別子が空 {build.skippedNoProcess.toLocaleString()} 行）。上の数字はこれらを除いた{' '}
          {build.usedRows.toLocaleString()} 行から出しています。
        </div>
      )}

      {open && (
        <>
          {/* 内訳の帯 */}
          <div
            style={{
              marginTop: S.md,
              display: 'flex',
              height: 26,
              borderRadius: R.sm,
              overflow: 'hidden',
              border: `1px solid ${C.border}`,
            }}
          >
            {order.map(basis => {
              const p = quality.basisPercents[basis]
              if (p <= 0) return null
              return (
                <div
                  key={`bar-${basis}`}
                  title={`${BASIS_LABEL[basis]} ${p.toFixed(1)}%`}
                  style={{
                    width: `${p}%`,
                    background: BASIS_COLOR[basis],
                    opacity: basis === 'excluded' ? 0.45 : 0.85,
                  }}
                />
              )
            })}
          </div>

          <div style={{ marginTop: S.md, display: 'grid', gap: S.sm }}>
            {order.map(basis => (
              <div
                key={`row-${basis}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '92px 88px 68px 1fr',
                  gap: S.sm,
                  alignItems: 'baseline',
                  fontSize: 12,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 650 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: BASIS_COLOR[basis],
                      display: 'inline-block',
                    }}
                  />
                  {BASIS_LABEL[basis]}
                </span>
                <span style={{ fontWeight: 650, color: C.text }}>
                  {quality.basisCounts[basis].toLocaleString()} 件
                </span>
                <span style={{ color: C.textSub }}>
                  {quality.basisPercents[basis].toFixed(1)}%
                </span>
                <span style={{ color: C.textFaint, lineHeight: 1.6 }}>{BASIS_NOTE[basis]}</span>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: S.md,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: S.sm,
            }}
          >
            <Fact
              label="使えた行 / 読み込んだ行"
              value={`${build.usedRows.toLocaleString()} / ${build.totalRows.toLocaleString()}`}
              note={build.orderSource === 'column' ? '工程順の列で並べた' : '実績の時刻順で並べた'}
            />
            <Fact label="工程間の総数" value={`${quality.pairsTotal.toLocaleString()} か所`} />
            <Fact
              label="滞留を出せたロット"
              value={`${quality.lotsUsed.toLocaleString()} / ${quality.lotsTotal.toLocaleString()} 件`}
            />
            <Fact
              label="工程が1つだけのロット"
              value={`${quality.lotsNoPair.toLocaleString()} 件`}
              note="工程間が無いので対象外"
            />
            <Fact
              label="工程の重なり"
              value={`${quality.overlaps.toLocaleString()} 件`}
              note="次工程が前工程の終了前に開始。0として扱う"
            />
          </div>

          <p style={{ ...subTextStyle, marginTop: S.md, color: C.textFaint }}>
            「除外」は計算に使っていません。0 として混ぜると滞留が実際より小さく出てしまい、
            かえって実態より良く見える資料になるためです。
          </p>
        </>
      )}
    </section>
  )
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div
      style={{
        padding: S.sm,
        background: C.panelAlt,
        border: `1px solid ${C.border}`,
        borderRadius: R.sm,
      }}
    >
      <div style={{ fontSize: 11, color: C.textSub }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 650, color: C.text, marginTop: 1 }}>{value}</div>
      {note && <div style={{ fontSize: 10.5, color: C.textFaint, marginTop: 1 }}>{note}</div>}
    </div>
  )
}
