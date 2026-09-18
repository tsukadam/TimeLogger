const MARGIN = 8

function viewport() {
  const vv = window.visualViewport
  if (vv) {
    return {
      width: vv.width,
      height: vv.height,
      offsetLeft: vv.offsetLeft,
      offsetTop: vv.offsetTop,
    }
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetLeft: 0,
    offsetTop: 0,
  }
}

export type PanelAnchor = {
  top: number
  left: number
  width: number
  height: number
  bottom: number
  right: number
}

export type PanelPos = {
  top: number
  left: number
  width: number
}

/** アンカー中央寄せのあと、画面内に収まるよう左右・上下をクランプする */
export function placePanel(
  anchor: PanelAnchor,
  panel: { width: number; height: number },
): PanelPos {
  const vp = viewport()
  const maxW = Math.max(0, vp.width - MARGIN * 2)
  const width = Math.min(panel.width, maxW)

  const desiredLeft = anchor.left + anchor.width / 2 - width / 2
  const minLeft = vp.offsetLeft + MARGIN
  const maxLeft = vp.offsetLeft + vp.width - width - MARGIN
  const left =
    maxLeft < minLeft
      ? minLeft
      : Math.min(Math.max(minLeft, desiredLeft), maxLeft)

  const below = anchor.bottom + 6
  const desiredTop =
    below + panel.height > vp.offsetTop + vp.height - MARGIN
      ? Math.max(vp.offsetTop + MARGIN, anchor.top - panel.height - 6)
      : below
  const minTop = vp.offsetTop + MARGIN
  const maxTop = vp.offsetTop + vp.height - panel.height - MARGIN
  const top =
    maxTop < minTop
      ? minTop
      : Math.min(Math.max(minTop, desiredTop), maxTop)

  return { top, left, width }
}

export function rectToAnchor(r: DOMRect): PanelAnchor {
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    bottom: r.bottom,
    right: r.right,
  }
}
