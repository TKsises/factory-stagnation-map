import { describe, expect, it } from 'vitest'
import { buildRawTable, columnIndex, decodeBytes, parseCsv } from './csv'

const toBuf = (bytes: number[]) => new Uint8Array(bytes).buffer
const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

describe('parseCsv', () => {
  it('素直な行を読む', () => {
    expect(parseCsv('a,b,c\r\n1,2,3\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('引用符の中のカンマを区切りとして扱わない', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']])
  })

  it('"" を引用符1つとして読む', () => {
    expect(parseCsv('a,"b""c",d')).toEqual([['a', 'b"c', 'd']])
  })

  it('引用符の中の改行を行の終わりとして扱わない', () => {
    expect(parseCsv('a,"b\r\nc",d')).toEqual([['a', 'b\r\nc', 'd']])
  })

  it('LF だけの改行も読む', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('CR だけの改行も読む（古いMac由来のCSV）', () => {
    expect(parseCsv('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('末尾に改行が無くても最後の行を落とさない', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('空のフィールドを保つ', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']])
  })

  // 回帰: 引用符の前に空白があると引用が効かず、列がずれていた
  it('引用符の前に空白があっても引用として扱う', () => {
    expect(parseCsv('a, "b,c",d')).toEqual([['a', 'b,c', 'd']])
  })
})

describe('decodeBytes', () => {
  it('BOM付きUTF-8を判定し、BOMを本文に残さない', () => {
    const bytes = [0xef, 0xbb, 0xbf, ...new TextEncoder().encode('製造指示番号')]
    const r = decodeBytes(toBuf(bytes))
    expect(r.encoding).toBe('utf8-bom')
    expect(r.text).toBe('製造指示番号')
    expect(r.text.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('BOM無しUTF-8を判定する', () => {
    const r = decodeBytes(utf8('製造指示番号'))
    expect(r.encoding).toBe('utf8')
    expect(r.text).toBe('製造指示番号')
  })

  it('Shift_JIS(CP932)を文字化けさせずに読む', () => {
    // 製造指示番号 の CP932 バイト列（実際の出力ファイルの先頭と同じ並び）
    const bytes = [0x90, 0xbb, 0x91, 0xa2, 0x8e, 0x77, 0x8e, 0xa6, 0x94, 0xd4, 0x8d, 0x86]
    const r = decodeBytes(toBuf(bytes))
    expect(r.encoding).toBe('shift_jis')
    expect(r.text).toBe('製造指示番号')
  })

  it('ASCIIだけのファイルはUTF-8として読む（結果は同じなので害が無い）', () => {
    const r = decodeBytes(utf8('a,b,c'))
    expect(r.encoding).toBe('utf8')
    expect(r.text).toBe('a,b,c')
  })
})

describe('buildRawTable', () => {
  it('ヘッダーと行を分ける', () => {
    const t = buildRawTable('x.csv', utf8('製造指示番号,工程順\r\nPO-1,1\r\n'))
    expect(t.headers).toEqual(['製造指示番号', '工程順'])
    expect(t.rows).toEqual([['PO-1', '1']])
  })

  it('列が足りない行を空文字で埋める（後段が添字で壊れないように）', () => {
    const t = buildRawTable('x.csv', utf8('a,b,c\r\n1,2\r\n'))
    expect(t.rows).toEqual([['1', '2', '']])
  })

  it('列が多い行を切り詰める', () => {
    const t = buildRawTable('x.csv', utf8('a,b\r\n1,2,3,4\r\n'))
    expect(t.rows).toEqual([['1', '2']])
  })

  it('空行を落とす（Excel由来のCSVは末尾に空行が付きやすい）', () => {
    const t = buildRawTable('x.csv', utf8('a,b\r\n1,2\r\n,\r\n\r\n'))
    expect(t.rows).toEqual([['1', '2']])
  })

  it('ヘッダーだけのファイルでも壊れない', () => {
    const t = buildRawTable('x.csv', utf8('a,b\r\n'))
    expect(t.headers).toEqual(['a', 'b'])
    expect(t.rows).toEqual([])
  })

  it('空のファイルでも壊れない', () => {
    const t = buildRawTable('x.csv', utf8(''))
    expect(t.headers).toEqual([])
    expect(t.rows).toEqual([])
  })

  it('ヘッダーの前後の空白を落とす', () => {
    const t = buildRawTable('x.csv', utf8(' a , b \r\n1,2\r\n'))
    expect(t.headers).toEqual(['a', 'b'])
  })

  // 回帰: 空の列名があると、未割当（''）の役割がその列を掴んでしまう
  it('空の列名に名前を付ける（末尾カンマ対策）', () => {
    const t = buildRawTable('x.csv', utf8('a,b,\r\n1,2,3\r\n'))
    expect(t.headers).toEqual(['a', 'b', '（名前の無い列3）'])
    expect(t.headers.indexOf('')).toBe(-1)
  })
})

describe('回帰: 大きなCSVでも解析が遅くならない', () => {
  // 閾値は実測で決めた。
  //   1文字ずつ継ぎ足す旧方式（同条件・簡略版）… 167 ms
  //   区切りまで一気に切り出す現方式          …  21〜54 ms
  // 100ms なら、旧方式に戻したときに確実に落ちる。
  // ※ ブラウザの実データではもっと差が出た（1,022ms → 31ms）
  it('450万文字を100ミリ秒以内に解析する', () => {
    // 実データ規模（19,000行 × 33列）に近い大きさを組み立てる
    const header = Array.from({ length: 33 }, (_, i) => `列${i + 1}`).join(',')
    const line = Array.from({ length: 33 }, (_, i) => `値${i + 1}-あいうえお`).join(',')
    const text = header + '\r\n' + (line + '\r\n').repeat(19000)
    expect(text.length).toBeGreaterThan(4_000_000)

    // 3回測って最速を採る。1回だけだと GC に当たって落ちることがある
    let best = Infinity
    let rows: string[][] = []
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now()
      rows = parseCsv(text)
      best = Math.min(best, performance.now() - t0)
    }

    expect(rows).toHaveLength(19001)
    expect(rows[1]).toHaveLength(33)
    expect(best).toBeLessThan(100)
  })
})

describe('columnIndex', () => {
  it('未割当（空文字）は必ず -1（空の列名を掴まない）', () => {
    expect(columnIndex(['a', '', 'c'], '')).toBe(-1)
  })

  it('存在する列名の添字を返す', () => {
    expect(columnIndex(['a', 'b'], 'b')).toBe(1)
  })

  it('存在しない列名は -1', () => {
    expect(columnIndex(['a', 'b'], 'z')).toBe(-1)
  })
})
