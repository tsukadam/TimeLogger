import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { daysInMonth, todayKey } from '../lib/time'
import { useScrollLock } from '../lib/useScrollLock'
import styles from './DateField.module.css'

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/**
 * LOG のカレンダーと同じ見た目の日付ピッカー。
 * 日を選んだ時点で確定して閉じる（Apply なし）。年は表示しない。
 */
export function DateField({
  value,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  /** "YYYY-MM-DD" */
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  'aria-label'?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useScrollLock(open)
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const t = todayKey()
    return { y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) }
  })

  useEffect(() => {
    if (!open) return
    const src = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayKey()
    setView({ y: Number(src.slice(0, 4)), m: Number(src.slice(5, 7)) })
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const shiftMonth = (d: number) => {
    let m = view.m + d
    let y = view.y
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    setView({ y, m })
  }

  const first = new Date(view.y, view.m - 1, 1)
  const padLead = (first.getDay() + 6) % 7 // 月曜はじまり
  const dim = daysInMonth(view.y, view.m)
  const cells: (string | null)[] = [
    ...Array.from({ length: padLead }, () => null),
    ...Array.from(
      { length: dim },
      (_, i) => `${view.y}-${pad2(view.m)}-${pad2(i + 1)}`,
    ),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className={styles.wrap} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        disabled={disabled}
        aria-label={ariaLabel ?? '日付を選ぶ'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.value}>
          {/* 年はカレンダー側の見出しにだけ出す（欄では月日だけで足りる） */}
          {value ? `${value.slice(5, 7)}/${value.slice(8, 10)}` : '--/--'}
        </span>
        <span className={styles.chevron} aria-hidden>
          ▾
        </span>
      </button>

      {open &&
        createPortal(
          <>
            {/* 外側タップで閉じる。button の click で消費するので背面へは通らない */}
            <button
              type="button"
              className={styles.overlay}
              aria-label="閉じる"
              onClick={() => setOpen(false)}
            />
            {/* 毎回同じ場所に出るよう画面中央に固定表示 */}
            <div className={styles.panel} role="dialog" aria-label="日付">
              <div className={styles.calHead}>
                <button
                  type="button"
                  className={styles.arrow}
                  onClick={() => shiftMonth(-1)}
                >
                  ‹
                </button>
                <span className={styles.calTitle}>
                  {view.y}年{view.m}月
                </span>
                <button
                  type="button"
                  className={styles.arrow}
                  onClick={() => shiftMonth(1)}
                >
                  ›
                </button>
              </div>
              <div className={styles.calWeekdays}>
                {['月', '火', '水', '木', '金', '土', '日'].map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className={styles.calGrid}>
                {cells.map((day, i) => {
                  if (!day)
                    return <span key={`e${i}`} className={styles.calEmpty} />
                  return (
                    <button
                      key={day}
                      type="button"
                      className={[
                        styles.calDay,
                        day === value ? styles.calDayOn : '',
                        day === todayKey() ? styles.calToday : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => {
                        onChange(day)
                        setOpen(false)
                      }}
                    >
                      {Number(day.slice(8, 10))}
                    </button>
                  )
                })}
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
