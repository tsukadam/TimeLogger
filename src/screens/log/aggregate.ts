import {
  DAY_MS,
  addDaysKey,
  addMonthsKey,
  dateKey,
  dayStartMs,
  nowIso,
} from '../../lib/time'
import type { Event, Folder, Task } from '../../types'
import type { AppliedRange, Column, Seg, Slice, TotalCol } from './types'

// Month サマリーで表示する日付ラベル（全日表示だと重なるため）
const MONTH_LABEL_DAYS = [1, 5, 10, 15, 20, 25, 30]

export function resolveDisplay(ev: Event, tasks: Task[], folders: Folder[]) {
  const task = tasks.find((t) => t.id === ev.taskId)
  const folderId = task?.folderId ?? ev.folderId
  const folder = folders.find((f) => f.id === folderId)
  return {
    taskId: ev.taskId,
    folderId,
    taskName: task?.name ?? ev.taskName,
    taskColor: task?.color ?? ev.taskColor,
    folderName: folder?.name ?? ev.folderName,
    folderColor: folder?.color ?? ev.folderColor,
  }
}

function clipSegs(
  events: Event[],
  tasks: Task[],
  folders: Folder[],
  colStart: number,
  colEnd: number,
  nowMs: number,
): Seg[] {
  const out: Seg[] = []
  for (const ev of events) {
    const s = new Date(ev.startedAt).getTime()
    const e = ev.endedAt ? new Date(ev.endedAt).getTime() : nowMs
    const a = Math.max(s, colStart)
    const b = Math.min(e, colEnd)
    if (!(b > a)) continue
    const d = resolveDisplay(ev, tasks, folders)
    out.push({
      eventId: ev.id,
      color: d.taskColor,
      name: d.taskName,
      start: a,
      end: b,
    })
  }
  out.sort((a, b) => a.start - b.start)
  return out
}

export type AggregateLogData = {
  taskSlices: Slice[]
  folderSlices: Slice[]
  pieTaskSlices: Slice[]
  pieFolderSlices: Slice[]
  totalSec: number
  columns: Column[]
  totalColumns: TotalCol[]
  chartMode: 'day' | 'stack'
  dayEvents: Event[]
}

export function aggregateLogData(args: {
  applied: AppliedRange
  events: Event[]
  tasks: Task[]
  folders: Folder[]
  now: number
  sumMode: 'tasks' | 'genres'
}): AggregateLogData {
  const { applied, events, tasks, folders, now, sumMode } = args
  const { start, end, kind: k } = applied
  const byTask = new Map<string, Slice>()
  const byFolder = new Map<string, Slice>()
  // 期間内で最初に記録された時刻（円グラフの並び順用）
  const firstByTask = new Map<string, number>()
  const firstByFolder = new Map<string, number>()
  const dayEvents: Event[] = []

  for (const ev of events) {
    const s = new Date(ev.startedAt).getTime()
    const e = ev.endedAt ? new Date(ev.endedAt).getTime() : now
    const a = Math.max(s, start)
    const b = Math.min(e, end)
    if (!(b > a)) continue
    if (k === 'day') dayEvents.push(ev)
    const sec = Math.floor((b - a) / 1000)
    if (sec <= 0) continue
    const d = resolveDisplay(ev, tasks, folders)

    const t = byTask.get(d.taskId)
    if (t) t.sec += sec
    else
      byTask.set(d.taskId, {
        id: d.taskId,
        name: d.taskName,
        color: d.taskColor,
        sec,
      })
    firstByTask.set(d.taskId, Math.min(firstByTask.get(d.taskId) ?? Infinity, a))

    const f = byFolder.get(d.folderId)
    if (f) f.sec += sec
    else
      byFolder.set(d.folderId, {
        id: d.folderId,
        name: d.folderName,
        color: d.folderColor,
        sec,
      })
    firstByFolder.set(
      d.folderId,
      Math.min(firstByFolder.get(d.folderId) ?? Infinity, a),
    )
  }

  dayEvents.sort(
    (a, b) =>
      new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  )

  const taskSlices = [...byTask.values()].sort((a, b) => b.sec - a.sec)
  const folderSlices = [...byFolder.values()].sort((a, b) => b.sec - a.sec)
  // 円グラフは初出現順（細かいパイが固まりにくく、ラベル重なりを緩和）
  const pieTaskSlices = [...byTask.values()].sort(
    (a, b) => (firstByTask.get(a.id) ?? 0) - (firstByTask.get(b.id) ?? 0),
  )
  const pieFolderSlices = [...byFolder.values()].sort(
    (a, b) => (firstByFolder.get(a.id) ?? 0) - (firstByFolder.get(b.id) ?? 0),
  )
  const totalSec = taskSlices.reduce((n, s) => n + s.sec, 0)

  let columns: Column[] = []
  let chartMode: 'day' | 'stack' = 'stack'

  if (k === 'all') {
    // no summary columns
  } else if (k === 'day') {
    chartMode = 'day'
    columns = [
      {
        key: dateKey(nowIso(new Date(start))),
        label: '',
        start,
        end,
        segs: clipSegs(events, tasks, folders, start, end, now),
      },
    ]
  } else if (k === 'year') {
    const baseKey = dateKey(nowIso(new Date(start)))
    for (let i = 0; i < 12; i++) {
      const csKey = addMonthsKey(baseKey, i)
      const ceKey = addMonthsKey(baseKey, i + 1)
      const cs = dayStartMs(csKey)
      const ce = dayStartMs(ceKey)
      columns.push({
        key: csKey,
        label: String(Number(csKey.slice(5, 7))),
        start: cs,
        end: ce,
        segs: clipSegs(events, tasks, folders, cs, ce, now),
      })
    }
  } else if (k === 'week' || k === 'month') {
    let cursor = dateKey(nowIso(new Date(start)))
    const lastDay = dateKey(nowIso(new Date(end - 1)))
    let guard = 0
    while (guard++ < 400 && cursor <= lastDay) {
      const cs = dayStartMs(cursor)
      const ce = cs + DAY_MS
      const dayNum = Number(cursor.slice(8, 10))
      columns.push({
        key: cursor,
        // Month は全日表示だとラベルが重なるので間引く
        label:
          k === 'month'
            ? MONTH_LABEL_DAYS.includes(dayNum)
              ? String(dayNum)
              : ''
            : String(dayNum),
        start: cs,
        end: ce,
        segs: clipSegs(events, tasks, folders, cs, ce, now),
      })
      cursor = addDaysKey(cursor, 1)
    }
  }
  // custom はサマリーなし（期間が可変で件数も多くなり得るため）

  // Genres 表示: 列（日/月）ごとのジャンル合算棒。積み順は期間内の初出現順（下から）
  let totalColumns: TotalCol[] = []
  if (sumMode === 'genres' && (k === 'week' || k === 'month' || k === 'year')) {
    totalColumns = columns.map((col) => {
      const m = new Map<string, Slice>()
      for (const ev of events) {
        const s = new Date(ev.startedAt).getTime()
        const e = ev.endedAt ? new Date(ev.endedAt).getTime() : now
        const a = Math.max(s, col.start)
        const b = Math.min(e, col.end)
        if (!(b > a)) continue
        const sec = Math.floor((b - a) / 1000)
        if (sec <= 0) continue
        const d = resolveDisplay(ev, tasks, folders)
        const cur = m.get(d.folderId)
        if (cur) cur.sec += sec
        else
          m.set(d.folderId, {
            id: d.folderId,
            name: d.folderName,
            color: d.folderColor,
            sec,
          })
      }
      const parts = [...m.values()].sort(
        (a, b) =>
          (firstByFolder.get(a.id) ?? 0) - (firstByFolder.get(b.id) ?? 0),
      )
      return {
        key: col.key,
        label: col.label,
        spanSec: (col.end - col.start) / 1000,
        parts,
      }
    })
  }

  return {
    taskSlices,
    folderSlices,
    pieTaskSlices,
    pieFolderSlices,
    totalSec,
    columns,
    totalColumns,
    chartMode,
    dayEvents,
  }
}
