// ============================================================
// 列マッピング（CSVの列 ↔ アプリが必要とする意味）
//
// ★このアプリの生命線。列名をコードに直書きしないための仕組み。
//
// 【フェーズ0で判明した罠】
// 工程実績CSVには似た日時列が4つ並ぶ:
//   作業開始日時 / 作業終了日時 … 実績  ← 使う
//   開始予定日時 / 終了予定日時 … 予定  ← 使わない
// 実績側の名前に「実績」の語が入っていない。しかも列の並びは予定の方が先。
// つまり素朴な部分一致だと、予定を実績として掴む。それをここで防ぐ。
// ============================================================

import type { ColumnMapping, MappingRole, RawTable } from './types'
import { EMPTY_MAPPING } from './types'
import { columnIndex } from './csv'
import { parseTimestamp } from './datetime'

export type RoleDef = {
  role: MappingRole
  label: string
  /** 何のための列かの短い説明 */
  hint: string
  /** 滞留の計算に必須か */
  essential: boolean
  /** 完全一致で狙う列名（フェーズ0で確定した実際の列名） */
  exact: string[]
  /** 完全一致で見つからないときの部分一致キーワード */
  keywords: string[]
  /** この語を含む列は候補にしない */
  forbid?: string[]
}

/**
 * 予定の列を実績として掴まないための禁止語。
 * ★このルールの定義はここ1箇所だけ。画面側も isPlannedColumn() を使うこと。
 * UIで別途 name.includes('予定') と書くと、ここに語を足しても追随せず警告が漏れる。
 */
export const PLANNED_WORDS = ['予定', '計画']

export function isPlannedColumn(name: string): boolean {
  return PLANNED_WORDS.some(word => name.includes(word))
}

export const ROLE_DEFS: RoleDef[] = [
  {
    role: 'lotKey',
    label: 'ロットID（製造指示）',
    hint: 'これを単位に工程を追う。機械単位で追うと複数品目のときに破綻する',
    essential: true,
    exact: ['製造指示番号'],
    keywords: ['製造指示', '指図', 'ロット'],
  },
  {
    role: 'processKey',
    label: '工程の識別子',
    hint: '工程コードが品目ごとに分かれるテナントでは「工程名」を選ぶ',
    essential: true,
    exact: ['工程コード'],
    keywords: ['工程コード'],
  },
  {
    role: 'actualStart',
    label: '★実績の開始時刻',
    hint: '「開始予定日時」ではない。予定で計算したら、それは滞留ではなく計画のズレ',
    essential: true,
    exact: ['作業開始日時'],
    keywords: ['作業開始', '実績開始', '開始実績'],
    forbid: PLANNED_WORDS,
  },
  {
    role: 'actualEnd',
    label: '★実績の終了時刻',
    hint: '「終了予定日時」ではない',
    essential: true,
    exact: ['作業終了日時'],
    keywords: ['作業終了', '実績終了', '終了実績'],
    forbid: PLANNED_WORDS,
  },
  {
    role: 'processOrder',
    label: '工程順',
    hint: '無ければ実績の時刻順に並べる',
    essential: false,
    exact: ['工程順'],
    keywords: ['工程順', '順序'],
  },
  {
    role: 'processName',
    label: '工程名',
    hint: '画面の表示に使う',
    essential: false,
    exact: ['工程名'],
    keywords: ['工程名'],
  },
  {
    role: 'itemCode',
    label: '品目コード',
    hint: '原価を引くキー',
    essential: false,
    exact: ['品目コード'],
    keywords: ['品目コード', '品番'],
  },
  {
    role: 'quantity',
    label: '数量（指示数）',
    hint: 'ロット金額 = 数量 × 単価 に使う',
    essential: false,
    exact: ['指示数'],
    keywords: ['指示数'],
  },
  {
    role: 'unit',
    label: '単位',
    hint: 'Smart Craft の工程実績CSVには単位列が無い。その場合は原価設定で品目ごとに指定する',
    essential: false,
    exact: ['単位'],
    keywords: ['単位'],
  },
  {
    role: 'standardTime',
    label: '標準時間',
    hint: '実績の開始が欠けたときの近似に使う',
    essential: false,
    exact: ['標準時間'],
    // 「合計標準時間」を奪わないようにする（別の役割で使うため）
    keywords: ['標準時間'],
    forbid: ['合計'],
  },
  {
    role: 'totalStandardTime',
    label: '合計標準時間',
    hint: '標準時間＋段取り標準時間。正味加工時間はこちらを使う',
    essential: false,
    exact: ['合計標準時間'],
    keywords: ['合計標準時間'],
  },
  {
    role: 'plannedStart',
    label: '開始予定日時（表示のみ）',
    hint: '滞留の計算には使わない',
    essential: false,
    exact: ['開始予定日時'],
    keywords: ['開始予定'],
  },
  {
    role: 'plannedEnd',
    label: '終了予定日時（表示のみ）',
    hint: '滞留の計算には使わない',
    essential: false,
    exact: ['終了予定日時'],
    keywords: ['終了予定'],
  },
  {
    role: 'workCenter',
    label: '作業区コード',
    hint: 'レイアウト図との対応づけに使える',
    essential: false,
    exact: ['作業区コード'],
    keywords: ['作業区'],
  },
  {
    role: 'equipment',
    label: '設備コード',
    hint: 'レイアウト図との対応づけに使える',
    essential: false,
    exact: ['設備コード(実績)', '設備コード'],
    keywords: ['設備コード'],
  },
]

/**
 * 列名から対応づけを推測する。
 * ★あくまで初期値。確定はユーザーが画面で行う。
 *
 * 2段階に分けてあるのが肝:
 *   1周目 … 全ての役割が「完全一致」を試す
 *   2周目 … 余った役割だけが「部分一致」を試す
 * こうしないと、先に処理した役割が部分一致で列を奪い、
 * 後から来る役割の完全一致が空振りする。
 */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = { ...EMPTY_MAPPING }
  const used = new Set<string>()

  const allowed = (def: RoleDef, header: string) =>
    !def.forbid?.some(word => header.includes(word))

  // 1周目：完全一致
  for (const def of ROLE_DEFS) {
    for (const name of def.exact) {
      if (used.has(name)) continue
      if (!headers.includes(name)) continue
      if (!allowed(def, name)) continue
      mapping[def.role] = name
      used.add(name)
      break
    }
  }

  // 2周目：部分一致（完全一致で埋まらなかった役割だけ）
  for (const def of ROLE_DEFS) {
    if (mapping[def.role] !== '') continue
    for (const kw of def.keywords) {
      const hit = headers.find(h => !used.has(h) && h.includes(kw) && allowed(def, h))
      if (hit) {
        mapping[def.role] = hit
        used.add(hit)
        break
      }
    }
  }

  return mapping
}

/**
 * 前回の対応づけが今回のCSVにも使えるなら、それを使う。
 * 同じ形のCSVを何度も読ませる運用（週次で見る）を軽くするため。
 * 少しでも噛み合わなければ、黙って流用せず推測に戻す。
 */
export function chooseMapping(
  saved: ColumnMapping,
  headers: string[]
): { mapping: ColumnMapping; source: 'saved' | 'guessed' } {
  const essential = ROLE_DEFS.filter(d => d.essential).map(d => d.role)
  const usable =
    essential.every(role => saved[role] !== '' && headers.includes(saved[role])) &&
    // 指定されている列は全て今回のCSVに存在すること
    Object.values(saved).every(col => col === '' || headers.includes(col))

  return usable ? { mapping: { ...saved }, source: 'saved' } : { mapping: guessMapping(headers), source: 'guessed' }
}

// ── 診断 ─────────────────────────────────────────────────

export type Issue = {
  level: 'error' | 'warn' | 'info'
  message: string
}

export type MappingDiagnostics = {
  rowCount: number
  lotCount: number
  /** 滞留が計算できる状態か。false のときは、それらしい数字を一切出さない */
  canCompute: boolean
  /** 実績の開始・終了が両方そろっている行 */
  bothPresent: number
  actualStartEmpty: number
  actualEndEmpty: number
  /** 日付だけで時刻が無い行 */
  dateOnlyRows: number
  /** 日時として解釈できなかった行 */
  unparsableRows: number
  /** 工程順が取れないロット */
  lotsWithoutOrder: number
  /** 予定の列が実績欄に選ばれている */
  plannedUsedAsActual: boolean
  issues: Issue[]
}

const pct = (a: number, b: number) => (b === 0 ? 0 : (a / b) * 100)

export function formatPct(a: number, b: number): string {
  return `${pct(a, b).toFixed(1)}%`
}

/**
 * 対応づけを確定する前に、そのCSVで本当に滞留が出せるかを診断する。
 * ここで「出せません」と正直に言えることが、この道具の最重要の振る舞い。
 */
export function diagnoseMapping(table: RawTable, mapping: ColumnMapping): MappingDiagnostics {
  // ★ headers.indexOf(mapping[role]) を直接使わない。
  // 未割当は '' なので、空の列名がCSVにあると実在の添字を掴んでしまう。
  const idx = (role: MappingRole) => columnIndex(table.headers, mapping[role])

  const iLot = idx('lotKey')
  const iStart = idx('actualStart')
  const iEnd = idx('actualEnd')
  const iOrder = idx('processOrder')

  const lots = new Set<string>()
  const lotsMissingOrder = new Set<string>()
  let bothPresent = 0
  let actualStartEmpty = 0
  let actualEndEmpty = 0
  let dateOnlyRows = 0
  let unparsableRows = 0

  for (const row of table.rows) {
    if (iLot >= 0) {
      const lotId = row[iLot]?.trim() ?? ''
      if (lotId !== '') {
        lots.add(lotId)
        if (iOrder < 0 || (row[iOrder]?.trim() ?? '') === '') lotsMissingOrder.add(lotId)
      }
    }

    const rawStart = iStart >= 0 ? row[iStart] : ''
    const rawEnd = iEnd >= 0 ? row[iEnd] : ''
    const s = parseTimestamp(rawStart)
    const e = parseTimestamp(rawEnd)

    const startBlank = (rawStart ?? '').trim() === ''
    const endBlank = (rawEnd ?? '').trim() === ''

    if (startBlank) actualStartEmpty++
    if (endBlank) actualEndEmpty++
    // 行単位で数える。開始と終了の両方が読めない行を2件と数えると、
    // 同じ画面の「行に対する割合」が100%を超えてしまう（実際に200%と表示されていた）
    if ((!startBlank && s.date === null) || (!endBlank && e.date === null)) unparsableRows++
    if (s.dateOnly || e.dateOnly) dateOnlyRows++
    if (s.date && e.date) bothPresent++
  }

  const plannedUsedAsActual =
    isPlannedColumn(mapping.actualStart) || isPlannedColumn(mapping.actualEnd)

  const canCompute =
    mapping.lotKey !== '' &&
    mapping.processKey !== '' &&
    mapping.actualStart !== '' &&
    mapping.actualEnd !== ''

  const issues: Issue[] = []

  if (mapping.lotKey === '') issues.push({ level: 'error', message: 'ロットID の列が未指定です。' })
  if (mapping.processKey === '')
    issues.push({ level: 'error', message: '工程の識別子 の列が未指定です。' })

  if (mapping.actualStart === '' || mapping.actualEnd === '') {
    issues.push({
      level: 'error',
      message:
        'このデータでは滞留を計算できません。実績の開始時刻・終了時刻の列が指定されていません。' +
        '（「開始予定日時」は予定であって実績ではないため、代わりには使えません）',
    })
  }

  if (plannedUsedAsActual) {
    issues.push({
      level: 'warn',
      message:
        '実績の欄に「予定」の列が選ばれています。予定で計算した数字は滞留ではなく計画とのズレです。' +
        'このまま進める場合、画面と書き出し画像の両方に「予定ベース（参考値）」と表示されます。',
    })
  }

  if (mapping.processOrder === '') {
    issues.push({
      level: 'warn',
      message: '工程順の列が未指定です。実績の時刻順に並べますが、同時刻の工程は順序が不定になります。',
    })
  }

  if (mapping.unit === '') {
    issues.push({
      level: 'info',
      message:
        '単位の列がありません。Smart Craft の工程実績CSVには単位列が無いため、これは正常です。' +
        '単位は原価設定で品目ごとに指定します（単位の違う数量は合計しません）。',
    })
  }

  if (table.rows.length > 0 && unparsableRows > 0) {
    issues.push({
      level: 'warn',
      message: `日時として読めない値が ${unparsableRows} 件あります。これらは計算から除外します（0とはみなしません）。`,
    })
  }

  return {
    rowCount: table.rows.length,
    lotCount: lots.size,
    canCompute,
    bothPresent,
    actualStartEmpty,
    actualEndEmpty,
    dateOnlyRows,
    unparsableRows,
    lotsWithoutOrder: lotsMissingOrder.size,
    plannedUsedAsActual,
    issues,
  }
}
