import { useRef, useState } from 'react'
import { useOutsideClose } from '../../lib/useOutsideClose'
import styles from '../LogScreen.module.css'
import { ChartTip } from './ChartTip'
import type { Slice, TotalCol } from './types'

export function TotalsChart({
  columns,
  draw = true,
}: {
  columns: TotalCol[]
  /** false の間は下地トラックだけ描く（タブ切替アニメ中の負荷回避） */
  draw?: boolean
}) {
  const n = Math.max(columns.length, 1)
  // タップで表示するタスク名（月単位の合算値）
  const [tip, setTip] = useState<{ key: string; slice: Slice } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useOutsideClose(wrapRef, tip !== null, () => setTip(null))
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
            let acc = 0
            return (
              <div key={col.key} className={styles.stackCol}>
                <div className={styles.stackBar}>
                  <div className={styles.fillStill}>
                    {draw &&
                      col.parts.map((p) => {
                        const bottom = (acc / col.spanSec) * 100
                        acc += p.sec
                        const segKey = `${col.key}:${p.id}`
                        return (
                          <button
                            key={p.id}
                            type="button"
                            className={styles.totalSeg}
                            style={{
                              bottom: `${bottom}%`,
                              height: `${(p.sec / col.spanSec) * 100}%`,
                              background: p.color,
                            }}
                            onClick={() =>
                              setTip((cur) =>
                                cur?.key === segKey
                                  ? null
                                  : { key: segKey, slice: p },
                              )
                            }
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
      <ChartTip tip={tip?.slice ?? null} onClose={() => setTip(null)} />
    </div>
  )
}
