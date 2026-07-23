import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { fetchResource, isOnline, putResource, reportDebugLog, WRITE_SLOW_MS } from '../api/client'
import { newId } from '../lib/id'
import { remapPaletteTaskColor } from '../lib/color'
import { elapsedMs, MIN_RECORD_MS, nowIso } from '../lib/time'
import type {
  Event,
  EventsIndex,
  Folder,
  LogPrefs,
  SettingsFile,
  Task,
  TasksFile,
} from '../types'
import { validateEventRange } from './eventValidation'
import {
  type ChunkMap,
  fetchBootEvents,
  findChunkIdForEvent,
  hasMoreOlderChunks,
  loadChunks,
  mergeChunkEvents,
  nextOlderChunkId,
  persistChunkUpdates,
  quarterIdFromIso,
  rangeChunkIds,
} from './eventsRepository'

type StoreData = {
  loading: boolean
  error: string | null
  folders: Folder[]
  tasks: Task[]
  events: Event[]
  current: Event | null
  logPrefs: LogPrefs | null
  hasMoreOlderEvents: boolean
}

type StoreActions = {
  clearError: () => void
  saveLogPrefs: (prefs: LogPrefs) => Promise<void>
  addFolder: (name: string, color: string) => Promise<void>
  addTask: (folderId: string, name: string, color: string) => Promise<void>
  updateFolder: (
    folderId: string,
    patch: { name: string; color: string },
  ) => Promise<void>
  moveFolder: (folderId: string, dir: 1 | -1) => Promise<void>
  reorderTasks: (folderId: string, orderedIds: string[]) => Promise<void>
  updateTask: (
    taskId: string,
    patch: { name: string; color: string; folderId: string },
  ) => Promise<void>
  updateEvent: (
    eventId: string,
    patch: {
      taskId: string
      startedAt: string
      endedAt: string | null
    },
  ) => Promise<void>
  addEvent: (patch: {
    taskId: string
    startedAt: string
    endedAt: string
  }) => Promise<void>
  deleteEvent: (eventId: string) => Promise<void>
  deleteFolder: (folderId: string) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  startTask: (taskId: string) => Promise<void>
  stopCurrent: () => Promise<void>
  loadOlderEvents: () => Promise<void>
  ensureEventsForRange: (startMs: number, endMs: number) => Promise<void>
}

const BusyContext = createContext(false)
const DataContext = createContext<StoreData | null>(null)
const ActionsContext = createContext<StoreActions | null>(null)

function requireOnline(): void {
  if (!isOnline()) {
    throw new Error('オフラインです')
  }
}

/**
 * 記録中イベントを締める。
 * 経過 < MIN_RECORD_MS なら行ごと削除（誤タップ扱い）。
 * それ以外は endedAt を付ける。
 * 同時に複数の未終了があっても全て処理する（壊れた状態の修復も兼ねる）。
 */
function closeOrDiscardOpen(
  events: Event[],
  endMs: number,
  endIso: string,
): Event[] {
  const next: Event[] = []
  for (const ev of events) {
    if (ev.endedAt !== null) {
      next.push(ev)
      continue
    }
    const startMs = new Date(ev.startedAt).getTime()
    const elapsed = elapsedMs(ev.startedAt, null, endMs)
    // 念のため startMs も照合（NaN 防止）
    if (!Number.isFinite(startMs) || elapsed < MIN_RECORD_MS) {
      // 破棄: next に入れない
      continue
    }
    next.push({ ...ev, endedAt: endIso, updatedAt: endIso })
  }
  return next
}

/** 未終了イベントがあったチャンクだけ、締めた events 配列を返す */
function closeOpenAcrossChunks(
  chunks: ChunkMap,
  endMs: number,
  endIso: string,
): Record<string, Event[]> {
  const dirty: Record<string, Event[]> = {}
  for (const [id, file] of Object.entries(chunks)) {
    if (!file.events.some((e) => e.endedAt === null)) continue
    dirty[id] = closeOrDiscardOpen(file.events, endMs, endIso)
  }
  return dirty
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tasksFile, setTasksFile] = useState<TasksFile | null>(null)
  const [eventsIndex, setEventsIndex] = useState<EventsIndex | null>(null)
  const [chunks, setChunks] = useState<ChunkMap>({})
  const [settingsFile, setSettingsFile] = useState<SettingsFile | null>(null)

  const eventsIndexRef = useRef(eventsIndex)
  const chunksRef = useRef(chunks)
  useEffect(() => {
    eventsIndexRef.current = eventsIndex
  }, [eventsIndex])
  useEffect(() => {
    chunksRef.current = chunks
  }, [chunks])

  const clearError = useCallback(() => setError(null), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [tasks, settings, boot] = await Promise.all([
          fetchResource('tasks'),
          fetchResource('settings'),
          fetchBootEvents(),
        ])
        if (cancelled) return
        setTasksFile(tasks)
        setSettingsFile(settings)
        setEventsIndex(boot.index)
        setChunks(boot.chunks)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '読み込みに失敗しました')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const runWrite = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    const t0 = performance.now()
    reportDebugLog('info', 'write start')
    const slowTimer = window.setTimeout(() => {
      reportDebugLog('warn', 'write still busy', {
        afterMs: WRITE_SLOW_MS,
      })
    }, WRITE_SLOW_MS)
    try {
      requireOnline()
      await fn()
      reportDebugLog('info', 'write ok', {
        ms: Math.round(performance.now() - t0),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '書き込みに失敗しました'
      setError(msg)
      reportDebugLog('error', 'write failed', {
        error: msg,
        ms: Math.round(performance.now() - t0),
      })
      throw e
    } finally {
      window.clearTimeout(slowTimer)
      setBusy(false)
    }
  }, [])

  const applyChunkPatch = useCallback((patch: ChunkMap) => {
    const next = { ...chunksRef.current, ...patch }
    chunksRef.current = next
    setChunks(next)
  }, [])

  const applyPersistResult = useCallback(
    (result: { chunks: ChunkMap; index: EventsIndex }) => {
      applyChunkPatch(result.chunks)
      eventsIndexRef.current = result.index
      setEventsIndex(result.index)
    },
    [applyChunkPatch],
  )

  const ensureChunks = useCallback(async (ids: string[]) => {
    const index = eventsIndexRef.current
    if (!index || ids.length === 0) return
    const next = await loadChunks(ids, chunksRef.current, index)
    if (next === chunksRef.current) return
    chunksRef.current = next
    setChunks(next)
  }, [])

  const loadOlderEvents = useCallback(async () => {
    const index = eventsIndexRef.current
    if (!index) return
    const nextId = nextOlderChunkId(index, chunksRef.current)
    if (!nextId) return
    await ensureChunks([nextId])
  }, [ensureChunks])

  const ensureEventsForRange = useCallback(
    async (startMs: number, endMs: number) => {
      const index = eventsIndexRef.current
      if (!index) return
      const rangeIds = rangeChunkIds(index, startMs, endMs)
      // 非常に広い範囲で全四半期に重なる場合は index 上の全チャンクを読む
      const ids =
        rangeIds.length >= index.chunks.length ? [...index.chunks] : rangeIds
      await ensureChunks(ids)
    },
    [ensureChunks],
  )

  const addFolder = useCallback(
    async (name: string, color: string) => {
      if (!tasksFile) return
      const trimmed = name.trim()
      if (!trimmed) return
      await runWrite(async () => {
        const t = nowIso()
        const next: TasksFile = {
          ...tasksFile,
          folders: [
            ...tasksFile.folders,
            {
              id: newId(),
              name: trimmed,
              color,
              sortOrder: tasksFile.folders.length,
              createdAt: t,
              updatedAt: t,
            },
          ],
          updatedAt: t,
        }
        const saved = await putResource('tasks', next)
        setTasksFile(saved)
      })
    },
    [runWrite, tasksFile],
  )

  const addTask = useCallback(
    async (folderId: string, name: string, color: string) => {
      if (!tasksFile) return
      const trimmed = name.trim()
      if (!trimmed) return
      await runWrite(async () => {
        const t = nowIso()
        const next: TasksFile = {
          ...tasksFile,
          tasks: [
            ...tasksFile.tasks,
            {
              id: newId(),
              folderId,
              name: trimmed,
              color,
              sortOrder: tasksFile.tasks.filter((x) => x.folderId === folderId).length,
              createdAt: t,
              updatedAt: t,
            },
          ],
          updatedAt: t,
        }
        const saved = await putResource('tasks', next)
        setTasksFile(saved)
      })
    },
    [runWrite, tasksFile],
  )

  const updateFolder = useCallback(
    async (folderId: string, patch: { name: string; color: string }) => {
      if (!tasksFile) return
      const trimmed = patch.name.trim()
      if (!trimmed) return
      await runWrite(async () => {
        const t = nowIso()
        const old = tasksFile.folders.find((f) => f.id === folderId)
        const colorChanged =
          !!old && old.color.toLowerCase() !== patch.color.toLowerCase()

        const nextTasks: TasksFile = {
          ...tasksFile,
          folders: tasksFile.folders.map((f) =>
            f.id === folderId
              ? { ...f, name: trimmed, color: patch.color, updatedAt: t }
              : f,
          ),
          tasks: colorChanged
            ? tasksFile.tasks.map((task) => {
                if (task.folderId !== folderId || !old) return task
                const remapped = remapPaletteTaskColor(
                  old.color,
                  patch.color,
                  task.color,
                )
                if (!remapped) return task
                return { ...task, color: remapped, updatedAt: t }
              })
            : tasksFile.tasks,
          updatedAt: t,
        }
        const savedTasks = await putResource('tasks', nextTasks)
        setTasksFile(savedTasks)
        // ログ（events）の名前・色スナップショットは追従しない
      })
    },
    [runWrite, tasksFile],
  )

  const moveFolder = useCallback(
    async (folderId: string, dir: 1 | -1) => {
      if (!tasksFile) return
      const sorted = [...tasksFile.folders].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      )
      const i = sorted.findIndex((f) => f.id === folderId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= sorted.length) return
      await runWrite(async () => {
        const t = nowIso()
        ;[sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!]
        // 入れ替え後の並びで sortOrder を振り直す
        const next: TasksFile = {
          ...tasksFile,
          folders: sorted.map((f, idx) =>
            f.sortOrder === idx ? f : { ...f, sortOrder: idx, updatedAt: t },
          ),
          updatedAt: t,
        }
        const saved = await putResource('tasks', next)
        setTasksFile(saved)
      })
    },
    [runWrite, tasksFile],
  )

  const reorderTasks = useCallback(
    async (folderId: string, orderedIds: string[]) => {
      if (!tasksFile) return
      const inFolder = tasksFile.tasks
        .filter((t) => t.folderId === folderId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      if (
        orderedIds.length !== inFolder.length ||
        orderedIds.some((id) => !inFolder.some((t) => t.id === id))
      ) {
        return
      }
      const same = inFolder.every((t, i) => t.id === orderedIds[i])
      if (same) return
      await runWrite(async () => {
        const t = nowIso()
        const byId = new Map(inFolder.map((task) => [task.id, task]))
        const reordered = orderedIds.map((id, idx) => {
          const task = byId.get(id)!
          return task.sortOrder === idx
            ? task
            : { ...task, sortOrder: idx, updatedAt: t }
        })
        const others = tasksFile.tasks.filter((task) => task.folderId !== folderId)
        const next: TasksFile = {
          ...tasksFile,
          tasks: [...others, ...reordered],
          updatedAt: t,
        }
        const saved = await putResource('tasks', next)
        setTasksFile(saved)
      })
    },
    [runWrite, tasksFile],
  )

  const updateTask = useCallback(
    async (
      taskId: string,
      patch: { name: string; color: string; folderId: string },
    ) => {
      if (!tasksFile) return
      const trimmed = patch.name.trim()
      if (!trimmed) return
      await runWrite(async () => {
        const t = nowIso()
        const nextTasks: TasksFile = {
          ...tasksFile,
          tasks: tasksFile.tasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  name: trimmed,
                  color: patch.color,
                  folderId: patch.folderId,
                  updatedAt: t,
                }
              : task,
          ),
          updatedAt: t,
        }
        const savedTasks = await putResource('tasks', nextTasks)
        setTasksFile(savedTasks)
        // ログ（events）の名前・色スナップショットは追従しない
      })
    },
    [runWrite, tasksFile],
  )

  const deleteFolder = useCallback(
    async (folderId: string) => {
      if (!tasksFile) return
      if (tasksFile.tasks.some((t) => t.folderId === folderId)) {
        throw new Error('タスクがあるフォルダは削除できません')
      }
      await runWrite(async () => {
        const t = nowIso()
        const next: TasksFile = {
          ...tasksFile,
          folders: tasksFile.folders.filter((f) => f.id !== folderId),
          updatedAt: t,
        }
        const saved = await putResource('tasks', next)
        setTasksFile(saved)
      })
    },
    [runWrite, tasksFile],
  )

  const deleteTask = useCallback(
    async (taskId: string) => {
      if (!tasksFile) return
      await runWrite(async () => {
        const t = nowIso()
        const next: TasksFile = {
          ...tasksFile,
          tasks: tasksFile.tasks.filter((task) => task.id !== taskId),
          updatedAt: t,
        }
        const saved = await putResource('tasks', next)
        setTasksFile(saved)

        // 記録中のタスクを消したら、記録も停止する
        const open = mergeChunkEvents(chunksRef.current).find(
          (e) => e.endedAt === null,
        )
        const index = eventsIndexRef.current
        if (index && open && open.taskId === taskId) {
          const endMs = Date.now()
          const endIso = nowIso(new Date(endMs))
          const dirty = closeOpenAcrossChunks(chunksRef.current, endMs, endIso)
          if (Object.keys(dirty).length > 0) {
            const result = await persistChunkUpdates(dirty, index)
            applyPersistResult(result)
          }
        }
      })
    },
    [applyPersistResult, runWrite, tasksFile],
  )

  const updateEvent = useCallback(
    async (
      eventId: string,
      patch: {
        taskId: string
        startedAt: string
        endedAt: string | null
      },
    ) => {
      if (!tasksFile || !eventsIndexRef.current) return
      const task = tasksFile.tasks.find((x) => x.id === patch.taskId)
      if (!task) throw new Error('タスクが見つかりません')
      const folder = tasksFile.folders.find((x) => x.id === task.folderId)
      if (!folder) throw new Error('フォルダが見つかりません')

      const startMs = new Date(patch.startedAt).getTime()
      const nowMs = Date.now()
      const endedAt = patch.endedAt
      // 記録中は現在時刻まで占有しているとみなす
      let endMs = nowMs
      let validateEndBound = false
      if (endedAt !== null) {
        endMs = new Date(endedAt).getTime()
        validateEndBound = true
      }
      await ensureEventsForRange(startMs, endMs)
      validateEventRange({
        events: mergeChunkEvents(chunksRef.current),
        startMs,
        endMs,
        excludeId: eventId,
        nowMs,
        validateEndBound,
      })

      await runWrite(async () => {
        const index = eventsIndexRef.current
        if (!index) throw new Error('記録の目次がありません')

        const oldChunkId = findChunkIdForEvent(chunksRef.current, eventId)
        if (!oldChunkId) throw new Error('記録が見つかりません')

        const prevList = chunksRef.current[oldChunkId]?.events ?? []
        const prev = prevList.find((e) => e.id === eventId)
        if (!prev) throw new Error('記録が見つかりません')

        // 記録中は終了を触れない（endedAt は null のまま）
        if (prev.endedAt === null && endedAt !== null) {
          throw new Error('記録中の終了時刻は編集できません')
        }
        if (prev.endedAt !== null && endedAt === null) {
          throw new Error('終了済みの記録を記録中には戻せません')
        }

        const t = nowIso()
        const taskChanged = prev.taskId !== task.id
        const updated: Event = {
          ...prev,
          taskId: task.id,
          folderId: folder.id,
          // タスク割当を変えたときだけ、その時点のマスタ名でスナップショットを差し替え
          ...(taskChanged
            ? {
                taskName: task.name,
                folderName: folder.name,
                taskColor: task.color,
                folderColor: folder.color,
              }
            : {}),
          startedAt: patch.startedAt,
          endedAt: prev.endedAt === null ? null : endedAt,
          updatedAt: t,
        }

        const newChunkId = quarterIdFromIso(patch.startedAt)
        const updates: Record<string, Event[]> = {}

        if (newChunkId === oldChunkId) {
          updates[oldChunkId] = prevList.map((e) =>
            e.id === eventId ? updated : e,
          )
        } else {
          // 移動先が index にあるなら未ロードのまま上書きしない
          if (index.chunks.includes(newChunkId)) {
            await ensureChunks([newChunkId])
          }
          updates[oldChunkId] = prevList.filter((e) => e.id !== eventId)
          const dest = chunksRef.current[newChunkId]?.events ?? []
          updates[newChunkId] = [...dest, updated]
        }

        const result = await persistChunkUpdates(updates, index)
        applyPersistResult(result)
      })
    },
    [applyPersistResult, ensureChunks, ensureEventsForRange, runWrite, tasksFile],
  )

  const addEvent = useCallback(
    async (patch: { taskId: string; startedAt: string; endedAt: string }) => {
      if (!tasksFile || !eventsIndexRef.current) return
      const task = tasksFile.tasks.find((x) => x.id === patch.taskId)
      if (!task) throw new Error('タスクが見つかりません')
      const folder = tasksFile.folders.find((x) => x.id === task.folderId)
      if (!folder) throw new Error('フォルダが見つかりません')

      const startMs = new Date(patch.startedAt).getTime()
      const endMs = new Date(patch.endedAt).getTime()
      const qid = quarterIdFromIso(patch.startedAt)
      await ensureEventsForRange(startMs, endMs)
      // index に無い四半期でも後で persist が作る。既存ならロード済みにする
      if (eventsIndexRef.current?.chunks.includes(qid)) {
        await ensureChunks([qid])
      }
      validateEventRange({
        events: mergeChunkEvents(chunksRef.current),
        startMs,
        endMs,
        excludeId: null,
        nowMs: Date.now(),
        validateEndBound: true,
      })

      await runWrite(async () => {
        const index = eventsIndexRef.current
        if (!index) throw new Error('記録の目次がありません')
        const t = nowIso()
        const ev: Event = {
          id: newId(),
          taskId: task.id,
          folderId: folder.id,
          taskName: task.name,
          folderName: folder.name,
          taskColor: task.color,
          folderColor: folder.color,
          startedAt: patch.startedAt,
          endedAt: patch.endedAt,
          createdAt: t,
          updatedAt: t,
        }
        const base = chunksRef.current[qid]?.events ?? []
        const result = await persistChunkUpdates({ [qid]: [...base, ev] }, index)
        applyPersistResult(result)
      })
    },
    [applyPersistResult, ensureChunks, ensureEventsForRange, runWrite, tasksFile],
  )

  const deleteEvent = useCallback(
    async (eventId: string) => {
      if (!eventsIndexRef.current) return
      const chunkId = findChunkIdForEvent(chunksRef.current, eventId)
      if (!chunkId) return
      await runWrite(async () => {
        const index = eventsIndexRef.current
        if (!index) return
        const list = (chunksRef.current[chunkId]?.events ?? []).filter(
          (e) => e.id !== eventId,
        )
        const result = await persistChunkUpdates({ [chunkId]: list }, index)
        applyPersistResult(result)
      })
    },
    [applyPersistResult, runWrite],
  )

  const startTask = useCallback(
    async (taskId: string) => {
      if (!tasksFile || !eventsIndexRef.current) return
      const task = tasksFile.tasks.find((x) => x.id === taskId)
      if (!task) return
      const folder = tasksFile.folders.find((x) => x.id === task.folderId)
      if (!folder) return

      await runWrite(async () => {
        const index = eventsIndexRef.current
        if (!index) return
        const endMs = Date.now()
        const t = nowIso(new Date(endMs))
        const dirty = closeOpenAcrossChunks(chunksRef.current, endMs, t)
        const qid = quarterIdFromIso(t)
        const base = dirty[qid] ?? chunksRef.current[qid]?.events ?? []
        const started: Event = {
          id: newId(),
          taskId: task.id,
          folderId: folder.id,
          taskName: task.name,
          folderName: folder.name,
          taskColor: task.color,
          folderColor: folder.color,
          startedAt: t,
          endedAt: null,
          createdAt: t,
          updatedAt: t,
        }
        dirty[qid] = [...base, started]
        const result = await persistChunkUpdates(dirty, index)
        applyPersistResult(result)
      })
    },
    [applyPersistResult, runWrite, tasksFile],
  )

  const stopCurrent = useCallback(async () => {
    if (!eventsIndexRef.current) return
    await runWrite(async () => {
      const index = eventsIndexRef.current
      if (!index) return
      const endMs = Date.now()
      const t = nowIso(new Date(endMs))
      const dirty = closeOpenAcrossChunks(chunksRef.current, endMs, t)
      if (Object.keys(dirty).length === 0) return
      const result = await persistChunkUpdates(dirty, index)
      applyPersistResult(result)
    })
  }, [applyPersistResult, runWrite])

  const saveLogPrefs = useCallback(
    async (prefs: LogPrefs) => {
      await runWrite(async () => {
        const t = nowIso()
        const next: SettingsFile = {
          ...(settingsFile ?? { updatedAt: t }),
          log: prefs,
          updatedAt: t,
        }
        const saved = await putResource('settings', next)
        setSettingsFile(saved)
      })
    },
    [runWrite, settingsFile],
  )

  const folders = useMemo(
    () =>
      [...(tasksFile?.folders ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [tasksFile],
  )
  const tasks = useMemo(
    () => [...(tasksFile?.tasks ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [tasksFile],
  )
  const events = useMemo(() => mergeChunkEvents(chunks), [chunks])
  const hasMoreOlderEvents = useMemo(
    () => hasMoreOlderChunks(eventsIndex, chunks),
    [eventsIndex, chunks],
  )
  const current = useMemo(
    () => events.find((e) => e.endedAt === null) ?? null,
    [events],
  )
  const logPrefs = useMemo(
    () => settingsFile?.log ?? null,
    [settingsFile],
  )

  const data = useMemo<StoreData>(
    () => ({
      loading,
      error,
      folders,
      tasks,
      events,
      current,
      logPrefs,
      hasMoreOlderEvents,
    }),
    [loading, error, folders, tasks, events, current, logPrefs, hasMoreOlderEvents],
  )

  const actions = useMemo<StoreActions>(
    () => ({
      clearError,
      saveLogPrefs,
      addFolder,
      addTask,
      updateFolder,
      moveFolder,
      reorderTasks,
      updateTask,
      updateEvent,
      addEvent,
      deleteEvent,
      deleteFolder,
      deleteTask,
      startTask,
      stopCurrent,
      loadOlderEvents,
      ensureEventsForRange,
    }),
    [
      clearError,
      saveLogPrefs,
      addFolder,
      addTask,
      updateFolder,
      moveFolder,
      reorderTasks,
      updateTask,
      updateEvent,
      addEvent,
      deleteEvent,
      deleteFolder,
      deleteTask,
      startTask,
      stopCurrent,
      loadOlderEvents,
      ensureEventsForRange,
    ],
  )

  return (
    <ActionsContext.Provider value={actions}>
      <DataContext.Provider value={data}>
        <BusyContext.Provider value={busy}>{children}</BusyContext.Provider>
      </DataContext.Provider>
    </ActionsContext.Provider>
  )
}

/** 書き込み中フラグのみ。記録開始/停止で Log を巻き込みたくないとき用 */
export function useStoreBusy(): boolean {
  return useContext(BusyContext)
}

export function useStoreData(): StoreData {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('StoreProvider missing')
  return ctx
}

export function useStoreActions(): StoreActions {
  const ctx = useContext(ActionsContext)
  if (!ctx) throw new Error('StoreProvider missing')
  return ctx
}
