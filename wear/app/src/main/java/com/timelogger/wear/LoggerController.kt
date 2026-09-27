package com.timelogger.wear

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.timelogger.wear.api.ApiException
import com.timelogger.wear.api.Event
import com.timelogger.wear.api.Folder
import com.timelogger.wear.api.Task
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class LoggerController(
    private val repo: RecordRepository,
    private val scope: CoroutineScope,
    private val loadingText: String,
    private val retryText: String,
    val bindings: ExerciseBindingsStore,
) {
    var folders by mutableStateOf<List<Folder>>(emptyList())
        private set
    var tasks by mutableStateOf<List<Task>>(emptyList())
        private set
    var events by mutableStateOf<List<Event>>(emptyList())
        private set
    var current by mutableStateOf<Event?>(null)
        private set
    var status by mutableStateOf<String?>(null)
        private set
    var loading by mutableStateOf(false)
        private set
    var busy by mutableStateOf(false)
        private set
    var pendingTaskId by mutableStateOf<String?>(null)
        private set
    var queued by mutableStateOf(false)
        private set

    init {
        apply(repo.snapshot())
    }

    fun tasksIn(folderId: String): List<Task> = tasks.filter { it.folderId == folderId }

    fun folder(id: String): Folder? = folders.find { it.id == id }

    fun task(id: String): Task? = tasks.find { it.id == id }

    fun onResume() {
        if (!loading && !busy) syncNow(announce = false)
    }

    fun retry() {
        if (!busy) syncNow(announce = true)
    }

    fun refresh() {
        syncNow(announce = false)
    }

    fun pullRefresh() {
        syncNow(announce = true)
    }

    private fun syncNow(announce: Boolean) {
        if (loading) return
        if (announce && busy) return
        loading = true
        if (announce) status = "同期中"
        else if (folders.isEmpty()) status = loadingText
        scope.launch {
            try {
                withContext(Dispatchers.IO) { repo.flushThenPull() }
                apply(repo.snapshot())
                status = if (queued) "未送信が残っています" else null
            } catch (e: Exception) {
                apply(repo.snapshot())
                status = e.message ?: retryText
            } finally {
                loading = false
            }
        }
    }

    fun onTask(taskId: String): Boolean {
        if (busy) return false
        if (current?.taskId == taskId) stopCurrent()
        else startTask(taskId)
        return true
    }

    fun overwriteEvent(
        eventId: String,
        startedAt: String,
        endedAt: String,
        taskId: String? = null,
    ): Boolean {
        if (busy) return false
        runWrite(eventId) { repo.overwriteEvent(eventId, startedAt, endedAt, taskId) }
        return true
    }

    fun deleteEvent(eventId: String): Boolean {
        if (busy) return false
        runWrite(eventId) { repo.deleteEvent(eventId) }
        return true
    }

    private fun startTask(taskId: String) {
        runWrite(taskId) { repo.startTask(taskId) }
    }

    private fun stopCurrent() {
        val taskId = current?.taskId ?: return
        runWrite(taskId) { repo.stopCurrent() }
    }

    private fun runWrite(taskId: String, block: () -> Unit) {
        busy = true
        status = null
        pendingTaskId = taskId
        scope.launch {
            try {
                withContext(Dispatchers.IO) { block() }
                apply(repo.snapshot())
                status = null
            } catch (e: ApiException) {
                apply(repo.snapshot())
                if (e.status == 409) {
                    refresh()
                    return@launch
                }
                status = e.message
            } catch (e: Exception) {
                apply(repo.snapshot())
                status = e.message
            } finally {
                pendingTaskId = null
                busy = false
            }
        }
    }

    private fun apply(snap: RecordSnapshot) {
        folders = snap.folders
        tasks = snap.tasks
        events = snap.events
        current = snap.current
        queued = snap.queued
    }
}
