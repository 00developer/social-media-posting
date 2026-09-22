'use client';

import { useState } from 'react';
import { PostComposer, type PostActionType } from '@/components/post/PostComposer';
import { PostModalShell } from '@/components/post/PostModalShell';

type CreatePostModalProps = {
  /** `datetime-local` value ("YYYY-MM-DDTHH:mm", local time) to pre-fill the schedule field. */
  initialScheduleAt?: string;
  onClose: () => void;
  /** Called after a post was created; the modal closes itself right after. */
  onCreated?: (actionType: PostActionType) => void;
};

// Mount it only while it should be visible ({open && <CreatePostModal … />}): every open then
// starts with a fresh composer, and unmounting (e.g. a team switch) closes it.
export function CreatePostModal({ initialScheduleAt, onClose, onCreated }: CreatePostModalProps) {
  // True while the composer is uploading / creating (see PostModalShell.isBusy).
  const [isBusy, setIsBusy] = useState(false);

  const handleSubmitted = (actionType: PostActionType) => {
    onCreated?.(actionType);
    onClose();
  };

  return (
    <PostModalShell onClose={onClose} isBusy={isBusy} ariaLabel="Create post">
      <PostComposer
        variant="modal"
        initialScheduleAt={initialScheduleAt}
        onOptimisticChange={(post) => setIsBusy(post !== null)}
        onSubmitted={handleSubmitted}
      />
    </PostModalShell>
  );
}
