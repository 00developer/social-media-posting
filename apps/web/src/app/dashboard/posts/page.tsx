'use client';

import { useState } from 'react';
import { useDashboard, type Post } from '@/components/DashboardProvider';
import { VideoPlayer, PlatformPreviewCard } from '@/components/post/PlatformPreviewCard';
import { getMediaFrame, getPostContentType } from '@/lib/mediaFrame';
import { PostComposer } from '@/components/post/PostComposer';
import { getPostStart } from '@/lib/calendarStatus';
import { getFailedPlatforms, getFailureLines, getRetryNotes, isPostFailed, retryButtonLabel, retryFailedPost } from '@/lib/postRetry';
import { POST_SERVICE_URL, SCHEDULING_SERVICE_URL } from '@/lib/apiUrls';
import { authHeader } from '@/lib/supabase';
import {
  RotateCw,
  Send,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Eye,
  X,
  ChevronDown,
  ChevronUp,
  Inbox
} from 'lucide-react';

function cleanErrorMessage(raw: string): { summary: string; detail?: string } {
  if (!raw) return { summary: 'Publishing failed' };
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error?.message) {
        const full = parsed.error.message as string;
        const firstSentence = full.split('.')[0] + '.';
        return { summary: firstSentence, detail: full };
      }
    }
  } catch {}
  if (raw.length > 140) {
    return { summary: raw.slice(0, 140) + '...', detail: raw };
  }
  return { summary: raw };
}

export default function PostsPage() {
  const { user, activeTeam, posts, fetchTeamData } = useDashboard();
  
  const [isPublishing, setIsPublishing] = useState(false);
  const [retryingPostId, setRetryingPostId] = useState<string | null>(null);
  const [previewPost, setPreviewPost] = useState<Post | null>(null);
  const [optimisticPost, setOptimisticPost] = useState<Partial<Post> | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'scheduled' | 'failed' | 'draft'>('all');
  const [visibleCount, setVisibleCount] = useState(3);
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});

  const handleFilterChange = (filter: 'all' | 'published' | 'scheduled' | 'failed' | 'draft') => {
    setStatusFilter(filter);
    setVisibleCount(3);
  };

  const toggleErrorExpand = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    setExpandedErrors(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePublish = async (postId: string, presetPlatforms: string[] = [], postContentType: 'post' | 'reel' = 'post') => {
    if (!user || !activeTeam) return;

    let platforms = presetPlatforms;
    if (!platforms || platforms.length === 0) {
      const platformsStr = prompt("Enter platforms to publish to (comma separated, e.g. twitter,instagram):", "twitter");
      if (!platformsStr) return;
      platforms = platformsStr.split(',').map(p => p.trim().toLowerCase());
    }
    if (platforms.length === 0) return;
    setIsPublishing(true);
    try {
      const res = await fetch(`${SCHEDULING_SERVICE_URL}/api/v1/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          postId: postId,
          platforms: platforms,
          scheduledAt: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          contentType: postContentType
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
    const result = await retryFailedPost(postId);
    if (!result.ok) alert(result.error);
    await fetchTeamData();
    setRetryingPostId(null);
  };

  const handleDelete = async (postId: string) => {
    if (!user || !activeTeam) return;
    if (!confirm('Are you sure you want to delete this post?')) return;
    try {
      const res = await fetch(`${POST_SERVICE_URL}/api/v1/posts/${postId}?teamId=${activeTeam.id}`, { method: 'DELETE', headers: await authHeader() });
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

  const allPosts = optimisticPost ? [optimisticPost as Post, ...posts] : posts;
  const filteredPosts = allPosts.filter(p => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'failed') return isPostFailed(p);
    return p.status === statusFilter;
  });

  const displayedPosts = filteredPosts.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPosts.length;

  const totalCount = posts.length;
  const publishedCount = posts.filter(p => p.status === 'published').length;
  const scheduledCount = posts.filter(p => p.status === 'scheduled').length;
  const failedCount = posts.filter(p => isPostFailed(p)).length;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
      {/* Create Post Section */}
      <div className="xl:col-span-1">
        <PostComposer onOptimisticChange={setOptimisticPost} />
      </div>

      {/* Timeline Section */}
      <div className="xl:col-span-2 space-y-5">
        {/* Interactive Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => handleFilterChange('all')}
            className={`p-3.5 rounded-xl border text-left cursor-pointer transition-colors ${
              statusFilter === 'all'
                ? 'bg-slate-800 text-white border-slate-700'
                : 'bg-[#0d131f] hover:bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${statusFilter === 'all' ? 'text-slate-200' : 'text-slate-400'}`}>
                All Posts
              </span>
              <FileText className={`w-3.5 h-3.5 ${statusFilter === 'all' ? 'text-slate-200' : 'text-slate-400'}`} />
            </div>
            <p className="text-xl font-bold tracking-tight text-white">{totalCount}</p>
          </button>

          <button
            type="button"
            onClick={() => handleFilterChange('published')}
            className={`p-3.5 rounded-xl border text-left cursor-pointer transition-colors ${
              statusFilter === 'published'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-[#0d131f] hover:bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${statusFilter === 'published' ? 'text-emerald-300' : 'text-emerald-400'}`}>
                Published
              </span>
              <CheckCircle2 className={`w-3.5 h-3.5 ${statusFilter === 'published' ? 'text-emerald-300' : 'text-emerald-400'}`} />
            </div>
            <p className="text-xl font-bold tracking-tight text-white">{publishedCount}</p>
          </button>

          <button
            type="button"
            onClick={() => handleFilterChange('scheduled')}
            className={`p-3.5 rounded-xl border text-left cursor-pointer transition-colors ${
              statusFilter === 'scheduled'
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : 'bg-[#0d131f] hover:bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${statusFilter === 'scheduled' ? 'text-amber-300' : 'text-amber-400'}`}>
                Scheduled
              </span>
              <Clock className={`w-3.5 h-3.5 ${statusFilter === 'scheduled' ? 'text-amber-300' : 'text-amber-400'}`} />
            </div>
            <p className="text-xl font-bold tracking-tight text-white">{scheduledCount}</p>
          </button>

          <button
            type="button"
            onClick={() => handleFilterChange('failed')}
            className={`p-3.5 rounded-xl border text-left cursor-pointer transition-colors ${
              statusFilter === 'failed'
                ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                : 'bg-[#0d131f] hover:bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${statusFilter === 'failed' ? 'text-rose-300' : 'text-rose-400'}`}>
                Issues
              </span>
              <AlertCircle className={`w-3.5 h-3.5 ${statusFilter === 'failed' ? 'text-rose-300' : 'text-rose-400'}`} />
            </div>
            <p className="text-xl font-bold tracking-tight text-white">{failedCount}</p>
          </button>
        </div>

        {/* Timeline Header Bar */}
        <div className="bg-[#0d131f] rounded-xl border border-slate-800 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-white tracking-tight">Posts Timeline</h2>
            <span className="text-[10px] font-medium text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700/60">
              {displayedPosts.length} of {filteredPosts.length} posts
            </span>
          </div>

          {/* Quick Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar text-xs">
            {(['all', 'published', 'scheduled', 'failed', 'draft'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => handleFilterChange(tab)}
                className={`px-2.5 py-1 rounded-lg capitalize transition-colors whitespace-nowrap text-xs ${
                  statusFilter === tab
                    ? 'bg-slate-800 text-white font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
                }`}
              >
                {tab === 'failed' ? 'issues' : tab}
              </button>
            ))}
          </div>
        </div>
        
        {filteredPosts.length === 0 ? (
          <div className="bg-[#0e1322]/90 backdrop-blur-2xl rounded-3xl border border-slate-800/80 p-14 text-center shadow-xl">
            <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center mx-auto mb-3 text-indigo-400 border border-indigo-500/20">
              <Inbox className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">
              {statusFilter === 'all' ? 'No posts yet' : `No ${statusFilter} posts found`}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {statusFilter === 'all'
                ? 'Create a draft using the composer on the left to start publishing across your networks.'
                : `You currently do not have any items filtered under "${statusFilter}".`}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {displayedPosts.map(post => {
              let mediaObj: Record<string, string> | null = null;
              try {
                if (post.media_url && (post.media_url as string) !== '{}') {
                  mediaObj = JSON.parse(post.media_url as string);
                  if (Object.keys(mediaObj || {}).length === 0) mediaObj = null;
                }
              } catch {}

              const failed = isPostFailed(post);
              const failedPlatforms = getFailedPlatforms(post);
              const failureLines = getFailureLines(post);
              const retryNotes = getRetryNotes(post);
              const retrying = retryingPostId === post.id;

              const cardPlatforms = Array.from(new Set([
                ...(post.schedules?.map(s => s.platform) || []),
                ...(mediaObj ? Object.keys(mediaObj) : [])
              ]));

              const borderAccent = failed
                ? 'border-l-4 border-l-rose-500'
                : post.status === 'published'
                ? 'border-l-4 border-l-emerald-500'
                : post.status === 'scheduled'
                ? 'border-l-4 border-l-amber-500'
                : 'border-l-4 border-l-slate-600';

              return (
                <div
                  key={post.id}
                  onClick={() => post.status !== 'uploading' && setPreviewPost(post)}
                  className={`bg-[#0e1322]/90 backdrop-blur-2xl rounded-2xl border border-slate-800/80 p-5 shadow-xl hover:border-slate-700 hover:-translate-y-0.5 transition-all duration-200 group ${borderAccent} ${
                    post.status !== 'uploading' ? 'cursor-pointer' : ''
                  } ${post.status === 'uploading' ? 'relative opacity-70 pointer-events-none' : ''}`}
                >
                  {post.status === 'uploading' && (
                    <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#090d16]/80 backdrop-blur-[2px] rounded-2xl">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <span className="mt-2 text-xs font-bold text-indigo-400">Uploading media...</span>
                      </div>
                    </div>
                  )}

                  {/* Header Row */}
                  <div className="flex justify-between items-start mb-3 gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Status Badges */}
                      {post.status === 'published' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shadow-[0_0_8px_rgba(16,185,129,0.2)]">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          Published
                        </span>
                      )}
                      {post.status === 'scheduled' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60 shadow-[0_0_8px_rgba(245,158,11,0.2)]">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          Scheduled
                        </span>
                      )}
                      {failed && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/60 shadow-[0_0_8px_rgba(244,63,94,0.2)]">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                          Delivery Failed
                        </span>
                      )}
                      {post.status === 'draft' && !failed && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                          <FileText className="w-3.5 h-3.5 text-slate-400" />
                          Draft
                        </span>
                      )}

                      <span className="text-[11px] text-slate-400 font-medium">
                        {post.schedules && post.schedules.length > 0
                          ? new Date(getPostStart(post) as string).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                          : new Date(post.created_at as string).toLocaleDateString()}
                      </span>

                      {/* Destination Platform Badges */}
                      {cardPlatforms.length > 0 && (
                        <div className="hidden sm:flex items-center gap-1">
                          {cardPlatforms.map(plat => (
                            <span
                              key={plat}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-900 text-slate-300 border border-slate-800"
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                plat === 'youtube' ? 'bg-red-500' :
                                plat === 'instagram' ? 'bg-pink-500' :
                                plat === 'facebook' ? 'bg-blue-500' :
                                plat === 'twitter' ? 'bg-sky-400' : 'bg-slate-400'
                              }`} />
                              {plat}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      {post.status === 'draft' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const isVideoMedia = !!(mediaObj && Object.values(mediaObj).some(url => typeof url === 'string' && (/\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(url) || url.includes('/video'))));
                            const postContentType = (isVideoMedia || getPostContentType(post) === 'reel') ? 'reel' : 'post';
                            handlePublish(post.id, cardPlatforms, postContentType);
                          }}
                          disabled={isPublishing || activeTeam?.role === 'viewer'}
                          className="inline-flex items-center gap-1 bg-white text-slate-950 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all disabled:opacity-50 shadow-md"
                        >
                          <Send className="w-3 h-3" />
                          {isPublishing ? 'Publishing...' : 'Publish'}
                        </button>
                      )}
                      {failedPlatforms.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRetry(post.id); }}
                          disabled={retrying || !!retryingPostId || activeTeam?.role === 'viewer'}
                          className="inline-flex items-center gap-1.5 bg-rose-600 text-white px-3 py-1.5 rounded-xl text-xs font-semibold hover:bg-rose-500 transition-all disabled:opacity-50 shadow-sm shadow-rose-600/30"
                        >
                          <RotateCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
                          {retryButtonLabel(failedPlatforms.length, retrying)}
                        </button>
                      )}
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDelete(post.id); }}
                        disabled={activeTeam?.role === 'viewer'}
                        className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                        title="Delete post"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Clean Error Presentation */}
                  {failed && (
                    <div className="mb-3.5 p-3 rounded-xl bg-rose-950/30 border border-rose-800/60 text-xs text-rose-200">
                      {failureLines.length > 0 ? (
                        failureLines.map((l, idx) => {
                          const errInfo = cleanErrorMessage(l.error);
                          const errKey = `${post.id}-${idx}`;
                          const isExpanded = !!expandedErrors[errKey];

                          return (
                            <div key={l.platform} className="space-y-1">
                              <div className="flex items-start justify-between gap-2 text-rose-200">
                                <div>
                                  <span className="font-bold capitalize">{l.platform}: </span>
                                  <span>{errInfo.summary}</span>
                                </div>
                                {errInfo.detail && (
                                  <button
                                    onClick={(e) => toggleErrorExpand(e, errKey)}
                                    className="text-[11px] font-semibold text-rose-400 hover:text-rose-300 underline shrink-0 flex items-center gap-0.5"
                                  >
                                    {isExpanded ? 'Less' : 'Details'}
                                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                  </button>
                                )}
                              </div>
                              {isExpanded && errInfo.detail && (
                                <pre className="mt-2 p-2 rounded-lg bg-rose-950/70 border border-rose-800 text-rose-200 font-mono text-[10px] whitespace-pre-wrap break-all overflow-x-auto max-h-40">
                                  {errInfo.detail}
                                </pre>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-rose-300 font-medium">Publishing failed. Check account credentials or retry.</div>
                      )}
                    </div>
                  )}

                  {retryNotes.length > 0 && (
                    <div className="mb-3 p-2.5 rounded-xl bg-amber-950/30 border border-amber-800/60 text-xs text-amber-200 space-y-0.5">
                      {retryNotes.map((n) => (
                        <div key={n.platform}>
                          <span className="font-bold capitalize">{n.platform}: </span> {n.note}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Post Content */}
                  <p className="text-slate-100 text-sm leading-relaxed whitespace-pre-wrap mb-3.5 line-clamp-3">
                    {post.content}
                  </p>
                  
                  {/* Media Strip */}
                  {mediaObj && (
                    <div className="flex gap-2 overflow-hidden h-24 rounded-xl bg-slate-900 border border-slate-800 p-2">
                      {Object.entries(mediaObj).map(([platform, url]) => {
                        const isVideo = typeof url === 'string' && (!!url.match(/\.(mp4|mov|webm)(\?.*)?$/i) || url.endsWith('#video'));
                        const frame = getMediaFrame(platform, isVideo, getPostContentType(post));
                        const mediaClass = frame.ratio ? `w-full h-full ${frame.fit === 'cover' ? 'object-cover' : 'object-contain'}` : 'h-full w-auto';
                        
                        return (
                          <div
                            key={platform}
                            className="relative bg-slate-900 rounded-lg overflow-hidden h-full shrink-0 group/media"
                            style={frame.ratio ? { aspectRatio: `${frame.ratio.w} / ${frame.ratio.h}` } : undefined}
                          >
                            {isVideo ? (
                              <VideoPlayer key={url as string} src={url as string} className={mediaClass} />
                            ) : (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img src={url as string} alt={platform} className={mediaClass} />
                            )}
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/media:opacity-100 transition-opacity flex items-center justify-center text-white">
                              <Eye className="w-4 h-4" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {hasMore && (
              <div className="pt-2 pb-1 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount(prev => prev + 3)}
                  className="inline-flex items-center gap-2.5 px-6 py-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-800 hover:border-slate-700 text-xs font-semibold shadow-lg hover:shadow-indigo-500/10 transition-all cursor-pointer group"
                >
                  <ChevronDown className="w-4 h-4 text-indigo-400 group-hover:translate-y-0.5 transition-transform" />
                  <span>Load More Posts</span>
                  <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700/60 font-medium">
                    +{filteredPosts.length - visibleCount} remaining
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Preview Modal */}
      {previewPost && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-md p-4 animate-in fade-in duration-200"
          onClick={() => setPreviewPost(null)}
        >
          <div
            className="bg-[#0e1322] rounded-3xl shadow-2xl border border-slate-800 w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden text-slate-100"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#0e1322] z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
                  <Eye className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Multi-Platform Preview</h3>
                  <p className="text-[11px] text-slate-400">Live preview of how content renders across connected channels</p>
                </div>
              </div>
              <button
                onClick={() => setPreviewPost(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-8 overflow-y-auto flex-1 bg-[#090d16] custom-scrollbar">
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
                            <div className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2 bg-slate-900 px-3.5 py-1.5 rounded-full shadow-xs w-max mx-auto border border-slate-800">
                              <div className={`w-2 h-2 rounded-full ${platform === 'instagram' ? 'bg-pink-500' : platform === 'twitter' ? 'bg-sky-400' : platform === 'tiktok' ? 'bg-slate-400' : platform === 'facebook' ? 'bg-blue-600' : 'bg-red-600'}`} />
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
                    <div className="max-w-2xl mx-auto bg-slate-900 p-8 rounded-2xl shadow-xl border border-slate-800">
                      <p className="text-slate-100 text-base whitespace-pre-wrap leading-relaxed">{previewPost.content}</p>
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
