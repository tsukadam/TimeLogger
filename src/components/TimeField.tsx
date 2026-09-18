import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TimeWheel } from './TimeWheel'
import { useEscapeClose } from '../lib/useOutsideClose'
import { useScrollLock } from '../lib/useScrollLock'
import styles from './TimeField.module.css'
import type { TimeBound } from '../state/eventSnap'

/** タップでむき出しのドラムロール。外側タップでその値を確定 */
export function TimeField({
  value,
  onChange,
  onDayChange,
  disabled,
  hideChevron,
  date,
  bound,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  /** ロールが 23→0 / 0→23 を跨いだとき、日付を前後させるために呼ばれる */
  onDayChange?: (deltaDays: number) => void
  disabled?: boolean
  hideChevron?: boolean
  date?: string
  bound?: TimeBound
  'aria-label'?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  draftRef.current = draft
  useScrollLock(open)

  const commitClose = () => {
    onChange(draftRef.current)
    setOpen(false)
  }

  useEffect(() => {
    if (open) {
      setDraft(value)
      draftRef.current = value
    }
  }, [open, value])

  useEffect(() => {
    if (!open || !rootRef.current) return
    const r = rootRef.current.getBoundingClientRect()
    const panelW = 280
    const left = Math.min(
      Math.max(8, r.left + r.width / 2 - panelW / 2),
      window.innerWidth - panelW - 8,
    )
    // 欄の下に出す。画面下にはみ出すなら上側へ
    const below = r.bottom + 6
    const top =
      below + 180 > window.innerHeight - 8
        ? Math.max(8, r.top - 180 - 6)
        : below
    setPos({ top, left })
  }, [open])

  useEscapeClose(open, commitClose)

  return (
    <div className={styles.wrap} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        disabled={disabled}
        aria-label={ariaLabel ?? '時刻を選ぶ'}
        aria-expanded={open}
        onClick={() => {
          if (open) commitClose()
          else setOpen(true)
        }}
      >
        <span className={styles.value}>{value || '--:--:--'}</span>
        {!hideChevron && (
          <span className={styles.chevron} aria-hidden>
            ▾
          </span>
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            {/* 外側タップで確定して閉じる。button の click で消費するので背面へは通らない */}
            <button
              type="button"
              className={styles.overlay}
              aria-label="確定して閉じる"
              onClick={commitClose}
            />
            <div
              className={styles.panel}
              style={{ top: pos.top, left: pos.left }}
              role="dialog"
              aria-label="時刻"
            >
              <TimeWheel
                value={draft}
                onChange={(v) => {
                  setDraft(v)
                  draftRef.current = v
                }}
                onDayChange={onDayChange}
                date={date}
                bound={bound}
              />
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}

/** Activity の ⇔ など、トリガー無しで同じドラムを出す */
export function TimeWheelPopover({
  value,
  date,
  bound,
  pos,
  onChange,
  onDayChange,
  onClose,
}: {
  value: string
  date: string
  bound: TimeBound
  pos: { top: number; left: number }
  onChange: (v: string) => void
  onDayChange?: (deltaDays: number) => void
  onClose: (value: string) => void
}) {
  const draftRef = useRef(value)
  draftRef.current = value
  useScrollLock(true)
  const commitClose = () => {
    const v = draftRef.current
    onChange(v)
    onClose(v)
  }
  useEscapeClose(true, commitClose)
  return createPortal(
    <>
      <button
        type="button"
        className={styles.overlay}
        aria-label="確定して閉じる"
        onClick={commitClose}
      />
      <div
        className={styles.panel}
        style={{ top: pos.top, left: pos.left }}
        role="dialog"
        aria-label="時刻"
      >
        <TimeWheel
          value={value}
          onChange={(v) => {
            draftRef.current = v
            onChange(v)
          }}
          onDayChange={onDayChange}
          date={date}
          bound={bound}
        />
      </div>
    </>,
    document.body,
  )
}
