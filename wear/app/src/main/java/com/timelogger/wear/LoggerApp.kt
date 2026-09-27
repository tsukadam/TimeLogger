package com.timelogger.wear

import android.os.SystemClock
import android.util.TypedValue
import android.widget.Chronometer
import androidx.compose.animation.Animatable as ColorAnimatable
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnItemScope
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnScope
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnState
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.AlertDialog
import androidx.wear.compose.material3.AlertDialogDefaults
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ProgressIndicatorDefaults
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SwipeToDismissBox
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimePicker
import androidx.wear.compose.material3.TimePickerType
import com.timelogger.wear.api.Event
import com.timelogger.wear.api.Folder
import com.timelogger.wear.api.Task
import java.time.Instant
import java.time.LocalTime
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val Bg = Color.Black
private val RowBg = Color(0xFF2D3135)
private val LinkedRowBg = Color(0xFF293A31)
private val BindFlashBg = Color(0xFF3C7A54)
private val TextMain = Color(0xFFECEFF4)
private val TextDim = Color(0xFFA8B0C0)
private val RunningBg = Color(0xFF2F4A3D)
private val RunningBorder = Color(0xFF5BB98C)
private val LinkGreen = Color(0xFF4DFF7A)
private val BackBg = Color(0xFFD7E3F4)
private val BackText = Color(0xFF1C1C1E)
private val DeleteBg = Color(0xFF5C2B30)
private val DeleteText = Color(0xFFF2B4B4)
private val PillHeight = 54.dp
private val ActivityPillHeight = 64.dp
private val BackHeight = 76.dp
private val RowGap = 4.dp
private val FolderHeaderFx = HeaderFxSpec(height = 44.dp)
private val TaskHeaderFx = HeaderFxSpec(height = 36.dp)
private const val ActivityPageDays = 1
private const val ActivityMaxDays = 14
private val DefaultEdge = EdgeSettings(
    top = EdgeScale.Gentle,
    bottom = EdgeScale.Sharp,
)

@Composable
fun TimeLoggerWearApp(
    controller: LoggerController,
    edge: EdgeSettings = DefaultEdge,
) {
    var folderId by remember { mutableStateOf<String?>(null) }
    var bindTaskId by remember { mutableStateOf<String?>(null) }
    var activityOpen by remember { mutableStateOf(false) }
    var viewOpen by remember { mutableStateOf(false) }
    var eventForm by remember { mutableStateOf<EventFormTarget?>(null) }
    val folderListState = rememberTransformingLazyColumnState()

    MaterialTheme {
        AppScaffold(timeText = {}) {
            val foreground = remember { ForegroundGate() }
            CompositionLocalProvider(LocalForegroundGate provides foreground) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Bg),
            ) {
                ForegroundLayer {
                    FolderScreen(
                        modifier = Modifier.graphicsLayer(),
                        controller = controller,
                        edge = edge,
                        listState = folderListState,
                        frozen = folderId != null || activityOpen || viewOpen,
                        onOpenFolder = { folderId = it },
                        onOpenActivity = { activityOpen = true },
                        onOpenView = { viewOpen = true },
                    )
                }
                OverlayPage(
                    visible = folderId != null,
                    onGone = {
                        bindTaskId = null
                        folderId = null
                    },
                ) { dismiss ->
                    val id = folderId
                    if (id != null) {
                        TaskScreen(
                            controller = controller,
                            folderId = id,
                            edge = edge,
                            frozen = bindTaskId != null,
                            onBind = { bindTaskId = it },
                            onBack = dismiss,
                        )
                    }
                }
                OverlayPage(
                    visible = bindTaskId != null,
                    onGone = { bindTaskId = null },
                ) { dismiss ->
                    val taskId = bindTaskId
                    if (taskId != null) {
                        BindScreen(
                            controller = controller,
                            taskId = taskId,
                            edge = edge,
                            onBack = dismiss,
                        )
                    }
                }
                OverlayPage(
                    visible = viewOpen,
                    onGone = { viewOpen = false },
                ) { _ ->
                    DayGraphScreen(
                        events = controller.events,
                    )
                }
                OverlayPage(
                    visible = activityOpen,
                    onGone = {
                        eventForm = null
                        activityOpen = false
                    },
                ) { dismiss ->
                    ActivityScreen(
                        controller = controller,
                        edge = edge,
                        frozen = eventForm != null,
                        onOpenEvent = { id ->
                            controller.events.find { it.id == id }?.let { eventForm = eventFormOf(it) }
                        },
                        onAdd = {
                            if (!controller.busy) {
                                addFormOf(controller)?.let { eventForm = it }
                            }
                        },
                        onBack = dismiss,
                    )
                }
                OverlayPage(
                    visible = eventForm != null,
                    onGone = { eventForm = null },
                ) { dismiss ->
                    val form = eventForm
                    if (form != null) {
                        EventEditScreen(
                            controller = controller,
                            form = form,
                            edge = edge,
                            onBack = dismiss,
                        )
                    }
                }
            }
            }
        }
    }
}

@Composable
private fun FolderScreen(
    modifier: Modifier = Modifier,
    controller: LoggerController,
    edge: EdgeSettings,
    listState: TransformingLazyColumnState,
    frozen: Boolean,
    onOpenFolder: (String) -> Unit,
    onOpenActivity: () -> Unit,
    onOpenView: () -> Unit,
) {
    val folders = remember { mutableStateOf(controller.folders) }
    val current = remember { mutableStateOf(controller.current) }
    val status = remember { mutableStateOf(controller.status) }
    val loading = remember { mutableStateOf(controller.loading) }
    val view = LocalView.current
    if (!frozen) {
        folders.value = controller.folders
        current.value = controller.current
        status.value = controller.status
        loading.value = controller.loading
    }
    LoggerScreen(
        modifier = modifier,
        listState = listState,
        edge = edge,
        bottomPadding = 0.dp,
        userScrollEnabled = !frozen,
        banner = if (frozen) null else status.value,
        onBannerClick = if (!frozen && !loading.value) controller::retry else null,
        onTopRefresh = if (frozen) null else controller::pullRefresh,
    ) {
        item(key = "header") {
            RecordingHeader(
                current = current.value,
                listState = listState,
                spec = FolderHeaderFx,
            )
        }
        items(folders.value, key = { it.id }) { folder ->
            FolderRow(
                folder = folder,
                onClick = { if (!frozen) onOpenFolder(folder.id) },
            )
        }
        item(key = "view") {
            EdgePill(
                running = false,
                fill = BackBg,
                hInset = 32.dp,
                modifier = Modifier.padding(top = RowGap * 2),
                onClick = {
                    if (!frozen) {
                        view.tapHaptic(TapHaptic.Click)
                        onOpenView()
                    }
                },
            ) {
                Text(
                    text = "View",
                    color = BackText,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        repeat(2) { i ->
            item(key = "pre-edit-$i") {
                Spacer(Modifier.height(0.dp))
            }
        }
        item(key = "edit") {
            BackEdgeButton(text = "Edit", onClick = { if (!frozen) onOpenActivity() })
        }
    }
}

@Composable
private fun TaskScreen(
    controller: LoggerController,
    folderId: String,
    edge: EdgeSettings,
    frozen: Boolean,
    onBind: (String) -> Unit,
    onBack: () -> Unit,
) {
    val folder = remember { mutableStateOf(controller.folder(folderId)) }
    val tasks = remember { mutableStateOf(controller.tasksIn(folderId)) }
    val current = remember { mutableStateOf(controller.current) }
    if (!frozen) {
        folder.value = controller.folder(folderId)
        tasks.value = controller.tasksIn(folderId)
        current.value = controller.current
    }
    val listState = rememberTransformingLazyColumnState()
    val busy = controller.busy
    val pendingId = controller.pendingTaskId
    val statusText = controller.status
    LoggerScreen(
        listState,
        edge,
        bottomPadding = 0.dp,
        userScrollEnabled = !frozen && !busy,
        banner = if (frozen) null else statusText,
    ) {
        item(key = "header") {
            TitleHeader(
                text = folder.value?.name.orEmpty(),
                listState = listState,
                spec = TaskHeaderFx,
            )
        }
        items(tasks.value, key = { it.id }) { task ->
            val running = current.value?.taskId == task.id
            TaskRow(
                task = task,
                running = running,
                linked = controller.bindings.isLinked(task.id),
                startedAt = if (running) current.value?.startedAt else null,
                enabled = !frozen && !busy,
                waiting = pendingId == task.id,
                onClick = { controller.onTask(task.id) },
                onOpenBind = { onBind(task.id) },
            )
        }
        repeat(2) { i ->
            item(key = "pre-back-$i") {
                Spacer(Modifier.height(0.dp))
            }
        }
        item(key = "back") {
            BackEdgeButton(onClick = { if (!frozen && !busy) onBack() })
        }
    }
}

@Composable
private fun BindScreen(
    controller: LoggerController,
    taskId: String,
    edge: EdgeSettings,
    onBack: () -> Unit,
) {
    val task = controller.task(taskId)
    val linkedType = controller.bindings.typeNameFor(taskId)
    val types = remember(taskId) {
        ExerciseTypes.bindList(controller.bindings.typeNameFor(taskId))
    }
    val listState = rememberTransformingLazyColumnState()
    var confirmingId by remember { mutableStateOf<String?>(null) }
    LoggerScreen(
        listState,
        edge,
        bottomPadding = 0.dp,
        userScrollEnabled = confirmingId == null,
    ) {
        item(key = "header") {
            TitleHeader(
                text = task?.name.orEmpty(),
                onClick = { if (confirmingId == null) onBack() },
                listState = listState,
                spec = TaskHeaderFx,
            )
        }
        items(types, key = { it.id }) { type ->
            val linked = linkedType == type.id
            BindRow(
                label = type.label,
                linked = linked,
                enabled = confirmingId == null,
                onToggle = {
                    if (linked) {
                        controller.bindings.unbind(taskId)
                    } else {
                        controller.bindings.bind(taskId, type.id)
                        confirmingId = type.id
                    }
                },
                onBound = onBack,
            )
        }
        repeat(2) { i ->
            item(key = "pre-back-$i") {
                Spacer(Modifier.height(0.dp))
            }
        }
        item(key = "back") {
            BackEdgeButton(onClick = { if (confirmingId == null) onBack() })
        }
    }
}

@Composable
private fun ActivityScreen(
    controller: LoggerController,
    edge: EdgeSettings,
    frozen: Boolean,
    onOpenEvent: (String) -> Unit,
    onAdd: () -> Unit,
    onBack: () -> Unit,
) {
    val listState = rememberTransformingLazyColumnState()
    val events = remember { mutableStateOf(controller.events) }
    if (!frozen) {
        events.value = controller.events
    }
    val grouped = remember(events.value) {
        events.value
            .sortedByDescending { parseMs(it.startedAt) }
            .groupBy { tokyoDateKey(it.startedAt) }
            .toList()
    }
    var daysLimit by remember { mutableStateOf(ActivityPageDays) }
    val capped = grouped.take(ActivityMaxDays)
    val visible = capped.take(daysLimit)
    val hasMore = capped.size > daysLimit
    fun activityContentCount(limit: Int): Int {
        var n = 1
        if (grouped.isEmpty()) n += 1
        grouped.take(limit).forEach { n += 1 + it.second.size }
        if (capped.size > limit) n += 2
        n += 3
        return n
    }
    LoggerScreen(
        listState,
        edge,
        bottomPadding = 0.dp,
        userScrollEnabled = !frozen,
        padTopInset = false,
        banner = null,
        onTopRefresh = if (frozen) null else controller::pullRefresh,
    ) {
        item(key = "add") {
            AddEdgeButton(
                listState = listState,
                onClick = { if (!frozen && controller.tasks.isNotEmpty()) onAdd() },
            )
        }
        if (grouped.isEmpty()) {
            item(key = "empty") {
                StatusRow(text = "まだ記録がありません。", retry = false, onClick = {})
            }
        }
        visible.forEach { (day, rows) ->
            item(key = "day-$day") {
                Text(
                    text = rows.firstOrNull()?.let { formatDateDivider(it.startedAt) }.orEmpty(),
                    color = TextDim,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 2.dp),
                )
            }
            items(rows, key = { it.id }) { ev ->
                ActivityRow(
                    event = ev,
                    enabled = !frozen,
                    onClick = { onOpenEvent(ev.id) },
                )
            }
        }
        if (hasMore) {
            item(key = "more-gap-$daysLimit") {
                Spacer(Modifier.height(RowGap * 2))
            }
            item(key = "more-$daysLimit") {
                EdgePill(
                    running = false,
                    onClick = {
                        if (!frozen) {
                            val inset = (
                                listState.layoutInfo.totalItemsCount - activityContentCount(daysLimit)
                            ).coerceAtLeast(0)
                            var firstNew = inset + 1
                            grouped.take(daysLimit).forEach { firstNew += 1 + it.second.size }
                            daysLimit += ActivityPageDays
                            listState.requestScrollToItem(firstNew)
                        }
                    },
                ) {
                    Text(
                        text = "さらに読み込む",
                        color = TextMain,
                        fontSize = 16.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
        repeat(2) { i ->
            item(key = "pre-back-$i") {
                Spacer(Modifier.height(0.dp))
            }
        }
        item(key = "back") {
            BackEdgeButton(onClick = { if (!frozen) onBack() })
        }
    }
}

@Composable
private fun TransformingLazyColumnItemScope.ActivityRow(
    event: Event,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    EdgePill(
        running = event.endedAt == null,
        height = ActivityPillHeight,
        onClick = { if (enabled) onClick() },
    ) {
        Box(
            modifier = Modifier
                .size(14.dp)
                .clip(CircleShape)
                .background(parseComposeColor(event.taskColor)),
        )
        Spacer(Modifier.width(8.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = event.taskName,
                color = TextMain,
                fontSize = 16.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = formatEventRangeHm(event.startedAt, event.endedAt),
                color = TextDim,
                fontSize = 13.sp,
                maxLines = 1,
            )
        }
        if (event.endedAt == null) {
            ElapsedLabel(
                startedAt = event.startedAt,
                fontSize = 13.sp,
                color = TextDim,
                format = { started, now -> formatElapsedMinutes(started, null, now) },
            )
        } else {
            Text(
                text = formatElapsedMinutes(event.startedAt, event.endedAt),
                color = TextDim,
                fontSize = 13.sp,
            )
        }
    }
}

private data class EventFormTarget(
    val eventId: String?,
    val startedAt: String,
    val endedAt: String,
    val taskId: String,
    val taskName: String,
    val taskColor: String,
)

private fun eventFormOf(event: Event, now: Instant = Instant.now()): EventFormTarget =
    EventFormTarget(
        eventId = event.id,
        startedAt = event.startedAt,
        endedAt = event.endedAt ?: ApiTime.iso(now),
        taskId = event.taskId,
        taskName = event.taskName,
        taskColor = event.taskColor,
    )

private fun addFormOf(controller: LoggerController): EventFormTarget? {
    val task = controller.events.maxByOrNull { parseMs(it.startedAt) }
        ?.let { ev -> controller.task(ev.taskId) }
        ?: controller.tasks.firstOrNull()
        ?: return null
    val nowMs = System.currentTimeMillis()
    val hole = findOldestHole(controller.events, nowMs)
    val startMs = hole?.startMs ?: nowMs
    val endMs = hole?.endMs ?: nowMs
    return EventFormTarget(
        eventId = null,
        startedAt = ApiTime.iso(Instant.ofEpochMilli(startMs)),
        endedAt = ApiTime.iso(Instant.ofEpochMilli(endMs)),
        taskId = task.id,
        taskName = task.name,
        taskColor = task.color,
    )
}

private enum class ClockField { Start, End }

@Composable
private fun EventEditScreen(
    controller: LoggerController,
    form: EventFormTarget,
    edge: EdgeSettings,
    onBack: () -> Unit,
) {
    val live = form.eventId?.let { id -> controller.events.find { it.id == id } }
    var startIso by remember(form) { mutableStateOf(live?.startedAt ?: form.startedAt) }
    var endIso by remember(form) {
        mutableStateOf(live?.endedAt ?: form.endedAt)
    }
    var draftTaskId by remember(form) { mutableStateOf(live?.taskId ?: form.taskId) }
    var draftTaskName by remember(form) { mutableStateOf(live?.taskName ?: form.taskName) }
    var draftTaskColor by remember(form) { mutableStateOf(live?.taskColor ?: form.taskColor) }
    val view = LocalView.current
    var picker by remember { mutableStateOf<ClockField?>(null) }
    var pickFolder by remember { mutableStateOf(false) }
    var pickFolderId by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var pendingPick by remember { mutableStateOf<Pair<ClockField, LocalTime>?>(null) }
    fun setNested(
        clock: ClockField? = picker,
        folder: Boolean = pickFolder,
        folderId: String? = pickFolderId,
    ) {
        picker = clock
        pickFolder = folder
        pickFolderId = folderId
    }
    val busy = controller.busy
    val timeInvalid = parseMs(endIso) - parseMs(startIso) < 1000L
    val timeError = if (timeInvalid) "終了は開始より後にしてください" else null
    LaunchedEffect(busy, saving) {
        if (saving && !busy) {
            saving = false
            if (controller.status == null) onBack()
        }
    }
    Box(Modifier.fillMaxSize()) {
        val listState = rememberTransformingLazyColumnState()
        LoggerScreen(
            listState,
            edge,
            bottomPadding = 0.dp,
            userScrollEnabled = picker == null && !pickFolder && !busy && !confirmDelete,
            banner = if (picker == null && !pickFolder) controller.status else null,
        ) {
            item(key = "header") {
                TitleHeader(
                    text = draftTaskName,
                    color = draftTaskColor,
                    listState = listState,
                    spec = TaskHeaderFx,
                    onClick = {
                        if (!busy) {
                            view.tapHaptic(TapHaptic.Click)
                            setNested(clock = null, folder = true, folderId = null)
                        }
                    },
                )
            }
            item(key = "start") {
                TimeFieldRow(
                    label = "開始",
                    value = formatClockHms(startIso),
                    enabled = !busy,
                    onClick = { setNested(clock = ClockField.Start, folder = false, folderId = null) },
                )
            }
            item(key = "end") {
                TimeFieldRow(
                    label = "終了",
                    value = formatClockHms(endIso),
                    enabled = !busy,
                    onClick = { setNested(clock = ClockField.End, folder = false, folderId = null) },
                )
            }
            if (timeError != null) {
                item(key = "time-error") {
                    Text(
                        text = timeError,
                        color = TextDim,
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 2.dp),
                    )
                }
            }
            if (form.eventId != null) {
                item(key = "delete") {
                    EdgePill(
                        running = false,
                        fill = DeleteBg,
                        hInset = 32.dp,
                        modifier = Modifier.padding(top = RowGap * 2),
                        onClick = {
                            if (!busy) {
                                view.tapHaptic(TapHaptic.Click)
                                confirmDelete = true
                            }
                        },
                    ) {
                        Text(
                            text = "削除",
                            color = DeleteText,
                            fontSize = 16.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
            repeat(2) { i ->
                item(key = "pre-save-$i") {
                    Spacer(Modifier.height(0.dp))
                }
            }
            item(key = "save") {
                BackEdgeButton(
                    text = if (busy) "…" else "Save",
                    enabled = !busy && !timeInvalid,
                    onClick = {
                        if (busy || timeInvalid) return@BackEdgeButton
                        val id = form.eventId ?: newWatchEventId()
                        if (controller.overwriteEvent(id, startIso, endIso, draftTaskId)) {
                            saving = true
                        }
                    },
                )
            }
        }
        OverlayPage(
            visible = picker != null,
            onGone = {
                val picked = pendingPick
                pendingPick = null
                picker = null
                if (picked != null) {
                    when (picked.first) {
                        ClockField.Start -> startIso = replaceClock(startIso, picked.second)
                        ClockField.End -> endIso = replaceClock(endIso, picked.second)
                    }
                }
            },
        ) { dismiss ->
            val field = picker
            if (field == null) return@OverlayPage
            val initial = remember(field) {
                when (field) {
                    ClockField.Start -> isoToLocalTime(startIso)
                    ClockField.End -> isoToLocalTime(endIso)
                }
            }
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Bg),
            ) {
                TimePicker(
                    initialTime = initial,
                    onTimePicked = { time: LocalTime ->
                        pendingPick = field to time
                        dismiss()
                    },
                    modifier = Modifier.fillMaxSize(),
                    timePickerType = TimePickerType.HoursMinutesSeconds24H,
                )
            }
        }
        OverlayPage(
            visible = pickFolder,
            onGone = { setNested(folder = false, folderId = null) },
        ) { _ ->
            val foldersState = rememberTransformingLazyColumnState()
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Bg),
            ) {
                LoggerScreen(foldersState, edge, bottomPadding = 0.dp) {
                    item(key = "header") {
                        TitleHeader(
                            text = "フォルダ",
                            listState = foldersState,
                            spec = TaskHeaderFx,
                        )
                    }
                    items(controller.folders, key = { it.id }) { folder ->
                        FolderRow(
                            folder = folder,
                            onClick = { pickFolderId = folder.id },
                        )
                    }
                }
                OverlayPage(
                    visible = pickFolderId != null,
                    onGone = { pickFolderId = null },
                ) { _ ->
                    val fid = pickFolderId
                    val folder = fid?.let { controller.folder(it) }
                    val tasks = fid?.let { controller.tasksIn(it) }.orEmpty()
                    val tasksState = rememberTransformingLazyColumnState()
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(Bg),
                    ) {
                        LoggerScreen(tasksState, edge, bottomPadding = 0.dp) {
                            item(key = "header") {
                                TitleHeader(
                                    text = folder?.name.orEmpty(),
                                    listState = tasksState,
                                    spec = TaskHeaderFx,
                                )
                            }
                            items(tasks, key = { it.id }) { task ->
                                PickTaskRow(task = task) {
                                    view.tapHaptic(TapHaptic.Click)
                                    draftTaskId = task.id
                                    draftTaskName = task.name
                                    draftTaskColor = task.color
                                    setNested(folder = false, folderId = null)
                                }
                            }
                        }
                    }
                }
            }
        }
        AlertDialog(
            visible = confirmDelete,
            onDismissRequest = { confirmDelete = false },
            confirmButton = {
                AlertDialogDefaults.ConfirmButton(
                    onClick = {
                        val id = form.eventId
                        confirmDelete = false
                        if (id != null && controller.deleteEvent(id)) saving = true
                    },
                )
            },
            title = { Text("削除しますか？") },
            dismissButton = {
                AlertDialogDefaults.DismissButton(
                    onClick = { confirmDelete = false },
                )
            },
        )
    }
}

@Composable
private fun TransformingLazyColumnItemScope.TimeFieldRow(
    label: String,
    value: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    EdgePill(
        running = false,
        onClick = { if (enabled) onClick() },
    ) {
        Text(
            text = label,
            color = TextDim,
            fontSize = 13.sp,
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = value,
            color = TextMain,
            fontSize = 16.sp,
            modifier = Modifier.weight(1f),
            textAlign = TextAlign.End,
        )
    }
}

@Composable
private fun LoggerScreen(
    listState: TransformingLazyColumnState,
    edge: EdgeSettings,
    modifier: Modifier = Modifier,
    bottomPadding: Dp? = null,
    userScrollEnabled: Boolean = true,
    banner: String? = null,
    onBannerClick: (() -> Unit)? = null,
    onTopRefresh: (() -> Unit)? = null,
    padTopInset: Boolean = true,
    content: TransformingLazyColumnScope.() -> Unit,
) {
    val fx = rememberEdgeFx(edge)
    val layoutDir = LocalLayoutDirection.current
    val density = LocalDensity.current
    val refreshConn = remember(listState, onTopRefresh) {
        if (onTopRefresh == null) {
            null
        } else {
            TopRefreshConnection(
                listState = listState,
                thresholdPx = with(density) { 72.dp.toPx() },
                onRefresh = onTopRefresh,
            )
        }
    }
    ScreenScaffold(
        modifier = modifier.fillMaxSize(),
        scrollState = listState,
        timeText = {},
    ) { innerPadding ->
        val topInset = innerPadding.calculateTopPadding()
        val contentPadding = PaddingValues(
            start = innerPadding.calculateStartPadding(layoutDir),
            end = innerPadding.calculateEndPadding(layoutDir),
            top = 0.dp,
            bottom = bottomPadding ?: innerPadding.calculateBottomPadding(),
        )
        Box(Modifier.fillMaxSize()) {
            CompositionLocalProvider(LocalEdgeFx provides fx) {
                TransformingLazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .then(if (refreshConn != null) Modifier.nestedScroll(refreshConn) else Modifier),
                    state = listState,
                    contentPadding = contentPadding,
                    userScrollEnabled = userScrollEnabled,
                    verticalArrangement = Arrangement.spacedBy(RowGap),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    val inset = (topInset - RowGap).coerceAtLeast(0.dp)
                    if (padTopInset && inset > 0.dp) {
                        item(key = "top-inset") {
                            Spacer(Modifier.height(inset))
                        }
                    }
                    content()
                }
            }
            if (!banner.isNullOrEmpty()) {
                Text(
                    text = banner,
                    color = TextDim,
                    fontSize = 11.sp,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .fillMaxWidth()
                        .padding(start = 36.dp, end = 36.dp, top = 4.dp)
                        .then(
                            if (onBannerClick != null) Modifier.clickQuiet(onBannerClick) else Modifier,
                        ),
                )
            }
        }
    }
}

@Composable
private fun RecordingHeader(
    current: Event?,
    listState: TransformingLazyColumnState,
    spec: HeaderFxSpec,
    modifier: Modifier = Modifier,
) {
    val cache = remember { HeaderFxCache() }
    val headerH = with(LocalDensity.current) { spec.height.toPx() }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .heightIn(min = spec.height)
            .graphicsLayer {
                applyHeaderLayer(listState, cache, headerH, spec)
            }
            .drawIntoTrailingRowGap(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (current != null) {
            ElapsedLabel(current.startedAt, fontSize = 12.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(parseComposeColor(current.taskColor)),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = current.taskName,
                    color = Color.White,
                    fontSize = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.height(RowGap))
    }
}

@Composable
private fun TitleHeader(
    text: String,
    listState: TransformingLazyColumnState,
    spec: HeaderFxSpec,
    color: String? = null,
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val cache = remember { HeaderFxCache() }
    val headerH = with(LocalDensity.current) { spec.height.toPx() }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .graphicsLayer {
                applyHeaderLayer(listState, cache, headerH, spec)
            }
            .drawIntoTrailingRowGap(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .then(if (onClick != null) Modifier.clickQuiet(onClick) else Modifier)
                .padding(vertical = 4.dp, horizontal = 18.dp)
                .heightIn(min = 28.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            if (color != null) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(parseComposeColor(color)),
                )
                Spacer(Modifier.width(6.dp))
            }
            Text(
                text = text,
                color = Color.White,
                fontSize = 16.sp,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
        }
        Spacer(Modifier.height(RowGap))
    }
}

@Composable
private fun StatusRow(text: String, retry: Boolean, onClick: () -> Unit) {
    Text(
        text = text,
        color = TextDim,
        fontSize = 13.sp,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .then(if (retry) Modifier.clickQuiet(onClick) else Modifier)
            .padding(vertical = 6.dp, horizontal = 8.dp),
    )
}

@Composable
private fun TransformingLazyColumnItemScope.PickTaskRow(
    task: Task,
    onClick: () -> Unit,
) {
    EdgePill(running = false, onClick = onClick) {
        Box(
            modifier = Modifier
                .size(14.dp)
                .clip(CircleShape)
                .background(parseComposeColor(task.color)),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = task.name,
            color = TextMain,
            fontSize = 16.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun TransformingLazyColumnItemScope.FolderRow(
    folder: Folder,
    onClick: () -> Unit,
) {
    EdgePill(running = false, onClick = onClick) {
        Icon(
            painter = painterResource(R.drawable.ic_folder),
            contentDescription = null,
            tint = parseComposeColor(folder.color),
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = folder.name,
            color = TextMain,
            fontSize = 16.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun TransformingLazyColumnItemScope.TaskRow(
    task: Task,
    running: Boolean,
    linked: Boolean,
    startedAt: String?,
    enabled: Boolean,
    waiting: Boolean,
    onClick: () -> Boolean,
    onOpenBind: () -> Unit,
) {
    val motion = rememberRowMotion()
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    var showRunning by remember { mutableStateOf(running) }
    LaunchedEffect(running, waiting) {
        if (!waiting) showRunning = running
    }
    fun openBind() {
        if (!enabled) return
        view.tapHaptic(TapHaptic.Click)
        onOpenBind()
    }
    EdgePill(
        running = showRunning,
        motion = motion,
        onClick = {
            if (!enabled) return@EdgePill
            if (!onClick()) return@EdgePill
            view.tapHaptic(TapHaptic.Click)
            showRunning = !running
            if (!running) scope.launch { motion.pulse() }
        },
        onLongClick = { openBind() },
        onLeadingClick = if (linked) ({ openBind() }) else null,
    ) {
        if (linked) {
            LinkMark(tint = parseComposeColor(task.color))
        } else {
            Box(
                modifier = Modifier
                    .size(14.dp)
                    .clip(CircleShape)
                    .background(parseComposeColor(task.color)),
            )
        }
        Spacer(Modifier.width(8.dp))
        Text(
            text = task.name,
            color = TextMain,
            fontSize = 16.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (waiting) {
            Spacer(Modifier.width(6.dp))
            WaitSpinner(starting = showRunning)
        } else if (showRunning && startedAt != null) {
            Spacer(Modifier.width(6.dp))
            ElapsedLabel(startedAt)
        }
    }
}

@Composable
private fun TransformingLazyColumnItemScope.BindRow(
    label: String,
    linked: Boolean,
    enabled: Boolean,
    onToggle: () -> Unit,
    onBound: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    val fill = remember {
        ColorAnimatable(if (linked) LinkedRowBg else RowBg)
    }
    EdgePill(
        running = false,
        fill = fill.value,
        onClick = {
            if (!enabled) return@EdgePill
            if (linked) {
                view.tapHaptic(TapHaptic.Click)
                onToggle()
                scope.launch {
                    fill.animateTo(
                        RowBg,
                        tween(PulseTotalMs, easing = FastOutSlowInEasing),
                    )
                }
            } else {
                view.tapHaptic(TapHaptic.Back)
                onToggle()
                scope.launch {
                    fill.animateTo(
                        BindFlashBg,
                        tween(BindSettleMs, easing = FastOutSlowInEasing),
                    )
                }
                scope.launch {
                    delay(BindFlashMs)
                    onBound()
                }
            }
        },
    ) {
        if (linked) {
            LinkMark(tint = LinkGreen)
        } else {
            Spacer(Modifier.size(16.dp))
        }
        Spacer(Modifier.width(8.dp))
        Text(
            text = label,
            color = TextMain,
            fontSize = 16.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun LinkMark(tint: Color) {
    Icon(
        painter = painterResource(R.drawable.ic_link),
        contentDescription = null,
        tint = tint,
        modifier = Modifier.size(16.dp),
    )
}

@Composable
internal fun OverlayPage(
    visible: Boolean,
    onGone: () -> Unit,
    swipeEnabled: Boolean = true,
    content: @Composable (dismiss: () -> Unit) -> Unit,
) {
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val leaveX = remember { Animatable(0f) }
    var widthPx by remember { mutableFloatStateOf(0f) }
    var leaving by remember { mutableStateOf(false) }
    var freezeX by remember { mutableFloatStateOf(0f) }
    val shownX = when {
        freezeX > 0f -> freezeX
        leaving -> leaveX.value
        else -> 0f
    }
    fun offscreen(): Float {
        val fallback = with(density) { 240.dp.toPx() }
        return if (widthPx > 1f) widthPx else fallback
    }
    fun dismiss() {
        if (leaving || !visible) return
        leaving = true
        scope.launch {
            val target = offscreen()
            leaveX.animateTo(target, tween(OverlaySwipeMs, easing = FastOutLinearInEasing))
            freezeX = target
            onGone()
        }
    }
    LaunchedEffect(visible) {
        if (visible) {
            freezeX = 0f
            leaveX.snapTo(0f)
            leaving = false
        }
    }
    AnimatedVisibility(
        visible = visible,
        enter = slideInHorizontally(tween(OverlaySwipeMs)) { it } + fadeIn(tween(OverlaySwipeMs)),
        exit = ExitTransition.None,
    ) {
        ForegroundLayer {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .onSizeChanged { widthPx = it.width.toFloat() }
                    .graphicsLayer { translationX = shownX },
            ) {
                if (swipeEnabled) {
                    SwipeToDismissBox(
                        onDismissed = {
                            view.tapHaptic(TapHaptic.Back)
                            freezeX = offscreen()
                            leaving = true
                            onGone()
                        },
                        modifier = Modifier.fillMaxSize(),
                        userSwipeEnabled = !leaving,
                    ) { isBackground ->
                        if (!isBackground) {
                            content(::dismiss)
                        }
                    }
                } else {
                    content(::dismiss)
                }
            }
        }
    }
}

private class ForegroundGate {
    private val order = mutableStateListOf<Any>()

    fun isTop(key: Any): Boolean = order.lastOrNull() === key

    fun enter(key: Any) {
        if (order.none { it === key }) order.add(key)
    }

    fun leave(key: Any) {
        order.removeAll { it === key }
    }
}

private val LocalForegroundGate = staticCompositionLocalOf<ForegroundGate> {
    error("ForegroundGate missing")
}

private val LocalIsForeground = staticCompositionLocalOf { true }

@Composable
private fun ForegroundLayer(content: @Composable () -> Unit) {
    val gate = LocalForegroundGate.current
    val key = remember { Any() }
    DisposableEffect(gate) {
        gate.enter(key)
        onDispose { gate.leave(key) }
    }
    CompositionLocalProvider(LocalIsForeground provides gate.isTop(key), content = content)
}

private class TopRefreshConnection(
    private val listState: TransformingLazyColumnState,
    private val thresholdPx: Float,
    private val onRefresh: () -> Unit,
) : NestedScrollConnection {
    private var pulled = 0f

    override fun onPostScroll(
        consumed: Offset,
        available: Offset,
        source: NestedScrollSource,
    ): Offset {
        if (listState.canScrollBackward) {
            pulled = 0f
            return Offset.Zero
        }
        if (available.y > 0f) {
            pulled += available.y
        } else if (available.y < 0f) {
            pulled = 0f
        }
        return Offset.Zero
    }

    override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
        if (!listState.canScrollBackward && pulled >= thresholdPx) {
            onRefresh()
        }
        pulled = 0f
        return Velocity.Zero
    }
}

@Composable
private fun WaitSpinner(starting: Boolean) {
    if (!LocalIsForeground.current) {
        Spacer(Modifier.size(16.dp))
        return
    }
    val accent = if (starting) RunningBorder else Color.White.copy(alpha = 0.92f)
    CircularProgressIndicator(
        modifier = Modifier.size(16.dp),
        colors = ProgressIndicatorDefaults.colors(
            indicatorColor = accent,
            trackColor = accent.copy(alpha = 0.22f),
        ),
        strokeWidth = 2.5.dp,
    )
}

@Composable
private fun TransformingLazyColumnItemScope.BackEdgeButton(
    onClick: () -> Unit,
    text: String = "戻る",
    enabled: Boolean = true,
) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 32.dp, end = 32.dp)
            .height(BackHeight)
            .graphicsLayer {
                applyButtonLayer(scrollProgress, BackBg)
            }
            .graphicsLayer { alpha = if (enabled) 1f else 0.38f }
            .background(BackBg, BottomEdgeShape())
            .then(
                if (enabled) {
                    Modifier.tapHapticClick(TapHaptic.Back, onClick)
                } else {
                    Modifier
                },
            ),
    ) {
        val density = LocalDensity.current
        val shapeH = with(density) {
            val (r, b) = bottomEdgeRadii(maxWidth.toPx(), maxHeight.toPx(), density)
            (r + b).toDp()
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(shapeH)
                .align(Alignment.TopCenter),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = text,
                color = BackText,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun TransformingLazyColumnItemScope.AddEdgeButton(
    listState: TransformingLazyColumnState,
    onClick: () -> Unit,
) {
    val topCache = remember { TopButtonFxCache() }
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val backInner = with(density) { maxWidth.toPx() - 64.dp.toPx() }
        val metrics = addEdgeMetrics(backInner, with(density) { BackHeight.toPx() }, density)
        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .width(with(density) { metrics.width.toDp() })
                .height(with(density) { (metrics.r + metrics.b).toDp() })
                .graphicsLayer {
                    val t = scrollProgress.topOffsetFraction
                    if (!scrollProgress.isUnspecified && !t.isNaN()) {
                        if (!listState.canScrollBackward || topCache.restTop.isNaN()) {
                            topCache.restTop = t
                        }
                    }
                    val clip = if (topCache.restTop.isNaN()) 0f else topCache.restTop
                    applyTopButtonLayer(scrollProgress, BackBg, clip)
                }
                .background(BackBg, TopEdgeShape(metrics.r, metrics.b))
                .tapHapticClick(TapHaptic.Click, onClick),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "Add",
                color = BackText,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun TransformingLazyColumnItemScope.EdgePill(
    running: Boolean,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null,
    onLeadingClick: (() -> Unit)? = null,
    tinted: Boolean = false,
    fill: Color? = null,
    height: Dp = PillHeight,
    hInset: Dp = 0.dp,
    modifier: Modifier = Modifier,
    motion: RowMotion = rememberRowMotion(),
    content: @Composable RowScope.() -> Unit,
) {
    val fx = LocalEdgeFx.current
    val cache = remember { EdgeFxCache() }
    val targetBg = when {
        fill != null -> fill
        running -> RunningBg
        tinted -> LinkedRowBg
        else -> RowBg
    }
    val animatedBg by animateColorAsState(
        targetValue = targetBg,
        animationSpec = if (fill != null || tinted) {
            snap()
        } else {
            tween(PulseTotalMs, easing = FastOutSlowInEasing)
        },
        label = "row-bg",
    )
    val baseBg = fill ?: animatedBg
    val pulse = motion.scale.value
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = hInset)
            .height(height)
            .transformedHeight { measured, progress -> fx.pillHeight(measured, progress, cache) }
            .graphicsLayer {
                applyEdgeLayer(cache, baseBg, scrollProgress)
            }
            .graphicsLayer {
                scaleX = pulse
                scaleY = pulse
            }
            .clip(CircleShape)
            .background(baseBg, CircleShape)
            .then(
                if (running) {
                    Modifier.border(2.dp, RunningBorder, CircleShape)
                } else {
                    Modifier
                },
            )
            .clickQuiet(onClick, onLongClick),
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
        if (onLeadingClick != null) {
            Box(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .fillMaxHeight()
                    .aspectRatio(1f, matchHeightConstraintsFirst = true)
                    .clip(CircleShape)
                    .clickQuiet(onLeadingClick),
            )
        }
    }
}

@Composable
private fun ElapsedLabel(
    startedAt: String,
    fontSize: TextUnit = 13.sp,
    color: Color = RunningBorder,
    format: (String, Long) -> String = { started, now -> elapsedText(started, now) },
) {
    val live = LocalIsForeground.current
    val startMs = remember(startedAt) { startedAtMillis(startedAt) }
    if (startMs == null) {
        Text("--", color = color, fontSize = fontSize)
        return
    }
    val argb = color.toArgb()
    val sizeSp = fontSize.value
    AndroidView(
        factory = { ctx ->
            Chronometer(ctx).apply {
                setTextColor(argb)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
                fontFeatureSettings = "tnum"
                includeFontPadding = false
                setPadding(0, 0, 0, 0)
                minWidth = 0
                minHeight = 0
            }
        },
        update = { view ->
            view.setTextColor(argb)
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
            val elapsed = (System.currentTimeMillis() - startMs).coerceAtLeast(0L)
            view.base = SystemClock.elapsedRealtime() - elapsed
            view.setOnChronometerTickListener { v ->
                v.text = format(startedAt, startMs + (SystemClock.elapsedRealtime() - v.base))
            }
            view.text = format(startedAt, startMs + elapsed)
            if (live) view.start() else view.stop()
        },
    )
}

private fun Modifier.drawIntoTrailingRowGap(): Modifier =
    layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        val gapPx = RowGap.roundToPx()
        layout(placeable.width, (placeable.height - gapPx).coerceAtLeast(0)) {
            placeable.place(0, 0)
        }
    }

private fun Modifier.clickQuiet(
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null,
): Modifier {
    return if (onLongClick == null) {
        clickable(
            interactionSource = null,
            indication = null,
            onClick = onClick,
        )
    } else {
        combinedClickable(
            interactionSource = null,
            indication = null,
            onClick = onClick,
            onLongClick = onLongClick,
        )
    }
}

internal fun parseComposeColor(hex: String): Color {
    return try {
        Color(android.graphics.Color.parseColor(hex))
    } catch (_: Exception) {
        Color(0xFFA8B0C0)
    }
}
