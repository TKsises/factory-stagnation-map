import { useCallback, useMemo, useState } from 'react'
import { CostPanel } from './features/stagnation/components/CostPanel'
import { DiagnosticsPanel } from './features/stagnation/components/DiagnosticsPanel'
import { ExportPanel } from './features/stagnation/components/ExportPanel'
import { ImportPanel } from './features/stagnation/components/ImportPanel'
import { LayoutPanel } from './features/stagnation/components/LayoutPanel'
import { LotListPanel } from './features/stagnation/components/LotListPanel'
import { MappingPanel } from './features/stagnation/components/MappingPanel'
import { PreviewTable } from './features/stagnation/components/PreviewTable'
import { QualityPanel } from './features/stagnation/components/QualityPanel'
import { StagnationMap } from './features/stagnation/components/StagnationMap'
import { SummaryPanel } from './features/stagnation/components/SummaryPanel'
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

export default function App() {
  // 設定（保存される）。CSVの中身は別に持ち、保存しない。
  const [config, setConfig] = useState<Config>(() => loadConfig())

  // ★いま使っている対応づけ。config.mapping とは別に持つ。
  //   推測しただけのものを保存すると、次回「前回の対応づけをそのまま使いました」と表示され、
  //   ユーザーが一度も確認していない推測が「前回の設定」に化ける。
  //   保存するのは、ユーザーが画面で列を選んだときだけ。
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING)

  const [table, setTable] = useState<RawTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadMs, setLoadMs] = useState<number | null>(null)
  const [mappingSource, setMappingSource] = useState<'saved' | 'guessed' | null>(null)
  const [selectedPair, setSelectedPair] = useState<string | null>(null)
  // 短縮日数は「その場の検討値」なので保存しない（設定と観測を混ぜない）
  const [shortenDays, setShortenDays] = useState(1)
  // レイアウトは「取り込んだ実データ」。保存せず毎回読み直す。
  // 保存するのは対応表（config.processLayout）だけ。
  const [layout, setLayout] = useState<LayoutView | null>(null)
  const [layoutFileName, setLayoutFileName] = useState<string | null>(null)

  const handleLoaded = useCallback(
    (raw: RawTable, elapsedMs: number) => {
      setError(null)
      setTable(raw)
      setLoadMs(elapsedMs)
      setSelectedPair(null)
      const chosen = chooseMapping(config.mapping, raw.headers)
      setMapping(chosen.mapping)
      setMappingSource(chosen.source) // 推測の場合はここで保存しない
    },
    [config.mapping]
  )

  const handleMappingChange = useCallback(
    (role: MappingRole, column: string) => {
      const next = { ...mapping, [role]: column }
      setMapping(next)
      setMappingSource(null)
      setSelectedPair(null)
      // ユーザーが確定した対応づけだけを保存する
      const nextConfig = { ...config, mapping: next }
      setConfig(nextConfig)
      saveConfig(nextConfig)
    },
    [config, mapping]
  )

  // 原価は「設定」なので保存する（CSVの中身は保存しない、との区別）
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

  // 工程 ↔ レイアウトの対応づけは「設定」なので保存する
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

  // 滞留の計算。実績列がそろっていないときは計算しない（それらしい数字を出さないため）
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
  }, [
    table,
    mapping,
    diag?.canCompute,
    diag?.plannedUsedAsActual,
    config.calendar,
    config.costs,
  ])

  // 対応表の計算は1箇所だけ。レイアウト画面と書き出し画像が同じ結果を読む
  const link = useMemo(
    () =>
      layout && analysis ? buildBands(analysis.metrics, layout, config.processLayout) : null,
    [layout, analysis, config.processLayout]
  )

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bg,
        fontFamily: FONT,
        color: C.text,
        padding: S.xl,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: S.lg }}>
        <header>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: 0.3 }}>
            工程滞留マップ
          </h1>
          <p style={{ margin: `${S.xs}px 0 0`, fontSize: 12.5, color: C.textSub, lineHeight: 1.7 }}>
            工程と工程の間で、仕掛品が何日止まっているか ―― それがいくらの運転資金として
            凍っているかを、御社の記録から算出します。
          </p>
        </header>

        {error && (
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
            {error}
          </div>
        )}

        <ImportPanel table={table} onLoaded={handleLoaded} onError={setError} />

        {table && (
          <>
            {loadMs !== null && (
              <div style={{ fontSize: 11.5, color: C.textFaint }}>
                解析 {loadMs.toFixed(0)} ミリ秒
                {analysis && ` ／ 集計 ${analysis.computeMs.toFixed(0)} ミリ秒`}
                {mappingSource === 'saved' && ' ／ 前回あなたが確定した列の対応づけを使いました'}
                {mappingSource === 'guessed' && ' ／ 列名から対応づけを推測しました（確定はご確認を）'}
              </div>
            )}

            {analysis && (
              <>
                <SummaryPanel metrics={analysis.metrics} />
                <StagnationMap
                  metrics={analysis.metrics}
                  selectedKey={selectedPair}
                  onSelect={setSelectedPair}
                />
                <ExportPanel
                  metrics={analysis.metrics}
                  shortenDays={shortenDays}
                  costs={config.costs}
                  sourceFileName={table.fileName}
                  layout={layout}
                  link={link}
                />
                <CostPanel
                  metrics={analysis.metrics}
                  costs={config.costs}
                  onCostChange={handleCostChange}
                  shortenDays={shortenDays}
                  onShortenDaysChange={setShortenDays}
                />
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
                <LotListPanel rows={analysis.lotRows} metrics={analysis.metrics} />
                <QualityPanel quality={analysis.metrics.quality} build={analysis.buildStats} />
              </>
            )}

            <MappingPanel
              table={table}
              mapping={mapping}
              onChange={handleMappingChange}
              onReguess={handleReguess}
            />

            {diag && <DiagnosticsPanel diag={diag} />}

            <PreviewTable table={table} mapping={mapping} />
          </>
        )}
      </div>
    </div>
  )
}
