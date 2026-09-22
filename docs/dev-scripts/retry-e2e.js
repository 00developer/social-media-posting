// End-to-end check of failure handling, automatic retries, failure notifications and the retry endpoint,
// against the RUNNING services (scheduling :3004, publishing :3003, post :3002, worker, notification-service).
// Nothing is ever published to a real platform:
//  - "linkedin" has no connected account in the scratch team  -> permanent failure ("account not connected");
//  - "twitter" has a scratch account with a garbage token      -> retryable failure ("Invalid initialization vector"),
//    thrown before any network call, so the retry / backoff path can be exercised safely.
// Only BullMQ jobs created by this script are promoted (to skip the backoff wait). Everything it creates (scratch
// team, posts, jobs, queue jobs, the scratch user's notifications carrying the RETRY-E2E marker) is removed at the end.
// Retries are managed by the worker (failures counter in job.data + moveToDelayed), not by BullMQ attempts.
// Takes ~2 minutes: one deliberate ~62 s pause keeps clear of the publish rate limit (5 per minute per user).
// Usage: node docs/dev-scripts/retry-e2e.js
const root = require('path').resolve(__dirname, '..', '..') + '/';
require(root + 'node_modules/dotenv').config({ path: root + '.env', override: true });
const { createClient } = require(root + 'node_modules/@supabase/supabase-js');
const { Queue } = require(root + 'node_modules/bullmq');
const Redis = require(root + 'node_modules/ioredis');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const OTHER = process.env.E2E_USER || 'e2b4d820-95c0-4b34-a9c4-a43655afd2c4'; // scratch author (NOT the dashboard owner)
const VIEWER = process.env.E2E_VIEWER || '47852654-b6fa-4e8d-ab40-f0b04361b9fc'; // gets a *viewer* role in the scratch team only
const MARK = 'RETRY-E2E';
const POST = 'http://localhost:3002/api/v1/posts';
const SCHED = 'http://localhost:3004/api/v1';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(label, fn, timeoutMs = 45000, everyMs = 700) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(everyMs); }
  console.log(`      (timed out waiting for: ${label})`);
  return null;
}
const api = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };

(async () => {
  const startedAt = new Date().toISOString();
  const url = process.env.REDIS_URL;
  const connection = new Redis(url, { maxRetriesPerRequest: null, ...((url.startsWith('rediss://') || url.includes('upstash')) && { tls: { rejectUnauthorized: false } }) });
  const queue = new Queue('publish-queue', { connection });
  let teamId = null;
  const jobIds = new Set();

  const rows = async (postId) => (await sb.from('publish_jobs').select('*').eq('post_id', postId).order('created_at')).data;
  const latest = async (postId, platform) => { const r = (await rows(postId)).filter((j) => j.platform === platform); return r[r.length - 1]; };
  const postStatus = async (postId) => (await sb.from('posts').select('status').eq('id', postId).single()).data.status;
  const notifs = async () => (await sb.from('notifications').select('*').eq('user_id', OTHER).gte('created_at', startedAt).ilike('message', `%${MARK}%`).order('created_at')).data;
  const failNotifs = async (platform) => (await notifs()).filter((n) => n.type === 'failure' && n.message.includes(platform));
  const track = async (postId) => (await rows(postId)).forEach((j) => jobIds.add(j.id));
  // When is a delayed job due? BullMQ keeps it in a sorted set scored timestamp * 4096 + counter.
  const dueInMs = async (id) => { const s = await connection.zscore('bull:publish-queue:delayed', id); return s == null ? null : Math.floor(Number(s) / 4096) - Date.now(); };

  // The DB row turns 'failed' a moment before BullMQ moves the job from active to failed: wait for it.
  const failedState = async (id) => (await until('job in failed set', async () => { const j = await queue.getJob(id); return j && (await j.getState()) === 'failed' ? j : null; }, 15000));

  // Drives the twitter job (retryable failure) to its end; two promotes skip the 1 min / 2 min backoff.
  async function driveTwitterToFailure(postId, label, failNotifsBefore) {
    const first = await until(`${label}: attempt 1 recorded`, async () => { const j = await latest(postId, 'twitter'); return j && j.retry_count === 1 && j.status === 'scheduled' ? j : null; });
    check(`${label}a. attempt 1 fails -> job stays 'scheduled' with an "Attempt 1/3 failed … Retrying automatically in 1 min." note`, !!first && /^Attempt 1\/3 failed: .*Retrying automatically in 1 min\.$/.test(first.error_message || ''), first && first.error_message);
    if (!first) return;
    const bj = await queue.getJob(first.id);
    const due1 = await dueInMs(first.id);
    check(`${label}b. the job is delayed with failures=1 in its data, due in ~60 s (backoff)`, !!bj && (await bj.getState()) === 'delayed' && bj.data.failures === 1 && due1 > 45000 && due1 < 65000, bj && `state=${await bj.getState()} failures=${bj.data.failures} due in ${Math.round(due1 / 1000)} s`);
    check(`${label}c. no failure notification yet (it is going to be retried)`, (await failNotifs('twitter')).length === failNotifsBefore, `${(await failNotifs('twitter')).length} twitter failure notifications`);
    await bj.promote();
    const second = await until(`${label}: attempt 2 recorded`, async () => { const j = await latest(postId, 'twitter'); return j && j.retry_count === 2 && j.status === 'scheduled' ? j : null; });
    check(`${label}d. attempt 2 fails -> note says "Attempt 2/3"`, !!second && /^Attempt 2\/3 failed.*in 2 min\.$/.test(second.error_message || ''), second && second.error_message);
    if (!second) return;
    const bj2 = await queue.getJob(second.id);
    const due2 = await dueInMs(second.id);
    check(`${label}e. the second backoff is longer (exponential, ~120 s), failures=2`, due2 > 100000 && due2 < 125000 && bj2.data.failures === 2, `due in ${Math.round(due2 / 1000)} s`);
    await bj2.promote();
    const final = await until(`${label}: attempt 3 -> final failure`, async () => { const j = await latest(postId, 'twitter'); return j && j.status === 'failed' ? j : null; });
    check(`${label}f. attempt 3 fails -> FAILED for good: retry_count 3, plain error (no "Attempt" note)`, !!final && final.retry_count === 3 && !/^Attempt/.test(final.error_message || '') && /initialization vector/i.test(final.error_message || ''), final && `${final.retry_count} / ${final.error_message}`);
    const bj3 = final && (await failedState(final.id));
    check(`${label}g. BullMQ job is in the failed set (not delayed again) after the third attempt`, !!bj3 && (await bj3.getState()) === 'failed' && (await dueInMs(final.id)) === null, bj3 && `state=${await bj3.getState()}`);
    const n = await until(`${label}: twitter failure notification`, async () => { const x = await failNotifs('twitter'); return x.length === failNotifsBefore + 1 ? x : null; }, 25000);
    check(`${label}h. exactly one FAILURE notification, saying "after 3 attempts" and why`, !!n && /after 3 attempts/.test(n[n.length - 1].message) && /initialization vector/i.test(n[n.length - 1].message), n && n[n.length - 1].message);
  }

  try {
    // ---------------- setup: scratch team, scratch account, scratch post
    const t = await sb.from('teams').insert({ name: `${MARK} scratch team`, plan: 'pro' }).select().single();
    if (t.error) throw new Error('team: ' + t.error.message);
    teamId = t.data.id;
    const m = await sb.from('team_members').insert([{ team_id: teamId, user_id: OTHER, role: 'owner' }, { team_id: teamId, user_id: VIEWER, role: 'viewer' }]);
    if (m.error) throw new Error('members: ' + m.error.message);
    const a = await sb.from('social_accounts').insert({ user_id: OTHER, team_id: teamId, platform: 'twitter', access_token_encrypted: 'garbage', refresh_token_encrypted: 'none' });
    if (a.error) throw new Error('scratch account: ' + a.error.message);

    const created = await api(POST, { userId: OTHER, teamId, content: `${MARK} scratch post`, mediaUrl: '{}' });
    const P = created.json.data.id;
    // a platform that already published: must never be retried or touched
    await sb.from('publish_jobs').insert({ post_id: P, user_id: OTHER, platform: 'facebook', status: 'completed', content_type: 'reel', created_at: new Date(Date.now() - 60000).toISOString() });

    // ================= 1. linkedin (permanent) + twitter (retryable), scheduled for "now"
    const sc = await api(`${SCHED}/schedules`, { userId: OTHER, postId: P, platforms: ['linkedin', 'twitter'], scheduledAt: new Date().toISOString(), timezone: 'UTC', contentType: 'reel' });
    check('1. POST /schedules accepts the post', sc.status === 200 && sc.json.success, sc.status);
    const started = await until('worker picked up a job', async () => (await rows(P)).some((j) => j.platform === 'linkedin' && j.status !== 'scheduled') ? true : null, 40000);
    if (!started) console.log('      !! the worker does not seem to be running (the job never left "scheduled")');

    const li = await until('linkedin final failure', async () => { const j = await latest(P, 'linkedin'); return j && j.status === 'failed' ? j : null; });
    check('1a. permanent error (account not connected) fails at once: retry_count 1, plain message, content_type kept (reel)', !!li && li.retry_count === 1 && /not connected/.test(li.error_message) && li.content_type === 'reel', li && `${li.retry_count} / ${li.error_message} / ${li.content_type}`);
    await track(P);
    const lbj = li && (await failedState(li.id));
    check('1b. the permanent failure was NOT retried: job failed at once, no failures counter, never delayed', !!lbj && (await lbj.getState()) === 'failed' && lbj.data.failures === undefined && (await dueInMs(li.id)) === null, lbj && `state=${await lbj.getState()} failures=${lbj.data.failures}`);
    const n1 = await until('linkedin failure notification', async () => { const n = await failNotifs('linkedin'); return n.length ? n : null; }, 25000);
    check('1c. a FAILURE notification was created for linkedin, naming the reason (no "attempts" wording)', !!n1 && n1.length === 1 && /not connected/.test(n1[0].message) && !/attempts/.test(n1[0].message), n1 && n1[0].message);
    check('1d. the post stays "scheduled" while twitter is still being retried (status waits for every platform)', (await postStatus(P)) === 'scheduled', await postStatus(P));

    // ================= 2. the retryable platform: 3 attempts with backoff, then a failure notification
    await driveTwitterToFailure(P, '2', 0);
    check('2i. every platform finished, one failed -> post is "failed" (the completed facebook job does not hide it)', (await until('post failed', async () => (await postStatus(P)) === 'failed' ? true : null, 15000)) === true, await postStatus(P));

    // ================= 3. guards of the retry endpoint (no publishing involved)
    let r = await api(`${SCHED}/posts/${P}/retry`, { userId: VIEWER });
    check('3a. viewer cannot retry -> 403', r.status === 403 && /Viewers/.test(r.json.error), r.status);
    r = await api(`${SCHED}/posts/00000000-0000-4000-8000-000000000000/retry`, { userId: OTHER });
    check('3b. unknown post -> 404', r.status === 404, r.status);
    r = await api(`${SCHED}/posts/nope/retry`, { userId: OTHER }); check('3c. malformed post id -> 400', r.status === 400, r.status);
    r = await api(`${SCHED}/posts/${P}/retry`, { userId: OTHER, platforms: 'linkedin' }); check('3d. platforms must be an array -> 400', r.status === 400, r.status);
    r = await api(`${SCHED}/posts/${P}/retry`, { userId: '11111111-1111-4111-8111-111111111111' }); check('3e. a user who is not in the team -> 403', r.status === 403, r.status);
    r = await api(`${SCHED}/posts/${P}/retry`, { userId: OTHER, platforms: ['facebook'] });
    check('3f. a platform that already published is never retried -> 409, nothing created', r.status === 409 && r.json.code === 'NOTHING_TO_RETRY', r.status);
    check('3g. ...and still exactly one job row for facebook', (await rows(P)).filter((j) => j.platform === 'facebook').length === 1);

    console.log('      (pausing ~62 s to stay under the publish rate limit …)');
    await sleep(62000);

    // ================= 4. retry ONLY the selected platform (linkedin)
    const before = await rows(P);
    r = await api(`${SCHED}/posts/${P}/retry`, { userId: OTHER, platforms: ['linkedin'] });
    check('4a. retry with platforms:["linkedin"] -> 200, retried exactly ["linkedin"]', r.status === 200 && JSON.stringify(r.json.retried) === '["linkedin"]', JSON.stringify(r.json));
    const after = await rows(P);
    check('4b. exactly ONE new job row; twitter and facebook untouched; old failed rows kept as history', after.length === before.length + 1 && after.filter((j) => j.platform === 'twitter').length === 1 && after.filter((j) => j.platform === 'linkedin').length === 2);
    const newLi = after.filter((j) => j.platform === 'linkedin').pop();
    check('4c. the new job keeps content_type "reel"', newLi.content_type === 'reel', newLi.content_type);
    const nbj = await queue.getJob(newLi.id);
    check('4d. it is queued under its own id with a fresh failures counter and the retention options', !!nbj && nbj.id === newLi.id && nbj.data.failures === undefined && !!nbj.opts.removeOnFail, nbj && JSON.stringify(nbj.opts.removeOnFail));
    const li2 = await until('retried linkedin fails again', async () => { const j = await latest(P, 'linkedin'); return j && j.id === newLi.id && j.status === 'failed' ? j : null; });
    check('4e. the retried linkedin job failed again (still no account) and the post is "failed" again', !!li2 && (await until('post failed', async () => (await postStatus(P)) === 'failed' ? true : null, 15000)) === true);
    await track(P);

    // ================= 5. retry everything that failed (linkedin + twitter); facebook stays untouched
    r = await api(`${SCHED}/posts/${P}/retry`, { userId: OTHER });
    check('5a. retry without platforms -> every failed platform (linkedin + twitter), not facebook', r.status === 200 && [...r.json.retried].sort().join() === 'linkedin,twitter', JSON.stringify(r.json));
    const st = await postStatus(P);
    check('5b. the post goes back to "scheduled" while retrying', st === 'scheduled', st);
    // linkedin fails again within milliseconds (so it is legitimately retryable again); twitter is still being retried
    const again = await api(`${SCHED}/posts/${P}/retry`, { userId: OTHER, platforms: ['twitter'] });
    check('5c. pressing retry again for twitter while its retry is in flight -> 409 (no duplicate jobs)', again.status === 409, again.status);
    await driveTwitterToFailure(P, '5', 1);
    await track(P);
    const all = await rows(P);
    check('5i. history kept: linkedin 3 rows, twitter 2 rows, facebook 1 row (only failed platforms were re-queued)', all.filter((j) => j.platform === 'linkedin').length === 3 && all.filter((j) => j.platform === 'twitter').length === 2 && all.filter((j) => j.platform === 'facebook').length === 1, all.map((j) => j.platform + ':' + j.status).join(' '));
    check('5j. every job of this post kept content_type "reel"', all.every((j) => j.content_type === 'reel'));
    check('5k. final post status is "failed"', (await until('final post status', async () => (await postStatus(P)) === 'failed' ? true : null, 15000)) === true);

    // ================= 6. nothing to retry
    const done = await api(POST, { userId: OTHER, teamId, content: `${MARK} all published`, mediaUrl: '{}' });
    await sb.from('publish_jobs').insert({ post_id: done.json.data.id, user_id: OTHER, platform: 'facebook', status: 'completed', content_type: 'post' });
    r = await api(`${SCHED}/posts/${done.json.data.id}/retry`, { userId: OTHER });
    check('6a. a post whose platforms all published has nothing to retry -> 409', r.status === 409 && r.json.code === 'NOTHING_TO_RETRY', r.status);
    r = await api(`${SCHED}/posts/${done.json.data.id}/retry`, { userId: OTHER, platforms: [] });
    check('6b. an empty platforms array is treated as "all failed platforms" (here: none) -> 409, not an error', r.status === 409, r.status);
    await sleep(1500);
  } catch (e) {
    fail++; console.log('FAIL  unexpected error: ' + (e.stack || e.message));
  } finally {
    // ---------------- cleanup: everything this run created
    try {
      if (teamId) {
        const { data: posts } = await sb.from('posts').select('id').eq('team_id', teamId);
        for (const p of posts || []) (await sb.from('publish_jobs').select('id').eq('post_id', p.id)).data.forEach((j) => jobIds.add(j.id));
      }
      let removedJobs = 0;
      for (const id of jobIds) { try { const j = await queue.getJob(id); if (j) { await j.remove(); removedJobs++; } } catch { /* an active job disappears with its row anyway */ } }
      await sleep(3000); // let in-flight notifications land before deleting them
      const del = await sb.from('notifications').delete().eq('user_id', OTHER).ilike('message', `%${MARK}%`).select('id');
      if (teamId) await sb.from('teams').delete().eq('id', teamId);
      const left = teamId ? (await sb.from('posts').select('id', { count: 'exact', head: true }).eq('team_id', teamId)).count : 0;
      console.log(`\ncleanup: ${removedJobs} queue jobs removed, ${del.data ? del.data.length : 0} scratch notifications deleted, scratch team deleted (posts left: ${left})`);
    } catch (e) { console.log('cleanup error:', e.message); }
    await queue.close(); await connection.quit();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
