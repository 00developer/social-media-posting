'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDashboard, type Post } from '@/components/DashboardProvider';
import { VideoPlayer, PlatformPreviewCard } from '@/components/post/PlatformPreviewCard';
import { getMediaFrame, getPostContentType } from '@/lib/mediaFrame';
import { PostComposer } from '@/components/post/PostComposer';
import { getPostStart } from '@/lib/calendarStatus';
import { getFailedPlatforms, getFailureLines, getRetryNotes, isPostFailed, retryButtonLabel, retryFailedPost } from '@/lib/postRetry';
import { POST_SERVICE_URL, SCHEDULING_SERVICE_URL } from '@/lib/apiUrls';
import { authHeader } from '@/lib/supabase';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { useConfirm, useToast } from '@/components/ui/Toast';
import { PlatformPickerDialog } from '@/components/post/PlatformPickerDialog';
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
  const { user, activeTeam, posts, accounts, fetchTeamData, dataLoaded } = useDashboard();
  const toast = useToast();
  const confirm = useConfirm();

  // Per-post flags, so only the card being acted on shows "Publishing..." / "Deleting...".
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  // A draft with no platform attached: ask which platforms to publish to (replaces the old prompt()).
  const [pickerFor, setPickerFor] = useState<{ postId: string; contentType: 'post' | 'reel' } | null>(null);
  const connectedPlatforms = useMemo(() => [...new Set(accounts.map((a) => a.platform).filter((p): p is string => !!p))], [accounts]);
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

  const queuePublish = async (postId: string, platforms: string[], postContentType: 'post' | 'reel') => {
    if (!user || !activeTeam || platforms.length === 0 || publishingPostId) return;
    setPublishingPostId(postId);
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
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        toast.success('Post queued for immediate publishing.');
      } else {
        toast.error(`Failed to publish: ${data.error || `request failed (${res.status})`}`);
      }
      await fetchTeamData();
    } catch {
      toast.error('Error publishing post. Check that the scheduling service is running.');
    } finally {
      setPublishingPostId(null);
    }
  };

  const handlePublish = (postId: string, presetPlatforms: string[] = [], postContentType: 'post' | 'reel' = 'post') => {
    if (!user || !activeTeam || publishingPostId) return;
    if (presetPlatforms.length === 0) {
      setPickerFor({ postId, contentType: postContentType });
      return;
    }
    void queuePublish(postId, presetPlatforms, postContentType);
  };

  const handleRetry = async (postId: string) => {
    if (!user || retryingPostId) return;
    setRetryingPostId(postId);
    try {
      const result = await retryFailedPost(postId);
      if (!result.ok) toast.error(result.error);
      else toast.success('Retry queued.');
      await fetchTeamData();
    } finally {
      setRetryingPostId(null);
    }
  };

  const handleDelete = async (postId: string) => {
    if (!user || !activeTeam || deletingPostId) return;
    const ok = await confirm({
      title: 'Delete this post?',
      description: 'The post and its schedules are removed from SocialPush. Posts already published on a platform stay there.',
      confirmLabel: 'Delete post',
      destructive: true,
    });
    if (!ok) return;
    setDeletingPostId(postId);
    try {
      const res = await fetch(`${POST_SERVICE_URL}/api/v1/posts/${postId}?teamId=${activeTeam.id}`, { method: 'DELETE', headers: await authHeader() });
      if (res.ok) {
        if (previewPost?.id === postId) setPreviewPost(null);
        toast.success('Post deleted.');
        await fetchTeamData();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(`Failed to delete: ${data.error || `request failed (${res.status})`}`);
      }
    } catch {
      toast.error('Error deleting post.');
    } finally {
      setDeletingPostId(null);
    }
  };

  // Preview modal: close on Escape.
  useEffect(() => {
    if (!previewPost) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewPost(null); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [previewPost]);

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
                ? 'bg-surface-hover text-fg border-line-strong'
                : 'bg-surface hover:bg-surface-hover border-line hover:border-line-strong text-fg'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${statusFilter === 'all' ? 'text-fg' : 'text-fg-muted'}`}>
                All Posts
              </span>
              <FileText className={`w-3.5 h-3.5 ${statusFilter === 'all' ? 'text-fg' : 'text-fg-muted'}`} />
            </div>
            <p className="text-xl font-bold tracking-tight text-fg">{totalCount}</p>
          </button>

          <button
            type="button"
            onClick={() => handleFilterChange('published')}
            className={`p-3.5 rounded-xl border text-left cursor-pointer transition-colors ${
              statusFilter === 'published'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                : 'bg-surface hover:bg-surface-hover border-line hover:border-line-strong text-fg'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${statusFilter === 'published' ? 'text-emerald-700 dark:text-emerald-300' : 'text-emerald-700 dark:text-emerald-400'}`}>
                Published
              </span>
              <CheckCircle2 className={`w-3.5 h-3.5 ${statusFilter === 'published' ? 'text-emerald-700 dark:text-emerald-300' : 'text-emerald-700 dark:text-emerald-400'}`} />
            </div>
            <p className="text-xl font-bold tracking-tight text-fg">{publishedCount}</p>
          </button>

          <button
            type="button"
            onClick={() => handleFilterChange('scheduled')}
            className={`p-3.5 rounded-xl border text-left cursor-pointer transition-colors ${
              statusFilter === 'scheduled'
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                : 'bg-surface hover:bg-surface-hover border-line hover:border-line-strong text-fg'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${statusFilter === 'scheduled' ? 'text-amber-700 dark:text-amber-300' : 'text-amber-700 dark:text-amber-400'}`}>
                Scheduled
              </span>
              <Clock className={`w-3.5 h-3.5 ${statusFilter === 'scheduled' ? 'text-amber-700 dark:text-amber-300' : 'text-amber-700 dark:text-amber-400'}`} />
            </div>
            <p className="text-xl font-bold tracking-tight text-fg">{scheduledCount}</p>
          </button>

          <button
            type="button"
            onClick={() => handleFilterChange('failed')}
            className={`p-3.5 rounded-xl border text-left cursor-pointer transition-colors ${
              statusFilter === 'failed'
                ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
                : 'bg-surface hover:bg-surface-hover border-line hover:border-line-strong text-fg'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${statusFilter === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'text-rose-700 dark:text-rose-400'}`}>
                Issues
              </span>
              <AlertCircle className={`w-3.5 h-3.5 ${statusFilter === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'text-rose-700 dark:text-rose-400'}`} />
            </div>
            <p className="text-xl font-bold tracking-tight text-fg">{failedCount}</p>
          </button>
        </div>

        {/* Timeline Header Bar */}
        <div className="bg-surface rounded-xl border border-line p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-fg tracking-tight">Posts Timeline</h2>
            <span className="text-[10px] font-medium text-fg-muted bg-surface-hover px-2 py-0.5 rounded-md border border-line-strong">
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
                    ? 'bg-surface-hover text-fg font-medium'
                    : 'text-fg-muted hover:text-fg hover:bg-surface-hover/40'
                }`}
              >
                {tab === 'failed' ? 'issues' : tab}
              </button>
            ))}
          </div>
        </div>

        {!dataLoaded && !optimisticPost ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading posts">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-line border-l-4 border-l-slate-700 bg-surface p-5 animate-pulse">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-5 w-20 rounded-full bg-surface-hover" />
                  <div className="h-3 w-24 rounded bg-surface-hover/70" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full rounded bg-surface-hover/80" />
                  <div className="h-3 w-5/6 rounded bg-surface-hover/80" />
                  <div className="h-3 w-2/3 rounded bg-surface-hover/60" />
                </div>
              </div>
            ))}
            <span className="sr-only">Loading posts...</span>
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="bg-surface rounded-3xl border border-line p-14 text-center shadow-card">
            <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center mx-auto mb-3 text-accent border border-indigo-500/20">
              <Inbox className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-fg mb-1">
              {statusFilter === 'all' ? 'No posts yet' : `No ${statusFilter} posts found`}
            </h3>
            <p className="text-xs text-fg-muted max-w-sm mx-auto">
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
              const publishing = publishingPostId === post.id;
              const deleting = deletingPostId === post.id;
              const isViewer = activeTeam?.role === 'viewer';
              const clickable = post.status !== 'uploading';

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
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={clickable ? `Preview post: ${(post.content || '').slice(0, 60) || 'media post'}` : undefined}
                  onClick={() => clickable && setPreviewPost(post)}
                  onKeyDown={(e) => {
                    if (!clickable || e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPreviewPost(post);
                    }
                  }}
                  className={`relative bg-surface rounded-2xl border border-line p-4 sm:p-5 shadow-card hover:border-line-strong hover:-translate-y-0.5 transition-all duration-200 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${borderAccent} ${
                    clickable ? 'cursor-pointer' : 'opacity-70 pointer-events-none'
                  }`}
                >
                  {post.status === 'uploading' && (
                    <div className="absolute inset-0 flex items-center justify-center z-10 bg-canvas/80 backdrop-blur-[2px] rounded-2xl">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <span className="mt-2 text-xs font-bold text-accent">Uploading media...</span>
                      </div>
                    </div>
                  )}

                  {/* Header Row */}
                  <div className="flex flex-wrap justify-between items-start mb-3 gap-3">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      {/* Status Badges */}
                      {post.status === 'published' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 shadow-[0_0_8px_rgba(16,185,129,0.2)]">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                          Published
                        </span>
                      )}
                      {post.status === 'scheduled' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 shadow-[0_0_8px_rgba(245,158,11,0.2)]">
                          <Clock className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                          Scheduled
                        </span>
                      )}
                      {failed && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 shadow-[0_0_8px_rgba(244,63,94,0.2)]">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400 animate-pulse" />
                          Delivery Failed
                        </span>
                      )}
                      {post.status === 'draft' && !failed && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-hover text-fg-secondary border border-line-strong">
                          <FileText className="w-3.5 h-3.5 text-fg-muted" />
                          Draft
                        </span>
                      )}

                      <span className="text-[11px] text-fg-muted font-medium">
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
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-surface-muted text-fg-secondary border border-line"
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
                    <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                      {post.status === 'draft' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const isVideoMedia = !!(mediaObj && Object.values(mediaObj).some(url => typeof url === 'string' && (/\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(url) || url.includes('/video'))));
                            const postContentType = (isVideoMedia || getPostContentType(post) === 'reel') ? 'reel' : 'post';
                            handlePublish(post.id, cardPlatforms, postContentType);
                          }}
                          disabled={!!publishingPostId || deleting || isViewer}
                          aria-busy={publishing}
                          className="inline-flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-xl text-xs font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                        >
                          {publishing ? <RotateCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          {publishing ? 'Publishing...' : 'Publish'}
                        </button>
                      )}
                      {failedPlatforms.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRetry(post.id); }}
                          disabled={retrying || !!retryingPostId || deleting || isViewer}
                          aria-busy={retrying}
                          className="inline-flex items-center gap-1.5 bg-rose-600 text-white px-3 py-1.5 rounded-xl text-xs font-semibold hover:bg-rose-500 transition-all disabled:opacity-50 shadow-sm shadow-rose-600/30"
                        >
                          <RotateCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
                          {retryButtonLabel(failedPlatforms.length, retrying)}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDelete(post.id); }}
                        disabled={isViewer || deleting || publishing || retrying}
                        aria-busy={deleting}
                        className="p-1.5 rounded-xl text-fg-muted hover:text-rose-700 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={deleting ? 'Deleting...' : 'Delete post'}
                        aria-label={deleting ? 'Deleting post' : 'Delete post'}
                      >
                        {deleting ? <RotateCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Clean Error Presentation */}
                  {failed && (
                    <div className="mb-3.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-800 dark:text-rose-200">
                      {failureLines.length > 0 ? (
                        failureLines.map((l, idx) => {
                          const errInfo = cleanErrorMessage(l.error);
                          const errKey = `${post.id}-${idx}`;
                          const isExpanded = !!expandedErrors[errKey];

                          return (
                            <div key={l.platform} className="space-y-1">
                              <div className="flex items-start justify-between gap-2 text-rose-800 dark:text-rose-200">
                                <div>
                                  <span className="font-bold capitalize">{l.platform}: </span>
                                  <span>{errInfo.summary}</span>
                                </div>
                                {errInfo.detail && (
                                  <button
                                    type="button"
                                    aria-expanded={isExpanded}
                                    onClick={(e) => toggleErrorExpand(e, errKey)}
                                    className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 underline shrink-0 flex items-center gap-0.5"
                                  >
                                    {isExpanded ? 'Less' : 'Details'}
                                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                  </button>
                                )}
                              </div>
                              {isExpanded && errInfo.detail && (
                                <pre className="mt-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 font-mono text-[10px] whitespace-pre-wrap break-all overflow-x-auto max-h-40">
                                  {errInfo.detail}
                                </pre>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-rose-700 dark:text-rose-300 font-medium">Publishing failed. Check account credentials or retry.</div>
                      )}
                    </div>
                  )}

                  {retryNotes.length > 0 && (
                    <div className="mb-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-200 space-y-0.5">
                      {retryNotes.map((n) => (
                        <div key={n.platform}>
                          <span className="font-bold capitalize">{n.platform}: </span> {n.note}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Post Content */}
                  <p className="text-fg text-sm leading-relaxed whitespace-pre-wrap mb-3.5 line-clamp-3">
                    {post.content}
                  </p>

                  {/* Media Strip */}
                  {mediaObj && (
                    <div className="flex gap-2 overflow-hidden h-24 rounded-xl bg-surface-muted border border-line p-2">
                      {Object.entries(mediaObj).map(([platform, rawUrl]) => {
                        const url = resolveMediaUrl(rawUrl);
                        const isVideo = typeof url === 'string' && (!!url.match(/\.(mp4|mov|webm)(\?.*)?$/i) || url.endsWith('#video'));
                        const frame = getMediaFrame(platform, isVideo, getPostContentType(post));
                        const mediaClass = frame.ratio ? `w-full h-full ${frame.fit === 'cover' ? 'object-cover' : 'object-contain'}` : 'h-full w-auto';

                        return (
                          <div
                            key={platform}
                            className="relative bg-surface-muted rounded-lg overflow-hidden h-full shrink-0 group/media"
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
                  className="inline-flex items-center gap-2.5 px-6 py-2.5 rounded-xl bg-surface-muted/90 hover:bg-surface-hover text-fg hover:text-fg border border-line hover:border-line-strong text-xs font-semibold shadow-lg hover:shadow-indigo-500/10 transition-all cursor-pointer group"
                >
                  <ChevronDown className="w-4 h-4 text-accent group-hover:translate-y-0.5 transition-transform" />
                  <span>Load More Posts</span>
                  <span className="text-[10px] text-fg-muted bg-surface-hover px-2 py-0.5 rounded-md border border-line-strong font-medium">
                    +{filteredPosts.length - visibleCount} remaining
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {pickerFor && (
        <PlatformPickerDialog
          connectedPlatforms={connectedPlatforms}
          onCancel={() => setPickerFor(null)}
          onConfirm={(platforms) => {
            const target = pickerFor;
            setPickerFor(null);
            void queuePublish(target.postId, platforms, target.contentType);
          }}
        />
      )}

      {/* Preview Modal */}
      {previewPost && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-surface-muted/60 backdrop-blur-md p-4 animate-in fade-in duration-200"
          onClick={() => setPreviewPost(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Post preview"
            className="bg-surface rounded-3xl shadow-pop border border-line w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden text-fg"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 sm:px-6 py-4 border-b border-line flex items-center justify-between gap-3 bg-surface z-10">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-accent flex items-center justify-center border border-indigo-500/30">
                  <Eye className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-fg text-base">Multi-Platform Preview</h3>
                  <p className="text-[11px] text-fg-muted">Live preview of how content renders across connected channels</p>
                </div>
              </div>
              <button
                type="button"
                autoFocus
                onClick={() => setPreviewPost(null)}
                aria-label="Close preview"
                className="p-2 rounded-xl text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-8 overflow-y-auto flex-1 bg-canvas custom-scrollbar">
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
                    <div className="flex gap-6 sm:gap-8 justify-center flex-wrap">
                      {Object.entries(mediaObj).map(([platform, url]) => {
                        const isVideo = typeof url === 'string' && (!!url.match(/\.(mp4|mov|webm)(\?.*)?$/i) || url.endsWith('#video'));
                        return (
                          <div key={platform} className="shrink-0 w-full sm:w-87.5 md:w-100">
                            <div className="text-xs font-bold text-fg uppercase tracking-wider mb-3 flex items-center gap-2 bg-surface-muted px-3.5 py-1.5 rounded-full shadow-xs w-max mx-auto border border-line">
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
                    <div className="max-w-2xl mx-auto bg-surface-muted p-5 sm:p-8 rounded-2xl shadow-card border border-line">
                      <p className="text-fg text-base whitespace-pre-wrap leading-relaxed">{previewPost.content}</p>
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
