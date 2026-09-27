package com.timelogger.wear

import android.content.ComponentName
import android.content.Context
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.LayoutElementBuilders.LayoutElement
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders.Timeline
import androidx.wear.protolayout.material3.ButtonColors
import androidx.wear.protolayout.material3.ButtonGroupDefaults.DEFAULT_SPACER_BETWEEN_BUTTON_GROUPS
import androidx.wear.protolayout.material3.MaterialScope
import androidx.wear.protolayout.material3.Typography
import androidx.wear.protolayout.material3.buttonGroup
import androidx.wear.protolayout.material3.materialScope
import androidx.wear.protolayout.material3.primaryLayout
import androidx.wear.protolayout.material3.text
import androidx.wear.protolayout.material3.textButton
import androidx.wear.protolayout.material3.textEdgeButton
import androidx.wear.protolayout.modifiers.clickable
import androidx.wear.protolayout.types.argb
import androidx.wear.protolayout.types.layoutString
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders.Tile
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.timelogger.wear.api.Event
import com.timelogger.wear.api.Task
import java.time.temporal.ChronoUnit

class LoggerTileService : TileService() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<Tile> =
        Futures.immediateFuture(buildLoggerTile(this, requestParams, page = 0, title = "TimeLogger"))

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> = emptyTileResources()
}

class LoggerMoreTileService : TileService() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<Tile> =
        Futures.immediateFuture(buildLoggerTile(this, requestParams, page = 1, title = "TimeLogger 2"))

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> = emptyTileResources()
}

internal val LoggerTileServices = listOf(
    LoggerTileService::class.java,
    LoggerMoreTileService::class.java,
)

private const val TileRes = "1"
private const val TileFreshMs = 30L * 60L * 1000L
private const val IdTask = "t:"
private const val TitleMinDp = 225
private const val UnderlineH = 3.5f
private const val UnderlineGap = 4f
private const val UnderlineW = 18f
private const val UnderlineBottom = 2f
private const val LabelLines = 2
private const val TilePageSize = 6
private const val RunningBgArgb = 0xFF2F4A3D.toInt()
private const val RunningInkArgb = 0xFFECEFF4.toInt()
private const val RunningBorderArgb = 0xFF5BB98C.toInt()
private const val RunningBorderW = 2f

internal fun emptyTileResources(): ListenableFuture<ResourceBuilders.Resources> =
    Futures.immediateFuture(ResourceBuilders.Resources.Builder().setVersion(TileRes).build())

internal fun buildLoggerTile(
    context: Context,
    request: RequestBuilders.TileRequest,
    page: Int,
    title: String,
): Tile {
    val clicked = request.currentState.lastClickableId
    if (clicked.startsWith(IdTask)) {
        runCatching {
            RecordRepository.get(context).toggleTaskLocal(clicked.removePrefix(IdTask))
        }
    }
    val snap = RecordRepository.get(context).snapshot()
    val linked = ExerciseBindingsStore.get(context).typeToTask.values.toSet()
    val tasks = topTasksByCount(
        tasks = snap.tasks,
        events = snap.events,
        linkedIds = linked,
        nowMs = System.currentTimeMillis(),
        skip = page * TilePageSize,
        limit = TilePageSize,
    )
    val empty = if (page == 0) "14日の記録がありません" else "7位以下の記録がありません"
    return Tile.Builder()
        .setResourcesVersion(TileRes)
        .setFreshnessIntervalMillis(TileFreshMs)
        .setTileTimeline(
            Timeline.fromLayoutElement(
                loggerTileLayout(
                    context,
                    request.deviceConfiguration,
                    tasks,
                    snap.current?.taskId,
                    title,
                    empty,
                ),
            ),
        )
        .build()
}

private fun loggerTileLayout(
    context: Context,
    device: DeviceParameters,
    tasks: List<Task>,
    currentTaskId: String?,
    title: String,
    empty: String,
): LayoutElement = materialScope(context, device) {
    val showTitle = device.screenWidthDp >= TitleMinDp || tasks.size <= 3
    primaryLayout(
        titleSlot = if (showTitle) {
            { text(title.layoutString, typography = Typography.TITLE_SMALL) }
        } else {
            null
        },
        mainSlot = {
            if (tasks.isEmpty()) {
                text(
                    empty.layoutString,
                    typography = Typography.BODY_SMALL,
                    maxLines = 2,
                    alignment = LayoutElementBuilders.TEXT_ALIGN_CENTER,
                    overflow = LayoutElementBuilders.TEXT_OVERFLOW_ELLIPSIZE_END,
                )
            } else {
                    taskGrid(tasks, currentTaskId)
            }
        },
        bottomSlot = {
            textEdgeButton(
                onClick = clickable(
                    action = ActionBuilders.launchAction(
                        ComponentName(context, MainActivity::class.java),
                    ),
                ),
            ) {
                text("アプリ".layoutString)
            }
        },
    )
}

private fun MaterialScope.taskGrid(
    tasks: List<Task>,
    currentTaskId: String?,
): LayoutElement {
    val rows = splitRows(tasks)
    val first = taskRow(rows[0], currentTaskId)
    if (rows.size == 1) return first
    return LayoutElementBuilders.Column.Builder()
        .setWidth(expand())
        .setHeight(expand())
        .addContent(first)
        .addContent(DEFAULT_SPACER_BETWEEN_BUTTON_GROUPS)
        .addContent(taskRow(rows[1], currentTaskId))
        .build()
}

private fun MaterialScope.taskRow(
    tasks: List<Task>,
    currentTaskId: String?,
): LayoutElement = buttonGroup {
    tasks.forEach { task ->
        buttonGroupItem { taskButton(task, task.id == currentTaskId) }
    }
}

private fun MaterialScope.taskButton(task: Task, running: Boolean): LayoutElement {
    val accent = parseTaskColor(task.color)
    val ink = if (running) RunningInkArgb.argb else colorScheme.onSurface
    val fill = if (running) RunningBgArgb.argb else colorScheme.surfaceContainer
    val half = RunningBorderW / 2f
    val button = textButton(
        onClick = clickable(id = IdTask + task.id, action = ActionBuilders.LoadAction.Builder().build()),
        width = expand(),
        height = expand(),
        shape = insetCorner(shapes.large, half),
        colors = ButtonColors(
            containerColor = fill,
            iconColor = ink,
            labelColor = ink,
            secondaryLabelColor = ink,
        ),
        contentPadding = ModifiersBuilders.Padding.Builder()
            .setTop(dp(6f))
            .setBottom(dp(6f))
            .setStart(dp(6f))
            .setEnd(dp(6f))
            .build(),
        labelContent = {
            LayoutElementBuilders.Column.Builder()
                .setWidth(expand())
                .setHeight(expand())
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                .addContent(labelSlot(task.name, ink))
                .addContent(
                    LayoutElementBuilders.Spacer.Builder()
                        .setHeight(dp(UnderlineGap))
                        .build(),
                )
                .addContent(colorUnderline(accent))
                .addContent(
                    LayoutElementBuilders.Spacer.Builder()
                        .setHeight(dp(UnderlineBottom))
                        .build(),
                )
                .build()
        },
    )
    val slot = LayoutElementBuilders.Box.Builder()
        .setWidth(expand())
        .setHeight(expand())
        .addContent(
            LayoutElementBuilders.Box.Builder()
                .setWidth(expand())
                .setHeight(expand())
                .setModifiers(
                    ModifiersBuilders.Modifiers.Builder()
                        .setPadding(edgePad(half))
                        .build(),
                )
                .addContent(button)
                .build(),
        )
    if (running) slot.addContent(runningOutline(task.id))
    return slot.build()
}

private fun MaterialScope.runningOutline(taskId: String): LayoutElement =
    LayoutElementBuilders.Box.Builder()
        .setWidth(expand())
        .setHeight(expand())
        .setModifiers(
            ModifiersBuilders.Modifiers.Builder()
                .setClickable(
                    clickable(
                        id = IdTask + taskId,
                        action = ActionBuilders.LoadAction.Builder().build(),
                    ),
                )
                .setBackground(
                    ModifiersBuilders.Background.Builder()
                        .setColor(ColorBuilders.ColorProp.Builder(0x00000000).build())
                        .setCorner(shapes.large)
                        .build(),
                )
                .setBorder(
                    ModifiersBuilders.Border.Builder()
                        .setWidth(dp(RunningBorderW))
                        .setColor(ColorBuilders.ColorProp.Builder(RunningBorderArgb).build())
                        .build(),
                )
                .build(),
        )
        .build()

private fun edgePad(all: Float): ModifiersBuilders.Padding =
    ModifiersBuilders.Padding.Builder()
        .setStart(dp(all))
        .setEnd(dp(all))
        .setTop(dp(all))
        .setBottom(dp(all))
        .build()

private fun insetCorner(corner: ModifiersBuilders.Corner, inset: Float): ModifiersBuilders.Corner {
    val radius = corner.radius?.value?.let { it - inset }?.coerceAtLeast(0f) ?: 26f - inset
    return ModifiersBuilders.Corner.Builder().setRadius(dp(radius)).build()
}

private fun MaterialScope.labelSlot(name: String, ink: androidx.wear.protolayout.types.LayoutColor): LayoutElement =
    LayoutElementBuilders.Box.Builder()
        .setWidth(expand())
        .setHeight(expand())
        .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
        .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
        .addContent(
            text(
                name.layoutString,
                typography = Typography.LABEL_SMALL,
                color = ink,
                maxLines = LabelLines,
                alignment = LayoutElementBuilders.TEXT_ALIGN_CENTER,
                overflow = LayoutElementBuilders.TEXT_OVERFLOW_ELLIPSIZE_END,
                scalable = false,
            ),
        )
        .build()

private fun colorUnderline(color: Int): LayoutElement =
    LayoutElementBuilders.Box.Builder()
        .setWidth(dp(UnderlineW))
        .setHeight(dp(UnderlineH))
        .setModifiers(
            ModifiersBuilders.Modifiers.Builder()
                .setBackground(
                    ModifiersBuilders.Background.Builder()
                        .setColor(ColorBuilders.ColorProp.Builder(color).build())
                        .setCorner(
                            ModifiersBuilders.Corner.Builder()
                                .setRadius(dp(UnderlineH / 2f))
                                .build(),
                        )
                        .build(),
                )
                .build(),
        )
        .build()

internal fun topTasksByCount(
    tasks: List<Task>,
    events: List<Event>,
    linkedIds: Set<String>,
    nowMs: Long,
    skip: Int,
    limit: Int,
): List<Task> {
    val cutoff = nowMs - ChronoUnit.DAYS.duration.toMillis() * LocalLogDays
    val counts = HashMap<String, Int>()
    val durations = HashMap<String, Long>()
    for (ev in events) {
        if (ev.taskId in linkedIds) continue
        val start = startedAtMillis(ev.startedAt) ?: continue
        if (start < cutoff && ev.endedAt != null) {
            val end = startedAtMillis(ev.endedAt) ?: continue
            if (end <= cutoff) continue
        }
        counts[ev.taskId] = (counts[ev.taskId] ?: 0) + 1
        val end = if (ev.endedAt.isNullOrEmpty()) nowMs else (startedAtMillis(ev.endedAt) ?: nowMs)
        durations[ev.taskId] = (durations[ev.taskId] ?: 0L) + maxOf(0L, end - maxOf(start, cutoff))
    }
    val byId = tasks.associateBy { it.id }
    return counts.entries
        .sortedWith(
            compareByDescending<Map.Entry<String, Int>> { it.value }
                .thenByDescending { durations[it.key] ?: 0L },
        )
        .mapNotNull { byId[it.key] }
        .filter { it.id !in linkedIds }
        .drop(skip)
        .take(limit)
}

internal fun splitRows(tasks: List<Task>): List<List<Task>> {
    val n = tasks.size
    if (n <= 3) return listOf(tasks)
    if (n == 4) return listOf(tasks.take(2), tasks.drop(2))
    return listOf(tasks.take(3), tasks.drop(3))
}

internal fun parseTaskColor(hex: String): Int {
    val h = hex.trim().removePrefix("#")
    return try {
        when (h.length) {
            6 -> (0xFF shl 24) or h.toInt(16)
            8 -> h.toLong(16).toInt()
            else -> 0xFF555555.toInt()
        }
    } catch (_: Exception) {
        0xFF555555.toInt()
    }
}
