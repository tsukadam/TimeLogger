package com.timelogger.wear

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.wear.tiles.TileService
import org.json.JSONObject
import java.io.File

class ExerciseBindingsStore private constructor(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val file = File(File(app.filesDir, "local").apply { mkdirs() }, "bindings.json")

    var typeToTask by mutableStateOf(readFromDisk())
        private set

    fun taskIdFor(typeName: String): String? = readFromDisk()[typeName]

    fun typeNameFor(taskId: String): String? =
        typeToTask.entries.firstOrNull { it.value == taskId }?.key

    fun isLinked(taskId: String): Boolean = typeToTask.containsValue(taskId)

    fun linkedTaskIds(): Set<String> = readFromDisk().values.toSet()

    fun bind(taskId: String, typeName: String) {
        val next = readFromDisk()
            .filter { it.key != typeName && it.value != taskId }
            .toMutableMap()
        next[typeName] = taskId
        persist(next)
    }

    fun unbind(taskId: String) {
        persist(readFromDisk().filterValues { it != taskId })
    }

    private fun persist(next: Map<String, String>) {
        writeDisk(next)
        typeToTask = next
        pingTiles()
    }

    private fun readFromDisk(): Map<String, String> {
        if (file.exists()) {
            val parsed = parse(file.readText())
            if (parsed != null) return parsed
        }
        val raw = prefs.getString(KEY, null)
        if (raw != null) {
            val parsed = parse(raw) ?: emptyMap()
            writeDisk(parsed)
            return parsed
        }
        val seed = mapOf(WALKING to DEFAULT_WALK_TASK)
        writeDisk(seed)
        return seed
    }

    private fun parse(raw: String): Map<String, String>? {
        return try {
            val json = JSONObject(raw)
            val out = mutableMapOf<String, String>()
            json.keys().forEach { key ->
                val taskId = json.optString(key)
                if (key.isNotEmpty() && taskId.isNotEmpty()) out[key] = taskId
            }
            out
        } catch (_: Exception) {
            null
        }
    }

    private fun writeDisk(map: Map<String, String>) {
        val json = JSONObject()
        map.forEach { (type, taskId) -> json.put(type, taskId) }
        val text = json.toString()
        file.writeText(text)
        prefs.edit().putString(KEY, text).commit()
    }

    private fun pingTiles() {
        val updater = TileService.getUpdater(app)
        LoggerTileServices.forEach { cls ->
            runCatching { updater.requestUpdate(cls) }
        }
    }

    companion object {
        private const val PREFS = "exercise_bindings"
        private const val KEY = "typeToTask"
        const val WALKING = "WALKING"
        const val DEFAULT_WALK_TASK = "78c0bc2e-21e0-49f1-8624-71dd33d32d27"

        @Volatile
        private var instance: ExerciseBindingsStore? = null

        fun get(context: Context): ExerciseBindingsStore {
            instance?.let { return it }
            return synchronized(this) {
                instance ?: ExerciseBindingsStore(context.applicationContext).also {
                    instance = it
                }
            }
        }
    }
}
