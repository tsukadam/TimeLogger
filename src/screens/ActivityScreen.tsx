import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EventEditModal,
  type EventFormSeed,
} from '../components/EventEditModal'
import { TimeWheelPopover } from '../components/TimeField'
import { ErrorBanner } from '../components/ErrorBanner'
import { FolderIcon } from '../components/FolderIcon'
import chrome from '../components/screenChrome.module.css'
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
import { useStoreActions, useStoreBusy, useStoreData } from '../state/Store'
import { boundsForJoin } from '../state/eventSnap'
import type { Event } from '../types'
import { resolveDisplay } from './log/aggregate'
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
  | { type: 'add'; initial: EventFormSeed }

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
  const busy = useStoreBusy()
  const { loading, error, events, tasks, folders, hasMoreOlderEvents } =
    useStoreData()
  const { clearError, loadOlderEvents, alignBoundary, setBoundary } =
    useStoreActions()
  const [visible, setVisible] = useState(PAGE)
  const [sheet, setSheet] = useState<SheetState>({ type: 'closed' })
  const [join, setJoin] = useState<{
    olderId: string
    newerId: string
    date: string
    time: string
    minMs: number
    maxMs: number
    pos: { top: number; left: number }
  } | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const hasLive = useMemo(() => events.some((e) => e.endedAt === null), [events])
  // 記録中カードの経過表示をなめらかにするため、この画面だけ 250ms 刻み
  const now = useNowTick(hasLive, 250)

  useEffect(() => {
    setVisible(PAGE)
  }, [events])

  const pageEvents = useMemo(() => events.slice(0, visible), [events, visible])

  // 色・名前はスナップショットでなく ID で最新マスタを使う（Log の resolveDisplay と同一）
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const folderById = useMemo(
    () => new Map(folders.map((f) => [f.id, f])),
    [folders],
  )

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

  const hasMore = visible < events.length || hasMoreOlderEvents

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasMore) return
    const root = findScrollParent(node)
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        if (visible < events.length) {
          setVisible((n) => Math.min(n + PAGE, events.length))
          return
        }
        if (hasMoreOlderEvents) {
          void loadOlderEvents().then(() => {
            setVisible((n) => n + PAGE)
          })
        }
      },
      { root, rootMargin: '120px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [
    hasMore,
    hasMoreOlderEvents,
    events.length,
    visible,
    groups.length,
    loadOlderEvents,
  ])

  function openEdit(ev: Event) {
    setSheet({ type: 'edit', id: ev.id })
  }

  async function openJoin(newer: Event, older: Event, btn: HTMLElement) {
    try {
      const iso = await alignBoundary(older.id, newer.id)
      const r = btn.getBoundingClientRect()
      const panelW = 280
      const left = Math.min(
        Math.max(8, r.left + r.width / 2 - panelW / 2),
        window.innerWidth - panelW - 8,
      )
      const below = r.bottom + 6
      const top =
        below + 180 > window.innerHeight - 8
          ? Math.max(8, r.top - 180 - 6)
          : below
      const nowMs = Date.now()
      const bound = boundsForJoin({
        older: { ...older, endedAt: iso },
        newer: { ...newer, startedAt: iso },
        nowMs,
      })
      setJoin({
        olderId: older.id,
        newerId: newer.id,
        date: dateKey(iso),
        time: isoToTimeInput(iso),
        minMs: bound.minMs,
        maxMs: bound.maxMs,
        pos: { top, left },
      })
    } catch {
      /* Store が表示 */
    }
  }

  function openAdd() {
    const pressMs = Date.now()
    const hole = findOldestHole(events, pressMs)
    const start = msToInputs(hole ? hole.start : pressMs)
    const end = msToInputs(hole ? hole.end : pressMs)

    const latest = events[0]
    const latestTask = latest ? tasks.find((t) => t.id === latest.taskId) : null
    const task = latestTask ?? tasks[0] ?? null
    setSheet({
      type: 'add',
      initial: {
        folderId: task?.folderId ?? folders[0]?.id ?? '',
        taskId: task?.id ?? '',
        startDate: start.date,
        startTime: start.time,
        endDate: end.date,
        endTime: end.time,
      },
    })
  }

  const closeSheet = () => setSheet({ type: 'closed' })

  if (loading) {
    return <p className={chrome.status}>Loading...</p>
  }

  return (
    <section className={styles.root}>
      {error && <ErrorBanner message={error} onDismiss={clearError} />}

      {events.length === 0 ? (
        <p className={chrome.status}>まだ記録がありません。</p>
      ) : (
        <>
          {groups.map((g, gi) => (
            <div key={g.key} className={styles.dayGroup}>
              <div className={styles.dateRule}>
                <span className={styles.dateRuleLine} />
                <span className={styles.dateLabel}>{g.label}</span>
                <span className={styles.dateRuleLine} />
              </div>
              <ul className={styles.list}>
                {g.events.map((ev, ei) => {
                  const display = resolveDisplay(ev, taskById, folderById)
                  const nextSame = g.events[ei + 1]
                  const nextOther = nextSame
                    ? null
                    : (groups[gi + 1]?.events[0] ?? null)
                  const older = nextSame ?? nextOther
                  const across = !nextSame && nextOther != null
                  return (
                    <li
                      key={ev.id}
                      className={`${styles.item}${across ? ` ${styles.itemAcross}` : ''}`}
                    >
                      <button
                        type="button"
                        className={styles.row}
                        disabled={busy}
                        onClick={() => openEdit(ev)}
                      >
                        <div className={styles.main}>
                          <div className={styles.titleLine}>
                            <span
                              className={chrome.swatch}
                              style={{ background: display.taskColor }}
                              aria-hidden
                            />
                            <span className={styles.taskName}>
                              {display.taskName}
                            </span>
                            <span className={styles.folderMark} aria-hidden>
                              <FolderIcon
                                color={display.folderColor}
                                size={14}
                              />
                            </span>
                            <span className={styles.folderName}>
                              {display.folderName}
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
                      {older && (
                        <button
                          type="button"
                          className={styles.joinBtn}
                          aria-label="境界時刻を編集"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation()
                            void openJoin(ev, older, e.currentTarget)
                          }}
                        >
                          <svg
                            className={styles.joinIcon}
                            viewBox="0 0 12 12"
                            aria-hidden
                          >
                            <path d="M6 1.15 10.35 4.95H1.65Z" />
                            <path d="M6 10.85 1.65 7.05h8.7Z" />
                          </svg>
                        </button>
                      )}
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

      <div className={chrome.addBar}>
        <button
          type="button"
          className={chrome.plus}
          aria-label="記録を追加"
          disabled={busy || tasks.length === 0}
          onClick={openAdd}
        >
          ＋
        </button>
      </div>

      {join && (
        <TimeWheelPopover
          value={join.time}
          date={join.date}
          bound={{ minMs: join.minMs, maxMs: join.maxMs }}
          pos={join.pos}
          onChange={(time) =>
            setJoin((j) => (j ? { ...j, time } : j))
          }
          onDayChange={(d) =>
            setJoin((j) =>
              j ? { ...j, date: addDaysKey(j.date, d) } : j,
            )
          }
          onClose={(time) => {
            const j = join
            setJoin(null)
            if (!j) return
            void setBoundary(
              j.olderId,
              j.newerId,
              dateTimeInputToIso(j.date, time),
            )
          }}
        />
      )}
      {sheet.type === 'edit' && (
        <EventEditModal eventId={sheet.id} onClose={closeSheet} />
      )}
      {sheet.type === 'add' && (
        <EventEditModal
          mode="add"
          initial={sheet.initial}
          onClose={closeSheet}
        />
      )}
    </section>
  )
}
