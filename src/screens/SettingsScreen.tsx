import styles from './Placeholder.module.css'

export function SettingsScreen() {
  return (
    <section className={styles.panel}>
      <h1 className={styles.title}>Setting</h1>
      <p className={styles.note}>未定（settings.json は空で保持）。</p>
    </section>
  )
}
