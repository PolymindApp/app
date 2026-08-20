# Flashcards

## CSV import

The card importer shows an example with the required `front,back,note,tags` header and sample rows. Copy example places the displayed CSV directly on the clipboard so it can be used as a starting template. Front and back are required, while notes and tags are optional; imported Review set cards inherit the destination set's tags.

## Runner settings

Active Interval settings include the same Review cards section as the Interval form, so a Review set can be attached, replaced, or removed during a run. The Apply to menu in active Interval and Review set settings offers Current session, the saved Interval or Review set, and Both. Choosing Both updates the saved source and the active session snapshot so the current run reflects the new settings immediately.

## Standalone review time limits

Standalone Review sets can optionally finish after a configured amount of active review time. The Review set and active-session settings use an hours-and-minutes wheel, with limits from one minute through 23 hours 59 minutes. Paused time does not count. Reaching the limit completes the session even when cards remain, including looping Passive reviews, and Android background Passive playback stops at the same limit. Mini Review sets inside Interval sessions continue to follow the Interval step duration instead.

## Review card ejection

Each Review set has two independent eject-button settings. With both settings cleared, eject permanently removes the current card from the active list and completes a standalone review after its last active card is ejected.

The optional **Load the next card** behavior keeps the active list filled up to the configured maximum by injecting the next ordered, matching card whenever one is ejected. For example, a 50-card Review set with a 10-card session limit keeps 10 cards active while reserve cards remain, then drains the final 10 and completes after all 50 cards have been ejected. The ordered reserve is snapshotted when standalone and mini interval sessions start, so the behavior remains deterministic and available offline.

The optional **Exclude card** behavior also adds the ejected card to the Review set's excluded cards, preventing it from appearing in future sessions. Undoing the last eject in a standalone review restores the card to the active queue and removes that exclusion.

Both settings can be enabled together so the ejected card is excluded while the active list is replenished from the ordered reserve.

Ejecting the current card advances both standalone and mini interval Review set sessions to the next available card. An injected replacement always starts at the beginning of its first configured face instead of inheriting the ejected card's face or playback progress.

## Standalone review motion

Automatic and manual standalone Review set changes use the same directional model: previous and next cards move down and up, while front and back faces move right and left. Motion is limited to the card value, answer, and note; the face label, replay or reveal hint, card surface, and passive progress remain stationary. Reduced-motion preferences replace the content without directional movement.

Standalone Review set sessions show the current card position centered above the card, between the review mode and elapsed time. Finite sessions advance from 1 through the session total, while indefinite sessions wrap the position at the start of each loop.

Mini Review set cards in an active Interval append the current card position to the Review set title as `(X of Y)`.

In mobile landscape, an active Interval with a Review set uses a two-pane runner. The session title and `Interval X of Y` are centered in the header between Leave and session options. The current step, its group iteration chips, the enlarged timer, and interval navigation stay centered in the left pane, while the Review set card fills the right pane. Landscape intervals without a Review set keep the standard timer-focused layout.

The full Review-set pane in a landscape Interval supports the same directional swipe navigation as the mini card in portrait and the standalone reviewer. Gesture capture belongs to the complete card surface, while eject and tag controls remain independent tap targets.
