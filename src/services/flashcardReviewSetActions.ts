import type {
  FlashcardReviewSetAccessRole,
  FlashcardReviewSetActionItem,
} from '@/types/domain'

export const FLASHCARD_REVIEW_SET_ACTIONS: Record<
  FlashcardReviewSetAccessRole,
  FlashcardReviewSetActionItem[]
> = {
  owner: [
    { action: 'review', title: 'Review', icon: 'mdi-play' },
    { action: 'cards', title: 'Manage cards', icon: 'mdi-card-multiple-outline' },
    { action: 'edit', title: 'Edit', icon: 'mdi-pencil-outline' },
    { action: 'share', title: 'Share', icon: 'mdi-account-multiple-plus-outline' },
  ],
  readonly: [
    { action: 'review', title: 'Review', icon: 'mdi-play' },
    { action: 'settings', title: 'Review settings', icon: 'mdi-tune-variant' },
    { action: 'cards', title: 'View cards', icon: 'mdi-card-multiple-outline' },
    { action: 'copy', title: 'Make a copy', icon: 'mdi-content-copy' },
    { action: 'leave', title: 'Leave shared set', icon: 'mdi-exit-to-app', color: 'error' },
  ],
  editor: [
    { action: 'review', title: 'Review', icon: 'mdi-play' },
    { action: 'settings', title: 'Review settings', icon: 'mdi-tune-variant' },
    { action: 'cards', title: 'Manage cards', icon: 'mdi-card-multiple-outline' },
    { action: 'copy', title: 'Make a copy', icon: 'mdi-content-copy' },
    { action: 'leave', title: 'Leave shared set', icon: 'mdi-exit-to-app', color: 'error' },
  ],
}
