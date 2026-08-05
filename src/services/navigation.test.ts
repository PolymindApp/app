import {
  DEFAULT_MAIN_MENU_ORDER,
  normalizeMainMenuOrder,
  orderedMainNavItems,
  readStoredMainMenuOrder,
  storeMainMenuOrder,
} from '@/services/navigation'

describe('main menu ordering', () => {
  afterEach(() => localStorage.clear())

  it('uses the default order when no setting exists', () => {
    expect(normalizeMainMenuOrder(undefined)).toEqual(DEFAULT_MAIN_MENU_ORDER)
  })

  it('preserves valid saved ordering', () => {
    const order = ['journal', 'tracking', 'tasks', 'intervals']

    expect(normalizeMainMenuOrder(order)).toEqual(order)
    expect(orderedMainNavItems(order).map(item => item.title))
      .toEqual(['Journal', 'Tracking', 'Tasks', 'Intervals'])
  })

  it('removes unknown and duplicate values and restores missing items', () => {
    expect(normalizeMainMenuOrder(['tracking', 'unknown', 'tracking', 'tasks']))
      .toEqual(['tracking', 'tasks', 'intervals', 'journal'])
  })

  it('persists a normalized device-local order', () => {
    storeMainMenuOrder(['journal', 'tasks', 'intervals', 'tracking'])

    expect(readStoredMainMenuOrder())
      .toEqual(['journal', 'tasks', 'intervals', 'tracking'])
  })
})
