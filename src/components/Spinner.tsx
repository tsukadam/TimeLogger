import styles from './Spinner.module.css'

/** 通信待ち用のくるくる。既定は白。 */
export function Spinner({
  size = 16,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <span
      className={className ? `${styles.spinner} ${className}` : styles.spinner}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 8)) }}
      aria-hidden
    />
  )
}
