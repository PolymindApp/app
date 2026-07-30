export interface AccountMenuRect {
  top: number
  right: number
  bottom: number
}

export interface AccountMenuSize {
  width: number
  height: number
}

export interface AccountMenuViewport {
  width: number
  height: number
}

export function getAccountMenuPosition(
  activator: AccountMenuRect,
  menu: AccountMenuSize,
  viewport: AccountMenuViewport,
  offset = 8,
  margin = 12,
) {
  const maximumLeft = Math.max(margin, viewport.width - menu.width - margin)
  const left = Math.min(maximumLeft, Math.max(margin, activator.right - menu.width))
  const below = activator.bottom + offset
  const above = activator.top - menu.height - offset
  const maximumTop = Math.max(margin, viewport.height - menu.height - margin)
  const top = below + menu.height <= viewport.height - margin
    ? below
    : above >= margin
      ? above
      : Math.min(maximumTop, Math.max(margin, below))

  return { left, top }
}
