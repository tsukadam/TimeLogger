import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchResource, isOnline, putResource } from '../api/client'
import { newId } from '../lib/id'
import { remapPaletteTaskColor } from '../lib/color'
import { elapsedMs, MIN_RECORD_MS, nowIso } from '../lib/time'
import type {
  Event,
  EventsFile,
  Folder,
  LogPrefs,
  SettingsFile,
  Task,
  TasksFile,
} from '../types'
import { validateEventRange } from './eventValidation'

type StoreValue = {
  loading: boolean
  busy: boolean
  error: string | null
  folders: Folder[]
  tasks: Task[]
  events: Event[]
  current: Event | null
  logPrefs: LogPrefs | null
  clearError: () => void
  reload: () => Promise<void>
  saveLogPrefs: (prefs: LogPrefs) => Promise<void>
  addFolder: (name: string, color: string) => Promise<void>
  addTask: (folderId: string, name: string, color: string) => Promise<void>
  updateFolder: (
    folderId: string,
    patch: { name: string; color: string },
  ) => Promise<void>
  /** フォルダを1つ上（-1）または下（+1）へ移動 */
  moveFolder: (folderId: string, dir: 1 | -1) => Promise<void>
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
}

const StoreContext = createContext<StoreValue | null>(null)

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
  const [eventsFile, setEventsFile] = useState<EventsFile | null>(null)
  const [settingsFile, setSettingsFile] = useState<SettingsFile | null>(null)

  const clearError = useCallback(() => setError(null), [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tasks, events, settings] = await Promise.all([
        fetchResource('tasks'),
        fetchResource('events'),
        fetchResource('settings'),
      ])
      setTasksFile(tasks)
      setEventsFile(events)
      setSettingsFile(settings)
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const runWrite = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      requireOnline()
      await fn()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '書き込みに失敗しました'
      setError(msg)
      throw e
    } finally {
      setBusy(false)
    }
  }, [])

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

  const persistEvents = useCallback(async (next: EventsFile) => {
    const saved = await putResource('events', next)
    setEventsFile(saved)
  }, [])

  /**
   * 記録中イベントを締める。
   * 経過 < MIN_RECORD_MS なら行ごと削除（誤タップ扱い）。
   * それ以外は endedAt を付ける。
   * 同時に複数の未終了があっても全て処理する（壊れた状態の修復も兼ねる）。
   */
  const closeOrDiscardOpen = useCallback(
    (events: Event[], endMs: number, endIso: string): Event[] => {
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
    },
    [],
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
        const open = eventsFile?.events.find((e) => e.endedAt === null)
        if (eventsFile && open && open.taskId === taskId) {
          const endMs = Date.now()
          const endIso = nowIso(new Date(endMs))
          await persistEvents({
            events: closeOrDiscardOpen(eventsFile.events, endMs, endIso),
            updatedAt: endIso,
          })
        }
      })
    },
    [closeOrDiscardOpen, eventsFile, persistEvents, runWrite, tasksFile],
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
      if (!tasksFile || !eventsFile) return
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
      validateEventRange({
        events: eventsFile.events,
        startMs,
        endMs,
        excludeId: eventId,
        nowMs,
        validateEndBound,
      })

      await runWrite(async () => {
        const t = nowIso()
        const list = [...eventsFile.events]
        const idx = list.findIndex((e) => e.id === eventId)
        if (idx < 0) throw new Error('記録が見つかりません')

        const prev = list[idx]!
        // 記録中は終了を触れない（endedAt は null のまま）
        if (prev.endedAt === null && endedAt !== null) {
          throw new Error('記録中の終了時刻は編集できません')
        }
        if (prev.endedAt !== null && endedAt === null) {
          throw new Error('終了済みの記録を記録中には戻せません')
        }

        const taskChanged = prev.taskId !== task.id
        list[idx] = {
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
        await persistEvents({ events: list, updatedAt: t })
      })
    },
    [eventsFile, persistEvents, runWrite, tasksFile],
  )

  const addEvent = useCallback(
    async (patch: { taskId: string; startedAt: string; endedAt: string }) => {
      if (!tasksFile || !eventsFile) return
      const task = tasksFile.tasks.find((x) => x.id === patch.taskId)
      if (!task) throw new Error('タスクが見つかりません')
      const folder = tasksFile.folders.find((x) => x.id === task.folderId)
      if (!folder) throw new Error('フォルダが見つかりません')

      const startMs = new Date(patch.startedAt).getTime()
      const endMs = new Date(patch.endedAt).getTime()
      validateEventRange({
        events: eventsFile.events,
        startMs,
        endMs,
        excludeId: null,
        nowMs: Date.now(),
        validateEndBound: true,
      })

      await runWrite(async () => {
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
        await persistEvents({
          events: [...eventsFile.events, ev],
          updatedAt: t,
        })
      })
    },
    [eventsFile, persistEvents, runWrite, tasksFile],
  )

  const deleteEvent = useCallback(
    async (eventId: string) => {
      if (!eventsFile) return
      await runWrite(async () => {
        const t = nowIso()
        await persistEvents({
          events: eventsFile.events.filter((e) => e.id !== eventId),
          updatedAt: t,
        })
      })
    },
    [eventsFile, persistEvents, runWrite],
  )

  const startTask = useCallback(
    async (taskId: string) => {
      if (!tasksFile || !eventsFile) return
      const task = tasksFile.tasks.find((x) => x.id === taskId)
      if (!task) return
      const folder = tasksFile.folders.find((x) => x.id === task.folderId)
      if (!folder) return

      await runWrite(async () => {
        const endMs = Date.now()
        const t = nowIso(new Date(endMs))
        const closed = closeOrDiscardOpen(eventsFile.events, endMs, t)
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
        await persistEvents({
          events: [...closed, started],
          updatedAt: t,
        })
      })
    },
    [closeOrDiscardOpen, eventsFile, persistEvents, runWrite, tasksFile],
  )

  const stopCurrent = useCallback(async () => {
    if (!eventsFile) return
    await runWrite(async () => {
      const endMs = Date.now()
      const t = nowIso(new Date(endMs))
      const events = closeOrDiscardOpen(eventsFile.events, endMs, t)
      await persistEvents({ events, updatedAt: t })
    })
  }, [closeOrDiscardOpen, eventsFile, persistEvents, runWrite])

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
  const events = useMemo(() => {
    const list = [...(eventsFile?.events ?? [])]
    return list.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
  }, [eventsFile])
  const current = useMemo(
    () => events.find((e) => e.endedAt === null) ?? null,
    [events],
  )
  const logPrefs = useMemo(
    () => settingsFile?.log ?? null,
    [settingsFile],
  )

  const value = useMemo<StoreValue>(
    () => ({
      loading,
      busy,
      error,
      folders,
      tasks,
      events,
      current,
      logPrefs,
      clearError,
      reload,
      saveLogPrefs,
      addFolder,
      addTask,
      updateFolder,
      moveFolder,
      updateTask,
      updateEvent,
      addEvent,
      deleteEvent,
      deleteFolder,
      deleteTask,
      startTask,
      stopCurrent,
    }),
    [
      loading,
      busy,
      error,
      folders,
      tasks,
      events,
      current,
      logPrefs,
      clearError,
      reload,
      saveLogPrefs,
      addFolder,
      addTask,
      updateFolder,
      moveFolder,
      updateTask,
      updateEvent,
      addEvent,
      deleteEvent,
      deleteFolder,
      deleteTask,
      startTask,
      stopCurrent,
    ],
  )

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  )
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('StoreProvider missing')
  return ctx
}
