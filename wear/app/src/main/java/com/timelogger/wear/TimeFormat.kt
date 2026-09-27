package com.timelogger.wear

import java.time.Instant
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

internal val Tokyo = ZoneId.of("Asia/Tokyo")

fun startedAtMillis(startedAt: String): Long? = try {
    OffsetDateTime.parse(startedAt).toInstant().toEpochMilli()
} catch (_: Exception) {
    null
}

fun formatClockHm(iso: String): String {
    val z = startedAtMillis(iso)?.let { Instant.ofEpochMilli(it).atZone(Tokyo) }
        ?: return "--:--"
    return "%d:%02d".format(z.hour, z.minute)
}

fun formatClockHms(iso: String): String {
    val z = startedAtMillis(iso)?.let { Instant.ofEpochMilli(it).atZone(Tokyo) }
        ?: return "--:--:--"
    return "%d:%02d:%02d".format(z.hour, z.minute, z.second)
}

fun formatEventRangeHm(startedAt: String, endedAt: String?): String {
    val start = formatClockHm(startedAt)
    if (endedAt.isNullOrEmpty()) return "$start →"
    return "$start → ${formatClockHm(endedAt)}"
}

fun formatDateDivider(iso: String): String {
    val z = startedAtMillis(iso)?.let { Instant.ofEpochMilli(it).atZone(Tokyo) }
        ?: return ""
    val w = z.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.JAPANESE)
    return "${z.monthValue}/${z.dayOfMonth}（$w）"
}

fun tokyoDateKey(iso: String): String {
    val z = startedAtMillis(iso)?.let { Instant.ofEpochMilli(it).atZone(Tokyo) }
        ?: return ""
    return "%04d-%02d-%02d".format(z.year, z.monthValue, z.dayOfMonth)
}

fun isoToLocalTime(iso: String): LocalTime {
    val z = startedAtMillis(iso)?.let { Instant.ofEpochMilli(it).atZone(Tokyo) }
        ?: return LocalTime.now(Tokyo)
    return z.toLocalTime()
}

fun replaceClock(iso: String, time: LocalTime): String {
    val z = OffsetDateTime.parse(iso).atZoneSameInstant(Tokyo)
        .withHour(time.hour)
        .withMinute(time.minute)
        .withSecond(time.second)
        .withNano(0)
    return ApiTime.iso(z.toInstant())
}

fun formatElapsedMinutes(startedAt: String, endedAt: String?, nowMs: Long = System.currentTimeMillis()): String {
    val start = startedAtMillis(startedAt) ?: return ""
    val end = if (endedAt.isNullOrEmpty()) nowMs else (startedAtMillis(endedAt) ?: nowMs)
    val min = ((end - start + 59_999L) / 60_000L).coerceAtLeast(1L)
    val h = min / 60L
    val m = min % 60L
    return when {
        h <= 0L -> "${m}m"
        m == 0L -> "${h}h"
        else -> "${h}h${m}m"
    }
}

fun elapsedText(startedAt: String, nowMs: Long): String {
    val start = startedAtMillis(startedAt) ?: return "--"
    val sec = ((nowMs - start) / 1000).coerceAtLeast(0)
    val h = sec / 3600
    val m = (sec % 3600) / 60
    val s = sec % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
