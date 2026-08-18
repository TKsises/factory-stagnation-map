import { describe, expect, it } from 'vitest'
import { chooseMapping, diagnoseMapping, guessMapping, isPlannedColumn } from './mapping'
import type { RawTable } from './types'
import { EMPTY_MAPPING } from './types'

/**
 * 実際の工程実績一覧CSVのヘッダー（フェーズ0で確定した並び順そのまま）。
 * 「開始予定日時」が「作業開始日時」より前に来ることが重要。
 */
const REAL_HEADERS = [
  '製造指示番号',
  '製番',
  '工程順',
  '工程指示番号',
  '工程名',
  '工程コード',
  '品目コード',
  '品目グループコード',
  '作業区コード',
  '指示数',
  '標準時間',
  '段取り標準時間',
  '合計標準時間',
  '開始予定日時',
  '終了予定日時',
  '特記事項',
  '設備コード(実績)',
  '担当者社員番号(実績)',
  '担当者(実績)',
  '段取り時間',
  '出来高数',
  '達成率',
  '不良数',
  '不良率',
  '作業開始日時',
  '作業終了日時',
  '合計稼働時間',
  '実稼働時間',
  '中断時間',
  '保留時間',
  '備考',
  'ステータス',
  '最終更新日時',
]

describe('guessMapping ― 実データの列名', () => {
  const m = guessMapping(REAL_HEADERS)

  it('★実績の開始に「作業開始日時」を選ぶ（「開始予定日時」ではない）', () => {
    expect(m.actualStart).toBe('作業開始日時')
  })

  it('★実績の終了に「作業終了日時」を選ぶ（「終了予定日時」ではない）', () => {
    expect(m.actualEnd).toBe('作業終了日時')
  })

  it('予定の列は予定の役割に入る', () => {
    expect(m.plannedStart).toBe('開始予定日時')
    expect(m.plannedEnd).toBe('終了予定日時')
  })

  it('ロットID・工程・工程順を取れる', () => {
    expect(m.lotKey).toBe('製造指示番号')
    expect(m.processKey).toBe('工程コード')
    expect(m.processOrder).toBe('工程順')
    expect(m.processName).toBe('工程名')
  })

  it('似た名前の「標準時間」を取り違えない', () => {
    expect(m.standardTime).toBe('標準時間')
  })

  it('品目コードと指示数を取れる', () => {
    expect(m.itemCode).toBe('品目コード')
    expect(m.quantity).toBe('指示数')
  })

  it('レイアウト対応用の列を取れる', () => {
    expect(m.workCenter).toBe('作業区コード')
    expect(m.equipment).toBe('設備コード(実績)')
  })

  it('単位の列は存在しないので空のまま（勝手に別の列を当てない）', () => {
    expect(m.unit).toBe('')
  })

  it('同じ列を2つの役割に割り当てない', () => {
    const assigned = Object.values(m).filter(v => v !== '')
    expect(new Set(assigned).size).toBe(assigned.length)
  })
})

describe('guessMapping ― 予定しか無いCSV（最も危険なケース）', () => {
  const headers = ['製造指示番号', '工程順', '工程コード', '開始予定日時', '終了予定日時']
  const m = guessMapping(headers)

  it('実績の欄を「開始予定日時」で埋めない。空のままにする', () => {
    expect(m.actualStart).toBe('')
    expect(m.actualEnd).toBe('')
  })

  it('予定は予定の役割にだけ入る', () => {
    expect(m.plannedStart).toBe('開始予定日時')
    expect(m.plannedEnd).toBe('終了予定日時')
  })

  it('滞留は計算できないと診断する', () => {
    const table: RawTable = { fileName: 'x.csv', headers, rows: [], encoding: 'utf8' }
    const d = diagnoseMapping(table, m)
    expect(d.canCompute).toBe(false)
    expect(d.issues.some(i => i.level === 'error' && i.message.includes('計算できません'))).toBe(true)
  })
})

describe('guessMapping ― 「予定」を含む列は実績候補にしない', () => {
  it('部分一致でも予定の列を実績に入れない', () => {
    // 「開始日時(予定)」のような、キーワードには当たるが予定である列
    const m = guessMapping(['製造指示番号', '工程コード', '作業開始日時(予定)', '作業終了日時(予定)'])
    expect(m.actualStart).toBe('')
    expect(m.actualEnd).toBe('')
  })
})

describe('diagnoseMapping ― 欠損の数え方', () => {
  const table: RawTable = {
    fileName: 'x.csv',
    encoding: 'utf8',
    headers: ['製造指示番号', '工程順', '工程コード', '作業開始日時', '作業終了日時'],
    rows: [
      ['L1', '1', 'P010', '2026/04/01 08:30:00', '2026/04/01 10:00:00'], // 両方あり
      ['L1', '2', 'P020', '', '2026/04/03 10:00:00'], // 開始が空
      ['L2', '1', 'P010', '2026/04/01', '2026/04/02'], // 日付だけ
      ['L2', '2', 'P020', '2026/04/05 08:30:00', ''], // 終了が空
      ['L3', '1', 'P010', '未実施', '2026/04/06 10:00:00'], // 読めない
    ],
  }
  const m = guessMapping(table.headers)
  const d = diagnoseMapping(table, m)

  it('行数とロット数を数える', () => {
    expect(d.rowCount).toBe(5)
    expect(d.lotCount).toBe(3)
  })

  it('両方そろっている行を数える', () => {
    expect(d.bothPresent).toBe(2)
  })

  it('空欄を数える', () => {
    expect(d.actualStartEmpty).toBe(1)
    expect(d.actualEndEmpty).toBe(1)
  })

  it('日付だけの行を数える', () => {
    expect(d.dateOnlyRows).toBe(1)
  })

  it('読めない値を数える（0とみなさない）', () => {
    expect(d.unparsableRows).toBe(1)
  })

  it('実績列がそろっていれば計算できると判定する', () => {
    expect(d.canCompute).toBe(true)
  })
})

describe('diagnoseMapping ― 工程順が無い場合', () => {
  it('工程順が取れないロットを数え、警告を出す', () => {
    const table: RawTable = {
      fileName: 'x.csv',
      encoding: 'utf8',
      headers: ['製造指示番号', '工程コード', '作業開始日時', '作業終了日時'],
      rows: [
        ['L1', 'P010', '2026/04/01 08:30:00', '2026/04/01 10:00:00'],
        ['L2', 'P010', '2026/04/01 08:30:00', '2026/04/01 10:00:00'],
      ],
    }
    const d = diagnoseMapping(table, guessMapping(table.headers))
    expect(d.lotsWithoutOrder).toBe(2)
    expect(d.issues.some(i => i.message.includes('工程順'))).toBe(true)
  })
})

describe('diagnoseMapping ― ユーザーが手で予定を実績に選んだ場合', () => {
  it('禁止せず、警告を出す（参考値として扱えるようにするため）', () => {
    const headers = ['製造指示番号', '工程コード', '開始予定日時', '終了予定日時']
    const table: RawTable = { fileName: 'x.csv', headers, rows: [], encoding: 'utf8' }
    const manual = {
      ...EMPTY_MAPPING,
      lotKey: '製造指示番号',
      processKey: '工程コード',
      actualStart: '開始予定日時',
      actualEnd: '終了予定日時',
    }
    const d = diagnoseMapping(table, manual)
    expect(d.plannedUsedAsActual).toBe(true)
    expect(d.canCompute).toBe(true)
    expect(d.issues.some(i => i.level === 'warn' && i.message.includes('予定'))).toBe(true)
  })
})

describe('chooseMapping ― 前回の設定を流用してよいか', () => {
  const saved = {
    ...EMPTY_MAPPING,
    lotKey: '製造指示番号',
    processKey: '工程コード',
    actualStart: '作業開始日時',
    actualEnd: '作業終了日時',
    processName: '工程名',
  }

  it('必須列がそろい、指定列が全て今回のCSVにあれば流用する', () => {
    const r = chooseMapping(saved, REAL_HEADERS)
    expect(r.source).toBe('saved')
    expect(r.mapping.actualStart).toBe('作業開始日時')
  })

  it('必須列が1つでも欠けていたら推測に戻る', () => {
    const r = chooseMapping({ ...saved, actualEnd: '' }, REAL_HEADERS)
    expect(r.source).toBe('guessed')
  })

  it('指定された列が今回のCSVに無ければ推測に戻る', () => {
    const r = chooseMapping({ ...saved, processName: '存在しない列' }, REAL_HEADERS)
    expect(r.source).toBe('guessed')
  })

  it('列の並びが違うCSVでも、列名がそろっていれば流用する', () => {
    const r = chooseMapping(saved, [...REAL_HEADERS].reverse())
    expect(r.source).toBe('saved')
  })

  it('保存が空なら推測する', () => {
    expect(chooseMapping(EMPTY_MAPPING, REAL_HEADERS).source).toBe('guessed')
  })

  it('流用しても元の設定を書き換えない', () => {
    const copy = { ...saved }
    chooseMapping(saved, REAL_HEADERS)
    expect(saved).toEqual(copy)
  })
})

describe('isPlannedColumn ― 判定はここ1箇所', () => {
  it('「予定」「計画」を含む列を予定とみなす', () => {
    expect(isPlannedColumn('開始予定日時')).toBe(true)
    expect(isPlannedColumn('計画開始')).toBe(true)
  })

  it('実績の列は予定とみなさない', () => {
    expect(isPlannedColumn('作業開始日時')).toBe(false)
  })
})

describe('回帰: 読めない値の件数が行数を超えない', () => {
  it('開始と終了の両方が読めなくても1行として数える', () => {
    const table: RawTable = {
      fileName: 'x.csv',
      encoding: 'utf8',
      headers: ['製造指示番号', '工程コード', '作業開始日時', '作業終了日時'],
      rows: [['L1', 'P010', 'よみとれない', 'これもよみとれない']],
    }
    const d = diagnoseMapping(table, guessMapping(table.headers))
    expect(d.rowCount).toBe(1)
    expect(d.unparsableRows).toBe(1) // 2 だと割合が 200% になる
  })
})

describe('回帰: 空の列名を掴まない', () => {
  it('未割当の役割が、名前の無い列を掴まない', () => {
    const table: RawTable = {
      fileName: 'x.csv',
      encoding: 'utf8',
      headers: ['製造指示番号', '工程コード', '作業開始日時', '作業終了日時', '（名前の無い列5）'],
      rows: [['L1', 'P010', '2026/05/11 09:00:00', '2026/05/11 10:00:00', '']],
    }
    const d = diagnoseMapping(table, guessMapping(table.headers))
    expect(d.lotsWithoutOrder).toBe(1) // 工程順の列は無いのだから、取れないと判定されるべき
  })
})

describe('guessMapping ― 敵対的な入力', () => {
  it('列が1つも無くても壊れない', () => {
    expect(guessMapping([])).toEqual(EMPTY_MAPPING)
  })

  it('関係ない列だけでも壊れない', () => {
    const m = guessMapping(['foo', 'bar', 'baz'])
    expect(m.actualStart).toBe('')
    expect(m.lotKey).toBe('')
  })

  it('同じ列名が重複していても、同じ役割に二重に入らない', () => {
    const m = guessMapping(['作業開始日時', '作業開始日時', '作業終了日時'])
    expect(m.actualStart).toBe('作業開始日時')
    expect(m.actualEnd).toBe('作業終了日時')
  })
})
