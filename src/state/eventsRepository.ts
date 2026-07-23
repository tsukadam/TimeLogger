import {
  compareQuarterIds,
  currentQuarterId,
  isQuarterId,
  previousQuarterId,
  quarterIdFromIso,
  quartersOverlappingRange,
  type QuarterId,
} from '../lib/eventChunks'
import type { Event, EventsFile, EventsIndex } from '../types'
import {
  fetchEventsChunk,
  fetchResource,
  putEventsChunk,
  putResource,
} from '../api/client'
import { nowIso } from '../lib/time'

export type ChunkMap = Record<string, EventsFile>

export function mergeChunkEvents(chunks: ChunkMap): Event[] {
  return Object.values(chunks)
    .flatMap((f) => f.events)
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
}

export function findChunkIdForEvent(
  chunks: ChunkMap,
  eventId: string,
): string | null {
  for (const [id, file] of Object.entries(chunks)) {
    if (file.events.some((e) => e.id === eventId)) return id
  }
  return null
}

/** 起動時に読むチャンク（current + 一つ前） */
export function bootChunkIds(index: EventsIndex): string[] {
  const cur = index.current
  const ids = [cur]
  if (isQuarterId(cur)) {
    const prev = previousQuarterId(cur)
    if (index.chunks.includes(prev)) ids.unshift(prev)
  }
  return ids
}

export function hasMoreOlderChunks(
  index: EventsIndex | null,
  chunks: ChunkMap,
): boolean {
  if (!index || index.chunks.length === 0) return false
  const loaded = Object.keys(chunks)
  if (loaded.length === 0) return index.chunks.length > 0
  const oldestLoaded = loaded.sort(compareQuarterIds as (a: string, b: string) => number)[0]!
  const idx = index.chunks.indexOf(oldestLoaded)
  return idx > 0
}

export function nextOlderChunkId(
  index: EventsIndex,
  chunks: ChunkMap,
): string | null {
  const loaded = Object.keys(chunks)
  if (loaded.length === 0) return index.chunks[index.chunks.length - 1] ?? null
  const oldestLoaded = loaded.sort(compareQuarterIds as (a: string, b: string) => number)[0]!
  const i = index.chunks.indexOf(oldestLoaded)
  if (i <= 0) return null
  return index.chunks[i - 1] ?? null
}

export async function loadChunks(
  ids: string[],
  existing: ChunkMap,
  index: EventsIndex,
): Promise<ChunkMap> {
  const want = [...new Set(ids)].filter((id) => index.chunks.includes(id))
  const missing = want.filter((id) => !existing[id])
  if (missing.length === 0) return existing
  const loaded = await Promise.all(
    missing.map(async (id) => {
      const file = await fetchEventsChunk(id)
      return [id, file] as const
    }),
  )
  const next = { ...existing }
  for (const [id, file] of loaded) next[id] = file
  return next
}

/**
 * 変更のあったチャンクだけ PUT。必要なら index も更新。
 * `updates` の value はそのチャンクの完全な events 配列。
 */
export async function persistChunkUpdates(
  updates: Record<string, Event[]>,
  index: EventsIndex,
): Promise<{ chunks: ChunkMap; index: EventsIndex }> {
  const t = nowIso()
  let nextIndex = index
  const touchIds = Object.keys(updates)
  const missingInIndex = touchIds.filter((id) => !index.chunks.includes(id))
  const cur = currentQuarterId()
  let chunksList = [...index.chunks]
  let changedIndex = false
  if (missingInIndex.length > 0) {
    chunksList = [...new Set([...chunksList, ...missingInIndex])]
    changedIndex = true
  }
  if (!chunksList.includes(cur)) {
    chunksList.push(cur)
    changedIndex = true
  }
  if (index.current !== cur) {
    // 四半期が進んでいたら current を追従
    nextIndex = { ...nextIndex, current: cur }
    changedIndex = true
  }
  if (changedIndex) {
    chunksList = [...chunksList].sort(
      compareQuarterIds as (a: string, b: string) => number,
    )
    nextIndex = {
      chunks: chunksList,
      current: cur,
      updatedAt: t,
    }
    nextIndex = await putResource('events-index', nextIndex)
  }

  const savedEntries = await Promise.all(
    touchIds.map(async (id) => {
      const saved = await putEventsChunk(id, {
        events: updates[id]!,
        updatedAt: t,
      })
      return [id, saved] as const
    }),
  )
  const chunkPatch: ChunkMap = {}
  for (const [id, file] of savedEntries) chunkPatch[id] = file
  return { chunks: chunkPatch, index: nextIndex }
}

export async function fetchBootEvents(): Promise<{
  index: EventsIndex
  chunks: ChunkMap
}> {
  const index = await fetchResource('events-index')
  const ids = bootChunkIds(index)
  const chunks = await loadChunks(ids, {}, index)
  return { index, chunks }
}

export function rangeChunkIds(
  index: EventsIndex,
  startMs: number,
  endMs: number,
): string[] {
  const known = index.chunks.filter(isQuarterId) as QuarterId[]
  return quartersOverlappingRange(startMs, endMs, known)
}

export { quarterIdFromIso }
