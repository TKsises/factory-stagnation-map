// ============================================================
// 検証用のレイアウトJSON
//
// レイアウトアプリ（factory-layout-v2）の書き出し形式（LayoutDoc）に合わせてある。
// case1（機械加工・8工程）の設備コードに対応する配置。
//
// ★管理番号は case1 の設備コード（EQ-P010 … EQ-P080）に合わせてあるが、
//   アプリ側では自動で紐づけない。対応表は画面で手作業で作る。
//
// 実際のレイアウトが手に入ったら、このファイルは捨ててよい。
// ============================================================

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fixtures')

// 「コの字」に流れる配置。
// 表面処理(EQ-P050) と 機械加工後半(EQ-P060) を工場の対角に置いてあるので、
// 「一番滞留している区間が、一番長い動線でもある」ことが図で見えるはず。
const items = [
  // 上段：材料準備 → 鋳造 → バリ取り → 機械加工前半
  { id: 'i1', type: 'shelf', name: '材料置き場', code: 'EQ-P010', x: 3, y: 3, w: 6, h: 4, rot: 0 },
  { id: 'i2', type: 'machine', name: '鋳造機', code: 'EQ-P020', x: 13, y: 3, w: 6, h: 4, rot: 0 },
  { id: 'i3', type: 'machine', name: 'バリ取り機', code: 'EQ-P030', x: 23, y: 3, w: 5, h: 4, rot: 0 },
  { id: 'i4', type: 'machine', name: 'MC前半', code: 'EQ-P040', x: 32, y: 3, w: 6, h: 4, rot: 0 },

  // 右端：表面処理
  { id: 'i5', type: 'machine', name: '表面処理槽', code: 'EQ-P050', x: 42, y: 10, w: 6, h: 5, rot: 0 },

  // 下段：機械加工後半 → 洗浄 → 検査（左へ戻る）
  { id: 'i6', type: 'machine', name: 'MC後半', code: 'EQ-P060', x: 3, y: 21, w: 6, h: 4, rot: 0 },
  { id: 'i7', type: 'machine', name: '洗浄機', code: 'EQ-P070', x: 13, y: 21, w: 5, h: 4, rot: 0 },
  { id: 'i8', type: 'inspect', name: '検査台', code: 'EQ-P080', x: 22, y: 21, w: 5, h: 3, rot: 0 },

  // 管理番号を持たない要素（対応表の選択肢に出ないこと／描画はされること）
  { id: 'i9', type: 'shelf', name: '仕掛置き場A', x: 14, y: 12, w: 9, h: 2, rot: 0 },
  { id: 'i10', type: 'shelf', name: '仕掛置き場B', x: 30, y: 12, w: 7, h: 2, rot: 0 },
  { id: 'i11', type: 'aisle', name: '主通路', x: 2, y: 16.5, w: 46, h: 2, rot: 0 },
  { id: 'i12', type: 'aisle', name: '副通路', x: 2, y: 8.5, w: 46, h: 1.5, rot: 0 },
  { id: 'i13', type: 'pillar', name: '柱', x: 25, y: 14, w: 0.6, h: 0.6, rot: 0 },
  { id: 'i14', type: 'pillar', name: '柱', x: 39, y: 14, w: 0.6, h: 0.6, rot: 0 },
  { id: 'i15', type: 'dock', name: '出荷口', code: 'EQ-DOCK', x: 42, y: 21, w: 6, h: 4, rot: 0 },
  { id: 'i16', type: 'fire', name: '消火設備', x: 1.5, y: 13, w: 1, h: 1, rot: 0 },
]

const doc = {
  version: 1,
  items,
  connections: [],
  gridW: 52,
  gridH: 28,
  floor: { src: null, widthM: 52, opacity: 0.5 },
  boundary: [
    { x: 1, y: 1 },
    { x: 50, y: 1 },
    { x: 50, y: 27 },
    { x: 1, y: 27 },
  ],
  catalog: [],
  clip: false,
  layers: {
    equipment: true,
    people: true,
    transport: true,
    structure: true,
    safety: true,
    boundary: true,
    floor: true,
  },
  seq: items.length,
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'layout-sample.json'), JSON.stringify(doc, null, 2), 'utf8')
console.log(
  `レイアウト: ${items.length} 要素（うち管理番号あり ${items.filter(i => i.code).length}）` +
    `／ ${doc.gridW}m × ${doc.gridH}m`
)
console.log(`出力先: ${join(OUT_DIR, 'layout-sample.json')}`)
