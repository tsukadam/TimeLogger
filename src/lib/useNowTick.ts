import { useEffect, useState } from 'react'

/**
 * active の間だけ intervalMs ごとに現在時刻（ms）を更新して返す。
 * 記録中の経過時間表示など「動いている時だけ再レンダーしたい」用途。
 */
export function useNowTick(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [active, intervalMs])
  return now
}
