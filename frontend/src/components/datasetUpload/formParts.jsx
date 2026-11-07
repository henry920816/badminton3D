import React from 'react'


export function Field({
  label,
  children,
}) {
  return (
    <label className="block">
      <div
        className="
          mb-1
          text-xs
          text-zinc-400
        "
      >
        {label}
      </div>

      {children}
    </label>
  )
}


export function MessageList({
  title,
  items,
  tone,
}) {
  if (!items?.length) {
    return null
  }

  const classes = (
    tone === 'error'
      ? (
          'border-red-700 '
          + 'bg-red-950/40 '
          + 'text-red-200'
        )
      : (
          'border-amber-700 '
          + 'bg-amber-950/30 '
          + 'text-amber-200'
        )
  )

  return (
    <div
      className={`
        rounded
        border
        p-3
        ${classes}
      `}
    >
      <div className="mb-1 font-semibold">
        {title}
      </div>

      {items.map(
        (
          item,
          index,
        ) => (
          <div
            key={`${index}-${item}`}
            className="text-xs leading-6"
          >
            • {item}
          </div>
        ),
      )}
    </div>
  )
}

