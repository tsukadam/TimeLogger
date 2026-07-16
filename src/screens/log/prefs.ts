import {
  DAY_MS,
  addDaysKey,
  addMonthsKey,
  dayStartMs,
  formatMd,
  mondayKeyOf,
  monthKey,
  todayKey,
  weekdayShort,
  ymParts,
} from '../../lib/time'
import type { Event, LogPrefs } from '../../types'
import type { AppliedRange } from './types'

export function makeDefaultPrefs(now = new Date()): LogPrefs {
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
export function normalizePrefs(p: LogPrefs | null): LogPrefs | null {
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

export function buildApplied(
  prefs: LogPrefs,
  nowMs: number,
  events: Event[],
): AppliedRange {
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
      label: `${formatMd(prefs.day)}（${weekdayShort(prefs.day)}）`,
    }
  }
  if (kind === 'week') {
    const start = dayStartMs(prefs.weekStart)
    const endKey = addDaysKey(prefs.weekStart, 6)
    return {
      kind,
      start,
      end: start + 7 * DAY_MS,
      label: `${formatMd(prefs.weekStart)}（${weekdayShort(prefs.weekStart)}）〜 ${formatMd(endKey)}（${weekdayShort(endKey)}）`,
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
        : `${formatMd(prefs.monthStart)}（${weekdayShort(prefs.monthStart)}）〜 ${formatMd(lastKey)}（${weekdayShort(lastKey)}）`,
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
      ? `${formatMd(lo)}（${weekdayShort(lo)}）〜 ${formatMd(hi)}（${weekdayShort(hi)}）`
      : `${formatMd(lo)}（${weekdayShort(lo)}）`,
  }
}
