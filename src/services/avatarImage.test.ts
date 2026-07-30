import { describe, expect, it } from 'vitest'
import {
  avatarCropMetrics,
  avatarCropSourceRect,
  clampAvatarCrop,
} from './avatarImage'

describe('avatar cropping', () => {
  it('center-crops a wide image into a square', () => {
    const crop = {
      viewportSize: 256,
      imageWidth: 800,
      imageHeight: 400,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    }

    expect(avatarCropSourceRect(crop)).toEqual({
      x: 200,
      y: 0,
      size: 400,
    })
  })

  it('clamps movement so the crop remains covered', () => {
    const crop = clampAvatarCrop({
      viewportSize: 256,
      imageWidth: 800,
      imageHeight: 400,
      zoom: 1,
      offsetX: 999,
      offsetY: -999,
    })

    expect(crop.offsetX).toBe(128)
    expect(crop.offsetY).toBe(0)
  })

  it('allows additional movement after zooming in', () => {
    const normal = avatarCropMetrics({
      viewportSize: 256,
      imageWidth: 400,
      imageHeight: 400,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    })
    const zoomed = avatarCropMetrics({
      viewportSize: 256,
      imageWidth: 400,
      imageHeight: 400,
      zoom: 2,
      offsetX: 0,
      offsetY: 0,
    })

    expect(normal.maxOffsetX).toBe(0)
    expect(zoomed.maxOffsetX).toBe(128)
  })
})
