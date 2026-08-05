export const MAIN_NAV_ITEMS = [
  { id: 'tasks', title: 'Tasks', icon: 'mdi-clipboard-check-outline', to: '/tasks' },
  { id: 'intervals', title: 'Intervals', icon: 'mdi-timer-outline', to: '/intervals' },
  { id: 'flashcards', title: 'Flashcards', icon: 'mdi-cards-outline', to: '/flashcards' },
  { id: 'tracking', title: 'Tracking', icon: 'mdi-chart-timeline-variant', to: '/tracking' },
  { id: 'journal', title: 'Journal', icon: 'mdi-notebook-outline', to: '/journal' },
] as const

export type MainNavItem = typeof MAIN_NAV_ITEMS[number]
export type MainNavItemId = MainNavItem['id']

export const DEFAULT_MAIN_MENU_ORDER: MainNavItemId[] = MAIN_NAV_ITEMS.map(item => item.id)
export const MAIN_MENU_ORDER_CHANGED_EVENT = 'mom-main-menu-order-changed'

const mainNavIds = new Set<string>(DEFAULT_MAIN_MENU_ORDER)
const mainMenuOrderStorageKey = 'mom-main-menu-order'

export function bottomNavigationFontSize(itemCount: number) {
  const count = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0
  const extraItems = Math.max(0, count - 4)
  const size = Math.max(.56, .68 - extraItems * .18)
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
