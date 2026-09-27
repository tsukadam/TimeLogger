package com.timelogger.wear

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.min

internal data class EdgeMetrics(val r: Float, val b: Float, val width: Float)

internal fun bottomEdgeRadii(width: Float, height: Float, density: Density): Pair<Float, Float> {
    val r = with(density) { 26.dp.toPx() }.coerceAtMost(height / 2f).coerceAtMost(width / 4f)
    val a = width / 2f
    val filled = (height - r).coerceAtLeast(1f)
    val squashed = min(filled, a * 0.52f)
    val b = filled + (squashed - filled) * 0.25f
    return r to b
}

/** 戻ると同じ円半径。水平線と上楕円だけ一回り小さく。楕円の左右頂点は円の接点のまま。 */
internal fun addEdgeMetrics(backInnerWidth: Float, backHeight: Float, density: Density): EdgeMetrics {
    val (r, bBack) = bottomEdgeRadii(backInnerWidth, backHeight, density)
    val chord = (backInnerWidth - 2f * r).coerceAtLeast(0f)
    val width = 2f * r + chord * 0.78f
    return EdgeMetrics(r = r, b = bBack * 0.78f, width = width)
}

/**
 * 左右は円（接点で接線が垂直）。下は縦につぶれた楕円。
 * 接点は左右円の左／右端であり、楕円の左右頂点でもある。
 */
class BottomEdgeShape : Shape {
    override fun createOutline(
        size: Size,
        layoutDirection: LayoutDirection,
        density: Density,
    ): Outline {
        val w = size.width
        val h = size.height
        if (w <= 0f || h <= 0f) return Outline.Generic(Path())

        val (r, b) = bottomEdgeRadii(w, h, density)
        val path = Path()
        path.moveTo(r, 0f)
        path.lineTo(w - r, 0f)
        path.arcTo(Rect(w - 2f * r, 0f, w, 2f * r), -90f, 90f, false)
        path.arcTo(Rect(0f, r - b, w, r + b), 0f, 180f, false)
        path.arcTo(Rect(0f, 0f, 2f * r, 2f * r), 180f, 90f, false)
        path.close()
        return Outline.Generic(path)
    }
}

/** 戻るボタンの上下反転。半径を渡したら円はそれに固定する。 */
class TopEdgeShape(
    private val radius: Float? = null,
    private val ellipseB: Float? = null,
) : Shape {
    override fun createOutline(
        size: Size,
        layoutDirection: LayoutDirection,
        density: Density,
    ): Outline {
        val w = size.width
        val h = size.height
        if (w <= 0f || h <= 0f) return Outline.Generic(Path())

        val r = radius ?: bottomEdgeRadii(w, h, density).first
        val b = ellipseB ?: bottomEdgeRadii(w, h, density).second
        val path = Path()
        path.moveTo(r, h)
        path.lineTo(w - r, h)
        path.arcTo(Rect(w - 2f * r, h - 2f * r, w, h), 90f, -90f, false)
        path.arcTo(Rect(0f, h - r - b, w, h - r + b), 0f, -180f, false)
        path.arcTo(Rect(0f, h - 2f * r, 2f * r, h), 180f, -90f, false)
        path.close()
        return Outline.Generic(path)
    }
}
