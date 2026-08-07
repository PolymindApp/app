export interface AvatarCrop {
  viewportSize: number
  imageWidth: number
  imageHeight: number
  zoom: number
  offsetX: number
  offsetY: number
}

export interface AvatarCropMetrics {
  scale: number
  renderedWidth: number
  renderedHeight: number
  maxOffsetX: number
  maxOffsetY: number
}

export function avatarCropMetrics(crop: AvatarCrop): AvatarCropMetrics {
  const viewportSize = Math.max(1, crop.viewportSize)
  const imageWidth = Math.max(1, crop.imageWidth)
  const imageHeight = Math.max(1, crop.imageHeight)
  const zoom = Math.max(1, crop.zoom)
  const scale = Math.max(viewportSize / imageWidth, viewportSize / imageHeight) * zoom
  const renderedWidth = imageWidth * scale
  const renderedHeight = imageHeight * scale
  return {
    scale,
    renderedWidth,
    renderedHeight,
    maxOffsetX: Math.max(0, (renderedWidth - viewportSize) / 2),
    maxOffsetY: Math.max(0, (renderedHeight - viewportSize) / 2),
  }
}

export function clampAvatarCrop(crop: AvatarCrop): AvatarCrop {
  const metrics = avatarCropMetrics(crop)
  return {
    ...crop,
    zoom: Math.max(1, crop.zoom),
    offsetX: clamp(crop.offsetX, -metrics.maxOffsetX, metrics.maxOffsetX),
    offsetY: clamp(crop.offsetY, -metrics.maxOffsetY, metrics.maxOffsetY),
  }
}

export function avatarCropSourceRect(crop: AvatarCrop) {
  const clamped = clampAvatarCrop(crop)
  const metrics = avatarCropMetrics(clamped)
  const size = clamped.viewportSize / metrics.scale
  return {
    x: ((metrics.renderedWidth - clamped.viewportSize) / 2 - clamped.offsetX) / metrics.scale,
    y: ((metrics.renderedHeight - clamped.viewportSize) / 2 - clamped.offsetY) / metrics.scale,
    size,
  }
}

export function compressAvatar(
  image: HTMLImageElement,
  crop: AvatarCrop,
  outputSize = 256,
) {
  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image compression is not supported on this device.')

  const source = avatarCropSourceRect(crop)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    source.x,
    source.y,
    source.size,
    source.size,
    0,
    0,
    outputSize,
    outputSize,
  )

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.type === 'image/jpeg') resolve(blob)
      else reject(new Error('The selected image could not be compressed.'))
    }, 'image/jpeg', .86)
  })
}

export const squareImageCropMetrics = avatarCropMetrics
export const clampSquareImageCrop = clampAvatarCrop
export const compressSquareImage = compressAvatar

export function squareImageSourceIsValid(value: SquareImageSourceValue) {
  if (value.source === 'none') return true
  if (value.source === 'upload') {
    return Boolean(value.upload || value.existingSource === 'upload')
  }
  if (value.source === 'library') {
    return Boolean(
      value.libraryImage?.id
      || (value.existingSource === 'library' && value.existingUrl),
    )
  }
  try {
    const url = new URL(value.url.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function squareImageSourceSignature(value: SquareImageSourceValue) {
  return JSON.stringify({
    source: value.source,
    url: value.source === 'url' ? value.url.trim() : '',
    upload: value.upload ? `${value.upload.type}:${value.upload.size}` : '',
    libraryImage: value.source === 'library' ? value.libraryImage?.id || 0 : 0,
  })
}

function clamp(value: number, minimum: number, maximum: number) {
  const result = Math.min(maximum, Math.max(minimum, value))
  return result === 0 ? 0 : result
}
import type { SquareImageSourceValue } from '@/types/domain'
