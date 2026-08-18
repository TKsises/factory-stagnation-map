// ============================================================
// デザイントークン（1ファイルに集約）
// 色や間隔をここ以外に直書きしない。全体の見え方を1箇所で変えられるようにする。
// ============================================================

export const C = {
  bg: '#f6f7f9',
  panel: '#ffffff',
  panelAlt: '#fafbfc',
  border: '#dfe3e8',
  borderStrong: '#c3cad3',
  text: '#1c2430',
  textSub: '#5b6673',
  textFaint: '#8d97a3',

  accent: '#1f6feb',
  accentSoft: '#e8f0fe',

  ok: '#1a7f5a',
  okSoft: '#e6f4ee',
  warn: '#b26a00',
  warnSoft: '#fdf3e2',
  error: '#c02b2b',
  errorSoft: '#fdecec',

  // 滞留の深刻度（3段階。7色に分けない）
  sev1: '#4c9f70',
  sev2: '#e0a02c',
  sev3: '#cf4b32',
} as const

export const S = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const FONT =
  '"Segoe UI", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, system-ui, sans-serif'
export const MONO = '"Cascadia Mono", Consolas, "Courier New", monospace'

export const R = { sm: 4, md: 6, lg: 10 } as const

/**
 * 断定表現を出力しないための文言集（§責任の3層）。
 * 「削減できます」「実現します」と書かない。ここ以外に文言を散らさない。
 */
export const WORDING = {
  factNote: '御社の記録から算出',
  frozenNote: '現在、工程間に滞留している金額',
  estimateNote: '御社の入力値に基づく試算です',
  privacy:
    '読み込んだCSVはこの画面の中だけで処理され、外部に送信されません。保存されるのは設定だけです。社内ポリシーの確認をお願いします。',
} as const
