// ============================================================
// データモデル（このアプリの背骨）
//
// 3種類のデータを絶対に混ぜない:
//   Config … 設定。保存する（列マッピング・原価・カレンダー・レイアウト対応表）
//   Data   … 取り込んだ実データ。保存しない（毎回CSVを読み直す）
//   Ui     … 編集の一時状態。保存しない
//
// 混ぜると「たまたまその瞬間のデータ」を設定が抱え込み、週次比較が壊れる。
// ============================================================

// ── 取り込みの中間表現 ───────────────────────────────────

export type Encoding = 'utf8' | 'utf8-bom' | 'shift_jis'

/** CSVを読んだ直後の形。型変換はまだしない（生の文字列のまま持つ） */
export type RawTable = {
  fileName: string
  headers: string[]
  rows: string[][]
  encoding: Encoding
}

/**
 * アプリが必要とする「意味」の一覧。
 * CSVの列名は顧客ごと・テナントの用語設定ごとに変わるので、
 * 列名をコードに直書きせず、この意味に対して画面で対応づける。
 */
export type MappingRole =
  | 'lotKey'
  | 'processKey'
  | 'processOrder'
  | 'actualStart'
  | 'actualEnd'
  | 'plannedStart'
  | 'plannedEnd'
  | 'quantity'
  | 'unit'
  | 'itemCode'
  | 'processName'
  | 'standardTime'
  | 'totalStandardTime'
  | 'workCenter'
  | 'equipment'

/** CSVの列 ↔ 意味 の対応づけ（★このアプリの生命線）。値は列名。未対応は '' */
export type ColumnMapping = Record<MappingRole, string>

// ── 正規化後のデータ ─────────────────────────────────────

export type Step = {
  lotId: string
  processCode: string
  processName: string
  order: number | null
  actualStart: Date | null
  actualEnd: Date | null
  /** 元データが日付だけだった（時刻が無い） */
  dateOnly: boolean
  /** 標準時間（分）。derived 近似で使う */
  standardMinutes: number | null
  /** 合計標準時間（分）＝標準時間＋段取り標準時間。正味加工時間はこちらを優先して使う */
  totalStandardMinutes: number | null
  workCenter: string | null
  equipment: string | null
}

export type Lot = {
  id: string
  itemCode: string | null
  quantity: number | null
  /**
   * CSVの単位列から読んだ値。★参考表示にとどめる。
   * 単位の正は Config.costs[品目コード].unit（Smart Craft の工程実績CSVには単位列が無いため）。
   * 出所を2つ持つと kg と ピース を取り違え、「単位が違う数量を合計しない」が守れなくなる。
   */
  unitFromCsv: string | null
  /** 工程順に並べ替え済み */
  steps: Step[]
}

/** どうやって滞留の数字を出したか。品質表示の根拠になる */
export type GapBasis =
  | 'actual' // 実績の終了 → 実績の開始。最も信頼できる
  | 'derived' // 開始が無いので、標準時間を引いて近似した
  | 'date-only' // 日付しか無いので、日をまたぐ分だけ数えた
  | 'excluded' // 計算できないので除外した

/** 工程間の滞留（このアプリの主役） */
export type Gap = {
  lotId: string
  fromProcess: string
  toProcess: string
  start: Date
  end: Date
  /** 暦時間（そのままの経過時間）。金額の計算に使う */
  calendarHours: number
  /** 稼働時間（夜間・休日を除く）。改善余地の議論に使う */
  workingHours: number
  basis: GapBasis
  // ★金額はここに持たない。
  //   computeGaps の責務は「時間だけ」。金額は money.ts の関数が唯一の計算元で、
  //   画面もPNGもドリルダウンもそこを通る。2箇所に代入できる形にすると必ず食い違う。
}

// ── 設定（保存されるもの）───────────────────────────────

export type WorkCalendar = {
  /** 稼働曜日。0=日曜 … 6=土曜 */
  workdays: number[]
  startHM: string // 'HH:MM'
  endHM: string
  /** 休日。'YYYY-MM-DD' の配列 */
  holidays: string[]
}

export type CostEntry = {
  unitCost: number
  /** kg / ピース 等。工程実績CSVに単位列が無いので、原価と一緒にここで持つ */
  unit: string
}

export type Config = {
  version: number
  mapping: ColumnMapping
  /** 品目コード → 単価と単位（手入力） */
  costs: Record<string, CostEntry>
  calendar: WorkCalendar
  /** 工程コード → レイアウト側の管理番号 */
  processLayout: Record<string, string>
  /** どのキーでレイアウトと対応づけるか。後から片方に決め打ちすると作り直しになる */
  layoutKeyKind: 'process' | 'workCenter' | 'equipment'
  /**
   * API中継サーバーのURL。配信サイトから使うときだけ要る。
   * ★秘密ではない（合言葉とAPIキーは別。合言葉は保存しない）
   */
  apiRelayBase: string
  /** ID採番カウンタ。必ず保存する（要素数から復元してはいけない） */
  seq: number
}

export const CONFIG_VERSION = 1

export const EMPTY_MAPPING: ColumnMapping = {
  lotKey: '',
  processKey: '',
  processOrder: '',
  actualStart: '',
  actualEnd: '',
  plannedStart: '',
  plannedEnd: '',
  quantity: '',
  unit: '',
  itemCode: '',
  processName: '',
  standardTime: '',
  totalStandardTime: '',
  workCenter: '',
  equipment: '',
}

export const DEFAULT_CALENDAR: WorkCalendar = {
  workdays: [1, 2, 3, 4, 5],
  startHM: '08:30',
  endHM: '17:30',
  holidays: [],
}

export const DEFAULT_CONFIG: Config = {
  version: CONFIG_VERSION,
  mapping: EMPTY_MAPPING,
  costs: {},
  calendar: DEFAULT_CALENDAR,
  processLayout: {},
  layoutKeyKind: 'process',
  apiRelayBase: '',
  seq: 0,
}
