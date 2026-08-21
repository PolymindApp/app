# Legal pages

BackOnTrack publishes its privacy policy at `/privacy` and its terms and conditions at `/terms`. Both routes are public, have route-specific search metadata, and remain accessible from the landing page, account registration flow, and the legal navigation beneath every authentication card. The authenticated Settings page links to `/settings/privacy` and `/settings/terms`, which present the same legal documents inside the standard authenticated app shell with its app bar, desktop navigation, and mobile bottom navigation.

The legal document content is shared between the public and authenticated presentations. Links between the privacy policy and terms stay in the current presentation so navigating between them does not unexpectedly enter or leave the authenticated app shell.

The privacy policy describes the application's actual offline and server data flows, including account data, user-created content, Review set sharing, local browser storage, push subscriptions, bounded client diagnostics, Health Connect step totals, and Android screen-time processing. Raw Android screen-interactive events stay on the device; saved step-counter progress synchronizes like other task data. The policy states how users can revoke permissions or request account deletion.

The terms cover accounts, offline synchronization, user content, Review set collaboration, acceptable use, health and safety limitations, third-party platform dependencies, service availability, termination, liability, and Québec governing law.

The effective date and operator contact details appear directly in both documents. The email address is Base64-encoded in the source and decoded at runtime for the visible label and `mailto:` link. Review the documents whenever the product's data collection, sharing, health integrations, operator identity, contact details, or commercial terms change.
