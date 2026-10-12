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
        className="relative bg-[#0e1322] border border-slate-800 text-slate-100 rounded-3xl shadow-2xl shadow-indigo-950/50 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden outline-none backdrop-blur-2xl"
      >
        <button
          type="button"
          aria-label="Close"
          disabled={isBusy}
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-slate-900/80 border border-slate-800 rounded-full text-slate-400 hover:bg-slate-800 hover:text-white shadow-sm transition-colors disabled:opacity-40 disabled:pointer-events-none"
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
