import {
  FUTURE_GRACE_MS,
  MIN_RECORD_MS,
  dateKey,
  dateTimeInputToIso,
  dayStartMs,
  nowIso,
  pad2,
} from '../lib/time'
import type { Event } from '../types'

/** この幅以内の隙間・重複は中点に丸めて 0 扱いにする */
export const SNAP_MS = 2 * 60 * 1000

export function eventStartMs(ev: Event): number {
  return new Date(ev.startedAt).getTime()
}

export function eventEndMs(ev: Event, nowMs: number): number {
  return ev.endedAt ? new Date(ev.endedAt).getTime() : nowMs
}

export function eventsChrono(events: Event[]): Event[] {
  return [...events].sort((a, b) => eventStartMs(a) - eventStartMs(b))
}

export function findPrevNext(
  events: Event[],
  startMs: number,
  excludeId: string | null,
): { prev: Event | null; next: Event | null } {
  const list = eventsChrono(events).filter((e) => e.id !== excludeId)
  let prev: Event | null = null
  let next: Event | null = null
  for (const ev of list) {
    if (eventStartMs(ev) <= startMs) prev = ev
    else {
      next = ev
      break
    }
  }
  return { prev, next }
}

export function neighborsOf(
  events: Event[],
  eventId: string,
): { prev: Event | null; self: Event | null; next: Event | null } {
  const list = eventsChrono(events)
  const i = list.findIndex((e) => e.id === eventId)
  if (i < 0) return { prev: null, self: null, next: null }
  return {
    prev: list[i - 1] ?? null,
    self: list[i]!,
    next: list[i + 1] ?? null,
  }
}

export type EventTimePatch = {
  id: string
  startedAt?: string
  endedAt?: string | null
}

export type SnapMove = 'start' | 'end' | 'both'

function withinSnap(a: number, b: number): boolean {
  return Math.abs(a - b) <= SNAP_MS
}

function midMs(a: number, b: number): number {
  return Math.round((a + b) / 2)
}

function isoFromMs(ms: number): string {
  return nowIso(new Date(ms))
}

function assertDuration(startMs: number, endMs: number, label: string): void {
  if (endMs - startMs < MIN_RECORD_MS) {
    throw new Error(`${label}が1秒未満になります`)
  }
}

/**
 * 隣接記録との隙間・重複が SNAP_MS 以内なら中点に揃える。
 * 重複は必ず解消。隙間は、記録長が SNAP 以下なら動かした側だけ。
 */
export function snapEventTimes(opts: {
  events: Event[]
  excludeId: string | null
  startMs: number
  endMs: number | null
  nowMs: number
  move: SnapMove
}): { startMs: number; endMs: number | null; patches: EventTimePatch[] } {
  const { events, excludeId, nowMs, move } = opts
  let startMs = opts.startMs
  let endMs = opts.endMs
  const patches: EventTimePatch[] = []
  const duration =
    endMs !== null && Number.isFinite(endMs) ? endMs - startMs : Infinity
  const short = duration <= SNAP_MS
  const { prev, next } = findPrevNext(events, startMs, excludeId)

  const snapStart = !short || move === 'start' || move === 'both'
  const snapEnd = !short || move === 'end' || move === 'both'

  if (prev && prev.endedAt) {
    const prevEnd = eventEndMs(prev, nowMs)
    const overlap = startMs < prevEnd
    const gap = startMs > prevEnd
    const should =
      withinSnap(prevEnd, startMs) &&
      (overlap || (gap && snapStart))
    if (should) {
      const mid = midMs(prevEnd, startMs)
      startMs = mid
      patches.push({ id: prev.id, endedAt: isoFromMs(mid) })
      const prevStart = eventStartMs(prev)
      assertDuration(prevStart, mid, '前の記録')
    }
  }

  if (next && endMs !== null) {
    const nextStart = eventStartMs(next)
    const overlap = endMs > nextStart
    const gap = endMs < nextStart
    const should =
      withinSnap(endMs, nextStart) && (overlap || (gap && snapEnd))
    if (should) {
      const mid = midMs(endMs, nextStart)
      endMs = mid
      patches.push({ id: next.id, startedAt: isoFromMs(mid) })
      if (next.endedAt) {
        assertDuration(mid, eventEndMs(next, nowMs), '次の記録')
      }
    }
  }

  if (endMs !== null) assertDuration(startMs, endMs, 'この記録')
  return { startMs, endMs, patches }
}

export type TimeBound = { minMs: number; maxMs: number }

/** 開始時刻ホイールの合法範囲（隣接は SNAP 以内の重なりまで許容） */
export function boundsForStart(opts: {
  events: Event[]
  excludeId: string | null
  startMs: number
  endMs: number | null
  nowMs: number
}): TimeBound {
  const { events, excludeId, endMs, nowMs } = opts
  const { prev } = findPrevNext(events, opts.startMs, excludeId)
  const minMs = prev
    ? eventEndMs(prev, nowMs) - SNAP_MS
    : Number.NEGATIVE_INFINITY
  let maxMs = nowMs + FUTURE_GRACE_MS
  if (endMs !== null) maxMs = Math.min(maxMs, endMs - MIN_RECORD_MS)
  return { minMs, maxMs }
}

/** 終了時刻ホイールの合法範囲 */
export function boundsForEnd(opts: {
  events: Event[]
  excludeId: string | null
  startMs: number
  endMs: number
  nowMs: number
}): TimeBound {
  const { events, excludeId, startMs, nowMs } = opts
  const { next } = findPrevNext(events, startMs, excludeId)
  const minMs = startMs + MIN_RECORD_MS
  let maxMs = nowMs + FUTURE_GRACE_MS
  if (next) maxMs = Math.min(maxMs, eventStartMs(next) + SNAP_MS)
  return { minMs, maxMs }
}

/** ⇔ で編集する境界（older.end = newer.start） */
export function boundsForJoin(opts: {
  older: Event
  newer: Event
  nowMs: number
}): TimeBound {
  const { older, newer, nowMs } = opts
  const minMs = eventStartMs(older) + MIN_RECORD_MS
  const maxMs = newer.endedAt
    ? eventEndMs(newer, nowMs) - MIN_RECORD_MS
    : nowMs + FUTURE_GRACE_MS
  return { minMs, maxMs }
}

export function alignBoundaryMs(olderEndMs: number, newerStartMs: number): number {
  if (olderEndMs === newerStartMs) return olderEndMs
  return midMs(olderEndMs, newerStartMs)
}

function unitRangeMs(
  date: string,
  h: number,
  m: number | null,
  s: number | null,
): { lo: number; hi: number } {
  if (m === null) {
    const lo = new Date(dateTimeInputToIso(date, `${pad2(h)}:00:00`)).getTime()
    const hi = new Date(dateTimeInputToIso(date, `${pad2(h)}:59:59`)).getTime()
    return { lo, hi }
  }
  if (s === null) {
    const lo = new Date(
      dateTimeInputToIso(date, `${pad2(h)}:${pad2(m)}:00`),
    ).getTime()
    const hi = new Date(
      dateTimeInputToIso(date, `${pad2(h)}:${pad2(m)}:59`),
    ).getTime()
    return { lo, hi }
  }
  const t = new Date(
    dateTimeInputToIso(date, `${pad2(h)}:${pad2(m)}:${pad2(s)}`),
  ).getTime()
  return { lo: t, hi: t }
}

function overlaps(lo: number, hi: number, minMs: number, maxMs: number): boolean {
  return lo <= maxMs && minMs <= hi
}

export function validHours(date: string, bound: TimeBound): number[] {
  const out: number[] = []
  for (let h = 0; h < 24; h++) {
    const { lo, hi } = unitRangeMs(date, h, null, null)
    if (overlaps(lo, hi, bound.minMs, bound.maxMs)) out.push(h)
  }
  return out
}

export function validMinutes(
  date: string,
  hour: number,
  bound: TimeBound,
): number[] {
  const out: number[] = []
  for (let m = 0; m < 60; m++) {
    const { lo, hi } = unitRangeMs(date, hour, m, null)
    if (overlaps(lo, hi, bound.minMs, bound.maxMs)) out.push(m)
  }
  return out
}

export function validSeconds(
  date: string,
  hour: number,
  minute: number,
  bound: TimeBound,
): number[] {
  const out: number[] = []
  for (let s = 0; s < 60; s++) {
    const { lo, hi } = unitRangeMs(date, hour, minute, s)
    if (overlaps(lo, hi, bound.minMs, bound.maxMs)) out.push(s)
  }
  return out
}

export function dayHasValidTime(date: string, bound: TimeBound): boolean {
  const lo = dayStartMs(date)
  const hi = lo + 86_400_000 - 1000
  return overlaps(lo, hi, bound.minMs, bound.maxMs)
}

export function boundDayRange(bound: TimeBound): { minDay: string; maxDay: string } {
  const minDay = Number.isFinite(bound.minMs)
    ? dateKey(nowIso(new Date(Math.max(bound.minMs, 0))))
    : '1970-01-01'
  const maxDay = Number.isFinite(bound.maxMs)
    ? dateKey(nowIso(new Date(bound.maxMs)))
    : '9999-12-31'
  return { minDay, maxDay }
}

/** 指定日で合法な時刻へ寄せる。その日に合法値が無ければ null */
export function clampTimeOnDate(
  date: string,
  time: string,
  bound: TimeBound,
): string | null {
  const hours = validHours(date, bound)
  if (hours.length === 0) return null
  const m = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  let h = m ? Number(m[1]) : hours[0]!
  if (!hours.includes(h)) {
    h = hours.reduce((best, x) => (Math.abs(x - h) < Math.abs(best - h) ? x : best))
  }
  const mins = validMinutes(date, h, bound)
  if (mins.length === 0) return null
  let min = m ? Number(m[2]) : mins[0]!
  if (!mins.includes(min)) {
    min = mins.reduce((best, x) =>
      Math.abs(x - min) < Math.abs(best - min) ? x : best,
    )
  }
  const secs = validSeconds(date, h, min, bound)
  if (secs.length === 0) return null
  let sec = m ? Number(m[3] ?? 0) : secs[0]!
  if (!secs.includes(sec)) {
    sec = secs.reduce((best, x) =>
      Math.abs(x - sec) < Math.abs(best - sec) ? x : best,
    )
  }
  return `${pad2(h)}:${pad2(min)}:${pad2(sec)}`
}
