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

function resourceUrl(resource: Resource): string {
  const base = API_BASE.replace(/\/$/, '')
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}resource=${resource}`
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
    }),
  )
}

export function isOnline(): boolean {
  return navigator.onLine
}
