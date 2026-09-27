package com.timelogger.wear

import android.util.Log
import androidx.health.services.client.PassiveListenerService
import androidx.health.services.client.data.UserActivityInfo

class ExerciseSyncService : PassiveListenerService() {
    override fun onUserActivityInfoReceived(info: UserActivityInfo) {
        ExerciseSync.onSignal(this, info)
    }

    override fun onPermissionLost() {
        Log.w(EXERCISE_SYNC_TAG, "Health Services permission lost")
    }
}
