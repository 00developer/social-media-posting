// Checks that Supabase Realtime delivers INSERT events for public.notifications (i.e. the table is in the
// supabase_realtime publication). Subscribes with the service role (no filter), inserts ONE scratch
// notification for a user that is NOT the dashboard owner, waits for the event, then deletes the row.
// Usage: node docs/dev-scripts/realtime-check.js [userIdToInsertFor]
const root = require('path').resolve(__dirname, '..', '..') + '/';
require(root + 'node_modules/dotenv').config({ path: root + '.env', override: true });
const { createClient } = require(root + 'node_modules/@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const OTHER_USER = process.argv[2] || 'e2b4d820-95c0-4b34-a9c4-a43655afd2c4';

(async () => {
  let received = null, rowId = null;
  const channel = sb.channel('realtime-check-' + Date.now());
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => { received = payload.new; });
  const subscribed = await new Promise((resolve) => {
    const t = setTimeout(() => resolve('TIMEOUT'), 15000);
    channel.subscribe((status) => { if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) { clearTimeout(t); resolve(status); } });
  });
  console.log('channel status:', subscribed);
  if (subscribed !== 'SUBSCRIBED') { await sb.removeAllChannels(); process.exit(1); }
  try {
    const { data, error } = await sb.from('notifications').insert({ user_id: OTHER_USER, type: 'success', message: '[realtime check] scratch row, safe to ignore', read: true }).select().single();
    if (error) throw new Error('insert failed: ' + error.message);
    rowId = data.id;
    for (let i = 0; i < 120 && !received; i++) await new Promise((r) => setTimeout(r, 250));
    console.log(received && received.id === rowId ? 'PASS  Realtime delivered the INSERT event for public.notifications' : 'FAIL  no event within 30 s -> the table is probably NOT in the supabase_realtime publication');
  } finally {
    if (rowId) { await sb.from('notifications').delete().eq('id', rowId); const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('id', rowId); console.log('scratch row deleted, rows left with that id:', count); }
    await sb.removeAllChannels();
  }
  process.exit(received ? 0 : 1);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
