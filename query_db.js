const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/o/Desktop/Antigravity/social-posting/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await supabase
    .from('publish_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (error) console.error(error);
  console.log(JSON.stringify(data, null, 2));
}

check();
