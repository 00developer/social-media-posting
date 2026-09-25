// Pure logic behind the Comments page: turns the flat `post_comments` rows into conversations
// (one top-level comment + its replies) and works out which ones still wait for an answer.

export type CommentRow = {
  id: string;
  post_id: string | null;
  platform: string;
  external_comment_id: string;
  parent_external_id: string | null;
  author_name: string | null;
  text: string;
  commented_at: string | null;
  is_own: boolean;
};

export type Thread = {
  root: CommentRow;
  replies: CommentRow[]; // oldest first
  /** The last message in the conversation is not ours, so it still needs an answer. */
  needsReply: boolean;
  lastActivity: number;
};

const time = (c: CommentRow) => (c.commented_at ? new Date(c.commented_at).getTime() : 0);

/**
 * Groups comments into conversations. Replies whose parent is missing (or that are replies to a reply, which the
 * platforms flatten) are attached to the top-level comment they belong to. Newest conversation first.
 * A conversation that starts with our own comment does not need a reply until a reader answers it.
 */
export function buildThreads(rows: CommentRow[]): Thread[] {
  const byExternal = new Map(rows.map((r) => [`${r.platform}:${r.external_comment_id}`, r]));
  const rootOf = (row: CommentRow): CommentRow | null => {
    let current = row;
    for (let i = 0; i < 10 && current.parent_external_id; i++) {
      const parent = byExternal.get(`${current.platform}:${current.parent_external_id}`);
      if (!parent) return null;
      current = parent;
    }
    return current.parent_external_id ? null : current;
  };

  const threads = new Map<string, Thread>();
  for (const row of rows) if (!row.parent_external_id) {
    threads.set(row.id, { root: row, replies: [], needsReply: !row.is_own, lastActivity: time(row) });
  }
  for (const row of rows) {
    if (!row.parent_external_id) continue;
    const root = rootOf(row);
    const thread = root && threads.get(root.id);
    if (thread) thread.replies.push(row);
  }
  for (const t of threads.values()) {
    t.replies.sort((a, b) => time(a) - time(b));
    const last = t.replies.length ? t.replies[t.replies.length - 1] : t.root;
    t.needsReply = !last.is_own;
    t.lastActivity = time(last);
  }
  return [...threads.values()].sort((a, b) => b.lastActivity - a.lastActivity);
}

export type ThreadFilter = { platform?: string; status?: 'all' | 'unanswered' | 'answered'; postId?: string };

export function filterThreads(threads: Thread[], f: ThreadFilter): Thread[] {
  return threads.filter((t) => {
    if (f.platform && f.platform !== 'all' && t.root.platform !== f.platform) return false;
    if (f.postId && f.postId !== 'all' && t.root.post_id !== f.postId) return false;
    if (f.status === 'unanswered' && !t.needsReply) return false;
    if (f.status === 'answered' && t.needsReply) return false;
    return true;
  });
}

/** Comments with a reply box can only be answered where the platform gives us a comments API. */
export const REPLY_PLATFORMS = ['facebook', 'instagram', 'threads', 'youtube'];
