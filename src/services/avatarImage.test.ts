import { describe, expect, it, vi } from 'vitest'
import {
  avatarCropMetrics,
  avatarCropSourceRect,
  clampAvatarCrop,
  compressSquareImage,
  squareImageSourceIsValid,
  squareImageSourceSignature,
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

  it('renders a reflection upload into a 512 × 512 JPEG before persistence', async () => {
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage,
      }),
      toBlob: (callback: BlobCallback) => callback(new Blob(['image'], { type: 'image/jpeg' })),
    }
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
      tagName === 'canvas'
        ? canvas as unknown as HTMLCanvasElement
        : originalCreateElement(tagName)
    ))

    await compressSquareImage({} as HTMLImageElement, {
      viewportSize: 256,
      imageWidth: 800,
      imageHeight: 400,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    }, 512)

    expect(canvas.width).toBe(512)
    expect(canvas.height).toBe(512)
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      200, 0, 400, 400,
      0, 0, 512, 512,
    )
  })

  it('accepts uploaded images and safe remote image URLs', () => {
    expect(squareImageSourceIsValid({
      source: 'upload',
      url: '',
      existingUrl: '',
      existingSource: 'none',
      upload: new Blob(['image'], { type: 'image/jpeg' }),
    })).toBe(true)
    expect(squareImageSourceIsValid({
      source: 'url',
      url: 'https://images.example.test/card.jpg',
      existingUrl: '',
      existingSource: 'none',
    })).toBe(true)
    expect(squareImageSourceIsValid({
      source: 'url',
      url: 'javascript:alert(1)',
      existingUrl: '',
      existingSource: 'none',
    })).toBe(false)
    expect(squareImageSourceIsValid({
      source: 'library',
      url: '',
      existingUrl: '',
      existingSource: 'none',
      libraryImage: {
        id: 42,
        imageUrl: '/api/flashcard-images/cached.jpg',
        alt: '',
        photographer: '',
        photographerUrl: '',
        sourceUrl: 'https://www.pexels.com/photo/42/',
        licenseName: 'Pexels License',
        licenseUrl: 'https://www.pexels.com/license/',
      },
    })).toBe(true)
  })

  it('tracks a pending upload as a form change without serializing its bytes', () => {
    expect(squareImageSourceSignature({
      source: 'upload',
      url: '',
      existingUrl: '',
      existingSource: 'none',
      upload: new Blob(['image'], { type: 'image/jpeg' }),
    })).toContain('image/jpeg:5')
  })

  it('tracks the selected library image as a form change', () => {
    expect(squareImageSourceSignature({
      source: 'library',
      url: '',
      existingUrl: '',
      existingSource: 'none',
      libraryImage: {
        id: 42,
        imageUrl: '/api/flashcard-images/cached.jpg',
        alt: '',
        photographer: '',
        photographerUrl: '',
        sourceUrl: 'https://www.pexels.com/photo/42/',
        licenseName: 'Pexels License',
        licenseUrl: 'https://www.pexels.com/license/',
      },
    })).toContain('"libraryImage":42')
  })
})
