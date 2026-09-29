package com.timelogger.wear

import com.timelogger.wear.api.Event
import com.timelogger.wear.api.Folder
import com.timelogger.wear.api.Task
import java.time.Instant
import kotlin.math.round

internal const val SnapMs = 2L * 60L * 1000L

internal fun applyQueuedStart(events: List<Event>, event: Event): List<Event> {
    val atMs = parseMs(event.startedAt)
    return events.mapNotNull { ev ->
        if (ev.endedAt != null) return@mapNotNull ev
        val startMs = parseMs(ev.startedAt)
        when {
            startMs >= atMs || atMs - startMs < 1000L -> null
            else -> ev.copy(endedAt = event.startedAt)
        }
    } + event
}

internal fun applyQueuedStop(events: List<Event>, eventId: String, at: String): List<Event> {
    val atMs = parseMs(at)
    return events.mapNotNull { ev ->
        if (ev.id != eventId) return@mapNotNull ev
        if (ev.endedAt != null) return@mapNotNull ev
        val startMs = parseMs(ev.startedAt)
        if (atMs - startMs < 1000L) null else ev.copy(endedAt = at)
    }
}

internal data class TimeHole(val startMs: Long, val endMs: Long)

private const val HoleWindowMs = 12L * 60L * 60L * 1000L
private const val HoleMinMs = 60L * 1000L

internal fun findOldestHole(events: List<Event>, nowMs: Long): TimeHole? {
    val windowStart = nowMs - HoleWindowMs
    val intervals = events.mapNotNull { ev ->
        val s = parseMs(ev.startedAt)
        val e = if (ev.endedAt == null) nowMs else parseMs(ev.endedAt)
        if (e > windowStart && s < nowMs) s to e else null
    }.sortedBy { it.first }
    if (intervals.isEmpty()) return null
    val merged = ArrayList<Pair<Long, Long>>(intervals.size)
    for (x in intervals) {
        val last = merged.lastOrNull()
        if (last != null && x.first <= last.second) {
            merged[merged.lastIndex] = last.first to maxOf(last.second, x.second)
        } else {
            merged.add(x)
        }
    }
    val holes = ArrayList<Pair<Long, Long>>(merged.size + 1)
    holes.add(windowStart to merged.first().first)
    for (i in 0 until merged.lastIndex) {
        holes.add(merged[i].second to merged[i + 1].first)
    }
    holes.add(merged.last().second to nowMs)
    for (h in holes) {
        val s = maxOf(h.first, windowStart)
        val e = minOf(h.second, nowMs)
        if (e - s >= HoleMinMs) return TimeHole(s, e)
    }
    return null
}

internal fun applyOverwrite(
    events: List<Event>,
    eventId: String,
    startedAt: String,
    endedAt: String,
    nowMs: Long = System.currentTimeMillis(),
    newId: () -> String = { newWatchEventId() },
    task: Task? = null,
    folder: Folder? = null,
): List<Event>? {
    val snapped = snapGapTimes(events, eventId, startedAt, endedAt) ?: return null
    return paintOverwriteInterval(
        snapped.events,
        eventId,
        snapped.startedAt,
        snapped.endedAt,
        nowMs,
        newId,
        task,
        folder,
    )
}

internal data class GapSnap(
    val startedAt: String,
    val endedAt: String,
    val events: List<Event>,
)

/** 隙間が 2 分以内なら自分と隣を中点へ。重なりは塗りの仕事。 */
internal fun snapGapTimes(
    events: List<Event>,
    eventId: String,
    startedAt: String,
    endedAt: String,
): GapSnap? {
    val origStart = parseMs(startedAt)
    val origEnd = parseMs(endedAt)
    if (origEnd - origStart < 1000L) return null
    var startMs = origStart
    var endMs = origEnd
    val others = events.filter { it.id != eventId }.sortedBy { parseMs(it.startedAt) }
    var prev: Event? = null
    var next: Event? = null
    for (ev in others) {
        if (parseMs(ev.startedAt) <= startMs) {
            prev = ev
        } else {
            next = ev
            break
        }
    }
    val patched = events.toMutableList()
    fun patch(id: String, startedAt: String? = null, endedAt: String? = null) {
        val i = patched.indexOfFirst { it.id == id }
        if (i < 0) return
        val ev = patched[i]
        patched[i] = ev.copy(
            startedAt = startedAt ?: ev.startedAt,
            endedAt = endedAt ?: ev.endedAt,
        )
    }
    val prevEnded = prev?.endedAt
    if (prev != null && !prevEnded.isNullOrEmpty()) {
        val prevEnd = parseMs(prevEnded)
        val gap = startMs > prevEnd
        if (gap && startMs - prevEnd <= SnapMs) {
            val mid = round((prevEnd + startMs) / 2.0).toLong()
            if (mid - parseMs(prev.startedAt) < 1000L) return null
            startMs = mid
            patch(prev.id, endedAt = isoOrSnapped(prevEnded, prevEnd, mid))
        }
    }
    if (next != null) {
        val nextStart = parseMs(next.startedAt)
        val gap = endMs < nextStart
        if (gap && nextStart - endMs <= SnapMs) {
            val mid = round((endMs + nextStart) / 2.0).toLong()
            val nextEnd = next.endedAt
            if (!nextEnd.isNullOrEmpty() && parseMs(nextEnd) - mid < 1000L) return null
            endMs = mid
            patch(next.id, startedAt = isoOrSnapped(next.startedAt, nextStart, mid))
        }
    }
    if (endMs - startMs < 1000L) return null
    return GapSnap(
        startedAt = isoOrSnapped(startedAt, origStart, startMs),
        endedAt = isoOrSnapped(endedAt, origEnd, endMs),
        events = patched,
    )
}

private fun isoOrSnapped(original: String, origMs: Long, snappedMs: Long): String =
    if (origMs == snappedMs) original else ApiTime.iso(Instant.ofEpochMilli(snappedMs))

private fun paintOverwriteInterval(
    events: List<Event>,
    eventId: String,
    startedAt: String,
    endedAt: String,
    nowMs: Long,
    newId: () -> String,
    task: Task?,
    folder: Folder?,
): List<Event>? {
    val target = events.find { it.id == eventId }
    if (target == null && task == null) return null
    val startMs = parseMs(startedAt)
    val endMs = parseMs(endedAt)
    if (endMs - startMs < 1000L) return null
    val out = ArrayList<Event>(events.size + 4)
    for (ev in events) {
        if (ev.id == eventId) continue
        val s = parseMs(ev.startedAt)
        val open = ev.endedAt == null
        val e = if (open) nowMs else parseMs(ev.endedAt!!)
        if (e <= startMs || s >= endMs) {
            out.add(ev)
            continue
        }
        if (s >= startMs && e <= endMs) continue
        if (s < startMs && startMs - s >= 1000L) {
            out.add(ev.copy(endedAt = startedAt))
        }
        if (e > endMs && e - endMs >= 1000L) {
            out.add(
                ev.copy(
                    id = if (s < startMs) newId() else ev.id,
                    startedAt = endedAt,
                    endedAt = if (open) null else ev.endedAt,
                ),
            )
        }
    }
    out.add(
        if (task == null) {
            target!!.copy(startedAt = startedAt, endedAt = endedAt)
        } else {
            Event(
                id = eventId,
                taskId = task.id,
                folderId = task.folderId,
                taskName = task.name,
                folderName = folder?.name ?: target?.folderName.orEmpty(),
                taskColor = task.color,
                folderColor = folder?.color ?: target?.folderColor.orEmpty(),
                startedAt = startedAt,
                endedAt = endedAt,
            )
        },
    )
    return out.sortedBy { parseMs(it.startedAt) }
}

/** 記録中の開始変更。隣は [startedAt, いま) で塗り、対象の行は開いたまま。 */
internal fun applyOpenStartEdit(
    events: List<Event>,
    eventId: String,
    startedAt: String,
    nowMs: Long = System.currentTimeMillis(),
    newId: () -> String = { newWatchEventId() },
    task: Task? = null,
    folder: Folder? = null,
): List<Event>? {
    val nowIso = ApiTime.iso(Instant.ofEpochMilli(nowMs))
    val painted = applyOverwrite(
        events,
        eventId,
        startedAt,
        nowIso,
        nowMs,
        newId,
        task,
        folder,
    ) ?: return null
    return painted.map { ev ->
        if (ev.id == eventId) ev.copy(endedAt = null) else ev
    }
}
