export const RUNNING_SESSION_TITLE_FRAMES = [
  '[.  ]',
  '[.. ]',
  '[...]',
  '[ ..]',
  '[  .]',
] as const

export const RUNNING_SESSION_TITLE_INTERVAL_MS = 500

export function formatRunningSessionTitle(
  baseTitle: string,
  frameIndex: number,
  reducedMotion = false,
) {
  const prefix = reducedMotion
    ? '[RUN]'
    : RUNNING_SESSION_TITLE_FRAMES[
      Math.abs(Math.trunc(frameIndex)) % RUNNING_SESSION_TITLE_FRAMES.length
    ]
  return `${prefix} ${baseTitle}`
}
