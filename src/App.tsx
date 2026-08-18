import { useCallback, useMemo, useState } from 'react'
import { CostPanel } from './features/stagnation/components/CostPanel'
import { DiagnosticsPanel } from './features/stagnation/components/DiagnosticsPanel'
import { Disclosure } from './features/stagnation/components/Disclosure'
import { ExportPanel } from './features/stagnation/components/ExportPanel'
import { HeaderBar } from './features/stagnation/components/HeaderBar'
import { ImportPanel } from './features/stagnation/components/ImportPanel'
import { LayoutPanel } from './features/stagnation/components/LayoutPanel'
import { LotListPanel } from './features/stagnation/components/LotListPanel'
import { MappingPanel } from './features/stagnation/components/MappingPanel'
import { PreviewTable } from './features/stagnation/components/PreviewTable'
import { QualityPanel } from './features/stagnation/components/QualityPanel'
import { SelectionDetail, type Selection } from './features/stagnation/components/SelectionDetail'
import { StagnationMap } from './features/stagnation/components/StagnationMap'
import { computeGaps } from './features/stagnation/domain/gaps'
import type { LayoutView } from './features/stagnation/domain/layout'
import { buildBands } from './features/stagnation/domain/layoutLink'
import { buildLots } from './features/stagnation/domain/lots'
import { buildLotRows } from './features/stagnation/domain/lotView'
import { chooseMapping, diagnoseMapping, guessMapping } from './features/stagnation/domain/mapping'
import { computeMetrics } from './features/stagnation/domain/metrics'
import { loadConfig, saveConfig } from './features/stagnation/domain/storage'
import { C, FONT, R, S } from './features/stagnation/domain/theme'
import type {
  ColumnMapping,
  Config,
  CostEntry,
  MappingRole,
  RawTable,
} from './features/stagnation/domain/types'
import { EMPTY_MAPPING } from './features/stagnation/domain/types'

/**
 * 画面の骨格
 *
 * ★滞留マップが主役。それ以外は既定で閉じておく。
 *   最初から11枚のパネルを縦に並べると、どこを見ればいいのか分からなくなる。
 *   「地図を見る → 気になったところを押す → そこだけ詳しく出る」の順にする。
 */
export default function App() {
  const [config, setConfig] = useState<Config>(() => loadConfig())

  // 推測しただけの対応づけは保存しない（ユーザーが確定したものだけ保存する）
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING)

  const [table, setTable] = useState<RawTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadMs, setLoadMs] = useState<number | null>(null)
  const [mappingSource, setMappingSource] = useState<'saved' | 'guessed' | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [shortenDays, setShortenDays] = useState(1)

  // レイアウトは「取り込んだ実データ」。保存せず毎回読み直す
  const [layout, setLayout] = useState<LayoutView | null>(null)
  const [layoutFileName, setLayoutFileName] = useState<string | null>(null)

  const handleLoaded = useCallback(
    (raw: RawTable, elapsedMs: number) => {
      setError(null)
      setTable(raw)
      setLoadMs(elapsedMs)
      setSelection(null)
      const chosen = chooseMapping(config.mapping, raw.headers)
      setMapping(chosen.mapping)
      setMappingSource(chosen.source)
    },
    [config.mapping]
  )

  const handleMappingChange = useCallback(
    (role: MappingRole, column: string) => {
      const next = { ...mapping, [role]: column }
      setMapping(next)
      setMappingSource(null)
      setSelection(null)
      const nextConfig = { ...config, mapping: next }
      setConfig(nextConfig)
      saveConfig(nextConfig)
    },
    [config, mapping]
  )

  const handleCostChange = useCallback(
    (itemCode: string, entry: CostEntry | null) => {
      const nextCosts = { ...config.costs }
      if (entry === null) delete nextCosts[itemCode]
      else nextCosts[itemCode] = entry
      const nextConfig = { ...config, costs: nextCosts }
      setConfig(nextConfig)
      saveConfig(nextConfig)
    },
    [config]
  )

  const handleLinkChange = useCallback(
    (processCode: string, itemCode: string) => {
      const next = { ...config.processLayout }
      if (itemCode === '') delete next[processCode]
      else next[processCode] = itemCode
      const nextConfig = { ...config, processLayout: next }
      setConfig(nextConfig)
      saveConfig(nextConfig)
    },
    [config]
  )

  const handleReguess = useCallback(() => {
    if (!table) return
    setMapping(guessMapping(table.headers))
    setMappingSource('guessed')
  }, [table])

  const diag = useMemo(() => (table ? diagnoseMapping(table, mapping) : null), [table, mapping])

  const analysis = useMemo(() => {
    if (!table || !diag?.canCompute) return null
    const t0 = performance.now()
    const { lots, stats: buildStats } = buildLots(table, mapping)
    const gapResult = computeGaps(lots, config.calendar)
    const metrics = computeMetrics(lots, gapResult, {
      plannedAsActual: diag.plannedUsedAsActual,
      costs: config.costs,
    })
    const lotRows = buildLotRows(lots, gapResult.gaps, gapResult.completeLotIds, metrics.amountByLot)
    return { metrics, lotRows, buildStats, computeMs: performance.now() - t0 }
  }, [table, mapping, diag?.canCompute, diag?.plannedUsedAsActual, config.calendar, config.costs])

  const link = useMemo(
    () => (layout && analysis ? buildBands(analysis.metrics, layout, config.processLayout) : null),
    [layout, analysis, config.processLayout]
  )

  const page = {
    minHeight: '100vh',
    background: C.bg,
    fontFamily: FONT,
    color: C.text,
    padding: S.xl,
    boxSizing: 'border-box' as const,
  }

  // ── 読み込み前：取り込みだけを大きく出す ──
  if (!table) {
    return (
      <div style={page}>
        <div style={{ maxWidth: 720, margin: '8vh auto 0', display: 'grid', gap: S.lg }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: 0.3 }}>
              工程滞留マップ
            </h1>
            <p style={{ margin: `${S.sm}px 0 0`, fontSize: 13, color: C.textSub, lineHeight: 1.8 }}>
              工程と工程の間で、仕掛品が何日止まっているか ―― それがいくらの運転資金として
              凍っているかを、御社の記録から算出します。
            </p>
          </div>
          {error && <ErrorBox message={error} />}
          <ImportPanel table={table} onLoaded={handleLoaded} onError={setError} />
        </div>
      </div>
    )
  }

  const costStatus =
    analysis === null
      ? ''
      : analysis.metrics.money.frozenJPY === null
        ? `未設定（${analysis.metrics.money.items.length} 品目）`
        : `${analysis.metrics.money.lotsPriced.toLocaleString()} 件で算出済み`

  return (
    <div style={page}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: S.md }}>
        {error && <ErrorBox message={error} />}

        {analysis ? (
          <HeaderBar
            metrics={analysis.metrics}
            fileName={table.fileName}
            onReset={() => {
              setTable(null)
              setSelection(null)
              setLoadMs(null)
            }}
          />
        ) : (
          <ImportPanel table={table} onLoaded={handleLoaded} onError={setError} />
        )}

        {/* ── 主役：滞留マップ と、押したものの詳細 ── */}
        {analysis && (
          <>
            <StagnationMap
              metrics={analysis.metrics}
              selection={selection}
              onSelect={setSelection}
            />
            <SelectionDetail
              metrics={analysis.metrics}
              selection={selection}
              onSelect={setSelection}
            />
          </>
        )}

        {/* ── 実績列が無いときは、ここで止める ── */}
        {diag && !diag.canCompute && <DiagnosticsPanel diag={diag} />}

        {/* ── 以下は既定で閉じている ── */}
        {analysis && (
          <>
            <Disclosure
              title="原価を入れて金額を出す"
              status={costStatus}
              attention={analysis.metrics.money.frozenJPY === null}
            >
              <CostPanel
                metrics={analysis.metrics}
                costs={config.costs}
                onCostChange={handleCostChange}
                shortenDays={shortenDays}
                onShortenDaysChange={setShortenDays}
              />
            </Disclosure>

            <Disclosure
              title="提案用の一枚を書き出す"
              status={link && link.bands.length > 0 ? '流れ / レイアウトの2種類' : '流れの図'}
            >
              <ExportPanel
                metrics={analysis.metrics}
                shortenDays={shortenDays}
                costs={config.costs}
                sourceFileName={table.fileName}
                layout={layout}
                link={link}
              />
            </Disclosure>

            <Disclosure
              title="ロットを1件ずつ追う"
              status={`${analysis.lotRows.length.toLocaleString()} 件`}
            >
              <LotListPanel rows={analysis.lotRows} metrics={analysis.metrics} />
            </Disclosure>

            <Disclosure
              title="工場レイアウトに重ねる"
              status={
                layout === null
                  ? '未読み込み'
                  : link
                    ? `${link.linkedCount} / ${analysis.metrics.flow.length} 工程が対応済み`
                    : ''
              }
              attention={layout !== null && link !== null && link.unlinked.length > 0}
            >
              <LayoutPanel
                metrics={analysis.metrics}
                layout={layout}
                layoutFileName={layoutFileName}
                onLayoutLoaded={(v, name) => {
                  setLayout(v)
                  setLayoutFileName(name)
                }}
                processLayout={config.processLayout}
                onLinkChange={handleLinkChange}
                link={link}
              />
            </Disclosure>

            <Disclosure
              title="この数字の根拠（データ品質）"
              status={analysis.metrics.quality.sentence.replace('この数字は ', '')}
            >
              <QualityPanel quality={analysis.metrics.quality} build={analysis.buildStats} />
            </Disclosure>
          </>
        )}

        <Disclosure
          title="列の対応づけを直す"
          status={
            mappingSource === 'saved'
              ? '前回あなたが確定した対応づけ'
              : mappingSource === 'guessed'
                ? '列名から推測（未確認）'
                : '確定済み'
          }
          attention={diag !== null && !diag.canCompute}
          defaultOpen={diag !== null && !diag.canCompute}
        >
          <div style={{ display: 'grid', gap: S.md }}>
            <MappingPanel
              table={table}
              mapping={mapping}
              onChange={handleMappingChange}
              onReguess={handleReguess}
            />
            {diag && diag.canCompute && <DiagnosticsPanel diag={diag} />}
            <PreviewTable table={table} mapping={mapping} />
          </div>
        </Disclosure>

        {loadMs !== null && (
          <div style={{ fontSize: 11, color: C.textFaint, textAlign: 'right' }}>
            解析 {loadMs.toFixed(0)} ミリ秒
            {analysis && ` ／ 集計 ${analysis.computeMs.toFixed(0)} ミリ秒`}
          </div>
        )}
      </div>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: S.md,
        background: C.errorSoft,
        border: `1px solid ${C.error}`,
        borderRadius: R.md,
        color: C.error,
        fontSize: 13,
      }}
    >
      {message}
    </div>
  )
}
