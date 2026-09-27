package com.timelogger.wear

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.util.lerp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnItemScope
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnItemScrollProgress
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnState
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Text
import com.timelogger.wear.api.Event
import java.time.LocalDate
import java.time.LocalTime
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

private val GraphBg = Color.Black
private val TrackColor = Color(0xFF2E3338)
private val LabelInk = Color(0xFFECEFF4)
private val LabelShadow = Color(0xE6000000)

private const val GapDeg = 20f
private const val MinLabelSweep = 8f
private const val LabelClearDeg = 26f
private const val HalfMs = 12L * 60L * 60L * 1000L
private const val RevealHideMs = 2L * 60L * 60L * 1000L

private const val DateCenterScale = 1.22f
private const val DateEdgeScale = 0.38f
private const val DateCenterAlpha = 1f
private const val DateEdgeAlpha = 0.05f
private const val DateEdgeHeight = 0.28f
private const val DateEdgeGap = 0.08f
private const val DateVignetteEdge = 0.04f
private const val DateVignetteClear = 0.25f

private const val GraphFadeMs = 100
private const val GraphGrowMs = 460
private const val LabelFadeMs = 180

private val StrokeDp = 15.dp
private val HitExtraDp = 16.dp
private val EdgeDp = 7.dp
private val LabelPadDp = 8.dp
private val DateLineH = 36.dp
private val DateRowGap = 6.dp

private data class RingSeg(
    val name: String,
    val color: Color,
    val startMs: Long,
    val endMs: Long,
)

private data class HalfKey(
    val day: LocalDate,
    val pm: Boolean,
) {
    val id: String get() = "${day}-$pm"
    val dateText: String get() = "${day.monthValue}/${day.dayOfMonth}"
    val amPmText: String get() = if (pm) "PM" else "AM"
    val label: String get() = "$dateText $amPmText"
    val windowStart: Long get() = halfStartMs(day, pm)
}

private data class RingLayout(
    val cx: Float,
    val cy: Float,
    val dia: Float,
    val topLeft: Offset,
    val rStroke: Float,
    val stroke: Float,
    val sweepAvail: Float,
)

@Composable
internal fun DayGraphScreen(
    events: List<Event>,
) {
    val today = remember { LocalDate.now(Tokyo) }
    val minDate = remember(today) { today.minusDays((LocalLogDays - 1).toLong()) }
    val halves = remember(minDate, today) { halfKeys(minDate, today) }
    val initialIndex = remember(halves) {
        val pm = LocalTime.now(Tokyo).hour >= 12
        halves.indexOfFirst { it.day == today && it.pm == pm }.coerceAtLeast(0)
    }
    val listState = rememberTransformingLazyColumnState(initialAnchorItemIndex = initialIndex)
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var revealMs by remember { mutableStateOf<Long?>(null) }
    var painted by remember { mutableStateOf(halves[initialIndex]) }
    val graphAlpha = remember { Animatable(0f) }
    val graphGrow = remember { Animatable(0f) }
    val labelAlpha = remember { Animatable(0f) }
    val view = LocalView.current
    LaunchedEffect(Unit) {
        while (true) {
            delay(15_000)
            nowMs = System.currentTimeMillis()
        }
    }
    LaunchedEffect(listState, halves) {
        val host = this
        var growJob: Job? = null
        snapshotFlow {
            listState.isScrollInProgress to nearestIndex(listState, halves.size, initialIndex)
        }.collectLatest { (scrolling, idx) ->
            val target = halves.getOrNull(idx) ?: return@collectLatest
            val leaving = target.id != painted.id
            if (leaving) {
                launch { labelAlpha.animateTo(0f, tween(LabelFadeMs, easing = FastOutLinearInEasing)) }
                if (graphAlpha.value > 0.02f) {
                    graphAlpha.animateTo(0f, tween(GraphFadeMs, easing = FastOutLinearInEasing))
                } else {
                    graphAlpha.snapTo(0f)
                }
            }
            if (scrolling) return@collectLatest
            if (!leaving && graphGrow.value > 0.99f && graphAlpha.value > 0.99f) {
                if (labelAlpha.value < 0.99f) {
                    labelAlpha.animateTo(1f, tween(LabelFadeMs, easing = FastOutSlowInEasing))
                }
                return@collectLatest
            }
            growJob?.cancel()
            growJob?.join()
            painted = target
            revealMs = null
            graphGrow.snapTo(0f)
            graphAlpha.snapTo(1f)
            val job = host.launch {
                graphGrow.animateTo(1f, tween(GraphGrowMs, easing = FastOutSlowInEasing))
            }
            growJob = job
            job.join()
            if (!listState.isScrollInProgress &&
                nearestIndex(listState, halves.size, initialIndex) == idx
            ) {
                labelAlpha.animateTo(1f, tween(LabelFadeMs, easing = FastOutSlowInEasing))
            }
        }
    }
    val segs = remember(events, painted.windowStart, nowMs) {
        clipHalf(events, painted.windowStart, painted.windowStart + HalfMs, nowMs)
    }
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(GraphBg),
    ) {
        val innerPad = StrokeDp + EdgeDp + 2.dp
        val listSize = minOf(maxWidth, maxHeight) - innerPad * 2
        val vPad = ((listSize - DateLineH) / 2).coerceAtLeast(0.dp)
        DayRing(
            segs = segs,
            windowStart = painted.windowStart,
            grow = graphGrow.value,
            graphAlpha = graphAlpha.value,
            labelAlpha = labelAlpha.value,
            revealMs = revealMs,
            drawLabels = false,
            onReveal = { ms ->
                if (labelAlpha.value < 0.6f) return@DayRing
                view.tapHaptic(TapHaptic.Click)
                revealMs = ms
            },
            modifier = Modifier.fillMaxSize(),
        )
        TransformingLazyColumn(
            modifier = Modifier
                .align(Alignment.Center)
                .size(listSize)
                .clip(CircleShape)
                .drawWithContent {
                    drawContent()
                    drawRect(
                        brush = Brush.verticalGradient(
                            0f to Color.Black,
                            DateVignetteEdge to Color.Black,
                            DateVignetteClear to Color.Transparent,
                            1f - DateVignetteClear to Color.Transparent,
                            1f - DateVignetteEdge to Color.Black,
                            1f to Color.Black,
                        ),
                    )
                },
            state = listState,
            contentPadding = PaddingValues(vertical = vPad),
            verticalArrangement = Arrangement.Top,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            items(halves, key = { it.id }) { half ->
                HalfLabel(half)
            }
        }
        DayRing(
            segs = segs,
            windowStart = painted.windowStart,
            grow = graphGrow.value,
            graphAlpha = graphAlpha.value,
            labelAlpha = labelAlpha.value,
            revealMs = revealMs,
            drawLabels = true,
            onReveal = {},
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun TransformingLazyColumnItemScope.HalfLabel(half: HalfKey) {
    val gapPx = with(LocalDensity.current) { DateRowGap.toPx() }
    val layer = Modifier
        .fillMaxWidth()
        .padding(vertical = 3.dp)
        .transformedHeight { measured, progress ->
            val t = edgeTaper(progress)
            val h = measured * lerp(1f, DateEdgeHeight, t)
            val gap = gapPx * lerp(1f, DateEdgeGap, t)
            (h + gap).roundToInt().coerceAtLeast(1)
        }
        .graphicsLayer {
            val t = edgeTaper(scrollProgress)
            val s = lerp(DateCenterScale, DateEdgeScale, t)
            scaleX = s
            scaleY = s
            alpha = lerp(DateEdgeAlpha, DateCenterAlpha, centerBright(scrollProgress))
            compositingStrategy = CompositingStrategy.ModulateAlpha
        }
    Row(
        modifier = layer,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Text(
            text = half.dateText,
            color = LabelInk,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.End,
            maxLines = 1,
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = half.amPmText,
            color = LabelInk,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Start,
            maxLines = 1,
        )
    }
}

@Composable
private fun DayRing(
    segs: List<RingSeg>,
    windowStart: Long,
    grow: Float,
    graphAlpha: Float,
    labelAlpha: Float,
    revealMs: Long?,
    drawLabels: Boolean,
    onReveal: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val stroke = with(density) { StrokeDp.toPx() }
    val hitExtra = with(density) { HitExtraDp.toPx() }
    val edge = with(density) { EdgeDp.toPx() }
    val labelPad = with(density) { LabelPadDp.toPx() }
    val labelMax = with(density) { 72.dp.roundToPx() }
    val labelStyle = TextStyle(
        color = LabelInk,
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
    )
    val visibleEnd = windowStart + (HalfMs * grow.coerceIn(0f, 1f)).toLong()
    val visible = remember(segs, windowStart, visibleEnd) {
        clipHalfRange(segs, windowStart, visibleEnd)
    }
    Box(
        modifier.then(
            if (drawLabels) {
                Modifier
            } else {
                Modifier.pointerInput(windowStart, segs, labelAlpha, stroke, hitExtra, edge) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        val layout = ringLayout(size.width.toFloat(), size.height.toFloat(), stroke, edge)
                        val t0 = timeAt(down.position, layout, windowStart, hitExtra) ?: return@awaitEachGesture
                        if (labelAlpha < 0.6f) return@awaitEachGesture
                        down.consume()
                        var last = segs.find { t0 >= it.startMs && t0 < it.endMs }
                        if (last != null) onReveal(t0)
                        drag(down.id) { change ->
                            change.consume()
                            val t = timeAt(change.position, layout, windowStart, hitExtra) ?: return@drag
                            val hit = segs.find { t >= it.startMs && t < it.endMs } ?: return@drag
                            val prev = last
                            if (prev == null || hit.startMs != prev.startMs || hit.endMs != prev.endMs) {
                                last = hit
                                onReveal(t)
                            }
                        }
                    }
                }
            },
        ),
    ) {
        if (!drawLabels) {
        Canvas(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = graphAlpha },
        ) {
            if (grow <= 0.001f || graphAlpha <= 0.01f) return@Canvas
            val layout = ringLayout(size.width, size.height, stroke, edge)
            val arcSize = Size(layout.dia, layout.dia)
            val pill = Stroke(width = stroke, cap = StrokeCap.Round)
            fun angleOf(ms: Long): Float {
                val t = ((ms - windowStart).toFloat() / HalfMs.toFloat()).coerceIn(0f, 1f)
                return -90f + GapDeg / 2f + t * layout.sweepAvail
            }
            val growSweep = layout.sweepAvail * grow.coerceIn(0f, 1f)
            if (growSweep > 0.4f) {
                drawArc(
                    color = TrackColor,
                    startAngle = -90f + GapDeg / 2f,
                    sweepAngle = growSweep,
                    useCenter = false,
                    topLeft = layout.topLeft,
                    size = arcSize,
                    style = pill,
                )
            }
            visible.sortedByDescending { it.startMs }.forEach { seg ->
                val start = angleOf(seg.startMs)
                val sweep = angleOf(seg.endMs) - start
                if (sweep <= 0.4f) return@forEach
                drawArc(
                    color = seg.color,
                    startAngle = start,
                    sweepAngle = sweep,
                    useCenter = false,
                    topLeft = layout.topLeft,
                    size = arcSize,
                    style = pill,
                )
            }
        }
        } else {
        Canvas(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = labelAlpha },
        ) {
            if (labelAlpha <= 0.02f) return@Canvas
            val layout = ringLayout(size.width, size.height, stroke, edge)
            val rLabel = (layout.rStroke - stroke / 2f - labelPad).coerceAtLeast(layout.rStroke * 0.42f)
            fun angleOf(ms: Long): Float {
                val t = ((ms - windowStart).toFloat() / HalfMs.toFloat()).coerceIn(0f, 1f)
                return -90f + GapDeg / 2f + t * layout.sweepAvail
            }
            val labeled = labelsToDraw(segs, revealMs, ::angleOf)
            val placed = ArrayList<Float>()
            for ((seg, mid) in labeled) {
                if (placed.any { angDist(it, mid) < LabelClearDeg }) continue
                placed += mid
                val rad = Math.toRadians(mid.toDouble())
                val result = measurer.measure(
                    text = seg.name,
                    style = labelStyle,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    constraints = Constraints(maxWidth = labelMax),
                )
                val x = layout.cx + kotlin.math.cos(rad).toFloat() * rLabel - result.size.width / 2f
                val y = layout.cy + kotlin.math.sin(rad).toFloat() * rLabel - result.size.height / 2f
                drawText(textLayoutResult = result, topLeft = Offset(x + 1f, y + 1f), color = LabelShadow)
                drawText(textLayoutResult = result, topLeft = Offset(x, y))
            }
        }
        }
    }
}

private fun edgeDist(progress: TransformingLazyColumnItemScrollProgress): Float {
    val top = progress.topOffsetFraction
    val bot = progress.bottomOffsetFraction
    if (progress.isUnspecified || top.isNaN() || bot.isNaN()) return 0f
    val mid = (top + bot) / 2f
    return (abs(mid - 0.5f) * 2f).coerceIn(0f, 1f)
}

private fun edgeTaper(progress: TransformingLazyColumnItemScrollProgress): Float {
    val d = edgeDist(progress)
    return d * d
}

private fun centerBright(progress: TransformingLazyColumnItemScrollProgress): Float {
    val d = edgeDist(progress)
    return (1f - d).pow(2.8f)
}

private fun labelsToDraw(
    segs: List<RingSeg>,
    revealMs: Long?,
    angleOf: (Long) -> Float,
): List<Pair<RingSeg, Float>> {
    val reveal = revealMs?.let { t -> segs.find { t >= it.startMs && t < it.endMs } }
    val hideAt = reveal?.let { (it.startMs + it.endMs) / 2L }
    val out = ArrayList<Pair<RingSeg, Float>>()
    if (reveal != null) {
        val start = angleOf(reveal.startMs)
        out += reveal to (start + (angleOf(reveal.endMs) - start) / 2f)
    }
    val autos = segs.map { seg ->
        val start = angleOf(seg.startMs)
        val sweep = angleOf(seg.endMs) - start
        Triple(seg, start + sweep / 2f, sweep)
    }.filter { it.third >= MinLabelSweep }.sortedByDescending { it.third }
    for ((seg, mid, _) in autos) {
        if (reveal != null && seg.startMs == reveal.startMs && seg.endMs == reveal.endMs) continue
        if (hideAt != null && abs((seg.startMs + seg.endMs) / 2L - hideAt) < RevealHideMs) continue
        out += seg to mid
    }
    return out
}

private fun nearestIndex(
    state: TransformingLazyColumnState,
    count: Int,
    fallback: Int,
): Int {
    val items = state.layoutInfo.visibleItems
    if (items.isEmpty() || count <= 0) return fallback
    val mid = state.layoutInfo.viewportSize.height / 2f
    val best = items.minWith(
        compareBy(
            { abs(it.offset + it.transformedHeight / 2f - mid) },
            { it.offset },
        ),
    )
    return best.index.coerceIn(0, count - 1)
}

private fun halfKeys(minDate: LocalDate, maxDate: LocalDate): List<HalfKey> {
    val out = ArrayList<HalfKey>()
    var d = minDate
    while (!d.isAfter(maxDate)) {
        out += HalfKey(d, false)
        out += HalfKey(d, true)
        d = d.plusDays(1)
    }
    return out
}

private fun ringLayout(w: Float, h: Float, stroke: Float, edge: Float): RingLayout {
    val inset = stroke / 2f + edge
    val dia = (min(w, h) - inset * 2f).coerceAtLeast(1f)
    return RingLayout(
        cx = w / 2f,
        cy = h / 2f,
        dia = dia,
        topLeft = Offset((w - dia) / 2f, (h - dia) / 2f),
        rStroke = dia / 2f,
        stroke = stroke,
        sweepAvail = 360f - GapDeg,
    )
}

private fun timeAt(offset: Offset, layout: RingLayout, windowStart: Long, hitExtra: Float): Long? {
    val dx = offset.x - layout.cx
    val dy = offset.y - layout.cy
    val r = kotlin.math.hypot(dx, dy)
    val band = layout.stroke / 2f + hitExtra
    if (r < layout.rStroke - band || r > layout.rStroke + band) return null
    val deg = Math.toDegrees(atan2(dy, dx).toDouble()).toFloat()
    val start = -90f + GapDeg / 2f
    var rel = deg - start
    while (rel < 0f) rel += 360f
    while (rel >= 360f) rel -= 360f
    if (rel > layout.sweepAvail) return null
    return windowStart + (rel / layout.sweepAvail * HalfMs).toLong()
}

private fun halfStartMs(day: LocalDate, pm: Boolean): Long {
    val hour = if (pm) 12 else 0
    return day.atTime(hour, 0).atZone(Tokyo).toInstant().toEpochMilli()
}

private fun clipHalf(
    events: List<Event>,
    windowStart: Long,
    windowEnd: Long,
    nowMs: Long,
): List<RingSeg> {
    return events.mapNotNull { ev ->
        val start = startedAtMillis(ev.startedAt) ?: return@mapNotNull null
        val rawEnd = if (ev.endedAt.isNullOrEmpty()) nowMs else startedAtMillis(ev.endedAt) ?: nowMs
        val a = maxOf(start, windowStart)
        val b = minOf(rawEnd, windowEnd)
        if (b <= a) return@mapNotNull null
        RingSeg(
            name = ev.taskName,
            color = parseComposeColor(ev.taskColor),
            startMs = a,
            endMs = b,
        )
    }.sortedBy { it.startMs }
}

private fun clipHalfRange(segs: List<RingSeg>, windowStart: Long, windowEnd: Long): List<RingSeg> {
    if (windowEnd <= windowStart) return emptyList()
    return segs.mapNotNull { seg ->
        val a = maxOf(seg.startMs, windowStart)
        val b = minOf(seg.endMs, windowEnd)
        if (b <= a) null else seg.copy(startMs = a, endMs = b)
    }
}

private fun angDist(a: Float, b: Float): Float {
    val d = abs(a - b) % 360f
    return min(d, 360f - d)
}
