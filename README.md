# TimeLogger

自分のサーバーに置いて使うシンプルなロガー。PWA対応。Pixel watch用のアプリ付属。

既存のロガーは高機能なものが多く、「単線でいいから２４時間記録したい」「円グラフで見たい」という用途に合うものが見当たらない。
加えて「ログを書き出す手間なしにＡＩに行動記録を渡したい」と思ったので、web上で動作するものを作った。

- 一度に記録できるタスクは1つだけ（単線のグラフになる）
- 記録はJSONでサーバーに保存され、AIなどの外部ツールで直接参照できる
- 認証の類はないので注意。置き場所のURLを知っている人は誰でも全ての操作ができる
- Jelly Starの画面サイズに対応

`data/` にあるのは挙動確認用の見本（フォルダ 2・タスク 4・記録は 1 日分＋記録中 1 本）

## 画面

- **Tasks** — フォルダ／タスクの管理と記録の開始・停止
- **Activity** — 記録の一覧・編集・手動追加
- **Log** — 期間別の集計（Tracked Time / Summary / Tasks / Genres 円グラフ）

## スタック

- Vite + React + TypeScript + PWA（vite-plugin-pwa）
- サーバー側は PHP（`api/index.php` + `api/commands.php`）。記録もフォルダ／タスクも書き込みはコマンド API。読みと、設定・目次の書きは JSON ファイルの GET/PUT
- HTTP の正本は [docs/api.md](docs/api.md)
- 想定デプロイ先はレンタルサーバー（PHP が動けば OK）

## 開発

```bash
npm install
npm run dev        # Vite 開発サーバー
php -S 127.0.0.1:8080 -t .   # API 用ローカル PHP サーバー（別ターミナル）
```

`/api` と `/data` は Vite の proxy 経由で PHP サーバーに流れる。クローンした直後は見本データで動く。

## ビルド／デプロイ

```bash
npm run build      # dist/ に出力（ベースパスは VITE_BASE_PATH で変更可）
```

Windows なら `build-web.bat` で `build/timelogger/` と zip が出る。サーバーへは `dist/`（またはその中身）と `api/`、初回だけ `data/` を置く。二回目以降に `data/` を上書きするとログが消えるので、`build-web.bat` は既定で data を含めない。初回だけ `build-web.bat withdata`。

## 注意

本体の URL を知っている人は誰でもデータにアクセスでき、編集できるので、置き場所には気を付けてください。

## Wear OS（おまけ）

同じ API を叩く Pixel Watch 向けの窓口。フォルダ／タスクの新規作成はない。グラフはデイリー２週間分のみ。ウィジェットでよく使う項目を開始できる。

API の URL はビルド時に APK へ埋め込まれる。`wear/local.properties.example` を `wear/local.properties` にコピーし、`timelogger.api.base` を自分のサーバーの API 口にする。

Android Studio では `wear/` を開いて **app** モジュールを、接続した時計へ Run する。コマンドなら `wear/build.bat` のあと `wear/install.bat`（無線 adb）。

## ライセンス

MIT License。詳細は [LICENSE](LICENSE) を参照。
