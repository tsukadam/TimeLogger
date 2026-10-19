package com.timelogger.wear

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.PassiveListenerConfig
import androidx.health.services.client.data.UserActivityInfo
import androidx.health.services.client.data.UserActivityState
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.timelogger.wear.api.ApiException
import com.timelogger.wear.api.Event
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

internal const val EXERCISE_SYNC_TAG = "ExerciseSync"

internal object ApiTime {
    private val fmt = DateTimeFormatter
        .ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX")
        .withZone(ZoneId.of("Asia/Tokyo"))

    fun iso(instant: Instant): String = fmt.format(instant)

    fun clamp(change: Instant, now: Instant = Instant.now()): Instant =
        if (change.isAfter(now)) now else change
}

internal data class ExerciseSignal(
    val state: String,
    val atMs: Long,
    val typeName: String,
) {
    val fingerprint: String get() = "$state|$atMs|$typeName"
}

internal data class SleepTimer(
    val kind: String,
    val atMs: Long,
)

object ExerciseSync {
    internal const val SLEEP_WAIT_MS = 5L * 60L * 1000L
    private const val SLEEP_TICK_WORK = "hs-sleep-tick"
    private const val SLEEP_ENTER_WORK = "hs-sleep-enter"
    private const val SLEEP_LEAVE_WORK = "hs-sleep-leave"
    private const val SLEEP_CONFIRM_WORK_LEGACY = "hs-sleep-confirm"
    private const val TIMER_ENTER = "A"
    private const val TIMER_LEAVE = "B"
    private const val KIND_SLEEP = "sleep"
    private const val KIND_EXERCISE = "exercise"
    private const val DATA_KIND = "kind"
    private const val DATA_AT = "atMs"

    @Volatile
    var uiRefresh: (() -> Unit)? = null

    val listenerConfig: PassiveListenerConfig = PassiveListenerConfig.builder()
        .setShouldUserActivityInfoBeRequested(true)
        .build()

    fun ensureRegistered(context: Context) {
        val app = context.applicationContext
        val wm = WorkManager.getInstance(app)
        wm.enqueueUniqueWork(
            "hs-register",
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<RegisterPassiveListenerWorker>()
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build(),
        )
        wm.cancelUniqueWork(SLEEP_CONFIRM_WORK_LEGACY)
        wm.cancelUniqueWork(SLEEP_ENTER_WORK)
        wm.cancelUniqueWork(SLEEP_LEAVE_WORK)
        wm.cancelUniqueWork(SLEEP_TICK_WORK)
        for (timer in ExerciseSyncStore(app).allTimers()) {
            startTimer(app, timer.kind, timer.atMs)
        }
    }

    fun onSignal(context: Context, info: UserActivityInfo) {
        val typeName = info.exerciseInfo?.exerciseType?.name.orEmpty()
        val state = when (info.userActivityState) {
            UserActivityState.USER_ACTIVITY_EXERCISE -> "EXERCISE"
            UserActivityState.USER_ACTIVITY_PASSIVE -> "PASSIVE"
            UserActivityState.USER_ACTIVITY_ASLEEP -> "ASLEEP"
            else -> "UNKNOWN"
        }
        val signal = ExerciseSignal(state, info.stateChangeTime.toEpochMilli(), typeName)
        Log.i(EXERCISE_SYNC_TAG, "signal $state ${ApiTime.iso(Instant.ofEpochMilli(signal.atMs))} $typeName")
        val app = context.applicationContext
        ExerciseSyncStore(app).enqueue(signal)
        WorkManager.getInstance(app).enqueueUniqueWork(
            "hs-exercise-sync",
            ExistingWorkPolicy.APPEND,
            OneTimeWorkRequestBuilder<ExerciseSyncWorker>()
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build(),
        )
        RecordRepository.get(app).scheduleFlush()
    }

    fun notifyUi() {
        val cb = uiRefresh ?: return
        Handler(Looper.getMainLooper()).post(cb)
    }

    fun dropHsSession(context: Context) {
        val app = context.applicationContext
        timerLog(app, "w", "logger tap: forget resume", JSONObject())
        ExerciseSyncStore(app).forgetResume()
    }

    @Synchronized
    internal fun drainSignals(context: Context) {
        val app = context.applicationContext
        val store = ExerciseSyncStore(app)
        while (true) {
            val signal = store.peek() ?: break
            try {
                if (store.lastFingerprint() != signal.fingerprint) {
                    timerLog(
                        app,
                        "i",
                        "signal ${signal.state}",
                        JSONObject()
                            .put("at", isoMs(signal.atMs))
                            .put("type", signal.typeName),
                    )
                    when (signal.state) {
                        "EXERCISE" -> onExercise(app, store, signal)
                        "ASLEEP" -> onAsleep(app, store, signal)
                        "PASSIVE" -> onPassive(app, store, signal)
                        else -> store.setLastFingerprint(signal.fingerprint)
                    }
                }
                store.dropHead()
            } catch (e: ApiException) {
                if (e.status == -1 || e.status == 408 || e.status >= 500) throw e
                timerLog(
                    app,
                    "e",
                    "signal drop ${e.status}",
                    JSONObject()
                        .put("at", isoMs(signal.atMs))
                        .put("state", signal.state)
                        .put("err", e.message ?: ""),
                )
                store.dropHead()
            }
        }
    }

    @Synchronized
    internal fun onTimerFire(context: Context, kind: String, atMs: Long) {
        val app = context.applicationContext
        drainSignals(app)
        val store = ExerciseSyncStore(app)
        if (!store.removeTimer(kind, atMs)) {
            timerLog(
                app,
                "w",
                "timer fire skipped: already gone",
                JSONObject().put("timerKind", kind).put("at", isoMs(atMs)),
            )
            return
        }
        timerLog(
            app,
            "i",
            "timer fire $kind",
            JSONObject().put("timerKind", kind).put("at", isoMs(atMs)),
        )
        try {
            when (kind) {
                TIMER_ENTER -> confirmEnter(app, store, atMs)
                TIMER_LEAVE -> confirmLeave(app, store, atMs)
                else -> timerLog(app, "e", "timer unknown kind", JSONObject().put("timerKind", kind))
            }
        } catch (e: ApiException) {
            if (e.status == -1 || e.status == 408 || e.status >= 500) {
                startTimer(app, kind, atMs)
            }
            throw e
        }
    }

    private fun startTimer(context: Context, kind: String, atMs: Long) {
        val app = context.applicationContext
        val store = ExerciseSyncStore(app)
        val added = store.addTimer(kind, atMs)
        val delay = (atMs + SLEEP_WAIT_MS - System.currentTimeMillis()).coerceAtLeast(0L)
        val request = OneTimeWorkRequestBuilder<SleepTimerWorker>()
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setInputData(workDataOf(DATA_KIND to kind, DATA_AT to atMs))
            .addTag("hs-sleep-timer")
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .apply {
                if (delay == 0L) {
                    setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                }
            }
            .build()
        WorkManager.getInstance(app).enqueueUniqueWork(
            timerWorkName(kind, atMs),
            ExistingWorkPolicy.KEEP,
            request,
        )
        if (!added) return
        timerLog(
            app,
            "i",
            "timer start $kind",
            JSONObject()
                .put("timerKind", kind)
                .put("at", isoMs(atMs))
                .put("delayMs", delay),
        )
    }

    private fun timerWorkName(kind: String, atMs: Long): String = "hs-timer-$kind-$atMs"

    private fun confirmEnter(app: Context, store: ExerciseSyncStore, onAt: Long) {
        val last = store.lastHsState()
        if (last != "ASLEEP") {
            timerLog(app, "w", "A fire skip: hs=$last", JSONObject().put("onAt", isoMs(onAt)))
            return
        }
        if (ExerciseBindingsStore.get(app).taskIdFor(ExerciseTypes.SLEEP_ID) == null) {
            timerLog(app, "e", "A fire: SLEEP unbound", JSONObject().put("onAt", isoMs(onAt)))
            return
        }
        timerLog(app, "i", "A fire: hs asleep", JSONObject().put("onAt", isoMs(onAt)))
        RecordRepository.get(app).signalHsState("ASLEEP", onAt)
    }

    fun adoptServerCurrent(context: Context, current: Event?, last: Event?) {
        val app = context.applicationContext
        val sleepId = ExerciseBindingsStore.get(app).taskIdFor(ExerciseTypes.SLEEP_ID) ?: return
        val store = ExerciseSyncStore(app)
        if (current?.taskId == sleepId) {
            store.setSession(
                last?.taskId,
                current.id,
                store.lastFingerprint().orEmpty(),
                KIND_SLEEP,
            )
            notifyUi()
            return
        }
        if (store.sessionKind() == KIND_SLEEP) {
            store.clearSession(store.lastFingerprint().orEmpty())
            notifyUi()
        }
    }

    private fun confirmLeave(app: Context, store: ExerciseSyncStore, offAt: Long) {
        val last = store.lastHsState()
        if (last == "ASLEEP") {
            timerLog(app, "w", "B fire skip: still ASLEEP", JSONObject().put("offAt", isoMs(offAt)))
            return
        }
        timerLog(app, "i", "B fire: hs passive", JSONObject().put("offAt", isoMs(offAt)))
        RecordRepository.get(app).signalHsState("PASSIVE", offAt)
    }

    private fun onExercise(
        context: Context,
        store: ExerciseSyncStore,
        signal: ExerciseSignal,
    ) {
        if (store.sessionKind() == KIND_SLEEP) {
            timerLog(context, "i", "C: sleep -> exercise", JSONObject().put("at", isoMs(signal.atMs)))
            stopSession(context, store, signal.atMs)
        }
        val taskId = ExerciseBindingsStore.get(context).taskIdFor(signal.typeName)
        if (taskId == null) {
            store.setLastFingerprint(signal.fingerprint)
            timerLog(context, "w", "C skip: unbound", JSONObject().put("type", signal.typeName))
            return
        }
        timerLog(context, "i", "C start", JSONObject().put("at", isoMs(signal.atMs)).put("type", signal.typeName))
        onStart(context, store, signal, taskId, KIND_EXERCISE)
    }

    private fun onAsleep(
        context: Context,
        store: ExerciseSyncStore,
        signal: ExerciseSignal,
    ) {
        store.setLastFingerprint(signal.fingerprint)
        startTimer(context, TIMER_ENTER, signal.atMs)
    }

    private fun onStart(
        context: Context,
        store: ExerciseSyncStore,
        signal: ExerciseSignal,
        taskId: String,
        kind: String,
    ) {
        val repo = RecordRepository.get(context)
        val prev = repo.peekPrevTaskId()
        val eventId = repo.signalStart(taskId, signal.atMs)
        store.setSession(prev, eventId, signal.fingerprint, kind)
        notifyUi()
    }

    private fun onPassive(
        context: Context,
        store: ExerciseSyncStore,
        signal: ExerciseSignal,
    ) {
        store.setLastFingerprint(signal.fingerprint)
        startTimer(context, TIMER_LEAVE, signal.atMs)
        if (store.sessionKind() == KIND_SLEEP) return
        timerLog(context, "i", "D stop", JSONObject().put("at", isoMs(signal.atMs)))
        stopSession(context, store, signal.atMs, signal.fingerprint)
    }

    private fun stopSession(
        context: Context,
        store: ExerciseSyncStore,
        atMs: Long,
        fingerprint: String? = null,
    ) {
        val eventId = store.exerciseEventId()
        if (eventId == null) {
            fingerprint?.let { store.setLastFingerprint(it) }
            return
        }
        val repo = RecordRepository.get(context)
        val stillHs = repo.liveCurrentEventId() == eventId
        if (!stillHs) {
            store.clearSession(fingerprint ?: store.lastFingerprint().orEmpty())
            notifyUi()
            return
        }
        val prev = store.prevTaskId()
        try {
            repo.signalStop(eventId, atMs, prev)
        } catch (e: ApiException) {
            if (e.status != 409 && e.status != 404) throw e
        }
        store.clearSession(fingerprint ?: store.lastFingerprint().orEmpty())
        notifyUi()
    }

    private fun isoMs(ms: Long): String = ApiTime.iso(Instant.ofEpochMilli(ms))

    private fun timerLog(context: Context, level: String, message: String, extra: JSONObject) {
        val store = ExerciseSyncStore(context)
        extra.put("hs", store.lastHsState() ?: JSONObject.NULL)
            .put("kind", store.sessionKind() ?: JSONObject.NULL)
            .put("timers", store.timerCount())
        RecordRepository.get(context).lastNowDetail()?.let { extra.put("now", JSONObject(it.toString())) }
        val line = "$message $extra".trim()
        when (level) {
            "e" -> Log.e(EXERCISE_SYNC_TAG, line)
            "w" -> Log.w(EXERCISE_SYNC_TAG, line)
            else -> Log.i(EXERCISE_SYNC_TAG, line)
        }
        runCatching { RecordRepository.get(context).noteHs("hs-timer $message", extra) }
    }
}

internal class ExerciseSyncStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("exercise_sync", Context.MODE_PRIVATE)
    private val lock = Any()

    fun enqueue(signal: ExerciseSignal) {
        synchronized(lock) {
            var arr = JSONArray(prefs.getString(KEY_QUEUE, "[]"))
            if (arr.length() > 0) {
                val last = arr.getJSONObject(arr.length() - 1)
                if (
                    last.optString("state") == signal.state &&
                    last.optLong("atMs") == signal.atMs &&
                    last.optString("typeName") == signal.typeName
                ) {
                    return
                }
            }
            arr.put(
                JSONObject()
                    .put("state", signal.state)
                    .put("atMs", signal.atMs)
                    .put("typeName", signal.typeName),
            )
            prefs.edit().putString(KEY_QUEUE, arr.toString()).commit()
        }
    }

    fun peek(): ExerciseSignal? = synchronized(lock) {
        val arr = JSONArray(prefs.getString(KEY_QUEUE, "[]"))
        if (arr.length() == 0) return null
        val o = arr.getJSONObject(0)
        ExerciseSignal(
            state = o.getString("state"),
            atMs = o.getLong("atMs"),
            typeName = o.optString("typeName"),
        )
    }

    fun dropHead() {
        synchronized(lock) {
            val arr = JSONArray(prefs.getString(KEY_QUEUE, "[]"))
            if (arr.length() == 0) return
            prefs.edit().putString(KEY_QUEUE, dropFirst(arr).toString()).commit()
        }
    }

    fun lastFingerprint(): String? = synchronized(lock) {
        prefs.getString(KEY_FP, null)
    }

    fun lastHsState(): String? = lastFingerprint()?.substringBefore("|")?.takeIf { it.isNotEmpty() }

    fun forgetResume() {
        synchronized(lock) {
            prefs.edit()
                .remove(KEY_PREV)
                .remove(KEY_EVENT)
                .remove(KEY_KIND)
                .commit()
        }
    }

    fun setLastFingerprint(value: String) {
        synchronized(lock) {
            prefs.edit().putString(KEY_FP, value).commit()
        }
    }

    fun exerciseEventId(): String? = synchronized(lock) {
        prefs.getString(KEY_EVENT, null).takeIf { !it.isNullOrEmpty() }
    }

    fun prevTaskId(): String? = synchronized(lock) {
        prefs.getString(KEY_PREV, null).takeIf { !it.isNullOrEmpty() }
    }

    fun sessionKind(): String? = synchronized(lock) {
        prefs.getString(KEY_KIND, null).takeIf { !it.isNullOrEmpty() }
    }

    fun timerCount(): Int = synchronized(lock) { loadTimersLocked().size }

    fun allTimers(): List<SleepTimer> = synchronized(lock) { loadTimersLocked().toList() }

    fun addTimer(kind: String, atMs: Long): Boolean = synchronized(lock) {
        val list = loadTimersLocked()
        if (list.any { it.kind == kind && it.atMs == atMs }) return false
        list.add(SleepTimer(kind, atMs))
        list.sortBy { it.atMs }
        saveTimersLocked(list)
        true
    }

    fun removeTimer(kind: String, atMs: Long): Boolean = synchronized(lock) {
        val list = loadTimersLocked()
        val next = list.filterNot { it.kind == kind && it.atMs == atMs }
        if (next.size == list.size) return false
        saveTimersLocked(next)
        true
    }

    fun setSession(prevTaskId: String?, exerciseEventId: String, fingerprint: String, kind: String) {
        synchronized(lock) {
            prefs.edit()
                .putString(KEY_PREV, prevTaskId.orEmpty())
                .putString(KEY_EVENT, exerciseEventId)
                .putString(KEY_FP, fingerprint)
                .putString(KEY_KIND, kind)
                .commit()
        }
    }

    fun clearSession(fingerprint: String) {
        synchronized(lock) {
            prefs.edit()
                .remove(KEY_PREV)
                .remove(KEY_EVENT)
                .remove(KEY_KIND)
                .putString(KEY_FP, fingerprint)
                .commit()
        }
    }

    private fun loadTimersLocked(): MutableList<SleepTimer> {
        val raw = prefs.getString(KEY_TIMERS, null)
        val list = ArrayList<SleepTimer>()
        if (raw != null) {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                list.add(SleepTimer(o.getString("k"), o.getLong("t")))
            }
        } else {
            val onAt = prefs.getLong(KEY_SLEEP_ON, 0L)
            val offAt = prefs.getLong(KEY_SLEEP_OFF, 0L)
            if (onAt > 0L) list.add(SleepTimer("A", onAt))
            if (offAt > 0L) list.add(SleepTimer("B", offAt))
            saveTimersLocked(list)
        }
        return list
    }

    private fun saveTimersLocked(list: List<SleepTimer>) {
        val arr = JSONArray()
        for (timer in list) {
            arr.put(JSONObject().put("k", timer.kind).put("t", timer.atMs))
        }
        prefs.edit()
            .putString(KEY_TIMERS, arr.toString())
            .remove(KEY_SLEEP_ON)
            .remove(KEY_SLEEP_OFF)
            .commit()
    }

    private fun dropFirst(arr: JSONArray): JSONArray {
        val next = JSONArray()
        for (i in 1 until arr.length()) next.put(arr.getJSONObject(i))
        return next
    }

    companion object {
        private const val KEY_QUEUE = "queue"
        private const val KEY_FP = "lastFingerprint"
        private const val KEY_PREV = "prevTaskId"
        private const val KEY_EVENT = "exerciseEventId"
        private const val KEY_KIND = "sessionKind"
        private const val KEY_SLEEP_ON = "pendingSleepOnAt"
        private const val KEY_SLEEP_OFF = "pendingSleepOffAt"
        private const val KEY_TIMERS = "sleepTimers"
    }
}

class ExerciseSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = runHs(applicationContext) {
        ExerciseSync.drainSignals(applicationContext)
    }
}

class SleepTimerWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = runHs(applicationContext) {
        val kind = inputData.getString("kind") ?: return@runHs
        val atMs = inputData.getLong("atMs", -1L)
        if (atMs < 0L) return@runHs
        ExerciseSync.onTimerFire(applicationContext, kind, atMs)
    }
}

private fun runHs(context: Context, block: () -> Unit): ListenableWorker.Result {
    return try {
        block()
        RecordRepository.get(context).flushThenPull()
        ListenableWorker.Result.success()
    } catch (e: ApiException) {
        Log.e(EXERCISE_SYNC_TAG, "api ${e.status} ${e.message}")
        if (e.status == -1 || e.status == 408 || e.status >= 500) {
            ListenableWorker.Result.retry()
        } else {
            ListenableWorker.Result.success()
        }
    } catch (e: Exception) {
        Log.e(EXERCISE_SYNC_TAG, "hs drain failed", e)
        ListenableWorker.Result.retry()
    }
}

class RegisterPassiveListenerWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (
            ContextCompat.checkSelfPermission(
                applicationContext,
                Manifest.permission.ACTIVITY_RECOGNITION,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(EXERCISE_SYNC_TAG, "no ACTIVITY_RECOGNITION")
            return Result.success()
        }
        return try {
            HealthServices.getClient(applicationContext)
                .passiveMonitoringClient
                .setPassiveListenerServiceAsync(
                    ExerciseSyncService::class.java,
                    ExerciseSync.listenerConfig,
                )
                .get(45L, TimeUnit.SECONDS)
            Log.i(EXERCISE_SYNC_TAG, "passive listener registered")
            Result.success()
        } catch (e: Exception) {
            Log.w(EXERCISE_SYNC_TAG, "register failed", e)
            Result.retry()
        }
    }
}
