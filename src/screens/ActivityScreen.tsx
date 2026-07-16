import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EventEditModal,
  type EventFormSeed,
} from '../components/EventEditModal'
import { FolderIcon } from '../components/FolderIcon'
import chrome from '../components/screenChrome.module.css'
import {
  dateKey,
  durationLabel,
  formatDateDivider,
  formatEventRange,
  isoToTimeInput,
  nowIso,
} from '../lib/time'
import { useNowTick } from '../lib/useNowTick'
import { useStoreActions, useStoreBusy, useStoreData } from '../state/Store'
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
  const { loading, error, events, tasks, folders } = useStoreData()
  const { clearError } = useStoreActions()
  const [visible, setVisible] = useState(PAGE)
  const [sheet, setSheet] = useState<SheetState>({ type: 'closed' })
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const hasLive = useMemo(() => events.some((e) => e.endedAt === null), [events])
  // 記録中カードの経過表示をなめらかにするため、この画面だけ 250ms 刻み
  const now = useNowTick(hasLive, 250)

  useEffect(() => {
    setVisible(PAGE)
  }, [events])

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
      {error && (
        <div className={chrome.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={clearError}>
            閉じる
          </button>
        </div>
      )}

      {events.length === 0 ? (
        <p className={chrome.status}>まだ記録がありません。</p>
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
                              className={chrome.swatch}
                              style={{ background: colors.taskColor }}
                              aria-hidden
                            />
                            <span className={styles.taskName}>
                              {ev.taskName}
                            </span>
                            <span className={styles.folderMark} aria-hidden>
                              <FolderIcon
                                color={colors.folderColor}
                                size={14}
                              />
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
