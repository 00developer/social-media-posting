'use client';

import { useState } from 'react';
import { useDashboard, type Post } from '@/components/DashboardProvider';

const getAspectRatioClass = (platform: string | null) => {
  switch (platform) {
    case 'twitter': return 'aspect-video';
    case 'youtube': return 'aspect-video';
    case 'instagram': return 'aspect-[4/5]';
    case 'tiktok': return 'aspect-[9/16]';
    case 'pinterest': return 'aspect-[2/3]';
    case 'linkedin': return 'aspect-[2/1]';
    default: return 'aspect-square';
  }
};

const PlatformPreviewCard = ({ platform, content, mediaUrl }: { platform: string | null, content: string, mediaUrl: string | null }) => {
  const renderHeader = () => (
    <div className="flex items-center gap-3 p-3">
      <div className="w-8 h-8 rounded-full bg-linear-to-tr from-indigo-100 to-purple-100 flex items-center justify-center border border-gray-200 shrink-0">
         <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
      </div>
      <div>
        <div className="h-2.5 w-24 bg-gray-800/10 rounded-full mb-1"></div>
        <div className="h-2 w-16 bg-gray-800/5 rounded-full"></div>
      </div>
      {platform === 'instagram' && (
         <div className="ml-auto flex gap-1">
           <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
           <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
           <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
         </div>
      )}
    </div>
  );

  const renderText = (className = "px-3 pb-3 text-[13px]") => {
    if (!content) return null;
    return (
      <div className={className}>
        <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">{content}</p>
      </div>
    );
  };

  const renderMedia = (className = "") => {
    if (!mediaUrl) return null;
    return (
      <div className={`w-full relative flex items-center justify-center bg-black/5 ${getAspectRatioClass(platform)} ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mediaUrl} className="object-cover w-full h-full" alt="Preview" />
      </div>
    );
  };

  const renderActionBar = (type = "default") => {
    if (type === 'instagram') return (
      <div className="flex items-center gap-4 p-3 pb-1">
         <div className="w-5 h-5 border-[1.5px] border-gray-800 rounded-full"></div>
         <div className="w-5 h-5 border-[1.5px] border-gray-800 rounded-full"></div>
         <div className="w-5 h-5 border-[1.5px] border-gray-800 rounded-full"></div>
         <div className="w-4 h-5 border-[1.5px] border-gray-800 ml-auto"></div>
      </div>
    );
    if (type === 'twitter') return (
      <div className="flex items-center justify-between p-3 pt-2 w-4/5 text-gray-400">
         <div className="w-4 h-4 bg-gray-400 rounded-full"></div>
         <div className="w-4 h-4 bg-gray-400 rounded-full"></div>
         <div className="w-4 h-4 bg-gray-400 rounded-full"></div>
         <div className="w-4 h-4 bg-gray-400 rounded-full"></div>
      </div>
    );
    return (
      <div className="flex items-center gap-4 p-3 pt-2">
         <div className="w-5 h-5 bg-gray-200 rounded-full"></div>
         <div className="w-5 h-5 bg-gray-200 rounded-full"></div>
         <div className="w-5 h-5 bg-gray-200 rounded-full"></div>
      </div>
    );
  };

  if (platform === 'instagram') {
    return (
      <div className="flex flex-col bg-white w-full border border-gray-200 shadow-sm mx-auto max-w-100">
        {renderHeader()}
        {renderMedia()}
        {renderActionBar("instagram")}
        {renderText("px-3 pb-4 pt-1 text-[13px]")}
      </div>
    );
  }

  if (platform === 'tiktok') {
    return (
      <div className="relative w-full max-w-75 mx-auto bg-black overflow-hidden flex items-center justify-center aspect-9/16 rounded-md shadow-md">
        {mediaUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={mediaUrl} className="object-cover w-full h-full opacity-90" alt="Preview" />
        ) : (
          <div className="w-full h-full bg-gray-900 flex items-center justify-center p-6 text-center">
             <span className="text-white/30 text-xs">Video content will appear here</span>
          </div>
        )}
        
        <div className="absolute right-3 bottom-24 flex flex-col gap-5 items-center">
           <div className="w-9 h-9 bg-white/20 backdrop-blur-sm rounded-full"></div>
           <div className="w-9 h-9 bg-white/20 backdrop-blur-sm rounded-full"></div>
           <div className="w-9 h-9 bg-white/20 backdrop-blur-sm rounded-full"></div>
        </div>
        
        <div className="absolute left-3 bottom-3 right-16">
          <div className="font-bold text-white text-sm mb-1.5 drop-shadow-md">@username</div>
          {content && (
            <p className="text-white text-[12px] whitespace-pre-wrap leading-snug line-clamp-3 drop-shadow-md">{content}</p>
          )}
        </div>
      </div>
    );
  }

  if (platform === 'pinterest') {
    return (
      <div className="flex flex-col bg-white w-full max-w-[320px] mx-auto p-4 rounded-3xl shadow-lg border border-gray-100">
        {mediaUrl && (
          <div className="rounded-2xl overflow-hidden mb-3">
            {renderMedia()}
          </div>
        )}
        {renderText("px-1 pb-2 text-[15px] font-bold text-gray-900")}
        <div className="flex items-center gap-2 px-1">
           <div className="w-6 h-6 bg-gray-200 rounded-full"></div>
           <div className="h-2 w-16 bg-gray-200 rounded-full"></div>
        </div>
      </div>
    );
  }

  // Default for Twitter, LinkedIn, Facebook, etc.
  return (
    <div className="flex flex-col bg-white w-full max-w-112.5 mx-auto border border-gray-100 shadow-sm rounded-xl overflow-hidden mt-2 mb-2">
      {renderHeader()}
      {renderText()}
      {mediaUrl && (
        <div className="px-3 pb-2">
          <div className="rounded-xl overflow-hidden border border-gray-100">
            {renderMedia()}
          </div>
        </div>
      )}
      {renderActionBar(platform === 'twitter' ? 'twitter' : 'default')}
    </div>
  );
};

export default function PostsPage() {
  const { user, activeTeam, posts, analytics, fetchTeamData } = useDashboard();
  
  const [newPostContent, setNewPostContent] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(Date.now());
  const [isPublishing, setIsPublishing] = useState(false);
  const [previewPlatform, setPreviewPlatform] = useState<string | null>(null);
  const [previewPost, setPreviewPost] = useState<Post | null>(null);
  const [contentType, setContentType] = useState<'post' | 'reel'>('post');

  const activePreviewPlatform = previewPlatform && selectedPlatforms.includes(previewPlatform) 
    ? previewPlatform 
    : (selectedPlatforms.length > 0 ? selectedPlatforms[0] : null);

  const handleMediaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setMediaFile(file);
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview);
    }
    if (file) {
      setMediaPreview(URL.createObjectURL(file));
    } else {
      setMediaPreview(null);
    }
  };

  const handleCreatePost = async (actionType: 'draft' | 'schedule' | 'publish') => {
    if (!user || !activeTeam) return;
    if (!newPostContent || selectedPlatforms.length === 0) {
      alert("Please enter content and select at least one platform.");
      return;
    }
    try {
      let mediaUrls = {};
      if (mediaFile) {
        const formData = new FormData();
        formData.append('file', mediaFile);
        formData.append('userId', user.id);
        formData.append('platforms', selectedPlatforms.join(','));
        formData.append('contentType', contentType);

        const mediaRes = await fetch(`http://localhost:3006/api/v1/media/upload`, {
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

      const res = await fetch(`http://localhost:3002/api/v1/posts`, {
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

          const scheduleRes = await fetch(`http://localhost:3004/api/v1/schedules`, {
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
        setFileInputKey(Date.now());
        setSelectedPlatforms([]);
        fetchTeamData();
      } else {
        alert(data.error);
      }
    } catch (e: any) {
      console.error(e);
      alert('Error creating post: ' + (e?.message || String(e)));
    }
  };

  const handlePublish = async (postId: string) => {
    if (!user || !activeTeam) return;
    const platformsStr = prompt("Enter platforms to publish to (comma separated, e.g. twitter,instagram):", "twitter");
    if (!platformsStr) return;
    
    const platforms = platformsStr.split(',').map(p => p.trim().toLowerCase());
    setIsPublishing(true);
    try {
      const res = await fetch(`http://localhost:3004/api/v1/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          postId: postId,
          platforms: platforms,
          scheduledAt: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Post queued for immediate publishing!');
      } else {
        alert('Failed to publish: ' + data.error);
      }
      fetchTeamData();
    } catch {
      alert('Error publishing post. Ensure Scheduling Service (port 3004) is running.');
    }
    setIsPublishing(false);
  };

  const handleDelete = async (postId: string) => {
    if (!user || !activeTeam) return;
    if (!confirm('Are you sure you want to delete this post?')) return;
    try {
      const res = await fetch(`http://localhost:3002/api/v1/posts/${postId}?userId=${user.id}&teamId=${activeTeam.id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchTeamData();
      } else {
        const data = await res.json();
        alert('Failed to delete: ' + data.error);
      }
    } catch {
      alert('Error deleting post.');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
      {/* Create Post Section */}
      <div className="xl:col-span-1">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-24">
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
              {['twitter', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'pinterest'].map(p => {
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
                    onClick={() => { setMediaFile(null); setMediaPreview(null); setFileInputKey(Date.now()); }}
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
                disabled={activeTeam?.role === 'viewer'} 
                onChange={handleMediaChange} 
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 transition-all cursor-pointer mb-3" 
              />
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
                      
                      <div className="flex-1 overflow-y-auto max-h-112.5 bg-gray-100 p-4 flex items-center justify-center">
                        <PlatformPreviewCard platform={activePreviewPlatform} content={newPostContent} mediaUrl={mediaPreview} />
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
                disabled={activeTeam?.role === 'viewer' || !newPostContent || selectedPlatforms.length === 0}
                className="w-full bg-linear-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                Schedule Post
              </button>
            ) : (
              <>
                <button 
                  onClick={() => handleCreatePost('publish')}
                  disabled={activeTeam?.role === 'viewer' || !newPostContent || selectedPlatforms.length === 0}
                  className="flex-1 bg-linear-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  Publish Now
                </button>
                <button 
                  onClick={() => handleCreatePost('draft')}
                  disabled={activeTeam?.role === 'viewer' || !newPostContent || selectedPlatforms.length === 0}
                  className="flex-1 bg-white border-2 border-indigo-100 text-indigo-600 py-3 rounded-xl font-bold hover:bg-indigo-50 hover:border-indigo-200 transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  Save Draft
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Timeline Section */}
      <div className="xl:col-span-2">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Your Timeline</h2>
          <span className="text-sm font-medium text-gray-500 bg-white px-3 py-1 rounded-full border border-gray-200 shadow-sm">{posts.length} Posts</span>
        </div>
        
        {posts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">No posts yet</h3>
            <p className="text-gray-500">Create a draft on the left to get started!</p>
          </div>
        ) : (
          <div className="space-y-5">
            {posts.map(post => {
              let mediaObj = null;
              try {
                if (post.media_url && (post.media_url as string) !== '{}') {
                  mediaObj = JSON.parse(post.media_url as string);
                  if (Object.keys(mediaObj).length === 0) mediaObj = null;
                }
              } catch {}

              return (
                <div key={post.id} onClick={() => setPreviewPost(post)} className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow group cursor-pointer hover:border-indigo-200">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-3">
                        <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          post.status === 'published' ? 'bg-green-50 text-green-700 border-green-200' : 
                          post.publish_jobs?.some((j: { status: string; error_message?: string }) => j.status === 'failed') ? 'bg-red-50 text-red-700 border-red-200' :
                          post.status === 'scheduled' ? 'bg-amber-50 text-amber-700 border-amber-200' : 
                          'bg-gray-100 text-gray-600 border-gray-200'
                        }`}>
                          {post.publish_jobs?.some((j: { status: string; error_message?: string }) => j.status === 'failed') ? 'FAILED' : post.status}
                        </div>
                        <span className="text-xs text-gray-400 font-medium">
                          {post.schedules && post.schedules.length > 0
                            ? new Date(post.schedules[0].scheduled_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                            : new Date(post.created_at as string).toLocaleDateString()}
                        </span>
                      </div>
                      {post.publish_jobs?.some((j: { status: string; error_message?: string }) => j.status === 'failed') && (
                        <div className="text-xs text-red-600 font-medium mt-1">
                          {post.publish_jobs.find((j: { status: string; error_message?: string }) => j.status === 'failed')?.error_message || 'Publishing failed'}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      {(post.status === 'draft' || post.publish_jobs?.some((j: { status: string; error_message?: string }) => j.status === 'failed')) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePublish(post.id); }}
                          disabled={isPublishing || activeTeam?.role === 'viewer'}
                          className="bg-gray-900 text-white px-3 py-1 rounded-md text-xs font-bold hover:bg-gray-800 transition-colors disabled:opacity-50 shadow-sm"
                        >
                          {isPublishing ? 'Publishing...' : (post.status === 'draft' ? 'Publish Now' : 'Retry Publish')}
                        </button>
                      )}
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDelete(post.id); }}
                        disabled={activeTeam?.role === 'viewer'}
                        className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors border border-transparent hover:border-red-100 bg-white"
                        title="Delete post"
                      >
                         <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                  
                  <p className="text-gray-800 text-base leading-relaxed whitespace-pre-wrap mb-4 line-clamp-3">{post.content}</p>
                  
                  {mediaObj && (
                     <div className="flex gap-2 overflow-hidden h-24 rounded-lg bg-gray-50 border border-gray-100 p-2">
                       {Object.entries(mediaObj).map(([platform, url]) => {
                         const isVideo = typeof url === 'string' && url.match(/\.(mp4|mov|webm)(\?.*)?$/i);
                         return (
                           <div key={platform} className={`relative bg-gray-200 rounded-md overflow-hidden ${getAspectRatioClass(platform)} h-full shrink-0`}>
                             {isVideo ? (
                               <video src={url as string} className="w-full h-full object-cover" muted loop playsInline autoPlay />
                             ) : (
                               /* eslint-disable-next-line @next/next/no-img-element */
                               <img src={url as string} alt={platform} className="w-full h-full object-cover" />
                             )}
                           </div>
                         );
                       })}
                     </div>
                  )}
                  
                  {post.status === 'scheduled' && analytics.filter(a => a.post_id === post.id).length > 0 && (
                    <div className="mt-6 pt-5 border-t border-gray-100">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Analytics</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {analytics.filter(a => a.post_id === post.id).map(stat => (
                          <div key={stat.id} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-sm font-bold text-gray-700 capitalize">{stat.platform}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <span className="block text-xl font-bold text-gray-900">{stat.views && stat.views > 1000 ? (stat.views/1000).toFixed(1) + 'k' : stat.views || 0}</span>
                                <span className="text-[10px] uppercase font-bold text-gray-500">Views</span>
                              </div>
                              <div>
                                <span className="block text-xl font-bold text-gray-900">{stat.likes || 0}</span>
                                <span className="text-[10px] uppercase font-bold text-gray-500">Likes</span>
                              </div>
                              <div>
                                <span className="block text-xl font-bold text-gray-900">{stat.shares || 0}</span>
                                <span className="text-[10px] uppercase font-bold text-gray-500">Shares</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* Preview Modal */}
      {previewPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPreviewPost(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white z-10 shadow-sm">
              <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                Post Previews
              </h3>
              <button onClick={() => setPreviewPost(null)} className="p-2 bg-gray-50 rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-900 shadow-sm transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-8 overflow-y-auto flex-1 bg-gray-100 custom-scrollbar">
              {(() => {
                let mediaObj = null;
                try {
                  if (previewPost.media_url && previewPost.media_url !== '{}') {
                    mediaObj = JSON.parse(previewPost.media_url);
                    if (Object.keys(mediaObj).length === 0) mediaObj = null;
                  }
                } catch {}

                if (mediaObj) {
                  return (
                    <div className="flex gap-8 justify-center flex-wrap">
                      {Object.entries(mediaObj).map(([platform, url]) => (
                        <div key={platform} className="shrink-0 w-full sm:w-87.5 md:w-100">
                          <div className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow-sm w-max mx-auto border border-gray-200">
                             <div className={`w-2.5 h-2.5 rounded-full ${platform === 'instagram' ? 'bg-pink-500' : platform === 'twitter' ? 'bg-blue-400' : platform === 'tiktok' ? 'bg-black' : platform === 'facebook' ? 'bg-blue-600' : 'bg-red-500'}`}></div>
                             {platform}
                          </div>
                          <PlatformPreviewCard platform={platform} content={previewPost.content || ''} mediaUrl={url as string} />
                        </div>
                      ))}
                    </div>
                  );
                } else {
                  return (
                     <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
                       <p className="text-gray-800 text-lg whitespace-pre-wrap leading-relaxed">{previewPost.content}</p>
                     </div>
                  );
                }
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
