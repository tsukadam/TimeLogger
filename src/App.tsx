import { useCallback, useEffect, useRef, useState } from 'react'
import { useTabIndicator } from './lib/useTabIndicator'
import { StoreProvider } from './state/Store'
import { ActivityScreen } from './screens/ActivityScreen'
import { LogScreen } from './screens/LogScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TasksScreen } from './screens/TasksScreen'
import styles from './App.module.css'

type MainTab = 'tasks' | 'activity'
type Route = 'main' | 'log' | 'settings'

function useFadeScrollbar() {
  const [scrolling, setScrolling] = useState(false)
  const timer = useRef<number | null>(null)

  const onScroll = useCallback(() => {
    setScrolling(true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setScrolling(false)
      timer.current = null
    }, 700)
  }, [])

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  return { scrolling, onScroll }
}

// プルトゥリフレッシュ: この距離まで引っ張って離すとリロード
const PTR_THRESHOLD = 70
const PTR_MAX = 110

/**
 * スマホ用プルトゥリフレッシュ付きスクロールコンテナ。
 * 上端でさらに下へ引っ張り、しきい値を超えて離すとページ全体をリロードする
 * （データ再取得に加えて SW 更新も拾える）。マウス操作には反応しない。
 */
function RefreshableScroll({
  className,
  onScroll,
  children,
}: {
  className: string
  onScroll: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const pullRef = useRef(0)
  const refreshingRef = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let startY = 0
    let pulling = false

    const set = (v: number) => {
      pullRef.current = v
      setPull(v)
    }
    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current || el.scrollTop > 0) return
      startY = e.touches[0]!.clientY
      pulling = true
      setDragging(true)
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!pulling || refreshingRef.current) return
      if (el.scrollTop > 0) {
        // 通常スクロールに移ったら今回のタッチでは発動しない
        pulling = false
        setDragging(false)
        if (pullRef.current !== 0) set(0)
        return
      }
      const dy = e.touches[0]!.clientY - startY
      if (dy <= 0) {
        if (pullRef.current !== 0) set(0)
        return
      }
      // ラバーバンドの代わりに自前のインジケーターを出す
      e.preventDefault()
      set(Math.min(PTR_MAX, dy * 0.45))
    }
    const onTouchEnd = () => {
      if (!pulling) return
      pulling = false
      setDragging(false)
      if (pullRef.current >= PTR_THRESHOLD) {
        refreshingRef.current = true
        setRefreshing(true)
        window.location.reload()
      } else {
        set(0)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  const armed = pull >= PTR_THRESHOLD
  const visible = refreshing || pull > 10
  return (
    <div className={styles.scrollWrap}>
      {visible && (
        <div
          className={dragging ? styles.ptr : `${styles.ptr} ${styles.ptrEase}`}
          style={{
            transform: `translate(-50%, ${Math.min(pull, PTR_MAX) * 0.5}px)`,
            opacity: refreshing ? 1 : Math.min(1, pull / PTR_THRESHOLD),
          }}
          aria-hidden
        >
          {refreshing ? '更新中…' : armed ? '離して更新' : '↓ 引っ張って更新'}
        </div>
      )}
      <div ref={ref} className={className} onScroll={onScroll} data-scroll-lock>
        {children}
      </div>
    </div>
  )
}

export default function App() {
  const [route, setRoute] = useState<Route>('main')
  const [mainTab, setMainTab] = useState<MainTab>('tasks')
  // 画面遷移の向き（Log へ = カメラ右パン / 戻る = 左パン）
  const [navDir, setNavDir] = useState<'toLog' | 'toMain' | null>(null)
  const { scrolling, onScroll } = useFadeScrollbar()
  const { wrapRef: tabsRef, ind } = useTabIndicator(mainTab)

  const scrollClass = scrolling
    ? `${styles.scroll} ${styles.scrollActive}`
    : styles.scroll

  const paneClass = [
    styles.routePane,
    navDir === 'toLog' ? styles.enterFromRight : '',
    navDir === 'toMain' ? styles.enterFromLeft : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <StoreProvider>
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.brand}>TimeLogger</div>
          <nav className={styles.nav}>
            {route === 'main' ? (
              <button
                type="button"
                onClick={() => {
                  setNavDir('toLog')
                  setRoute('log')
                }}
              >
                Log
              </button>
            ) : (
              <button
                type="button"
                aria-label="戻る"
                onClick={() => {
                  setNavDir('toMain')
                  setRoute('main')
                }}
              >
                ←
              </button>
            )}
          </nav>
        </header>

        <main className={styles.main}>
          {route === 'main' ? (
            <div key="main" className={paneClass}>
              <div className={styles.tabs} ref={tabsRef}>
                <button
                  type="button"
                  data-tab="tasks"
                  data-text="Tasks"
                  className={mainTab === 'tasks' ? styles.active : undefined}
                  onClick={() => setMainTab('tasks')}
                >
                  Tasks
                </button>
                <button
                  type="button"
                  data-tab="activity"
                  data-text="Activity"
                  className={mainTab === 'activity' ? styles.active : undefined}
                  onClick={() => setMainTab('activity')}
                >
                  Activity
                </button>
                {ind && (
                  <span
                    className={styles.tabInd}
                    style={{ left: ind.left, width: ind.width }}
                    aria-hidden
                  />
                )}
              </div>
              <RefreshableScroll className={scrollClass} onScroll={onScroll}>
                {mainTab === 'tasks' ? <TasksScreen /> : <ActivityScreen />}
              </RefreshableScroll>
            </div>
          ) : (
            <div key="sub" className={paneClass}>
              <RefreshableScroll className={scrollClass} onScroll={onScroll}>
                {route === 'log' && <LogScreen />}
                {route === 'settings' && <SettingsScreen />}
              </RefreshableScroll>
            </div>
          )}
        </main>
      </div>
    </StoreProvider>
  )
}
