import styles from './Placeholder.module.css'

export function LogScreen() {
  return (
    <section className={styles.panel}>
      <h1 className={styles.title}>Log</h1>
      <p className={styles.note}>
        Dashboard。期間選択・総時間・個別グラフ・円グラフ（タスク／フォルダ）。
      </p>
    </section>
  )
}
