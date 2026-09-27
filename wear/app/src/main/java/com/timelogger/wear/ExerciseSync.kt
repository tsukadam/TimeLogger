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
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.timelogger.wear.api.ApiException
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

object ExerciseSync {
    private const val SLEEP_WAIT_MS = 5L * 60L * 1000L
    private const val SLEEP_CONFIRM_WORK = "hs-sleep-confirm"
    private const val KIND_SLEEP = "sleep"
    private const val KIND_EXERCISE = "exercise"

    @Volatile
    var uiRefresh: (() -> Unit)? = null

    val listenerConfig: PassiveListenerConfig = PassiveListenerConfig.builder()
        .setShouldUserActivityInfoBeRequested(true)
        .build()

    fun ensureRegistered(context: Context) {
        val app = context.applicationContext
        WorkManager.getInstance(app).enqueueUniqueWork(
            "hs-register",
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<RegisterPassiveListenerWorker>()
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build(),
        )
        resumeSleepWait(app)
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
        Log.i(EXERCISE_SYNC_TAG, "signal $signal")
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

    internal fun process(
        context: Context,
        store: ExerciseSyncStore,
        signal: ExerciseSignal,
    ) {
        if (store.lastFingerprint() == signal.fingerprint) return
        when (signal.state) {
            "EXERCISE" -> onExercise(context, store, signal)
            "ASLEEP" -> onAsleep(context, store, signal)
            "PASSIVE" -> onIdle(context, store, signal)
            else -> store.setLastFingerprint(signal.fingerprint)
        }
    }

    internal fun confirmSleepWait(context: Context) {
        val app = context.applicationContext
        val store = ExerciseSyncStore(app)
        val onAt = store.pendingSleepOnAt()
        if (onAt != null) {
            store.clearPendingSleepOn()
            try {
                val taskId = ExerciseBindingsStore.get(app).taskIdFor(ExerciseTypes.SLEEP_ID)
                if (taskId != null) {
                    onStart(
                        app,
                        store,
                        ExerciseSignal("ASLEEP", onAt, ExerciseTypes.SLEEP_ID),
                        taskId,
                        KIND_SLEEP,
                    )
                } else {
                    stopSession(app, store, onAt)
                }
            } catch (e: ApiException) {
                if (e.status == -1 || e.status == 408 || e.status >= 500) {
                    store.setPendingSleepOn(onAt)
                }
                throw e
            }
            return
        }
        val offAt = store.pendingSleepOffAt() ?: return
        store.clearPendingSleepOff()
        try {
            stopSession(app, store, offAt)
        } catch (e: ApiException) {
            if (e.status == -1 || e.status == 408 || e.status >= 500) {
                store.setPendingSleepOff(offAt)
            }
            throw e
        }
    }

    private fun onExercise(
        context: Context,
        store: ExerciseSyncStore,
        signal: ExerciseSignal,
    ) {
        cancelPendingSleepOn(context, store)
        if (store.pendingSleepOffAt() != null) {
            val offAt = store.pendingSleepOffAt()!!
            store.clearPendingSleepOff()
            cancelSleepConfirm(context)
            stopSession(context, store, offAt)
        } else if (store.sessionKind() == KIND_SLEEP) {
            stopSession(context, store, signal.atMs)
        }
        val taskId = ExerciseBindingsStore.get(context).taskIdFor(signal.typeName)
        if (taskId == null) {
            store.setLastFingerprint(signal.fingerprint)
            return
        }
        onStart(context, store, signal, taskId, KIND_EXERCISE)
    }

    private fun onAsleep(
        context: Context,
        store: ExerciseSyncStore,
        signal: ExerciseSignal,
    ) {
        if (store.pendingSleepOffAt() != null) {
            store.clearPendingSleepOff()
            cancelSleepConfirm(context)
        }
        if (store.sessionKind() == KIND_SLEEP || store.pendingSleepOnAt() != null) {
            store.setLastFingerprint(signal.fingerprint)
            return
        }
        store.setPendingSleepOn(signal.atMs)
        store.setLastFingerprint(signal.fingerprint)
        scheduleSleepConfirm(context, SLEEP_WAIT_MS)
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

    private fun onIdle(
        context: Context,
        store: ExerciseSyncStore,
        signal: ExerciseSignal,
    ) {
        if (store.pendingSleepOnAt() != null) {
            cancelPendingSleepOn(context, store)
            store.setLastFingerprint(signal.fingerprint)
            return
        }
        if (store.sessionKind() == KIND_SLEEP) {
            if (store.pendingSleepOffAt() == null) {
                store.setPendingSleepOff(signal.atMs)
                scheduleSleepConfirm(context, SLEEP_WAIT_MS)
            }
            store.setLastFingerprint(signal.fingerprint)
            return
        }
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
        val prev = store.prevTaskId()
        try {
            RecordRepository.get(context).signalStop(eventId, atMs, prev)
        } catch (e: ApiException) {
            if (e.status != 409 && e.status != 404) throw e
        }
        store.clearSession(fingerprint ?: store.lastFingerprint().orEmpty())
        notifyUi()
    }

    private fun cancelPendingSleepOn(context: Context, store: ExerciseSyncStore) {
        if (store.pendingSleepOnAt() == null) return
        store.clearPendingSleepOn()
        cancelSleepConfirm(context)
    }

    private fun scheduleSleepConfirm(context: Context, delayMs: Long) {
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            SLEEP_CONFIRM_WORK,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<SleepConfirmWorker>()
                .setInitialDelay(delayMs.coerceAtLeast(0L), TimeUnit.MILLISECONDS)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build(),
        )
    }

    private fun cancelSleepConfirm(context: Context) {
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(SLEEP_CONFIRM_WORK)
    }

    private fun resumeSleepWait(context: Context) {
        val store = ExerciseSyncStore(context)
        val at = store.pendingSleepOnAt() ?: store.pendingSleepOffAt() ?: return
        val delay = SLEEP_WAIT_MS - (System.currentTimeMillis() - at)
        scheduleSleepConfirm(context, delay.coerceAtLeast(0L))
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
            while (arr.length() >= 32) {
                arr = dropFirst(arr)
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

    fun pendingSleepOnAt(): Long? = synchronized(lock) {
        prefs.getLong(KEY_SLEEP_ON, 0L).takeIf { it > 0L }
    }

    fun pendingSleepOffAt(): Long? = synchronized(lock) {
        prefs.getLong(KEY_SLEEP_OFF, 0L).takeIf { it > 0L }
    }

    fun setPendingSleepOn(atMs: Long) {
        synchronized(lock) {
            prefs.edit().putLong(KEY_SLEEP_ON, atMs).remove(KEY_SLEEP_OFF).commit()
        }
    }

    fun setPendingSleepOff(atMs: Long) {
        synchronized(lock) {
            prefs.edit().putLong(KEY_SLEEP_OFF, atMs).remove(KEY_SLEEP_ON).commit()
        }
    }

    fun clearPendingSleepOn() {
        synchronized(lock) {
            prefs.edit().remove(KEY_SLEEP_ON).commit()
        }
    }

    fun clearPendingSleepOff() {
        synchronized(lock) {
            prefs.edit().remove(KEY_SLEEP_OFF).commit()
        }
    }

    fun setSession(prevTaskId: String?, exerciseEventId: String, fingerprint: String, kind: String) {
        synchronized(lock) {
            prefs.edit()
                .putString(KEY_PREV, prevTaskId.orEmpty())
                .putString(KEY_EVENT, exerciseEventId)
                .putString(KEY_FP, fingerprint)
                .putString(KEY_KIND, kind)
                .remove(KEY_SLEEP_ON)
                .remove(KEY_SLEEP_OFF)
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
    }
}

class ExerciseSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = ExerciseSyncStore(applicationContext)
        while (true) {
            val signal = store.peek() ?: break
            try {
                ExerciseSync.process(applicationContext, store, signal)
                store.dropHead()
            } catch (e: ApiException) {
                Log.e(EXERCISE_SYNC_TAG, "api ${e.status} ${e.message}")
                if (e.status == -1 || e.status >= 500) return Result.retry()
                store.dropHead()
            } catch (e: Exception) {
                Log.e(EXERCISE_SYNC_TAG, "sync failed", e)
                return Result.retry()
            }
        }
        return try {
            RecordRepository.get(applicationContext).flushThenPull()
            Result.success()
        } catch (e: ApiException) {
            if (e.status == -1 || e.status >= 500) Result.retry() else Result.success()
        }
    }
}

class SleepConfirmWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        return try {
            ExerciseSync.confirmSleepWait(applicationContext)
            RecordRepository.get(applicationContext).flushThenPull()
            Result.success()
        } catch (e: ApiException) {
            Log.e(EXERCISE_SYNC_TAG, "sleep confirm ${e.status} ${e.message}")
            if (e.status == -1 || e.status >= 500) Result.retry() else Result.success()
        } catch (e: Exception) {
            Log.e(EXERCISE_SYNC_TAG, "sleep confirm failed", e)
            Result.retry()
        }
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
