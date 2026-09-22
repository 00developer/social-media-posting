'use client';

import { useState } from 'react';
import { useDashboard, type Post } from '@/components/DashboardProvider';
import { VideoPlayer, PlatformPreviewCard } from '@/components/post/PlatformPreviewCard';
import { getMediaFrame, getPostContentType } from '@/lib/mediaFrame';
import { PostComposer } from '@/components/post/PostComposer';
import { getPostStart } from '@/lib/calendarStatus';
import { getFailedPlatforms, getFailureLines, getRetryNotes, isPostFailed, retryButtonLabel, retryFailedPost } from '@/lib/postRetry';
import { POST_SERVICE_URL, SCHEDULING_SERVICE_URL } from '@/lib/apiUrls';

export default function PostsPage() {
  const { user, activeTeam, posts, analytics, fetchTeamData } = useDashboard();
  console.log('DEBUG POSTS:', posts);
  
  const [isPublishing, setIsPublishing] = useState(false);
  const [retryingPostId, setRetryingPostId] = useState<string | null>(null);
  const [previewPost, setPreviewPost] = useState<Post | null>(null);
  const [optimisticPost, setOptimisticPost] = useState<Partial<Post> | null>(null);

  const handlePublish = async (postId: string) => {
    if (!user || !activeTeam) return;
    const platformsStr = prompt("Enter platforms to publish to (comma separated, e.g. twitter,instagram):", "twitter");
    if (!platformsStr) return;
    
    const platforms = platformsStr.split(',').map(p => p.trim().toLowerCase());
    setIsPublishing(true);
    try {
      const res = await fetch(`${SCHEDULING_SERVICE_URL}/api/v1/schedules`, {
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

  const handleRetry = async (postId: string) => {
    if (!user || retryingPostId) return;
    setRetryingPostId(postId);
    const result = await retryFailedPost(user.id, postId);
    if (!result.ok) alert(result.error);
    await fetchTeamData();
    setRetryingPostId(null);
  };

  const handleDelete = async (postId: string) => {
    if (!user || !activeTeam) return;
    if (!confirm('Are you sure you want to delete this post?')) return;
    try {
      const res = await fetch(`${POST_SERVICE_URL}/api/v1/posts/${postId}?userId=${user.id}&teamId=${activeTeam.id}`, { method: 'DELETE' });
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
        <PostComposer onOptimisticChange={setOptimisticPost} />
      </div>

      {/* Timeline Section */}
      <div className="xl:col-span-2">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Your Timeline</h2>
          <span className="text-sm font-medium text-gray-500 bg-white px-3 py-1 rounded-full border border-gray-200 shadow-sm">{posts.length} Posts</span>
        </div>
        
        {posts.length === 0 && !optimisticPost ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">No posts yet</h3>
            <p className="text-gray-500">Create a draft on the left to get started!</p>
          </div>
        ) : (
          <div className="space-y-5">
            {(optimisticPost ? [optimisticPost as Post, ...posts] : posts).map(post => {
              let mediaObj = null;
              try {
                if (post.media_url && (post.media_url as string) !== '{}') {
                  mediaObj = JSON.parse(post.media_url as string);
                  if (Object.keys(mediaObj).length === 0) mediaObj = null;
                }
              } catch {}

              const failed = isPostFailed(post);
              const failedPlatforms = getFailedPlatforms(post);
              const failureLines = getFailureLines(post);
              const retryNotes = getRetryNotes(post);
              const retrying = retryingPostId === post.id;

              return (
                <div key={post.id} onClick={() => post.status !== 'uploading' && setPreviewPost(post)} className={`bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow group ${post.status !== 'uploading' ? 'cursor-pointer hover:border-indigo-200' : ''} ${post.status === 'uploading' ? 'relative opacity-70 pointer-events-none' : ''}`}>
                  {post.status === 'uploading' && (
                    <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/30 backdrop-blur-[1px] rounded-2xl">
                      <div className="flex flex-col items-center">
                        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                        <span className="mt-2 text-sm font-bold text-indigo-700">Uploading...</span>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-3">
                        <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          post.status === 'published' ? 'bg-green-50 text-green-700 border-green-200' : 
                          post.status === 'uploading' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                          failed ? 'bg-red-50 text-red-700 border-red-200' :
                          post.status === 'scheduled' ? 'bg-amber-50 text-amber-700 border-amber-200' : 
                          'bg-gray-100 text-gray-600 border-gray-200'
                        }`}>
                          {failed ? 'FAILED' : post.status}
                        </div>
                        <span className="text-xs text-gray-400 font-medium">
                          {post.schedules && post.schedules.length > 0
                            ? new Date(getPostStart(post) as string).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                            : new Date(post.created_at as string).toLocaleDateString()}
                        </span>
                      </div>
                      {failed && (
                        <div className="text-xs text-red-600 font-medium mt-1 space-y-0.5">
                          {failureLines.length > 0
                            ? failureLines.map((l) => <div key={l.platform}><span className="capitalize font-bold">{l.platform}:</span> {l.error}</div>)
                            : <div>Publishing failed</div>}
                        </div>
                      )}
                      {retryNotes.length > 0 && (
                        <div className="text-xs text-amber-700 font-medium mt-1 space-y-0.5">
                          {retryNotes.map((n) => <div key={n.platform}><span className="capitalize font-bold">{n.platform}:</span> {n.note}</div>)}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      {post.status === 'draft' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePublish(post.id); }}
                          disabled={isPublishing || activeTeam?.role === 'viewer'}
                          className="bg-gray-900 text-white px-3 py-1 rounded-md text-xs font-bold hover:bg-gray-800 transition-colors disabled:opacity-50 shadow-sm"
                        >
                          {isPublishing ? 'Publishing...' : 'Publish Now'}
                        </button>
                      )}
                      {failedPlatforms.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRetry(post.id); }}
                          disabled={retrying || !!retryingPostId || activeTeam?.role === 'viewer'}
                          className="bg-red-600 text-white px-3 py-1 rounded-md text-xs font-bold hover:bg-red-700 transition-colors disabled:opacity-50 shadow-sm"
                        >
                          {retryButtonLabel(failedPlatforms.length, retrying)}
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
                         const isVideo = typeof url === 'string' && (!!url.match(/\.(mp4|mov|webm)(\?.*)?$/i) || url.endsWith('#video'));
                         // Same rules as the previews: a fixed frame where the post is cropped / a reel is vertical,
                         // otherwise the media's own ratio.
                         const frame = getMediaFrame(platform, isVideo, getPostContentType(post));
                         const mediaClass = frame.ratio ? `w-full h-full ${frame.fit === 'cover' ? 'object-cover' : 'object-contain'}` : 'h-full w-auto';
                         return (
                           <div key={platform} className="relative bg-black rounded-md overflow-hidden h-full shrink-0" style={frame.ratio ? { aspectRatio: `${frame.ratio.w} / ${frame.ratio.h}` } : undefined}>
                             {isVideo ? (
                               <VideoPlayer key={url as string} src={url as string} className={mediaClass} />
                             ) : (
                               /* eslint-disable-next-line @next/next/no-img-element */
                               <img src={url as string} alt={platform} className={mediaClass} />
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
                      {Object.entries(mediaObj).map(([platform, url]) => {
                        const isVideo = typeof url === 'string' && (!!url.match(/\.(mp4|mov|webm)(\?.*)?$/i) || url.endsWith('#video'));
                        return (
                          <div key={platform} className="shrink-0 w-full sm:w-87.5 md:w-100">
                            <div className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow-sm w-max mx-auto border border-gray-200">
                               <div className={`w-2.5 h-2.5 rounded-full ${platform === 'instagram' ? 'bg-pink-500' : platform === 'twitter' ? 'bg-blue-400' : platform === 'tiktok' ? 'bg-black' : platform === 'facebook' ? 'bg-blue-600' : 'bg-red-500'}`}></div>
                               {platform}
                            </div>
                            <PlatformPreviewCard platform={platform} content={previewPost.content || ''} mediaUrl={url as string} isVideo={isVideo} contentType={getPostContentType(previewPost)} />
                          </div>
                        );
                      })}
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
