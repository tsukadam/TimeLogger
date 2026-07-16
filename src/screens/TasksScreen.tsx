import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FolderIcon } from '../components/FolderIcon'
import { FolderSelect } from '../components/FolderSelect'
import { Modal } from '../components/Modal'
import { Spinner } from '../components/Spinner'
import spinnerStyles from '../components/Spinner.module.css'
import form from '../components/form.module.css'
import { FOLDER_PALETTE, TASK_BASE_CELL, findTaskColorPos, taskColorGrid } from '../lib/color'
import {
  durationLabel,
  formatDurationHms,
  overlapSecondsOnDay,
  todayKey,
} from '../lib/time'
import { useNowTick } from '../lib/useNowTick'
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
    moveFolder,
    updateTask,
    startTask,
    stopCurrent,
    deleteFolder,
    deleteTask,
  } = useStore()

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
  /** 録画開始/停止の通信中（押したタスクのボタンにスピナー） */
  const [pendingRecId, setPendingRecId] = useState<string | null>(null)
  /** シートの Save/Add / 削除の通信中 */
  const [pendingSheet, setPendingSheet] = useState<'save' | 'delete' | null>(
    null,
  )
  const requestCloseRef = useRef<() => void>(() => {})

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
    setPendingSheet('save')
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
    return <p className={styles.status}>Loading...</p>
  }

  return (
    <section className={styles.root} ref={rootRef}>
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
          <ul className={styles.taskList}>
            {folderTasks.map((task) => {
              const running = current?.taskId === task.id
              const todaySec = todaySecByTask.get(task.id) ?? 0
              const recPending = pendingRecId === task.id
              return (
                <li key={task.id} className={styles.taskRow} data-task-id={task.id}>
                  <button
                    type="button"
                    className={`${running ? styles.recStop : styles.recStart}${
                      recPending ? ` ${spinnerStyles.busyBtn}` : ''
                    }`}
                    disabled={busy}
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
                <div className={styles.kindRow}>
                  <button
                    type="button"
                    className={
                      addKind === 'folder' ? styles.kindActive : styles.kind
                    }
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
                    className={
                      addKind === 'task' ? styles.kindActive : styles.kind
                    }
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

              {addKind === 'task' && sheet.type !== 'add-task-in' && (
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
                  placeholder={addKind === 'folder' ? 'フォルダ名' : 'タスク名'}
                  disabled={busy}
                />
              </label>

              <div className={form.field}>
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
                          className={
                            selected ? styles.colorActive : styles.color
                          }
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
                              ri === TASK_BASE_CELL.row &&
                              ci === TASK_BASE_CELL.col
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
                      (addKind === 'task' && !folderId)
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
