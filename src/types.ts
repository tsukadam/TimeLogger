/**
 * TimeLogger データ項目定義（サーバー上 JSON の正本）
 *
 * ファイル:
 * - data/tasks.json     … フォルダ＋タスク
 * - data/settings.json  … Setting
 * - data/events/        … 記録（四半期チャンク + index.json）
 * - data/events.json    … 分割前バックアップ（API は使わない）
 * - data/debug.log      … クライアント／API デバッグ追記ログ
 *
 * 時刻はすべて ISO 8601（ミリ秒付き・タイムゾーン付き、例: 2026-07-14T09:00:00.123+09:00）
 * 表示は秒未満切り捨て。記録有無の判定など処理は ms を使う。
 */

/** フォルダ */
export type Folder = {
  id: string
  name: string
  /** CSS で使える色 (#RRGGBB) */
  color: string
  /** 表示順（小さいほど上） */
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * タスク色がフォルダ基準パレットのどのマス由来かの座標。
 * これが正本で、`Task.color` はここから計算した結果の焼き付け。
 * 自由指定（ピッカー）は座標を持たない（`null`）＝フォルダ色を変えても追従しない。
 */
export type TaskColorRef = {
  /** 色相 0..4（2 がフォルダ色と同じ色相） */
  hue: number
  /** 彩度 0..2（1 が基準） */
  sat: number
  /** 明暗 0..2（0 暗 / 1 元 / 2 明） */
  light: number
}

/** タスク */
export type Task = {
  id: string
  folderId: string
  name: string
  /** CSS で使える色 (#RRGGBB)。colorRef があればそこから算出した値 */
  color: string
  /** null / 欄なしは自由指定 */
  colorRef?: TaskColorRef | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type TasksFile = {
  folders: Folder[]
  tasks: Task[]
  /** このファイル自体の最終更新 */
  updatedAt: string
}

export type LogKind = 'all' | 'day' | 'week' | 'month' | 'year' | 'custom'

/** Log 画面の期間選択メモ（settings.json） */
export type LogPrefs = {
  kind: LogKind
  day: string
  weekStart: string
  /** Month の基準日。この日から1ヶ月間 */
  monthStart: string
  /** Year の基準月（その月の1日）。この月から1年間 */
  yearStart: string
  /** Custom 下書き（モーダル上） */
  customStart: string
  customEnd: string
  /** Apply 済みの Custom。未適用なら null → 表示は当日1日 */
  customApplied: { start: string; end: string } | null
  /** Custom サマリーの粒度 */
  customGrain: 'day' | 'week' | 'month'
  /**
   * Day/Week/Month/Year を「その区切り日に初めて開いた」日。
   * 区切りは東京 5:00（0:00–4:59 は前日）。値が今の区切り日と一致する種別は、
   * 手で変えた期間を維持する。
   */
  rangeAlignedOn?: Partial<Record<'day' | 'week' | 'month' | 'year', string>>
}

export type SettingsFile = {
  log?: LogPrefs
  updatedAt: string
}

/**
 * 記録（Event）
 * - endedAt が null → 記録中（同時に複数は持たない）
 * - taskName / 色などは記録（またはタスク割当変更）時点のスナップショット
 * - マスタの改名には追従しない（過去の意味を保つ）
 */
export type Event = {
  id: string
  taskId: string
  folderId: string
  taskName: string
  folderName: string
  /** 記録時点の色スナップショット（マスタ改変に追従しない） */
  taskColor: string
  folderColor: string
  startedAt: string
  endedAt: string | null
  createdAt: string
  updatedAt: string
}

export type EventsFile = {
  events: Event[]
  updatedAt: string
}

/** data/events/index.json — 四半期チャンクの目次 */
export type EventsIndex = {
  /** 古い→新しい順 */
  chunks: string[]
  /** いま書き込む四半期（例: 2026Q3） */
  current: string
  updatedAt: string
}

/** API が返す書き込み結果 */
export type WriteResult = {
  ok: true
  updatedAt: string
}

export type ApiError = {
  ok: false
  error: string
}
