import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { TimeWheel } from './TimeWheel'
import { useEscapeClose } from '../lib/useOutsideClose'
import { useScrollLock } from '../lib/useScrollLock'
import {
  placePanel,
  rectToAnchor,
  type PanelAnchor,
  type PanelPos,
} from '../lib/placePanel'
import styles from './TimeField.module.css'
import type { TimeBound } from '../state/eventSnap'

const PANEL_W = 280
const PANEL_H = 180

function posFromAnchor(anchor: PanelAnchor, size?: { width: number; height: number }): PanelPos {
  return placePanel(anchor, size ?? { width: PANEL_W, height: PANEL_H })
}

function TimeWheelDialog({
  pos,
  panelRef,
  value,
  onChange,
  onDayChange,
  date,
  bound,
}: {
  pos: PanelPos
  panelRef: RefObject<HTMLDivElement | null>
  value: string
  onChange: (v: string) => void
  onDayChange?: (deltaDays: number) => void
  date?: string
  bound?: TimeBound
}) {
  return (
    <div
      ref={panelRef}
      className={styles.panel}
      style={{ top: pos.top, left: pos.left, width: pos.width }}
      role="dialog"
      aria-label="時刻"
    >
      <TimeWheel
        value={value}
        onChange={onChange}
        onDayChange={onDayChange}
        date={date}
        bound={bound}
      />
    </div>
  )
}

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
  const panelRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<PanelAnchor | null>(null)
  const [pos, setPos] = useState<PanelPos | null>(null)

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

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !anchorRef.current) return
    const r = panelRef.current.getBoundingClientRect()
    const next = posFromAnchor(anchorRef.current, {
      width: r.width,
      height: r.height,
    })
    setPos((cur) =>
      cur &&
      Math.abs(cur.left - next.left) < 0.5 &&
      Math.abs(cur.top - next.top) < 0.5 &&
      Math.abs(cur.width - next.width) < 0.5
        ? cur
        : next,
    )
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
          if (open) {
            commitClose()
            return
          }
          if (!rootRef.current) return
          const anchor = rectToAnchor(rootRef.current.getBoundingClientRect())
          anchorRef.current = anchor
          setPos(posFromAnchor(anchor))
          setOpen(true)
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
            <TimeWheelDialog
              pos={pos}
              panelRef={panelRef}
              value={draft}
              onChange={(v) => {
                setDraft(v)
                draftRef.current = v
              }}
              onDayChange={onDayChange}
              date={date}
              bound={bound}
            />
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
  anchor,
  onChange,
  onDayChange,
  onClose,
}: {
  value: string
  date: string
  bound: TimeBound
  anchor: PanelAnchor
  onChange: (v: string) => void
  onDayChange?: (deltaDays: number) => void
  onClose: (value: string) => void
}) {
  const draftRef = useRef(value)
  draftRef.current = value
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<PanelPos>(() => posFromAnchor(anchor))
  useScrollLock(true)
  const commitClose = () => {
    const v = draftRef.current
    onChange(v)
    onClose(v)
  }
  useEscapeClose(true, commitClose)

  useLayoutEffect(() => {
    if (!panelRef.current) return
    const r = panelRef.current.getBoundingClientRect()
    const next = posFromAnchor(anchor, { width: r.width, height: r.height })
    setPos((cur) =>
      cur &&
      Math.abs(cur.left - next.left) < 0.5 &&
      Math.abs(cur.top - next.top) < 0.5 &&
      Math.abs(cur.width - next.width) < 0.5
        ? cur
        : next,
    )
  }, [anchor])

  return createPortal(
    <>
      <button
        type="button"
        className={styles.overlay}
        aria-label="確定して閉じる"
        onClick={commitClose}
      />
      <TimeWheelDialog
        pos={pos}
        panelRef={panelRef}
        value={value}
        onChange={(v) => {
          draftRef.current = v
          onChange(v)
        }}
        onDayChange={onDayChange}
        date={date}
        bound={bound}
      />
    </>,
    document.body,
  )
}
