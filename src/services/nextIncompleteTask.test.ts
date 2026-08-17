import { describe, expect, it } from 'vitest'
import { bottomAlignedTaskScrollTop, nextIncompleteTaskKey } from '@/services/nextIncompleteTask'

const tasks = [
  { key: 'first', incomplete: true, top: 300, left: 100, bottom: 500 },
  { key: 'second', incomplete: true, top: 540, left: 100, bottom: 740 },
  { key: 'third', incomplete: true, top: 780, left: 100, bottom: 980 },
]

describe('nextIncompleteTaskKey', () => {
  it('suppresses the banner at the top when an incomplete task is visible', () => {
    expect(nextIncompleteTaskKey(tasks, 0, 600, true)).toBeUndefined()
  })

  it('returns the nearest incomplete task below the visible area', () => {
    expect(nextIncompleteTaskKey(tasks, 0, 520, false)).toBe('second')
  })

  it('advances when the current task bottom enters the visible area', () => {
    expect(nextIncompleteTaskKey(tasks, 0, 760, false)).toBe('third')
  })

  it('keeps the task current until its bottom gap clears the visible area', () => {
    expect(nextIncompleteTaskKey(tasks, 0, 760, false, 32)).toBe('second')
    expect(nextIncompleteTaskKey(tasks, 0, 773, false, 32)).toBe('third')
  })

  it('advances when the current task is flush with the bottom edge within one pixel', () => {
    expect(nextIncompleteTaskKey(tasks, 0, 771.25, false, 32)).toBe('third')
    expect(nextIncompleteTaskKey(tasks, 0, 770.75, false, 32)).toBe('second')
  })

  it('shows the first task at the top when its bottom is not visible', () => {
    expect(nextIncompleteTaskKey(tasks, 0, 450, true, 16)).toBe('first')
  })

  it('hides the banner when the user reaches the bottom of the page', () => {
    expect(nextIncompleteTaskKey(tasks, 0, 450, false, 16, true)).toBeUndefined()
  })

  it('ignores completed tasks and collapses after the last incomplete task', () => {
    const candidates = tasks.map(task => ({ ...task, incomplete: task.key === 'second' }))
    expect(nextIncompleteTaskKey(candidates, 0, 520, false)).toBe('second')
    expect(nextIncompleteTaskKey(candidates, 0, 760, false)).toBeUndefined()
  })

  it('uses horizontal position to keep same-row candidates in visual order', () => {
    const candidates = [
      { key: 'right', incomplete: true, top: 700, left: 500, bottom: 900 },
      { key: 'left', incomplete: true, top: 700, left: 100, bottom: 900 },
    ]
    expect(nextIncompleteTaskKey(candidates, 0, 600, false)).toBe('left')
  })
})

describe('bottomAlignedTaskScrollTop', () => {
  it('aligns the task bottom with the top of its bottom container', () => {
    expect(bottomAlignedTaskScrollTop(400, 900, 700)).toBe(600)
  })

  it('keeps the requested gap between the task bottom and its bottom container', () => {
    expect(bottomAlignedTaskScrollTop(400, 900, 700, 16)).toBe(616)
  })

  it('does not request a negative document scroll position', () => {
    expect(bottomAlignedTaskScrollTop(20, 300, 700)).toBe(0)
  })
})
