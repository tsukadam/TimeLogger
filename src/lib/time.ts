const TZ = 'Asia/Tokyo'

/** 経過1秒未満は誤操作として記録に残さない */
export const MIN_RECORD_MS = 1000

export function nowIso(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00'

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+09:00`
}

function partsInTokyo(iso: string) {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00'
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  }
}

/** 日付キー（グルーピング用） YYYY-MM-DD */
export function dateKey(iso: string): string {
  const p = partsInTokyo(iso)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function todayKey(now = new Date()): string {
  return dateKey(nowIso(now))
}

/** 区切り線用: 7/14（月） （月日はゼロ埋めしない） */
export function formatDateDivider(iso: string): string {
  const p = partsInTokyo(iso)
  const weekday = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    weekday: 'short',
  }).format(new Date(iso))
  return `${p.month}/${p.day}（${weekday}）`
}

/**
 * 時刻: 時はゼロなし、分秒はゼロ埋め
 * 例: 1:05:03 / 23:01:00
 */
export function formatTimeHms(iso: string): string {
  const p = partsInTokyo(iso)
  return `${p.hour}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`
}

/** 1:55:03 → 23:01:00 （記録中は → …） */
export function formatEventRange(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return `${formatTimeHms(startedAt)} → …`
  return `${formatTimeHms(startedAt)} → ${formatTimeHms(endedAt)}`
}

/** 秒数 → 1h5m3s / 5m3s / 5s（0h・0m は省略） */
export function formatDurationHms(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  let out = ''
  if (h > 0) out += `${h}h`
  if (m > 0) out += `${m}m`
  out += `${s}s`
  return out
}

export function durationSeconds(
  startedAt: string,
  endedAt: string | null,
  nowMs = Date.now(),
): number {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : nowMs
  return Math.max(0, Math.floor((end - start) / 1000))
}

export function durationLabel(
  startedAt: string,
  endedAt: string | null,
  now = Date.now(),
): string {
  return formatDurationHms(durationSeconds(startedAt, endedAt, now))
}

/** イベント区間が dateKey の日に重なる秒数（東京） */
export function overlapSecondsOnDay(
  startedAt: string,
  endedAt: string | null,
  dayKey: string,
  nowMs = Date.now(),
): number {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : nowMs
  if (!(end > start)) return 0

  const dayStart = new Date(`${dayKey}T00:00:00+09:00`).getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  const a = Math.max(start, dayStart)
  const b = Math.min(end, dayEnd)
  if (!(b > a)) return 0
  return Math.floor((b - a) / 1000)
}
