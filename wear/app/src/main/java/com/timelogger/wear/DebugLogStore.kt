package com.timelogger.wear

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

internal class DebugLogStore(context: Context) {
    private val file = File(
        File(context.applicationContext.filesDir, "local").apply { mkdirs() },
        "debug-queue.json",
    )
    private val lock = Any()
    private var entries: List<JSONObject> = emptyList()

    init {
        synchronized(lock) { load() }
    }

    fun append(level: String, message: String, detail: JSONObject?, at: String) {
        val entry = JSONObject()
            .put("at", at)
            .put("level", level)
            .put("message", message)
        if (detail != null) {
            entry.put("detail", JSONObject(detail.toString()))
        }
        synchronized(lock) {
            entries = entries + entry
            persist()
        }
    }

    fun peek(max: Int): List<JSONObject> = synchronized(lock) {
        entries.take(max).map { JSONObject(it.toString()) }
    }

    fun dropFlushed(count: Int) {
        if (count <= 0) return
        synchronized(lock) {
            entries = entries.drop(count)
            persist()
        }
    }

    private fun load() {
        if (!file.exists()) {
            entries = emptyList()
            return
        }
        val json = runCatching { JSONObject(file.readText(Charsets.UTF_8)) }.getOrNull()
        val arr = json?.optJSONArray("entries")
        if (arr == null) {
            entries = emptyList()
            return
        }
        entries = buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (o.optString("message").isEmpty()) continue
                add(JSONObject(o.toString()))
            }
        }
    }

    private fun persist() {
        val arr = JSONArray()
        entries.forEach { arr.put(it) }
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(JSONObject().put("entries", arr).toString(), Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }
}
