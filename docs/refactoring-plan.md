# リファクタリング方針

2026-07-15 時点のコードベース調査に基づく修正方針。
**原則: 挙動は一切変えない**（見た目・操作・データ形式は現状維持）。各フェーズ完了ごとにビルドと実機スモークで確認してからコミットする。

対象規模（現状）:

| ファイル | 行数 | 備考 |
|---|---|---|
| `src/screens/LogScreen.tsx` | 約 1,550 | 型・ユーティリティ・チャート3種・カレンダー・ピッカーが同居 |
| `src/screens/TasksScreen.tsx` | 約 710 | |
| `src/state/Store.tsx` | 約 610 | |
| `src/screens/ActivityScreen.tsx` | 約 480 | 編集フォームが EventEditModal とほぼ全文重複 |

---

## Phase 1: 死にコードの削除（リスク: 低）

参照ゼロのものを消すだけ。挙動に影響なし。

- [x] `src/lib/color.ts` — `DEFAULT_PALETTE`（未使用エクスポート）
- [x] `src/types.ts` — `WriteResult` / `ApiError` 型（`client.ts` のインライン型を `WriteResult | ApiError` に置き換えて型の方を活かした）
- [x] `src/components/EventEditModal.tsx` 末尾 — `export type { Event }`（再エクスポート、参照なし）
- [x] `src/components/TimeField.tsx` — `panelRef`（付けているが読んでいない）
- [x] `src/components/DateField.tsx` — `rootRef`（同上）
- [x] `src/screens/LogScreen.tsx` — `styles.monthPick`（定義なしクラス参照 → className を外した。見た目変化なし）
- [x] 未使用 CSS クラスの削除:
  - `.ghost`（LogScreen / ActivityScreen / TasksScreen / EventEditModal の4ファイル全部で未使用）
  - `.liveRow` 系（ActivityScreen.module.css）
  - `.sheetTitle`（LogScreen.module.css のみ未使用）
  - `.field select`（ActivityScreen.module.css。ネイティブ select はもう無い）
- [x] `vite.config.ts` — `@` エイリアス（`@/` import 0 件のため削除。必要になったら復活は容易）
- [ ] `Store.tsx` — `reload`（Context に公開しているが消費者なし。将来の手動リロード用に**残した**。消すなら要指示）

済:
- [x] `TasksScreen.tsx` の body overflow 直接操作 useEffect（`useScrollLock` と機能重複）→ 削除済み

## Phase 2: 小ユーティリティ・定数の集約（リスク: 低）

コピペされた純関数を `lib/` に一本化する。

- [x] `pad2`（ゼロ埋め）→ `lib/time.ts` に 1 つだけ export し、全員それを使う（scripts は対象外のまま）
- [x] LogScreen.tsx 冒頭の日付ユーティリティ群 → `lib/time.ts` へ移動。`md`/`ymd` は `formatMd` / `formatYmd` に改名
- [x] 1日の長さ定数 → `lib/time.ts` の `DAY_MS` / `DAY_SEC` に共用化
- [x] `time.ts` 内部の整理: `isoToDateInput` を廃止して `dateKey` に一本化、`overlapSecondsOnDay` は `dayStartMs` を使用
- [x] 「外側クリックで閉じる」3実装 → `lib/useOutsideClose.ts` に統一（pointerdown に揃えた）
- [x] 「Escape で閉じる」2実装 → 同ファイルの `useEscapeClose` に共通化
- [x] 1秒 tick の useEffect 3実装 → `lib/useNowTick.ts`（ActivityScreen の 250ms は挙動維持のためそのまま。1000ms に統一するなら要指示）

## Phase 3: モーダルの共通化（リスク: 中）

同一の JSX 構造と CSS（keyframes 含む）が 4 箇所にコピーされている最大の CSS 重複。

- [x] `src/components/Modal.tsx` を新設:
  - createPortal → modalRoot → backdrop（button, タップで閉じる）→ sheet（role="dialog"）の骨格
  - 開閉アニメーション（backdropIn/Out, sheetIn/Out）と `closing` ステート管理（`MODAL_CLOSE_MS = 160`）を内包
  - `useScrollLock` もここで一括適用
  - props: `open`, `onClose`, `aria-label`, `children`（render prop で `requestClose`）, `wide?`
- [x] `Modal.module.css` に modalRoot / backdrop / sheet / keyframes を集約。各画面の CSS からコピー分を削除
- [x] 適用先: TasksScreen（wide=520px）、ActivityScreen、EventEditModal（LogScreen のピッカーは Phase 6）
- [x] 閉じアニメ時間 160ms → `MODAL_CLOSE_MS` 定数に一本化（CSS は 0.16s のまま同期）
- [x] 共通フォーム系 CSS → `form.module.css`（`.field` / `.sheetActions` / `.primary` / `.danger` / `.formError` / `.dateTimeRow` / `.sheetTitle`）
- [ ] `.error` バナー / `.addBar`+`.plus` / `.status` / 丸スウォッチ（4定義）などの完全一致 CSS も共通モジュールへ（次のついでで可）

## Phase 4: カレンダーの一本化（リスク: 中）

- [x] 月グリッド生成を共通化: DateField の `(first.getDay() + 6) % 7` 方式に統一（LogScreen の `MonthCalendar` は曜日ラベル文字列から先頭空白数を引く実装でロケール依存が怖い）
- [x] `MonthCalendar`（LogScreen 内 150 行・props 10 個）を `src/components/MonthCalendar.tsx` に切り出し、DateField はそれを内包する形に
- [x] `cal*` 系 CSS（LogScreen.module.css ↔ DateField.module.css にコピー）を `MonthCalendar.module.css` に集約
- [x] 曜日ヘッダー配列 `['月','火',...]` のリテラル重複も解消

## Phase 5: 記録編集フォームの統一（リスク: 中〜高）

**最大のロジック重複。** EventEditModal は「Activity / Log 共通」とコメントされているが、実際は Log だけが使い、Activity は同じフォーム（state 7個・changeFolder・submit・削除・削除済みタスク表示まで）を丸ごと再実装している。

- [x] EventEditModal を「追加」モードにも対応させる（`eventId` の代わりに `mode: 'add' | 'edit'` 相当）
- [x] ActivityScreen の追加・編集シートを EventEditModal 呼び出しに置き換え、重複フォームを削除（約 250 行減る見込み）
- [x] Activity 固有の差分（追加時の初期値ロジックなど）は props で注入

## Phase 6: LogScreen の分割（リスク: 中）

1,550 行を機能単位に分割。ロジックは動かさず、ファイルを移すだけに徹する。

- [x] `src/screens/log/` ディレクトリを作り、以下に分割:
  - `types.ts` — AppliedRange / Slice / Seg / Column / TotalCol
  - `prefs.ts` — makeDefaultPrefs / normalizePrefs / buildApplied
  - `aggregate.ts` — resolveDisplay / clipSegs ＋ 集計 useMemo の中身（180行）を純関数化
  - `Donut.tsx` / `IndividualChart.tsx` / `TotalsChart.tsx` / `ChartTip.tsx`
  - `RangePicker.tsx` — 期間ピッカーのポータル JSX（180行）＋ openPicker の位置計算
  - `LogScreen.tsx` — 本体（state と組み立てのみに痩せる）
- [ ] IndividualChart と TotalsChart の積み上げ棒 JSX（ほぼコピー）を共通の `StackBars` に
- [ ] Tasks / Genres の円グラフ＋テーブル×2（JSX ほぼコピー）を共通コンポーネントに
- [x] LogScreen 内タブインジケーター（`useTabIndicator` の再実装）→ App.tsx のフックを `lib/` に出して共用
- [ ] LogScreen のピッカーにも他モーダルと同じ閉じアニメーションを付けるか要確認（現状 Log だけ無い）

## Phase 7: Store の整理（リスク: 中）

- [ ] `value` オブジェクトを `useMemo` 化（現状毎レンダー新規生成で、全消費者が毎回再レンダー）
- [ ] `updateEvent` / `addEvent` のバリデーション（未来判定・重複判定・最小長判定がほぼ同文で二重）→ 共通関数 `validateEventRange` に抽出
- [ ] `FolderSelect` と `TaskSelect`（アイコンと extraOption 以外同一）→ ジェネリックな `OptionSelect` に統合するか要検討（無理はしない）
- [ ] `SheetState`（Activity）と `Sheet`（Tasks）の同型の型定義 → 共通化は Phase 5 で自然に解消される見込み

## Phase 8: api/index.php の堅牢化（リスク: 低・ただし挙動に触る）

ここだけは「挙動を変えない」の例外。データ破損リスクの解消なので価値が高い。

- [ ] コメント（「原子的に置換」）と実装の不一致を解消: tmp ファイルに書いて `rename()` するアトミック置換に変更
- [ ] GET 時に共有ロック（`flock LOCK_SH`）を取る（PUT の truncate 中に読むと壊れた JSON を返し得る）
- [ ] `fwrite` の部分書き込み検出を追加
- [ ] CORS の任意 Origin 反射は**本番導入時に絞る**（TODO として残す。今は開発都合で現状維持でよいか要確認）

## 命名の揺れ（各 Phase のついでに直す）

- モーダル呼称の統一: picker / sheet / modal / panel / overlay / backdrop が混在 → 「Modal（骨格）+ sheet（中身）+ backdrop（背面）」に統一
- `kind` の多義（LogKind / AddKind / CSS の .kind）→ CSS クラス名を機能名に変更
- UI の「Genres」はデータモデル上 Folder → どちらかに寄せるか要確認（表示は Genres のままでもコード内の変数名は folder に統一）
- `SettingsScreen` が `Placeholder.module.css` を使用 → `SettingsScreen.module.css` にリネーム

## やらないこと（今回のスコープ外）

- 状態管理ライブラリの導入（Context のままで十分）
- API のスキーマ検証・認証（個人用のため。CORS だけ本番時に絞る）
- テストコードの新規整備（手動スモークで代替）
- `scripts/import-old-csv.mjs` の整理（一回きりのスクリプト。触らない）

## 進め方

1. Phase 順に実施。1 Phase = 1 コミットを基本とする
2. 各 Phase 後に `build-web.bat` でビルドが通ることを確認し、開発サーバーで主要動線（記録開始/停止・記録編集・Log の各期間表示・モーダル開閉）をスモーク
3. Phase 1〜2 は機械的で安全なのでまとめて実施可。Phase 5 と 6 は影響が大きいので単独で

## 要確認事項（着手前に決めたいこと）

1. `styles.monthPick`（定義なしクラス）は削除でよいか、それとも見た目の意図があったか
2. Activity の tick が 250ms なのは意図的か（他は 1000ms）
3. `@` エイリアスと `Store.reload` は消してよいか
4. LogScreen のピッカーにも閉じアニメーションを付けるか
5. CORS はいつ絞るか（本番URL確定時か）
