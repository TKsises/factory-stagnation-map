import { useRef, useState } from 'react'
import { buildRawTable } from '../domain/csv'
import { fetchProcessResults } from '../domain/smartcraftApi'
import { C, FONT, R, S, WORDING } from '../domain/theme'
import type { RawTable } from '../domain/types'
import { panelStyle, selectStyle, subTextStyle, titleStyle } from './ui'

type Props = {
  table: RawTable | null
  onLoaded: (table: RawTable, elapsedMs: number) => void
  onError: (message: string) => void
}

const ENCODING_LABEL: Record<RawTable['encoding'], string> = {
  utf8: 'UTF-8',
  'utf8-bom': 'UTF-8（BOM付き）',
  shift_jis: 'Shift_JIS',
}

/**
 * 検証用データ。public/fixtures に置いてあり、配信サイトにもそのまま含まれる。
 * ★これがあるので、URLを開くだけで全機能を試せる（手元にCSVが無くてよい）。
 */
const SAMPLES = [
  {
    file: 'case1-machining-8processes.csv',
    label: '機械加工 8工程',
    size: '4.8MB',
    hint: '2,377ロット / 19,016行。滞留率82%。まずはこれ',
  },
  {
    file: 'case2-assembly-4processes.csv',
    label: '組立 4工程（健全）',
    size: '0.9MB',
    hint: '900ロット。突出した工程間が無い工場。いつも問題ありと言う道具ではないことの確認用',
  },
  {
    file: 'case3-complex-12processes.csv',
    label: '複合加工 12工程',
    size: '4.3MB',
    hint: '1,500ロット。工程飛ばし・日付のみ・欠損が多い',
  },
  {
    file: 'case1-machining-8processes-sjis.csv',
    label: 'Shift_JIS 版',
    size: '4.6MB',
    hint: '機械加工8工程と同じ内容。文字化けしないかの確認用',
  },
  {
    file: 'broken-no-actual-columns.csv',
    label: '実績列が無いCSV',
    size: '1KB',
    hint: '「計算できません」と出るのが正しい',
  },
] as const

export function ImportPanel({ table, onLoaded, onError }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadSample = async (sample: (typeof SAMPLES)[number]) => {
    setBusy(true)
    try {
      // BASE_URL を挟む。GitHub Pages では /factory-stagnation-map/ の下に置かれる
      const res = await fetch(`${import.meta.env.BASE_URL}fixtures/${sample.file}`)
      if (!res.ok) throw new Error(`検証用データを取得できません（HTTP ${res.status}）`)
      const buf = await res.arrayBuffer()
      const t0 = performance.now()
      const raw = buildRawTable(sample.file, buf)
      onLoaded(raw, performance.now() - t0)
    } catch (e) {
      onError(`検証用データを読めませんでした：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const readFile = async (file: File) => {
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const t0 = performance.now()
      const raw = buildRawTable(file.name, buf)
      const elapsed = performance.now() - t0
      if (raw.headers.length === 0) {
        onError(`${file.name} には列が1つもありません。CSVファイルか確認してください。`)
        return
      }
      onLoaded(raw, elapsed)
    } catch (e) {
      onError(`読み込みに失敗しました：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={panelStyle}>
      <h2 style={titleStyle}>1. 工程実績CSVを読み込む</h2>

      <div
        onDragOver={e => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files[0]
          if (file) void readFile(file)
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          marginTop: S.md,
          padding: `${S.xl}px ${S.lg}px`,
          border: `2px dashed ${dragOver ? C.accent : C.borderStrong}`,
          borderRadius: R.md,
          background: dragOver ? C.accentSoft : C.panelAlt,
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'background 120ms, border-color 120ms',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
          {busy ? '読み込み中…' : 'CSVファイルをここにドロップ'}
        </div>
        <div style={{ fontSize: 12, color: C.textSub, marginTop: S.xs }}>
          クリックして選択もできます／UTF-8・Shift_JIS を自動判定します
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void readFile(file)
            e.target.value = ''
          }}
        />
      </div>

      <div style={{ marginTop: S.md }}>
        <div style={{ fontSize: 11.5, color: C.textSub, marginBottom: S.xs }}>
          手元にCSVが無ければ、検証用のデータで試せます
        </div>
        <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
          {SAMPLES.map(s => (
            <button
              key={`sample-${s.file}`}
              type="button"
              disabled={busy}
              onClick={() => void loadSample(s)}
              title={s.hint}
              style={{
                fontSize: 12,
                padding: '6px 11px',
                borderRadius: R.sm,
                border: `1px solid ${C.borderStrong}`,
                background: '#fff',
                color: C.textSub,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {s.label}
              <span style={{ color: C.textFaint }}>（{s.size}）</span>
            </button>
          ))}
        </div>
      </div>

      {table && (
        <div
          style={{
            marginTop: S.md,
            padding: S.md,
            background: C.okSoft,
            border: `1px solid ${C.ok}33`,
            borderRadius: R.md,
            fontSize: 12.5,
            color: C.text,
            fontFamily: FONT,
          }}
        >
          <strong>{table.fileName}</strong>
          <span style={{ color: C.textSub }}>
            {' '}
            ／ 文字コード <strong>{ENCODING_LABEL[table.encoding]}</strong> ／{' '}
            {table.rows.length.toLocaleString()} 行 ／ {table.headers.length} 列
          </span>
        </div>
      )}

      {/* ★APIは開発サーバー経由でのみ使える（キーをブラウザに置かないため）。
          配信サイト（GitHub Pages）にはサーバーが無いので出さない。 */}
      {import.meta.env.DEV && <ApiSource onLoaded={onLoaded} onError={onError} />}

      <p style={{ ...subTextStyle, marginTop: S.md, color: C.textFaint }}>{WORDING.privacy}</p>
    </section>
  )
}

/** Smart Craft API から直接取り込む。開発サーバーが中継し、キーはブラウザに出ない */
function ApiSource({
  onLoaded,
  onError,
}: {
  onLoaded: (t: RawTable, ms: number) => void
  onError: (m: string) => void
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setProgress('接続しています…')
    onError('')
    try {
      const t0 = performance.now()
      const { table } = await fetchProcessResults(
        { resultStartedFrom: from || undefined, resultStartedTo: to || undefined },
        {
          onProgress: p =>
            setProgress(
              p.waitingMs > 0
                ? `${p.fetched.toLocaleString()} 件 取得済み。レート制限（10件/分）のため ${Math.round(p.waitingMs / 1000)} 秒待っています…`
                : `${p.fetched.toLocaleString()} 件 取得済み（${p.page} ページ目）`
            ),
        }
      )
      if (table.rows.length === 0) {
        onError('該当する工程実績がありませんでした。期間を広げてみてください。')
        return
      }
      onLoaded(table, performance.now() - t0)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div
      style={{
        marginTop: S.md,
        padding: S.md,
        background: C.panelAlt,
        border: `1px solid ${C.border}`,
        borderRadius: R.md,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 650, color: C.text }}>
        Smart Craft API から直接取り込む
      </div>
      <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 2, lineHeight: 1.7 }}>
        手元で動かしているときだけ使えます。APIキーは開発サーバーが持ち、
        <strong>ブラウザには渡りません</strong>。使うには <code>.env.local</code> に
        <code>SMARTCRAFT_API_KEY</code> を書いてください（<code>.env.example</code> が雛形です）。
      </div>

      <div style={{ display: 'flex', gap: S.sm, alignItems: 'end', marginTop: S.sm, flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 11, color: C.textSub }}>作業開始日（から）</span>
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            style={{ ...selectStyle, width: 150 }}
          />
        </label>
        <label style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 11, color: C.textSub }}>（まで）</span>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            style={{ ...selectStyle, width: 150 }}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          style={{
            fontSize: 12.5,
            padding: '7px 14px',
            borderRadius: R.sm,
            border: 'none',
            background: busy ? C.border : C.accent,
            color: busy ? C.textFaint : '#fff',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? '取得中…' : 'APIから取り込む'}
        </button>
      </div>

      {progress && (
        <div style={{ fontSize: 11.5, color: C.accent, marginTop: S.sm }}>{progress}</div>
      )}
    </div>
  )
}
