import { useEffect } from 'react'

/** 開いている間、要素の外側をタップしたら閉じる（pointerdown 基準） */
export function useOutsideClose(
  ref: { current: HTMLElement | null },
  active: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!active) return
    const onDown = (e: PointerEvent) => {
      const t = e.target
      if (ref.current && t instanceof Node && !ref.current.contains(t)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [ref, active, onClose])
}

/** 開いている間、Escape キーで閉じる */
export function useEscapeClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, onClose])
}
