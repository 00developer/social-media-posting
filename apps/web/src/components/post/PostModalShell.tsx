'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '@/components/ui/useFocusTrap';

type PostModalShellProps = {
  onClose: () => void;
  /**
   * True while the content is uploading / saving. Closing then would hide progress and leave the
   * user unsure whether the change went through, so every close path (Esc, backdrop, X) is ignored.
   */
  isBusy: boolean;
  ariaLabel: string;
  children: ReactNode;
};

// Overlay + dialog panel shared by the create and edit post modals: closes on Esc / backdrop / X,
// locks background scroll, traps Tab focus inside the dialog and restores focus on close.
export function PostModalShell({ onClose, isBusy, ariaLabel, children }: PostModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Declared first so it records the element focused before the dialog opened (restored on close);
  // Tab / Shift+Tab then cycle through the dialog's controls only.
  useFocusTrap(panelRef, true, { autoFocus: false });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isBusy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        // Only a press that starts on the backdrop closes it, so dragging a text selection out of the panel doesn't.
        if (e.target === e.currentTarget && !isBusy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className="relative bg-surface border border-line text-fg rounded-3xl shadow-pop w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden outline-none backdrop-blur-2xl"
      >
        <button
          type="button"
          aria-label="Close"
          disabled={isBusy}
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-surface-muted/80 border border-line rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg shadow-sm transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <div className="overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
