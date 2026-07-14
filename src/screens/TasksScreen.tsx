import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FolderIcon } from '../components/FolderIcon'
import { FolderSelect } from '../components/FolderSelect'
import {
  DEFAULT_PALETTE,
  FOLDER_PALETTE,
  paletteCountForWidth,
  relatedColorsFrom,
} from '../lib/color'
import {
  formatDurationHms,
  overlapSecondsOnDay,
  todayKey,
} from '../lib/time'
import { useStore } from '../state/Store'
import styles from './TasksScreen.module.css'

type AddKind = 'folder' | 'task'

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
    startTask,
    stopCurrent,
  } = useStore()

  const [now, setNow] = useState(() => Date.now())
  const [addOpen, setAddOpen] = useState(false)
  const [addKind, setAddKind] = useState<AddKind>('folder')
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_PALETTE[0]!)
  const [folderId, setFolderId] = useState('')
  const [paletteSlots, setPaletteSlots] = useState(8)
  const colorsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!current) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [current])

  useEffect(() => {
    if (!folderId && folders[0]) setFolderId(folders[0].id)
  }, [folderId, folders])

  useLayoutEffect(() => {
    if (!addOpen) return
    const el = colorsRef.current
    if (!el) return
    setPaletteSlots(paletteCountForWidth(el.clientWidth))
  }, [addOpen, addKind])

  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === folderId) ?? null,
    [folderId, folders],
  )

  const palette = useMemo(() => {
    if (addKind === 'folder') {
      const base = FOLDER_PALETTE
      if (base.length >= paletteSlots) return base.slice(0, paletteSlots)
      return [...base, ...relatedColorsFrom(base[0]!, paletteSlots - base.length)]
    }
    if (selectedFolder) {
      return relatedColorsFrom(selectedFolder.color, paletteSlots)
    }
    return relatedColorsFrom(DEFAULT_PALETTE[0]!, paletteSlots)
  }, [addKind, selectedFolder, paletteSlots])

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

  function openAdd() {
    const kind: AddKind = folders.length === 0 ? 'folder' : 'task'
    setAddKind(kind)
    setName('')
    setFolderId(folders[0]?.id ?? '')
    if (kind === 'folder') {
      setColor(FOLDER_PALETTE[0]!)
    } else {
      const base = folders[0]?.color
      setColor(base ? relatedColorsFrom(base, 1)[0]! : FOLDER_PALETTE[0]!)
    }
    setAddOpen(true)
  }

  async function submitAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      if (addKind === 'folder') {
        await addFolder(trimmed, color)
      } else {
        if (!folderId) return
        await addTask(folderId, trimmed, color)
      }
      setAddOpen(false)
      setName('')
    } catch {
      /* Store が表示 */
    }
  }

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

      {byFolder.map(({ folder, tasks: folderTasks }, index) => (
        <section key={folder.id} className={styles.folderSection}>
          {index > 0 && <div className={styles.divider} />}
          <div className={styles.folderHead}>
            <FolderIcon color={folder.color} size={16} />
            <h2 className={styles.folderName}>{folder.name}</h2>
          </div>

          <ul className={styles.taskList}>
            {folderTasks.map((task) => {
              const running = current?.taskId === task.id
              const todaySec = todaySecByTask.get(task.id) ?? 0
              return (
                <li key={task.id} className={styles.taskRow}>
                  <button
                    type="button"
                    className={running ? styles.recStop : styles.recStart}
                    disabled={busy}
                    aria-label={running ? '記録停止' : '記録開始'}
                    onClick={() => {
                      if (running) void stopCurrent()
                      else void startTask(task.id)
                    }}
                  >
                    <span className={running ? styles.square : styles.triangle} />
                    {running && current && (
                      <span className={styles.elapsedInBtn}>
                        {formatDurationHms(
                          Math.floor(
                            (now - new Date(current.startedAt).getTime()) / 1000,
                          ),
                        )}
                      </span>
                    )}
                  </button>
                  <div className={styles.taskCard}>
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
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {!addOpen && (
        <div className={styles.addInline}>
          {byFolder.length === 0 && (
            <p className={styles.hint}>＋ からフォルダを追加</p>
          )}
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
      )}

      {addOpen && (
        <div className={styles.sheet} role="dialog" aria-label="追加">
          <div className={styles.kindRow}>
            <button
              type="button"
              className={addKind === 'folder' ? styles.kindActive : styles.kind}
              onClick={() => {
                setAddKind('folder')
                setColor(FOLDER_PALETTE[0]!)
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
                const f = folders.find((x) => x.id === folderId) ?? folders[0]
                if (f) setColor(relatedColorsFrom(f.color, 1)[0]!)
              }}
            >
              タスク
            </button>
          </div>

          {addKind === 'task' && (
            <div className={styles.field}>
              <span>フォルダ</span>
              <FolderSelect
                folders={folders}
                value={folderId}
                disabled={busy}
                onChange={(id) => {
                  setFolderId(id)
                  const f = folders.find((x) => x.id === id)
                  if (f) setColor(relatedColorsFrom(f.color, 1)[0]!)
                }}
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
              autoFocus
            />
          </label>

          <div className={styles.field}>
            <span>色</span>
            <div className={styles.colors} ref={colorsRef}>
              {palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={color === c ? styles.colorActive : styles.color}
                  style={{ background: c }}
                  aria-label={c}
                  onClick={() => setColor(c)}
                />
              ))}
              <label className={styles.pickerWrap} title="自由に選ぶ">
                <span className={styles.pickerFace} aria-hidden>
                  ＋
                </span>
                <input
                  type="color"
                  className={styles.pickerInput}
                  value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#e08a3c'}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label="カラーピッカー"
                />
              </label>
            </div>
          </div>

          <div className={styles.sheetActions}>
            <button
              type="button"
              className={styles.ghost}
              disabled={busy}
              onClick={() => setAddOpen(false)}
            >
              キャンセル
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !name.trim() || (addKind === 'task' && !folderId)}
              onClick={() => void submitAdd()}
            >
              追加
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
