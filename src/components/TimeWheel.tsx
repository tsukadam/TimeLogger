import { useEffect, useRef, useState } from 'react'
import {
  DAY_MS,
  dateKey,
  dateTimeInputToIso,
  dayStartMs,
  isoToTimeInput,
  nowIso,
  pad2,
} from '../lib/time'
import { clipBoundWindow, type TimeBound } from '../state/eventSnap'
import styles from './TimeWheel.module.css'

const ITEM = 32
const HEIGHT = 160
const CENTER = HEIGHT / 2 - ITEM / 2
const GLIDE_MS = 320
const VEL_INERTIA_MIN = 0.0018
const MAX_GLIDE_ITEMS = 14
const ARM_MS = 280
const JUMP_STEPS = 8
/** 東京オフセット。DST 無しなので絶対時インデックスに使える */
const TOKYO_MS = 9 * 3600 * 1000

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

function timeToMs(date: string | undefined, value: string): number {
  const d = date || dateKey(nowIso())
  try {
    return new Date(dateTimeInputToIso(d, value)).getTime()
  } catch {
    return Date.now()
  }
}

function absSecond(ms: number) {
  return Math.floor(ms / 1000)
}
function absMinute(ms: number) {
  return Math.floor(ms / 60_000)
}
function absHour(ms: number) {
  return Math.floor((ms + TOKYO_MS) / 3_600_000)
}

function fromAbsSecond(s: number) {
  return s * 1000
}
function fromAbsMinuteKeepSec(m: number, currentMs: number) {
  return m * 60_000 + (currentMs - absMinute(currentMs) * 60_000)
}
function fromAbsHourKeepMinSec(h: number, currentMs: number) {
  const hourStart = h * 3_600_000 - TOKYO_MS
  const within = currentMs - (absHour(currentMs) * 3_600_000 - TOKYO_MS)
  return hourStart + within
}

/**
 * 有限の絶対インデックス列を、表示用には 0..n の相対位置で回す。
 * 表示は mod（時24・分秒60）なので 59 の次が 00 に見えるが、端の外側は無い。
 */
function FiniteColumn({
  label,
  minIdx,
  maxIdx,
  value,
  mod,
  armed,
  disabled,
  onPick,
}: {
  label: string
  minIdx: number
  maxIdx: number
  value: number
  mod: number
  armed: boolean
  disabled?: boolean
  onPick: (idx: number) => void
}) {
  const lo = Math.min(minIdx, maxIdx)
  const hi = Math.max(minIdx, maxIdx)
  const maxRel = hi - lo
  const relValue = Math.min(hi, Math.max(lo, value)) - lo
  const loRef = useRef(lo)
  loRef.current = lo

  const [pos, setPos] = useState(relValue)
  const posRef = useRef(pos)
  posRef.current = pos
  const committedRef = useRef(relValue)
  const syncedRef = useRef(false)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const samplesRef = useRef<{ t: number; p: number }[]>([])
  const wheelAccRef = useRef(0)
  const wheelTargetRef = useRef<number | null>(null)

  const stopAnim = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  useEffect(() => stopAnim, [])

  const clampPos = (p: number, rubber: boolean) => {
    const pad = rubber ? 0.35 : 0
    return Math.min(maxRel + pad, Math.max(-pad, p))
  }

  const applyPos = (p: number) => {
    const c = clampPos(p, true)
    setPos(c)
    posRef.current = c
    const r = Math.min(maxRel, Math.max(0, Math.round(c)))
    if (r !== committedRef.current) {
      committedRef.current = r
      onPick(loRef.current + r)
    }
  }

  const setVisualPos = (p: number) => {
    const c = clampPos(p, true)
    setPos(c)
    posRef.current = c
  }

  const jumpTo = (target: number) => {
    stopAnim()
    const dest = Math.min(maxRel, Math.max(0, target))
    setPos(dest)
    posRef.current = dest
    committedRef.current = dest
  }

  const animateTo = (target: number, ms: number, commit: boolean) => {
    stopAnim()
    const dest = Math.min(maxRel, Math.max(0, target))
    const from = posRef.current
    if (Math.abs(dest - from) < 0.001) {
      if (commit) applyPos(dest)
      else setVisualPos(dest)
      return
    }
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const p = from + (dest - from) * easeOutCubic(k)
      if (commit) applyPos(p)
      else setVisualPos(p)
      if (k < 1) rafRef.current = requestAnimationFrame(step)
      else rafRef.current = null
    }
    rafRef.current = requestAnimationFrame(step)
  }

  useEffect(() => {
    if (!syncedRef.current) {
      syncedRef.current = true
      jumpTo(relValue)
      return
    }
    if (draggingRef.current) return
    if (
      relValue === committedRef.current &&
      Math.abs(posRef.current - relValue) < 0.01
    ) {
      return
    }
    committedRef.current = relValue
    if (Math.abs(posRef.current - relValue) > JUMP_STEPS) {
      jumpTo(relValue)
      return
    }
    animateTo(relValue, 140, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relValue, lo, hi])

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!armed || disabled || draggingRef.current) return
    const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 100 : 1
    wheelAccRef.current += e.deltaY * scale
    const steps = Math.trunc(wheelAccRef.current / 100)
    if (steps === 0) return
    wheelAccRef.current -= steps * 100
    const base =
      rafRef.current !== null && wheelTargetRef.current !== null
        ? wheelTargetRef.current
        : Math.round(posRef.current)
    const target = Math.min(maxRel, Math.max(0, base + steps))
    wheelTargetRef.current = target
    animateTo(target, 160, true)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!armed || disabled) return
    stopAnim()
    wheelTargetRef.current = null
    wheelAccRef.current = 0
    draggingRef.current = true
    movedRef.current = false
    samplesRef.current = [{ t: performance.now(), p: posRef.current }]
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // pointerId が無効でも window リスナーで追従できる
    }
    const startY = e.clientY
    const startPos = posRef.current

    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) > 4) movedRef.current = true
      const p = startPos + (startY - ev.clientY) / ITEM
      setVisualPos(p)
      const now = performance.now()
      const arr = samplesRef.current
      arr.push({ t: now, p: posRef.current })
      while (arr.length > 2 && now - arr[0]!.t > 80) arr.shift()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      draggingRef.current = false
      const arr = samplesRef.current
      const last = arr[arr.length - 1]
      const first = arr[0]
      let vel = 0
      if (
        last &&
        first &&
        last.t > first.t &&
        performance.now() - last.t < 80
      ) {
        vel = (last.p - first.p) / (last.t - first.t)
      }
      let dest: number
      if (Math.abs(vel) < VEL_INERTIA_MIN) {
        dest = Math.round(posRef.current)
      } else {
        const excess = Math.abs(vel) - VEL_INERTIA_MIN
        const glide =
          Math.min(excess * GLIDE_MS, MAX_GLIDE_ITEMS) * Math.sign(vel)
        dest = Math.round(posRef.current + glide)
      }
      dest = Math.min(maxRel, Math.max(0, dest))
      const dist = Math.abs(dest - posRef.current)
      const ms =
        dist < 0.5 ? 140 : Math.max(180, Math.min(900, 140 + dist * 75))
      animateTo(dest, ms, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const base = Math.floor(pos)
  const items: { key: number; y: number; num: number }[] = []
  for (let i = base - 3; i <= base + 4; i++) {
    if (i < 0 || i > maxRel) continue
    const abs = lo + i
    items.push({
      key: abs,
      y: CENTER + (i - pos) * ITEM,
      num: ((abs % mod) + mod) % mod,
    })
  }
  const activeRel = Math.min(maxRel, Math.max(0, Math.round(pos)))

  return (
    <div
      className={styles.column}
      role="listbox"
      aria-label={label}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
    >
      {items.map((it) => (
        <button
          type="button"
          key={it.key}
          role="option"
          aria-selected={it.key === lo + activeRel}
          className={
            it.key === lo + activeRel ? styles.itemActive : styles.item
          }
          style={{ transform: `translateY(${it.y}px)` }}
          disabled={disabled || !armed}
          onClick={() => {
            if (!armed || draggingRef.current || movedRef.current) return
            animateTo(it.key - lo, 200, true)
          }}
        >
          {pad2(it.num)}
        </button>
      ))}
    </div>
  )
}

/** iOS 風ドラムロール。見かけは循環、中身は合法範囲の絶対時分秒 */
export function TimeWheel({
  value,
  onChange,
  onDayChange,
  disabled,
  date,
  bound,
}: {
  /** "HH:mm:ss" */
  value: string
  onChange: (v: string) => void
  onDayChange?: (deltaDays: number) => void
  disabled?: boolean
  date?: string
  bound?: TimeBound
}) {
  const currentMs = timeToMs(date, value)
  const [range] = useState(() => clipBoundWindow(bound, currentMs))
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), ARM_MS)
    return () => window.clearTimeout(t)
  }, [])

  const valueRef = useRef(value)
  valueRef.current = value
  const dateRef = useRef(date)
  dateRef.current = date
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onDayChangeRef = useRef(onDayChange)
  onDayChangeRef.current = onDayChange
  const rangeRef = useRef(range)
  rangeRef.current = range
  const currentMsRef = useRef(currentMs)
  currentMsRef.current = currentMs

  const emitMs = (ms: number) => {
    const b = rangeRef.current
    const clamped = Math.min(b.maxMs, Math.max(b.minMs, ms))
    const iso = nowIso(new Date(clamped))
    const cDate = dateKey(iso)
    const cTime = isoToTimeInput(iso)
    if (cTime !== valueRef.current) onChangeRef.current(cTime)
    const d = dateRef.current
    if (d) {
      const days = Math.round((dayStartMs(cDate) - dayStartMs(d)) / DAY_MS)
      if (days !== 0) onDayChangeRef.current?.(days)
    }
  }

  const secLo = absSecond(range.minMs)
  const secHi = absSecond(range.maxMs)
  const minLo = absMinute(range.minMs)
  const minHi = absMinute(range.maxMs)
  const hourLo = absHour(range.minMs)
  const hourHi = absHour(range.maxMs)

  const secVal = Math.min(secHi, Math.max(secLo, absSecond(currentMs)))
  const minVal = Math.min(minHi, Math.max(minLo, absMinute(currentMs)))
  const hourVal = Math.min(hourHi, Math.max(hourLo, absHour(currentMs)))

  return (
    <div
      className={styles.root}
      style={armed ? undefined : { pointerEvents: 'none' }}
    >
      <div className={styles.highlight} aria-hidden />
      <FiniteColumn
        label="時"
        minIdx={hourLo}
        maxIdx={hourHi}
        value={hourVal}
        mod={24}
        armed={armed}
        disabled={disabled}
        onPick={(idx) =>
          emitMs(fromAbsHourKeepMinSec(idx, currentMsRef.current))
        }
      />
      <span className={styles.sep} aria-hidden>
        :
      </span>
      <FiniteColumn
        label="分"
        minIdx={minLo}
        maxIdx={minHi}
        value={minVal}
        mod={60}
        armed={armed}
        disabled={disabled}
        onPick={(idx) =>
          emitMs(fromAbsMinuteKeepSec(idx, currentMsRef.current))
        }
      />
      <span className={styles.sep} aria-hidden>
        :
      </span>
      <FiniteColumn
        label="秒"
        minIdx={secLo}
        maxIdx={secHi}
        value={secVal}
        mod={60}
        armed={armed}
        disabled={disabled}
        onPick={(idx) => emitMs(fromAbsSecond(idx))}
      />
    </div>
  )
}
