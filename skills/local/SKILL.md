---
name: default
description: Preserve and extend the BackOnTrack application's established UI direction. Use when designing, implementing, reviewing, or refining Vue and Vuetify views, components, navigation, cards, forms, dialogs, bottom sheets, transitions, responsive layouts, Android interactions, or other user-facing interface work in this repository.
---

# BackOnTrack UI Direction

## Data updates

- Always update immediately through optimistic local state, including when no occurrence exists yet. App is offline-first, always.

## Tests

- Only write tests for logic, not UI/UX.

## Start from the Existing System

- Inspect `src/plugins/vuetify.ts` and `src/styles/main.scss` before changing shared visual behavior.
- Inspect the nearest existing view and shared component before adding a new pattern.
- Reuse `AppShell`, `ActionBottomSheet`, `ConfirmDialog`, `DatePickerField`, `ColorSwatchPicker`, `LabeledSlider`, and other existing primitives when they fit.
- Extend shared components when the same interaction appears more than once.
- Keep the interface focused and utilitarian. Favor clear state, progress, and immediate actions over decoration.

## Visual Language

- Use the `forgeDark` Vuetify theme as the application baseline.
- Build with charcoal background and surface layers, subtle translucent borders, and the lime `secondary` color for active states, progress, and primary emphasis.
- Use Vuetify theme variables instead of duplicating theme hex values in component CSS.
- Reserve success, warning, error, and info colors for their semantic states.
- Use rounded, low-elevation surfaces. Follow the global `rounded="xl"` card and `rounded="lg"` control defaults.
- Apply the shared `surface-card` treatment to standard content cards. Do not add hover lift or vertical translation to cards.
- Use restrained shadows for separation, with stronger shadows only for floating navigation, dragged ghosts, or modal layers.
- Keep decorative geometry sparse. A low-opacity circular accent may support a major summary card, but it must not compete with content.

## Typography and Hierarchy

- Use Inter or the system sans-serif stack for body content and controls.
- Use the condensed uppercase `display-title` treatment only for strong display moments such as timers, scores, or major completion states.
- Use compact, heavy labels and concise copy. Prefer clear nouns and verbs over explanatory prose.
- Do not add eyebrow text above page titles.
- Use uppercase tracking for true section labels, badges, and compact status pills only.
- Keep secondary copy muted with the theme on-surface color at reduced opacity.

## Layout and Surfaces

- Use `.app-page` for standard pages so width, document scrolling, and safe-area spacing remain consistent.
- Keep primary content in a narrow single-column flow on mobile and use the existing 900px desktop maximum.
- Prefer Vuetify grid and spacing utilities. Keep horizontal page padding aligned to the existing 1rem rhythm.
- Group related controls inside surface cards rather than creating many nested panels.
- Use one or two columns only when the content remains readable and touch targets stay generous.
- Keep fixed action areas outside route-transition transforms by applying `page-action-area` where appropriate.

## Navigation and Overlays

- Preserve the fixed translucent app bar, mobile bottom navigation, and permanent desktop navigation drawer defined by `AppShell`.
- Keep the current main section active for nested management routes.
- Use `ActionBottomSheet` for mobile action menus and sheet-style choices; it provides the navigation-drawer behavior, drag handle, dismissal gesture, and native safe-area placement.
- Inject each feature's items into the shared bottom sheet instead of creating another sheet implementation.
- Use compact anchored menus only where the existing desktop pattern calls for one.
- Use `ConfirmDialog` for destructive or consequential actions.

## Controls and Feedback

- Use Vuetify components and the configured outlined, comfortable, rounded form defaults.
- Make primary actions lime and bold. Use tonal or outlined variants for secondary actions and text variants for low-emphasis actions.
- Use the shared `FormActionBar` for create and edit forms. Match the interval editor pattern: show an inline error-colored delete icon first on edit forms only, then Cancel, then a lime Create or Save action. Keep the bar above the mobile bottom navigation and native safe area, and aligned beside desktop navigation.
- Keep touch targets at least 2.75rem in both dimensions.
- Show progress directly with linear or circular indicators and pair it with a readable numeric value when useful.
- Make loading, empty, disabled, completed, missed, warning, and error states visually explicit.
- Keep form validation close to its field and disable primary actions when nothing valid has changed.
- Preserve monograms, icons, and task or interval colors as recognizable anchors; do not rely on color alone for meaning.

## Motion and Interaction

- Use quick transitions, generally 160–240ms. Use `cubic-bezier(.22, 1, .36, 1)` for entering or directional movement and ease for opacity.
- Match motion to navigation: horizontal for sibling destinations, vertical for depth changes, and slide-up for mobile sheets.
- Keep leaving route content pinned while the document scroll position resets so crossfades do not visibly jump.
- Do not scale timers or persistent values when their content changes.
- Honor `prefers-reduced-motion` and ensure state remains correct when transition duration is effectively zero.
- Support touch and pointer input equally. Stop both touch and click propagation for controls nested in tappable cards.
- Preserve long-press drag behavior, haptic activation, immediate drop targeting, auto-scroll, and animated insertion placeholders.
- Keep text selection disabled throughout the application.

## Mobile and Android

- Treat the native status and navigation bars as part of the layout. Use the established safe-area variables and never place app controls behind system UI.
- Hide browser scrollbars and overscroll bounce on Android while preserving document scrolling.
- Avoid autofocus on Android. Scroll a focused field into view without combining an immediate jump with smooth scrolling.
- Hide native system bars only for immersive landscape timer experiences, following the existing runner behavior.
- Test bottom navigation, bottom sheets, keyboards, portrait mode, and landscape mode independently after layout changes.

## Review Before Finishing

- Check both the smallest supported mobile width and desktop layout.
- Check dark-theme contrast, long labels, empty data, loading data, and disabled actions.
- Check touch behavior on nested buttons and menus.
- Check normal and reduced-motion behavior.
- Check Android safe areas with the software keyboard and native navigation bar visible.
