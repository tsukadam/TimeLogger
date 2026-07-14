import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderIcon } from '../components/FolderIcon'
import {
  dateKey,
  durationLabel,
  formatDateDivider,
  formatEventRange,
} from '../lib/time'
import { useStore } from '../state/Store'
import type { Event } from '../types'
import styles from './ActivityScreen.module.css'

const PAGE = 50

type DayGroup = {
  key: string
  label: string
  events: Event[]
}

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
  const { loading, error, events, clearError } = useStore()
  const [visible, setVisible] = useState(PAGE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setVisible(PAGE)
  }, [events])

  const pageEvents = useMemo(() => events.slice(0, visible), [events, visible])

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
                {g.events.map((ev) => (
                  <li key={ev.id} className={styles.row}>
                    <span
                      className={styles.swatch}
                      style={{ background: ev.taskColor }}
                      aria-hidden
                    />
                    <div className={styles.body}>
                      <div className={styles.top}>
                        <div className={styles.name}>
                          {ev.taskName}
                          {ev.endedAt === null && (
                            <span className={styles.badge}>記録中</span>
                          )}
                        </div>
                        <div className={styles.folder}>
                          <span className={styles.folderName}>{ev.folderName}</span>
                          <FolderIcon color={ev.folderColor} size={14} />
                        </div>
                      </div>
                      <div className={styles.timeRow}>
                        <span className={styles.meta}>
                          {formatEventRange(ev.startedAt, ev.endedAt)}
                        </span>
                        {ev.endedAt !== null && (
                          <span className={styles.duration}>
                            {durationLabel(ev.startedAt, ev.endedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div ref={sentinelRef} className={styles.sentinel} aria-hidden />
          {!hasMore && <p className={styles.end}>すべて表示しました</p>}
        </>
      )}
    </section>
  )
}
