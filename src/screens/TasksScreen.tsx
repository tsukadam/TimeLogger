import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import { ErrorBanner } from '../components/ErrorBanner'
import { FolderIcon } from '../components/FolderIcon'
import { FolderSelect } from '../components/FolderSelect'
import { Modal } from '../components/Modal'
import { Spinner } from '../components/Spinner'
import spinnerStyles from '../components/Spinner.module.css'
import {
  TaskColorPicker,
  type PalettePos,
} from '../components/TaskColorPicker'
import form from '../components/form.module.css'
import chrome from '../components/screenChrome.module.css'
import { FOLDER_PALETTE, TASK_BASE_CELL, findTaskColorPos, taskColorGrid } from '../lib/color'
import {
  durationLabel,
  formatDurationHms,
  overlapSecondsOnDay,
  todayKey,
} from '../lib/time'
import { useNowTick } from '../lib/useNowTick'
import { useScrollLock } from '../lib/useScrollLock'
import {
  useStoreActions,
  useStoreBusy,
  useStoreData,
} from '../state/Store'
import type { Folder, Task } from '../types'
import styles from './TasksScreen.module.css'

type AddTarget = 'folder' | 'task'

type Sheet =
  | { type: 'closed' }
  | { type: 'add' }
  // フォルダ固定のタスク追加（種別・フォルダ選択なし）
  | { type: 'add-task-in'; folderId: string }
  | { type: 'edit-folder'; id: string }
  | { type: 'edit-task'; id: string }

type TaskDrag = {
  folderId: string
  taskId: string
  order: string[]
}

const LONG_PRESS_MS = 420
const PRESS_MOVE_CANCEL_PX = 10

/**
 * ポインタ位置からドロップ先スロットを決める。
 * FLIP アニメ中の transform に左右されないよう、getBoundingClientRect ではなく
 * offsetTop（transform 非依存の静的レイアウト位置）でスロット範囲を判定する。
 */
function reorderIdsByClientY(
  order: string[],
  taskId: string,
  clientY: number,
  listEl: HTMLElement,
): string[] {
  const rows = [
    ...listEl.querySelectorAll<HTMLElement>(':scope > [data-task-id]'),
  ]
  if (rows.length === 0) return order
  // offsetTop は positioned 祖先基準なので、先頭行を 0 とする相対値に直す
  const base = rows[0]!.offsetTop
  const y = clientY - listEl.getBoundingClientRect().top
  let target = rows.length - 1
  for (let i = 0; i < rows.length; i++) {
    const el = rows[i]!
    if (y < el.offsetTop - base + el.offsetHeight) {
      target = i
      break
    }
  }
  const from = order.indexOf(taskId)
  if (from < 0 || from === target) return order
  const next = [...order]
  next.splice(from, 1)
  next.splice(target, 0, taskId)
  return next
}

export function TasksScreen() {
  const busy = useStoreBusy()
  const { loading, error, folders, tasks, events, current } = useStoreData()
  const {
    clearError,
    addFolder,
    addTask,
    updateFolder,
    moveFolder,
    reorderTasks,
    updateTask,
    startTask,
    stopCurrent,
    deleteFolder,
    deleteTask,
  } = useStoreActions()

  const [sheet, setSheet] = useState<Sheet>({ type: 'closed' })
  const [addTarget, setAddTarget] = useState<AddTarget>('folder')
  const [name, setName] = useState('')
  const [color, setColor] = useState(FOLDER_PALETTE[0]!)
  const [folderId, setFolderId] = useState('')
  const [pickerFill, setPickerFill] = useState<string | null>(null)
  const [colorFrom, setColorFrom] = useState<'palette' | 'picker'>('palette')
  const [palettePos, setPalettePos] = useState<PalettePos | null>({
    kind: 'folder',
    index: 0,
  })
  /** 録画開始/停止の通信中（押したタスクのボタンにスピナー） */
  const [pendingRecId, setPendingRecId] = useState<string | null>(null)
  /** シートの Save/Add / 削除の通信中 */
  const [pendingSheet, setPendingSheet] = useState<'save' | 'delete' | null>(
    null,
  )
  const [taskDrag, setTaskDrag] = useState<TaskDrag | null>(null)
  const [dragPulseId, setDragPulseId] = useState<string | null>(null)
  const requestCloseRef = useRef<() => void>(() => {})
  const taskDragRef = useRef<TaskDrag | null>(null)
  const pressTimerRef = useRef<number | null>(null)
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const suppressTaskClickRef = useRef(false)
  const dragListRef = useRef<HTMLElement | null>(null)
  const dragStartOrderRef = useRef<string[] | null>(null)

  // ドラッグ中はページスクロールを完全に止める。
  // touch-action の変更は進行中のジェスチャーに効かないため、
  // 非パッシブ touchmove の preventDefault で止めるのが確実
  const dragActive = taskDrag !== null
  useScrollLock(dragActive)
  useEffect(() => {
    if (!dragActive) return
    const prevent = (e: TouchEvent) => e.preventDefault()
    document.addEventListener('touchmove', prevent, { passive: false })
    return () => document.removeEventListener('touchmove', prevent)
  }, [dragActive])

  const sheetOpen = sheet.type !== 'closed'
  const isEdit = sheet.type === 'edit-folder' || sheet.type === 'edit-task'
  const now = useNowTick(current !== null)

  useEffect(() => {
    if (!folderId && folders[0]) setFolderId(folders[0].id)
  }, [folderId, folders])

  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === folderId) ?? null,
    [folderId, folders],
  )

  const taskGrid = useMemo(() => {
    if (!selectedFolder) return null
    return taskColorGrid(selectedFolder.color)
  }, [selectedFolder])

  useEffect(() => {
    if (!sheetOpen || addTarget !== 'task' || !taskGrid) return
    if (colorFrom === 'picker') {
      if (pickerFill) setColor(pickerFill)
      return
    }
    if (palettePos?.kind === 'task') {
      const next = taskGrid[palettePos.row]?.[palettePos.col]
      if (next) setColor(next)
    }
  }, [sheetOpen, addTarget, taskGrid, colorFrom, pickerFill, palettePos])

  const day = todayKey(new Date(now))

  const todaySecByTask = useMemo(() => {
    const map = new Map<string, number>()
    for (const ev of events) {
      const sec = overlapSecondsOnDay(ev.startedAt, ev.endedAt, day, now)
      if (sec <= 0) continue
      map.set(ev.taskId, (map.get(ev.taskId) ?? 0) + sec)
    }
    return map
  }, [events, day, now])

  const byFolder = useMemo(() => {
    return folders.map((folder) => ({
      folder,
      tasks: tasks.filter((t) => t.folderId === folder.id),
    }))
  }, [folders, tasks])

  // フォルダ並び替え時、各セクションが元の位置から滑って移動するように（FLIP）
  const rootRef = useRef<HTMLElement | null>(null)
  const folderTopsRef = useRef<Map<string, number>>(new Map())
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const prev = folderTopsRef.current
    const next = new Map<string, number>()
    root.querySelectorAll<HTMLElement>('[data-folder-id]').forEach((el) => {
      const id = el.dataset.folderId
      if (!id) return
      const top = el.offsetTop
      next.set(id, top)
      const old = prev.get(id)
      if (old !== undefined && Math.abs(old - top) > 1) {
        el.animate(
          [{ transform: `translateY(${old - top}px)` }, { transform: 'none' }],
          { duration: 220, easing: 'ease' },
        )
      }
    })
    folderTopsRef.current = next
  }, [folders])

  // タスク並び替え中の FLIP（ドラッグ中の行自体は動かさない）
  const taskTopsRef = useRef<Map<string, number>>(new Map())
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const prev = taskTopsRef.current
    const next = new Map<string, number>()
    root.querySelectorAll<HTMLElement>('[data-task-id]').forEach((el) => {
      const id = el.dataset.taskId
      if (!id) return
      const top = el.offsetTop
      next.set(id, top)
      if (taskDragRef.current?.taskId === id) return
      const old = prev.get(id)
      if (old !== undefined && Math.abs(old - top) > 1) {
        el.animate(
          [{ transform: `translateY(${old - top}px)` }, { transform: 'none' }],
          { duration: 180, easing: 'ease' },
        )
      }
    })
    taskTopsRef.current = next
  }, [tasks, taskDrag])

  function clearPressTimer() {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
    pressOriginRef.current = null
  }

  function finishTaskDrag(commit: boolean) {
    const drag = taskDragRef.current
    const start = dragStartOrderRef.current
    clearPressTimer()
    dragListRef.current = null
    dragStartOrderRef.current = null
    setDragPulseId(null)
    if (!commit || !drag || !start) {
      taskDragRef.current = null
      setTaskDrag(null)
      return
    }
    const changed = drag.order.some((id, i) => id !== start[i])
    if (!changed) {
      taskDragRef.current = null
      setTaskDrag(null)
      return
    }
    void (async () => {
      try {
        await reorderTasks(drag.folderId, drag.order)
      } catch {
        /* Store が表示 */
      } finally {
        taskDragRef.current = null
        setTaskDrag(null)
      }
    })()
  }

  function beginTaskDrag(
    folderId: string,
    taskId: string,
    order: string[],
    listEl: HTMLElement,
  ) {
    const drag: TaskDrag = { folderId, taskId, order: [...order] }
    taskDragRef.current = drag
    dragListRef.current = listEl
    dragStartOrderRef.current = [...order]
    suppressTaskClickRef.current = true
    setTaskDrag(drag)
    setDragPulseId(taskId)
    window.setTimeout(() => {
      setDragPulseId((cur) => (cur === taskId ? null : cur))
    }, 300)
    try {
      navigator.vibrate?.(14)
    } catch {
      /* ignore */
    }
  }

  function onTaskCardPointerDown(
    e: PointerEvent<HTMLButtonElement>,
    folderId: string,
    taskId: string,
    order: string[],
    listEl: HTMLUListElement | null,
  ) {
    if (busy || e.button !== 0 || order.length < 2 || !listEl) return
    if (taskDragRef.current) return
    clearPressTimer()
    pressOriginRef.current = { x: e.clientX, y: e.clientY }
    const pointerId = e.pointerId
    const target = e.currentTarget
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null
      beginTaskDrag(folderId, taskId, order, listEl)
      try {
        target.setPointerCapture(pointerId)
      } catch {
        /* ignore */
      }
    }, LONG_PRESS_MS)
  }

  function onTaskCardPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const origin = pressOriginRef.current
    if (pressTimerRef.current !== null && origin) {
      const dx = e.clientX - origin.x
      const dy = e.clientY - origin.y
      if (dx * dx + dy * dy > PRESS_MOVE_CANCEL_PX * PRESS_MOVE_CANCEL_PX) {
        clearPressTimer()
      }
      return
    }
    const drag = taskDragRef.current
    const listEl = dragListRef.current
    if (!drag || !listEl) return
    e.preventDefault()
    const nextOrder = reorderIdsByClientY(
      drag.order,
      drag.taskId,
      e.clientY,
      listEl,
    )
    if (nextOrder === drag.order) return
    const next = { ...drag, order: nextOrder }
    taskDragRef.current = next
    setTaskDrag(next)
  }

  function onTaskCardPointerUp() {
    if (taskDragRef.current) {
      finishTaskDrag(true)
      return
    }
    clearPressTimer()
  }

  function onTaskCardClick(task: Task, e: MouseEvent<HTMLButtonElement>) {
    if (suppressTaskClickRef.current) {
      e.preventDefault()
      suppressTaskClickRef.current = false
      return
    }
    openEditTask(task)
  }

  // 記録中タスクが画面外にあるとき、上下どちらにあるかを示す
  const runningTaskId = current?.taskId ?? null
  const [runningOff, setRunningOff] = useState<'above' | 'below' | null>(null)

  useEffect(() => {
    if (!runningTaskId) {
      setRunningOff(null)
      return
    }
    const el = document.querySelector(`[data-task-id="${runningTaskId}"]`)
    if (!el) {
      setRunningOff(null)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1]
        if (!e) return
        if (e.isIntersecting) {
          setRunningOff(null)
        } else {
          setRunningOff(
            e.boundingClientRect.top < window.innerHeight / 2
              ? 'above'
              : 'below',
          )
        }
      },
      { threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [runningTaskId, folders, tasks])

  const scrollToRunning = () => {
    if (!runningTaskId) return
    document
      .querySelector(`[data-task-id="${runningTaskId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function closeSheet() {
    setSheet({ type: 'closed' })
    setName('')
  }

  function openAdd() {
    const kind: AddTarget = folders.length === 0 ? 'folder' : 'task'
    setAddTarget(kind)
    setName('')
    setFolderId(folders[0]?.id ?? '')
    setPickerFill(null)
    setColorFrom('palette')
    if (kind === 'folder') {
      setPalettePos({ kind: 'folder', index: 0 })
      setColor(FOLDER_PALETTE[0]!)
    } else {
      setPalettePos({
        kind: 'task',
        row: TASK_BASE_CELL.row,
        col: TASK_BASE_CELL.col,
      })
      setColor(folders[0]?.color ?? FOLDER_PALETTE[0]!)
    }
    setSheet({ type: 'add' })
  }

  function openAddTaskIn(folder: Folder) {
    setAddTarget('task')
    setName('')
    setFolderId(folder.id)
    setPickerFill(null)
    setColorFrom('palette')
    setPalettePos({
      kind: 'task',
      row: TASK_BASE_CELL.row,
      col: TASK_BASE_CELL.col,
    })
    setColor(folder.color)
    setSheet({ type: 'add-task-in', folderId: folder.id })
  }

  function openEditFolder(folder: Folder) {
    setAddTarget('folder')
    setName(folder.name)
    setColor(folder.color)
    setPickerFill(null)
    const idx = FOLDER_PALETTE.findIndex(
      (c) => c.toLowerCase() === folder.color.toLowerCase(),
    )
    if (idx >= 0) {
      setColorFrom('palette')
      setPalettePos({ kind: 'folder', index: idx })
    } else {
      setColorFrom('picker')
      setPickerFill(folder.color)
      setPalettePos({ kind: 'folder', index: 0 })
    }
    setSheet({ type: 'edit-folder', id: folder.id })
  }

  function openEditTask(task: Task) {
    setAddTarget('task')
    setName(task.name)
    setFolderId(task.folderId)
    setColor(task.color)
    const folder = folders.find((f) => f.id === task.folderId)
    const pos = folder ? findTaskColorPos(folder.color, task.color) : null
    if (pos) {
      setColorFrom('palette')
      setPalettePos({ kind: 'task', row: pos.row, col: pos.col })
      setPickerFill(null)
    } else {
      setColorFrom('picker')
      setPickerFill(task.color)
      setPalettePos({
        kind: 'task',
        row: TASK_BASE_CELL.row,
        col: TASK_BASE_CELL.col,
      })
    }
    setSheet({ type: 'edit-task', id: task.id })
  }

  function selectPaletteColor(c: string, pos: PalettePos) {
    setColor(c)
    setColorFrom('palette')
    setPalettePos(pos)
  }

  function pickCustomColor(c: string) {
    setColor(c)
    setPickerFill(c)
    setColorFrom('picker')
  }

  async function submitSheet() {
    const trimmed = name.trim()
    if (!trimmed) return
    setPendingSheet('save')
    try {
      if (sheet.type === 'add') {
        if (addTarget === 'folder') await addFolder(trimmed, color)
        else {
          if (!folderId) return
          await addTask(folderId, trimmed, color)
        }
      } else if (sheet.type === 'add-task-in') {
        await addTask(sheet.folderId, trimmed, color)
      } else if (sheet.type === 'edit-folder') {
        await updateFolder(sheet.id, { name: trimmed, color })
      } else if (sheet.type === 'edit-task') {
        if (!folderId) return
        await updateTask(sheet.id, {
          name: trimmed,
          color,
          folderId,
        })
      }
      requestCloseRef.current()
    } catch {
      /* Store が表示 */
    } finally {
      setPendingSheet(null)
    }
  }

  async function submitDelete() {
    if (sheet.type === 'edit-folder') {
      if (tasks.some((t) => t.folderId === sheet.id)) return
      if (!window.confirm('このフォルダを削除しますか？')) return
      setPendingSheet('delete')
      try {
        await deleteFolder(sheet.id)
        requestCloseRef.current()
      } catch {
        /* Store が表示 */
      } finally {
        setPendingSheet(null)
      }
      return
    }
    if (sheet.type === 'edit-task') {
      if (!window.confirm('このタスクを削除しますか？（過去の記録は残ります）'))
        return
      setPendingSheet('delete')
      try {
        await deleteTask(sheet.id)
        requestCloseRef.current()
      } catch {
        /* Store が表示 */
      } finally {
        setPendingSheet(null)
      }
    }
  }

  const folderDeleteBlocked =
    sheet.type === 'edit-folder' &&
    tasks.some((t) => t.folderId === sheet.id)

  if (loading) {
    return <p className={chrome.status}>Loading...</p>
  }

  return (
    <section className={styles.root} ref={rootRef}>
      {error && <ErrorBanner message={error} onDismiss={clearError} />}

      {runningOff === 'above' && (
        <div className={styles.stickyTop}>
          <button
            type="button"
            className={styles.runningPill}
            onClick={scrollToRunning}
          >
            ↑ 1 task running
          </button>
        </div>
      )}

      {byFolder.map(({ folder, tasks: folderTasks }, index) => (
        <section
          key={folder.id}
          className={styles.folderSection}
          data-folder-id={folder.id}
        >
          {index > 0 && <div className={styles.divider} />}
          <div className={styles.folderRow}>
            <button
              type="button"
              className={styles.folderHead}
              onClick={() => openEditFolder(folder)}
            >
              <FolderIcon color={folder.color} size={16} />
              <h2 className={styles.folderName}>{folder.name}</h2>
            </button>
            <div className={styles.folderOrder}>
              <button
                type="button"
                className={styles.orderBtn}
                disabled={busy || index === 0}
                aria-label={`${folder.name} を上へ`}
                onClick={() => void moveFolder(folder.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.orderBtn}
                disabled={busy || index === byFolder.length - 1}
                aria-label={`${folder.name} を下へ`}
                onClick={() => void moveFolder(folder.id, 1)}
              >
                ↓
              </button>
            </div>
          </div>

          {folderTasks.length === 0 && (
            <button
              type="button"
              className={styles.addTaskInFolder}
              disabled={busy}
              aria-label={`${folder.name} にタスクを追加`}
              onClick={() => openAddTaskIn(folder)}
            >
              ＋
            </button>
          )}
          <ul
            className={`${styles.taskList}${
              taskDrag?.folderId === folder.id ? ` ${styles.taskListDragging}` : ''
            }`}
            ref={(el) => {
              if (taskDrag?.folderId === folder.id) dragListRef.current = el
            }}
          >
            {(taskDrag?.folderId === folder.id
              ? taskDrag.order
                  .map((id) => folderTasks.find((t) => t.id === id))
                  .filter((t): t is Task => t != null)
              : folderTasks
            ).map((task) => {
              const running = current?.taskId === task.id
              const todaySec = todaySecByTask.get(task.id) ?? 0
              const recPending = pendingRecId === task.id
              const dragging = taskDrag?.taskId === task.id
              const pulsing = dragPulseId === task.id
              const orderIds = folderTasks.map((t) => t.id)
              return (
                <li
                  key={task.id}
                  className={[
                    styles.taskRow,
                    dragging ? styles.taskRowDragging : '',
                    pulsing ? styles.taskRowPulse : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-task-id={task.id}
                >
                  <button
                    type="button"
                    className={`${running ? styles.recStop : styles.recStart}${
                      recPending ? ` ${spinnerStyles.busyBtn}` : ''
                    }`}
                    disabled={busy || taskDrag !== null}
                    aria-label={running ? '記録停止' : '記録開始'}
                    aria-busy={recPending}
                    onClick={(e) => {
                      e.stopPropagation()
                      void (async () => {
                        setPendingRecId(task.id)
                        try {
                          if (running) await stopCurrent()
                          else await startTask(task.id)
                        } catch {
                          /* Store が表示 */
                        } finally {
                          setPendingRecId(null)
                        }
                      })()
                    }}
                  >
                    {recPending ? (
                      <span className={styles.recSpinner}>
                        <Spinner size={18} />
                      </span>
                    ) : (
                      <>
                        <span
                          className={running ? styles.square : styles.triangle}
                        />
                        {running && current && (
                          <span className={styles.elapsedInBtn}>
                            {durationLabel(current.startedAt, null, now)}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className={styles.taskCard}
                    onPointerDown={(e) => {
                      const list = e.currentTarget.closest('ul')
                      onTaskCardPointerDown(
                        e,
                        folder.id,
                        task.id,
                        orderIds,
                        list instanceof HTMLUListElement ? list : null,
                      )
                    }}
                    onPointerMove={onTaskCardPointerMove}
                    onPointerUp={onTaskCardPointerUp}
                    onPointerCancel={onTaskCardPointerUp}
                    onContextMenu={(e) => {
                      if (taskDragRef.current || pressTimerRef.current !== null) {
                        e.preventDefault()
                      }
                    }}
                    onClick={(e) => onTaskCardClick(task, e)}
                  >
                    <span
                      className={chrome.swatch}
                      style={{ background: task.color }}
                      aria-hidden
                    />
                    <div className={styles.taskBody}>
                      <div className={styles.taskName}>{task.name}</div>
                    </div>
                    {todaySec > 0 && (
                      <div className={styles.todayTotal}>
                        {formatDurationHms(todaySec)}
                      </div>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {byFolder.length === 0 && (
        <p className={styles.hint}>＋ からフォルダを追加</p>
      )}

      {runningOff === 'below' && (
        <div className={styles.stickyBottom}>
          <button
            type="button"
            className={styles.runningPill}
            onClick={scrollToRunning}
          >
            ↓ 1 task running
          </button>
        </div>
      )}

      <div className={chrome.addBar}>
        <button
          type="button"
          className={chrome.plus}
          aria-label="追加"
          disabled={busy}
          onClick={openAdd}
        >
          ＋
        </button>
      </div>

      <Modal
        open={sheetOpen}
        onClose={closeSheet}
        aria-label={isEdit ? '編集' : '追加'}
        wide
      >
        {({ requestClose }) => {
          requestCloseRef.current = requestClose
          return (
            <>
              {sheet.type === 'add' && (
                <div className={styles.addTargetRow}>
                  <button
                    type="button"
                    className={
                      addTarget === 'folder' ? styles.addTargetActive : styles.addTarget
                    }
                    onClick={() => {
                      setAddTarget('folder')
                      selectPaletteColor(FOLDER_PALETTE[0]!, {
                        kind: 'folder',
                        index: 0,
                      })
                    }}
                  >
                    フォルダ
                  </button>
                  <button
                    type="button"
                    className={
                      addTarget === 'task' ? styles.addTargetActive : styles.addTarget
                    }
                    disabled={folders.length === 0}
                    onClick={() => {
                      setAddTarget('task')
                      if (colorFrom === 'picker' && pickerFill) {
                        setColor(pickerFill)
                        return
                      }
                      setColorFrom('palette')
                      setPalettePos({
                        kind: 'task',
                        row: TASK_BASE_CELL.row,
                        col: TASK_BASE_CELL.col,
                      })
                      const f =
                        folders.find((x) => x.id === folderId) ?? folders[0]
                      if (f) setColor(f.color)
                    }}
                  >
                    タスク
                  </button>
                </div>
              )}

              {isEdit && (
                <h2 className={form.sheetTitle}>
                  {sheet.type === 'edit-folder'
                    ? 'フォルダを編集'
                    : 'タスクを編集'}
                </h2>
              )}

              {addTarget === 'task' && sheet.type !== 'add-task-in' && (
                <div className={form.field}>
                  <span>フォルダ</span>
                  <FolderSelect
                    folders={folders}
                    value={folderId}
                    disabled={busy}
                    onChange={(id) => setFolderId(id)}
                  />
                </div>
              )}

              <label className={form.field}>
                <span>名前</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={addTarget === 'folder' ? 'フォルダ名' : 'タスク名'}
                  disabled={busy}
                />
              </label>

              <div className={form.field}>
                <span>色</span>
                <TaskColorPicker
                  mode={addTarget}
                  colorFrom={colorFrom}
                  palettePos={palettePos}
                  pickerFill={color}
                  taskGrid={taskGrid}
                  onSelectPalette={selectPaletteColor}
                  onPickCustom={pickCustomColor}
                />
              </div>

              <div className={form.sheetActions}>
                {isEdit && (
                  <button
                    type="button"
                    className={`${form.danger}${
                      pendingSheet === 'delete'
                        ? ` ${spinnerStyles.busyBtn}`
                        : ''
                    }`}
                    disabled={busy || folderDeleteBlocked}
                    aria-busy={pendingSheet === 'delete'}
                    title={
                      folderDeleteBlocked
                        ? 'タスクがあるフォルダは削除できません'
                        : undefined
                    }
                    onClick={() => void submitDelete()}
                  >
                    {pendingSheet === 'delete' ? (
                      <Spinner size={14} />
                    ) : (
                      '削除'
                    )}
                  </button>
                )}
                <div className={form.sheetActionsRight}>
                  <button
                    type="button"
                    className={`${form.primary}${
                      pendingSheet === 'save' ? ` ${spinnerStyles.busyBtn}` : ''
                    }`}
                    disabled={
                      busy ||
                      !name.trim() ||
                      (addTarget === 'task' && !folderId)
                    }
                    aria-busy={pendingSheet === 'save'}
                    onClick={() => void submitSheet()}
                  >
                    {pendingSheet === 'save' ? (
                      <Spinner size={14} />
                    ) : isEdit ? (
                      'Save'
                    ) : (
                      'Add'
                    )}
                  </button>
                </div>
              </div>
            </>
          )
        }}
      </Modal>
    </section>
  )
}
