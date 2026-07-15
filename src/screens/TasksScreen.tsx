import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderIcon } from '../components/FolderIcon'
import { FolderSelect } from '../components/FolderSelect'
import { FOLDER_PALETTE, TASK_BASE_CELL, findTaskColorPos, taskColorGrid } from '../lib/color'
import {
  durationLabel,
  formatDurationHms,
  overlapSecondsOnDay,
  todayKey,
} from '../lib/time'
import { useStore } from '../state/Store'
import type { Folder, Task } from '../types'
import styles from './TasksScreen.module.css'

type AddKind = 'folder' | 'task'
type PalettePos =
  | { kind: 'task'; row: number; col: number }
  | { kind: 'folder'; index: number }

type Sheet =
  | { type: 'closed' }
  | { type: 'add' }
  // フォルダ固定のタスク追加（種別・フォルダ選択なし）
  | { type: 'add-task-in'; folderId: string }
  | { type: 'edit-folder'; id: string }
  | { type: 'edit-task'; id: string }

function ColorPickerButton({
  fill,
  selected,
  onPick,
}: {
  fill: string | null
  selected: boolean
  onPick: (c: string) => void
}) {
  const filled = fill !== null && /^#[0-9a-fA-F]{6}$/.test(fill)
  return (
    <label
      className={[
        styles.pickerWrap,
        filled ? styles.pickerFilled : styles.pickerEmpty,
        selected ? styles.colorActive : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title="自由に選ぶ"
      style={filled ? { background: fill } : undefined}
      onPointerDown={() => {
        if (fill) onPick(fill)
      }}
    >
      <span
        className={filled ? styles.pickerFaceOnColor : styles.pickerFace}
        aria-hidden
      >
        ＋
      </span>
      <input
        type="color"
        className={styles.pickerInput}
        value={filled ? fill : '#e08a3c'}
        onChange={(e) => onPick(e.target.value)}
        aria-label="カラーピッカー"
      />
    </label>
  )
}

export function TasksScreen() {
  const {
    loading,
    busy,
    error,
    folders,
    tasks,
    events,
    current,
    clearError,
    addFolder,
    addTask,
    updateFolder,
    updateTask,
    startTask,
    stopCurrent,
    deleteFolder,
    deleteTask,
  } = useStore()

  const [now, setNow] = useState(() => Date.now())
  const [sheet, setSheet] = useState<Sheet>({ type: 'closed' })
  const [addKind, setAddKind] = useState<AddKind>('folder')
  const [name, setName] = useState('')
  const [color, setColor] = useState(FOLDER_PALETTE[0]!)
  const [folderId, setFolderId] = useState('')
  const [pickerFill, setPickerFill] = useState<string | null>(null)
  const [colorFrom, setColorFrom] = useState<'palette' | 'picker'>('palette')
  const [palettePos, setPalettePos] = useState<PalettePos | null>({
    kind: 'folder',
    index: 0,
  })

  const sheetOpen = sheet.type !== 'closed'
  const isEdit = sheet.type === 'edit-folder' || sheet.type === 'edit-task'

  useEffect(() => {
    if (!current) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [current])

  useEffect(() => {
    if (!sheetOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [sheetOpen])

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
    if (!sheetOpen || addKind !== 'task' || !taskGrid) return
    if (colorFrom === 'picker') {
      if (pickerFill) setColor(pickerFill)
      return
    }
    if (palettePos?.kind === 'task') {
      const next = taskGrid[palettePos.row]?.[palettePos.col]
      if (next) setColor(next)
    }
  }, [sheetOpen, addKind, taskGrid, colorFrom, pickerFill, palettePos])

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
    const kind: AddKind = folders.length === 0 ? 'folder' : 'task'
    setAddKind(kind)
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
    setAddKind('task')
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
    setAddKind('folder')
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
    setAddKind('task')
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
    try {
      if (sheet.type === 'add') {
        if (addKind === 'folder') await addFolder(trimmed, color)
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
      closeSheet()
    } catch {
      /* Store が表示 */
    }
  }

  async function submitDelete() {
    if (sheet.type === 'edit-folder') {
      if (tasks.some((t) => t.folderId === sheet.id)) return
      if (!window.confirm('このフォルダを削除しますか？')) return
      try {
        await deleteFolder(sheet.id)
        closeSheet()
      } catch {
        /* Store が表示 */
      }
      return
    }
    if (sheet.type === 'edit-task') {
      if (!window.confirm('このタスクを削除しますか？（過去の記録は残ります）'))
        return
      try {
        await deleteTask(sheet.id)
        closeSheet()
      } catch {
        /* Store が表示 */
      }
    }
  }

  const folderDeleteBlocked =
    sheet.type === 'edit-folder' &&
    tasks.some((t) => t.folderId === sheet.id)

  if (loading) {
    return <p className={styles.status}>読み込み中…</p>
  }

  return (
    <section className={styles.root}>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={clearError}>
            閉じる
          </button>
        </div>
      )}

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
        <section key={folder.id} className={styles.folderSection}>
          {index > 0 && <div className={styles.divider} />}
          <button
            type="button"
            className={styles.folderHead}
            onClick={() => openEditFolder(folder)}
          >
            <FolderIcon color={folder.color} size={16} />
            <h2 className={styles.folderName}>{folder.name}</h2>
          </button>

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
          <ul className={styles.taskList}>
            {folderTasks.map((task) => {
              const running = current?.taskId === task.id
              const todaySec = todaySecByTask.get(task.id) ?? 0
              return (
                <li key={task.id} className={styles.taskRow} data-task-id={task.id}>
                  <button
                    type="button"
                    className={running ? styles.recStop : styles.recStart}
                    disabled={busy}
                    aria-label={running ? '記録停止' : '記録開始'}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (running) void stopCurrent()
                      else void startTask(task.id)
                    }}
                  >
                    <span className={running ? styles.square : styles.triangle} />
                    {running && current && (
                      <span className={styles.elapsedInBtn}>
                        {durationLabel(current.startedAt, null, now)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={styles.taskCard}
                    onClick={() => openEditTask(task)}
                  >
                    <span
                      className={styles.swatchDot}
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

      <div className={styles.addBar}>
        <button
          type="button"
          className={styles.plus}
          aria-label="追加"
          disabled={busy}
          onClick={openAdd}
        >
          ＋
        </button>
      </div>

      {sheetOpen &&
        createPortal(
        <div className={styles.modalRoot}>
          <button
            type="button"
            className={styles.modalBackdrop}
            aria-label="閉じる"
            onClick={closeSheet}
          />
          <div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? '編集' : '追加'}
          >
          {sheet.type === 'add' && (
            <div className={styles.kindRow}>
              <button
                type="button"
                className={addKind === 'folder' ? styles.kindActive : styles.kind}
                onClick={() => {
                  setAddKind('folder')
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
                className={addKind === 'task' ? styles.kindActive : styles.kind}
                disabled={folders.length === 0}
                onClick={() => {
                  setAddKind('task')
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
                  const f = folders.find((x) => x.id === folderId) ?? folders[0]
                  if (f) setColor(f.color)
                }}
              >
                タスク
              </button>
            </div>
          )}

          {isEdit && (
            <h2 className={styles.sheetTitle}>
              {sheet.type === 'edit-folder' ? 'フォルダを編集' : 'タスクを編集'}
            </h2>
          )}

          {addKind === 'task' && sheet.type !== 'add-task-in' && (
            <div className={styles.field}>
              <span>フォルダ</span>
              <FolderSelect
                folders={folders}
                value={folderId}
                disabled={busy}
                onChange={(id) => setFolderId(id)}
              />
            </div>
          )}

          <label className={styles.field}>
            <span>名前</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={addKind === 'folder' ? 'フォルダ名' : 'タスク名'}
              disabled={busy}
            />
          </label>

          <div className={styles.field}>
            <span>色</span>
            {addKind === 'folder' ? (
              <div className={styles.colors}>
                {FOLDER_PALETTE.map((c, index) => {
                  const selected =
                    colorFrom === 'palette' &&
                    palettePos?.kind === 'folder' &&
                    palettePos.index === index
                  return (
                    <button
                      key={c}
                      type="button"
                      className={selected ? styles.colorActive : styles.color}
                      style={{ background: c }}
                      aria-label={c}
                      onClick={() =>
                        selectPaletteColor(c, { kind: 'folder', index })
                      }
                    />
                  )
                })}
                <ColorPickerButton
                  fill={pickerFill}
                  selected={colorFrom === 'picker'}
                  onPick={pickCustomColor}
                />
              </div>
            ) : (
              taskGrid && (
                <div className={styles.colorGridWrap}>
                  <div
                    className={styles.colorGrid}
                    role="listbox"
                    aria-label="タスク色"
                  >
                    {taskGrid.flatMap((row, ri) =>
                      row.map((c, ci) => {
                        const isBase =
                          ri === TASK_BASE_CELL.row && ci === TASK_BASE_CELL.col
                        const selected =
                          colorFrom === 'palette' &&
                          palettePos?.kind === 'task' &&
                          palettePos.row === ri &&
                          palettePos.col === ci
                        return (
                          <button
                            key={`${ri}-${ci}-${c}`}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            aria-label={isBase ? `フォルダ色 ${c}` : c}
                            className={
                              selected
                                ? `${styles.colorActive} ${styles.colorSwatch}`
                                : styles.colorSwatch
                            }
                            style={{ background: c }}
                            onClick={() =>
                              selectPaletteColor(c, {
                                kind: 'task',
                                row: ri,
                                col: ci,
                              })
                            }
                          >
                            {isBase && (
                              <FolderIcon
                                color="#fff"
                                size={14}
                                className={styles.baseFolderMark}
                              />
                            )}
                          </button>
                        )
                      }),
                    )}
                  </div>
                  <ColorPickerButton
                    fill={pickerFill}
                    selected={colorFrom === 'picker'}
                    onPick={pickCustomColor}
                  />
                </div>
              )
            )}
          </div>

          <div className={styles.sheetActions}>
            {isEdit && (
              <button
                type="button"
                className={styles.danger}
                disabled={busy || folderDeleteBlocked}
                title={
                  folderDeleteBlocked
                    ? 'タスクがあるフォルダは削除できません'
                    : undefined
                }
                onClick={() => void submitDelete()}
              >
                削除
              </button>
            )}
            <div className={styles.sheetActionsRight}>
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !name.trim() || (addKind === 'task' && !folderId)}
                onClick={() => void submitSheet()}
              >
                {isEdit ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}
