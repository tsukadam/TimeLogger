import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TimeWheel } from './TimeWheel'
import { useScrollLock } from '../lib/useScrollLock'
import styles from './TimeField.module.css'

/** タップでむき出しのドラムロール。外側タップでその値を確定 */
export function TimeField({
  value,
  onChange,
  onDayChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  /** ロールが 23→0 / 0→23 を跨いだとき、日付を前後させるために呼ばれる */
  onDayChange?: (deltaDays: number) => void
  disabled?: boolean
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

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') commitClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
        <span className={styles.chevron} aria-hidden>
          ▾
        </span>
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
              />
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
