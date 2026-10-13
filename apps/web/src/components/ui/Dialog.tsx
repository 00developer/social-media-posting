'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from './useFocusTrap';

type DialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** While true, Esc / backdrop / X are ignored (an action is in flight). */
  busy?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  /** 'alertdialog' for confirmations. */
  role?: 'dialog' | 'alertdialog';
  maxWidth?: string;
};

/** Small accessible modal in the dashboard's dark theme: focus trap, Esc to close, scroll lock, labelled. */
export function Dialog({ open, title, description, onClose, busy = false, children, footer, role = 'dialog', maxWidth = 'max-w-md' }: DialogProps) {
  if (!open) return null;
  return (
    <DialogPanel title={title} description={description} onClose={onClose} busy={busy} footer={footer} role={role} maxWidth={maxWidth}>
      {children}
    </DialogPanel>
  );
}

function DialogPanel({ title, description, onClose, busy, children, footer, role, maxWidth }: Omit<DialogProps, 'open'>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(panelRef, true);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`relative w-full ${maxWidth} rounded-2xl border border-slate-800 bg-[#0e1322] p-5 sm:p-6 text-slate-100 shadow-2xl shadow-black/50 outline-none`}
      >
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={busy}
          className="absolute top-3.5 right-3.5 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-40"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 id={titleId} className="pr-8 text-base font-semibold text-white">{title}</h2>
        {description && <div id={descId} className="mt-1.5 text-sm text-slate-400 leading-relaxed">{description}</div>}
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}
