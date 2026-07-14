import { useEffect, useId, useRef, useState } from 'react'
import { FolderIcon } from './FolderIcon'
import type { Folder } from '../types'
import styles from './FolderSelect.module.css'

export function FolderSelect({
  folders,
  value,
  onChange,
  disabled,
}: {
  folders: Folder[]
  value: string
  onChange: (folderId: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const selected = folders.find((f) => f.id === value) ?? folders[0] ?? null

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        disabled={disabled || !selected}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        {selected && (
          <>
            <FolderIcon color={selected.color} size={14} />
            <span className={styles.name}>{selected.name}</span>
          </>
        )}
        <span className={styles.chevron} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className={styles.list} role="listbox" id={listId}>
          {folders.map((f) => (
            <li key={f.id} role="option" aria-selected={f.id === value}>
              <button
                type="button"
                className={f.id === value ? styles.optionActive : styles.option}
                onClick={() => {
                  onChange(f.id)
                  setOpen(false)
                }}
              >
                <FolderIcon color={f.color} size={14} />
                <span className={styles.name}>{f.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
