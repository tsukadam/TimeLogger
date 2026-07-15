import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { EventEditModal } from '../components/EventEditModal'
import { FolderIcon } from '../components/FolderIcon'
import {
  addDaysKey,
  dateKey,
  dayStartMs,
  daysInMonth,
  durationLabel,
  formatDurationHms,
  formatEventRange,
  mondayKeyOf,
  nowIso,
  todayKey,
} from '../lib/time'
import { useScrollLock } from '../lib/useScrollLock'
import { useStore } from '../state/Store'
import type { Event, Folder, LogKind, LogPrefs, Task } from '../types'
import styles from './LogScreen.module.css'

type AppliedRange = {
  kind: LogKind
  start: number
  end: number
  label: string
}

type Slice = {
  id: string
  name: string
  color: string
  sec: number
}

type Seg = {
  eventId: string
  color: string
  name: string
  start: number
  end: number
}

type Column = {
  key: string
  label: string
  start: number
  end: number
  segs: Seg[]
}

type TotalCol = {
  key: string
  label: string
  spanSec: number
  parts: Slice[]
}

// Month サマリーで表示する日付ラベル（全日表示だと重なるため）
const MONTH_LABEL_DAYS = [1, 5, 10, 15, 20, 25, 30]

// 円グラフのスイープ描画にかける時間（ラベルはこの後にフェードイン）
const SWEEP_MS = 350

const DAY_MS = 86400000
const MONTH_NAMES = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
]

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function ymParts(dayKey: string) {
  return {
    y: Number(dayKey.slice(0, 4)),
    m: Number(dayKey.slice(5, 7)),
  }
}

function monthKey(y: number, m: number) {
  return `${y}-${pad2(m)}-01`
}

function md(dayKey: string) {
  return `${Number(dayKey.slice(5, 7))}/${Number(dayKey.slice(8, 10))}`
}

function ymd(dayKey: string) {
  return `${Number(dayKey.slice(0, 4))}/${md(dayKey)}`
}

function weekdayShort(dayKey: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  }).format(new Date(dayStartMs(dayKey)))
}

/**
 * 日付キーへ n ヶ月加算。同日が無い月（例: 1/31 の1ヶ月後）は翌月1日へ繰り上げる
 */
function addMonthsKey(dayKey: string, n: number): string {
  const y = Number(dayKey.slice(0, 4))
  const m = Number(dayKey.slice(5, 7))
  const d = Number(dayKey.slice(8, 10))
  const total = m - 1 + n
  let y2 = y + Math.floor(total / 12)
  let m2 = (((total % 12) + 12) % 12) + 1
  if (d > daysInMonth(y2, m2)) {
    m2 += 1
    if (m2 > 12) {
      m2 = 1
      y2 += 1
    }
    return `${y2}-${pad2(m2)}-01`
  }
  return `${y2}-${pad2(m2)}-${pad2(d)}`
}

function makeDefaultPrefs(now = new Date()): LogPrefs {
  const t = todayKey(now)
  const { y, m } = ymParts(t)
  return {
    kind: 'day',
    day: t,
    weekStart: mondayKeyOf(t),
    monthStart: monthKey(y, m),
    yearStart: monthKey(y, 1),
    customStart: t,
    customEnd: t,
    customApplied: null,
  }
}

/** 保存済み設定の読み込み。旧形式（monthYear/month/year）からも移行する */
function normalizePrefs(p: LogPrefs | null): LogPrefs | null {
  if (!p) return null
  const old = p as Partial<LogPrefs> & {
    monthYear?: number
    month?: number
    year?: number
  }
  const def = makeDefaultPrefs()
  return {
    ...def,
    ...p,
    monthStart:
      old.monthStart ??
      (old.monthYear && old.month
        ? monthKey(old.monthYear, old.month)
        : def.monthStart),
    yearStart:
      old.yearStart ?? (old.year ? monthKey(old.year, 1) : def.yearStart),
  }
}

function resolveDisplay(ev: Event, tasks: Task[], folders: Folder[]) {
  const task = tasks.find((t) => t.id === ev.taskId)
  const folderId = task?.folderId ?? ev.folderId
  const folder = folders.find((f) => f.id === folderId)
  return {
    taskId: ev.taskId,
    folderId,
    taskName: task?.name ?? ev.taskName,
    taskColor: task?.color ?? ev.taskColor,
    folderName: folder?.name ?? ev.folderName,
    folderColor: folder?.color ?? ev.folderColor,
  }
}

function clipSegs(
  events: Event[],
  tasks: Task[],
  folders: Folder[],
  colStart: number,
  colEnd: number,
  nowMs: number,
): Seg[] {
  const out: Seg[] = []
  for (const ev of events) {
    const s = new Date(ev.startedAt).getTime()
    const e = ev.endedAt ? new Date(ev.endedAt).getTime() : nowMs
    const a = Math.max(s, colStart)
    const b = Math.min(e, colEnd)
    if (!(b > a)) continue
    const d = resolveDisplay(ev, tasks, folders)
    out.push({
      eventId: ev.id,
      color: d.taskColor,
      name: d.taskName,
      start: a,
      end: b,
    })
  }
  out.sort((a, b) => a.start - b.start)
  return out
}

function buildApplied(prefs: LogPrefs, nowMs: number, events: Event[]): AppliedRange {
  const kind = prefs.kind
  if (kind === 'all') {
    if (events.length === 0) {
      const t = todayKey(new Date(nowMs))
      const s = dayStartMs(t)
      return { kind, start: s, end: s + DAY_MS, label: 'すべて' }
    }
    let min = Infinity
    for (const e of events) min = Math.min(min, new Date(e.startedAt).getTime())
    return { kind, start: min, end: nowMs, label: 'すべて' }
  }
  if (kind === 'day') {
    const start = dayStartMs(prefs.day)
    return {
      kind,
      start,
      end: start + DAY_MS,
      label: `${md(prefs.day)}（${weekdayShort(prefs.day)}）`,
    }
  }
  if (kind === 'week') {
    const start = dayStartMs(prefs.weekStart)
    const endKey = addDaysKey(prefs.weekStart, 6)
    return {
      kind,
      start,
      end: start + 7 * DAY_MS,
      label: `${md(prefs.weekStart)}（${weekdayShort(prefs.weekStart)}）〜 ${md(endKey)}（${weekdayShort(endKey)}）`,
    }
  }
  if (kind === 'month') {
    // 基準日から1ヶ月間
    const start = dayStartMs(prefs.monthStart)
    const endKeyEx = addMonthsKey(prefs.monthStart, 1)
    const lastKey = addDaysKey(endKeyEx, -1)
    const { y, m } = ymParts(prefs.monthStart)
    const isFirst = prefs.monthStart.slice(8, 10) === '01'
    return {
      kind,
      start,
      end: dayStartMs(endKeyEx),
      label: isFirst
        ? `${y}年${m}月`
        : `${md(prefs.monthStart)}（${weekdayShort(prefs.monthStart)}）〜 ${md(lastKey)}（${weekdayShort(lastKey)}）`,
    }
  }
  if (kind === 'year') {
    // 基準月から1年間
    const { y, m } = ymParts(prefs.yearStart)
    const lastYm = ymParts(addMonthsKey(prefs.yearStart, 11))
    return {
      kind,
      start: dayStartMs(prefs.yearStart),
      end: dayStartMs(addMonthsKey(prefs.yearStart, 12)),
      label:
        m === 1
          ? `${y}年`
          : `${y}年${m}月 〜 ${lastYm.y}年${lastYm.m}月`,
    }
  }
  // custom: 未Applyなら当日1日
  const applied = prefs.customApplied
  const a = applied?.start ?? todayKey(new Date(nowMs))
  const b = applied?.end ?? a
  const lo = a <= b ? a : b
  const hi = a <= b ? b : a
  return {
    kind,
    start: dayStartMs(lo),
    end: dayStartMs(hi) + DAY_MS,
    label: applied
      ? `${md(lo)}（${weekdayShort(lo)}）〜 ${md(hi)}（${weekdayShort(hi)}）`
      : `${md(lo)}（${weekdayShort(lo)}）`,
  }
}

function MonthCalendar({
  viewYm,
  onViewYm,
  mode,
  selectedDay,
  selectedWeekStart,
  selectedMonthStart,
  highlightStart,
  highlightEnd,
  onPickDay,
  maxYear,
}: {
  viewYm: { y: number; m: number }
  onViewYm: (v: { y: number; m: number }) => void
  mode: 'day' | 'week' | 'month' | 'custom'
  selectedDay?: string
  selectedWeekStart?: string
  selectedMonthStart?: string
  highlightStart?: string
  highlightEnd?: string
  onPickDay: (dayKey: string) => void
  maxYear: number
}) {
  const first = monthKey(viewYm.y, viewYm.m)
  const firstW = weekdayShort(first)
  const leadMap: Record<string, number> = {
    月: 0,
    火: 1,
    水: 2,
    木: 3,
    金: 4,
    土: 5,
    日: 6,
  }
  const padLead = leadMap[firstW] ?? 0
  const dim = daysInMonth(viewYm.y, viewYm.m)
  const cells: (string | null)[] = [
    ...Array.from({ length: padLead }, () => null),
    ...Array.from({ length: dim }, (_, i) =>
      `${viewYm.y}-${pad2(viewYm.m)}-${pad2(i + 1)}`,
    ),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const shiftMonth = (d: number) => {
    let m = viewYm.m + d
    let y = viewYm.y
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    onViewYm({ y, m })
  }

  const shiftYear = (d: number) => {
    const y = Math.min(maxYear, Math.max(1970, viewYm.y + d))
    onViewYm({ y, m: viewYm.m })
  }

  const hs =
    highlightStart && highlightEnd
      ? highlightStart <= highlightEnd
        ? highlightStart
        : highlightEnd
      : highlightStart
  const he =
    highlightStart && highlightEnd
      ? highlightStart <= highlightEnd
        ? highlightEnd
        : highlightStart
      : highlightEnd

  return (
    <div className={styles.cal}>
      <div className={styles.calHead}>
        <div className={styles.calNav}>
          <button type="button" className={styles.arrow} onClick={() => shiftYear(-1)}>
            «
          </button>
          <button type="button" className={styles.arrow} onClick={() => shiftMonth(-1)}>
            ‹
          </button>
        </div>
        <span className={styles.calTitle}>
          {viewYm.y}年{viewYm.m}月
        </span>
        <div className={styles.calNav}>
          <button type="button" className={styles.arrow} onClick={() => shiftMonth(1)}>
            ›
          </button>
          <button
            type="button"
            className={styles.arrow}
            disabled={viewYm.y >= maxYear}
            onClick={() => shiftYear(1)}
          >
            »
          </button>
        </div>
      </div>
      <div className={styles.calWeekdays}>
        {['月', '火', '水', '木', '金', '土', '日'].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className={styles.calGrid}>
        {cells.map((day, i) => {
          if (!day) return <span key={`e${i}`} className={styles.calEmpty} />
          let selected = false
          let inBand = false
          if (mode === 'day') selected = day === selectedDay
          if (mode === 'week' && selectedWeekStart) {
            inBand =
              day >= selectedWeekStart &&
              day <= addDaysKey(selectedWeekStart, 6)
            selected = day === selectedWeekStart
          }
          if (mode === 'month' && selectedMonthStart) {
            inBand =
              day >= selectedMonthStart &&
              day < addMonthsKey(selectedMonthStart, 1)
            selected = day === selectedMonthStart
          }
          if (mode === 'custom' && hs && he) {
            inBand = day >= hs && day <= he
            selected = day === hs || day === he
          }
          return (
            <button
              key={day}
              type="button"
              className={[
                styles.calDay,
                inBand ? styles.calDayBand : '',
                selected ? styles.calDayOn : '',
                day === todayKey() ? styles.calToday : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onPickDay(day)}
            >
              {Number(day.slice(8, 10))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** チップ表示中、グラフ外をタップしたら閉じる（出っ放し防止） */
function useOutsideClose(
  ref: { current: HTMLElement | null },
  active: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!active) return
    const onDown = (e: PointerEvent) => {
      const t = e.target
      if (ref.current && t instanceof Node && !ref.current.contains(t)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [ref, active, onClose])
}

/** タップで出すタスク名チップ（スマホはホバーがないため） */
function ChartTip({
  tip,
  onClose,
}: {
  tip: Slice | null
  onClose: () => void
}) {
  if (!tip) return null
  return (
    <button type="button" className={styles.chartTip} onClick={onClose}>
      <span className={styles.dot} style={{ background: tip.color }} />
      <span>{tip.name}</span>
      <span className={styles.chartTipTime}>{formatDurationHms(tip.sec)}</span>
    </button>
  )
}

function Donut({ slices, totalSec }: { slices: Slice[]; totalSec: number }) {
  const [tip, setTip] = useState<Slice | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // 期間が変われば key で再マウントされるので、slices の同一性変化では消さない
  // （記録中は毎秒再レンダーされ、出した瞬間にチップが消えてしまうため）
  useOutsideClose(wrapRef, tip !== null, () => setTip(null))
  const LABEL_FS = 11
  // ラベル文字列が外へ伸びる分のパディングを含めた viewBox
  const SIDE_PAD = 64
  const CORE_W = 300
  const VB_W = CORE_W + SIDE_PAD * 2
  const HOLE = 24
  const RING_OUT = 70
  const R = (RING_OUT + HOLE) / 2
  const STROKE = RING_OUT - HOLE
  // 水平線の終端とラベルの間の余白（棒の始点と円のパディングにも使う）
  const LABEL_PAD = 4
  // 伸ばし棒の始点: 円の外周から LABEL_PAD だけ外側
  const LEADER_START_R = RING_OUT + LABEL_PAD
  // 外周B（Basic）: 左右にずらす前の基準半径。ここまで放射状に棒を伸ばす
  // 始点パディングの分だけ全体も外側にずれる
  const BASE_R = RING_OUT + LABEL_FS * 1.2 + LABEL_PAD
  // 外周R/L: 外周Bを左右へずらした円。ラベルはこの上に載る
  const LR_ADJUST = 18
  // 上下はラベル1行分の半分程度あれば足りる
  const Y_PAD = Math.ceil(LABEL_FS * 0.55)
  const VB_H = (BASE_R + Y_PAD) * 2
  const CX = VB_W / 2
  const CY = VB_H / 2
  const C = 2 * Math.PI * R

  type Callout = {
    id: string
    name: string
    tx: number
    ty: number
    anchor: 'start' | 'end'
    // 伸ばし棒: パイ外縁 →（放射状）→ 外周B →（水平）→ ラベル手前
    points: string
  }

  const callouts: Callout[] = []
  let acc = 0
  for (const s of slices) {
    const frac = totalSec > 0 ? s.sec / totalSec : 0
    if (frac <= 0) continue
    // 0度 = 真上（-90 で SVG の右起点を上へ回す）
    const startDeg = (acc / Math.max(totalSec, 1)) * 360
    const midDeg = startDeg + frac * 180
    acc += s.sec
    const midRad = ((midDeg - 90) * Math.PI) / 180
    const cos = Math.cos(midRad)
    const sin = Math.sin(midRad)
    const onRight = cos >= 0
    const dir = onRight ? 1 : -1
    // 放射部: パイ外縁の少し外（パディング分）から外周Bまで
    const px = CX + cos * LEADER_START_R
    const py = CY + sin * LEADER_START_R
    const bx = CX + cos * BASE_R
    const by = CY + sin * BASE_R
    // 水平部: LR_ADJUST からラベル余白を引いた長さ
    const hx = bx + dir * (LR_ADJUST - LABEL_PAD)
    // ラベルは外周R/L（外周Bを左右にずらした円）上
    const tx = bx + dir * LR_ADJUST
    callouts.push({
      id: s.id,
      name: s.name.length > 10 ? `${s.name.slice(0, 9)}…` : s.name,
      tx,
      ty: by,
      // 右: 左寄せ（文字は外へ）／ 左: 右寄せ（文字は外へ）
      anchor: onRight ? 'start' : 'end',
      points: `${px},${py} ${bx},${by} ${hx},${by}`,
    })
  }

  let drawAcc = 0

  return (
    <div className={styles.donutWrap} ref={wrapRef}>
      <svg
        className={styles.donut}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
      >
        <circle
          r={R}
          cx={CX}
          cy={CY}
          fill="none"
          stroke="var(--panel-2)"
          strokeWidth={STROKE}
        />
        {slices.map((s) => {
          const frac = totalSec > 0 ? s.sec / totalSec : 0
          const startFrac = drawAcc / Math.max(totalSec, 1)
          const rot = startFrac * 360
          drawAcc += s.sec
          return (
            <circle
              key={s.id}
              r={R}
              cx={CX}
              cy={CY}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              strokeDasharray={`${frac * C} ${C}`}
              transform={`rotate(${rot - 90} ${CX} ${CY})`}
              className={styles.donutSlice}
              style={
                {
                  '--c': `${C}`,
                  '--target': `${frac * C}`,
                  // 真上から時計回りに一周伸びていくスイープ
                  animationDelay: `${startFrac * SWEEP_MS}ms`,
                  animationDuration: `${Math.max(frac * SWEEP_MS, 1)}ms`,
                } as CSSProperties
              }
              onClick={() => setTip((cur) => (cur?.id === s.id ? null : s))}
            />
          )
        })}
        {callouts.map((c) => (
          <g key={c.id} className={styles.callout}>
            <polyline
              points={c.points}
              fill="none"
              stroke="var(--muted)"
              strokeWidth={1}
            />
            <text
              x={c.tx}
              y={c.ty + LABEL_FS * 0.32}
              textAnchor={c.anchor}
              className={styles.donutLabel}
            >
              {c.name}
            </text>
          </g>
        ))}
      </svg>
      <ChartTip tip={tip} onClose={() => setTip(null)} />
    </div>
  )
}

function IndividualChart({
  columns,
  chartMode,
  onSeg,
  tapName = false,
}: {
  columns: Column[]
  chartMode: 'day' | 'stack'
  onSeg: (id: string) => void
  /** true なら、セグメントのタップは編集でなく名前チップ表示（Year 用） */
  tapName?: boolean
}) {
  const [tip, setTip] = useState<{ key: string; slice: Slice } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useOutsideClose(wrapRef, tip !== null, () => setTip(null))

  if (chartMode === 'day' && columns[0]) {
    const col = columns[0]
    const mid = col.start + DAY_MS / 2
    const halves = [
      {
        key: 'am',
        start: col.start,
        end: mid,
        ticks: ['0', '3', '6', '9', '12'],
      },
      {
        key: 'pm',
        start: mid,
        end: col.end,
        ticks: ['12', '15', '18', '21', '24'],
      },
    ] as const
    return (
      <div className={styles.dayTracks}>
        {halves.map((h) => {
          const segs = col.segs
            .map((s) => ({
              ...s,
              start: Math.max(s.start, h.start),
              end: Math.min(s.end, h.end),
            }))
            .filter((s) => s.end > s.start)
          const span = Math.max(1, h.end - h.start)
          return (
            <div key={h.key} className={styles.dayHalf}>
              <div className={styles.dayTrackBar}>
                <div className={styles.fillStill}>
                  {segs.map((s) => (
                    <button
                      key={`${s.eventId}-${s.start}`}
                      type="button"
                      className={styles.daySeg}
                      title={s.name}
                      style={{
                        left: `${((s.start - h.start) / span) * 100}%`,
                        width: `${((s.end - s.start) / span) * 100}%`,
                        background: s.color,
                      }}
                      onClick={() => onSeg(s.eventId)}
                    />
                  ))}
                </div>
              </div>
              <div className={styles.dayTicks}>
                {h.ticks.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const n = Math.max(columns.length, 1)
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
            const span = Math.max(1, col.end - col.start)
            return (
              <div key={col.key} className={styles.stackCol}>
                <div className={styles.stackBar}>
                  <div className={styles.fillStill}>
                  {col.segs.map((s) => {
                    const segKey = `${s.eventId}-${s.start}`
                    return (
                      <button
                        key={segKey}
                        type="button"
                        className={styles.stackSeg}
                        style={{
                          bottom: `${((s.start - col.start) / span) * 100}%`,
                          height: `${((s.end - s.start) / span) * 100}%`,
                          background: s.color,
                        }}
                        onClick={() => {
                          if (!tapName) {
                            onSeg(s.eventId)
                            return
                          }
                          const slice: Slice = {
                            id: segKey,
                            name: s.name,
                            color: s.color,
                            sec: Math.floor((s.end - s.start) / 1000),
                          }
                          setTip((cur) =>
                            cur?.key === segKey ? null : { key: segKey, slice },
                          )
                        }}
                      />
                    )
                  })}
                  </div>
                </div>
                <span className={styles.stackLabel}>{col.label}</span>
              </div>
            )
          })}
        </div>
      </div>
      {tapName && (
        <ChartTip tip={tip?.slice ?? null} onClose={() => setTip(null)} />
      )}
    </div>
  )
}

function TotalsChart({ columns }: { columns: TotalCol[] }) {
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
                  {col.parts.map((p) => {
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

export function LogScreen() {
  const {
    loading,
    error,
    events,
    tasks,
    folders,
    logPrefs,
    clearError,
    saveLogPrefs,
  } = useStore()

  const today = todayKey()
  const ty = ymParts(today).y

  const [prefs, setPrefs] = useState<LogPrefs>(() => makeDefaultPrefs())
  const [prefsReady, setPrefsReady] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  useScrollLock(pickerOpen)
  const [sheetPos, setSheetPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )
  const rangeBtnRef = useRef<HTMLButtonElement | null>(null)
  const [draft, setDraft] = useState<LogPrefs>(() => makeDefaultPrefs())
  const [customTarget, setCustomTarget] = useState<'start' | 'end'>('start')
  const [viewYm, setViewYm] = useState(() => ymParts(today))
  const [now, setNow] = useState(() => Date.now())
  const [editId, setEditId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [yearMode, setYearMode] = useState<'series' | 'total'>('series')

  // 期間タブのオレンジバーをアクティブ位置へスライドさせる
  const kindTabsRef = useRef<HTMLDivElement | null>(null)
  const [kindInd, setKindInd] = useState<{ left: number; width: number } | null>(
    null,
  )
  useLayoutEffect(() => {
    const measure = () => {
      const el = kindTabsRef.current?.querySelector<HTMLElement>(
        `button[data-tab="${prefs.kind}"]`,
      )
      if (el) setKindInd({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [prefs.kind, prefsReady])

  // settings から復元（旧形式の設定も正規化して受け入れる）
  useEffect(() => {
    if (loading) return
    const next = normalizePrefs(logPrefs) ?? makeDefaultPrefs()
    setPrefs(next)
    setPrefsReady(true)
  }, [loading, logPrefs])

  const hasLive = useMemo(() => events.some((e) => e.endedAt === null), [events])
  useEffect(() => {
    if (!hasLive) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hasLive])

  const applied = useMemo(
    () => buildApplied(prefs, now, events),
    [prefs, now, events],
  )

  const persist = async (next: LogPrefs) => {
    setPrefs(next)
    try {
      await saveLogPrefs(next)
    } catch {
      /* Store が表示 */
    }
  }

  const openPicker = () => {
    if (prefs.kind === 'all') return
    setDraft(prefs)
    setCustomTarget('start')
    if (prefs.kind === 'day') setViewYm(ymParts(prefs.day))
    else if (prefs.kind === 'week') setViewYm(ymParts(prefs.weekStart))
    else if (prefs.kind === 'month') setViewYm(ymParts(prefs.monthStart))
    else if (prefs.kind === 'custom') {
      const s = prefs.customApplied?.start ?? prefs.customStart
      setViewYm(ymParts(s))
      if (prefs.customApplied) {
        setDraft({
          ...prefs,
          customStart: prefs.customApplied.start,
          customEnd: prefs.customApplied.end,
        })
      } else {
        setDraft({
          ...prefs,
          customStart: today,
          customEnd: today,
        })
      }
    }
    const r = rangeBtnRef.current?.getBoundingClientRect()
    // スマホでも触りやすいよう画面幅近くまで広げ、水平は中央寄せ
    const pad = 10
    const width = Math.min(420, window.innerWidth - pad * 2)
    const left = Math.round((window.innerWidth - width) / 2)
    if (r) {
      // 日付ボタンを覆い隠す（古い期間表記が見えないよう上端で揃える）
      const maxTop = window.innerHeight - 120
      const top = Math.min(r.top, maxTop)
      setSheetPos({ top, left, width })
    } else {
      setSheetPos({ top: 80, left, width })
    }
    setPickerOpen(true)
  }

  const applyPicker = () => {
    let next = { ...draft }
    if (draft.kind === 'custom') {
      const a = draft.customStart <= draft.customEnd ? draft.customStart : draft.customEnd
      const b = draft.customStart <= draft.customEnd ? draft.customEnd : draft.customStart
      next = {
        ...draft,
        customStart: a,
        customEnd: b,
        customApplied: { start: a, end: b },
      }
    }
    setPickerOpen(false)
    void persist(next)
  }

  const setKind = (kind: LogKind) => {
    const next = { ...prefs, kind }
    void persist(next)
    setDetailOpen(false)
  }

  // ←→ の期間送り（Day: 1日 / Week: 7日 / Month: 1月 / Year: 1年）
  const stepRange = (dir: 1 | -1) => {
    const k = prefs.kind
    if (k === 'day') {
      const d = addDaysKey(prefs.day, dir)
      if (ymParts(d).y > ty) return
      void persist({ ...prefs, day: d })
    } else if (k === 'week') {
      const d = addDaysKey(prefs.weekStart, dir * 7)
      if (ymParts(d).y > ty) return
      void persist({ ...prefs, weekStart: d })
    } else if (k === 'month') {
      const d = addMonthsKey(prefs.monthStart, dir)
      if (ymParts(d).y > ty) return
      void persist({ ...prefs, monthStart: d })
    } else if (k === 'year') {
      const d = addMonthsKey(prefs.yearStart, dir * 12)
      const y = ymParts(d).y
      if (y > ty || y < 1970) return
      void persist({ ...prefs, yearStart: d })
    }
  }

  const {
    taskSlices,
    folderSlices,
    pieTaskSlices,
    pieFolderSlices,
    totalSec,
    columns,
    totalColumns,
    chartMode,
    dayEvents,
  } =
    useMemo(() => {
      const { start, end, kind: k } = applied
      const byTask = new Map<string, Slice>()
      const byFolder = new Map<string, Slice>()
      // 期間内で最初に記録された時刻（円グラフの並び順用）
      const firstByTask = new Map<string, number>()
      const firstByFolder = new Map<string, number>()
      const dayEvents: Event[] = []

      for (const ev of events) {
        const s = new Date(ev.startedAt).getTime()
        const e = ev.endedAt ? new Date(ev.endedAt).getTime() : now
        const a = Math.max(s, start)
        const b = Math.min(e, end)
        if (!(b > a)) continue
        if (k === 'day') dayEvents.push(ev)
        const sec = Math.floor((b - a) / 1000)
        if (sec <= 0) continue
        const d = resolveDisplay(ev, tasks, folders)

        const t = byTask.get(d.taskId)
        if (t) t.sec += sec
        else
          byTask.set(d.taskId, {
            id: d.taskId,
            name: d.taskName,
            color: d.taskColor,
            sec,
          })
        firstByTask.set(d.taskId, Math.min(firstByTask.get(d.taskId) ?? Infinity, a))

        const f = byFolder.get(d.folderId)
        if (f) f.sec += sec
        else
          byFolder.set(d.folderId, {
            id: d.folderId,
            name: d.folderName,
            color: d.folderColor,
            sec,
          })
        firstByFolder.set(
          d.folderId,
          Math.min(firstByFolder.get(d.folderId) ?? Infinity, a),
        )
      }

      dayEvents.sort(
        (a, b) =>
          new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      )

      const taskSlices = [...byTask.values()].sort((a, b) => b.sec - a.sec)
      const folderSlices = [...byFolder.values()].sort((a, b) => b.sec - a.sec)
      // 円グラフは初出現順（細かいパイが固まりにくく、ラベル重なりを緩和）
      const pieTaskSlices = [...byTask.values()].sort(
        (a, b) => (firstByTask.get(a.id) ?? 0) - (firstByTask.get(b.id) ?? 0),
      )
      const pieFolderSlices = [...byFolder.values()].sort(
        (a, b) => (firstByFolder.get(a.id) ?? 0) - (firstByFolder.get(b.id) ?? 0),
      )
      const totalSec = taskSlices.reduce((n, s) => n + s.sec, 0)

      let columns: Column[] = []
      let chartMode: 'day' | 'stack' = 'stack'

      if (k === 'all') {
        // 個別グラフなし
      } else if (k === 'day') {
        chartMode = 'day'
        columns = [
          {
            key: dateKey(nowIso(new Date(start))),
            label: '',
            start,
            end,
            segs: clipSegs(events, tasks, folders, start, end, now),
          },
        ]
      } else if (k === 'year') {
        // 基準月から12ヶ月分
        const baseKey = dateKey(nowIso(new Date(start)))
        for (let i = 0; i < 12; i++) {
          const csKey = addMonthsKey(baseKey, i)
          const ceKey = addMonthsKey(baseKey, i + 1)
          const cs = dayStartMs(csKey)
          const ce = dayStartMs(ceKey)
          columns.push({
            key: csKey,
            label: String(Number(csKey.slice(5, 7))),
            start: cs,
            end: ce,
            segs: clipSegs(events, tasks, folders, cs, ce, now),
          })
        }
      } else if (k === 'week' || k === 'month') {
        let cursor = dateKey(nowIso(new Date(start)))
        const lastDay = dateKey(nowIso(new Date(end - 1)))
        let guard = 0
        while (guard++ < 400 && cursor <= lastDay) {
          const cs = dayStartMs(cursor)
          const ce = cs + DAY_MS
          const dayNum = Number(cursor.slice(8, 10))
          columns.push({
            key: cursor,
            // Month は全日表示だとラベルが重なるので間引く
            label:
              k === 'month'
                ? MONTH_LABEL_DAYS.includes(dayNum)
                  ? String(dayNum)
                  : ''
                : String(dayNum),
            start: cs,
            end: ce,
            segs: clipSegs(events, tasks, folders, cs, ce, now),
          })
          cursor = addDaysKey(cursor, 1)
        }
      }
      // custom はサマリーなし（期間が可変で件数も多くなり得るため）

      // Year の「合計」表示: 月ごとのタスク合算棒。積み順は年内の初出現順（下から）
      let totalColumns: TotalCol[] = []
      if (k === 'year') {
        totalColumns = columns.map((col) => {
          const m = new Map<string, Slice>()
          for (const ev of events) {
            const s = new Date(ev.startedAt).getTime()
            const e = ev.endedAt ? new Date(ev.endedAt).getTime() : now
            const a = Math.max(s, col.start)
            const b = Math.min(e, col.end)
            if (!(b > a)) continue
            const sec = Math.floor((b - a) / 1000)
            if (sec <= 0) continue
            const d = resolveDisplay(ev, tasks, folders)
            const cur = m.get(d.taskId)
            if (cur) cur.sec += sec
            else
              m.set(d.taskId, {
                id: d.taskId,
                name: d.taskName,
                color: d.taskColor,
                sec,
              })
          }
          const parts = [...m.values()].sort(
            (a, b) =>
              (firstByTask.get(a.id) ?? 0) - (firstByTask.get(b.id) ?? 0),
          )
          return {
            key: col.key,
            label: col.label,
            spanSec: (col.end - col.start) / 1000,
            parts,
          }
        })
      }

      return {
        taskSlices,
        folderSlices,
        pieTaskSlices,
        pieFolderSlices,
        totalSec,
        columns,
        totalColumns,
        chartMode,
        dayEvents,
      }
    }, [applied, events, tasks, folders, now])

  if (loading || !prefsReady) {
    return <p className={styles.status}>Loading...</p>
  }

  return (
    <section className={styles.root}>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={clearError}>
            閉じる
          </button>
        </div>
      )}

      <div className={styles.kindTabs} ref={kindTabsRef}>
        {(
          [
            ['all', 'All'],
            ['day', 'Day'],
            ['week', 'Week'],
            ['month', 'Month'],
            ['year', 'Year'],
            ['custom', 'Custom'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            data-tab={k}
            data-text={label}
            className={prefs.kind === k ? styles.kindActive : undefined}
            onClick={() => setKind(k)}
          >
            {label}
          </button>
        ))}
        {kindInd && (
          <span
            className={styles.kindInd}
            style={{ left: kindInd.left, width: kindInd.width }}
            aria-hidden
          />
        )}
      </div>

      {prefs.kind !== 'all' && (
        <div className={styles.rangeRow}>
          {prefs.kind !== 'custom' && (
            <button
              type="button"
              className={styles.stepBtn}
              aria-label="前へ"
              onClick={() => stepRange(-1)}
            >
              ←
            </button>
          )}
          <button
            type="button"
            ref={rangeBtnRef}
            className={styles.rangeBtn}
            onClick={openPicker}
          >
            <span className={styles.rangeLabel}>{applied.label}</span>
            <span className={styles.chevron} aria-hidden>
              ▾
            </span>
          </button>
          {prefs.kind !== 'custom' && (
            <button
              type="button"
              className={styles.stepBtn}
              aria-label="次へ"
              onClick={() => stepRange(1)}
            >
              →
            </button>
          )}
        </div>
      )}

      <div className={styles.totalLine}>
        <span className={styles.sectionTitle}>Tracked Time</span>
        <span className={styles.totalValue}>{formatDurationHms(totalSec)}</span>
      </div>

      <hr className={styles.rule} />

      {prefs.kind !== 'all' && prefs.kind !== 'custom' && (
        <>
          <h2 className={styles.sectionTitle}>Summary</h2>
          <div className={styles.panel}>
            {totalSec === 0 ? (
              <p className={styles.status}>No Data</p>
            ) : prefs.kind === 'year' && yearMode === 'total' ? (
              // key: 期間が変わったら伸長アニメを再生し直す
              <TotalsChart
                key={`${prefs.kind}-${applied.start}`}
                columns={totalColumns}
              />
            ) : (
              <IndividualChart
                key={`${prefs.kind}-${applied.start}`}
                columns={columns}
                chartMode={chartMode}
                onSeg={setEditId}
                tapName={prefs.kind === 'year'}
              />
            )}
          </div>
          {prefs.kind === 'year' && totalSec > 0 && (
            <div className={styles.modeBtns}>
              <button
                type="button"
                data-text="時系列"
                className={yearMode === 'series' ? styles.modeOn : styles.modeBtn}
                onClick={() => setYearMode('series')}
              >
                時系列
              </button>
              <button
                type="button"
                data-text="合計"
                className={yearMode === 'total' ? styles.modeOn : styles.modeBtn}
                onClick={() => setYearMode('total')}
              >
                合計
              </button>
            </div>
          )}
          {prefs.kind === 'day' && totalSec > 0 && (
            <>
              <button
                type="button"
                className={styles.detailBtn}
                onClick={() => setDetailOpen((v) => !v)}
              >
                {detailOpen ? 'Close' : 'Detail'}
              </button>
              {detailOpen && (
                <ul className={styles.detailList}>
                  {dayEvents.length === 0 ? (
                    <li className={styles.status}>記録なし</li>
                  ) : (
                    dayEvents.map((ev) => {
                      const d = resolveDisplay(ev, tasks, folders)
                      return (
                        <li key={ev.id}>
                          <button
                            type="button"
                            className={styles.detailRow}
                            onClick={() => setEditId(ev.id)}
                          >
                            <div className={styles.detailMain}>
                              <div className={styles.detailTitle}>
                                <span
                                  className={styles.dot}
                                  style={{ background: d.taskColor }}
                                />
                                <span>{d.taskName}</span>
                                <FolderIcon color={d.folderColor} size={12} />
                                <span className={styles.detailFolder}>
                                  {d.folderName}
                                </span>
                              </div>
                              <div className={styles.detailMeta}>
                                {formatEventRange(ev.startedAt, ev.endedAt)}
                              </div>
                            </div>
                            <span className={styles.detailDur}>
                              {durationLabel(ev.startedAt, ev.endedAt, now)}
                            </span>
                          </button>
                        </li>
                      )
                    })
                  )}
                </ul>
              )}
            </>
          )}
          <hr className={styles.rule} />
        </>
      )}

      <h2 className={styles.sectionTitle}>Tasks</h2>
      {totalSec === 0 ? (
        <p className={styles.status}>No Data</p>
      ) : (
        <>
          <div className={styles.pieCenter}>
            <Donut
              key={`${prefs.kind}-${applied.start}`}
              slices={pieTaskSlices}
              totalSec={totalSec}
            />
          </div>
          <table className={styles.table}>
            <tbody>
              {taskSlices.map((s) => (
                <tr key={s.id}>
                  <td className={styles.tdDot}>
                    <span
                      className={styles.dot}
                      style={{ background: s.color }}
                    />
                  </td>
                  <td className={styles.tdName}>{s.name}</td>
                  <td className={styles.tdTime}>
                    {formatDurationHms(s.sec)}
                  </td>
                  <td className={styles.tdPct}>
                    {((s.sec / Math.max(totalSec, 1)) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <hr className={styles.rule} />

      <h2 className={styles.sectionTitle}>Genres</h2>
      {totalSec === 0 ? (
        <p className={styles.status}>No Data</p>
      ) : (
        <>
          <div className={styles.pieCenter}>
            <Donut
              key={`${prefs.kind}-${applied.start}`}
              slices={pieFolderSlices}
              totalSec={totalSec}
            />
          </div>
          <table className={styles.table}>
            <tbody>
              {folderSlices.map((s) => (
                <tr key={s.id}>
                  <td className={styles.tdDot}>
                    <span
                      className={styles.dot}
                      style={{ background: s.color }}
                    />
                  </td>
                  <td className={styles.tdName}>{s.name}</td>
                  <td className={styles.tdTime}>
                    {formatDurationHms(s.sec)}
                  </td>
                  <td className={styles.tdPct}>
                    {((s.sec / Math.max(totalSec, 1)) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {pickerOpen &&
        prefs.kind !== 'all' &&
        sheetPos &&
        createPortal(
        <div className={styles.modalRoot}>
          <button
            type="button"
            className={styles.modalBackdrop}
            aria-label="閉じる"
            onClick={() => setPickerOpen(false)}
          />
          <div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label="期間を選ぶ"
            style={{
              top: sheetPos.top,
              left: sheetPos.left,
              width: sheetPos.width,
            }}
          >
            {draft.kind === 'custom' && (
              <div className={styles.customTargets}>
                <button
                  type="button"
                  className={
                    customTarget === 'start'
                      ? styles.customTargetOn
                      : styles.customTarget
                  }
                  onClick={() => {
                    setCustomTarget('start')
                    setViewYm(ymParts(draft.customStart))
                  }}
                >
                  開始 {ymd(draft.customStart)}（{weekdayShort(draft.customStart)}）
                </button>
                <button
                  type="button"
                  className={
                    customTarget === 'end'
                      ? styles.customTargetOn
                      : styles.customTarget
                  }
                  onClick={() => {
                    setCustomTarget('end')
                    setViewYm(ymParts(draft.customEnd))
                  }}
                >
                  終了 {ymd(draft.customEnd)}（{weekdayShort(draft.customEnd)}）
                </button>
              </div>
            )}

            {(draft.kind === 'day' ||
              draft.kind === 'week' ||
              draft.kind === 'month' ||
              draft.kind === 'custom') && (
              <MonthCalendar
                viewYm={viewYm}
                onViewYm={setViewYm}
                mode={draft.kind}
                selectedDay={draft.day}
                selectedWeekStart={draft.weekStart}
                selectedMonthStart={draft.monthStart}
                highlightStart={draft.customStart}
                highlightEnd={draft.customEnd}
                maxYear={ty}
                onPickDay={(d) => {
                  // Day/Week/Month は選んだ時点で即適用（Apply 不要）
                  if (draft.kind === 'day') {
                    setDraft({ ...draft, day: d })
                    setViewYm(ymParts(d))
                    setPickerOpen(false)
                    void persist({ ...prefs, day: d })
                  } else if (draft.kind === 'week') {
                    // クリックした日から7日間（何曜日始まりでも可）
                    setDraft({ ...draft, weekStart: d })
                    setViewYm(ymParts(d))
                    void persist({ ...prefs, weekStart: d })
                  } else if (draft.kind === 'month') {
                    // クリックした日から1ヶ月間
                    setDraft({ ...draft, monthStart: d })
                    setViewYm(ymParts(d))
                    void persist({ ...prefs, monthStart: d })
                  } else if (customTarget === 'start') {
                    setDraft({
                      ...draft,
                      customStart: d,
                      customEnd: d > draft.customEnd ? d : draft.customEnd,
                    })
                  } else {
                    setDraft({
                      ...draft,
                      customEnd: d,
                      customStart: d < draft.customStart ? d : draft.customStart,
                    })
                  }
                }}
              />
            )}

            {draft.kind === 'year' && (
              <div className={styles.monthPick}>
                <div className={styles.calHead}>
                  <div className={styles.calNav}>
                    <button
                      type="button"
                      className={styles.arrow}
                      onClick={() => {
                        const ys = ymParts(draft.yearStart)
                        setDraft({
                          ...draft,
                          yearStart: monthKey(ys.y - 1, ys.m),
                        })
                      }}
                    >
                      «
                    </button>
                  </div>
                  <span className={styles.calTitle}>
                    {ymParts(draft.yearStart).y}年
                  </span>
                  <div className={styles.calNav}>
                    <button
                      type="button"
                      className={styles.arrow}
                      disabled={ymParts(draft.yearStart).y >= ty}
                      onClick={() => {
                        const ys = ymParts(draft.yearStart)
                        setDraft({
                          ...draft,
                          yearStart: monthKey(Math.min(ty, ys.y + 1), ys.m),
                        })
                      }}
                    >
                      »
                    </button>
                  </div>
                </div>
                <div className={styles.monthGrid}>
                  {MONTH_NAMES.map((name, i) => {
                    const m = i + 1
                    const ys = ymParts(draft.yearStart)
                    return (
                      <button
                        key={name}
                        type="button"
                        className={
                          ys.m === m ? styles.monthOn : styles.monthBtn
                        }
                        onClick={() => {
                          // 選んだ時点で即適用（閉じるのは画面外タップ）
                          const k = monthKey(ys.y, m)
                          setDraft({ ...draft, yearStart: k })
                          void persist({ ...prefs, yearStart: k })
                        }}
                      >
                        {name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {draft.kind === 'custom' && (
              <div className={styles.sheetActions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={applyPicker}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {editId && (
        <EventEditModal eventId={editId} onClose={() => setEditId(null)} />
      )}
    </section>
  )
}
