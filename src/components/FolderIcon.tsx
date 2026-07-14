/** シンプルなフォルダ記号（fill でテーマ色を付ける） */
export function FolderIcon({
  color,
  size = 14,
  className,
}: {
  color: string
  size?: number
  className?: string
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        fill={color}
        d="M3.5 6.75A2.25 2.25 0 0 1 5.75 4.5h4.02c.4 0 .78.16 1.06.44l1.23 1.23c.18.18.43.28.68.28h5.51A2.25 2.25 0 0 1 20.5 8.7v8.55A2.25 2.25 0 0 1 18.25 19.5H5.75A2.25 2.25 0 0 1 3.5 17.25V6.75Z"
      />
    </svg>
  )
}
