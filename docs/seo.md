# Public page metadata

BackOnTrack's unauthenticated web routes define their search and social metadata in `src/router/index.ts`. `src/services/seo.ts` applies the active route's title, description, canonical URL, robots directive, Open Graph fields, and Twitter Card fields after navigation.

The landing page is indexable. Authentication, password recovery, password reset, and email confirmation routes use `noindex, nofollow` because they are utility flows rather than search destinations. Canonical URLs never include query strings, which keeps reset and verification tokens out of page metadata.

All public routes share `public/images/backontrack-og.jpg`, a 1200 by 630 pixel JPEG. `index.html` contains the landing-page metadata as the crawler and no-JavaScript fallback.

Development builds created with `vite build --mode dev` emit a `robots.txt` that disallows every crawler from every route. Production builds do not emit this development-only file.
