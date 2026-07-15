# TimeLogger

個人用ライフログ・タイムトラッカー。スマホ（PWA）で使う前提の自分専用アプリ。

- 一度に記録できるタスクは 1 つだけ。別のタスクを開始すると前の記録は自動で終了する
- 記録は JSON でサーバーに保存され、URL を直接読めば AI などの外部ツールからも参照できる

## 画面

- **Tasks** — フォルダ／タスクの管理と記録の開始・停止
- **Activity** — 記録の一覧・編集・手動追加
- **Log** — 期間別の集計（Tracked Time / Summary / Tasks / Genres 円グラフ）
- **Setting** — 設定（作りかけ）

## スタック

- Vite + React + TypeScript + PWA（vite-plugin-pwa）
- サーバー側は PHP 1 ファイル（`api/index.php`）が `data/*.json` を GET/PUT するだけ
- 想定デプロイ先はレンタルサーバー（PHP が動けば OK）

## 開発

```bash
npm install
npm run dev        # Vite 開発サーバー
php -S 127.0.0.1:8080 -t .   # API 用ローカル PHP サーバー（別ターミナル）
```

`/api` と `/data` は Vite の proxy 経由で PHP サーバーに流れる。

## ビルド

```bash
npm run build      # dist/ に出力（ベースパスは VITE_BASE_PATH で変更可）
```

`dist/` と `api/`、`data/` をサーバーに配置する。

## ライセンス

MIT License。詳細は [LICENSE](LICENSE) を参照。
