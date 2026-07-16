import { useEffect, useMemo, useRef, useState } from 'react'
import { DateField } from '../components/DateField'
import { FolderIcon } from '../components/FolderIcon'
import { FolderSelect } from '../components/FolderSelect'
import { Modal } from '../components/Modal'
import { Spinner } from '../components/Spinner'
import spinnerStyles from '../components/Spinner.module.css'
import { TaskSelect } from '../components/TaskSelect'
import { TimeField } from '../components/TimeField'
import form from '../components/form.module.css'
import {
  addDaysKey,
  dateKey,
  dateTimeInputToIso,
  durationLabel,
  formatDateDivider,
  formatEventRange,
  isoToTimeInput,
  nowIso,
} from '../lib/time'
import { useNowTick } from '../lib/useNowTick'
import { useStore } from '../state/Store'
import type { Event } from '../types'
import styles from './ActivityScreen.module.css'

const PAGE = 50
const HOLE_WINDOW_MS = 12 * 60 * 60 * 1000
const HOLE_MIN_MS = 60 * 1000

type DayGroup = {
  key: string
  label: string
  events: Event[]
}

type SheetState =
  | { type: 'closed' }
  | { type: 'edit'; id: string }
  | { type: 'add' }

function findScrollParent(el: HTMLElement | null): Element | null {
  let cur: HTMLElement | null = el
  while (cur) {
    const oy = getComputedStyle(cur).overflowY
    if (oy === 'auto' || oy === 'scroll') return cur
    cur = cur.parentElement
  }
  return null
}

/**
 * 直近12時間の記録の「穴」（1分以上の空白）のうち最古を返す。
 * 無ければ null（＝押した時点の時刻をデフォルトにする）。
 */
function findOldestHole(
  events: Event[],
  nowMs: number,
): { start: number; end: number } | null {
  const windowStart = nowMs - HOLE_WINDOW_MS
  const intervals = events
    .map((e) => ({
      s: new Date(e.startedAt).getTime(),
      e: e.endedAt ? new Date(e.endedAt).getTime() : nowMs,
    }))
    .filter(
      (x) =>
        Number.isFinite(x.s) &&
        Number.isFinite(x.e) &&
        x.e > windowStart &&
        x.s < nowMs,
    )
    .sort((a, b) => a.s - b.s)
  if (intervals.length === 0) return null

  const merged: { s: number; e: number }[] = []
  for (const x of intervals) {
    const last = merged[merged.length - 1]
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e)
    else merged.push({ ...x })
  }

  const holes: { s: number; e: number }[] = []
  // 窓の先頭〜最初の記録
  holes.push({ s: windowStart, e: merged[0]!.s })
  for (let i = 0; i < merged.length - 1; i++) {
    holes.push({ s: merged[i]!.e, e: merged[i + 1]!.s })
  }
  // 最後の記録〜現在（記録中があればここは埋まっている）
  holes.push({ s: merged[merged.length - 1]!.e, e: nowMs })

  for (const h of holes) {
    const s = Math.max(h.s, windowStart)
    const e = Math.min(h.e, nowMs)
    if (e - s >= HOLE_MIN_MS) return { start: s, end: e }
  }
  return null
}

function msToInputs(ms: number): { date: string; time: string } {
  const iso = nowIso(new Date(ms))
  return { date: dateKey(iso), time: isoToTimeInput(iso) }
}

export function ActivityScreen() {
  const {
    loading,
    busy,
    error,
    events,
    tasks,
    folders,
    clearError,
    updateEvent,
    addEvent,
    deleteEvent,
  } = useStore()
  const [visible, setVisible] = useState(PAGE)
  const [sheet, setSheet] = useState<SheetState>({ type: 'closed' })
  const [formFolderId, setFormFolderId] = useState('')
  const [formTaskId, setFormTaskId] = useState('')
  const [formStartDate, setFormStartDate] = useState('')
  const [formStartTime, setFormStartTime] = useState('')
  const [formEndDate, setFormEndDate] = useState('')
  const [formEndTime, setFormEndTime] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingSheet, setPendingSheet] = useState<'save' | 'delete' | null>(
    null,
  )
  const requestCloseRef = useRef<() => void>(() => {})
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const hasLive = useMemo(() => events.some((e) => e.endedAt === null), [events])
  // 記録中カードの経過表示をなめらかにするため、この画面だけ 250ms 刻み
  const now = useNowTick(hasLive, 250)

  const editing = useMemo(
    () =>
      sheet.type === 'edit'
        ? events.find((e) => e.id === sheet.id) ?? null
        : null,
    [sheet, events],
  )
  const isRecording = editing?.endedAt === null

  const folderTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.folderId === formFolderId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [tasks, formFolderId],
  )

  useEffect(() => {
    setVisible(PAGE)
  }, [events])

  // 編集対象が消えたら（削除など）モーダルを閉じる
  useEffect(() => {
    if (sheet.type === 'edit' && !editing) setSheet({ type: 'closed' })
  }, [sheet, editing])

  const pageEvents = useMemo(() => events.slice(0, visible), [events, visible])

  // 色だけはスナップショットでなく ID で最新のマスタ色を使う（調整が多いため）
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const folderById = useMemo(
    () => new Map(folders.map((f) => [f.id, f])),
    [folders],
  )
  const liveColors = (ev: Event) => {
    const task = taskById.get(ev.taskId)
    const folder = folderById.get(task?.folderId ?? ev.folderId)
    return {
      taskColor: task?.color ?? ev.taskColor,
      folderColor: folder?.color ?? ev.folderColor,
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, DayGroup>()
    for (const ev of pageEvents) {
      const key = dateKey(ev.startedAt)
      let g = map.get(key)
      if (!g) {
        g = { key, label: formatDateDivider(ev.startedAt), events: [] }
        map.set(key, g)
      }
      g.events.push(ev)
    }
    return [...map.values()]
  }, [pageEvents])

  const hasMore = visible < events.length

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasMore) return
    const root = findScrollParent(node)
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((n) => Math.min(n + PAGE, events.length))
        }
      },
      { root, rootMargin: '120px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [hasMore, events.length, groups.length])

  function openEdit(ev: Event) {
    const task = tasks.find((t) => t.id === ev.taskId)
    setFormFolderId(task?.folderId ?? ev.folderId)
    setFormTaskId(ev.taskId)
    setFormStartDate(dateKey(ev.startedAt))
    setFormStartTime(isoToTimeInput(ev.startedAt))
    setFormEndDate(ev.endedAt ? dateKey(ev.endedAt) : '')
    setFormEndTime(ev.endedAt ? isoToTimeInput(ev.endedAt) : '')
    setFormError(null)
    setSheet({ type: 'edit', id: ev.id })
  }

  function openAdd() {
    const pressMs = Date.now()
    const hole = findOldestHole(events, pressMs)
    const start = msToInputs(hole ? hole.start : pressMs)
    const end = msToInputs(hole ? hole.end : pressMs)

    const latest = events[0]
    const latestTask = latest ? tasks.find((t) => t.id === latest.taskId) : null
    const task = latestTask ?? tasks[0] ?? null
    setFormFolderId(task?.folderId ?? folders[0]?.id ?? '')
    setFormTaskId(task?.id ?? '')
    setFormStartDate(start.date)
    setFormStartTime(start.time)
    setFormEndDate(end.date)
    setFormEndTime(end.time)
    setFormError(null)
    setSheet({ type: 'add' })
  }

  function changeFolder(folderId: string) {
    setFormFolderId(folderId)
    const first = tasks
      .filter((t) => t.folderId === folderId)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0]
    setFormTaskId(first?.id ?? '')
  }

  const closeSheet = () => {
    setSheet({ type: 'closed' })
    setFormError(null)
  }

  const submitSheet = async () => {
    setFormError(null)
    setPendingSheet('save')
    try {
      const startedAt = dateTimeInputToIso(formStartDate, formStartTime)
      if (sheet.type === 'edit') {
        if (!editing) return
        const endedAt =
          editing.endedAt === null
            ? null
            : dateTimeInputToIso(formEndDate, formEndTime)
        await updateEvent(sheet.id, {
          taskId: formTaskId,
          startedAt,
          endedAt,
        })
      } else if (sheet.type === 'add') {
        await addEvent({
          taskId: formTaskId,
          startedAt,
          endedAt: dateTimeInputToIso(formEndDate, formEndTime),
        })
      }
      requestCloseRef.current()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setPendingSheet(null)
    }
  }

  const submitDelete = async () => {
    if (sheet.type !== 'edit') return
    if (!window.confirm('この記録を削除しますか？')) return
    setFormError(null)
    setPendingSheet('delete')
    try {
      await deleteEvent(sheet.id)
      requestCloseRef.current()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '削除に失敗しました')
    } finally {
      setPendingSheet(null)
    }
  }

  if (loading) {
    return <p className={styles.status}>Loading...</p>
  }

  const sheetOpen = sheet.type !== 'closed'
  const taskMissing =
    formTaskId !== '' && !folderTasks.some((t) => t.id === formTaskId)

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

      {events.length === 0 ? (
        <p className={styles.status}>まだ記録がありません。</p>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.key} className={styles.dayGroup}>
              <div className={styles.dateRule}>
                <span className={styles.dateRuleLine} />
                <span className={styles.dateLabel}>{g.label}</span>
                <span className={styles.dateRuleLine} />
              </div>
              <ul className={styles.list}>
                {g.events.map((ev) => {
                  const colors = liveColors(ev)
                  return (
                  <li key={ev.id}>
                    <button
                      type="button"
                      className={styles.row}
                      disabled={busy}
                      onClick={() => openEdit(ev)}
                    >
                      <div className={styles.main}>
                        <div className={styles.titleLine}>
                          <span
                            className={styles.swatch}
                            style={{ background: colors.taskColor }}
                            aria-hidden
                          />
                          <span className={styles.taskName}>{ev.taskName}</span>
                          <span className={styles.folderMark} aria-hidden>
                            <FolderIcon color={colors.folderColor} size={14} />
                          </span>
                          <span className={styles.folderName}>
                            {ev.folderName}
                          </span>
                        </div>
                        <div className={styles.meta}>
                          {formatEventRange(ev.startedAt, ev.endedAt)}
                        </div>
                      </div>
                      <span className={styles.duration}>
                        {durationLabel(ev.startedAt, ev.endedAt, now)}
                      </span>
                    </button>
                  </li>
                  )
                })}
              </ul>
            </div>
          ))}
          <div ref={sentinelRef} className={styles.sentinel} aria-hidden />
          {!hasMore && <p className={styles.end}>すべて表示しました</p>}
        </>
      )}

      <div className={styles.addBar}>
        <button
          type="button"
          className={styles.plus}
          aria-label="記録を追加"
          disabled={busy || tasks.length === 0}
          onClick={openAdd}
        >
          ＋
        </button>
      </div>

      <Modal
        open={sheetOpen}
        onClose={closeSheet}
        aria-label={sheet.type === 'add' ? '記録を追加' : '記録を編集'}
      >
        {({ requestClose }) => {
          requestCloseRef.current = requestClose
          return (
            <>
              <h2 className={form.sheetTitle}>
                {sheet.type === 'add' ? '記録を追加' : '記録を編集'}
              </h2>

              <div className={form.field}>
                <span>フォルダ</span>
                <FolderSelect
                  folders={folders}
                  value={formFolderId}
                  disabled={busy}
                  onChange={changeFolder}
                />
              </div>

              <div className={form.field}>
                <span>タスク</span>
                <TaskSelect
                  tasks={folderTasks}
                  value={formTaskId}
                  disabled={busy}
                  onChange={setFormTaskId}
                  extraOption={
                    taskMissing && editing
                      ? {
                          id: formTaskId,
                          name: `${editing.taskName}（削除済み）`,
                          color: editing.taskColor,
                        }
                      : null
                  }
                />
              </div>

              <div className={form.field}>
                <span>開始</span>
                <div className={form.dateTimeRow}>
                  <DateField
                    value={formStartDate}
                    disabled={busy}
                    onChange={setFormStartDate}
                    aria-label="開始日"
                  />
                  <TimeField
                    value={formStartTime}
                    disabled={busy}
                    onChange={setFormStartTime}
                    onDayChange={(d) =>
                      setFormStartDate((cur) =>
                        cur ? addDaysKey(cur, d) : cur,
                      )
                    }
                    aria-label="開始時刻"
                  />
                </div>
              </div>

              {!(sheet.type === 'edit' && isRecording) && (
                <div className={form.field}>
                  <span>終了</span>
                  <div className={form.dateTimeRow}>
                    <DateField
                      value={formEndDate}
                      disabled={busy}
                      onChange={setFormEndDate}
                      aria-label="終了日"
                    />
                    <TimeField
                      value={formEndTime}
                      disabled={busy}
                      onChange={setFormEndTime}
                      onDayChange={(d) =>
                        setFormEndDate((cur) =>
                          cur ? addDaysKey(cur, d) : cur,
                        )
                      }
                      aria-label="終了時刻"
                    />
                  </div>
                </div>
              )}

              {formError && <p className={form.formError}>{formError}</p>}

              <div className={form.sheetActions}>
                {sheet.type === 'edit' && (
                  <button
                    type="button"
                    className={`${form.danger}${
                      pendingSheet === 'delete'
                        ? ` ${spinnerStyles.busyBtn}`
                        : ''
                    }`}
                    disabled={busy}
                    aria-busy={pendingSheet === 'delete'}
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
                      !formTaskId ||
                      !formStartDate ||
                      !formStartTime.trim() ||
                      (!(sheet.type === 'edit' && isRecording) &&
                        (!formEndDate || !formEndTime.trim()))
                    }
                    aria-busy={pendingSheet === 'save'}
                    onClick={() => void submitSheet()}
                  >
                    {pendingSheet === 'save' ? (
                      <Spinner size={14} />
                    ) : sheet.type === 'add' ? (
                      'Add'
                    ) : (
                      'Save'
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
