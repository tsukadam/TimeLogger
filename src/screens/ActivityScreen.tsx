import { useEffect, useMemo, useRef, useState } from 'react'
import { EventEditModal } from '../components/EventEditModal'
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
} from '../lib/time'
import { rectToAnchor, type PanelAnchor } from '../lib/placePanel'
import { useNowTick } from '../lib/useNowTick'
import { useStoreActions, useStoreBusy, useStoreData } from '../state/Store'
import { boundsForJoin } from '../state/eventSnap'
import type { Event } from '../types'
import { resolveDisplay } from './log/aggregate'
import styles from './ActivityScreen.module.css'

const PAGE = 50

type DayGroup = {
  key: string
  label: string
  events: Event[]
}

type SheetState = { type: 'closed' } | { type: 'edit'; id: string }

function findScrollParent(el: HTMLElement | null): Element | null {
  let cur: HTMLElement | null = el
  while (cur) {
    const oy = getComputedStyle(cur).overflowY
    if (oy === 'auto' || oy === 'scroll') return cur
    cur = cur.parentElement
  }
  return null
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
    anchor: PanelAnchor
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
        anchor: rectToAnchor(btn.getBoundingClientRect()),
      })
    } catch {
      /* Store が表示 */
    }
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

      {join && (
        <TimeWheelPopover
          value={join.time}
          date={join.date}
          bound={{ minMs: join.minMs, maxMs: join.maxMs }}
          anchor={join.anchor}
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
    </section>
  )
}
