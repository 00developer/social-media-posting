'use client';

import { useEffect, useRef, type ReactNode } from 'react';

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
// locks background scroll, moves focus into the dialog and restores it on close.
export function PostModalShell({ onClose, isBusy, ariaLabel, children }: PostModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
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
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden outline-none"
      >
        <button
          type="button"
          aria-label="Close"
          disabled={isBusy}
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-2 bg-gray-50 rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-900 shadow-sm transition-colors disabled:opacity-40 disabled:pointer-events-none"
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
