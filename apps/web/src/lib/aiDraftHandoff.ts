// Hands a generated draft from the standalone AI Assistant page to the post composer it navigates to ("Use in
// new post"). sessionStorage (not app state) survives the navigation with no provider/context plumbing needed,
// and clears itself once read so it never reappears in a later, unrelated post.
const KEY = 'socialpush_ai_draft_handoff';

export function setAiDraftHandoff(text: string) {
  try { sessionStorage.setItem(KEY, text); } catch { /* private browsing / storage disabled - the button still navigates, just without the prefill */ }
}

/** Reads and clears the pending handoff, if any. Call once, on the composer's mount. */
export function takeAiDraftHandoff(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}
