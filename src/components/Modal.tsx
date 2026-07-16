import {
  useCallback,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useScrollLock } from '../lib/useScrollLock'
import styles from './Modal.module.css'

/** 閉じアニメ（CSS sheetOut / backdropOut）と揃える */
export const MODAL_CLOSE_MS = 160

type ModalApi = {
  requestClose: () => void
}

type ModalProps = {
  open: boolean
  /** 閉じアニメ完了後に呼ばれる（シート state のクリアなど） */
  onClose: () => void
  'aria-label': string
  children: ReactNode | ((api: ModalApi) => ReactNode)
  /** Tasks 用の広めシート（520px）。既定は 420px */
  wide?: boolean
}

/**
 * createPortal + backdrop + sheet + 開閉アニメ + scroll lock の共通骨格。
 * Log の期間ピッカーは位置固定などが特殊なので対象外。
 */
export function Modal({
  open,
  onClose,
  'aria-label': ariaLabel,
  children,
  wide = false,
}: ModalProps) {
  const [closing, setClosing] = useState(false)
  useScrollLock(open || closing)

  const requestClose = useCallback(() => {
    if (closing || !open) return
    setClosing(true)
    window.setTimeout(() => {
      setClosing(false)
      onClose()
    }, MODAL_CLOSE_MS)
  }, [closing, open, onClose])

  if (!open && !closing) return null

  const body =
    typeof children === 'function' ? children({ requestClose }) : children

  return createPortal(
    <div
      className={
        closing ? `${styles.modalRoot} ${styles.modalClosing}` : styles.modalRoot
      }
    >
      <button
        type="button"
        className={styles.modalBackdrop}
        aria-label="閉じる"
        onClick={requestClose}
      />
      <div
        className={wide ? `${styles.sheet} ${styles.sheetWide}` : styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {body}
      </div>
    </div>,
    document.body,
  )
}
