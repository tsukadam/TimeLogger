/** 内側の overflow コンテナだけを動かす（scrollIntoView は祖先や window まで巻く） */
export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el
  while (cur) {
    const oy = getComputedStyle(cur).overflowY
    if (oy === 'auto' || oy === 'scroll') return cur
    cur = cur.parentElement
  }
  return null
}

export function scrollChildToCenter(
  el: HTMLElement,
  behavior: ScrollBehavior = 'auto',
): void {
  const scroller = findScrollParent(el)
  if (!scroller) return
  const s = scroller.getBoundingClientRect()
  const e = el.getBoundingClientRect()
  const next =
    scroller.scrollTop + (e.top - s.top) - (s.height / 2 - e.height / 2)
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  scroller.scrollTo({ top: Math.max(0, Math.min(max, next)), behavior })
}
