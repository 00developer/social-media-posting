'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';

export const PUBLISH_PLATFORMS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'threads', label: 'Threads' },
  { id: 'twitter', label: 'Twitter' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'pinterest', label: 'Pinterest' },
] as const;

type PlatformPickerDialogProps = {
  /** Platforms with a connected account; others are shown but marked "not connected". */
  connectedPlatforms: string[];
  onCancel: () => void;
  onConfirm: (platforms: string[]) => void;
};

/** Replaces the old prompt() asking which platforms a draft should be published to. Mount only while open. */
export function PlatformPickerDialog({ connectedPlatforms, onCancel, onConfirm }: PlatformPickerDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  return (
    <Dialog
      open
      title="Publish draft"
      description="Choose where this draft should be published now."
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selected)}
            disabled={selected.length === 0}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            Publish to {selected.length || 'selected'} platform{selected.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <fieldset>
        <legend className="sr-only">Platforms</legend>
        <div className="grid grid-cols-2 gap-2">
          {PUBLISH_PLATFORMS.map((p) => {
            const isSelected = selected.includes(p.id);
            const isConnected = connectedPlatforms.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                onClick={() => toggle(p.id)}
                className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-500/15 text-white'
                    : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
                }`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isSelected ? 'border-indigo-400 bg-indigo-500' : 'border-slate-600'}`}>
                  {isSelected && <Check className="h-3 w-3 text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{p.label}</span>
                  {!isConnected && <span className="block text-[10px] text-slate-500">Not connected</span>}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </Dialog>
  );
}
