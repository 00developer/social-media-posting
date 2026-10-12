'use client';

import { useMemo, useState } from 'react';
import { PostModalShell } from '@/components/post/PostModalShell';
import { PlatformPreviewCard } from '@/components/post/PlatformPreviewCard';
import { getPostContentType } from '@/lib/mediaFrame';
import { retryFailedPost } from '@/lib/postRetry';
import {
  canSaveCaption,
  getCaptionProblem,
  getEditability,
  getPlatformStatuses,
  isVideoUrl,
  parseMediaMap,
  THREADS_MAX_BYTES,
  type EditablePostRecord,
} from '@/lib/calendarEdit';
import { POST_SERVICE_URL } from '@/lib/apiUrls';
import { authHeader } from '@/lib/supabase';

export type { EditablePostRecord };

type EditPostModalProps = {
  post: EditablePostRecord;
  userId: string;
  teamId: string;
  isViewer: boolean;
  onClose: () => void;
  /** The caption was saved; the modal closes itself right after. */
  onSaved?: () => void;
  /** The server refused with 409 (the post changed under us, e.g. it started publishing): refresh the caller's data. */
  onOutdated?: () => void;
  /** Failed platforms were queued again; the caller refreshes its data. The modal stays open to show the new state. */
  onRetried?: () => void;
};

const formatTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// Only the caption can be edited (time, platforms and media stay as scheduled). Whether it is editable at
// all comes from getEditability, which mirrors the server; the server (PATCH /api/v1/posts/:id) is the real gate.
// Mount it only while it should be visible ({post && <EditPostModal … />}) so every open starts fresh.
export function EditPostModal({ post, userId, teamId, isViewer, onClose, onSaved, onOutdated, onRetried }: EditPostModalProps) {
  const original = post.content ?? '';
  const [draft, setDraft] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retriedNotice, setRetriedNotice] = useState<string | null>(null);
  const [previewPlatform, setPreviewPlatform] = useState<string | null>(null);

  const statuses = useMemo(() => getPlatformStatuses(post), [post]);
  const platforms = useMemo(() => statuses.map((s) => s.platform), [statuses]);
  const media = useMemo(() => parseMediaMap(post.media_url), [post.media_url]);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const failedPlatforms = useMemo(() => statuses.filter((s) => s.statusKey === 'failed').map((s) => s.platform), [statuses]);
  const canRetry = !isViewer && failedPlatforms.length > 0;

  const editability = getEditability(post, { isViewer });
  const problem = editability.editable && draft !== original ? getCaptionProblem(draft, platforms) : null;
  const canSave = editability.editable && !saving && canSaveCaption(original, draft, platforms);
  const targetsThreads = platforms.includes('threads');
  const utf8Bytes = new TextEncoder().encode(draft).length;

  const previewPlatforms = platforms.length > 0 ? platforms : Object.keys(media);
  const activePreview = previewPlatform && previewPlatforms.includes(previewPlatform) ? previewPlatform : (previewPlatforms[0] ?? null);
  const activeMediaUrl = activePreview ? (media[activePreview] ?? null) : null;

  const handleRetry = async () => {
    if (!canRetry || retrying || saving) return;
    setRetrying(true);
    setError(null);
    setRetriedNotice(null);
    const result = await retryFailedPost(post.id, failedPlatforms);
    setRetrying(false);
    if (result.ok) {
      setRetriedNotice(`Retrying ${result.retried.join(', ')}. The status updates here and in the calendar once it has run.`);
      onRetried?.();
    } else {
      if (result.nothingToRetry) onOutdated?.();
      setError(result.error);
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${POST_SERVICE_URL}/api/v1/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ teamId, content: draft }),
      });
      let body: { success?: boolean; error?: string } | null = null;
      try {
        body = await res.json();
      } catch {
        // non-JSON response: fall through to the generic message
      }
      if (res.ok && body?.success) {
        onSaved?.();
        onClose();
        return;
      }
      if (res.status === 409) onOutdated?.();
      setError(body?.error || `Could not save the caption (${res.status}).`);
    } catch {
      setError('Could not reach the post service. Check that it is running and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PostModalShell onClose={onClose} isBusy={saving || retrying} ariaLabel="Edit post">
      <div>
        <h2 className="text-xl font-extrabold text-white mb-5 flex items-center gap-2.5 pr-10">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          </span>
          {editability.editable ? 'Edit Post' : 'Post Details'}
        </h2>

        {!editability.editable && (
          <div role="status" className="mb-5 rounded-xl border border-amber-500/30 bg-amber-950/40 px-3.5 py-2.5 text-sm text-amber-300 backdrop-blur-md">
            {editability.reason}
          </div>
        )}

        <label htmlFor="edit-post-caption" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Caption</label>
        <textarea
          id="edit-post-caption"
          className="w-full border border-slate-700 rounded-xl p-4 text-sm text-white bg-slate-900/90 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all outline-none resize-none placeholder-slate-500 disabled:opacity-60 leading-relaxed"
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!editability.editable || saving}
        />
        <div className="mt-1.5 mb-5 flex justify-between gap-3 text-xs">
          <span className={problem ? 'text-rose-400 font-medium' : 'text-slate-500'} role={problem ? 'alert' : undefined}>{problem ?? ''}</span>
          <span className={targetsThreads && utf8Bytes > THREADS_MAX_BYTES ? 'text-rose-400 font-semibold' : 'text-slate-400'}>
            {draft.length} characters{targetsThreads ? ` · ${utf8Bytes}/${THREADS_MAX_BYTES} bytes (Threads)` : ''}
          </span>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Platforms</label>
          {statuses.length === 0 ? (
            <p className="text-sm text-slate-400">No platforms are attached to this post yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {statuses.map((s) => (
                <li key={s.platform} className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3.5 py-2.5 backdrop-blur-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white capitalize">{s.platform}</span>
                      <span className="inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm" style={{ backgroundColor: s.color }}>{s.label}</span>
                    </div>
                    {s.error && <p className="mt-1 text-xs text-rose-400 wrap-break-word">{s.error}</p>}
                    {s.note && <p className="mt-1 text-xs text-amber-300 wrap-break-word">{s.note}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-slate-400 font-medium">{s.scheduledAt ? formatTime(s.scheduledAt) : '—'}</span>
                </li>
              ))}
            </ul>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying || saving}
              className="mt-3 w-full rounded-xl border border-rose-500/40 bg-rose-950/40 py-2.5 text-xs font-bold uppercase tracking-wider text-rose-300 transition-all hover:bg-rose-900/50 disabled:pointer-events-none disabled:opacity-50"
            >
              {retrying ? 'Retrying...' : `Retry failed platforms (${failedPlatforms.length})`}
            </button>
          )}
          {retriedNotice && <p role="status" className="mt-2 text-xs text-emerald-400 font-medium">{retriedNotice}</p>}
          <p className="mt-2 text-xs text-slate-500">Times shown in {timeZone}</p>
        </div>

        {previewPlatforms.length > 0 && (
          <div className="mb-5">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Preview</label>
            <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/80">
              {previewPlatforms.length > 1 && (
                <div className="flex items-center gap-1.5 p-2.5 border-b border-slate-800 bg-slate-900/80 overflow-x-auto shrink-0">
                  <span className="text-xs font-bold text-slate-400 mr-2">Preview for:</span>
                  {previewPlatforms.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPreviewPlatform(p)}
                      className={`text-[10px] px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider transition-all whitespace-nowrap ${activePreview === p ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
              <div className="bg-[#090D16] p-5 flex items-start justify-center">
                <PlatformPreviewCard
                  platform={activePreview}
                  content={draft}
                  mediaUrl={activeMediaUrl}
                  isVideo={isVideoUrl(activeMediaUrl)}
                  contentType={getPostContentType(post)}
                />
              </div>
            </div>
          </div>
        )}

        <p className="mb-5 text-xs text-slate-400">Only the caption can be edited here. Time, platforms and media stay as scheduled.</p>

        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3.5 py-2.5 text-sm text-rose-300">
            {error}
          </div>
        )}

        <div className="flex gap-2.5">
          {editability.editable ? (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 border border-slate-700 bg-slate-900 text-slate-300 py-3 rounded-xl text-sm font-bold hover:bg-slate-800 hover:text-white transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full border border-slate-700 bg-slate-900 text-slate-200 py-3 rounded-xl text-sm font-bold hover:bg-slate-800 hover:text-white transition-all"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </PostModalShell>
  );
}
