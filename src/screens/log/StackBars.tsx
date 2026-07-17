import type { RefObject } from 'react'
import styles from '../LogScreen.module.css'
import { ChartTip } from './ChartTip'
import type { Slice } from './types'

export type StackBarSeg = {
  key: string
  bottomPct: number
  heightPct: number
  color: string
  /** stack = 時系列 / total = Genres 合算 */
  variant: 'stack' | 'total'
  onClick: () => void
}

export type StackBarCol = {
  key: string
  label: string
  segs: StackBarSeg[]
}

/** IndividualChart / TotalsChart 共用の積み上げ棒 */
export function StackBars({
  columns,
  draw,
  tip,
  onCloseTip,
  wrapRef,
}: {
  columns: StackBarCol[]
  draw: boolean
  tip: Slice | null
  onCloseTip: () => void
  wrapRef: RefObject<HTMLDivElement | null>
}) {
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
          {columns.map((col) => (
            <div key={col.key} className={styles.stackCol}>
              <div className={styles.stackBar}>
                {/* 色セグメント層自体を clip-path で下から見せる（覆いマスク無し） */}
                <div
                  className={
                    draw
                      ? `${styles.fillStill} ${styles.fillRevealY}`
                      : styles.fillStill
                  }
                >
                  {draw &&
                    col.segs.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        className={
                          s.variant === 'total'
                            ? styles.totalSeg
                            : styles.stackSeg
                        }
                        style={{
                          bottom: `${s.bottomPct}%`,
                          height: `${s.heightPct}%`,
                          background: s.color,
                        }}
                        onClick={s.onClick}
                      />
                    ))}
                </div>
              </div>
              <span className={styles.stackLabel}>{col.label}</span>
            </div>
          ))}
        </div>
      </div>
      <ChartTip tip={tip} onClose={onCloseTip} />
    </div>
  )
}
