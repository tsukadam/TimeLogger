import { useEffect, useRef } from 'react'
import styles from './TimeWheel.module.css'

const ITEM = 32

function parseTime(value: string): [number, number, number] {
  const m = value.trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (!m) return [0, 0, 0]
  return [
    Math.min(23, Number(m[1])),
    Math.min(59, Number(m[2])),
    Math.min(59, Number(m[3] ?? 0)),
  ]
}

function WheelColumn({
  count,
  value,
  disabled,
  label,
  onChange,
}: {
  count: number
  value: number
  disabled?: boolean
  label: string
  onChange: (v: number) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const timer = useRef<number | null>(null)

  // 外部から値が変わったとき（初期表示含む）にその位置へ
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const target = value * ITEM
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target
  }, [value])

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  const settle = () => {
    const el = ref.current
    if (!el) return
    const idx = Math.max(0, Math.min(count - 1, Math.round(el.scrollTop / ITEM)))
    if (idx !== value) onChange(idx)
  }

  return (
    <div
      ref={ref}
      className={styles.column}
      role="listbox"
      aria-label={label}
      onScroll={() => {
        if (timer.current !== null) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(settle, 140)
      }}
    >
      <div className={styles.spacer} aria-hidden />
      {Array.from({ length: count }, (_, i) => (
        <button
          type="button"
          key={i}
          role="option"
          aria-selected={i === value}
          className={i === value ? styles.itemActive : styles.item}
          disabled={disabled}
          onClick={() => {
            onChange(i)
            ref.current?.scrollTo({ top: i * ITEM, behavior: 'smooth' })
          }}
        >
          {String(i).padStart(2, '0')}
        </button>
      ))}
      <div className={styles.spacer} aria-hidden />
    </div>
  )
}

/** iOS 風ドラムロールの時刻ピッカー（24時間・時分秒） */
export function TimeWheel({
  value,
  onChange,
  disabled,
}: {
  /** "HH:mm:ss" */
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const [h, m, s] = parseTime(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  const set = (hh: number, mm: number, ss: number) =>
    onChange(`${pad(hh)}:${pad(mm)}:${pad(ss)}`)

  return (
    <div className={styles.root}>
      <div className={styles.highlight} aria-hidden />
      <WheelColumn
        count={24}
        value={h}
        disabled={disabled}
        label="時"
        onChange={(v) => set(v, m, s)}
      />
      <span className={styles.sep} aria-hidden>
        :
      </span>
      <WheelColumn
        count={60}
        value={m}
        disabled={disabled}
        label="分"
        onChange={(v) => set(h, v, s)}
      />
      <span className={styles.sep} aria-hidden>
        :
      </span>
      <WheelColumn
        count={60}
        value={s}
        disabled={disabled}
        label="秒"
        onChange={(v) => set(h, m, v)}
      />
    </div>
  )
}
