'use client';

import type { ReactNode } from 'react';
import { Dialog } from './Dialog';

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions (delete, disconnect, downgrade). */
  destructive?: boolean;
};

export function ConfirmDialog({ open, options, onResolve }: { open: boolean; options: ConfirmOptions | null; onResolve: (ok: boolean) => void }) {
  if (!open || !options) return null;
  const { title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false } = options;
  return (
    <Dialog
      open
      role="alertdialog"
      title={title}
      description={description}
      onClose={() => onResolve(false)}
      footer={
        <>
          <button
            type="button"
            onClick={() => onResolve(false)}
            className="rounded-xl border border-line-strong bg-surface-muted px-4 py-2 text-xs font-semibold text-fg-secondary hover:bg-surface-hover hover:text-fg transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            className={`rounded-xl px-4 py-2 text-xs font-semibold text-white transition-colors ${destructive ? 'bg-rose-600 hover:bg-rose-500' : 'bg-primary hover:bg-primary-hover'}`}
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}
