import { MIN_RECORD_MS, formatEventRange } from '../lib/time'
import type { Event } from '../types'

/** 手入力時刻の「未来」判定の猶予（入力中の時間経過を許容） */
export const FUTURE_GRACE_MS = 60000

/**
 * 既存記録との時間重複を探す。記録中（endedAt null）は現在時刻まで
 * 占有しているとみなす。端点の一致（10:00終了と10:00開始）は重複としない。
 *
 * 判定は秒精度（切り捨て）。リアルタイム記録はミリ秒付きで保存されるが、
 * 表示は秒までで編集入力も整数秒のため、表示上「同じ秒」に合わせた編集が
 * 見えない端数のせいで弾かれないようにする。
 */
export function findOverlap(
  events: Event[],
  startMs: number,
  endMs: number,
  excludeId: string | null,
  nowMs: number,
): Event | null {
  const floorSec = (ms: number) => Math.floor(ms / 1000)
  const startSec = floorSec(startMs)
  const endSec = floorSec(endMs)
  for (const ev of events) {
    if (excludeId !== null && ev.id === excludeId) continue
    const s = floorSec(new Date(ev.startedAt).getTime())
    const e = floorSec(ev.endedAt ? new Date(ev.endedAt).getTime() : nowMs)
    if (startSec < e && s < endSec) return ev
  }
  return null
}

function overlapError(hit: Event): Error {
  return new Error(
    `既存の記録（${hit.taskName} ${formatEventRange(hit.startedAt, hit.endedAt)}）と時間が重なっています`,
  )
}

/**
 * 記録の時間範囲バリデーション（未来・最小長・重複）。
 * task/folder 解決や「記録中の遷移ガード」は呼び出し側の責務。
 */
export function validateEventRange(opts: {
  events: Event[]
  startMs: number
  /** 記録中 update は nowMs を渡す（占有区間の上限） */
  endMs: number
  excludeId: string | null
  nowMs: number
  /** true: 終了時刻の有限性・順序・最小長・未来を検証（add / 終了済み edit） */
  validateEndBound: boolean
}): void {
  const { events, startMs, endMs, excludeId, nowMs, validateEndBound } = opts

  if (!Number.isFinite(startMs)) throw new Error('開始時刻が不正です')
  if (validateEndBound) {
    if (!Number.isFinite(endMs)) throw new Error('終了時刻が不正です')
    if (endMs <= startMs) throw new Error('終了は開始より後にしてください')
    if (endMs - startMs < MIN_RECORD_MS) {
      throw new Error('1秒未満の記録にはできません')
    }
  }

  // 未来の記録は作れない（リアルタイム記録との衝突防止）
  if (
    startMs > nowMs + FUTURE_GRACE_MS ||
    (validateEndBound && endMs > nowMs + FUTURE_GRACE_MS)
  ) {
    throw new Error('未来の時間には記録を作れません')
  }

  // 他の記録との時間重複は禁止
  const hit = findOverlap(events, startMs, endMs, excludeId, nowMs)
  if (hit) throw overlapError(hit)
}
