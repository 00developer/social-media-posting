'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { ConfirmDialog, type ConfirmOptions } from './ConfirmDialog';

export type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: ToastKind; message: string };

type ToastApi = {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

type FeedbackContextValue = { toast: ToastApi; confirm: (options: ConfirmOptions) => Promise<boolean> };

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const TOAST_MS: Record<ToastKind, number> = { success: 4000, info: 4500, error: 7000 };
const MAX_TOASTS = 4;

/** Toasts + promise-based confirm dialog for the dashboard (replaces alert / confirm / prompt). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, kind, message }].slice(-MAX_TOASTS));
  }, []);

  const toast = useMemo<ToastApi>(() => ({
    show,
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
    info: (m) => show(m, 'info'),
  }), [show]);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setConfirmState((prev) => {
      prev?.resolve(false); // a newer confirm replaces an unanswered one
      return { options, resolve };
    });
  }), []);

  const resolveConfirm = useCallback((ok: boolean) => {
    setConfirmState((prev) => {
      prev?.resolve(ok);
      return null;
    });
  }, []);

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      >
        {toasts.map((t) => <ToastCard key={t.id} item={t} onDismiss={dismiss} />)}
      </div>
      <ConfirmDialog open={!!confirmState} options={confirmState?.options ?? null} onResolve={resolveConfirm} />
    </FeedbackContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), TOAST_MS[item.kind]);
    return () => clearTimeout(timer);
  }, [item.id, item.kind, onDismiss]);

  const styles = {
    success: { box: 'border-emerald-500/30', icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" /> },
    error: { box: 'border-rose-500/40', icon: <AlertCircle className="h-4 w-4 text-rose-400" /> },
    info: { box: 'border-indigo-500/30', icon: <Info className="h-4 w-4 text-indigo-400" /> },
  }[item.kind];

  return (
    <div
      role={item.kind === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border ${styles.box} bg-[#0e1322]/95 px-3.5 py-3 text-sm text-slate-100 shadow-2xl shadow-black/40 backdrop-blur`}
    >
      <span className="mt-0.5 shrink-0">{styles.icon}</span>
      <p className="min-w-0 flex-1 break-words leading-snug">{item.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
        className="-mr-1 shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useToast / useConfirm must be used within a ToastProvider');
  return ctx;
}

export function useToast(): ToastApi {
  return useFeedback().toast;
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  return useFeedback().confirm;
}
