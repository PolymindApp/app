import { describe, expect, it } from 'vitest'
import { getAccountMenuPosition } from './accountMenuPosition'

describe('account menu position', () => {
  it('aligns the menu with the right edge of its activator', () => {
    expect(getAccountMenuPosition(
      { top: 16, right: 788, bottom: 60 },
      { width: 240, height: 154 },
      { width: 800, height: 600 },
    )).toEqual({ left: 548, top: 68 })
  })

  it('keeps the menu inside a narrow viewport', () => {
    expect(getAccountMenuPosition(
      { top: 16, right: 348, bottom: 60 },
      { width: 340, height: 154 },
      { width: 360, height: 600 },
    )).toEqual({ left: 12, top: 68 })
  })

  it('places the menu above the activator when there is not enough room below', () => {
    expect(getAccountMenuPosition(
      { top: 520, right: 788, bottom: 564 },
      { width: 240, height: 180 },
      { width: 800, height: 600 },
    )).toEqual({ left: 548, top: 332 })
  })
})
