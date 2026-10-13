'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/components/DashboardProvider';
import { authHeader } from '@/lib/supabase';
import { MEDIA_SERVICE_URL, POST_SERVICE_URL } from '@/lib/apiUrls';
import { setAiDraftHandoff } from '@/lib/aiDraftHandoff';

type CaptionResult = { caption: string; paragraph: string; hashtags: string[] };

export default function AiAssistantPage() {
  const { user, activeTeam } = useDashboard();
  const router = useRouter();

  const [prompt, setPrompt] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CaptionResult | null>(null);
  const [draft, setDraft] = useState('');
  // Changing the key remounts the file input, clearing its selected file (so the same file can be picked again).
  const [fileInputKey, setFileInputKey] = useState(0);
  const previewUrlRef = useRef<string | null>(null);

  const setPreviewUrl = (next: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = next;
    setMediaPreview(next);
  };
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setMediaFile(file);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const removeFile = () => {
    setMediaFile(null);
    setPreviewUrl(null);
    setFileInputKey((k) => k + 1);
  };

  const generate = async () => {
    if (!user || !activeTeam || !prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      let imageUrl: string | undefined;
      if (mediaFile) {
        setImageUploading(true);
        try {
          const formData = new FormData();
          formData.append('file', mediaFile);
          const uploadRes = await fetch(`${MEDIA_SERVICE_URL}/api/v1/media/ai-thumbnail`, { method: 'POST', headers: await authHeader(), body: formData });
          const uploadData = await uploadRes.json();
          if (uploadRes.ok && uploadData.success) imageUrl = uploadData.url;
          else console.warn('AI thumbnail upload failed, generating from the prompt alone:', uploadData.error);
        } finally {
          setImageUploading(false);
        }
      }

      const res = await fetch(`${POST_SERVICE_URL}/api/v1/ai/caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ teamId: activeTeam.id, prompt: prompt.trim(), imageUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not generate a result.');
      setResult(data.data);
      setDraft(`${data.data.caption}\n\n${data.data.hashtags.join(' ')}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not generate a result.');
    } finally {
      setLoading(false);
    }
  };

  const applyVersion = (kind: 'caption' | 'paragraph') => {
    if (!result) return;
    setDraft(`${result[kind]}\n\n${result.hashtags.join(' ')}`);
  };

  const sendToNewPost = () => {
    if (!draft.trim()) return;
    setAiDraftHandoff(draft);
    router.push('/dashboard/posts');
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <div>
        <h2 className="flex items-center gap-2.5 text-xl font-bold text-fg tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-xs">
            <svg className="h-4.5 w-4.5 text-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
          </span>
          AI Assistant
        </h2>
        <p className="mt-1 text-sm text-fg-muted">Turn an idea into a caption, a longer paragraph and hashtags - review and edit, then drop it straight into a new post.</p>
      </div>

      <div className="rounded-xl border border-line bg-surface shadow-card p-4 sm:p-6">
        <label htmlFor="ai-prompt" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-fg-muted">Prompt</label>
        <textarea
          id="ai-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="e.g. weekend sale on handmade candles, 20% off"
          className="w-full rounded-xl border border-line-strong bg-surface-muted/90 p-4 text-sm text-fg placeholder:text-fg-subtle outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="ai-media" className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Photo or video (optional)</label>
            {mediaFile && (
              <button type="button" onClick={removeFile} aria-label="Remove attached file"
                className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300">Remove</button>
            )}
          </div>
          <input key={fileInputKey} id="ai-media" type="file" accept="image/*,video/*" onChange={handleFileChange} disabled={loading}
            className="w-full cursor-pointer text-sm text-fg-muted file:mr-4 file:cursor-pointer file:rounded-lg file:border file:border-line-strong file:bg-surface-hover file:px-4 file:py-2 file:text-xs file:font-semibold file:text-fg hover:file:bg-surface-strong hover:file:text-fg transition-all" />
          {mediaPreview && (
            mediaFile?.type.startsWith('video/')
              ? <video src={mediaPreview} className="mt-3.5 max-h-56 rounded-xl border border-line" controls />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={mediaPreview} alt="" className="mt-3.5 max-h-56 rounded-xl border border-line object-cover shadow-sm" />
          )}
          {mediaFile && <p className="mt-2 text-xs text-accent font-medium">Will look at your {mediaFile.type.startsWith('video/') ? 'video (first frame)' : 'photo'} for context.</p>}
        </div>

        <button type="button" onClick={generate} disabled={loading || !prompt.trim()} aria-busy={loading}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-hover py-3 text-sm font-semibold text-white transition-all disabled:pointer-events-none disabled:opacity-50">
          {loading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
          {imageUploading ? 'Preparing photo...' : loading ? 'Generating...' : 'Generate Draft'}
        </button>
        {error && <p className="mt-3 text-sm text-rose-700 dark:text-rose-400 font-medium">{error}</p>}
      </div>

      {result && (
        <div className="rounded-xl border border-line bg-surface shadow-card p-4 sm:p-6">
          <div className="mb-3.5 flex gap-2">
            <button type="button" onClick={() => applyVersion('caption')} className="rounded-lg border border-line-strong bg-surface-muted px-3.5 py-1.5 text-xs font-semibold text-fg hover:border-indigo-500 hover:text-fg transition-all">Short caption</button>
            <button type="button" onClick={() => applyVersion('paragraph')} className="rounded-lg border border-line-strong bg-surface-muted px-3.5 py-1.5 text-xs font-semibold text-fg hover:border-indigo-500 hover:text-fg transition-all">Longer paragraph</button>
          </div>
          <label htmlFor="ai-draft" className="sr-only">Generated draft</label>
          <textarea id="ai-draft" value={draft} onChange={(e) => setDraft(e.target.value)} rows={6}
            className="w-full rounded-xl border border-line-strong bg-surface-muted/90 p-4 text-sm text-fg leading-relaxed outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-fg-muted">Review and edit above - nothing is posted until you use it in a post.</p>
            <button type="button" onClick={sendToNewPost} disabled={!draft.trim()} className="shrink-0 disabled:opacity-50 rounded-xl bg-primary hover:bg-primary-hover px-5 py-2.5 text-sm font-semibold text-white transition-all">Use in new post →</button>
          </div>
        </div>
      )}
    </div>
  );
}
