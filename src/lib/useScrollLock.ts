import { useEffect } from 'react'

let lockCount = 0

function setLocked(locked: boolean) {
  const value = locked ? 'hidden' : ''
  document.body.style.overflow = value
  document.documentElement.style.overflow = value
  // アプリ内のスクロールコンテナ（data-scroll-lock 付与要素）も止める
  document
    .querySelectorAll<HTMLElement>('[data-scroll-lock]')
    .forEach((el) => {
      el.style.overflow = value
    })
}

/** モーダル表示中に背後のページスクロールを止める（多重モーダルは参照カウント） */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    lockCount += 1
    if (lockCount === 1) setLocked(true)
    return () => {
      lockCount -= 1
      if (lockCount === 0) setLocked(false)
    }
  }, [active])
}
