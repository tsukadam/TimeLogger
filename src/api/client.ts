import type {
  ApiError,
  EventsFile,
  SettingsFile,
  TasksFile,
  WriteResult,
} from '../types'

export type Resource = 'tasks' | 'settings' | 'events'

type ResourceMap = {
  tasks: TasksFile
  settings: SettingsFile
  events: EventsFile
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

function resourceUrl(resource: Resource | 'debug'): string {
  const base = API_BASE.replace(/\/$/, '')
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}resource=${resource}`
}

export type DebugLevel = 'error' | 'warn' | 'info'

/**
 * サーバーの data/debug.log へ JSONL 追記（fire-and-forget）。
 * メインの API キューには乗せない（ハング調査用なので本処理を止めない）。
 */
export function reportDebugLog(
  level: DebugLevel,
  message: string,
  detail?: unknown,
): void {
  const body = JSON.stringify({
    level,
    message,
    detail: detail ?? null,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  })
  void fetch(resourceUrl('debug'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
    keepalive: true,
  }).catch((e) => {
    console.error('[api] debug log failed', e)
  })
}

export async function fetchResource<K extends Resource>(
  resource: K,
): Promise<ResourceMap[K]> {
  return enqueue(() =>
    withRetry(async () => {
      const res = await fetch(resourceUrl(resource), {
        method: 'GET',
        cache: 'no-store',
      })
      if (!res.ok) {
        throw new Error(`GET ${resource} failed: ${res.status}`)
      }
      return (await res.json()) as ResourceMap[K]
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
      const res = await fetch(resourceUrl(resource), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`PUT ${resource} failed: ${res.status} ${text}`)
      }
      // サーバーが updatedAt を付け直すので、返り値の updatedAt で揃える
      const result = (await res.json()) as WriteResult | ApiError
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

export function isOnline(): boolean {
  return navigator.onLine
}
