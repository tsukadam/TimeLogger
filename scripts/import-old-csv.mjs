// 旧 TimeLogger (TimeLoggerPlus) の CSV エクスポートを
// data/tasks.json + data/events.json に変換する一回きりのインポータ。
// 使い方: node scripts/import-old-csv.mjs <csvPath>
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const FOLDER_PALETTE = [
  '#e08a3c',
  '#5bb98c',
  '#5b8de2',
  '#c45c9a',
  '#c9b458',
  '#e25b5b',
  '#6a9a8b',
  '#b89b6a',
  '#7d8bb8',
  '#a67c7c',
  '#8a9e6e',
  '#9a8ab0',
]

const csvPath = process.argv[2]
if (!csvPath) {
  console.error('usage: node scripts/import-old-csv.mjs <csvPath>')
  process.exit(1)
}

// 素朴な CSV 行パーサ（クォート対応）
function parseLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

// UTC の ISO を +09:00 表記（ms なし）へ
function toJst(isoZ) {
  const d = new Date(isoZ)
  if (Number.isNaN(d.getTime())) return null
  const t = new Date(d.getTime() + 9 * 3600000)
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}` +
    `T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}+09:00`
  )
}

const text = readFileSync(csvPath, 'utf8')
const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
const header = parseLine(lines[0])
console.log('header:', header.join(' | '))
console.log('data rows:', lines.length - 1)

const rows = []
for (let i = 1; i < lines.length; i++) {
  const f = parseLine(lines[i])
  if (f.length < 8) {
    console.warn(`skip line ${i + 1}: ${f.length} fields`)
    continue
  }
  const [folder, task, type, , , started, end] = f
  if (type !== 'Event') {
    console.warn(`skip line ${i + 1}: type=${type}`)
    continue
  }
  rows.push({ folder, task, started, end })
}

// 古い順に処理する（初出現順の sortOrder のため）
rows.sort((a, b) => a.started.localeCompare(b.started))

const now = toJst(new Date().toISOString())
const folders = new Map() // name -> folder
const tasks = new Map() // folderName + '\0' + taskName -> task
const events = []

for (const r of rows) {
  const startedAt = toJst(r.started)
  const endedAt = toJst(r.end)
  if (!startedAt || !endedAt) {
    console.warn('skip row with bad time:', JSON.stringify(r))
    continue
  }

  let folder = folders.get(r.folder)
  if (!folder) {
    folder = {
      id: randomUUID(),
      name: r.folder,
      color: FOLDER_PALETTE[folders.size % FOLDER_PALETTE.length],
      sortOrder: folders.size,
      createdAt: startedAt,
      updatedAt: startedAt,
    }
    folders.set(r.folder, folder)
  }

  const taskKey = `${r.folder}\0${r.task}`
  let task = tasks.get(taskKey)
  if (!task) {
    const inFolder = [...tasks.values()].filter(
      (t) => t.folderId === folder.id,
    ).length
    task = {
      id: randomUUID(),
      folderId: folder.id,
      name: r.task,
      color: folder.color,
      sortOrder: inFolder,
      createdAt: startedAt,
      updatedAt: startedAt,
    }
    tasks.set(taskKey, task)
  }

  events.push({
    id: randomUUID(),
    taskId: task.id,
    folderId: folder.id,
    taskName: task.name,
    folderName: folder.name,
    taskColor: task.color,
    folderColor: folder.color,
    startedAt,
    endedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  })
}

const tasksFile = {
  folders: [...folders.values()],
  tasks: [...tasks.values()],
  updatedAt: now,
}
const eventsFile = { events, updatedAt: now }

writeFileSync('data/tasks.json', JSON.stringify(tasksFile, null, 4) + '\n')
writeFileSync('data/events.json', JSON.stringify(eventsFile, null, 4) + '\n')

console.log(
  `done: folders=${folders.size} tasks=${tasks.size} events=${events.length}`,
)
console.log(
  'range:',
  events[0]?.startedAt,
  '->',
  events[events.length - 1]?.endedAt,
)
