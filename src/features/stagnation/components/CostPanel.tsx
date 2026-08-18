import { C, R, S, WORDING } from '../domain/theme'
import type { Metrics } from '../domain/metrics'
import { estimateReleasedJPY, formatJPY, formatManYen } from '../domain/money'
import type { CostEntry } from '../domain/types'
import { badge, panelStyle, selectStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  metrics: Metrics
  costs: Record<string, CostEntry>
  onCostChange: (itemCode: string, entry: CostEntry | null) => void
  shortenDays: number
  onShortenDaysChange: (days: number) => void
}

/** 単位の選択肢。顧客の呼び方に合わせて自由入力もできるようにしておく */
const UNIT_OPTIONS = ['ピース', 'kg', 'm', 'L', 'セット', '本', '枚']

export function CostPanel({
  metrics,
  costs,
  onCostChange,
  shortenDays,
  onShortenDaysChange,
}: Props) {
  const { money } = metrics
  const released = estimateReleasedJPY(money.dailyThroughputJPY, shortenDays)
  const priced = money.lotsPriced
  const total = priced + money.lotsNoCost + money.lotsNoItem + money.lotsNoQuantity

  return (
    <section style={panelStyle}>
      <h2 style={titleStyle}>原価と金額</h2>
      <p style={{ ...subTextStyle, marginTop: S.xs }}>
        品目ごとに <strong>1個（1kg）あたりの製造原価</strong> を入れてください。
        在庫モジュールの単価は材料費であって製造原価ではないため、
        <strong>手入力が前提</strong>です。入れた品目の分だけ金額が出ます。
      </p>

      {/* ── 品目ごとの単価入力 ── */}
      <div style={{ marginTop: S.md, display: 'grid', gap: S.sm }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 90px 120px 130px',
            gap: S.sm,
            fontSize: 11.5,
            color: C.textSub,
            fontWeight: 650,
            paddingBottom: 2,
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <span>品目コード</span>
          <span>ロット数</span>
          <span>単価（円）</span>
          <span>単位</span>
        </div>

        {money.items.length === 0 && (
          <p style={{ ...subTextStyle, color: C.textFaint }}>
            品目コードの列が対応づけられていないため、原価を入れる対象がありません。
          </p>
        )}

        {money.items.map(item => {
          const cost = costs[item.code]
          return (
            <div
              key={`item-${item.code}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 90px 120px 130px',
                gap: S.sm,
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                {item.code}
                {!cost && (
                  <span style={{ ...badge(C.errorSoft, C.error), marginLeft: S.sm }}>原価未設定</span>
                )}
              </span>
              <span style={{ fontSize: 12, color: C.textSub }}>
                {item.lots.toLocaleString()} 件
                {item.sampleQuantity !== null && (
                  <span style={{ color: C.textFaint }}> / {item.sampleQuantity}</span>
                )}
              </span>
              <input
                type="number"
                min={0}
                step={1}
                value={cost ? cost.unitCost : ''}
                placeholder="未設定"
                onChange={e => {
                  const v = Number(e.target.value)
                  if (e.target.value === '' || !Number.isFinite(v) || v <= 0) {
                    onCostChange(item.code, null)
                  } else {
                    onCostChange(item.code, { unitCost: v, unit: cost?.unit ?? '' })
                  }
                }}
                style={{
                  ...selectStyle,
                  borderColor: cost ? C.borderStrong : C.error,
                  textAlign: 'right',
                }}
              />
              <input
                list="unit-options"
                value={cost?.unit ?? ''}
                placeholder="ピース / kg…"
                disabled={!cost}
                onChange={e =>
                  cost && onCostChange(item.code, { unitCost: cost.unitCost, unit: e.target.value })
                }
                style={{ ...selectStyle, opacity: cost ? 1 : 0.5 }}
              />
            </div>
          )
        })}
        <datalist id="unit-options">
          {UNIT_OPTIONS.map(u => (
            <option key={`u-${u}`} value={u} />
          ))}
        </datalist>
      </div>

      {money.unitMismatchLots > 0 && (
        <div
          style={{
            marginTop: S.md,
            padding: S.sm,
            background: C.warnSoft,
            borderRadius: R.sm,
            fontSize: 12,
            color: C.warn,
            lineHeight: 1.7,
          }}
        >
          ▲ CSVの単位列と、ここで設定した単位が食い違うロットが{' '}
          {money.unitMismatchLots.toLocaleString()} 件あります。
          <strong>金額の計算にはここで設定した単位を使います。</strong>
        </div>
      )}

      {/* ── ② 凍結額（事実に近い層）── */}
      <div
        style={{
          marginTop: S.lg,
          padding: S.md,
          background: C.accentSoft,
          border: `1px solid ${C.accent}44`,
          borderRadius: R.md,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: S.sm, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.textSub }}>{WORDING.frozenNote}</span>
          <span style={{ ...badge('#fff', C.accent), marginLeft: 'auto' }}>現在の状態</span>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: C.accent, marginTop: 2 }}>
          {formatManYen(money.frozenJPY)}
        </div>
        <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 2 }}>
          {money.frozenJPY === null
            ? '単価を入力すると出ます'
            : `${formatJPY(money.frozenJPY)} ／ ${priced.toLocaleString()} / ${total.toLocaleString()} 件のロットから算出`}
        </div>
        {money.lotsNoCost > 0 && (
          <div style={{ fontSize: 11.5, color: C.warn, marginTop: S.xs, lineHeight: 1.7 }}>
            単価が未設定の品目が {money.itemsMissingCost.length} 件（
            {money.itemsMissingCost.slice(0, 5).join(', ')}
            {money.itemsMissingCost.length > 5 && ' …'}）あります。
            <strong>これらは0円として混ぜず、計算から外しています</strong>
            ので、実際の凍結額はこれより大きくなります。
          </div>
        )}
      </div>

      {/* ── ③ 削減試算（最も慎重に扱う層）── */}
      <div
        style={{
          marginTop: S.md,
          padding: S.md,
          background: C.panelAlt,
          border: `1px dashed ${C.borderStrong}`,
          borderRadius: R.md,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: S.sm, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 650 }}>リードタイムを短縮できた場合</span>
          <span style={{ ...badge(C.warnSoft, C.warn), marginLeft: 'auto' }}>試算</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: S.md, marginTop: S.sm }}>
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={shortenDays}
            onChange={e => onShortenDaysChange(Number(e.target.value))}
            style={{ flex: 1, minWidth: 140 }}
          />
          <span style={{ fontSize: 14, fontWeight: 700, minWidth: 74, textAlign: 'right' }}>
            {shortenDays.toFixed(1)} 日
          </span>
        </div>

        <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: S.sm }}>
          {released === null ? '—' : `${formatManYen(released)} が動く`}
        </div>

        <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 2, lineHeight: 1.7 }}>
          {money.dailyThroughputJPY === null ? (
            '単価を入力すると出ます'
          ) : (
            <>
              1日あたり製造原価 {formatJPY(money.dailyThroughputJPY)} × {shortenDays.toFixed(1)} 日
            </>
          )}
        </div>

        <div
          style={{
            marginTop: S.sm,
            padding: S.sm,
            background: C.warnSoft,
            borderRadius: R.sm,
            fontSize: 12,
            fontWeight: 650,
            color: C.warn,
          }}
        >
          {WORDING.estimateNote}
        </div>
      </div>

      <p style={{ ...subTextStyle, marginTop: S.md, color: C.textFaint }}>
        短縮できる日数はお客様に決めていただく値です。こちらでは決めていません。
        金額の計算には<strong>暦時間</strong>を使っています（在庫は休日も凍っているため）。
      </p>
    </section>
  )
}
