/**
 * イベントの四半期チャンク ID（例: 2026Q3）。
 * 所属は startedAt の暦月で決める（終了日は見ない）。
 */

export type QuarterId = `${number}Q${1 | 2 | 3 | 4}`

export function quarterIdFromIso(iso: string): QuarterId {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) {
    throw new Error(`invalid iso: ${iso}`)
  }
  // ローカル表示と同じく Asia/Tokyo 前提の部品が多いが、
  // チャンク境界は ISO のカレンダー月（タイムゾーン付きならその壁時計）で十分。
  // ここでは Date の UTC 部品ではなく、オフセット込みの年月日を取る。
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  if (!m) throw new Error(`invalid iso: ${iso}`)
  const y = Number(m[1])
  const month = Number(m[2]) // 1-12
  const q = (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4
  return `${y}Q${q}` as QuarterId
}

export function currentQuarterId(now = new Date()): QuarterId {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  })
  const parts = fmt.formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  if (!y || !month) throw new Error('cannot resolve current quarter')
  return quarterIdFromIso(`${y}-${month}-01`)
}

/** 一つ前の四半期 */
export function previousQuarterId(id: QuarterId): QuarterId {
  const y = Number(id.slice(0, 4))
  const q = Number(id.slice(5)) as 1 | 2 | 3 | 4
  if (q === 1) return `${y - 1}Q4` as QuarterId
  return `${y}Q${(q - 1) as 1 | 2 | 3}` as QuarterId
}

export function compareQuarterIds(a: QuarterId, b: QuarterId): number {
  if (a === b) return 0
  const ay = Number(a.slice(0, 4))
  const by = Number(b.slice(0, 4))
  if (ay !== by) return ay - by
  return Number(a.slice(5)) - Number(b.slice(5))
}

/** 四半期の [startMs, endMs)（ローカル解釈ではなく ISO 日付文字列から） */
export function quarterRangeMs(id: QuarterId): { startMs: number; endMs: number } {
  const y = Number(id.slice(0, 4))
  const q = Number(id.slice(5)) as 1 | 2 | 3 | 4
  const startMonth = (q - 1) * 3 + 1
  const endMonth = startMonth + 3
  const start = `${y}-${String(startMonth).padStart(2, '0')}-01T00:00:00+09:00`
  let end: string
  if (endMonth > 12) {
    end = `${y + 1}-01-01T00:00:00+09:00`
  } else {
    end = `${y}-${String(endMonth).padStart(2, '0')}-01T00:00:00+09:00`
  }
  return {
    startMs: new Date(start).getTime(),
    endMs: new Date(end).getTime(),
  }
}

/** [rangeStart, rangeEnd] と重なる四半期 ID（昇順） */
export function quartersOverlappingRange(
  rangeStartMs: number,
  rangeEndMs: number,
  knownChunks: readonly QuarterId[],
): QuarterId[] {
  return knownChunks
    .filter((id) => {
      const { startMs, endMs } = quarterRangeMs(id)
      return startMs < rangeEndMs && endMs > rangeStartMs
    })
    .sort(compareQuarterIds)
}

export function isQuarterId(s: string): s is QuarterId {
  return /^\d{4}Q[1-4]$/.test(s)
}
