import { useLayoutEffect, useRef, useState } from 'react'

/** アクティブなタブボタンの位置へインジケータをスライドさせる */
export function useTabIndicator(activeKey: string, extraDeps: unknown[] = []) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const measure = () => {
      const el = wrapRef.current?.querySelector<HTMLElement>(
        `button[data-tab="${activeKey}"]`,
      )
      if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- extraDeps は呼び出し側が明示
  }, [activeKey, ...extraDeps])

  return { wrapRef, ind }
}
