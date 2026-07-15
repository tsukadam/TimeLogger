import { useEffect, useRef, useState } from 'react'
import styles from './TimeWheel.module.css'

const ITEM = 32
const HEIGHT = 160
const CENTER = HEIGHT / 2 - ITEM / 2
// 慣性: 離した速度 × この時間ぶんだけ滑走する（大きいほどよく回る）
const GLIDE_MS = 280
const DAY_SEC = 86400

function parseTime(value: string): [number, number, number] {
  const m = value.trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (!m) return [0, 0, 0]
  return [
    Math.min(23, Number(m[1])),
    Math.min(59, Number(m[2])),
    Math.min(59, Number(m[3] ?? 0)),
  ]
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

/** from に最も近い、mod 上で target と合同な値 */
function nearestCongruent(from: number, target: number, mod: number) {
  const delta = (((target - from) % mod) + mod) % mod
  return from + (delta <= mod / 2 ? delta : delta - mod)
}

/**
 * 1桁ぶんのドラムロール（ポインター駆動・慣性つき・無限軌道）
 * - 回すと桁上げ/下げが総秒（さらには日付）へ伝播する
 * - 回転中も常に最寄り値を onCommit で親へ伝える（途中で閉じても確定できる）
 */
function WheelColumn({
  label,
  mod,
  value,
  disabled,
  onCommit,
}: {
  label: string
  mod: number
  value: number
  disabled?: boolean
  onCommit: (deltaSteps: number) => void
}) {
  const [pos, setPos] = useState<number>(value)
  const posRef = useRef(pos)
  posRef.current = pos
  // 仮想インデックス空間での確定済み位置（mod を跨いで増減する）
  const committedRef = useRef(value)
  const draggingRef = useRef(false)
  // ドラッグ直後の click で項目選択が誤発火しないように
  const movedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const samplesRef = useRef<{ t: number; p: number }[]>([])

  const stopAnim = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  useEffect(() => stopAnim, [])

  const applyPos = (p: number) => {
    setPos(p)
    posRef.current = p
    const r = Math.round(p)
    if (r !== committedRef.current) {
      const d = r - committedRef.current
      committedRef.current = r
      onCommit(d)
    }
  }

  /** commit: 移動中も最寄り値を親へ流し込むか */
  const animateTo = (target: number, ms: number, commit: boolean) => {
    stopAnim()
    const from = posRef.current
    if (Math.abs(target - from) < 0.001) {
      if (commit) applyPos(target)
      else {
        setPos(target)
        posRef.current = target
      }
      return
    }
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const p = from + (target - from) * easeOutCubic(k)
      if (commit) applyPos(p)
      else {
        setPos(p)
        posRef.current = p
      }
      if (k < 1) rafRef.current = requestAnimationFrame(step)
      else rafRef.current = null
    }
    rafRef.current = requestAnimationFrame(step)
  }

  // 外部変更（初期値・他桁からの桁上げ下げ）に追従
  useEffect(() => {
    if (draggingRef.current) return
    // 自分の慣性アニメ中でも、自分発の commit なら committedRef が既に一致している
    const cur = committedRef.current
    const curMod = ((cur % mod) + mod) % mod
    if (curMod === value) return
    stopAnim()
    const target = nearestCongruent(posRef.current, value, mod)
    committedRef.current = Math.round(target)
    animateTo(target, 140, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mod])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    stopAnim()
    draggingRef.current = true
    movedRef.current = false
    samplesRef.current = [{ t: performance.now(), p: posRef.current }]
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 一部環境で pointerId が無効な場合があるが、window リスナーで追従できる
    }
    const startY = e.clientY
    const startPos = posRef.current

    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) > 4) movedRef.current = true
      const p = startPos + (startY - ev.clientY) / ITEM
      applyPos(p)
      const now = performance.now()
      const arr = samplesRef.current
      arr.push({ t: now, p })
      while (arr.length > 2 && now - arr[0]!.t > 100) arr.shift()
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
      // 指を止めてから離した場合は慣性なし（古いサンプルで滑らないように）
      if (
        last &&
        first &&
        last.t > first.t &&
        performance.now() - last.t < 80
      ) {
        vel = (last.p - first.p) / (last.t - first.t) // items/ms
      }
      // 慣性の行き先を速度から見積もり、最寄り項目へスナップ
      const dest = Math.round(posRef.current + vel * GLIDE_MS)
      const dist = Math.abs(dest - posRef.current)
      const ms = Math.max(180, Math.min(850, 160 + dist * 70))
      animateTo(dest, ms, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  // 表示する項目（現在位置の前後）
  const base = Math.floor(pos)
  const items: { key: number; y: number; num: number }[] = []
  for (let i = base - 3; i <= base + 4; i++) {
    items.push({
      key: i,
      y: CENTER + (i - pos) * ITEM,
      num: ((i % mod) + mod) % mod,
    })
  }
  const active = Math.round(pos)

  return (
    <div
      className={styles.column}
      role="listbox"
      aria-label={label}
      onPointerDown={onPointerDown}
    >
      {items.map((it) => (
        <button
          type="button"
          key={it.key}
          role="option"
          aria-selected={it.key === active}
          className={it.key === active ? styles.itemActive : styles.item}
          style={{ transform: `translateY(${it.y}px)` }}
          disabled={disabled}
          onClick={() => {
            if (draggingRef.current || movedRef.current) return
            animateTo(it.key, 200, true)
          }}
        >
          {String(it.num).padStart(2, '0')}
        </button>
      ))}
    </div>
  )
}

/** iOS 風ドラムロールの時刻ピッカー（24時間・時分秒・全桁無限軌道） */
export function TimeWheel({
  value,
  onChange,
  onDayChange,
  disabled,
}: {
  /** "HH:mm:ss" */
  value: string
  onChange: (v: string) => void
  /** 23→0（+1日）/ 0→23（-1日）と日を跨いだときに呼ばれる */
  onDayChange?: (deltaDays: number) => void
  disabled?: boolean
}) {
  const [h, m, s] = parseTime(value)
  const total = h * 3600 + m * 60 + s
  const totalRef = useRef(total)
  totalRef.current = total

  const commit = (deltaSteps: number, unit: number) => {
    const raw = totalRef.current + deltaSteps * unit
    const dayDelta = Math.floor(raw / DAY_SEC)
    const next = raw - dayDelta * DAY_SEC
    if (next !== totalRef.current) {
      totalRef.current = next
      const pad = (n: number) => String(n).padStart(2, '0')
      onChange(
        `${pad(Math.floor(next / 3600))}:${pad(Math.floor(next / 60) % 60)}:${pad(next % 60)}`,
      )
    }
    if (dayDelta !== 0) onDayChange?.(dayDelta)
  }

  return (
    <div className={styles.root}>
      <div className={styles.highlight} aria-hidden />
      <WheelColumn
        label="時"
        mod={24}
        value={h}
        disabled={disabled}
        onCommit={(d) => commit(d, 3600)}
      />
      <span className={styles.sep} aria-hidden>
        :
      </span>
      <WheelColumn
        label="分"
        mod={60}
        value={m}
        disabled={disabled}
        onCommit={(d) => commit(d, 60)}
      />
      <span className={styles.sep} aria-hidden>
        :
      </span>
      <WheelColumn
        label="秒"
        mod={60}
        value={s}
        disabled={disabled}
        onCommit={(d) => commit(d, 1)}
      />
    </div>
  )
}
