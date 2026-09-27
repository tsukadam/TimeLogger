package com.timelogger.wear

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.unit.Dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnItemScrollProgress
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnState
import kotlin.math.roundToInt

object EdgeScale {
    const val None = 0f
    const val Gentle = 0.62f
    const val Sharp = 1f
}

data class EdgeSettings(
    val top: Float = EdgeScale.Gentle,
    val bottom: Float = EdgeScale.Sharp,
)

internal class EdgeFxCache {
    var scale = 1f
    var alpha = 1f
    var extra = 1f

    fun identity() {
        scale = 1f
        alpha = 1f
        extra = 1f
    }
}

private data class PillStops(
    val scaleStart: Float,
    val chipFadeStart: Float,
    val textFadeStart: Float,
    val textEnd: Float,
    val scaleEnd: Float,
    val chipEnd: Float,
)

private val BottomStops = PillStops(
    scaleStart = 0.30f,
    chipFadeStart = 0.20f,
    textFadeStart = 0.05f,
    textEnd = 0.01f,
    scaleEnd = -0.15f,
    chipEnd = -0.20f,
)

private const val ButtonBgAppearStart = 0.20f
private const val ButtonBgAppearEnd = 0.55f
private const val ButtonTextAppearStart = 0.60f
private const val ButtonTextAppearEnd = 0.70f

private val TopStops = PillStops(
    scaleStart = 0.28f,
    chipFadeStart = 0.13f,
    textFadeStart = 0.13f,
    textEnd = -0.17f,
    scaleEnd = -0.50f,
    chipEnd = -0.35f,
)

internal class EdgeFx(
    private val minScaleTop: Float,
    private val minScaleBottom: Float,
) {
    fun pillHeight(
        measured: Int,
        progress: TransformingLazyColumnItemScrollProgress,
        out: EdgeFxCache,
    ): Int {
        capturePill(progress, out)
        return (measured * out.scale).roundToInt().coerceAtLeast(layoutMin(measured))
    }

    private fun capturePill(progress: TransformingLazyColumnItemScrollProgress, out: EdgeFxCache) {
        val top = progress.topOffsetFraction
        val bot = progress.bottomOffsetFraction
        if (progress.isUnspecified || top.isNaN() || bot.isNaN()) {
            out.identity()
            return
        }
        val center = (top + bot) * 0.5f
        val lowerHalf = center >= 0.5f
        writeValues(
            dist = if (lowerHalf) 1f - center else center,
            stops = if (lowerHalf) BottomStops else TopStops,
            minScale = if (lowerHalf) minScaleBottom else minScaleTop,
            out = out,
        )
    }
}

internal fun GraphicsLayerScope.applyEdgeLayer(
    cache: EdgeFxCache,
    fadeToward: Color,
    progress: TransformingLazyColumnItemScrollProgress,
) {
    transformOrigin = PivotTop
    scaleX = cache.scale
    scaleY = cache.scale
    alpha = cache.alpha
    clip = false
    compositingStrategy = CompositingStrategy.ModulateAlpha
    val t = (1f - cache.extra).coerceIn(0f, 1f)
    colorFilter = if (t <= 0.001f) {
        null
    } else {
        ColorFilter.colorMatrix(towardBackground(fadeToward, t))
    }
    if (progress.isUnspecified) return
}

internal fun GraphicsLayerScope.applyButtonLayer(
    progress: TransformingLazyColumnItemScrollProgress,
    chip: Color,
) {
    writeButtonLayer(buttonScale(progress), PivotTop, chip)
}

internal fun GraphicsLayerScope.applyTopButtonLayer(
    progress: TransformingLazyColumnItemScrollProgress,
    chip: Color,
    clipTop: Float = 0f,
) {
    writeButtonLayer(topButtonScale(progress, clipTop), PivotBottom, chip)
}

private fun GraphicsLayerScope.writeButtonLayer(
    scale: Float,
    origin: TransformOrigin,
    chip: Color,
) {
    transformOrigin = origin
    scaleX = scale
    scaleY = scale
    alpha = appearAlpha(scale, ButtonBgAppearStart, ButtonBgAppearEnd)
    clip = false
    compositingStrategy = CompositingStrategy.ModulateAlpha
    val t = 1f - appearAlpha(scale, ButtonTextAppearStart, ButtonTextAppearEnd)
    colorFilter = if (t <= 0.001f) {
        null
    } else {
        ColorFilter.colorMatrix(towardBackground(chip, t))
    }
}

internal data class HeaderFxSpec(
    val height: Dp,
    val fadeStartPx: Float = 1f,
    val fadeEndFrac: Float = 0.30f,
    val minAlpha: Float = 0.50f,
    val scaleEndFrac: Float = 6.0f,
)

internal class HeaderFxCache {
    var restOffsetPx = Int.MIN_VALUE
    var gapPx = 0
    val heights = HashMap<Int, Int>()
}

internal class TopButtonFxCache {
    var restTop = Float.NaN
}

internal fun GraphicsLayerScope.applyHeaderLayer(
    state: TransformingLazyColumnState,
    cache: HeaderFxCache,
    headerHeightPx: Float,
    spec: HeaderFxSpec,
) {
    val scrollPx = headerScrollPx(state, cache)
    val fadeStart = spec.fadeStartPx
    val fadeEnd = (spec.fadeEndFrac * headerHeightPx).coerceAtLeast(fadeStart)
    val scaleEnd = (spec.scaleEndFrac * headerHeightPx).coerceAtLeast(fadeStart)
    val scale = when {
        scrollPx <= fadeStart -> 1f
        scrollPx >= scaleEnd -> 0f
        else -> 1f - (scrollPx - fadeStart) / (scaleEnd - fadeStart)
    }.coerceIn(0f, 1f)
    val alpha = when {
        scrollPx <= fadeStart -> 1f
        scrollPx >= fadeEnd -> spec.minAlpha
        else -> lerp(1f, spec.minAlpha, (scrollPx - fadeStart) / (fadeEnd - fadeStart))
    }
    transformOrigin = PivotTop
    scaleX = scale
    scaleY = scale
    this.alpha = alpha
    clip = false
    compositingStrategy = CompositingStrategy.ModulateAlpha
    colorFilter = null
}

private fun headerScrollPx(
    state: TransformingLazyColumnState,
    cache: HeaderFxCache,
): Float {
    val items = state.layoutInfo.visibleItems
    if (items.isEmpty()) return 0f
    for (item in items) {
        val h = item.transformedHeight
        if (h > 0) cache.heights[item.index] = h
    }
    if (items.size >= 2) {
        val a = items[0]
        val b = items[1]
        val gap = b.offset - a.offset - a.transformedHeight
        if (gap >= 0) cache.gapPx = gap
    }
    val first = items.first()
    if (!state.canScrollBackward) {
        cache.restOffsetPx = first.offset
        return 0f
    }
    if (cache.restOffsetPx == Int.MIN_VALUE) {
        cache.restOffsetPx = first.offset
    }
    var scroll = (cache.restOffsetPx - first.offset).toFloat()
    val gap = cache.gapPx
    for (i in 0 until first.index) {
        scroll += (cache.heights[i] ?: 0) + gap
    }
    return scroll.coerceAtLeast(0f)
}

private fun buttonScale(progress: TransformingLazyColumnItemScrollProgress): Float {
    val top = progress.topOffsetFraction
    val bot = progress.bottomOffsetFraction
    if (progress.isUnspecified || top.isNaN() || bot.isNaN()) return 0f
    val h = bot - top
    return if (h <= 1e-6f) 0f else ((1f - top) / h).coerceIn(0f, 1f)
}

private fun topButtonScale(
    progress: TransformingLazyColumnItemScrollProgress,
    clipTop: Float,
): Float {
    val top = progress.topOffsetFraction
    val bot = progress.bottomOffsetFraction
    if (progress.isUnspecified || top.isNaN() || bot.isNaN()) return 0f
    val h = bot - top
    return if (h <= 1e-6f) 0f else ((bot - clipTop) / h).coerceIn(0f, 1f)
}

private fun appearAlpha(scale: Float, start: Float, end: Float): Float {
    if (scale <= start) return 0f
    if (scale >= end) return 1f
    val span = end - start
    if (span <= 1e-6f) return 1f
    return ((scale - start) / span).coerceIn(0f, 1f)
}

private val PivotTop = TransformOrigin(0.5f, 0f)
private val PivotBottom = TransformOrigin(0.5f, 1f)

private fun towardBackground(target: Color, t: Float): ColorMatrix {
    val keep = 1f - t
    return ColorMatrix(
        floatArrayOf(
            keep, 0f, 0f, 0f, target.red * t * 255f,
            0f, keep, 0f, 0f, target.green * t * 255f,
            0f, 0f, keep, 0f, target.blue * t * 255f,
            0f, 0f, 0f, 1f, 0f,
        ),
    )
}

internal val LocalEdgeFx = staticCompositionLocalOf<EdgeFx> {
    error("EdgeFx missing")
}

@Composable
internal fun rememberEdgeFx(settings: EdgeSettings): EdgeFx {
    return remember(settings.top, settings.bottom) {
        EdgeFx(
            minScaleTop = 0.15f,
            minScaleBottom = 0.15f,
        )
    }
}

private fun writeValues(
    dist: Float,
    stops: PillStops,
    minScale: Float,
    out: EdgeFxCache,
) {
    when {
        dist >= stops.scaleStart -> out.identity()
        dist <= stops.chipEnd -> {
            out.scale = minScale
            out.alpha = 0f
            out.extra = 0f
        }
        else -> {
            out.scale = scaleAt(dist, stops.scaleStart, stops.scaleEnd, minScale)
            out.alpha = alphaAt(dist, stops.chipFadeStart, stops.chipEnd)
            out.extra = if (dist <= stops.textEnd) {
                0f
            } else {
                alphaAt(dist, stops.textFadeStart, stops.textEnd)
            }
        }
    }
}

private fun layoutMin(measured: Int): Int =
    (measured * 0.15f).roundToInt().coerceAtLeast(1)

private fun scaleAt(dist: Float, start: Float, end: Float, minScale: Float): Float {
    if (minScale >= 0.999f || dist >= start) return 1f
    if (dist <= end) return minScale
    val t = ((start - dist) / (start - end)).coerceIn(0f, 1f)
    return lerp(1f, minScale, t)
}

private fun alphaAt(value: Float, start: Float, end: Float): Float {
    if (value >= start) return 1f
    if (value <= end) return 0f
    return ((value - end) / (start - end)).coerceIn(0f, 1f)
}

private fun lerp(a: Float, b: Float, t: Float): Float = a + (b - a) * t
