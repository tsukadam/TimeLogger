/**
 * TimeLogger データ項目定義（サーバー上 JSON の正本）
 *
 * ファイル:
 * - data/tasks.json     … フォルダ＋タスク
 * - data/settings.json  … Setting（現状空）
 * - data/events.json    … 記録（終了時刻 null = 記録中の1件）
 *
 * 時刻はすべて ISO 8601（タイムゾーン付き、例: 2026-07-14T09:00:00+09:00）
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

export type SettingsFile = {
  /** 将来用。現状は空オブジェクトでよい */
  updatedAt: string
}

/**
 * 記録（Event）
 * - endedAt が null → 記録中（同時に複数は持たない）
 * - taskName / folderName は記録時点のスナップショット（AI・履歴表示用）
 */
export type Event = {
  id: string
  taskId: string
  folderId: string
  taskName: string
  folderName: string
  /** 記録時点のテーマ色スナップショット（グラフ用） */
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
