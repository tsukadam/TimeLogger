package com.timelogger.wear

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

class ExerciseBindingsStore private constructor(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var typeToTask by mutableStateOf(read())
        private set

    fun taskIdFor(typeName: String): String? = typeToTask[typeName]

    fun typeNameFor(taskId: String): String? =
        typeToTask.entries.firstOrNull { it.value == taskId }?.key

    fun isLinked(taskId: String): Boolean = typeToTask.containsValue(taskId)

    fun bind(taskId: String, typeName: String) {
        val next = typeToTask
            .filter { it.key != typeName && it.value != taskId }
            .toMutableMap()
        next[typeName] = taskId
        write(next)
        typeToTask = next
    }

    fun unbind(taskId: String) {
        val next = typeToTask.filterValues { it != taskId }
        write(next)
        typeToTask = next
    }

    private fun read(): Map<String, String> {
        val raw = prefs.getString(KEY, null)
        if (raw == null) {
            val seed = mapOf(WALKING to DEFAULT_WALK_TASK)
            write(seed)
            return seed
        }
        val json = JSONObject(raw)
        val out = mutableMapOf<String, String>()
        json.keys().forEach { key ->
            val taskId = json.optString(key)
            if (key.isNotEmpty() && taskId.isNotEmpty()) out[key] = taskId
        }
        return out
    }

    private fun write(map: Map<String, String>) {
        val json = JSONObject()
        map.forEach { (type, taskId) -> json.put(type, taskId) }
        prefs.edit().putString(KEY, json.toString()).commit()
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
