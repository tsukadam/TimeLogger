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

Body: `{ "taskId": "…", "at?": "ISO" }`

開いている記録をその時刻で閉じ、同時刻に開始する（後勝ち）。`at` 省略はサーバーのいま。2分以内の隙間は中点に丸める。名前と色は開始時点のスナップショット。

- 400 `taskId required` / 時刻不正 / 未来すぎる
- 404 タスクまたはフォルダが無い

### `POST stop`

Body: `{ "at?": "ISO", "eventId?": "…" }`

まだ開いている記録だけを閉じる。1秒未満は行ごと捨てる（誤タップ）。

- `eventId` あり: その記録。既に閉じていたら **409**「既に終了しています」。無い id は 404
- `eventId` なし: 開いているものを閉じる。何も開いていなければ成功（`current: null`）

### `POST update`

Body: `{ "eventId": "…", "taskId?": "…", "startedAt?": "ISO", "endedAt?": "ISO" }`

1 件の時刻・タスク変更。省略した欄は現状維持。規則（重複・2分丸め・最小1秒）はサーバー。

- 記録中は `endedAt` を付けられない。終了済みを `endedAt: null` には戻せない
- タスクを変えたときだけ名前と色のスナップショットを差し替える
- 400 重複・1秒未満・未来・記録中の終了編集
- 404 記録またはタスクが無い

PWA の Activity 編集と、時計のミス直し（記録中のタスク／開始、直前の直し）がここ。

### `POST delete`

Body: `{ "eventId": "…" }`

1 件削除。無い id は 404。時計は直前の取り消しに使う。

### `POST add`

Body: `{ "taskId": "…", "startedAt": "ISO", "endedAt": "ISO" }`

閉じた記録の穴埋め。時計には出さない。PWA の Activity ＋ がここ。

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
