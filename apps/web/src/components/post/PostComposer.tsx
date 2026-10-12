'use client';

import { useState } from 'react';
import { useDashboard, type Post } from '@/components/DashboardProvider';
import { PlatformPreviewCard } from '@/components/post/PlatformPreviewCard';
import { MEDIA_SERVICE_URL, POST_SERVICE_URL, SCHEDULING_SERVICE_URL } from '@/lib/apiUrls';
import { takeAiDraftHandoff } from '@/lib/aiDraftHandoff';
import { authHeader } from '@/lib/supabase';
import {
  Sparkles,
  PenSquare,
  UploadCloud,
  Calendar,
  Send,
  Bookmark,
  Video,
  FileText,
  Trash2,
  Check,
  RotateCw,
  Film
} from 'lucide-react';

type PostComposerProps = {
  /** Lets the host page mirror the "uploading" placeholder card in its own timeline. */
  onOptimisticChange?: (post: Partial<Post> | null) => void;
  /** 'sidebar' is the sticky card on the Posts page; 'modal' drops the card chrome (the modal shell provides it). */
  variant?: 'sidebar' | 'modal';
  /** `datetime-local` value ("YYYY-MM-DDTHH:mm", local time) to pre-fill the schedule field. */
  initialScheduleAt?: string;
  /** Called once a post was created (also when the follow-up schedule request failed and it stayed a draft). */
  onSubmitted?: (actionType: PostActionType) => void;
};

export type PostActionType = 'draft' | 'schedule' | 'publish';

export function PostComposer({ onOptimisticChange, variant = 'sidebar', initialScheduleAt = '', onSubmitted }: PostComposerProps) {
  const { user, activeTeam, fetchTeamData } = useDashboard();

  const [newPostContent, setNewPostContent] = useState(() => (typeof window !== 'undefined' ? takeAiDraftHandoff() || '' : ''));
  const [scheduleAt, setScheduleAt] = useState(initialScheduleAt);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [previewPlatform, setPreviewPlatform] = useState<string | null>(null);
  const [contentType, setContentType] = useState<'post' | 'reel'>('post');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ caption: string; paragraph: string; hashtags: string[] } | null>(null);
  const [aiDraft, setAiDraft] = useState('');
  const [aiImageUrl, setAiImageUrl] = useState<string | null>(null);
  const [aiImageUploading, setAiImageUploading] = useState(false);
  const [optimisticPost, setOptimisticPostState] = useState<Partial<Post> | null>(null);
  const setOptimisticPost = (post: Partial<Post> | null) => {
    setOptimisticPostState(post);
    onOptimisticChange?.(post);
  };
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const activePreviewPlatform = previewPlatform && selectedPlatforms.includes(previewPlatform) 
    ? previewPlatform 
    : (selectedPlatforms.length > 0 ? selectedPlatforms[0] : null);

  const handleMediaChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setMediaFile(file);
    setAiImageUrl(null); // a new file needs a fresh AI-context upload
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview.split('#')[0]);
    }
    if (file) {
      const isVid = file.type.startsWith('video/');
      if (isVid) {
        setIsPreviewLoading(true);
        try {
          const formData = new FormData();
          formData.append('file', file);
          const res = await fetch(`${MEDIA_SERVICE_URL}/api/v1/media/transcode-preview`, {
            method: 'POST',
            headers: await authHeader(),
            body: formData
          });
          if (!res.ok) throw new Error('Transcode failed');
          const blob = await res.blob();
          setMediaPreview(URL.createObjectURL(blob) + '#video');
        } catch (err) {
          console.error('Failed to load remote preview, falling back to local:', err);
          setMediaPreview(URL.createObjectURL(file) + '#video');
        } finally {
          setIsPreviewLoading(false);
        }
      } else {
        setMediaPreview(URL.createObjectURL(file) + '#image');
      }
    } else {
      setMediaPreview(null);
    }
  };

  const generateWithAi = async () => {
    if (!user || !activeTeam || !aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      // Give the AI a look at the attached photo/video, uploading a small copy the first time (cached after that).
      let imageUrl = aiImageUrl;
      if (mediaFile && !imageUrl) {
        setAiImageUploading(true);
        try {
          const formData = new FormData();
          formData.append('file', mediaFile);
          const uploadRes = await fetch(`${MEDIA_SERVICE_URL}/api/v1/media/ai-thumbnail`, { method: 'POST', headers: await authHeader(), body: formData });
          const uploadData = await uploadRes.json();
          if (uploadRes.ok && uploadData.success) {
            imageUrl = uploadData.url;
            setAiImageUrl(uploadData.url);
          } else {
            console.warn('AI thumbnail upload failed, generating from the prompt alone:', uploadData.error);
          }
        } finally {
          setAiImageUploading(false);
        }
      }

      const res = await fetch(`${POST_SERVICE_URL}/api/v1/ai/caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ teamId: activeTeam.id, prompt: aiPrompt.trim(), platform: activePreviewPlatform ?? undefined, imageUrl: imageUrl ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not generate a result.');
      setAiResult(data.data);
      setAiDraft(`${data.data.caption}\n\n${data.data.hashtags.join(' ')}`);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : 'Could not generate a result.');
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiVersion = (kind: 'caption' | 'paragraph') => {
    if (!aiResult) return;
    setAiDraft(`${aiResult[kind]}\n\n${aiResult.hashtags.join(' ')}`);
  };

  const insertAiDraft = () => {
    if (!aiDraft.trim()) return;
    setNewPostContent((current) => (current.trim() ? `${current}\n\n${aiDraft}` : aiDraft));
    setAiResult(null);
    setAiDraft('');
    setAiPrompt('');
  };

  const handleCreatePost = async (actionType: PostActionType) => {
    if (!user || !activeTeam) return;
    if (!newPostContent || selectedPlatforms.length === 0) {
      alert("Please enter content and select at least one platform.");
      return;
    }
    
    const optimisticMedia = mediaPreview ? { preview: mediaPreview } : {};
    setOptimisticPost({
      id: 'temp-upload',
      content: newPostContent,
      status: 'uploading',
      created_at: new Date().toISOString(),
      media_url: JSON.stringify(optimisticMedia)
    });
    
    try {
      let mediaUrls = {};
      if (mediaFile) {
        const formData = new FormData();
        formData.append('file', mediaFile);
        formData.append('platforms', selectedPlatforms.join(','));
        formData.append('contentType', contentType);

        const mediaRes = await fetch(`${MEDIA_SERVICE_URL}/api/v1/media/upload`, {
          method: 'POST',
          headers: await authHeader(),
          body: formData
        });
        const mediaData = await mediaRes.json();
        if (mediaData.success) {
          mediaUrls = mediaData.mediaUrls;
        } else {
          alert('Media upload failed: ' + mediaData.error);
          return;
        }
      }

      const res = await fetch(`${POST_SERVICE_URL}/api/v1/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ teamId: activeTeam.id, content: newPostContent, mediaUrl: JSON.stringify(mediaUrls) })
      });
      const data = await res.json();
      
      if (data.success) {
        const postId = data.data.id;

        if (actionType === 'schedule' || actionType === 'publish') {
          const runAt = actionType === 'schedule' && scheduleAt 
            ? new Date(scheduleAt) 
            : new Date();

          const scheduleRes = await fetch(`${SCHEDULING_SERVICE_URL}/api/v1/schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
            body: JSON.stringify({
              postId: postId,
              platforms: selectedPlatforms,
              scheduledAt: runAt.toISOString(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              contentType: contentType
            })
          });
          const scheduleData = await scheduleRes.json();
          if (!scheduleData.success) {
            alert('Failed to process: ' + scheduleData.error);
          } else if (actionType === 'publish') {
            alert('Post queued for immediate publishing!');
          }
        }

        setNewPostContent('');
        setScheduleAt('');
        setMediaFile(null);
        if (mediaPreview) URL.revokeObjectURL(mediaPreview);
        setMediaPreview(null);
        setFileInputKey(prev => prev + 1);
        setSelectedPlatforms([]);
        fetchTeamData();
        onSubmitted?.(actionType);
      } else {
        alert(data.error);
      }
    } catch (e: unknown) {
      console.error(e);
      alert('Error creating post: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setOptimisticPost(null);
    }
  };

  const PLATFORMS_DATA = [
    { id: 'youtube', label: 'YouTube', activeClass: 'bg-red-600 text-white border-red-600 shadow-xs' },
    { id: 'instagram', label: 'Instagram', activeClass: 'bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white border-transparent shadow-xs' },
    { id: 'facebook', label: 'Facebook', activeClass: 'bg-blue-600 text-white border-blue-600 shadow-xs' },
    { id: 'threads', label: 'Threads', activeClass: 'bg-slate-900 text-white border-slate-900 shadow-xs' },
    { id: 'twitter', label: 'Twitter', activeClass: 'bg-sky-500 text-white border-sky-500 shadow-xs' },
    { id: 'linkedin', label: 'LinkedIn', activeClass: 'bg-blue-700 text-white border-blue-700 shadow-xs' },
    { id: 'tiktok', label: 'TikTok', activeClass: 'bg-slate-950 text-white border-slate-950 shadow-xs' },
    { id: 'pinterest', label: 'Pinterest', activeClass: 'bg-red-700 text-white border-red-700 shadow-xs' },
  ];

  return (
    <div className={variant === 'modal' ? 'bg-[#0d131f] text-slate-100' : 'bg-[#0d131f] p-5 rounded-2xl border border-slate-800 sticky top-20 text-slate-100 shadow-xs'}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
            <PenSquare className="w-3.5 h-3.5" />
          </div>
          <span>Compose Post</span>
        </h2>
        {newPostContent.length > 0 && (
          <span className="text-[11px] font-medium text-slate-400 bg-slate-900 px-2 py-0.5 rounded-md border border-slate-800">
            {newPostContent.length} chars
          </span>
        )}
      </div>
      
      {/* AI Assistant Section */}
      {activeTeam?.role !== 'viewer' && (
        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
          <div className="flex items-center justify-between mb-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>AI Caption Assistant</span>
            </label>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !aiLoading) { e.preventDefault(); generateWithAi(); } }}
              placeholder="e.g. weekend sale on handmade craft items..."
              className="w-full rounded-xl border border-slate-800 bg-slate-900/90 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all placeholder:text-slate-500 shadow-inner"
            />
            <button
              type="button"
              onClick={generateWithAi}
              disabled={aiLoading || !aiPrompt.trim()}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-1.5"
            >
              {aiImageUploading ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Preparing photo context...</span>
                </>
              ) : aiLoading ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Crafting ideas...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generate with AI</span>
                </>
              )}
            </button>
          </div>
          {mediaFile && (
            <p className="mt-2 text-[11px] text-indigo-400 font-medium">
              💡 Attached {mediaFile.type.startsWith('video/') ? 'video frame' : 'photo'} will be analyzed for visual context.
            </p>
          )}
          {aiError && <p className="mt-2 text-xs text-rose-400 font-medium">{aiError}</p>}
          {aiResult && (
            <div className="mt-3 space-y-2 pt-2 border-t border-indigo-900/60">
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => applyAiVersion('caption')}
                  className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white transition-all"
                >
                  Short caption
                </button>
                <button
                  type="button"
                  onClick={() => applyAiVersion('paragraph')}
                  className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white transition-all"
                >
                  Long paragraph
                </button>
              </div>
              <textarea
                value={aiDraft}
                onChange={(e) => setAiDraft(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none shadow-inner resize-none"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-slate-400">Review above before inserting.</p>
                <button
                  type="button"
                  onClick={insertAiDraft}
                  className="shrink-0 rounded-xl bg-white px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-slate-200 shadow-md transition-all"
                >
                  Use in Post
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Post Text Area */}
      <div className="relative mb-5">
        <textarea
          className="w-full border border-slate-800 rounded-2xl p-4 text-sm text-slate-100 bg-slate-900/90 hover:bg-slate-900 focus:bg-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none resize-none placeholder-slate-500 shadow-inner leading-relaxed"
          rows={5}
          placeholder="What's happening? Share updates, announcements, or attach media..."
          value={newPostContent}
          onChange={(e) => setNewPostContent(e.target.value)}
          disabled={activeTeam?.role === 'viewer'}
        />

        {/* Quick Tag Suggestions & Character Count */}
        <div className="flex items-center justify-between mt-2 gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-0.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">Tags:</span>
            {['#trending', '#update', '#announcement', '#viral', '#creative'].map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => setNewPostContent(prev => prev ? `${prev} ${tag}` : tag)}
                disabled={activeTeam?.role === 'viewer'}
                className="px-2 py-0.5 rounded-lg bg-slate-800/80 hover:bg-indigo-950 hover:text-indigo-300 text-slate-300 text-[11px] font-medium transition-colors shrink-0 border border-transparent hover:border-indigo-800/60"
              >
                {tag}
              </button>
            ))}
          </div>
          <span className={`text-[11px] font-semibold shrink-0 ${newPostContent.length > 280 ? 'text-amber-400' : 'text-slate-400'}`}>
            {newPostContent.length}/2200
          </span>
        </div>
      </div>

      {/* Content Type Selector (Segmented Pills) */}
      <div className="mb-5">
        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Content Type</label>
        <div className="flex bg-slate-900/80 p-1 rounded-xl gap-1 border border-slate-800">
          <button
            type="button"
            onClick={() => setContentType('post')}
            disabled={activeTeam?.role === 'viewer'}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
              contentType === 'post'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Standard Post</span>
          </button>
          <button
            type="button"
            onClick={() => setContentType('reel')}
            disabled={activeTeam?.role === 'viewer'}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
              contentType === 'reel'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Reel / Short</span>
          </button>
        </div>
      </div>
      
      {/* Target Platforms */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">Target Channels</label>
          <span className="text-[10px] text-slate-400 font-semibold">{selectedPlatforms.length} selected</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS_DATA.map(p => {
            const isSelected = selectedPlatforms.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  if (isSelected) setSelectedPlatforms(selectedPlatforms.filter(sp => sp !== p.id));
                  else setSelectedPlatforms([...selectedPlatforms, p.id]);
                }}
                disabled={activeTeam?.role === 'viewer'}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                  isSelected
                    ? p.activeClass
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:border-slate-700 shadow-2xs'
                }`}
              >
                {isSelected && <Check className="w-3 h-3 stroke-3" />}
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Media Attachment */}
      <div className="mb-5 space-y-4">
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">Attachment</label>
            {mediaFile && (
              <button
                type="button"
                onClick={() => { setMediaFile(null); setMediaPreview(null); setFileInputKey(prev => prev + 1); }}
                className="text-[10px] text-rose-400 font-bold hover:text-rose-300 hover:bg-rose-950/40 px-2 py-0.5 rounded-md transition-colors uppercase tracking-wider flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Remove
              </button>
            )}
          </div>

          {!mediaFile ? (
            <label className="border-2 border-dashed border-slate-800 hover:border-indigo-500/60 rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-indigo-950/20 transition-all group bg-slate-900/40">
              <div className="w-9 h-9 rounded-xl bg-slate-800 group-hover:bg-indigo-950 text-slate-400 group-hover:text-indigo-400 flex items-center justify-center mb-1.5 transition-colors border border-slate-700/60">
                <UploadCloud className="w-5 h-5" />
              </div>
              <span className="text-xs font-semibold text-slate-200">Upload video or photo</span>
              <span className="text-[10px] text-slate-400 mt-0.5">MP4, WEBM, PNG, JPEG up to 100MB</span>
              <input 
                key={fileInputKey}
                type="file" 
                accept="image/*,video/*"
                disabled={activeTeam?.role === 'viewer' || isPreviewLoading} 
                onChange={handleMediaChange} 
                className="hidden" 
              />
            </label>
          ) : (
            <div className="p-3 bg-slate-900/90 rounded-2xl border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-indigo-950 text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-800/60">
                  {mediaFile.type.startsWith('video/') ? <Video className="w-4 h-4" /> : <UploadCloud className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-200 truncate">{mediaFile.name}</p>
                  <p className="text-[10px] text-slate-400">{(mediaFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                </div>
              </div>
            </div>
          )}

          {isPreviewLoading && (
            <div className="flex items-center gap-2 text-xs text-indigo-400 font-semibold mt-2">
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
              Generating preview transcode...
            </div>
          )}

          {(mediaPreview || newPostContent) && (
            <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900 mt-3 flex flex-col shadow-2xl">
              {selectedPlatforms.length > 0 ? (
                <>
                  <div className="flex items-center gap-1.5 p-2.5 border-b border-slate-800 bg-[#0e1322] overflow-x-auto shrink-0 custom-scrollbar">
                    <span className="text-[11px] font-bold text-slate-400 mr-1">Preview:</span>
                    {selectedPlatforms.map(p => (
                      <button
                        key={p}
                        onClick={() => setPreviewPlatform(p)}
                        className={`text-[10px] px-2.5 py-1 rounded-lg font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${
                          activePreviewPlatform === p
                            ? 'bg-indigo-950 text-indigo-300 border border-indigo-800/80 shadow-[0_0_8px_rgba(99,102,241,0.25)]'
                            : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  
                  <div className={variant === 'modal' ? 'bg-[#090d16] p-4 flex items-start justify-center' : 'flex-1 overflow-y-auto max-h-128 bg-[#090d16] p-4 flex items-start justify-center custom-scrollbar'}>
                    <PlatformPreviewCard platform={activePreviewPlatform} content={newPostContent} mediaUrl={mediaPreview} isVideo={mediaFile?.type.startsWith('video/')} contentType={contentType} />
                  </div>
                </>
              ) : (
                <div className="p-6 text-center bg-slate-900/60">
                  <p className="text-xs text-slate-300 font-semibold mb-0.5">Select a channel above</p>
                  <p className="text-[11px] text-slate-500">Channel preview will appear automatically</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Schedule Field */}
        <div>
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            Schedule (Optional)
          </label>
          <input 
            type="datetime-local" 
            className="w-full border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 bg-slate-900/90 hover:bg-slate-900 focus:bg-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none shadow-inner"
            value={scheduleAt}
            disabled={activeTeam?.role === 'viewer'}
            onChange={(e) => setScheduleAt(e.target.value)}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2.5 mt-2">
        {scheduleAt ? (
          <button 
            type="button"
            onClick={() => handleCreatePost('schedule')}
            disabled={activeTeam?.role === 'viewer' || !newPostContent || selectedPlatforms.length === 0 || optimisticPost !== null}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-xl font-semibold text-xs shadow-xs transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {optimisticPost ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Calendar className="w-3.5 h-3.5" />}
            <span>{optimisticPost ? 'Scheduling...' : 'Schedule Post'}</span>
          </button>
        ) : (
          <>
            <button 
              type="button"
              onClick={() => handleCreatePost('publish')}
              disabled={activeTeam?.role === 'viewer' || !newPostContent || selectedPlatforms.length === 0 || optimisticPost !== null}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-xl font-semibold text-xs shadow-xs transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {optimisticPost ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>{optimisticPost ? 'Publishing...' : 'Publish Now'}</span>
            </button>
            <button 
              type="button"
              onClick={() => handleCreatePost('draft')}
              disabled={activeTeam?.role === 'viewer' || !newPostContent || selectedPlatforms.length === 0 || optimisticPost !== null}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 py-2.5 rounded-xl font-semibold text-xs transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-1.5 shadow-xs"
            >
              <Bookmark className="w-3.5 h-3.5 text-slate-400" />
              <span>{optimisticPost ? 'Saving...' : 'Save Draft'}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
