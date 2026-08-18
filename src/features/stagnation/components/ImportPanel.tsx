import { useRef, useState } from 'react'
import { buildRawTable } from '../domain/csv'
import { C, FONT, R, S, WORDING } from '../domain/theme'
import type { RawTable } from '../domain/types'
import { panelStyle, subTextStyle, titleStyle } from './ui'

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

export function ImportPanel({ table, onLoaded, onError }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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

      <p style={{ ...subTextStyle, marginTop: S.md, color: C.textFaint }}>{WORDING.privacy}</p>
    </section>
  )
}
