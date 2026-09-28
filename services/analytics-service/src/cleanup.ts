// The AI Assistant uploads a small throwaway image (or a video's first frame) under post_media/ai-context/ every
// time someone attaches a photo/video to a caption generation (see media-service's /api/v1/media/ai-thumbnail).
// Nothing ever deleted these, so they accumulate forever - pure wasted storage + Storage egress every time one
// gets fetched (e.g. by the AI's own image-understanding call). This sweeps ai-context/ for anything older than
// AI_CONTEXT_MAX_AGE_MS and removes it; the post/caption itself is never affected, only this disposable copy.
import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'post_media';
const AI_CONTEXT_PREFIX = 'ai-context';
const AI_CONTEXT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export async function cleanupOldAiContextUploads(supabase: SupabaseClient): Promise<number> {
  const bucket = supabase.storage.from(BUCKET);
  const { data: entries, error } = await bucket.list(AI_CONTEXT_PREFIX, { limit: 1000 });
  if (error) {
    console.warn('[Cleanup] Could not list ai-context/:', error.message);
    return 0;
  }
  if (!entries || entries.length === 0) return 0;

  const cutoff = Date.now() - AI_CONTEXT_MAX_AGE_MS;
  let deleted = 0;

  for (const entry of entries) {
    // Storage .list() returns per-user subfolders here (ai-thumbnail uploads to ai-context/<userId>/<uuid>.jpg);
    // a folder entry has no id/metadata, unlike a real file, so this skips anything unexpectedly sitting directly
    // under ai-context/ itself.
    if (entry.id) continue;

    const dirPath = `${AI_CONTEXT_PREFIX}/${entry.name}`;
    const { data: files, error: filesError } = await bucket.list(dirPath, { limit: 1000 });
    if (filesError || !files) {
      if (filesError) console.warn(`[Cleanup] Could not list ${dirPath}:`, filesError.message);
      continue;
    }

    const stale = files
      .filter((f) => f.id && f.created_at && new Date(f.created_at).getTime() < cutoff)
      .map((f) => `${dirPath}/${f.name}`);
    if (stale.length === 0) continue;

    const { error: removeError } = await bucket.remove(stale);
    if (removeError) console.warn(`[Cleanup] Could not delete stale ai-context files under ${dirPath}:`, removeError.message);
    else deleted += stale.length;
  }

  return deleted;
}
