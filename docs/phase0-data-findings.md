# フェーズ0：実データ確認の結果

**確定日**: 2026-08-17
**確認方法**: Smart Craft 製品ソースコード（`SC-demo-kit_v1.2/mes-main`）の**出力定義そのもの**を読んで確定。
画面の目視や推測ではなく、CSVを生成しているコードとヘッダー名の辞書を直接参照した。

> **この文書の位置づけ**：指示書 §2-2「まだ確認できていないこと」に対する回答。
> 根拠のファイル位置を全て併記してある。**列名を推測で決めていない**ことを、この表で検証できる。

---

## 1. 結論サマリー

| # | §2-2 の問い | 結果 | 状態 |
| --- | --- | --- | --- |
| 1 | 実績の開始・終了が**両方**あるか | **両方ある**（`作業開始日時` / `作業終了日時`） | ✅ 確定 |
| 2 | 時刻の粒度 | **秒まで**（`YYYY/MM/DD HH:MM:SS`） | ✅ 確定 |
| 3 | 開始・終了の空欄率 | **実データが必要**（本アプリが測って表示する対象） | ⚠️ 未確定 |
| 4 | 工程順に複数行で追えるか | **追える**（`製造指示番号` + `工程順`） | ✅ 確定 |
| 5 | 文字コードとヘッダー名 | **UTF-8 / Shift_JIS の選択式**。ヘッダー名は下表で確定 | ✅ 確定 |
| 6 | 原価データの所在 | **工程実績CSVには無い**。手入力が前提で正しい | ✅ 確定（＝手入力） |

**最重要の結論：このデータでは滞留が計算できる。** 予定で代用する必要はない。

---

## 2. 【最重要】踏みかけた罠 ― 「開始」列が2種類ある

工程実績一覧CSVには、**似た名前の日時列が4つ**並ぶ。

| CSVヘッダー | 中身 | 滞留計算に使う？ |
| --- | --- | --- |
| **`作業開始日時`** | **実績**の開始（`process_result.started_at`） | ✅ **これを使う** |
| **`作業終了日時`** | **実績**の終了（`process_result.ended_at`） | ✅ **これを使う** |
| `開始予定日時` | 予定（`process_order.start_at`） | ❌ 使わない |
| `終了予定日時` | 予定（`process_order.end_at`） | ❌ 使わない |

### なぜ危険か

実績列の名前に **「実績」という語が入っていない**。「作業開始日時」である。
つまり、

- 「"実績"を含む列を探す」ヒューリスティックは **1件もヒットしない**
- 「"開始"を含む列を探す」と **`開始予定日時` が先に当たる可能性がある**（あいうえお順・列順の両方で予定側が先に来ることがある）

→ 指示書 §7-1-2 の「**『予定』を含む列名を実績欄に自動選択してはいけない**」は、この製品では
**実際に起こる事故**である。抽象的な注意書きではない。

### 実装への反映（フェーズ1で必ず守る）

1. 自動推測は「**`作業開始日時` / `作業終了日時` の完全一致を最優先**」とする
2. 列名に **`予定` を含むものは、実績欄の推測候補から機械的に除外**する
3. それでもユーザーが手動で「予定」列を実績欄に選んだ場合は、**警告を出す**（禁止はしない。
   §10-3 の「予定ベース（参考値）」表示に切り替える）

---

## 3. 確定した列一覧（工程実績一覧CSV）

出力列の定義は `backend/config/settings.yml` の `csv.results.process_result`（L323-377）、
日本語ヘッダー名は `backend/config/locales/ja.yml` の
`activerecord.attributes.process_result.*`（L586-638）。この2つが原典。

### 本アプリが使う列

| CSVヘッダー（日本語） | 内部キー | ColumnMapping での役割 |
| --- | --- | --- |
| 製造指示番号 | `production_order_code` | **`lotKey`**（ロットを一意にする） |
| 工程順 | `sequence_number` | **`processOrder`**（工程の並び順） |
| 工程コード | `production_process_code` | **`processKey`** |
| 工程名 | `production_process_name` | `processName` |
| **作業開始日時** | `started_at` | **`actualStart`** |
| **作業終了日時** | `ended_at` | **`actualEnd`** |
| 開始予定日時 | `process_order_start_at` | `plannedStart`（表示のみ） |
| 終了予定日時 | `process_order_end_at` | `plannedEnd`（表示のみ） |
| 品目コード | `material_code` | **`itemCode`**（原価を引くキー） |
| 指示数 | `production_order_quantity` | **`quantity`** |
| 工程指示番号 | `process_order_generated_code` | 参考（`PO000001_1` 形式） |
| 標準時間 | `process_order_standard_time` | §5-2 の `derived` 近似で使う |
| 合計標準時間 | `total_standard_time` | 正味加工時間（§7-3） |
| 作業区コード | `work_center_code` | **§8 レイアウト対応表のキー候補** |
| 設備コード(実績) | `equipment_code` | 同上 |
| 製番 | `production_number` | 表示 |
| ステータス | `process_order_status` | 除外判定の補助 |

### 「工程順」は確実に取れる

`ProcessResult` は `delegate :sequence_number, to: :process_order`
（`backend/app/models/process_result.rb:36`）。
つまりCSVの `工程順` 列は工程指示の並び順そのもの。**時刻順に頼って並べ替える必要がない。**
§4-2 の `processOrder?` は、この製品では実質必須で埋まる。

---

## 4. 日時の書式

`Time::DATE_FORMATS[:time] = '%Y/%m/%d %H:%M:%S'`（`backend/config/initializers/time_formats.rb:1`）
を、CSV出力コンバータ `CSV::Converters[:format_csv]`（`backend/config/initializers/csv_converters.rb:9-10`）
が全ての日時に適用する。

- **エクスポート**: `2026/08/17 14:30:00` ← 0埋め・秒あり
- **取り込みテンプレート**: `2023/1/1 10:00` ← **0埋めなし・秒なし**
  （`backend/spec/fixtures/process_result_import/valid.csv` の実物）

→ **日付パーサは両方受け付ける必要がある。** 加えて `YYYY-MM-DD` 形式も、顧客がExcelで
加工した場合に備えて受ける。**`new Date(文字列)` に丸投げしない**（ブラウザ差で `2023/1/1` の
解釈が揺れるため、自前で正規表現で分解する）。

**粒度は秒まであるので、§5-2 の `date-only` フォールバックは Smart Craft の素の出力では発生しない。**
ただし顧客がExcelで日付だけに丸めた列を渡してくる経路は現実にあるので、実装は残す。

---

## 5. 文字コード

エクスポート時にユーザーが選ぶ（`backend/app/graphql/types/character_code_enum.rb:3-4`）。

| 選択肢 | 実際の出力 |
| --- | --- |
| UTF8 | UTF-8（`download_csv_job.rb:47` が `a:utf-8`） |
| SHIFT_JIS | **Shift_JIS**（`download_csv_job.rb:43` が `w:Shift_JIS`） |

取り込み側は `BOM|UTF-8` と `CP932` を扱う（`backend/app/concerns/csv_read.rb:23-26`）。

→ **Shift_JIS 対応は「念のため」ではなく必須。** 顧客が選べてしまう以上、必ず来る。
`TextDecoder('shift_jis')` で復号し、BOM付きUTF-8も判定する（§3の指定通り）。

---

## 6. 単位の扱い ― 設計判断が要る点

**工程実績一覧CSVに「単位」列は無い。** 上記の列一覧に単位は含まれない。
単位は品目マスタ（`Material`）側が持っている（`単位コード`）。

一方 §2-1 の通り、指示数には `300 kg` と `300 ピース` が混在する。

### 帰結

- `ColumnMapping.unit` は **このCSVからは埋まらない**（マッピング画面で「該当なし」になる）
- §10-7「単位が違う数量を合計しない」を守るため、**単位は品目コードごとに、原価と一緒に持つ**
  → `Config.costs: Record<品目コード, { unitCost, unit }>` は §4-2 の定義のままで正しい
- 単価が未入力の品目は「原価未設定」と表示し、**金額を出さない**（§5-5）。
  単位が分からない品目の数量を、他の品目の数量と足し合わせる処理は**そもそも作らない**

### ロット金額に使う数量

`指示数`（`production_order_quantity`＝そのロットを何個流すか）を使う。
`出来高数`（`quantity`＝各工程で何個できたか）は工程ごとに変わるため、
「工程間に凍っている金額」の基準には使わない。

---

## 7. 欠損の起こり方（コードから読める範囲）

取り込み側のバリデーション（`help-site/pages/tips/csv-rules/result.mdx:16-17`）：

- **「作業開始日時が空で作業終了日時が指定された場合はエラー」**
- 「作業開始日時が作業終了日時より後の場合はエラー」

→ 製品を通したデータでは「**終了だけあって開始が無い**」行は原則発生しない。
§5-2 の `derived`（標準時間を引いて近似）は**例外処理**であって主経路ではない見込み。

ただし以下は実データで確認しないと分からない：

- **まだ終わっていない工程**（生産中・開始待ち）→ `作業終了日時` が空 → **`excluded`**
- 中断・保留・中止の工程指示
- 現場が打刻をサボった分（＝そもそもの空欄率）

→ **これが §2-2-3「空欄率」であり、本アプリの §7-6 データ品質パネルが測って表示する対象そのもの。**
先に数字を知る必要はなく、**アプリが答えを出す**。ここは推測で埋めずに空欄のまま進めてよい。

---

## 8. レイアウト統合（§8）で使えるキー

工程実績CSVには `作業区コード`（`work_center_code`）と `設備コード(実績)`（`equipment_code`）が
両方入っている。レイアウト側の `Item.code`（例 `EQ-001`）と対応表を作る際、

- **作業区コード** … エリア／ライン単位。滞留の「置き場」の議論に向く
- **設備コード** … 個別の機械。動線の議論に向く

の2通りが選べる。§8-1 の `Config.processLayout` は
**「どちらのキーで対応づけるか」を持てる形にしておく**（後から片方に決め打ちすると作り直しになる）。

---

## 9. 未確定のまま残すもの（推測で埋めない）

| 項目 | なぜ残すか | どうするか |
| --- | --- | --- |
| 実際の空欄率（§2-2-3） | 実データ固有。顧客ごとに違う | **アプリが測って画面に出す**（§7-1-3, §7-6） |
| テナントの用語カスタマイズ | `Glossary#get_term` でヘッダー名が変わりうる | **列マッピングUIが吸収する**（§7-1）。だから列名を直書きしない |
| 製造原価の値 | 在庫モジュールの単価は材料費であり製造原価ではない | **手入力**（§5-5）。自動補完はしない |
| 稼働カレンダーの実値 | 顧客の勤務時間・休日 | **設定として編集可能に**（§5-3、既定 月〜金 8:30-17:30） |

---

## 10. フェーズ1に渡す仕様

1. **列名の自動推測テーブル**（初期値のみ。確定はユーザー）

   | 役割 | 完全一致で狙う列名 | 除外条件 |
   | --- | --- | --- |
   | `lotKey` | `製造指示番号` | — |
   | `processKey` | `工程コード` | — |
   | `processOrder` | `工程順` | — |
   | `actualStart` | `作業開始日時` | **`予定` を含む列は候補から除外** |
   | `actualEnd` | `作業終了日時` | **同上** |
   | `plannedStart` | `開始予定日時` | — |
   | `plannedEnd` | `終了予定日時` | — |
   | `itemCode` | `品目コード` | — |
   | `quantity` | `指示数` | — |
   | `processName` | `工程名` | — |

2. **文字コード判定**: UTF-8 BOM → UTF-8 → Shift_JIS の順に試す
3. **日時パーサ**: `YYYY/M/D H:M[:S]` と `YYYY-M-D H:M[:S]` を自前で分解。失敗は `null`
4. **診断**: 実績列が未指定なら「**このデータでは滞留を計算できません**」を赤字で出し、
   それらしい数字を一切出さない

---

## 付録：根拠ファイル一覧

| 内容 | ファイル |
| --- | --- |
| 出力列の定義 | `backend/config/settings.yml` L323-377 |
| 日本語ヘッダー名 | `backend/config/locales/ja.yml` L586-638 |
| CSV生成ロジック | `backend/app/concerns/csv_generator.rb` L12-55 |
| 実績時刻の絞り込み引数 | `backend/app/graphql/resolvers/csv/concerns/process_result_base.rb` L11-14 |
| 工程順の由来 | `backend/app/models/process_result.rb` L36 |
| 日時書式 | `backend/config/initializers/time_formats.rb` L1 |
| 日時のCSV変換 | `backend/config/initializers/csv_converters.rb` L9-10 |
| 文字コード選択肢 | `backend/app/graphql/types/character_code_enum.rb` L3-4 |
| 出力時の文字コード適用 | `backend/app/jobs/download_csv_job.rb` L43,47 |
| 取り込み時の文字コード | `backend/app/concerns/csv_read.rb` L23-26 |
| 実績CSVの公式ルール | `help-site/pages/tips/csv-rules/result.mdx` |
| 実物のCSVサンプル | `backend/spec/fixtures/process_result_import/valid.csv` |
