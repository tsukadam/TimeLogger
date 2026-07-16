import { useRef, useState } from 'react'
import { DAY_MS } from '../../lib/time'
import { useOutsideClose } from '../../lib/useOutsideClose'
import styles from '../LogScreen.module.css'
import { ChartTip } from './ChartTip'
import type { Column, Slice } from './types'

export function IndividualChart({
  columns,
  chartMode,
  onSeg,
  tapName = false,
  draw = true,
}: {
  columns: Column[]
  chartMode: 'day' | 'stack'
  onSeg: (id: string) => void
  /** true なら、セグメントのタップは編集でなく名前チップ表示（Year 用） */
  tapName?: boolean
  /** false の間は下地トラックだけ描く（タブ切替アニメ中の負荷回避） */
  draw?: boolean
}) {
  const [tip, setTip] = useState<{ key: string; slice: Slice } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useOutsideClose(wrapRef, tip !== null, () => setTip(null))

  if (chartMode === 'day' && columns[0]) {
    const col = columns[0]
    const mid = col.start + DAY_MS / 2
    const halves = [
      {
        key: 'am',
        start: col.start,
        end: mid,
        ticks: ['0', '3', '6', '9', '12'],
      },
      {
        key: 'pm',
        start: mid,
        end: col.end,
        ticks: ['12', '15', '18', '21', '24'],
      },
    ] as const
    return (
      <div className={styles.dayTracks}>
        {halves.map((h) => {
          const segs = col.segs
            .map((s) => ({
              ...s,
              start: Math.max(s.start, h.start),
              end: Math.min(s.end, h.end),
            }))
            .filter((s) => s.end > s.start)
          const span = Math.max(1, h.end - h.start)
          return (
            <div key={h.key} className={styles.dayHalf}>
              <div className={styles.dayTrackBar}>
                <div className={styles.fillStill}>
                  {draw &&
                    segs.map((s) => (
                      <button
                        key={`${s.eventId}-${s.start}`}
                        type="button"
                        className={styles.daySeg}
                        title={s.name}
                        style={{
                          left: `${((s.start - h.start) / span) * 100}%`,
                          width: `${((s.end - s.start) / span) * 100}%`,
                          background: s.color,
                        }}
                        onClick={() => onSeg(s.eventId)}
                      />
                    ))}
                </div>
                {/* 完成形をマスクで隠し、左から右へ縮めて見せる */}
                {draw && <div className={styles.revealX} aria-hidden />}
              </div>
              <div className={styles.dayTicks}>
                {h.ticks.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const n = Math.max(columns.length, 1)
  return (
    <div className={styles.totalsWrap} ref={wrapRef}>
      <div className={styles.stackChart}>
        <div
          className={styles.stackInner}
          style={{
            width: `${Math.min(100, n * 25)}%`,
            gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
          }}
        >
          {columns.map((col) => {
            const span = Math.max(1, col.end - col.start)
            return (
              <div key={col.key} className={styles.stackCol}>
                <div className={styles.stackBar}>
                  <div className={styles.fillStill}>
                    {draw &&
                      col.segs.map((s) => {
                        const segKey = `${s.eventId}-${s.start}`
                        return (
                          <button
                            key={segKey}
                            type="button"
                            className={styles.stackSeg}
                            style={{
                              bottom: `${((s.start - col.start) / span) * 100}%`,
                              height: `${((s.end - s.start) / span) * 100}%`,
                              background: s.color,
                            }}
                            onClick={() => {
                              if (!tapName) {
                                onSeg(s.eventId)
                                return
                              }
                              const slice: Slice = {
                                id: segKey,
                                name: s.name,
                                color: s.color,
                                sec: Math.floor((s.end - s.start) / 1000),
                              }
                              setTip((cur) =>
                                cur?.key === segKey
                                  ? null
                                  : { key: segKey, slice },
                              )
                            }}
                          />
                        )
                      })}
                  </div>
                  {/* 完成形をマスクで隠し、下から上へ縮めて見せる */}
                  {draw && <div className={styles.revealY} aria-hidden />}
                </div>
                <span className={styles.stackLabel}>{col.label}</span>
              </div>
            )
          })}
        </div>
      </div>
      {tapName && (
        <ChartTip tip={tip?.slice ?? null} onClose={() => setTip(null)} />
      )}
    </div>
  )
}
