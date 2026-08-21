# Flashcards

## Recent session history

Recent reviews are grouped by day, with every group collapsed by default.

Selecting a recent Review opens its action menu. **See details** reopens the saved completion summary; **Delete** asks for confirmation and removes the history item immediately. Reviews recorded inside an Interval open that Interval's details, and deleting one removes the shared Interval run from both histories. Deleting session history does not reverse task progress already recorded by the completed session.

## CSV import

Cards include an optional transliteration alongside the front, back, note, and tags. The transliteration is editable on card forms, searchable, and shown as its own column in the card manager and Review set card table.

The card importer shows an example with the `front,back,transliteration,note,tags` header and sample rows. Copy example places the displayed CSV directly on the clipboard so it can be used as a starting template. Front and back are required, while transliteration, notes, and tags are optional; imported Review set cards inherit the destination set's tags.

## Bulk column swaps

The card manager and owned Review set card table expose one **Swap column content** bulk action. Its modal can swap any two of Front, Back, Transliteration, and Note across the selected cards. Apply stays disabled when the result would leave a required face empty or move content beyond the destination column's length limit. Repeating the same swap restores the original content.

## Runner settings

Active Interval settings include the same Review cards section as the Interval form, so a Review set can be attached, replaced, or removed during a run. The Apply to menu in active Interval and Review set settings offers Current session, the saved Interval or Review set, and Both. Choosing Both updates the saved source and the active session snapshot so the current run reflects the new settings immediately.

## Standalone review time limits

Passive Review sets finish after a configured amount of active review time. The limit is enabled at one hour by default when Passive mode is selected and can be disabled. The Review set and active-session settings use an hours-and-minutes wheel, with limits from one minute through 23 hours 59 minutes. Paused time does not count. Reaching the limit completes the session even when cards remain, including looping reviews, and Android background playback stops at the same limit. Manual Review sets do not use a time limit. Mini Review sets inside Interval sessions continue to follow the Interval step duration instead.

## Review card ejection

Each Review set has two independent eject-button settings. With both settings cleared, eject permanently removes the current card from the active list and completes a standalone review after its last active card is ejected.

The **Load the next card** behavior is enabled by default for new Review sets. It keeps the active list filled up to the configured maximum by injecting the next ordered, matching card whenever one is ejected. For example, a 50-card Review set with a 10-card session limit keeps 10 cards active while reserve cards remain, then drains the final 10 and completes after all 50 cards have been ejected. The ordered reserve is snapshotted when standalone and mini interval sessions start, so the behavior remains deterministic and available offline.

The optional **Exclude card** behavior also adds the ejected card to the Review set's excluded cards, preventing it from appearing in future sessions. Undoing the last eject in a standalone review restores the card to the active queue and removes that exclusion.

Both settings can be enabled together so the ejected card is excluded while the active list is replenished from the ordered reserve.

Ejecting the current card advances both standalone and mini interval Review set sessions to the next available card. An injected replacement always starts at the beginning of its first configured face instead of inheriting the ejected card's face or playback progress.

Opening a Review set and starting its session use the same forward horizontal navigation as interval runners. The welcome screen remains intact while the running session enters, preventing an intermediate session-layout flash during startup; reduced-motion preferences continue to disable directional movement.

The standalone review header reports the current card's position within the live queue. Its position follows previous and next swipes, while its queue size immediately follows session-setting changes, grading, ejection, undo, card additions, and card removal.

## Standalone review motion

Automatic and manual standalone Review set changes use the same directional model: previous and next cards move down and up, while front and back faces move right and left. Motion is limited to the card value, answer, and note; the face label, replay or reveal hint, card surface, and passive progress remain stationary. Reduced-motion preferences replace the content without directional movement.

Standalone Review set sessions show the current card position centered above the card, between the review mode and elapsed time. Finite sessions advance from 1 through the session total, while indefinite sessions wrap the position at the start of each loop.

Mini Review set cards in an active Interval append the current card position to the Review set title as `(X of Y)`.

In mobile landscape, an active Interval with a Review set uses a two-pane runner. The session title and `Interval X of Y` are centered in the header between Leave and session options. The current step, its group iteration chips, the enlarged timer, and interval navigation stay centered in the left pane, while the Review set card fills the right pane. Landscape intervals without a Review set keep the standard timer-focused layout.

The full Review-set pane in a landscape Interval supports the same directional swipe navigation as the mini card in portrait and the standalone reviewer. Gesture capture belongs to the complete card surface, while eject and tag controls remain independent tap targets.
