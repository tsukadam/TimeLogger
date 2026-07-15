const TZ = 'Asia/Tokyo'

/** 経過1秒未満は誤操作として記録に残さない（ms 精度で判定） */
export const MIN_RECORD_MS = 1000

/** 1日の長さ */
export const DAY_MS = 86400000
export const DAY_SEC = 86400

/** 2桁ゼロ埋め */
export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 東京時刻の ISO（ミリ秒付き）。
 * 処理用の正本。表示は別途切り捨てる。
 */
export function nowIso(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00'

  const fracRaw = parts.find((p) => p.type === 'fractionalSecond')?.value ?? '000'
  const frac = fracRaw.padEnd(3, '0').slice(0, 3)

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}.${frac}+09:00`
}

/** 表示用に秒未満を切り捨てた瞬間 */
function floorToSecond(isoOrDate: string | Date): Date {
  const ms = typeof isoOrDate === 'string' ? new Date(isoOrDate).getTime() : isoOrDate.getTime()
  return new Date(Math.floor(ms / 1000) * 1000)
}

function partsInTokyo(date: Date) {
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
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  }
}

/** 日付キー（グルーピング用） YYYY-MM-DD — 開始瞬間の日付（切り捨て） */
export function dateKey(iso: string): string {
  const p = partsInTokyo(floorToSecond(iso))
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

export function todayKey(now = new Date()): string {
  return dateKey(nowIso(now))
}

/** 区切り線用: 7/14（月） （月日はゼロ埋めしない） */
export function formatDateDivider(iso: string): string {
  const floored = floorToSecond(iso)
  const p = partsInTokyo(floored)
  const weekday = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    weekday: 'short',
  }).format(floored)
  return `${p.month}/${p.day}（${weekday}）`
}

/**
 * 表示用時刻（秒未満は切り捨て）
 * 時はゼロなし、分秒はゼロ埋め
 */
function formatTimeHms(iso: string): string {
  const p = partsInTokyo(floorToSecond(iso))
  return `${p.hour}:${pad2(p.minute)}:${pad2(p.second)}`
}

/** 1:55:03 → 23:01:00 （記録中は → …） */
export function formatEventRange(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return `${formatTimeHms(startedAt)} → …`
  return `${formatTimeHms(startedAt)} → ${formatTimeHms(endedAt)}`
}

/** 秒数（切り捨て済み）→ 表示。0h・0m は省略 */
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

/** 実 ms 差を切り捨てて秒に（表示専用。判定には elapsedMs を使う） */
function durationSeconds(
  startedAt: string,
  endedAt: string | null,
  nowMs = Date.now(),
): number {
  return Math.floor(elapsedMs(startedAt, endedAt, nowMs) / 1000)
}

/** 処理用の実経過 ms */
export function elapsedMs(
  startedAt: string,
  endedAt: string | null,
  nowMs = Date.now(),
): number {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : nowMs
  return Math.max(0, end - start)
}

export function durationLabel(
  startedAt: string,
  endedAt: string | null,
  now = Date.now(),
): string {
  return formatDurationHms(durationSeconds(startedAt, endedAt, now))
}

/** ISO → 時刻欄用 HH:mm:ss（東京・24時間） */
export function isoToTimeInput(iso: string): string {
  const p = partsInTokyo(floorToSecond(iso))
  return `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`
}

/**
 * 日付欄＋時刻欄 → 東京 ISO（秒未満は .000）。
 * 時刻は `H:mm` / `H:mm:ss` を許容（24時間表記）。
 */
export function dateTimeInputToIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    throw new Error('日付の形式が不正です')
  }
  const m = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) throw new Error('時刻は 24時間表記の H:mm:ss で入力してください')
  const h = Number(m[1])
  const min = Number(m[2])
  const sec = Number(m[3] ?? '0')
  if (h > 23 || min > 59 || sec > 59) {
    throw new Error('時刻の値が範囲外です')
  }
  return `${date.trim()}T${pad2(h)}:${pad2(min)}:${pad2(sec)}.000+09:00`
}

/** 東京の「その日の0時」（ms） YYYY-MM-DD */
export function dayStartMs(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00.000+09:00`).getTime()
}

/** dayKey に日数を加算 */
export function addDaysKey(dayKey: string, days: number): string {
  return dateKey(nowIso(new Date(dayStartMs(dayKey) + days * DAY_MS)))
}

/** その日を含む週の月曜（東京） */
export function mondayKeyOf(dayKey: string): string {
  const start = dayStartMs(dayKey)
  const epochDay = Math.floor((start + 9 * 3600 * 1000) / DAY_MS)
  const sundayBased = (epochDay + 4) % 7
  const mondayOffset = (sundayBased + 6) % 7
  return addDaysKey(dayKey, -mondayOffset)
}

export function daysInMonth(year: number, month1to12: number): number {
  const nextY = month1to12 === 12 ? year + 1 : year
  const nextM = month1to12 === 12 ? 1 : month1to12 + 1
  return Math.round(
    (dayStartMs(monthKey(nextY, nextM)) - dayStartMs(monthKey(year, month1to12))) /
      DAY_MS,
  )
}

/** dayKey → { y, m } */
export function ymParts(dayKey: string): { y: number; m: number } {
  return {
    y: Number(dayKey.slice(0, 4)),
    m: Number(dayKey.slice(5, 7)),
  }
}

/** その月の1日の dayKey */
export function monthKey(y: number, m: number): string {
  return `${y}-${pad2(m)}-01`
}

/** dayKey → 7/14 表示（ゼロ埋めなし） */
export function formatMd(dayKey: string): string {
  return `${Number(dayKey.slice(5, 7))}/${Number(dayKey.slice(8, 10))}`
}

/** dayKey → 2026/7/14 表示（ゼロ埋めなし） */
export function formatYmd(dayKey: string): string {
  return `${Number(dayKey.slice(0, 4))}/${formatMd(dayKey)}`
}

/** dayKey → 曜日1文字（月・火…） */
export function weekdayShort(dayKey: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    weekday: 'short',
  }).format(new Date(dayStartMs(dayKey)))
}

/**
 * 日付キーへ n ヶ月加算。同日が無い月（例: 1/31 の1ヶ月後）は翌月1日へ繰り上げる
 */
export function addMonthsKey(dayKey: string, n: number): string {
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
    return monthKey(y2, m2)
  }
  return `${y2}-${pad2(m2)}-${pad2(d)}`
}

/** 記録が dayKey の1日と重なる秒数（記録中は now まで） */
export function overlapSecondsOnDay(
  startedAt: string,
  endedAt: string | null,
  dayKey: string,
  nowMs = Date.now(),
): number {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : nowMs
  if (!(end > start)) return 0

  const dayStart = dayStartMs(dayKey)
  const dayEnd = dayStart + DAY_MS
  const a = Math.max(start, dayStart)
  const b = Math.min(end, dayEnd)
  if (!(b > a)) return 0
  return Math.floor((b - a) / 1000)
}
