'use client';

import { useState } from 'react';
import { useDashboard, type Post } from '@/components/DashboardProvider';
import { PlatformPreviewCard } from '@/components/post/PlatformPreviewCard';
import { MEDIA_SERVICE_URL, POST_SERVICE_URL, SCHEDULING_SERVICE_URL } from '@/lib/apiUrls';

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

  const [newPostContent, setNewPostContent] = useState('');
  const [scheduleAt, setScheduleAt] = useState(initialScheduleAt);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [previewPlatform, setPreviewPlatform] = useState<string | null>(null);
  const [contentType, setContentType] = useState<'post' | 'reel'>('post');
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
        formData.append('userId', user.id);
        formData.append('platforms', selectedPlatforms.join(','));
        formData.append('contentType', contentType);

        const mediaRes = await fetch(`${MEDIA_SERVICE_URL}/api/v1/media/upload`, {
          method: 'POST',
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, teamId: activeTeam.id, content: newPostContent, mediaUrl: JSON.stringify(mediaUrls) })
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: user.id,
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

  return (
    <div className={variant === 'modal' ? 'bg-white' : 'bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-24'}>
      <h2 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
        <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
        Compose Post
      </h2>
      
      <textarea
        className="w-full border border-gray-200 rounded-xl p-4 mb-5 text-gray-800 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none resize-none placeholder-gray-400"
        rows={5}
        placeholder="What's on your mind?"
        value={newPostContent}
        onChange={(e) => setNewPostContent(e.target.value)}
        disabled={activeTeam?.role === 'viewer'}
      />

      <div className="mb-5">
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Content Type</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input 
              type="radio" 
              name="contentType" 
              value="post" 
              checked={contentType === 'post'} 
              onChange={() => setContentType('post')} 
              disabled={activeTeam?.role === 'viewer'}
              className="w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
            />
            <span className="text-sm font-medium text-gray-700">Standard Post</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input 
              type="radio" 
              name="contentType" 
              value="reel" 
              checked={contentType === 'reel'} 
              onChange={() => setContentType('reel')} 
              disabled={activeTeam?.role === 'viewer'}
              className="w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
            />
            <span className="text-sm font-medium text-gray-700">Reel / Short</span>
          </label>
        </div>
      </div>
      
      <div className="mb-5">
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Select Platforms</label>
        <div className="flex flex-wrap gap-2">
          {['twitter', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'pinterest', 'threads'].map(p => {
            const isSelected = selectedPlatforms.includes(p);
            return (
              <button
                key={p}
                onClick={() => {
                  if (isSelected) setSelectedPlatforms(selectedPlatforms.filter(sp => sp !== p));
                  else setSelectedPlatforms([...selectedPlatforms, p]);
                }}
                disabled={activeTeam?.role === 'viewer'}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${isSelected ? 'bg-indigo-500 text-white shadow-md shadow-indigo-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                <span className="capitalize">{p}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="mb-5 space-y-4">
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Media</label>
            {mediaFile && (
              <button
                type="button"
                onClick={() => { setMediaFile(null); setMediaPreview(null); setFileInputKey(prev => prev + 1); }}
                className="text-[10px] text-red-500 font-bold hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors uppercase tracking-wider"
              >
                Remove File
              </button>
            )}
          </div>
          <input 
            key={fileInputKey}
            type="file" 
            accept="image/*,video/*"
            disabled={activeTeam?.role === 'viewer' || isPreviewLoading} 
            onChange={handleMediaChange} 
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 transition-all cursor-pointer mb-3" 
          />
          {isPreviewLoading && (
            <div className="flex items-center gap-3 text-sm text-indigo-600 font-semibold mb-3">
              <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              Generating universal web preview...
            </div>
          )}
          {(mediaPreview || newPostContent) && (
            <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50 mt-3 flex flex-col shadow-inner">
              {selectedPlatforms.length > 0 ? (
                <>
                  <div className="flex items-center gap-1 p-2 border-b border-gray-200 bg-white overflow-x-auto shrink-0">
                    <span className="text-xs font-bold text-gray-500 mr-2">Preview for:</span>
                    {selectedPlatforms.map(p => (
                      <button
                        key={p}
                        onClick={() => setPreviewPlatform(p)}
                        className={`text-[10px] px-3 py-1.5 rounded-md font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${activePreviewPlatform === p ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  
                  {/* In the modal the modal itself scrolls; a second inner scroll area made the preview cramped. */}
                  <div className={variant === 'modal' ? 'bg-gray-100 p-4 flex items-center justify-center' : 'flex-1 overflow-y-auto max-h-112.5 bg-gray-100 p-4 flex items-center justify-center'}>
                    <PlatformPreviewCard platform={activePreviewPlatform} content={newPostContent} mediaUrl={mediaPreview} isVideo={mediaFile?.type.startsWith('video/')} contentType={contentType} />
                  </div>
                </>
              ) : (
                <div className="p-8 text-center bg-white">
                  <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                     <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  </div>
                  <p className="text-sm text-gray-500 font-medium mb-1">Preview Unavailable</p>
                  <p className="text-xs text-gray-400">Select a platform above to preview your post</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Schedule</label>
          <input 
            type="datetime-local" 
            className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-700 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
            value={scheduleAt}
            disabled={activeTeam?.role === 'viewer'}
            onChange={(e) => setScheduleAt(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2 mt-2">
        {scheduleAt ? (
          <button 
            onClick={() => handleCreatePost('schedule')}
            disabled={activeTeam?.role === 'viewer' || !newPostContent || selectedPlatforms.length === 0 || optimisticPost !== null}
            className="w-full bg-linear-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:pointer-events-none"
          >
            {optimisticPost ? 'Scheduling...' : 'Schedule Post'}
          </button>
        ) : (
          <>
            <button 
              onClick={() => handleCreatePost('publish')}
              disabled={activeTeam?.role === 'viewer' || !newPostContent || selectedPlatforms.length === 0 || optimisticPost !== null}
              className="flex-1 bg-linear-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {optimisticPost ? 'Publishing...' : 'Publish Now'}
            </button>
            <button 
              onClick={() => handleCreatePost('draft')}
              disabled={activeTeam?.role === 'viewer' || !newPostContent || selectedPlatforms.length === 0 || optimisticPost !== null}
              className="flex-1 bg-white border-2 border-indigo-100 text-indigo-600 py-3 rounded-xl font-bold hover:bg-indigo-50 hover:border-indigo-200 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {optimisticPost ? 'Saving...' : 'Save Draft'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
