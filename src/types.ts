/**
 * TimeLogger データ項目定義（サーバー上 JSON の正本）
 *
 * ファイル:
 * - data/tasks.json     … フォルダ＋タスク
 * - data/settings.json  … Setting（現状空）
 * - data/events.json    … 記録（終了時刻 null = 記録中の1件）
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

/** タスク */
export type Task = {
  id: string
  folderId: string
  name: string
  color: string
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
  monthYear: number
  month: number
  year: number
  /** Custom 下書き（モーダル上） */
  customStart: string
  customEnd: string
  /** Apply 済みの Custom。未適用なら null → 表示は当日1日 */
  customApplied: { start: string; end: string } | null
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

/** API が返す書き込み結果 */
export type WriteResult = {
  ok: true
  updatedAt: string
}

export type ApiError = {
  ok: false
  error: string
}
