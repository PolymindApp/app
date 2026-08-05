import {
  bottomNavigationFontSize,
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
    expect(orderedMainNavItems(undefined).find(item => item.id === 'tasks')?.icon)
      .toBe('mdi-clipboard-check-outline')
  })

  it('preserves valid saved ordering', () => {
    const order = ['journal', 'tracking', 'flashcards', 'tasks', 'intervals']

    expect(normalizeMainMenuOrder(order)).toEqual(order)
    expect(orderedMainNavItems(order).map(item => item.title))
      .toEqual(['Journal', 'Tracking', 'Flashcards', 'Tasks', 'Intervals'])
  })

  it('removes unknown and duplicate values and restores missing items', () => {
    expect(normalizeMainMenuOrder(['tracking', 'unknown', 'tracking', 'tasks']))
      .toEqual(['tracking', 'tasks', 'intervals', 'flashcards', 'journal'])
  })

  it('persists a normalized device-local order', () => {
    storeMainMenuOrder(['journal', 'tasks', 'intervals', 'tracking', 'flashcards'])

    expect(readStoredMainMenuOrder())
      .toEqual(['journal', 'tasks', 'intervals', 'tracking', 'flashcards'])
  })

  it('reduces bottom navigation labels only when more than four items are visible', () => {
    expect(bottomNavigationFontSize(4)).toBe('0.68rem')
    expect(bottomNavigationFontSize(5)).toBe('0.64rem')
    expect(bottomNavigationFontSize(6)).toBe('0.60rem')
    expect(bottomNavigationFontSize(7)).toBe('0.56rem')
    expect(bottomNavigationFontSize(12)).toBe('0.56rem')
  })
})
