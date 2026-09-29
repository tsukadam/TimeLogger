package com.timelogger.wear

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.wear.tiles.TileBuilders.Tile
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import com.timelogger.wear.api.ApiException
import com.timelogger.wear.api.CommandWrite
import com.timelogger.wear.api.Event
import com.timelogger.wear.api.Folder
import com.timelogger.wear.api.NowResult
import com.timelogger.wear.api.PendingResume
import com.timelogger.wear.api.QueueOp
import com.timelogger.wear.api.Task
import com.timelogger.wear.api.TimeLoggerApi
import org.json.JSONObject
import java.time.Instant
import java.time.YearMonth
import java.time.ZoneId
import java.util.concurrent.TimeUnit

internal const val RECORD_TAG = "RecordRepo"

data class RecordSnapshot(
    val folders: List<Folder>,
    val tasks: List<Task>,
    val events: List<Event>,
    val current: Event?,
    val queued: Boolean,
)

class RecordRepository internal constructor(
    private val app: Context,
    private val api: TimeLoggerApi = TimeLoggerApi(),
) {
    private val lock = Any()
    private val store = LocalStore(app)
    @Volatile
    private var lastOkTileNowMs = 0L

    init {
        synchronized(lock) { store.load() }
    }

    fun snapshot(): RecordSnapshot = synchronized(lock) {
        RecordSnapshot(store.folders, store.tasks, store.events, store.openEvent(), store.queue.isNotEmpty())
    }

    fun localCurrentTaskId(): String? = synchronized(lock) { store.openEvent()?.taskId }

    fun pullWhenTileVisible(): ListenableFuture<Void?> {
        val future = SettableFuture.create<Void?>()
        tilePullExecutor.execute {
            try {
                pullNowForTile()
                pingTile()
            } catch (_: Exception) {
                pingTile()
            } finally {
                future.set(null)
            }
        }
        return future
    }

    fun tileLayoutAfterNow(build: () -> Tile): ListenableFuture<Tile> {
        val future = SettableFuture.create<Tile>()
        tilePullExecutor.execute {
            try {
                pullNowForTile()
            } catch (_: Exception) {
            } finally {
                future.set(build())
            }
        }
        return future
    }

    private fun pullNowForTile() {
        val now = System.currentTimeMillis()
        if (now - lastOkTileNowMs in 0 until 5_000L) return
        applyNowToStore(api.fetchNowForTile())
        lastOkTileNowMs = System.currentTimeMillis()
    }

    private fun applyNowToStore(now: NowResult) {
        synchronized(lock) {
            var next = store.events
            val current = now.current
            val last = now.last
            if (current != null) {
                next = next.filter { it.id != current.id }.map { ev ->
                    if (ev.endedAt == null) ev.copy(endedAt = current.startedAt) else ev
                } + current
            } else if (last != null) {
                next = next.map { ev ->
                    when {
                        ev.id == last.id -> last
                        ev.endedAt == null -> ev.copy(endedAt = last.endedAt ?: last.startedAt)
                        else -> ev
                    }
                }
                if (next.none { it.id == last.id }) next = next + last
            } else {
                val end = ApiTime.iso(Instant.now())
                next = next.map { ev ->
                    if (ev.endedAt == null) ev.copy(endedAt = end) else ev
                }
            }
            store.setEvents(next)
        }
    }

    fun scheduleFlush() {
        WorkManager.getInstance(app).enqueueUniqueWork(
            FLUSH_WORK,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<FlushWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build(),
        )
    }

    fun flushThenPull() {
        if (!isOnline()) throw ApiException(-1, "オフライン")
        drainQueue()
        if (synchronized(lock) { store.queue.isEmpty() }) {
            pullMasterAndLog()
        } else {
            scheduleFlush()
        }
    }

    fun liveCurrentEventId(): String? {
        if (isOnline()) {
            runCatching { api.fetchNow().current?.id }.getOrNull()?.let { return it }
        }
        return synchronized(lock) { store.openEvent()?.id }
    }

    fun toggleTaskLocal(taskId: String) {
        ExerciseSync.dropHsSession(app)
        val open = synchronized(lock) { store.openEvent() }
        val at = ApiTime.iso(Instant.now())
        if (open?.taskId == taskId) {
            queueStop(open.id, at)
        } else {
            queueStart(newWatchEventId(), taskId, at)
        }
    }

    fun startTask(taskId: String) {
        ExerciseSync.dropHsSession(app)
        val at = ApiTime.iso(Instant.now())
        val eventId = newWatchEventId()
        if (isOnline()) {
            try {
                ingest(api.start(taskId, at, eventId))
                afterOnlineWrite()
                return
            } catch (e: ApiException) {
                if (isClientError(e)) throw e
            }
        }
        queueStart(eventId, taskId, at)
    }

    fun stopCurrent() {
        ExerciseSync.dropHsSession(app)
        val current = synchronized(lock) { store.openEvent() } ?: return
        val at = ApiTime.iso(Instant.now())
        if (isOnline()) {
            try {
                ingest(api.stop(current.id, at))
                afterOnlineWrite()
                return
            } catch (e: ApiException) {
                if (e.status == 409) {
                    afterOnlineWrite()
                    return
                }
                if (isClientError(e)) throw e
            }
        }
        queueStop(current.id, at)
    }

    fun signalStart(taskId: String, atMs: Long): String {
        val at = ApiTime.iso(ApiTime.clamp(Instant.ofEpochMilli(atMs)))
        val eventId = newWatchEventId()
        if (isOnline()) {
            try {
                ingest(api.signalStart(taskId, at, eventId))
                afterOnlineWrite()
                return eventId
            } catch (e: ApiException) {
                if (isClientError(e)) throw e
            }
        }
        queueStart(eventId, taskId, at)
        return eventId
    }

    fun signalStop(eventId: String, atMs: Long, resumeTaskId: String?) {
        val at = ApiTime.iso(ApiTime.clamp(Instant.ofEpochMilli(atMs)))
        if (isOnline()) {
            try {
                ingest(api.signalStop(eventId, at, resumeTaskId))
                afterOnlineWrite()
                return
            } catch (e: ApiException) {
                if (e.status == 409 || e.status == 404) {
                    afterOnlineWrite()
                    return
                }
                if (isClientError(e)) throw e
            }
        }
        queueStop(eventId, at)
        if (!resumeTaskId.isNullOrEmpty()) {
            synchronized(lock) {
                store.setPendingResume(PendingResume(eventId, at, resumeTaskId))
            }
        }
    }

    fun overwriteEvent(
        eventId: String,
        startedAt: String,
        endedAt: String,
        taskId: String? = null,
    ) {
        ExerciseSync.dropHsSession(app)
        val editedAt = ApiTime.iso(Instant.now())
        if (isOnline()) {
            try {
                api.overwrite(eventId, startedAt, endedAt, editedAt, taskId)
                synchronized(lock) {
                    paintOverwrite(eventId, startedAt, endedAt, taskId)?.let { store.setEvents(it) }
                }
                afterOnlineWrite()
                return
            } catch (e: ApiException) {
                Log.w(RECORD_TAG, "overwrite live ${e.status} ${e.message}")
                if (isClientError(e)) throw e
            }
        }
        queueOverwrite(eventId, startedAt, endedAt, editedAt, taskId)
    }

    fun updateOpenEvent(
        eventId: String,
        startedAt: String,
        taskId: String? = null,
    ) {
        ExerciseSync.dropHsSession(app)
        if (isOnline()) {
            try {
                api.update(eventId, startedAt, taskId)
                synchronized(lock) {
                    paintOpenStart(eventId, startedAt, taskId)?.let { store.setEvents(it) }
                }
                afterOnlineWrite()
                return
            } catch (e: ApiException) {
                Log.w(RECORD_TAG, "update live ${e.status} ${e.message}")
                if (isClientError(e)) throw e
            }
        }
        queueOpenUpdate(eventId, startedAt, taskId)
    }

    fun deleteEvent(eventId: String) {
        ExerciseSync.dropHsSession(app)
        if (isOnline()) {
            try {
                api.delete(eventId)
                synchronized(lock) {
                    store.setEvents(store.events.filter { it.id != eventId })
                    store.dropOpsForEvent(eventId)
                }
                afterOnlineWrite()
                return
            } catch (e: ApiException) {
                Log.w(RECORD_TAG, "delete live ${e.status} ${e.message}")
                if (e.status != 404 && isClientError(e)) throw e
            }
        }
        queueDelete(eventId)
    }

    private fun afterOnlineWrite() {
        try {
            flushThenPull()
        } catch (_: Exception) {
            scheduleFlush()
        }
    }

    private fun drainQueue() {
        while (true) {
            val ops = synchronized(lock) {
                store.normalizeQueueLine()
                store.queue
            }
            if (ops.isEmpty()) break
            try {
                when (ops.first().op) {
                    "edit" -> flushOneEdit(ops.first())
                    "update" -> flushOneUpdate(ops.first())
                    "delete" -> flushOneDelete(ops.first())
                    else -> flushStartStopPrefix(ops)
                }
            } catch (e: ApiException) {
                if (e.status == -1 || e.status == 408 || e.status >= 500) throw e
                Log.w(RECORD_TAG, "queue skip ${ops.first().op} ${ops.first().eventId} ${e.status} ${e.message}")
                synchronized(lock) { store.dropFlushed(1) }
            }
        }
    }

    private fun queueStart(eventId: String, taskId: String, at: String) {
        synchronized(lock) {
            val event = store.makeEvent(eventId, taskId, at)
                ?: throw ApiException(404, "タスクがありません")
            val open = store.openEvent()
            if (open != null && open.id != eventId) {
                store.enqueue(QueueOp("stop", at, open.id))
            }
            store.applyLocalStart(event)
            store.enqueue(QueueOp("start", at, eventId, taskId))
        }
        scheduleFlush()
        pingTile()
    }

    private fun queueStop(eventId: String, at: String) {
        synchronized(lock) {
            store.applyLocalStop(eventId, at)
            store.enqueue(QueueOp("stop", at, eventId))
        }
        scheduleFlush()
        pingTile()
    }

    private fun queueOverwrite(
        eventId: String,
        startedAt: String,
        endedAt: String,
        editedAt: String,
        taskId: String?,
    ) {
        synchronized(lock) {
            val next = paintOverwrite(eventId, startedAt, endedAt, taskId)
                ?: throw ApiException(400, "記録を更新できません")
            store.setEvents(next)
            store.enqueue(
                QueueOp(
                    op = "edit",
                    at = editedAt,
                    eventId = eventId,
                    taskId = taskId,
                    startedAt = startedAt,
                    endedAt = endedAt,
                ),
            )
        }
        scheduleFlush()
    }

    private fun queueOpenUpdate(
        eventId: String,
        startedAt: String,
        taskId: String?,
    ) {
        synchronized(lock) {
            val next = paintOpenStart(eventId, startedAt, taskId)
                ?: throw ApiException(400, "開始はいまより前にしてください")
            store.setEvents(next)
            store.enqueue(
                QueueOp(
                    op = "update",
                    at = ApiTime.iso(Instant.now()),
                    eventId = eventId,
                    taskId = taskId,
                    startedAt = startedAt,
                ),
            )
        }
        scheduleFlush()
    }

    private fun queueDelete(eventId: String) {
        synchronized(lock) {
            store.setEvents(store.events.filter { it.id != eventId })
            store.enqueue(QueueOp("delete", ApiTime.iso(Instant.now()), eventId))
        }
        scheduleFlush()
    }

    private fun paintOverwrite(
        eventId: String,
        startedAt: String,
        endedAt: String,
        taskId: String?,
    ): List<Event>? {
        val task = taskId?.let { id -> store.tasks.find { it.id == id } }
        val folder = task?.let { t -> store.folders.find { it.id == t.folderId } }
        return applyOverwrite(
            store.events,
            eventId,
            startedAt,
            endedAt,
            task = task,
            folder = folder,
        )
    }

    private fun paintOpenStart(
        eventId: String,
        startedAt: String,
        taskId: String?,
    ): List<Event>? {
        val task = taskId?.let { id -> store.tasks.find { it.id == id } }
        val folder = task?.let { t -> store.folders.find { it.id == t.folderId } }
        return applyOpenStartEdit(
            store.events,
            eventId,
            startedAt,
            task = task,
            folder = folder,
        )
    }

    private fun flushOneEdit(op: QueueOp) {
        val started = op.startedAt
        val ended = op.endedAt
        if (started.isNullOrEmpty() || ended.isNullOrEmpty()) {
            Log.w(RECORD_TAG, "overwrite drop empty times ${op.eventId}")
            noteRemote("overwrite drop empty", op.eventId, null)
            synchronized(lock) { store.dropFlushed(1) }
            return
        }
        var editedAt = op.at
        try {
            api.overwrite(op.eventId, started, ended, editedAt, op.taskId)
        } catch (e: ApiException) {
            Log.w(RECORD_TAG, "overwrite ${op.eventId} ${e.status} ${e.message}")
            noteRemote("overwrite fail", op.eventId, e)
            if (e.status in 400..499 && e.status != 408) {
                synchronized(lock) { store.dropFlushed(1) }
                return
            }
            throw e
        }
        synchronized(lock) { store.dropFlushed(1) }
        Log.i(RECORD_TAG, "overwrite flushed ${op.eventId}")
        noteRemote("overwrite ok", op.eventId, null)
    }

    private fun flushOneUpdate(op: QueueOp) {
        val started = op.startedAt
        if (started.isNullOrEmpty()) {
            Log.w(RECORD_TAG, "update drop empty start ${op.eventId}")
            noteRemote("update drop empty", op.eventId, null)
            synchronized(lock) { store.dropFlushed(1) }
            return
        }
        try {
            api.update(op.eventId, started, op.taskId)
        } catch (e: ApiException) {
            Log.w(RECORD_TAG, "update ${op.eventId} ${e.status} ${e.message}")
            noteRemote("update fail", op.eventId, e)
            if (e.status in 400..499 && e.status != 408) {
                synchronized(lock) { store.dropFlushed(1) }
                return
            }
            throw e
        }
        synchronized(lock) { store.dropFlushed(1) }
        Log.i(RECORD_TAG, "update flushed ${op.eventId}")
        noteRemote("update ok", op.eventId, null)
    }

    private fun flushOneDelete(op: QueueOp) {
        try {
            api.delete(op.eventId)
        } catch (e: ApiException) {
            Log.w(RECORD_TAG, "delete ${op.eventId} ${e.status} ${e.message}")
            noteRemote("delete fail", op.eventId, e)
            if (e.status in 400..499 && e.status != 408) {
                synchronized(lock) { store.dropFlushed(1) }
                return
            }
            throw e
        }
        synchronized(lock) { store.dropFlushed(1) }
        Log.i(RECORD_TAG, "delete flushed ${op.eventId}")
        noteRemote("delete ok", op.eventId, null)
    }

    private fun noteRemote(message: String, eventId: String, err: ApiException?) {
        val detail = JSONObject().put("eventId", eventId)
        if (err != null) {
            detail.put("status", err.status).put("error", err.message ?: "")
        }
        runCatching { api.debug(message, detail) }
    }

    private fun flushStartStopPrefix(ops: List<QueueOp>) {
        val batch = ops.takeWhile { it.op != "edit" && it.op != "delete" && it.op != "update" }
        if (batch.isEmpty()) return
        val result = try {
            api.mergeQueue(batch)
        } catch (e: ApiException) {
            Log.w(RECORD_TAG, "merge ${e.status} ${e.message}")
            noteRemote("merge fail", batch.first().eventId, e)
            if (e.status == 400 && (e.message?.contains("重複") == true)) {
                synchronized(lock) {
                    store.dropFlushed(batch.size)
                    store.setPendingResume(null)
                }
                return
            }
            if (e.status in 400..499 && e.status != 408) {
                flushOpsOneByOne(batch)
                return
            }
            throw e
        }
        val skipped = result.skipped.map { it.eventId }.toSet()
        val pending = synchronized(lock) {
            val p = store.pendingResume
            store.dropFlushed(batch.size)
            if (p != null && batch.any { it.op == "stop" && it.eventId == p.stopEventId }) {
                store.setPendingResume(null)
                p
            } else {
                null
            }
        }
        val keepLocalEdits = synchronized(lock) {
            store.queue.any { it.op == "edit" || it.op == "update" || it.op == "delete" }
        }
        if (!keepLocalEdits) {
            ingest(result)
        }
        if (pending != null && pending.stopEventId !in skipped) {
            val resumeId = newWatchEventId()
            try {
                ingest(
                    api.mergeQueue(
                        listOf(
                            QueueOp(
                                op = "start",
                                at = pending.at,
                                eventId = resumeId,
                                taskId = pending.resumeTaskId,
                            ),
                        ),
                    ),
                )
            } catch (e: ApiException) {
                Log.w(RECORD_TAG, "resume after merge failed ${e.status} ${e.message}")
                queueStart(resumeId, pending.resumeTaskId, pending.at)
            }
        }
    }

    private fun flushOpsOneByOne(batch: List<QueueOp>) {
        for (op in batch) {
            try {
                when (op.op) {
                    "start" -> {
                        val taskId = op.taskId
                            ?: throw ApiException(400, "taskId required")
                        ingest(api.start(taskId, op.at, op.eventId))
                    }
                    "stop" -> ingest(api.stop(op.eventId, op.at))
                }
            } catch (e: ApiException) {
                Log.w(RECORD_TAG, "flush one ${op.op} ${op.eventId} ${e.status} ${e.message}")
                val skip = e.status in 400..499 && e.status != 408
                if (!skip) throw e
            }
            synchronized(lock) { store.dropFlushed(1) }
        }
    }

    private fun ingest(write: CommandWrite) {
        synchronized(lock) {
            val open = write.current
            val last = write.last
            var next = store.events
            if (last != null) {
                next = next.filter { it.id != last.id } + last
            }
            if (open != null) {
                next = next
                    .mapNotNull { ev ->
                        when {
                            ev.id == open.id -> null
                            ev.endedAt == null -> ev.copy(endedAt = open.startedAt)
                            else -> ev
                        }
                    } + open
            } else {
                next = next.map { ev ->
                    if (ev.endedAt == null && last != null && ev.id == last.id) last else ev
                }
            }
            store.setEvents(next)
        }
        pingTile()
    }

    private fun pullMasterAndLog() {
        val tasksFile = api.fetchTasks()
        synchronized(lock) { store.setMaster(tasksFile.folders, tasksFile.tasks) }
        val now = runCatching { api.fetchNow() }.getOrNull()
        val fetched = fetchRecentEvents()
        synchronized(lock) {
            var next = fetched.ifEmpty { store.events }
            val current = now?.current
            val last = now?.last
            if (current != null) {
                next = next.filter { it.id != current.id }.map { ev ->
                    if (ev.endedAt == null) ev.copy(endedAt = current.startedAt) else ev
                } + current
            } else if (last != null) {
                next = next.map { ev ->
                    when {
                        ev.id == last.id -> last
                        ev.endedAt == null -> ev.copy(endedAt = last.endedAt ?: last.startedAt)
                        else -> ev
                    }
                }
                if (next.none { it.id == last.id }) next = next + last
            }
            store.setEvents(next)
        }
        pingTile()
    }

    private fun pingTile() {
        val updater = TileService.getUpdater(app)
        LoggerTileServices.forEach { cls ->
            runCatching { updater.requestUpdate(cls) }
        }
    }

    fun peekPrevTaskId(): String? {
        if (isOnline()) {
            runCatching { api.fetchNow().current?.taskId }.getOrNull()?.let { return it }
        }
        return localCurrentTaskId()
    }

    private fun fetchRecentEvents(): List<Event> {
        val chunks = runCatching { api.fetchEventsIndex() }.getOrDefault(emptyList())
        val needed = chunks.filter { chunkOverlapsLocalLog(it) }.ifEmpty { chunks.takeLast(1) }
        return needed.flatMap { id ->
            runCatching { api.fetchEventsChunk(id) }.getOrDefault(emptyList())
        }
    }

    private fun isOnline(): Boolean {
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(net) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun isClientError(e: ApiException): Boolean =
        e.status in 400..499 && e.status != 408

    companion object {
        private const val FLUSH_WORK = "tl-flush"
        private val tokyo = ZoneId.of("Asia/Tokyo")
        private val tilePullExecutor = java.util.concurrent.Executors.newSingleThreadExecutor { r ->
            Thread(r, "tl-tile-pull").apply { isDaemon = true }
        }

        @Volatile
        private var instance: RecordRepository? = null

        fun get(context: Context): RecordRepository {
            val app = context.applicationContext
            return instance ?: synchronized(this) {
                instance ?: RecordRepository(app).also { instance = it }
            }
        }

        internal fun chunkOverlapsLocalLog(chunk: String): Boolean {
            if (chunk.length < 6 || chunk[4] != 'Q') return false
            val year = chunk.take(4).toIntOrNull() ?: return false
            val q = chunk.last().digitToIntOrNull() ?: return false
            val startMonth = (q - 1) * 3 + 1
            val start = YearMonth.of(year, startMonth).atDay(1).atStartOfDay(tokyo).toInstant()
            val end = YearMonth.of(year, startMonth + 2).atEndOfMonth()
                .atTime(23, 59, 59)
                .atZone(tokyo)
                .toInstant()
            val cutoff = Instant.now().minus(LocalLogDays.toLong(), java.time.temporal.ChronoUnit.DAYS)
            return end.isAfter(cutoff) && start.isBefore(Instant.now())
        }
    }
}

class FlushWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        return try {
            RecordRepository.get(applicationContext).flushThenPull()
            Result.success()
        } catch (e: ApiException) {
            Log.e(RECORD_TAG, "flush ${e.status} ${e.message}")
            if (e.status == -1 || e.status >= 500) Result.retry() else Result.success()
        } catch (e: Exception) {
            Log.e(RECORD_TAG, "flush failed", e)
            Result.retry()
        }
    }
}
