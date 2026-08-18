// ============================================================
// CSVの解析と文字コード判定
//
// ライブラリを使わず自前で実装する（依存を増やさない方針）。
// 対応: RFC4180 の引用符・埋め込みカンマ・""によるエスケープ・CRLF/LF/CR
// ============================================================

import type { Encoding, RawTable } from './types'

const BOM = [0xef, 0xbb, 0xbf]

/**
 * 文字コードを判定して文字列にする。
 *
 * 判定の順番に意味がある:
 *   1. BOM があれば UTF-8 で確定（一番強い証拠）
 *   2. UTF-8 として「厳密に」読めるなら UTF-8
 *      fatal:true にするのが肝。既定の置換モードだと、Shift_JIS のバイト列も
 *      文字化けしたまま「読めた」ことになってしまい、判定にならない
 *   3. 読めなければ Shift_JIS（CP932）とみなす
 */
export function decodeBytes(buf: ArrayBuffer): { text: string; encoding: Encoding } {
  const bytes = new Uint8Array(buf)

  if (bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2]) {
    const text = new TextDecoder('utf-8').decode(bytes.subarray(3))
    return { text, encoding: 'utf8-bom' }
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text, encoding: 'utf8' }
  } catch {
    // UTF-8 として不正 → Shift_JIS とみなす
  }

  const text = new TextDecoder('shift_jis').decode(bytes)
  return { text, encoding: 'shift_jis' }
}

/**
 * RFC4180 準拠の最小限のCSV解析。
 * 数千行を扱うので、1文字ずつ見る単純なループにしてある
 * （正規表現の分割は引用符の中のカンマ・改行を扱えないため使えない）。
 */
const CH_COMMA = 44
const CH_CR = 13
const CH_LF = 10

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  const n = text.length
  if (n === 0) return rows

  let row: string[] = []
  let i = 0

  for (;;) {
    // ── フィールドを1つ読む ──
    let value: string

    // 引用符の前に空白があっても引用として扱う（`a, "b,c",d` のような手編集CSV対策）
    let j = i
    while (j < n && (text[j] === ' ' || text[j] === '\t')) j++

    if (j < n && text[j] === '"') {
      // 引用符つき。"" のところだけ切り貼りし、それ以外はまとめて切り出す
      j++
      let start = j
      let parts: string[] | null = null
      for (;;) {
        const q = text.indexOf('"', j)
        if (q === -1) {
          // 閉じない引用符。残り全部を値にする（読み込みを止めない）
          value = (parts ? parts.join('') : '') + text.slice(start)
          j = n
          break
        }
        if (text.charCodeAt(q + 1) === 34 /* " */) {
          if (parts === null) parts = []
          parts.push(text.slice(start, q + 1)) // "" は引用符1つ
          j = q + 2
          start = j
          continue
        }
        const tail = text.slice(start, q)
        value = parts === null ? tail : parts.join('') + tail
        j = q + 1
        break
      }
      i = j
      // 閉じ引用符の後にゴミがあっても、区切りまで読み飛ばす
      while (i < n) {
        const c = text.charCodeAt(i)
        if (c === CH_COMMA || c === CH_CR || c === CH_LF) break
        i++
      }
    } else {
      // ★1文字ずつ継ぎ足さず、区切りまで一気に切り出す。
      //   `field += ch` を数百万回やると、それだけで1秒近くかかる（実測）。
      let k = i
      while (k < n) {
        const c = text.charCodeAt(k)
        if (c === CH_COMMA || c === CH_CR || c === CH_LF) break
        k++
      }
      value = text.slice(i, k)
      i = k
    }

    row.push(value)

    // ── 区切りを見る ──
    if (i >= n) {
      rows.push(row)
      break
    }

    const c = text.charCodeAt(i)
    if (c === CH_COMMA) {
      i++
      if (i >= n) {
        // 末尾がカンマ ＝ 空のフィールドがもう1つある
        row.push('')
        rows.push(row)
        break
      }
      continue
    }

    // 改行（CRLF / CR / LF）
    i += c === CH_CR && text.charCodeAt(i + 1) === CH_LF ? 2 : 1
    rows.push(row)
    row = []
    if (i >= n) break
  }

  return rows
}

/** 完全に空の行（区切りだけの行）を落とす。Excel由来のCSVは末尾に空行が付きやすい */
function isBlankRow(row: string[]): boolean {
  return row.every(c => c.trim() === '')
}

/**
 * ファイルを RawTable にする。ここが「外から入るデータ」の唯一の入口。
 * 列数が足りない行は空文字で埋め、多い行は切り詰める（後段が添字で壊れないように）。
 */
export function buildRawTable(fileName: string, buf: ArrayBuffer): RawTable {
  const { text, encoding } = decodeBytes(buf)
  const all = parseCsv(text).filter(r => !isBlankRow(r))

  if (all.length === 0) {
    return { fileName, headers: [], rows: [], encoding }
  }

  // ★空の列名に名前を付ける。
  // Excel でCSVを開いて保存するとヘッダー末尾にカンマが付き、空の列名ができる。
  // 空のままだと、未割当（''）の役割が headers.indexOf('') でその列を掴んでしまい、
  // 「工程順の列が無いのに有ると誤認して並べ替えが効かなくなる」事故になる。
  const headers = all[0].map((h, i) => {
    const name = h.trim()
    return name === '' ? `（名前の無い列${i + 1}）` : name
  })
  const width = headers.length
  const rows = all.slice(1).map(r => {
    if (r.length === width) return r
    const fixed = r.slice(0, width)
    while (fixed.length < width) fixed.push('')
    return fixed
  })

  return { fileName, headers, rows, encoding }
}

/** 列名から添字を引く。同名の列があれば最初のものを使う */
export function columnIndex(headers: string[], name: string): number {
  if (!name) return -1
  return headers.indexOf(name)
}
