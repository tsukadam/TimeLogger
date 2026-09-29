package com.timelogger.wear

import android.content.Context
import com.timelogger.wear.api.Event
import com.timelogger.wear.api.Folder
import com.timelogger.wear.api.PendingResume
import com.timelogger.wear.api.QueueOp
import com.timelogger.wear.api.Task
import com.timelogger.wear.api.toEvent
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.temporal.ChronoUnit

internal const val LocalLogDays = 14

internal class LocalStore(context: Context) {
    private val dir = File(context.applicationContext.filesDir, "local").apply { mkdirs() }
    private val tasksFile = File(dir, "tasks.json")
    private val eventsFile = File(dir, "events.json")
    private val queueFile = File(dir, "queue.json")

    var folders: List<Folder> = emptyList()
        private set
    var tasks: List<Task> = emptyList()
        private set
    var events: List<Event> = emptyList()
        private set
    var queue: List<QueueOp> = emptyList()
        private set
    var pendingResume: PendingResume? = null
        private set

    fun load() {
        readTasks()
        readEvents()
        val pruned = prune(events)
        if (pruned.size != events.size) {
            events = pruned
            writeEvents()
        }
        readQueue()
        normalizeQueueLine()
    }

    fun openEvent(): Event? = events.lastOrNull { it.endedAt == null }

    fun setMaster(folders: List<Folder>, tasks: List<Task>) {
        this.folders = folders
        this.tasks = tasks
        writeTasks()
    }

    fun setEvents(events: List<Event>) {
        this.events = prune(events)
        writeEvents()
    }

    fun enqueue(op: QueueOp) {
        queue = queue + op
        writeQueue()
    }

    fun clearQueue() {
        queue = emptyList()
        writeQueue()
    }

    fun dropFlushed(count: Int) {
        if (count <= 0) return
        queue = queue.drop(count)
        writeQueue()
    }

    fun dropOpsForEvent(eventId: String) {
        val next = queue.filter { it.eventId != eventId }
        if (next.size == queue.size) return
        queue = next
        writeQueue()
    }

    fun normalizeQueueLine() {
        val out = ArrayList<QueueOp>(queue.size + 4)
        var openId: String? = null
        var changed = false
        for (op in queue) {
            when (op.op) {
                "start" -> {
                    if (openId != null) {
                        out.add(QueueOp("stop", op.at, openId))
                        changed = true
                    }
                    openId = op.eventId
                    out.add(op)
                }
                "edit", "update" -> out.add(op)
                "delete" -> {
                    if (openId == op.eventId) openId = null
                    out.add(op)
                }
                else -> {
                    if (openId == op.eventId) openId = null
                    out.add(op)
                }
            }
        }
        if (changed) {
            queue = out
            writeQueue()
        }
    }

    fun setPendingResume(value: PendingResume?) {
        pendingResume = value
        writeQueue()
    }

    fun applyLocalStart(event: Event) {
        setEvents(applyQueuedStart(events, event))
    }

    fun applyLocalStop(eventId: String, at: String) {
        setEvents(applyQueuedStop(events, eventId, at))
    }

    fun makeEvent(id: String, taskId: String, at: String): Event? {
        val task = tasks.find { it.id == taskId } ?: return null
        val folder = folders.find { it.id == task.folderId }
        return Event(
            id = id,
            taskId = task.id,
            folderId = task.folderId,
            taskName = task.name,
            folderName = folder?.name.orEmpty(),
            taskColor = task.color,
            folderColor = folder?.color.orEmpty(),
            startedAt = at,
            endedAt = null,
        )
    }

    private fun prune(events: List<Event>): List<Event> {
        val cutoff = Instant.now().minus(LocalLogDays.toLong(), ChronoUnit.DAYS)
        return events.filter { ev ->
            val end = ev.endedAt
            if (end.isNullOrEmpty()) true
            else runCatching { Instant.parse(end).isAfter(cutoff) }.getOrDefault(true)
        }
    }

    private fun readTasks() {
        val json = readJson(tasksFile) ?: return
        folders = json.optJSONArray("folders").toFolderList()
        tasks = json.optJSONArray("tasks").toTaskList()
    }

    private fun writeTasks() {
        val foldersArr = JSONArray()
        folders.forEach { f ->
            foldersArr.put(
                JSONObject()
                    .put("id", f.id)
                    .put("name", f.name)
                    .put("color", f.color)
                    .put("sortOrder", f.sortOrder),
            )
        }
        val tasksArr = JSONArray()
        tasks.forEach { t ->
            tasksArr.put(
                JSONObject()
                    .put("id", t.id)
                    .put("folderId", t.folderId)
                    .put("name", t.name)
                    .put("color", t.color)
                    .put("sortOrder", t.sortOrder),
            )
        }
        writeJson(tasksFile, JSONObject().put("folders", foldersArr).put("tasks", tasksArr))
    }

    private fun readEvents() {
        val json = readJson(eventsFile) ?: return
        val arr = json.optJSONArray("events") ?: return
        events = buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                add(o.toEvent() ?: continue)
            }
        }
    }

    private fun writeEvents() {
        val arr = JSONArray()
        events.forEach { e ->
            arr.put(
                JSONObject()
                    .put("id", e.id)
                    .put("taskId", e.taskId)
                    .put("folderId", e.folderId)
                    .put("taskName", e.taskName)
                    .put("folderName", e.folderName)
                    .put("taskColor", e.taskColor)
                    .put("folderColor", e.folderColor)
                    .put("startedAt", e.startedAt)
                    .put("endedAt", e.endedAt ?: JSONObject.NULL),
            )
        }
        writeJson(eventsFile, JSONObject().put("events", arr))
    }

    private fun readQueue() {
        val json = readJson(queueFile) ?: return
        val arr = json.optJSONArray("ops") ?: JSONArray()
        queue = buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val op = o.optString("op")
                val at = o.optString("at")
                val eventId = o.optString("eventId")
                if (op.isEmpty() || at.isEmpty() || eventId.isEmpty()) continue
                add(
                    QueueOp(
                        op = op,
                        at = at,
                        eventId = eventId,
                        taskId = o.optString("taskId").takeIf { it.isNotEmpty() },
                        startedAt = o.optString("startedAt").takeIf { it.isNotEmpty() },
                        endedAt = o.optString("endedAt").takeIf { it.isNotEmpty() },
                    ),
                )
            }
        }
        val r = json.optJSONObject("pendingResume")
        pendingResume = if (r == null) {
            null
        } else {
            val stopId = r.optString("stopEventId")
            val at = r.optString("at")
            val taskId = r.optString("resumeTaskId")
            if (stopId.isEmpty() || at.isEmpty() || taskId.isEmpty()) null
            else PendingResume(stopId, at, taskId)
        }
    }

    private fun writeQueue() {
        val arr = JSONArray()
        queue.forEach { op ->
            val o = JSONObject()
                .put("op", op.op)
                .put("at", op.at)
                .put("eventId", op.eventId)
            if (op.taskId != null) o.put("taskId", op.taskId)
            if (op.startedAt != null) o.put("startedAt", op.startedAt)
            if (op.endedAt != null) o.put("endedAt", op.endedAt)
            arr.put(o)
        }
        val json = JSONObject().put("ops", arr)
        pendingResume?.let { p ->
            json.put(
                "pendingResume",
                JSONObject()
                    .put("stopEventId", p.stopEventId)
                    .put("at", p.at)
                    .put("resumeTaskId", p.resumeTaskId),
            )
        }
        writeJson(queueFile, json)
    }

    private fun readJson(file: File): JSONObject? {
        if (!file.exists()) return null
        return runCatching { JSONObject(file.readText(Charsets.UTF_8)) }.getOrNull()
    }

    private fun writeJson(file: File, json: JSONObject) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(json.toString(), Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }
}

internal fun parseMs(iso: String): Long =
    runCatching { Instant.parse(iso).toEpochMilli() }.getOrDefault(0L)

private fun JSONArray?.toFolderList(): List<Folder> {
    if (this == null) return emptyList()
    return buildList {
        for (i in 0 until length()) {
            val o = optJSONObject(i) ?: continue
            add(
                Folder(
                    id = o.optString("id"),
                    name = o.optString("name"),
                    color = o.optString("color"),
                    sortOrder = o.optInt("sortOrder"),
                ),
            )
        }
    }.sortedBy { it.sortOrder }
}

private fun JSONArray?.toTaskList(): List<Task> {
    if (this == null) return emptyList()
    return buildList {
        for (i in 0 until length()) {
            val o = optJSONObject(i) ?: continue
            add(
                Task(
                    id = o.optString("id"),
                    folderId = o.optString("folderId"),
                    name = o.optString("name"),
                    color = o.optString("color"),
                    sortOrder = o.optInt("sortOrder"),
                ),
            )
        }
    }.sortedBy { it.sortOrder }
}
