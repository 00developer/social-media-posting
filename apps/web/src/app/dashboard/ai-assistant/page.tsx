'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/components/DashboardProvider';
import { supabase, authHeader } from '@/lib/supabase';
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setMediaFile(file);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(file ? URL.createObjectURL(file) : null);
  };

  const generate = async () => {
    if (!user || !activeTeam || !prompt.trim()) return;
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

  const useVersion = (kind: 'caption' | 'paragraph') => {
    if (!result) return;
    setDraft(`${result[kind]}\n\n${result.hashtags.join(' ')}`);
  };

  const useInNewPost = () => {
    if (!draft.trim()) return;
    setAiDraftHandoff(draft);
    router.push('/dashboard/posts');
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <svg className="h-6 w-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
          AI Assistant
        </h2>
        <p className="mt-1 text-sm text-gray-500">Turn an idea into a caption, a longer paragraph and hashtags - review and edit, then drop it straight into a new post.</p>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="e.g. weekend sale on handmade candles, 20% off"
          className="w-full rounded-xl border border-gray-200 bg-gray-50 p-4 text-gray-800 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
        />

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Photo or video (optional)</label>
            {mediaFile && (
              <button type="button" onClick={() => { setMediaFile(null); if (mediaPreview) URL.revokeObjectURL(mediaPreview); setMediaPreview(null); }}
                className="text-[10px] font-bold uppercase tracking-wider text-red-500 hover:text-red-700">Remove</button>
            )}
          </div>
          <input type="file" accept="image/*,video/*" onChange={handleFileChange}
            className="w-full cursor-pointer text-sm text-gray-500 file:mr-4 file:cursor-pointer file:rounded-full file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100" />
          {mediaPreview && (
            mediaFile?.type.startsWith('video/')
              ? <video src={mediaPreview} className="mt-3 max-h-48 rounded-lg" controls />
              : <img src={mediaPreview} alt="" className="mt-3 max-h-48 rounded-lg" />
          )}
          {mediaFile && <p className="mt-1.5 text-xs text-indigo-500">Will look at your {mediaFile.type.startsWith('video/') ? 'video (first frame)' : 'photo'} for context.</p>}
        </div>

        <button type="button" onClick={generate} disabled={loading || !prompt.trim()}
          className="mt-4 w-full rounded-xl bg-linear-to-r from-indigo-600 to-purple-600 py-3 font-bold text-white shadow-lg shadow-indigo-200 transition-all hover:scale-[1.01] hover:shadow-indigo-300 disabled:pointer-events-none disabled:opacity-50">
          {imageUploading ? 'Preparing photo...' : loading ? 'Generating...' : 'Generate'}
        </button>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {result && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
          <div className="mb-3 flex gap-1.5">
            <button type="button" onClick={() => useVersion('caption')} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50">Short caption</button>
            <button type="button" onClick={() => useVersion('paragraph')} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50">Longer paragraph</button>
          </div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6}
            className="w-full rounded-xl border border-gray-200 bg-white p-4 text-gray-800 outline-none focus:border-indigo-500" />
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500">Review and edit above - nothing is posted until you use it in a post.</p>
            <button type="button" onClick={useInNewPost} className="shrink-0 rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800">Use in new post</button>
          </div>
        </div>
      )}
    </div>
  );
}
