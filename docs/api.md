# TimeLogger HTTP API

本丸の口の正本。足したり変えたら、実装と一緒にここを直す。

- 入口: `GET|PUT|POST /api/index.php?resource=…`
- 時刻: ISO 8601、`Asia/Tokyo`（ミリ秒付き可。例 `2026-09-20T15:00:00.123+09:00`）
- 失敗: `{ "ok": false, "error": "…" }` と 4xx/5xx
- 認証なし。URL を知っている人が読めて書ける
- AI 用の直読み: `GET /data/tasks.json`、`GET /data/events/index.json`、`GET /data/events/2026Q3.json` など（書き込みは API 経由）

ローカルでは Vite が `/api` と `/data` を `php -S 127.0.0.1:8080` へ流す。

規則（記録は一本線・記録中は同時に一つ・端点一致は重複でない・2分以内は中点丸め・並び番号・フォルダを消すのはタスクが無いときだけ）はコマンド側が持つ。記録とマスタ（フォルダ／タスク）の書き込みは全部コマンド。ファイル PUT は `settings` と `events-index` だけ。

---

## コマンド（Wear と PWA）

書き込みは `data/events/commands.lock` で直列化する（チャンク PUT も同じ錠）。

記録コマンドの成功: `{ ok, current, last, tasksUpdatedAt, index, chunks }`
`chunks` は書き換えた四半期ファイル全体。PWA のメモリ更新用。時計は捨ててよい。

マスタコマンド（`folder-*` / `task-*`）の成功: `{ ok, tasks }`
`tasks` は `data/tasks.json` 全体。`task-delete` が記録を閉じたときだけ `current` / `last` / `index` / `chunks` も付く。

### `GET now`

記録中 1 本と、直前に閉じた 1 本。

```json
{ "ok": true, "current": { /* Event */ } | null, "last": { /* Event */ } | null, "tasksUpdatedAt": "…" }
```

`tasksUpdatedAt` が手元の tasks より新しければ、tasks を読み直す。経過は `current.startedAt` から端末で数える。

### `POST start`

Body: `{ "taskId": "…", "at?": "ISO", "eventId?": "…w" }`

開いている記録をその時刻で閉じ、同時刻に開始する（後勝ち）。`at` 省略はサーバーのいま。2分以内の隙間は中点に丸める。名前と色は開始時点のスナップショット。

任意の `eventId` はウォッチ採番。末尾 `w` 必須。既存 id と重複なら 400。無ければ本丸が振る。

- 400 `taskId required` / `eventId` 不正・重複 / 時刻不正 / 未来すぎる
- 404 タスクまたはフォルダが無い

### `POST signal-start`

Body: `{ "taskId": "…", "at": "ISO", "eventId?": "…w" }`

Health の開始。`at` は必須。上書き関数に `until`＝サーバーのいまを渡してから、そのタスクを `at` で開始する。2分スナップはしない。境界は `at` のまま。`いま` は記録行にならない。

上書き（後発開始）:

- 記録中で開始が `at` より前 → `at` で閉じる。残り 1 秒未満なら行ごと捨てる
- 記録中で開始が `at` 以降 → 行ごと捨てる
- `until` があるとき、終了済みで区間が `[at, until)` に丸ごと入る → 行ごと捨てる
- 終了済みで `at` をまたぐ → `endedAt` を `at` に切る。残り 1 秒未満なら行ごと捨てる
- 終了済みで全体が `at` より前 → 触らない

`eventId` は `POST start` と同じ任意のウォッチ採番。

- 400 `taskId required` / `at required` / `eventId` 不正・重複 / 時刻不正 / 未来すぎる
- 404 タスクまたはフォルダが無い

`POST cut-in` は同じ handler の別名。Wear がまだ `cut-in` を叩く。正本の名前は `signal-start`。

`POST start` とは別口。通常開始の意味は変えない。

### `POST signal-stop`

Body: `{ "eventId": "…", "at": "ISO", "resumeTaskId?": "…" }`

Health の終了。指定行を `at` で閉じる。無い id は 404。既に閉じていたら **409 で終わり、再開しない**。

閉じに成功し `resumeTaskId` があれば、そのタスクで `signal-start` と同じ上書き開始（`at`、`until`＝いま）。ウォッチが直前を渡す。本丸は覚えない。空なら閉じるだけ。

### `POST merge-queue`

Body:

```json
{
  "ops": [
    { "op": "start", "taskId": "…", "at": "ISO", "eventId": "…w" },
    { "op": "stop", "eventId": "…", "at": "ISO" }
  ]
}
```

本体ログとキュー一時ログのマージ。触れる箇所だけ書き直す。各線の内側は流し直さない。`start` を順に叩くのではない。

- `ops` は 1 件以上、上限 256。空や上限超えは 400
- `op` は `start` | `stop` だけ
- 開始は `taskId` `at` `eventId` すべて必須。`eventId` は末尾 `w`
- 終了は `eventId` `at` 必須
- `commands.lock` を握ったまま 1 リクエストで終える
- 成功の戻りに `skipped`（409 で飛ばした終了）を足す。1 件の 409 で全体は落とさない
- 開始の 400/404 は全体失敗。無い終了 id は 404 で全体失敗

キューの区間と重なる本体行だけを見る。接点では開始時刻が後の側が勝つ。負けた側の残りは穴（再開しない）。同じ側の連続は流し直さない。`planOverwrite` をキューの各開始へかけない（12:00–15:00 のキューが 13:00–14:00 の本体を消さない。他機の終了済みを開始のたびに削らない）。はみ出した終了は 409 でその 1 件だけ飛ばす。穴は埋めない。スナップはかけない。

### `POST stop`

Body: `{ "at?": "ISO", "eventId?": "…" }`

まだ開いている記録だけを閉じる。1秒未満は行ごと捨てる（誤タップ）。

- `eventId` あり: その記録。既に閉じていたら **409**「既に終了しています」。無い id は 404
- `eventId` なし: 開いているものを閉じる。何も開いていなければ成功（`current: null`）

### `POST overwrite`

Body: `{ "eventId": "…", "startedAt": "ISO", "endedAt": "ISO", "editedAt": "ISO", "taskId?": "…" }`

ウォッチの時刻編集と追加、本体 Activity の終了済み編集・追加。対象を線から外し、閉じた区間 `[startedAt, endedAt)` をその id で置く。**先に隙間だけ 2 分スナップ**（隣と 2 分以内の空きなら自分と隣を中点へ）。残った重なりは丸ごと削除するか、はみ出しを両側とも切って残す（穴にしない）。両側にはみ出す行は二行に分割し、右は本丸が新規 id を振る（末尾 `w` なし）。記録中の開始変更は `POST update`（塗りは同じ）。

- `endedAt` は null 不可。区間が 1 秒未満なら 400
- `editedAt` は Save を押した時刻。キュー再送でも同じ値。既存ログには常に上書き。409 になるのは、その行に前回 overwrite の `editedAt` があり、それより古いときだけ。未編集の行（フィールド無し）は常に乗る。`updatedAt` は見ない
- `taskId` 省略は対象のタスクのまま。付けたときだけ名前と色のスナップショットを差し替える。**無い `eventId` は新規行**（`taskId` 必須。無ければ 400）
- 切れ端 1 秒未満は行ごと捨てる。記録中の既存は終了をいまとみなす。右が残れば記録中のまま
- 優先は `editedAt` だけ。開始時刻では順を付けない
- 本体の記録中（`endedAt` null）の開始変更は `POST update`

### `POST update`

Body: `{ "eventId": "…", "taskId?": "…", "startedAt?": "ISO", "endedAt?": "ISO" }`

1 件の時刻・タスク変更。省略した欄は現状維持。**先に隙間だけ 2 分スナップ**。残った重なりは `overwrite` と同じ塗り（切る／飲み込む）。記録中は `[startedAt, いま)` を塗る。行は記録中のまま。

- 記録中は `endedAt` を付けられない。終了済みを `endedAt: null` には戻せない
- タスクを変えたときだけ名前と色のスナップショットを差し替える
- 400 1秒未満・未来・記録中の終了編集（重複では弾かない）
- 404 記録またはタスクが無い

PWA の記録中の開始変更がここ。終了済みの Activity 編集は `overwrite`。

### `POST delete`

Body: `{ "eventId": "…" }`

1 件削除。無い id は 404。時計は直前の取り消しに使う。

### `POST add`

Body: `{ "taskId": "…", "startedAt": "ISO", "endedAt": "ISO" }`

閉じた記録の穴埋め。隙間スナップのあと重なりは塗る。PWA の Activity ＋ は `overwrite`（新規 id）に寄せた。この口は残してある。

### `POST join`

Body: `{ "olderId": "…", "newerId": "…", "at?": "ISO" }`

記録と記録の境（Activity の ⇔）。`at` 省略は中点。成功に `boundary`（揃えた ISO）が付く。

- 400 前後逆・前が未終了・1秒未満・重複・未来
- 404 記録が無い

### `POST folder-save`

Body: `{ "id?": "…", "name": "…", "color": "#RRGGBB", "taskColors?": { "taskId": "#RRGGBB" } }`

`id` 無しは追加（並び番号は末尾）、あれば名前と色の変更。パレット由来（`colorRef` あり）のタスク色は `taskColors` で焼き直した hex を渡す。計算は UI。自由指定（`colorRef` なし）はここに載せない。

- 400 名前が空／100 文字超・色が `#RRGGBB` でない・そのフォルダに無い／自由指定のタスクの色を混ぜた
- 404 フォルダまたはタスクが無い

### `POST folder-move`

Body: `{ "folderId": "…", "dir": 1 | -1 }`

一つ上／下と入れ替えて並び番号を詰め直す。端で動かせないときは何もせず成功。

### `POST folder-delete`

Body: `{ "folderId": "…" }`

タスクが残っていれば 400。消した後は並び番号を詰め直す。

### `POST task-save`

Body: `{ "id?": "…", "folderId": "…", "name": "…", "color": "#RRGGBB", "colorRef?": { "hue": 0-4, "sat": 0-2, "light": 0-2 } | null }`

`id` 無しは追加（そのフォルダの末尾）。フォルダを移したときは移動先の末尾に付け直す。`colorRef` はパレット上の座標。`null` は自由指定（フォルダ色を変えても追従しない）。欄を省けば現状維持。表示用の hex は `color` に焼き付ける。ログ（events）の名前・色スナップショットは追従しない。

### `POST task-reorder`

Body: `{ "folderId": "…", "orderedIds": ["…"] }`

そのフォルダのタスク全部をちょうど一度ずつ並べる。違えば 400。

### `POST task-delete`

Body: `{ "taskId": "…" }`

タスクを消す。過去の記録は残る。記録中なら同じ錠の中で記録も閉じる（1秒未満なら行ごと捨てる）ので、戻りに `current` / `index` / `chunks` が付く。

---

## ファイル GET / PUT

Body は当該 JSON ファイル全体。PUT 成功は `{ "ok": true, "updatedAt": "…" }`（サーバーが `updatedAt` を書き直す）。

| resource | ファイル | GET | PUT |
|---|---|---|---|
| `tasks` | `data/tasks.json` | ○ Wear は同期のたびに GET | × `folder-*` / `task-*` コマンド |
| `settings` | `data/settings.json` | ○ Log の期間メモなど。Wear は不要 | ○ |
| `events-index` | `data/events/index.json` | ○ 四半期チャンクの目次 | ○ |
| `events` | `data/events/{chunk}.json` | ○ 要 `?chunk=2026Q3`（`YYYYQn`） | ○ 使わない（記録はコマンド） |

ログの読みは四半期 GET のまま。範囲絞りは作らない（JSON のままではサーバーも四半期全文を読む。現状 1 チャンク約 1400 件・770KB で、年グラフを出さなければ時計もこれで足りる）。イベントの書き込みはコマンド。

### `debug`

- `POST debug` `{ level, message, detail? }` → `data/debug.log` に JSONL 追記
- `GET debug` ログ全文（無ければ空）。Content-Type は text

---

## 読み出しの使い分け

**いまの記録・タスク（Wear 1段）**

1. `GET tasks`
2. `GET now`（`current` と `last`）

**ログ（Activity / Log / 時計の一覧）**

重なる四半期を GET する。起動時は current（＋一つ前）。広い期間はチャンクを足す。集計はクライアント。

**AI**

`/data/…` の直読みでよい。

---

## まだコマンドでない書き込み

`settings`（Log の期間メモ）と `events-index` だけ。どちらも記録そのものではない。

---

## Event の形

```json
{
  "id": "uuid",
  "taskId": "uuid",
  "folderId": "uuid",
  "taskName": "F社",
  "folderName": "仕事",
  "taskColor": "#0099fa",
  "folderColor": "#0099fa",
  "startedAt": "2026-09-18T11:06:01.000+09:00",
  "endedAt": null,
  "createdAt": "…",
  "updatedAt": "…"
}
```

`endedAt` が `null` なら記録中。同時に複数は持たない（壊れていたら start がまとめて閉じる）。
