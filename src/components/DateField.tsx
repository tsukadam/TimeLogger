import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { todayKey } from '../lib/time'
import { useEscapeClose } from '../lib/useOutsideClose'
import { useScrollLock } from '../lib/useScrollLock'
import { MonthCalendar } from './MonthCalendar'
import styles from './DateField.module.css'

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

  useEscapeClose(open, () => setOpen(false))

  return (
    <div className={styles.wrap}>
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
              <MonthCalendar
                viewYm={view}
                onViewYm={setView}
                mode="single"
                selectedDay={value}
                onPickDay={(day) => {
                  onChange(day)
                  setOpen(false)
                }}
              />
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
