import { useEffect, useRef, useState } from 'react'
import { DAY_SEC, pad2 } from '../lib/time'
import styles from './TimeWheel.module.css'

const ITEM = 32
const HEIGHT = 160
const CENTER = HEIGHT / 2 - ITEM / 2
// 慣性: 離した瞬間の速度に掛ける滑走時間（速いフリックほどよく回る）
const GLIDE_MS = 320
// これ未満の速度（items/ms）では慣性なし＝最寄りへ穏やかにスナップ
const VEL_INERTIA_MIN = 0.0018
const MAX_GLIDE_ITEMS = 14

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
 * - ドラッグ中は見た目だけ動かし、離したときに確定・慣性
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
  // マウスホイール用: 累積 deltaY と、連続回転中の行き先
  const wheelAccRef = useRef(0)
  const wheelTargetRef = useRef<number | null>(null)

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

  /** ドラッグ中は見た目だけ動かし、確定（親への commit）は離してから */
  const setVisualPos = (p: number) => {
    setPos(p)
    posRef.current = p
  }

  /** commit: 移動中も最寄り値を親へ流し込むか */
  const animateTo = (target: number, ms: number, commit: boolean) => {
    stopAnim()
    const from = posRef.current
    if (Math.abs(target - from) < 0.001) {
      if (commit) applyPos(target)
      else {
        setVisualPos(target)
      }
      return
    }
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const p = from + (target - from) * easeOutCubic(k)
      if (commit) applyPos(p)
      else setVisualPos(p)
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

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (disabled || draggingRef.current) return
    // ノッチ式ホイール1目盛り（deltaY≒100）で1ステップ。トラックパッドは累積で追従
    const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 100 : 1
    wheelAccRef.current += e.deltaY * scale
    const steps = Math.trunc(wheelAccRef.current / 100)
    if (steps === 0) return
    wheelAccRef.current -= steps * 100
    // アニメ中に続けて回したら、現在位置ではなく行き先を基準に積み増す
    const base =
      rafRef.current !== null && wheelTargetRef.current !== null
        ? wheelTargetRef.current
        : Math.round(posRef.current)
    const target = base + steps
    wheelTargetRef.current = target
    animateTo(target, 160, true)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    stopAnim()
    wheelTargetRef.current = null
    wheelAccRef.current = 0
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
      // 指が付いている間は 1:1。慣性も中間コミットもしない
      const p = startPos + (startY - ev.clientY) / ITEM
      setVisualPos(p)
      const now = performance.now()
      const arr = samplesRef.current
      arr.push({ t: now, p })
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
      // 指を止めてから離した場合は慣性なし（古いサンプルで滑らないように）
      if (
        last &&
        first &&
        last.t > first.t &&
        performance.now() - last.t < 80
      ) {
        vel = (last.p - first.p) / (last.t - first.t) // items/ms
      }
      // 遅い・穏やかな操作は最寄りへスナップのみ。速いフリックだけ慣性
      let dest: number
      if (Math.abs(vel) < VEL_INERTIA_MIN) {
        dest = Math.round(posRef.current)
      } else {
        const excess = Math.abs(vel) - VEL_INERTIA_MIN
        const glide = Math.min(excess * GLIDE_MS, MAX_GLIDE_ITEMS) * Math.sign(vel)
        dest = Math.round(posRef.current + glide)
      }
      const dist = Math.abs(dest - posRef.current)
      // 短い距離は短く・長い滑走は長め（穏やかなスナップは軽快に）
      const ms =
        dist < 0.5
          ? 140
          : Math.max(180, Math.min(900, 140 + dist * 75))
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
      onWheel={onWheel}
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
          {pad2(it.num)}
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
      onChange(
        `${pad2(Math.floor(next / 3600))}:${pad2(Math.floor(next / 60) % 60)}:${pad2(next % 60)}`,
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
