package com.timelogger.wear.api

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

class TimeLoggerApi(
    private val baseUrl: String = ApiConfig.BASE_URL,
) {
    fun fetchNow(): NowResult {
        val json = request("GET", "now")
        return NowResult(
            current = json.optEvent("current"),
            last = json.optEvent("last"),
            tasksUpdatedAt = json.optString("tasksUpdatedAt"),
        )
    }

    fun fetchTasks(): TasksFile {
        val json = request("GET", "tasks")
        return TasksFile(
            folders = json.optJSONArray("folders").toFolders(),
            tasks = json.optJSONArray("tasks").toTasks(),
            updatedAt = json.optString("updatedAt"),
        )
    }

    fun fetchEventsIndex(): List<String> {
        val json = request("GET", "events-index")
        val arr = json.optJSONArray("chunks") ?: return emptyList()
        return buildList {
            for (i in 0 until arr.length()) {
                val id = arr.optString(i)
                if (id.isNotEmpty()) add(id)
            }
        }
    }

    fun fetchEventsChunk(chunk: String): List<Event> {
        val json = request("GET", "events", extraQuery = "&chunk=$chunk")
        return json.optJSONArray("events").toEvents()
    }

    fun start(taskId: String, at: String? = null, eventId: String? = null): CommandWrite {
        val body = JSONObject().put("taskId", taskId)
        if (at != null) body.put("at", at)
        if (eventId != null) body.put("eventId", eventId)
        return parseWrite(request("POST", "start", body))
    }

    fun signalStart(taskId: String, at: String, eventId: String? = null): CommandWrite {
        val body = JSONObject().put("taskId", taskId).put("at", at)
        if (eventId != null) body.put("eventId", eventId)
        return parseWrite(request("POST", "signal-start", body))
    }

    fun signalStop(eventId: String, at: String, resumeTaskId: String? = null): CommandWrite {
        val body = JSONObject().put("eventId", eventId).put("at", at)
        if (!resumeTaskId.isNullOrEmpty()) body.put("resumeTaskId", resumeTaskId)
        return parseWrite(request("POST", "signal-stop", body))
    }

    fun stop(eventId: String? = null, at: String? = null): CommandWrite {
        val body = JSONObject()
        if (eventId != null) body.put("eventId", eventId)
        if (at != null) body.put("at", at)
        return parseWrite(request("POST", "stop", body))
    }

    fun overwrite(
        eventId: String,
        startedAt: String,
        endedAt: String,
        editedAt: String,
        taskId: String? = null,
    ): CommandWrite {
        val body = JSONObject()
            .put("eventId", eventId)
            .put("startedAt", startedAt)
            .put("endedAt", endedAt)
            .put("editedAt", editedAt)
        if (taskId != null) body.put("taskId", taskId)
        return parseWrite(request("POST", "overwrite", body))
    }

    fun update(
        eventId: String,
        startedAt: String,
        taskId: String? = null,
    ): CommandWrite {
        val body = JSONObject()
            .put("eventId", eventId)
            .put("startedAt", startedAt)
        if (taskId != null) body.put("taskId", taskId)
        return parseWrite(request("POST", "update", body))
    }

    fun delete(eventId: String): CommandWrite {
        return parseWrite(request("POST", "delete", JSONObject().put("eventId", eventId)))
    }

    fun debug(message: String, detail: JSONObject? = null) {
        val body = JSONObject().put("level", "info").put("message", message).put("ua", "TimeLogger-Wear")
        if (detail != null) body.put("detail", detail)
        request("POST", "debug", body)
    }

    fun mergeQueue(ops: List<QueueOp>): CommandWrite {
        val arr = JSONArray()
        for (op in ops) {
            val o = JSONObject()
                .put("op", op.op)
                .put("at", op.at)
                .put("eventId", op.eventId)
            if (op.op == "start") o.put("taskId", op.taskId)
            arr.put(o)
        }
        return parseWrite(request("POST", "merge-queue", JSONObject().put("ops", arr)))
    }

    private fun parseWrite(json: JSONObject): CommandWrite {
        val skipped = json.optJSONArray("skipped")
        return CommandWrite(
            current = json.optEvent("current"),
            last = json.optEvent("last"),
            tasksUpdatedAt = json.optString("tasksUpdatedAt"),
            skipped = skipped.toSkipped(),
        )
    }

    private fun request(
        method: String,
        resource: String,
        body: JSONObject? = null,
        extraQuery: String = "",
    ): JSONObject {
        val url = URL("$baseUrl?resource=$resource$extraQuery")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "TimeLogger-Wear")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            }
        }
        try {
            if (body != null) {
                conn.outputStream.use { out ->
                    out.write(body.toString().toByteArray(StandardCharsets.UTF_8))
                }
            }
            val stream = if (conn.responseCode in 200..299) {
                conn.inputStream
            } else {
                conn.errorStream ?: conn.inputStream
            }
            val text = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            val json = try {
                JSONObject(text.ifBlank { "{}" })
            } catch (_: Exception) {
                throw ApiException(conn.responseCode, text.ifBlank { "empty response" })
            }
            if (conn.responseCode !in 200..299) {
                val err = json.optString("error").ifBlank { "HTTP ${conn.responseCode}" }
                throw ApiException(conn.responseCode, err)
            }
            return json
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            throw ApiException(-1, e.message ?: "network error")
        } finally {
            conn.disconnect()
        }
    }
}

internal fun JSONObject.toEvent(): Event? {
    val id = optString("id")
    val taskId = optString("taskId")
    val startedAt = optString("startedAt")
    if (id.isEmpty() || taskId.isEmpty() || startedAt.isEmpty()) return null
    return Event(
        id = id,
        taskId = taskId,
        folderId = optString("folderId"),
        taskName = optString("taskName"),
        folderName = optString("folderName"),
        taskColor = optString("taskColor"),
        folderColor = optString("folderColor"),
        startedAt = startedAt,
        endedAt = if (has("endedAt") && !isNull("endedAt")) optString("endedAt").ifEmpty { null } else null,
    )
}

private fun JSONObject.optEvent(key: String): Event? {
    if (!has(key) || isNull(key)) return null
    return optJSONObject(key)?.toEvent()
}

private fun JSONArray?.toEvents(): List<Event> {
    if (this == null) return emptyList()
    return buildList {
        for (i in 0 until length()) {
            val o = optJSONObject(i) ?: continue
            add(o.toEvent() ?: continue)
        }
    }
}

private fun JSONArray?.toSkipped(): List<SkippedStop> {
    if (this == null) return emptyList()
    return buildList {
        for (i in 0 until length()) {
            val o = optJSONObject(i) ?: continue
            val id = o.optString("eventId")
            if (id.isEmpty()) continue
            add(SkippedStop(id, o.optString("at")))
        }
    }
}

private fun JSONArray?.toFolders(): List<Folder> {
    if (this == null) return emptyList()
    return buildList {
        for (i in 0 until length()) {
            val o = optJSONObject(i) ?: continue
            add(
                Folder(
                    id = o.getString("id"),
                    name = o.getString("name"),
                    color = o.optString("color"),
                    sortOrder = o.optInt("sortOrder"),
                ),
            )
        }
    }.sortedBy { it.sortOrder }
}

private fun JSONArray?.toTasks(): List<Task> {
    if (this == null) return emptyList()
    return buildList {
        for (i in 0 until length()) {
            val o = optJSONObject(i) ?: continue
            add(
                Task(
                    id = o.getString("id"),
                    folderId = o.getString("folderId"),
                    name = o.getString("name"),
                    color = o.optString("color"),
                    sortOrder = o.optInt("sortOrder"),
                ),
            )
        }
    }.sortedBy { it.sortOrder }
}
