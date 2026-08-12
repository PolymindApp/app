export const MAIN_NAV_ITEMS = [
  { id: 'tasks', title: 'Tasks', icon: 'mdi-clipboard-check-outline', to: '/tasks' },
  { id: 'intervals', title: 'Intervals', icon: 'mdi-timer-outline', to: '/intervals' },
  { id: 'flashcards', title: 'Flashcards', icon: 'mdi-cards-outline', to: '/flashcards' },
  { id: 'tracking', title: 'Tracking', icon: 'mdi-chart-timeline-variant', to: '/tracking' },
  { id: 'journal', title: 'Journal', icon: 'mdi-notebook-outline', to: '/journal' },
] as const

export type MainNavItem = typeof MAIN_NAV_ITEMS[number]
export type MainNavItemId = MainNavItem['id']
export type MainMenuTransitionDirection = 'forward' | 'back'

export const DEFAULT_MAIN_MENU_ORDER: MainNavItemId[] = MAIN_NAV_ITEMS.map(item => item.id)
export const MAIN_MENU_ORDER_CHANGED_EVENT = 'polymind-main-menu-order-changed'
export const MAIN_MENU_VISIBILITY_CHANGED_EVENT = 'polymind-main-menu-visibility-changed'

const mainNavIds = new Set<string>(DEFAULT_MAIN_MENU_ORDER)
const mainMenuOrderStorageKey = 'polymind-main-menu-order'
const mainMenuHiddenStorageKey = 'polymind-main-menu-hidden'

export function bottomNavigationFontSize(itemCount: number) {
  const count = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0
  const extraItems = Math.max(0, count - 4)
  const size = Math.max(.56, .68 - extraItems * .04)
  return `${size.toFixed(2)}rem`
}

export function normalizeMainMenuOrder(value: unknown): MainNavItemId[] {
  const orderedIds: MainNavItemId[] = []
  if (Array.isArray(value)) {
    for (const id of value) {
      if (
        typeof id === 'string'
        && mainNavIds.has(id)
        && !orderedIds.includes(id as MainNavItemId)
      ) {
        orderedIds.push(id as MainNavItemId)
      }
    }
  }
  for (const id of DEFAULT_MAIN_MENU_ORDER) {
    if (!orderedIds.includes(id)) orderedIds.push(id)
  }
  return orderedIds
}

export function orderedMainNavItems(value: unknown): MainNavItem[] {
  const byId = new Map(MAIN_NAV_ITEMS.map(item => [item.id, item]))
  return normalizeMainMenuOrder(value)
    .map(id => byId.get(id))
    .filter((item): item is MainNavItem => Boolean(item))
}

export function normalizeHiddenMainMenuItems(value: unknown): MainNavItemId[] {
  const hidden = new Set<MainNavItemId>()
  if (Array.isArray(value)) {
    for (const id of value) {
      if (typeof id === 'string' && mainNavIds.has(id)) {
        hidden.add(id as MainNavItemId)
      }
    }
  }

  // Keep the primary Tasks destination available if stored data is malformed.
  if (hidden.size === DEFAULT_MAIN_MENU_ORDER.length) hidden.delete('tasks')
  return DEFAULT_MAIN_MENU_ORDER.filter(id => hidden.has(id))
}

export function visibleMainNavItems(order: unknown, hidden: unknown): MainNavItem[] {
  const hiddenIds = new Set(normalizeHiddenMainMenuItems(hidden))
  return orderedMainNavItems(order).filter(item => !hiddenIds.has(item.id))
}

export function mainMenuTransitionDirection(
  items: readonly Pick<MainNavItem, 'to'>[],
  fromPath: string,
  toPath: string,
): MainMenuTransitionDirection | undefined {
  const itemIndex = (path: string) => items.findIndex(item =>
    path === item.to || path.startsWith(`${item.to}/`),
  )
  const fromIndex = itemIndex(fromPath)
  const toIndex = itemIndex(toPath)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return undefined
  return toIndex > fromIndex ? 'forward' : 'back'
}

export function readStoredMainMenuOrder(): MainNavItemId[] | undefined {
  if (typeof localStorage === 'undefined') return undefined
  const storedValue = localStorage.getItem(mainMenuOrderStorageKey)
  if (storedValue === null) return undefined
  try {
    return normalizeMainMenuOrder(JSON.parse(storedValue))
  } catch {
    return undefined
  }
}

export function storeMainMenuOrder(value: unknown): MainNavItemId[] {
  const order = normalizeMainMenuOrder(value)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(mainMenuOrderStorageKey, JSON.stringify(order))
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MAIN_MENU_ORDER_CHANGED_EVENT))
  }
  return order
}

export function readStoredHiddenMainMenuItems(): MainNavItemId[] | undefined {
  if (typeof localStorage === 'undefined') return undefined
  const storedValue = localStorage.getItem(mainMenuHiddenStorageKey)
  if (storedValue === null) return undefined
  try {
    return normalizeHiddenMainMenuItems(JSON.parse(storedValue))
  } catch {
    return undefined
  }
}

export function storeHiddenMainMenuItems(value: unknown): MainNavItemId[] {
  const hidden = normalizeHiddenMainMenuItems(value)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(mainMenuHiddenStorageKey, JSON.stringify(hidden))
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MAIN_MENU_VISIBILITY_CHANGED_EVENT))
  }
  return hidden
}
