// S3.1 real-HTTP tests for PATCH /api/v1/posts/:id against the running post-service (:3002).
// All writes happen in a SCRATCH team (created here, deleted at the end; cascade removes its posts/jobs).
// The real team/post are only touched by read-only cross-team checks that must be rejected.
const root = require('path').resolve(__dirname, '..', '..') + '/'; // repo root
require(root + 'node_modules/dotenv').config({ path: root + '.env' });
const { createClient } = require(root + 'node_modules/@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BASE = 'http://localhost:3002/api/v1/posts';
const OWNER = '47852654-b6fa-4e8d-ab40-f0b04361b9fc'; // owner of the real team
const OTHER = 'e2b4d820-95c0-4b34-a9c4-a43655afd2c4'; // NOT a member of the real team
const REAL_TEAM = '6c62811d-e160-4077-8d76-47fa62b7c61a';
const REAL_POST = '85e737cb-0b8a-4688-a0f4-37b1b489bba1';
const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail = '') { (ok ? pass++ : fail++); results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); }

async function patch(id, body) {
  const r = await fetch(`${BASE}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const dbPost = async (id) => (await sb.from('posts').select('*').eq('id', id).maybeSingle()).data;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createPost(teamId, content) {
  const r = await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: OWNER, teamId, content, mediaUrl: '{}' }) });
  const j = await r.json();
  if (!j.success) throw new Error('createPost failed: ' + JSON.stringify(j));
  return j.data.id;
}
async function addJobs(postId, jobs) {
  const rows = jobs.map(([platform, status, minute]) => ({ post_id: postId, user_id: OWNER, platform, status, created_at: `2026-09-21T10:${String(minute).padStart(2, '0')}:00Z` }));
  const { error } = await sb.from('publish_jobs').insert(rows);
  if (error) throw new Error('addJobs failed: ' + error.message);
}

(async () => {
  let teamId = null;
  try {
    // ---- scratch team: OWNER = owner, OTHER = viewer
    const t = await sb.from('teams').insert({ name: 'S31 scratch team', plan: 'free' }).select().single();
    if (t.error) throw new Error('team: ' + t.error.message);
    teamId = t.data.id;
    const m = await sb.from('team_members').insert([{ team_id: teamId, user_id: OWNER, role: 'owner' }, { team_id: teamId, user_id: OTHER, role: 'viewer' }]);
    if (m.error) throw new Error('members: ' + m.error.message);

    // ================= A. validation / auth =================
    const draftId = await createPost(teamId, 'S31 scratch draft');
    let r;
    r = await patch('abc', { userId: OWNER, teamId, content: 'x' }); check('A1 malformed post id -> 400', r.status === 400, r.status);
    r = await patch(draftId, { teamId, content: 'x' }); check('A2 missing userId -> 400', r.status === 400, r.status);
    r = await patch(draftId, { userId: OWNER, content: 'x' }); check('A3 missing teamId -> 400', r.status === 400, r.status);
    r = await patch(draftId, { userId: 'nope', teamId, content: 'x' }); check('A4 malformed userId -> 400', r.status === 400, r.status);
    r = await patch(draftId, { userId: OTHER, teamId: REAL_TEAM, content: 'HACK' }); check('A5 user not in that team -> 403', r.status === 403, r.status);
    r = await patch(draftId, { userId: OTHER, teamId, content: 'HACK' }); check('A6 viewer -> 403', r.status === 403 && /Viewers/.test(r.json.error), r.status + ' ' + r.json.error);
    check('A6b viewer attempt changed nothing', (await dbPost(draftId)).content === 'S31 scratch draft');
    r = await patch(draftId, { userId: OWNER, teamId: REAL_TEAM, content: 'HACK' }); check('A7 scratch post id with the real team id -> 404 (team scoped)', r.status === 404, r.status);
    r = await patch(ZERO_UUID, { userId: OWNER, teamId, content: 'x' }); check('A8 unknown post id -> 404', r.status === 404, r.status);

    // ================= B. draft edit =================
    const before = await dbPost(draftId);
    await sleep(1100);
    r = await patch(draftId, { userId: OWNER, teamId, content: 'Edited caption\nline 2 #tag 🚀 नमस्ते' });
    const after = await dbPost(draftId);
    check('B1 draft edit -> 200', r.status === 200 && r.json.success === true, r.status);
    check('B2 DB content saved exactly (newline, emoji, Hindi)', after.content === 'Edited caption\nline 2 #tag 🚀 नमस्ते');
    check('B3 response returns the updated row', r.json.data && r.json.data.content === after.content && r.json.data.id === draftId);
    check('B4 updated_at advanced, status and other fields untouched', after.updated_at > before.updated_at && after.status === 'draft' && after.media_url === before.media_url && after.team_id === before.team_id && after.user_id === before.user_id && after.created_at === before.created_at);
    const rowsAfter = await Promise.all([sb.from('schedules').select('id', { count: 'exact', head: true }).eq('post_id', draftId), sb.from('publish_jobs').select('id', { count: 'exact', head: true }).eq('post_id', draftId), sb.from('posts').select('id', { count: 'exact', head: true }).eq('team_id', teamId)]);
    check('B5 no schedules/jobs created, still exactly 1 post in the team (no duplicate)', rowsAfter[0].count === 0 && rowsAfter[1].count === 0 && rowsAfter[2].count === 1, `schedules=${rowsAfter[0].count} jobs=${rowsAfter[1].count} posts=${rowsAfter[2].count}`);

    await sleep(1100);
    const u1 = (await dbPost(draftId)).updated_at;
    r = await patch(draftId, { userId: OWNER, teamId, content: 'Edited caption\nline 2 #tag 🚀 नमस्ते' });
    check('B6 same content -> 200 unchanged:true and updated_at NOT touched', r.status === 200 && r.json.unchanged === true && (await dbPost(draftId)).updated_at === u1, r.status);

    const keep = (await dbPost(draftId)).content;
    for (const [label, body] of [['empty string', ''], ['whitespace only', '  \n\t '], ['missing content', undefined], ['number', 42], ['null', null], ['10001 chars', 'a'.repeat(10001)]]) {
      r = await patch(draftId, { userId: OWNER, teamId, ...(body === undefined ? {} : { content: body }) });
      check(`B7 ${label} -> 400 and content unchanged`, r.status === 400 && (await dbPost(draftId)).content === keep, r.status + ' ' + (r.json && r.json.error));
    }
    r = await patch(draftId, { userId: OWNER, teamId, content: 'a'.repeat(10000) });
    check('B8 exactly 10000 chars is accepted', r.status === 200, r.status);

    // ================= C. editability matrix (fabricated job rows on scratch posts) =================
    const matrix = [
      ['C1 [fb scheduled] editable', [['facebook', 'scheduled', 1]], 200],
      ['C2 [fb failed] editable', [['facebook', 'failed', 1]], 200],
      ['C3 [fb scheduled, ig failed] editable (mixed, nothing published)', [['facebook', 'scheduled', 1], ['instagram', 'failed', 1]], 200],
      ['C4 [fb failed(old), fb scheduled(new)] editable (latest wins)', [['facebook', 'failed', 1], ['facebook', 'scheduled', 2]], 200],
      ['C5 [fb completed] blocked', [['facebook', 'completed', 1]], 409],
      ['C6 [fb completed, ig scheduled] blocked', [['facebook', 'completed', 1], ['instagram', 'scheduled', 1]], 409],
      ['C7 [fb processing] blocked', [['facebook', 'processing', 1]], 409],
      ['C8 [fb failed(old), fb completed(new)] blocked', [['facebook', 'failed', 1], ['facebook', 'completed', 2]], 409],
    ];
    for (const [name, jobs, expected] of matrix) {
      const pid = await createPost(teamId, 'orig');
      await addJobs(pid, jobs);
      r = await patch(pid, { userId: OWNER, teamId, content: 'new caption' });
      const c = (await dbPost(pid)).content;
      const ok = r.status === expected && (expected === 200 ? c === 'new caption' : c === 'orig' && r.json.code === 'NOT_EDITABLE');
      check(name + ` -> ${expected}`, ok, `got ${r.status}, db content="${c}"`);
    }
    { // 409 wins over content validation
      const pid = await createPost(teamId, 'orig'); await addJobs(pid, [['facebook', 'completed', 1]]);
      r = await patch(pid, { userId: OWNER, teamId, content: '' });
      check('C9 published post + empty content -> 409 (not 400)', r.status === 409, r.status);
    }
    { // Threads byte limit (same rule as the adapter)
      const pid = await createPost(teamId, 'orig'); await addJobs(pid, [['threads', 'scheduled', 1]]);
      r = await patch(pid, { userId: OWNER, teamId, content: 'a'.repeat(501) });
      check('C10 threads job + 501 bytes -> 400, unchanged', r.status === 400 && /Threads/.test(r.json.error) && (await dbPost(pid)).content === 'orig', r.status);
      r = await patch(pid, { userId: OWNER, teamId, content: 'न'.repeat(170) });
      check('C11 threads job + 170 Hindi chars (510 bytes) -> 400 (known bytes-vs-characters rule)', r.status === 400, r.status);
      r = await patch(pid, { userId: OWNER, teamId, content: 'a'.repeat(500) });
      check('C12 threads job + exactly 500 bytes -> 200', r.status === 200, r.status);
      const pid2 = await createPost(teamId, 'orig'); await addJobs(pid2, [['facebook', 'scheduled', 1]]);
      r = await patch(pid2, { userId: OWNER, teamId, content: 'a'.repeat(600) });
      check('C13 same 600-byte text on a facebook-only post -> 200 (limit is Threads-only)', r.status === 200, r.status);
    }
  } catch (e) {
    fail++; results.push('FAIL  unexpected error: ' + e.message);
  } finally {
    // ---- cleanup: deleting the scratch team cascades to members, posts, jobs
    if (teamId) {
      const d = await sb.from('teams').delete().eq('id', teamId);
      const left = await Promise.all([sb.from('posts').select('id', { count: 'exact', head: true }).eq('team_id', teamId), sb.from('team_members').select('id', { count: 'exact', head: true }).eq('team_id', teamId)]);
      check('Z1 scratch team + its posts/members removed', !d.error && left[0].count === 0 && left[1].count === 0, d.error ? d.error.message : `posts=${left[0].count} members=${left[1].count}`);
    }
    const realPost = await dbPost(REAL_POST);
    check('Z2 real test post still exists', !!realPost);
    console.log(results.join('\n'));
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
