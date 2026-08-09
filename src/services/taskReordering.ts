import type { LongPressDragResult } from '@/directives/longPressDrag'
import type { TaskProgress } from '@/types/domain'

export function taskProgressDragKey(progress: TaskProgress) {
  return `${progress.task.id}:${progress.programStep?.id || ''}`
}

export function taskIdsFromProgressDrag(
  result: Pick<LongPressDragResult, 'id' | 'orderedIds'>,
  progressItems: TaskProgress[],
) {
  const progressByKey = new Map(
    progressItems.map(progress => [taskProgressDragKey(progress), progress]),
  )
  const draggedTaskId = progressByKey.get(result.id)?.task.id
  const orderedTaskIds: string[] = []

  result.orderedIds.forEach((key) => {
    const taskId = progressByKey.get(key)?.task.id
    if (!taskId) return
    if (taskId === draggedTaskId && key !== result.id) return
    if (!orderedTaskIds.includes(taskId)) orderedTaskIds.push(taskId)
  })

  return orderedTaskIds
}
