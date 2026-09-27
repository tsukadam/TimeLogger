package com.timelogger.wear

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView

internal const val PulseUpMs = 170
internal const val PulseDownMs = 310
internal const val PulseTotalMs = PulseUpMs + PulseDownMs
internal const val BindSettleMs = 160
internal const val BindFlashMs = 160L
internal const val OverlaySwipeMs = 240

internal enum class TapHaptic {
    Click,
    Confirm,
    Back,
}

internal class RowMotion {
    val scale = Animatable(1f)

    suspend fun pulse() {
        scale.stop()
        scale.snapTo(1f)
        scale.animateTo(1.065f, tween(PulseUpMs, easing = FastOutSlowInEasing))
        scale.animateTo(1f, tween(PulseDownMs, easing = FastOutSlowInEasing))
    }
}

internal fun View.tapHaptic(kind: TapHaptic) {
    val code = when (kind) {
        TapHaptic.Click -> HapticFeedbackConstants.CONTEXT_CLICK
        TapHaptic.Confirm -> HapticFeedbackConstants.CONFIRM
        TapHaptic.Back -> if (Build.VERSION.SDK_INT >= 30) {
            HapticFeedbackConstants.GESTURE_END
        } else {
            HapticFeedbackConstants.CONTEXT_CLICK
        }
    }
    performHapticFeedback(code)
}

@Composable
internal fun rememberRowMotion(): RowMotion = remember { RowMotion() }

@Composable
internal fun Modifier.tapHapticClick(
    haptic: TapHaptic,
    onClick: () -> Unit,
): Modifier {
    val view = LocalView.current
    return clickable(
        interactionSource = null,
        indication = null,
        onClick = {
            view.tapHaptic(haptic)
            onClick()
        },
    )
}
