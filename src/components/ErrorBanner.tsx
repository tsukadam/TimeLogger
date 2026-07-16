import chrome from './screenChrome.module.css'

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  return (
    <div className={chrome.error} role="alert">
      <span>{message}</span>
      <button type="button" onClick={onDismiss}>
        閉じる
      </button>
    </div>
  )
}
