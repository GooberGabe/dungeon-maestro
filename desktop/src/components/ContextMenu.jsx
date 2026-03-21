function ContextMenu({ menu, onClose }) {
  if (!menu || !Array.isArray(menu.items) || menu.items.length === 0) {
    return null
  }

  const estimatedHeight = (menu.items.length * 42) + 16
  const maxWidth = 220
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - maxWidth - 8))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - estimatedHeight - 8))

  return (
    <>
      <button className="context-menu-backdrop" type="button" aria-label="Close menu" onClick={onClose} />
      <div className="context-menu" style={{ left, top }} role="menu" onClick={(event) => event.stopPropagation()}>
        {menu.items.map((item) => (
          <button
            key={item.id}
            className={`context-menu-item${item.danger ? ' danger' : ''}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}

export default ContextMenu