import { useCallback, useMemo, useState } from 'react'
import { CostPanel } from './features/stagnation/components/CostPanel'
import { DiagnosticsPanel } from './features/stagnation/components/DiagnosticsPanel'
import { ExportPanel } from './features/stagnation/components/ExportPanel'
import { HeaderBar } from './features/stagnation/components/HeaderBar'
import { ImportPanel } from './features/stagnation/components/ImportPanel'
import { LayoutFullView } from './features/stagnation/components/LayoutFullView'
import { LayoutPanel } from './features/stagnation/components/LayoutPanel'
import { LotListPanel } from './features/stagnation/components/LotListPanel'
import { MappingPanel } from './features/stagnation/components/MappingPanel'
import { PreviewTable } from './features/stagnation/components/PreviewTable'
import { QualityPanel } from './features/stagnation/components/QualityPanel'
import { SelectionDetail, type Selection } from './features/stagnation/components/SelectionDetail'
import { StagnationMap } from './features/stagnation/components/StagnationMap'
import { Tabs, type TabDef } from './features/stagnation/components/Tabs'
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
 * ★滞留マップが主役。上に対象期間と主要な3つの数字、下にタブ。
 *   折りたたみを積み重ねていたが、開くまで何があるか分からないのでタブにした。
 * ★工場レイアウトは専用ビューで開く。折りたたみの中では狭すぎて図が読めない。
 */
export default function App() {
  const [config, setConfig] = useState<Config>(() => loadConfig())
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING)
  const [table, setTable] = useState<RawTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadMs, setLoadMs] = useState<number | null>(null)
  const [mappingSource, setMappingSource] = useState<'saved' | 'guessed' | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [shortenDays, setShortenDays] = useState(1)
  const [tab, setTab] = useState('map')
  const [layoutOpen, setLayoutOpen] = useState(false)

  // レイアウトは「取り込んだ実データ」。保存せず毎回読み直す
  const [layout, setLayout] = useState<LayoutView | null>(null)
  const [layoutFileName, setLayoutFileName] = useState<string | null>(null)

  const handleLoaded = useCallback(
    (raw: RawTable, elapsedMs: number) => {
      setError(null)
      setTable(raw)
      setLoadMs(elapsedMs)
      setSelection(null)
      setTab('map')
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

  const handleRelayBaseChange = useCallback(
    (v: string) => {
      const nextConfig = { ...config, apiRelayBase: v }
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

  // ── 読み込み前 ──
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
          <ImportPanel
            table={table}
            onLoaded={handleLoaded}
            onError={setError}
            relayBase={config.apiRelayBase}
            onRelayBaseChange={handleRelayBaseChange}
          />
        </div>
      </div>
    )
  }

  const canLayout = layout !== null && link !== null && link.bands.length > 0

  const tabs: TabDef[] = analysis
    ? [
        { id: 'map', label: '滞留マップ' },
        { id: 'lots', label: 'ロット別実績', badge: analysis.lotRows.length.toLocaleString() },
        {
          id: 'cost',
          label: '原価と金額',
          badge: analysis.metrics.money.frozenJPY === null ? '未設定' : '設定済み',
          attention: analysis.metrics.money.frozenJPY === null,
        },
        { id: 'layout', label: '工場レイアウト', badge: layout === null ? '未読み込み' : `${link?.linkedCount ?? 0}/${analysis.metrics.flow.length}`, attention: layout !== null && (link?.unlinked.length ?? 0) > 0 },
        { id: 'quality', label: 'データ品質', badge: `${analysis.metrics.summary.rateLots.toLocaleString()}件` },
        {
          id: 'mapping',
          label: '列の対応づけ',
          badge: mappingSource === 'guessed' ? '推測' : undefined,
          attention: !diag?.canCompute,
        },
        { id: 'export', label: '書き出し' },
      ]
    : [{ id: 'mapping', label: '列の対応づけ', attention: true }]

  const activeTab = tabs.some(t => t.id === tab) ? tab : tabs[0].id

  return (
    <div style={page}>
      {layoutOpen && layout && link && (
        <LayoutFullView
          layout={layout}
          link={link}
          onClose={() => setLayoutOpen(false)}
          onOpenLinkTable={() => {
            setLayoutOpen(false)
            setTab('layout')
          }}
        />
      )}

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
            canLayout={canLayout}
            onOpenLayout={() => setLayoutOpen(true)}
          />
        ) : (
          <ImportPanel
            table={table}
            onLoaded={handleLoaded}
            onError={setError}
            relayBase={config.apiRelayBase}
            onRelayBaseChange={handleRelayBaseChange}
          />
        )}

        {diag && !diag.canCompute && <DiagnosticsPanel diag={diag} />}

        <Tabs tabs={tabs} active={activeTab} onChange={setTab}>
          {analysis && activeTab === 'map' && (
            <div style={{ display: 'grid', gap: S.md }}>
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
            </div>
          )}

          {analysis && activeTab === 'lots' && (
            <LotListPanel rows={analysis.lotRows} metrics={analysis.metrics} />
          )}

          {analysis && activeTab === 'cost' && (
            <CostPanel
              metrics={analysis.metrics}
              costs={config.costs}
              onCostChange={handleCostChange}
              shortenDays={shortenDays}
              onShortenDaysChange={setShortenDays}
            />
          )}

          {analysis && activeTab === 'layout' && (
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
              onOpenFullView={canLayout ? () => setLayoutOpen(true) : undefined}
            />
          )}

          {analysis && activeTab === 'quality' && (
            <QualityPanel quality={analysis.metrics.quality} build={analysis.buildStats} />
          )}

          {activeTab === 'mapping' && (
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
          )}

          {analysis && activeTab === 'export' && (
            <ExportPanel
              metrics={analysis.metrics}
              shortenDays={shortenDays}
              costs={config.costs}
              sourceFileName={table.fileName}
              layout={layout}
              link={link}
            />
          )}
        </Tabs>

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
