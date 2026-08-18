// ============================================================
// 検証用「工程実績一覧CSV」の生成（3つの工場パターン）
//
// フェーズ0で確定した実際の出力仕様を、そのまま再現する:
//   - 列名     : ja.yml の activerecord.attributes.process_result.*
//   - 列の並び : settings.yml の csv.results.process_result の順
//   - 日時書式 : '%Y/%m/%d %H:%M:%S'（time_formats.rb）
//   - 文字コード: UTF-8 BOM付き と Shift_JIS（顧客がどちらも選べる）
//
// ★工場の型を3つ用意する理由:
//   1つのデータだけで作ると、そのデータでしか動かないものが出来上がる。
//   特に「組立（健全）」を入れてあるのが大事で、
//   このアプリが“いつも問題ありと言う道具”ではないことを確かめられる。
//
// ★標準時間を短くしすぎない。
//   数百個のロットなのに1工程30分にすると、正味加工0.3日・滞留率98%という
//   現実離れした絵になり、現場を知っている相手に一目で見抜かれる。
//
// 実データが手に入ったら、このファイルは捨ててよい。
// ============================================================

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

// ── 乱数（毎回同じCSVが出るように固定シード）────────────────
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── 稼働カレンダー（月〜金 8:30-17:30）───────────────────────
const WORK_START_MIN = 8 * 60 + 30
const WORK_END_MIN = 17 * 60 + 30

const isWorkday = d => d.getDay() >= 1 && d.getDay() <= 5
const minutesOfDay = d => d.getHours() * 60 + d.getMinutes()

function nextWorkingMoment(date) {
  const d = new Date(date)
  for (let guard = 0; guard < 400; guard++) {
    if (!isWorkday(d)) {
      d.setDate(d.getDate() + 1)
      d.setHours(8, 30, 0, 0)
      continue
    }
    const m = minutesOfDay(d)
    if (m < WORK_START_MIN) {
      d.setHours(8, 30, 0, 0)
      return d
    }
    if (m >= WORK_END_MIN) {
      d.setDate(d.getDate() + 1)
      d.setHours(8, 30, 0, 0)
      continue
    }
    return d
  }
  return d
}

function advanceWorking(date, minutes) {
  let d = nextWorkingMoment(date)
  let left = minutes
  for (let guard = 0; guard < 400 && left > 0; guard++) {
    const remainToday = WORK_END_MIN - minutesOfDay(d)
    if (left <= remainToday) {
      d = new Date(d.getTime() + left * 60000)
      break
    }
    left -= remainToday
    d = new Date(d.getTime() + remainToday * 60000)
    d = nextWorkingMoment(new Date(d.getTime() + 60000))
  }
  return d
}

const p2 = n => String(n).padStart(2, '0')
const fmt = d =>
  `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
const fmtDateOnly = d => `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`

// ── 出力列（settings.yml の並び順を維持）────────────────────
// 「開始予定日時」が「作業開始日時」より前に来る。列順で先に当たるのは予定の方であり、
// これが列マッピングで警告を出す理由そのもの。
const HEADERS = [
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

const csvEscape = v => {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const USERS = [
  ['9001', '山田 太郎'],
  ['9002', '鈴木 花子'],
  ['9003', '佐藤 次郎'],
  ['9004', '田中 三郎'],
  ['9005', '高橋 四郎'],
]

// ── 工場のパターン ─────────────────────────────────────────
// std/setup の単位は分。ロット1本を流すのにかかる時間。
const SCENARIOS = [
  {
    file: 'case1-machining-8processes',
    title: '機械加工（8工程・滞留あり）',
    seed: 20260817,
    lots: 2377, // staging の製造指示件数に合わせる
    periodStart: [2026, 3, 1],
    periodDays: 90,
    // 表面処理→機械加工後半 を意図的に最悪にしてある。
    // このアプリが言い当てられるかどうかの答え合わせ。
    flow: [
      { code: 'P010', name: '材料準備', std: 60, setup: 15, wc: 'WC000010', gapTo: [3, 20] },
      { code: 'P020', name: '鋳造加工', std: 240, setup: 45, wc: 'WC000022', gapTo: [2, 14] },
      { code: 'P030', name: 'バリ取り', std: 120, setup: 20, wc: 'WC000025', gapTo: [4, 24] },
      { code: 'P040', name: '機械加工前半', std: 420, setup: 60, wc: 'WC000028', gapTo: [5, 30] },
      { code: 'P050', name: '表面処理', std: 150, setup: 30, wc: 'WC000031', gapTo: [30, 130] },
      { code: 'P060', name: '機械加工後半', std: 360, setup: 50, wc: 'WC000029', gapTo: [2, 12] },
      { code: 'P070', name: '洗浄', std: 90, setup: 10, wc: 'WC000034', gapTo: [2, 16] },
      { code: 'P080', name: '検査', std: 90, setup: 0, wc: 'WC000040', gapTo: null },
    ],
    items: [
      { code: 'MA000001', qty: [200, 400] },
      { code: 'MA000002', qty: [80, 160] },
      { code: 'MA000003', qty: [250, 600] },
      { code: 'MA000007', qty: [300, 900] }, // kg もの（単位はCSVに出ない）
      { code: 'MA000008', qty: [120, 300] },
    ],
    defects: { inProgress: 0.12, dateOnly: 0.035, missStart: 0.03, overlap: 0.02 },
    skipRate: 0,
    encodings: ['utf8', 'sjis'],
  },
  {
    file: 'case2-assembly-4processes',
    title: '組立（4工程・健全）',
    seed: 20260901,
    lots: 900,
    periodStart: [2026, 4, 6],
    periodDays: 60,
    // ★このアプリが「いつも問題ありと言う道具」ではないことを確かめるための健全な工場。
    //   滞留率は4割程度に収まり、突出した工程間も無い。
    flow: [
      { code: 'A010', name: '部品準備', std: 45, setup: 10, wc: 'WC000051', gapTo: [1, 8] },
      { code: 'A020', name: '一次組立', std: 180, setup: 25, wc: 'WC000052', gapTo: [2, 12] },
      { code: 'A030', name: '二次組立', std: 150, setup: 20, wc: 'WC000053', gapTo: [1, 10] },
      { code: 'A040', name: '完成検査', std: 60, setup: 0, wc: 'WC000054', gapTo: null },
    ],
    items: [
      { code: 'MB000101', qty: [40, 120] },
      { code: 'MB000102', qty: [60, 200] },
      { code: 'MB000103', qty: [30, 90] },
    ],
    defects: { inProgress: 0.05, dateOnly: 0, missStart: 0.01, overlap: 0.005 },
    skipRate: 0,
    encodings: ['utf8'],
  },
  {
    file: 'case3-complex-12processes',
    title: '複合加工（12工程・工程飛ばしと欠損が多い）',
    seed: 20261111,
    lots: 1500,
    periodStart: [2026, 2, 2],
    periodDays: 120,
    // ★工程飛ばしがあり、データの欠けも多い。
    //   地図の破線（工程飛ばし）とデータ品質パネルを本気で試すためのもの。
    flow: [
      { code: 'C010', name: '受入検査', std: 60, setup: 10, wc: 'WC000061', gapTo: [2, 18] },
      { code: 'C020', name: '切断', std: 150, setup: 30, wc: 'WC000062', gapTo: [3, 22] },
      { code: 'C030', name: '粗加工', std: 300, setup: 45, wc: 'WC000063', gapTo: [6, 40] },
      { code: 'C040', name: '熱処理', std: 480, setup: 90, wc: 'WC000064', gapTo: [24, 96] },
      { code: 'C050', name: '中間検査', std: 60, setup: 0, wc: 'WC000065', gapTo: [4, 26] },
      { code: 'C060', name: '精密加工', std: 540, setup: 70, wc: 'WC000066', gapTo: [8, 44] },
      { code: 'C070', name: '追加工', std: 240, setup: 40, wc: 'WC000067', gapTo: [5, 30], skippable: true },
      { code: 'C080', name: '表面処理', std: 180, setup: 35, wc: 'WC000068', gapTo: [36, 168] },
      { code: 'C090', name: '研磨', std: 210, setup: 25, wc: 'WC000069', gapTo: [4, 28], skippable: true },
      { code: 'C100', name: '組付', std: 330, setup: 40, wc: 'WC000070', gapTo: [3, 20] },
      { code: 'C110', name: '最終検査', std: 120, setup: 0, wc: 'WC000071', gapTo: [2, 14] },
      { code: 'C120', name: '梱包', std: 90, setup: 10, wc: 'WC000072', gapTo: null },
    ],
    items: [
      { code: 'MC000201', qty: [20, 60] },
      { code: 'MC000202', qty: [10, 40] },
      { code: 'MC000203', qty: [50, 150] },
      { code: 'MC000204', qty: [15, 45] },
    ],
    defects: { inProgress: 0.18, dateOnly: 0.08, missStart: 0.06, overlap: 0.04 },
    skipRate: 0.22,
    encodings: ['utf8'],
  },
]

// ── Shift_JIS への変換（外部ライブラリを使わない）────────────
// Node は Shift_JIS を「読む」ことはできるが「書く」ことはできない。
// そこで、読める性質を使って 文字→バイト の逆引き表を1回だけ作る。
// （PowerShell に頼ると環境差でつまずくので、スクリプト内で完結させる）
function buildSjisTable() {
  const dec = new TextDecoder('shift_jis')
  const map = new Map()
  for (let b = 0; b < 0x80; b++) map.set(String.fromCharCode(b), [b])
  for (let b = 0xa1; b <= 0xdf; b++) {
    const ch = dec.decode(new Uint8Array([b]))
    if (ch.length === 1 && ch !== '�') map.set(ch, [b])
  }
  for (let hi = 0x81; hi <= 0xfc; hi++) {
    for (let lo = 0x40; lo <= 0xfc; lo++) {
      if (lo === 0x7f) continue
      const ch = dec.decode(new Uint8Array([hi, lo]))
      if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [hi, lo])
    }
  }
  return map
}

let sjisTable = null
function toSjis(text) {
  if (sjisTable === null) sjisTable = buildSjisTable()
  const out = []
  let missing = 0
  for (const ch of text) {
    const bytes = sjisTable.get(ch)
    if (bytes) out.push(...bytes)
    else {
      out.push(0x3f) // '?'
      missing++
    }
  }
  if (missing > 0) console.warn(`  ※ Shift_JIS に無い文字が ${missing} 個ありました`)
  return Uint8Array.from(out)
}

// ── 1パターン分を生成 ───────────────────────────────────────
function generate(sc) {
  const rnd = mulberry32(sc.seed)
  const pick = arr => arr[Math.floor(rnd() * arr.length)]
  const between = (lo, hi) => lo + rnd() * (hi - lo)

  const rows = []
  let forcedWeekendDone = false
  let skippedLots = 0

  for (let i = 1; i <= sc.lots; i++) {
    const lotId = `${sc.file.slice(0, 4).toUpperCase()}-PO-${String(i).padStart(6, '0')}`
    const prodNo = `${sc.file.slice(0, 4).toUpperCase()}-PN-${String(i).padStart(6, '0')}`
    const item = pick(sc.items)
    const qty = Math.round(between(item.qty[0], item.qty[1]))
    const [userCode, userName] = pick(USERS)

    // このロットの「欠け方」
    const r = rnd()
    const d = sc.defects
    let kind = 'normal'
    if (r < d.inProgress) kind = 'inProgress'
    else if (r < d.inProgress + d.dateOnly) kind = 'dateOnly'
    else if (r < d.inProgress + d.dateOnly + d.missStart) kind = 'missStart'
    else if (r < d.inProgress + d.dateOnly + d.missStart + d.overlap) kind = 'overlap'

    // 工程飛ばし：skippable な工程を落とす
    let flow = sc.flow
    if (sc.skipRate > 0 && rnd() < sc.skipRate) {
      const dropped = sc.flow.filter(s => !s.skippable || rnd() > 0.6)
      if (dropped.length >= 2 && dropped.length < sc.flow.length) {
        flow = dropped
        skippedLots++
      }
    }

    let cursor = new Date(sc.periodStart[0], sc.periodStart[1], sc.periodStart[2])
    cursor.setDate(cursor.getDate() + Math.floor(between(0, sc.periodDays)))
    cursor.setHours(8, 30, 0, 0)
    cursor = nextWorkingMoment(cursor)

    // 金曜17時終了 → 月曜8時30分開始 を必ず1件混ぜる（暦63.5h / 稼働0.5h の検証用）
    const useForcedWeekend = !forcedWeekendDone && i === 7
    if (useForcedWeekend) forcedWeekendDone = true

    const stopAt = kind === 'inProgress' ? 1 + Math.floor(rnd() * (flow.length - 1)) : flow.length
    let prevActualEnd = null

    for (let s = 0; s < flow.length; s++) {
      const step = flow[s]
      const planStart = new Date(cursor)
      const planEnd = advanceWorking(planStart, step.std + step.setup)

      let actualStart = null
      let actualEnd = null
      let status = '開始待ち'

      if (s < stopAt) {
        if (useForcedWeekend && s === 0) {
          actualStart = new Date(2026, 4, 8, 15, 30, 0) // 2026-05-08 は金曜
          actualEnd = new Date(2026, 4, 8, 17, 0, 0)
        } else if (useForcedWeekend && s === 1) {
          actualStart = new Date(2026, 4, 11, 8, 30, 0) // 月曜
          actualEnd = advanceWorking(actualStart, step.std)
        } else {
          actualStart = nextWorkingMoment(cursor)
          actualEnd = advanceWorking(actualStart, step.std * between(0.85, 1.25))
        }
        status = '完了'
      } else if (s === stopAt) {
        actualStart = nextWorkingMoment(cursor)
        actualEnd = null
        status = '生産中'
      }

      // わざと壊す
      if (kind === 'missStart' && s === Math.min(2, flow.length - 1) && actualEnd) actualStart = null
      if (kind === 'overlap' && s === Math.min(3, flow.length - 1) && actualStart && prevActualEnd) {
        // 前工程の終了より3時間前に開始＝工程の重なり。
        // 「開始を数時間ずらす」だけでは、元の滞留が数十時間あるので重ならない
        actualStart = new Date(prevActualEnd.getTime() - 3 * 3600000)
      }
      prevActualEnd = actualEnd

      const dateOnly = kind === 'dateOnly'
      const f = x => (x == null ? '' : dateOnly ? fmtDateOnly(x) : fmt(x))

      const outQty = actualEnd ? Math.max(0, qty - Math.round(between(0, qty * 0.03))) : ''
      const defect = actualEnd ? Math.round(between(0, qty * 0.02)) : ''

      rows.push([
        lotId,
        prodNo,
        s + 1,
        `${lotId}_${s + 1}`,
        step.name,
        step.code,
        item.code,
        'MG001',
        step.wc,
        qty,
        step.std,
        step.setup,
        step.std + step.setup,
        fmt(planStart),
        fmt(planEnd),
        '',
        `EQ-${step.code}`,
        userCode,
        userName,
        actualEnd ? step.setup : '',
        outQty,
        outQty === '' ? '' : ((outQty / qty) * 100).toFixed(1),
        defect,
        defect === '' ? '' : ((defect / qty) * 100).toFixed(1),
        f(actualStart),
        f(actualEnd),
        '',
        '',
        '',
        '',
        '',
        status,
        fmt(actualEnd ?? planEnd),
      ])

      // 次工程へ：加工の終わりから滞留分だけ暦時間で進める
      const base = actualEnd ?? planEnd
      const g = step.gapTo ?? [2, 8]
      cursor = new Date(base.getTime() + between(g[0], g[1]) * 3600000)
    }
  }

  return { rows, skippedLots }
}

// ── 出力 ───────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true })

for (const sc of SCENARIOS) {
  const { rows, skippedLots } = generate(sc)
  const body = [HEADERS, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'

  for (const enc of sc.encodings) {
    if (enc === 'utf8') {
      writeFileSync(join(OUT_DIR, `${sc.file}.csv`), '﻿' + body, 'utf8')
    } else {
      // Shift_JIS に BOM は付けない
      writeFileSync(join(OUT_DIR, `${sc.file}-sjis.csv`), toSjis(body))
    }
  }

  const stdTotal = sc.flow.reduce((a, s) => a + s.std + s.setup, 0)
  console.log(
    `${sc.title}\n  ${rows.length.toLocaleString()} 行 / ${sc.lots.toLocaleString()} ロット / ${sc.flow.length} 工程` +
      `（標準時間の合計 ${stdTotal} 分 ≒ ${(stdTotal / 60 / 9).toFixed(1)} 稼働日）` +
      (skippedLots > 0 ? ` / 工程飛ばし ${skippedLots.toLocaleString()} ロット` : '') +
      `\n  → ${sc.encodings.map(e => (e === 'utf8' ? `${sc.file}.csv` : `${sc.file}-sjis.csv`)).join(', ')}`
  )
}

// 敵対的なケース
writeFileSync(join(OUT_DIR, 'broken-header-only.csv'), '﻿' + HEADERS.join(',') + '\r\n', 'utf8')
writeFileSync(
  join(OUT_DIR, 'broken-no-actual-columns.csv'),
  '﻿製造指示番号,工程順,工程コード,開始予定日時,終了予定日時\r\n' +
    'CASE-PO-000001,1,P010,2026/04/01 08:30:00,2026/04/01 10:00:00\r\n',
  'utf8'
)
console.log('敵対的なケース\n  → broken-header-only.csv, broken-no-actual-columns.csv')
console.log(`\n出力先: ${OUT_DIR}`)
