/**
 * data/events.json を data/events/ 配下の四半期チャンクに分割する。
 * 元の events.json は消さない。
 *
 * 使い方: node scripts/split-events.mjs
 * 任意: node scripts/split-events.mjs path/to/events.json
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const srcPath = process.argv[2] ?? join(root, 'data', 'events.json')
const outDir = join(root, 'data', 'events')

function quarterIdFromIso(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  if (!m) throw new Error(`invalid iso: ${iso}`)
  const y = Number(m[1])
  const month = Number(m[2])
  const q = Math.floor((month - 1) / 3) + 1
  return `${y}Q${q}`
}

function compareQuarterIds(a, b) {
  if (a === b) return 0
  const ay = Number(a.slice(0, 4))
  const by = Number(b.slice(0, 4))
  if (ay !== by) return ay - by
  return Number(a.slice(5)) - Number(b.slice(5))
}

function currentQuarterId(now = new Date()) {
  // Asia/Tokyo の壁時計で「今」の四半期
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  })
  const parts = fmt.formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  return quarterIdFromIso(`${y}-${month}-01`)
}

if (!existsSync(srcPath)) {
  console.error(`not found: ${srcPath}`)
  process.exit(1)
}

const raw = JSON.parse(readFileSync(srcPath, 'utf8'))
const events = raw.events
if (!Array.isArray(events)) {
  console.error('events.json: missing events[]')
  process.exit(1)
}

/** @type {Map<string, typeof events>} */
const buckets = new Map()
for (const ev of events) {
  const id = quarterIdFromIso(ev.startedAt)
  let list = buckets.get(id)
  if (!list) {
    list = []
    buckets.set(id, list)
  }
  list.push(ev)
}

const chunkIds = [...buckets.keys()].sort(compareQuarterIds)
mkdirSync(outDir, { recursive: true })

const updatedAt = raw.updatedAt ?? new Date().toISOString()
let total = 0
for (const id of chunkIds) {
  const list = buckets.get(id)
  list.sort(
    (a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  )
  const file = { events: list, updatedAt }
  const path = join(outDir, `${id}.json`)
  writeFileSync(path, `${JSON.stringify(file, null, 4)}\n`, 'utf8')
  const kb = Math.round(Buffer.byteLength(JSON.stringify(file)) / 1024)
  console.log(`  ${id}.json  ${list.length} events  ~${kb} KB`)
  total += list.length
}

const current = currentQuarterId()
// current が空でもファイルを用意（これから書く先）
if (!buckets.has(current)) {
  chunkIds.push(current)
  chunkIds.sort(compareQuarterIds)
  writeFileSync(
    join(outDir, `${current}.json`),
    `${JSON.stringify({ events: [], updatedAt }, null, 4)}\n`,
    'utf8',
  )
  console.log(`  ${current}.json  0 events  (created empty current)`)
}

const index = {
  chunks: chunkIds,
  current,
  updatedAt,
}
writeFileSync(
  join(outDir, 'index.json'),
  `${JSON.stringify(index, null, 4)}\n`,
  'utf8',
)

console.log(
  `\nOK: ${total} events → ${chunkIds.length} chunks + index.json\n` +
    `kept original: ${srcPath}\n` +
    `out: ${outDir}\n` +
    `current: ${current}`,
)
