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
import { MIN_RECORD_MS, nowIso } from '../lib/time'
import type { Event, EventsFile, Folder, Task, TasksFile } from '../types'

type StoreValue = {
  loading: boolean
  busy: boolean
  error: string | null
  folders: Folder[]
  tasks: Task[]
  events: Event[]
  current: Event | null
  clearError: () => void
  reload: () => Promise<void>
  addFolder: (name: string, color: string) => Promise<void>
  addTask: (folderId: string, name: string, color: string) => Promise<void>
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

  const clearError = useCallback(() => setError(null), [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tasks, events] = await Promise.all([
        fetchResource('tasks'),
        fetchResource('events'),
      ])
      setTasksFile(tasks)
      setEventsFile(events)
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
        const elapsed = endMs - startMs
        if (elapsed < MIN_RECORD_MS) {
          // 破棄: next に入れない
          continue
        }
        next.push({ ...ev, endedAt: endIso, updatedAt: endIso })
      }
      return next
    },
    [],
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

  const value: StoreValue = {
    loading,
    busy,
    error,
    folders,
    tasks,
    events,
    current,
    clearError,
    reload,
    addFolder,
    addTask,
    startTask,
    stopCurrent,
  }

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  )
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('StoreProvider missing')
  return ctx
}
