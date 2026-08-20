import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'

export interface SeoMetadata {
  title: string
  description: string
  robots?: 'index, follow' | 'noindex, nofollow'
}

const SITE_NAME = 'BackOnTrack'
const SITE_ORIGIN = 'https://backontrack.app'
const SOCIAL_IMAGE_PATH = '/images/backontrack-og.jpg'
const SOCIAL_IMAGE_ALT = 'A runner wearing headphones uses BackOnTrack flashcards and interval training to build his way forward.'

function setMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)

  if (!element) {
    element = document.createElement('meta')
    document.head.append(element)
  }

  Object.entries(attributes).forEach(([name, value]) => element?.setAttribute(name, value))
}

function setCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')

  if (!element) {
    element = document.createElement('link')
    element.rel = 'canonical'
    document.head.append(element)
  }

  element.href = href
}

function removeMeta(selector: string) {
  document.head.querySelector(selector)?.remove()
}

function clearPublicMetadata(route: RouteLocationNormalizedLoaded) {
  const routeTitle = typeof route.meta.title === 'string' ? `${route.meta.title} | ${SITE_NAME}` : SITE_NAME
  const publicMetaSelectors = [
    'meta[name="description"]',
    'meta[property="og:title"]',
    'meta[property="og:description"]',
    'meta[property="og:url"]',
    'meta[property="og:image"]',
    'meta[property="og:image:type"]',
    'meta[property="og:image:width"]',
    'meta[property="og:image:height"]',
    'meta[property="og:image:alt"]',
    'meta[name="twitter:title"]',
    'meta[name="twitter:description"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:alt"]',
  ]

  document.title = routeTitle
  document.head.querySelector('link[rel="canonical"]')?.remove()
  setMeta('meta[name="robots"]', { name: 'robots', content: 'noindex, nofollow' })
  publicMetaSelectors.forEach(removeMeta)
}

function applySeoMetadata(route: RouteLocationNormalizedLoaded) {
  const seo = route.meta.seo as SeoMetadata | undefined
  if (!seo) {
    clearPublicMetadata(route)
    return
  }

  const canonicalUrl = new URL(route.path, SITE_ORIGIN).href
  const socialImageUrl = new URL(SOCIAL_IMAGE_PATH, SITE_ORIGIN).href

  document.title = seo.title
  setCanonical(canonicalUrl)
  setMeta('meta[name="description"]', { name: 'description', content: seo.description })
  setMeta('meta[name="robots"]', { name: 'robots', content: seo.robots || 'index, follow' })
  setMeta('meta[property="og:title"]', { property: 'og:title', content: seo.title })
  setMeta('meta[property="og:description"]', { property: 'og:description', content: seo.description })
  setMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl })
  setMeta('meta[property="og:image"]', { property: 'og:image', content: socialImageUrl })
  setMeta('meta[property="og:image:type"]', { property: 'og:image:type', content: 'image/jpeg' })
  setMeta('meta[property="og:image:width"]', { property: 'og:image:width', content: '1200' })
  setMeta('meta[property="og:image:height"]', { property: 'og:image:height', content: '630' })
  setMeta('meta[property="og:image:alt"]', { property: 'og:image:alt', content: SOCIAL_IMAGE_ALT })
  setMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: seo.title })
  setMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: seo.description })
  setMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: socialImageUrl })
  setMeta('meta[name="twitter:image:alt"]', { name: 'twitter:image:alt', content: SOCIAL_IMAGE_ALT })
}

export function installSeoMetadata(router: Router) {
  router.afterEach((route) => applySeoMetadata(route))
}
