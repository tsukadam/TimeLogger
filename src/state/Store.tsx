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
import {
  fetchResource,
  isOnline,
  postAdd,
  postDelete,
  postFolderDelete,
  postFolderMove,
  postFolderSave,
  postJoin,
  postStart,
  postStop,
  postTaskDelete,
  postTaskReorder,
  postTaskSave,
  postUpdate,
  putResource,
  reportDebugLog,
  WRITE_SLOW_MS,
  type TasksWriteResult,
} from '../api/client'
import { taskColorFromRef } from '../lib/color'
import { nowIso } from '../lib/time'
import type {
  Event,
  EventsFile,
  EventsIndex,
  Folder,
  LogPrefs,
  SettingsFile,
  Task,
  TaskColorRef,
  TasksFile,
} from '../types'
import {
  type ChunkMap,
  fetchBootEvents,
  hasMoreOlderChunks,
  loadChunks,
  mergeChunkEvents,
  nextOlderChunkId,
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
  addTask: (
    folderId: string,
    name: string,
    color: string,
    colorRef: TaskColorRef | null,
  ) => Promise<void>
  updateFolder: (
    folderId: string,
    patch: { name: string; color: string },
  ) => Promise<void>
  moveFolder: (folderId: string, dir: 1 | -1) => Promise<void>
  reorderTasks: (folderId: string, orderedIds: string[]) => Promise<void>
  updateTask: (
    taskId: string,
    patch: {
      name: string
      color: string
      folderId: string
      colorRef: TaskColorRef | null
    },
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
  setBoundary: (olderId: string, newerId: string, iso: string) => Promise<void>
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

  const applyCommandResult = useCallback(
    (result: {
      index: EventsIndex
      chunks: Record<string, EventsFile>
    }) => {
      eventsIndexRef.current = result.index
      setEventsIndex(result.index)
      const ids = Object.keys(result.chunks)
      if (ids.length === 0) return
      applyChunkPatch(result.chunks)
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

  const applyTasksResult = useCallback(
    (result: TasksWriteResult) => {
      setTasksFile(result.tasks)
      // task-delete が記録を閉じたときだけ index / chunks が付いてくる
      if (result.index && result.chunks) {
        applyCommandResult({ index: result.index, chunks: result.chunks })
      }
    },
    [applyCommandResult],
  )

  const addFolder = useCallback(
    async (name: string, color: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      await runWrite(async () => {
        applyTasksResult(await postFolderSave({ name: trimmed, color }))
      })
    },
    [applyTasksResult, runWrite],
  )

  const addTask = useCallback(
    async (
      folderId: string,
      name: string,
      color: string,
      colorRef: TaskColorRef | null,
    ) => {
      const trimmed = name.trim()
      if (!trimmed) return
      await runWrite(async () => {
        applyTasksResult(
          await postTaskSave({ folderId, name: trimmed, color, colorRef }),
        )
      })
    },
    [applyTasksResult, runWrite],
  )

  const updateFolder = useCallback(
    async (folderId: string, patch: { name: string; color: string }) => {
      if (!tasksFile) return
      const trimmed = patch.name.trim()
      if (!trimmed) return
      // フォルダ色を変えたら、パレット由来のタスク色を同じ座標で焼き直す。
      // 座標を持たない（自由指定の）タスクは触らない
      const old = tasksFile.folders.find((f) => f.id === folderId)
      const taskColors: Record<string, string> = {}
      if (old && old.color.toLowerCase() !== patch.color.toLowerCase()) {
        for (const task of tasksFile.tasks) {
          if (task.folderId !== folderId || !task.colorRef) continue
          const next = taskColorFromRef(patch.color, task.colorRef)
          if (next && next.toLowerCase() !== task.color.toLowerCase()) {
            taskColors[task.id] = next
          }
        }
      }
      await runWrite(async () => {
        applyTasksResult(
          await postFolderSave({
            id: folderId,
            name: trimmed,
            color: patch.color,
            ...(Object.keys(taskColors).length > 0 ? { taskColors } : {}),
          }),
        )
        // ログ（events）の名前・色スナップショットは追従しない
      })
    },
    [applyTasksResult, runWrite, tasksFile],
  )

  const moveFolder = useCallback(
    async (folderId: string, dir: 1 | -1) => {
      await runWrite(async () => {
        applyTasksResult(await postFolderMove({ folderId, dir }))
      })
    },
    [applyTasksResult, runWrite],
  )

  const reorderTasks = useCallback(
    async (folderId: string, orderedIds: string[]) => {
      if (!tasksFile) return
      const inFolder = tasksFile.tasks
        .filter((t) => t.folderId === folderId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      // 並びが同じなら投げない（並びの検査自体はサーバー側でもやる）
      if (
        orderedIds.length === inFolder.length &&
        inFolder.every((t, i) => t.id === orderedIds[i])
      ) {
        return
      }
      await runWrite(async () => {
        applyTasksResult(await postTaskReorder({ folderId, orderedIds }))
      })
    },
    [applyTasksResult, runWrite, tasksFile],
  )

  const updateTask = useCallback(
    async (
      taskId: string,
      patch: {
        name: string
        color: string
        folderId: string
        colorRef: TaskColorRef | null
      },
    ) => {
      const trimmed = patch.name.trim()
      if (!trimmed) return
      await runWrite(async () => {
        applyTasksResult(
          await postTaskSave({
            id: taskId,
            folderId: patch.folderId,
            name: trimmed,
            color: patch.color,
            colorRef: patch.colorRef,
          }),
        )
        // ログ（events）の名前・色スナップショットは追従しない
      })
    },
    [applyTasksResult, runWrite],
  )

  const deleteFolder = useCallback(
    async (folderId: string) => {
      await runWrite(async () => {
        applyTasksResult(await postFolderDelete({ folderId }))
      })
    },
    [applyTasksResult, runWrite],
  )

  const deleteTask = useCallback(
    async (taskId: string) => {
      await runWrite(async () => {
        // 記録中のタスクなら、サーバー側が同じ錠の中で記録も閉じる
        applyTasksResult(await postTaskDelete({ taskId }))
      })
    },
    [applyTasksResult, runWrite],
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
      await runWrite(async () => {
        const result = await postUpdate({
          eventId,
          taskId: patch.taskId,
          startedAt: patch.startedAt,
          endedAt: patch.endedAt,
        })
        applyCommandResult(result)
      })
    },
    [applyCommandResult, runWrite],
  )

  const addEvent = useCallback(
    async (patch: { taskId: string; startedAt: string; endedAt: string }) => {
      await runWrite(async () => {
        const result = await postAdd(patch)
        applyCommandResult(result)
      })
    },
    [applyCommandResult, runWrite],
  )

  const deleteEvent = useCallback(
    async (eventId: string) => {
      await runWrite(async () => {
        const result = await postDelete({ eventId })
        applyCommandResult(result)
      })
    },
    [applyCommandResult, runWrite],
  )

  const startTask = useCallback(
    async (taskId: string) => {
      await runWrite(async () => {
        const result = await postStart({ taskId })
        applyCommandResult(result)
      })
    },
    [applyCommandResult, runWrite],
  )

  const stopCurrent = useCallback(async () => {
    await runWrite(async () => {
      const result = await postStop()
      applyCommandResult(result)
    })
  }, [applyCommandResult, runWrite])

  /** 境界（⇔）の確定。中点を出すだけの段階では呼ばない */
  const setBoundary = useCallback(
    async (olderId: string, newerId: string, iso: string) => {
      await runWrite(async () => {
        const result = await postJoin({ olderId, newerId, at: iso })
        applyCommandResult(result)
      })
    },
    [applyCommandResult, runWrite],
  )

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
      setBoundary,
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
      setBoundary,
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
