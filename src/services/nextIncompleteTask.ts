const VISIBILITY_EDGE_TOLERANCE = 1

export function nextIncompleteTaskKey(
  candidates: ReadonlyArray<{
    key: string
    incomplete: boolean
    top: number
    left: number
    bottom: number
  }>,
  visibleTop: number,
  visibleBottom: number,
  atPageTop: boolean,
  bottomGap = 0,
  atPageBottom = false,
) {
  if (atPageBottom) return undefined

  const incompleteCandidates = candidates
    .filter(candidate => candidate.incomplete)
    .sort((left, right) => left.top - right.top || left.left - right.left)
  const firstIncompleteTask = incompleteCandidates[0]
  const firstIncompleteTaskIsVisible = firstIncompleteTask
    && firstIncompleteTask.bottom > visibleTop
    && firstIncompleteTask.bottom + bottomGap <= visibleBottom + VISIBILITY_EDGE_TOLERANCE

  if (atPageTop && firstIncompleteTaskIsVisible) return undefined

  return incompleteCandidates
    .find(candidate => (
      candidate.bottom > visibleTop
      && candidate.bottom + bottomGap > visibleBottom + VISIBILITY_EDGE_TOLERANCE
    ))
    ?.key
}

export function bottomAlignedTaskScrollTop(
  currentScrollTop: number,
  taskBottom: number,
  containerBottom: number,
  bottomGap = 0,
) {
  return Math.max(0, currentScrollTop + taskBottom + bottomGap - containerBottom)
}
