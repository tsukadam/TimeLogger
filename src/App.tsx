import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/** アクティブなタブボタンの位置へオレンジバーをスライドさせる */
function useTabIndicator(activeKey: string) {
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
  }, [activeKey])

  return { wrapRef, ind }
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
              <div className={scrollClass} onScroll={onScroll} data-scroll-lock>
                {mainTab === 'tasks' ? <TasksScreen /> : <ActivityScreen />}
              </div>
            </div>
          ) : (
            <div key="sub" className={paneClass}>
              <div className={scrollClass} onScroll={onScroll} data-scroll-lock>
                {route === 'log' && <LogScreen />}
                {route === 'settings' && <SettingsScreen />}
              </div>
            </div>
          )}
        </main>
      </div>
    </StoreProvider>
  )
}
