import {
  bottomNavigationFontSize,
  DEFAULT_MAIN_MENU_ORDER,
  mainMenuTransitionDirection,
  normalizeHiddenMainMenuItems,
  normalizeMainMenuOrder,
  orderedMainNavItems,
  readStoredHiddenMainMenuItems,
  readStoredMainMenuOrder,
  storeHiddenMainMenuItems,
  storeMainMenuOrder,
  visibleMainNavItems,
} from '@/services/navigation'

describe('main menu ordering', () => {
  afterEach(() => localStorage.clear())

  it('uses the default order when no setting exists', () => {
    expect(DEFAULT_MAIN_MENU_ORDER)
      .toEqual(['tasks', 'intervals', 'flashcards', 'tracking', 'journal'])
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

  it('filters hidden items without changing their configured order', () => {
    expect(visibleMainNavItems(
      ['journal', 'tracking', 'flashcards', 'tasks', 'intervals'],
      ['tracking', 'tasks'],
    ).map(item => item.id)).toEqual(['journal', 'flashcards', 'intervals'])
  })

  it('derives transition direction from the current visible menu order', () => {
    const defaultItems = visibleMainNavItems(DEFAULT_MAIN_MENU_ORDER, [])
    expect(mainMenuTransitionDirection(defaultItems, '/tasks', '/tracking')).toBe('forward')
    expect(mainMenuTransitionDirection(defaultItems, '/journal', '/intervals')).toBe('back')
    expect(mainMenuTransitionDirection(defaultItems, '/tracking/new', '/journal')).toBe('forward')

    const reorderedItems = visibleMainNavItems(
      ['journal', 'tracking', 'flashcards', 'intervals', 'tasks'],
      ['flashcards'],
    )
    expect(mainMenuTransitionDirection(reorderedItems, '/tracking', '/tasks')).toBe('forward')
    expect(mainMenuTransitionDirection(reorderedItems, '/tasks', '/tracking')).toBe('back')
  })

  it('leaves same-section and non-menu transitions to the route-depth fallback', () => {
    const items = visibleMainNavItems(DEFAULT_MAIN_MENU_ORDER, [])
    expect(mainMenuTransitionDirection(items, '/tracking', '/tracking/new')).toBeUndefined()
    expect(mainMenuTransitionDirection(items, '/settings', '/tasks')).toBeUndefined()
  })

  it('normalizes and persists hidden items while keeping one destination visible', () => {
    expect(normalizeHiddenMainMenuItems(['journal', 'unknown', 'journal']))
      .toEqual(['journal'])
    expect(normalizeHiddenMainMenuItems(DEFAULT_MAIN_MENU_ORDER)).not.toContain('tasks')

    storeHiddenMainMenuItems(['intervals', 'journal'])
    expect(readStoredHiddenMainMenuItems()).toEqual(['intervals', 'journal'])
  })

  it('reduces bottom navigation labels only when more than four items are visible', () => {
    expect(bottomNavigationFontSize(4)).toBe('0.68rem')
    expect(bottomNavigationFontSize(5)).toBe('0.64rem')
    expect(bottomNavigationFontSize(6)).toBe('0.60rem')
    expect(bottomNavigationFontSize(7)).toBe('0.56rem')
    expect(bottomNavigationFontSize(12)).toBe('0.56rem')
  })
})
