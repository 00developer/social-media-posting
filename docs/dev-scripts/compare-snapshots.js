// Compares two snapshots taken with snap.js and checks the Step 3 "only the caption changed" invariants.
// Usage: node compare-snapshots.js <before.json> <after.json> [expectedContentAfter]
//   expectedContentAfter (JSON string, optional): exact content the post must have in <after>.
// Exit code 0 = all invariants hold.
const fs = require('fs');
const [beforeFile, afterFile, expectedArg] = process.argv.slice(2);
if (!beforeFile || !afterFile) { console.log('usage: node compare-snapshots.js <before.json> <after.json> [expectedContentAfterAsJson]'); process.exit(2); }
const a = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
const b = JSON.parse(fs.readFileSync(afterFile, 'utf8'));
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

check('same post id', a.post.id === b.post.id);
const changedFields = Object.keys({ ...a.post, ...b.post }).filter((k) => !same(a.post[k], b.post[k]));
check('only content / updated_at differ on the post row', changedFields.every((k) => k === 'content' || k === 'updated_at'), `changed: [${changedFields.join(', ')}]`);
check('post status unchanged', a.post.status === b.post.status, `${a.post.status} -> ${b.post.status}`);
check('media_url unchanged', a.post.media_url === b.post.media_url);
if (expectedArg !== undefined) {
  const expected = JSON.parse(expectedArg);
  check('content is exactly the expected text', b.post.content === expected, JSON.stringify(b.post.content));
}
check('schedules: same rows (ids, times, updated_at)', same(a.schedules, b.schedules), `${a.schedules.length} rows`);
check('publish_jobs: same rows (ids, status, retry_count, updated_at)', same(a.jobs, b.jobs), `${a.jobs.length} rows`);

// Queue: compare identity, state and firing time; the delay itself is fixed at enqueue time and must not move either
const q = (s) => s.queue.map((x) => ({ id: x.id, state: x.state, delay: x.delay, runsAtMs: x.runsAtMs, missing: !!x.missing })).sort((m, n) => String(m.id).localeCompare(String(n.id)));
check('queue: same jobs (id, state, delay, run time), none missing', same(q(a), q(b)) && q(b).every((x) => !x.missing), `${b.queue.length} jobs`);
check('table totals unchanged (posts / schedules / publish_jobs)', same(a.totals, b.totals), JSON.stringify(b.totals));

let bad = 0;
for (const r of results) { console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  [' + r.detail + ']' : '')); if (!r.ok) bad++; }
console.log(`\ncontent before: ${JSON.stringify(a.post.content)}\ncontent after : ${JSON.stringify(b.post.content)}\nupdated_at    : ${a.post.updated_at} -> ${b.post.updated_at}`);
console.log(bad === 0 ? '\nALL INVARIANTS HOLD' : `\n${bad} INVARIANT(S) BROKEN`);
process.exit(bad ? 1 : 0);
