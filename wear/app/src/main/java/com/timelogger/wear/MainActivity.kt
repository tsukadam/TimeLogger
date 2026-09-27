package com.timelogger.wear

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.DisposableEffect
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.lifecycleScope

class MainActivity : ComponentActivity() {
    private lateinit var controller: LoggerController

    private val requestRecognition = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        ExerciseSync.ensureRegistered(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        controller = LoggerController(
            repo = RecordRepository.get(this),
            scope = lifecycleScope,
            loadingText = getString(R.string.loading),
            retryText = getString(R.string.retry),
            bindings = ExerciseBindingsStore.get(this),
        )
        if (
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            requestRecognition.launch(Manifest.permission.ACTIVITY_RECOGNITION)
        } else {
            ExerciseSync.ensureRegistered(this)
        }
        setContent {
            DisposableEffect(lifecycle) {
                val observer = LifecycleEventObserver { _, event ->
                    if (event == Lifecycle.Event.ON_RESUME) controller.onResume()
                }
                lifecycle.addObserver(observer)
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                    controller.onResume()
                }
                onDispose { lifecycle.removeObserver(observer) }
            }
            TimeLoggerWearApp(controller)
        }
    }

    override fun onStart() {
        super.onStart()
        ExerciseSync.uiRefresh = { controller.refresh() }
    }

    override fun onStop() {
        ExerciseSync.uiRefresh = null
        super.onStop()
    }
}
