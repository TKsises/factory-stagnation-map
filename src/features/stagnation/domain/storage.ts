// ============================================================
// 設定の保存と読み込み
//
// ★外から入るデータ（localStorage・JSONインポート）は、必ず normalizeConfig() を通す。
//   迂回すると、壊れた値がそのままアプリの奥まで入り、描画時に落ちる。
//
// ★保存するのは「設定」だけ。CSVの中身は保存しない。
//   顧客の生産データであり、重い上に他人のPCに残るため。
// ============================================================

import type { ColumnMapping, Config, CostEntry, MappingRole, WorkCalendar } from './types'
import { CONFIG_VERSION, DEFAULT_CALENDAR, DEFAULT_CONFIG, EMPTY_MAPPING } from './types'

const KEY = 'factory-stagnation:config:v1'

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const HM = /^([01]\d|2[0-3]):[0-5]\d$/

function normalizeMapping(input: unknown): ColumnMapping {
  const out: ColumnMapping = { ...EMPTY_MAPPING }
  if (!isObj(input)) return out
  // EMPTY_MAPPING の鍵だけを見る。未知の鍵はここで自然に捨てられる。
  for (const role of Object.keys(out) as MappingRole[]) {
    out[role] = str(input[role])
  }
  return out
}

function normalizeCalendar(input: unknown): WorkCalendar {
  if (!isObj(input)) return { ...DEFAULT_CALENDAR }

  const workdaysRaw = Array.isArray(input.workdays) ? input.workdays : null
  const cleaned = workdaysRaw
    ? [...new Set(workdaysRaw.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) as number[])].sort()
    : []
  // 稼働日が1日も無いと稼働時間が常に0になり、「改善余地ゼロ」という誤った数字が黙って出る。
  // 空なら既定（月〜金）に戻す。
  const workdays = cleaned.length > 0 ? cleaned : [...DEFAULT_CALENDAR.workdays]

  const startHM = HM.test(str(input.startHM)) ? str(input.startHM) : DEFAULT_CALENDAR.startHM
  const endHM = HM.test(str(input.endHM)) ? str(input.endHM) : DEFAULT_CALENDAR.endHM

  const holidays = Array.isArray(input.holidays)
    ? input.holidays.filter(h => typeof h === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h))
    : []

  // 開始が終了以降なら既定に戻す（0時間稼働の設定でゼロ除算を起こさないため）
  if (startHM >= endHM) {
    return { workdays, startHM: DEFAULT_CALENDAR.startHM, endHM: DEFAULT_CALENDAR.endHM, holidays }
  }
  return { workdays, startHM, endHM, holidays }
}

function normalizeCosts(input: unknown): Record<string, CostEntry> {
  const out: Record<string, CostEntry> = {}
  if (!isObj(input)) return out
  for (const [code, raw] of Object.entries(input)) {
    if (!code || !isObj(raw)) continue
    const unitCost = raw.unitCost
    // 単価が数値でない・負なら捨てる。0円の単価は「未設定」と区別できないので受け付けない。
    if (typeof unitCost !== 'number' || !Number.isFinite(unitCost) || unitCost <= 0) continue
    out[code] = { unitCost, unit: str(raw.unit) }
  }
  return out
}

function normalizeStringMap(input: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isObj(input)) return out
  for (const [k, v] of Object.entries(input)) {
    if (k && typeof v === 'string' && v !== '') out[k] = v
  }
  return out
}

/** 外から来た何かを、必ず正しい形の Config にする。壊れていても例外を投げない */
export function normalizeConfig(input: unknown): Config {
  if (!isObj(input)) return { ...DEFAULT_CONFIG, mapping: { ...EMPTY_MAPPING } }

  const seqRaw = input.seq
  const seq =
    typeof seqRaw === 'number' && Number.isInteger(seqRaw) && seqRaw >= 0 ? seqRaw : 0

  const kind = input.layoutKeyKind
  const layoutKeyKind =
    kind === 'process' || kind === 'workCenter' || kind === 'equipment' ? kind : 'process'

  return {
    // 読み込んだ設定は必ず現行版として書き戻す。
    // 将来 Config の形を変えるときは、ここに移行処理を挟む
    // （営業担当のブラウザには前の版の設定が残っている前提で作る）。
    version: CONFIG_VERSION,
    mapping: normalizeMapping(input.mapping),
    costs: normalizeCosts(input.costs),
    calendar: normalizeCalendar(input.calendar),
    processLayout: normalizeStringMap(input.processLayout),
    layoutKeyKind,
    seq,
  }
}

export function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return normalizeConfig(null)
    return normalizeConfig(JSON.parse(raw))
  } catch {
    // 壊れたJSONが入っていてもアプリを止めない
    return normalizeConfig(null)
  }
}

export function saveConfig(config: Config): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(config))
  } catch {
    // 保存できなくても操作は続けられるべきなので握りつぶす
  }
}
