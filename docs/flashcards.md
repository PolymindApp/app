# Flashcards

## CSV import

The card importer shows an example with the required `front,back,note,tags` header and sample rows. Copy example places the displayed CSV directly on the clipboard so it can be used as a starting template. Front and back are required, while notes and tags are optional; imported Review set cards inherit the destination set's tags.

## Runner settings

The Apply to menu in active Interval and Review set settings offers Current session, the saved Interval or Review set, and Both. Choosing Both updates the saved source and the active session snapshot so the current run reflects the new settings immediately.

## Review card ejection

Ejecting the current card advances both standalone and mini interval Review set sessions to the next available card. The replacement card always starts at the beginning of its first configured face instead of inheriting the ejected card's face or playback progress.

## Standalone review motion

Automatic and manual standalone Review set changes use the same directional model: previous and next cards move down and up, while front and back faces move right and left. Motion is limited to the card value, answer, and note; the face label, replay or reveal hint, card surface, and passive progress remain stationary. Reduced-motion preferences replace the content without directional movement.

Standalone Review set sessions show the current card position centered above the card, between the review mode and elapsed time. Finite sessions advance from 1 through the session total, while indefinite sessions wrap the position at the start of each loop.
