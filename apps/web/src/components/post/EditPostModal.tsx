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
    const result = await retryFailedPost(userId, post.id, failedPlatforms);
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, teamId, content: draft }),
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
        <h2 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2 pr-10">
          <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          {editability.editable ? 'Edit Post' : 'Post Details'}
        </h2>

        {!editability.editable && (
          <div role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {editability.reason}
          </div>
        )}

        <label htmlFor="edit-post-caption" className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Caption</label>
        <textarea
          id="edit-post-caption"
          className="w-full border border-gray-200 rounded-xl p-4 text-gray-800 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none resize-none placeholder-gray-400 disabled:opacity-70"
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!editability.editable || saving}
        />
        <div className="mt-1 mb-5 flex justify-between gap-3 text-xs">
          <span className={problem ? 'text-red-600' : 'text-gray-400'} role={problem ? 'alert' : undefined}>{problem ?? ''}</span>
          <span className={targetsThreads && utf8Bytes > THREADS_MAX_BYTES ? 'text-red-600' : 'text-gray-400'}>
            {draft.length} characters{targetsThreads ? ` · ${utf8Bytes}/${THREADS_MAX_BYTES} bytes (Threads)` : ''}
          </span>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Platforms</label>
          {statuses.length === 0 ? (
            <p className="text-sm text-gray-500">No platforms are attached to this post yet.</p>
          ) : (
            <ul className="space-y-2">
              {statuses.map((s) => (
                <li key={s.platform} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800 capitalize">{s.platform}</span>
                      <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white" style={{ backgroundColor: s.color }}>{s.label}</span>
                    </div>
                    {s.error && <p className="mt-1 text-xs text-red-600 wrap-break-word">{s.error}</p>}
                    {s.note && <p className="mt-1 text-xs text-amber-700 wrap-break-word">{s.note}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-gray-500">{s.scheduledAt ? formatTime(s.scheduledAt) : '—'}</span>
                </li>
              ))}
            </ul>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying || saving}
              className="mt-3 w-full rounded-xl border-2 border-red-100 bg-red-50 py-2 text-sm font-bold text-red-700 transition-all hover:bg-red-100 disabled:pointer-events-none disabled:opacity-50"
            >
              {retrying ? 'Retrying...' : `Retry failed platforms (${failedPlatforms.length})`}
            </button>
          )}
          {retriedNotice && <p role="status" className="mt-2 text-xs text-green-700">{retriedNotice}</p>}
          <p className="mt-2 text-xs text-gray-400">Times shown in {timeZone}</p>
        </div>

        {previewPlatforms.length > 0 && (
          <div className="mb-5">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Preview</label>
            <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
              {previewPlatforms.length > 1 && (
                <div className="flex items-center gap-1 p-2 border-b border-gray-200 bg-white overflow-x-auto shrink-0">
                  <span className="text-xs font-bold text-gray-500 mr-2">Preview for:</span>
                  {previewPlatforms.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPreviewPlatform(p)}
                      className={`text-[10px] px-3 py-1.5 rounded-md font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${activePreview === p ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
              <div className="bg-gray-100 p-4 flex items-center justify-center">
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

        <p className="mb-5 text-xs text-gray-500">Only the caption can be edited here. Time, platforms and media stay as scheduled.</p>

        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          {editability.editable ? (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className="flex-1 bg-linear-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 bg-white border-2 border-indigo-100 text-indigo-600 py-3 rounded-xl font-bold hover:bg-indigo-50 hover:border-indigo-200 transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-white border-2 border-indigo-100 text-indigo-600 py-3 rounded-xl font-bold hover:bg-indigo-50 hover:border-indigo-200 transition-all"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </PostModalShell>
  );
}
