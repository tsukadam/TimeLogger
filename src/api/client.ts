import type {
  ApiError,
  EventsFile,
  EventsIndex,
  SettingsFile,
  TasksFile,
  WriteResult,
} from '../types'

export type Resource = 'tasks' | 'settings' | 'events-index'

type ResourceMap = {
  tasks: TasksFile
  settings: SettingsFile
  'events-index': EventsIndex
}

const API_BASE = import.meta.env.VITE_API_BASE ?? './api/index.php'

/** 書き込みがこの時間を超えても終わらなければ warn をサーバーログへ */
export const WRITE_SLOW_MS = 8000

/** 同時に1本だけ。成功するまで次を出さない。 */
let chain: Promise<unknown> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  // 失敗してもチェーンは止めない（次の呼び出し側で扱う）
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 500
  let last: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (i === retries) break
      await sleep(baseDelayMs * (i + 1))
    }
  }
  throw last
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    const preview = text.slice(0, 160).replace(/\s+/g, ' ')
    throw new Error(
      `Invalid JSON (${res.status} ${res.url}): ${preview || '(empty)'}`,
    )
  }
}

function apiUrl(query: Record<string, string>): string {
  const base = API_BASE.replace(/\/$/, '')
  const sep = base.includes('?') ? '&' : '?'
  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return `${base}${sep}${qs}`
}

export type DebugLevel = 'error' | 'warn' | 'info'

/**
 * サーバーの data/debug.log へ JSONL 追記（fire-and-forget）。
 * メインの API キューには乗せない。失敗しても本処理には影響させない。
 *
 * 注意: Safari は keepalive + cache:'no-store' の組み合わせを拒否し、
 * 「The string did not match the expected pattern.」を投げることがある。
 */
export function reportDebugLog(
  level: DebugLevel,
  message: string,
  detail?: unknown,
): void {
  try {
    const body = JSON.stringify({
      level,
      message,
      detail: detail ?? null,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
    void fetch(apiUrl({ resource: 'debug' }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch((e) => {
      console.error('[api] debug log failed', e)
    })
  } catch (e) {
    console.error('[api] debug log failed', e)
  }
}

export async function fetchResource<K extends Resource>(
  resource: K,
): Promise<ResourceMap[K]> {
  return enqueue(() =>
    withRetry(async () => {
      const res = await fetch(apiUrl({ resource }), {
        method: 'GET',
        cache: 'no-store',
      })
      if (!res.ok) {
        throw new Error(`GET ${resource} failed: ${res.status}`)
      }
      return await readJson<ResourceMap[K]>(res)
    }).catch((e) => {
      console.error(`[api] GET ${resource}`, e)
      reportDebugLog('error', `GET ${resource} failed`, {
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }),
  )
}

export async function putResource<K extends Resource>(
  resource: K,
  body: ResourceMap[K],
): Promise<ResourceMap[K]> {
  return enqueue(() =>
    withRetry(async () => {
      const res = await fetch(apiUrl({ resource }), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`PUT ${resource} failed: ${res.status} ${text}`)
      }
      const result = await readJson<WriteResult | ApiError>(res)
      if (!result.ok) {
        throw new Error(`PUT ${resource} rejected`)
      }
      return { ...body, updatedAt: result.updatedAt }
    }).catch((e) => {
      console.error(`[api] PUT ${resource}`, e)
      reportDebugLog('error', `PUT ${resource} failed`, {
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }),
  )
}

export async function fetchEventsChunk(chunk: string): Promise<EventsFile> {
  return enqueue(() =>
    withRetry(async () => {
      const res = await fetch(apiUrl({ resource: 'events', chunk }), {
        method: 'GET',
        cache: 'no-store',
      })
      if (!res.ok) {
        throw new Error(`GET events ${chunk} failed: ${res.status}`)
      }
      return await readJson<EventsFile>(res)
    }).catch((e) => {
      console.error(`[api] GET events ${chunk}`, e)
      reportDebugLog('error', `GET events ${chunk} failed`, {
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }),
  )
}

export async function putEventsChunk(
  chunk: string,
  body: EventsFile,
): Promise<EventsFile> {
  return enqueue(() =>
    withRetry(async () => {
      const res = await fetch(apiUrl({ resource: 'events', chunk }), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`PUT events ${chunk} failed: ${res.status} ${text}`)
      }
      const result = await readJson<WriteResult | ApiError>(res)
      if (!result.ok) {
        throw new Error(`PUT events ${chunk} rejected`)
      }
      return { ...body, updatedAt: result.updatedAt }
    }).catch((e) => {
      console.error(`[api] PUT events ${chunk}`, e)
      reportDebugLog('error', `PUT events ${chunk} failed`, {
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }),
  )
}

export function isOnline(): boolean {
  return navigator.onLine
}
