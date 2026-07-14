import { useCallback, useEffect, useRef, useState } from 'react'
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

export default function App() {
  const [route, setRoute] = useState<Route>('main')
  const [mainTab, setMainTab] = useState<MainTab>('tasks')
  const { scrolling, onScroll } = useFadeScrollbar()

  const scrollClass = scrolling
    ? `${styles.scroll} ${styles.scrollActive}`
    : styles.scroll

  return (
    <StoreProvider>
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.brand}>TimeLogger</div>
          <nav className={styles.nav}>
            {route === 'main' ? (
              <>
                <button type="button" onClick={() => setRoute('log')}>
                  Log
                </button>
                <button type="button" onClick={() => setRoute('settings')}>
                  Setting
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setRoute('main')}>
                Back
              </button>
            )}
          </nav>
        </header>

        <main className={styles.main}>
          {route === 'main' ? (
            <>
              <div className={styles.tabs}>
                <button
                  type="button"
                  className={mainTab === 'tasks' ? styles.active : undefined}
                  onClick={() => setMainTab('tasks')}
                >
                  Tasks
                </button>
                <button
                  type="button"
                  className={mainTab === 'activity' ? styles.active : undefined}
                  onClick={() => setMainTab('activity')}
                >
                  Activity
                </button>
              </div>
              <div className={scrollClass} onScroll={onScroll}>
                {mainTab === 'tasks' ? <TasksScreen /> : <ActivityScreen />}
              </div>
            </>
          ) : (
            <div className={scrollClass} onScroll={onScroll}>
              {route === 'log' && <LogScreen />}
              {route === 'settings' && <SettingsScreen />}
            </div>
          )}
        </main>
      </div>
    </StoreProvider>
  )
}
