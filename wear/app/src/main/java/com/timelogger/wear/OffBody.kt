package com.timelogger.wear

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlin.math.roundToInt
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

internal object OffBody {
    private const val TIMEOUT_MS = 1500L

    private val lock = Any()

    fun sampleWorn(context: Context): Boolean? {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            Log.w(EXERCISE_SYNC_TAG, "off-body skip sample on main")
            return null
        }
        val app = context.applicationContext
        val sm = app.getSystemService(SensorManager::class.java) ?: return null
        val sensor = sm.getDefaultSensor(Sensor.TYPE_LOW_LATENCY_OFFBODY_DETECT, true)
            ?: sm.getDefaultSensor(Sensor.TYPE_LOW_LATENCY_OFFBODY_DETECT)
            ?: return null
        synchronized(lock) {
            val latch = CountDownLatch(1)
            var worn: Boolean? = null
            val listener = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    if (event.sensor.type != Sensor.TYPE_LOW_LATENCY_OFFBODY_DETECT) return
                    if (event.values.isEmpty()) return
                    worn = event.values[0].roundToInt() == 1
                    latch.countDown()
                }

                override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
            }
            val ok = sm.registerListener(
                listener,
                sensor,
                SensorManager.SENSOR_DELAY_FASTEST,
                Handler(Looper.getMainLooper()),
            )
            if (!ok) {
                Log.w(EXERCISE_SYNC_TAG, "off-body register failed")
                return null
            }
            try {
                latch.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)
            } finally {
                sm.unregisterListener(listener)
            }
            return worn
        }
    }
}
