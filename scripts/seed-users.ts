import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell before provisioning accounts.');

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const users = [
  ['pankaj', 'Pankaj'], ['sakshi', 'Sakshi'], ['dheeraj', 'Dheeraj'], ['vaibhav', 'Vaibhav'],
] as const;

for (const [username, displayName] of users) {
  const email = `${username}@bench-suite.ai`;
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const existing = listed.users.find((user) => user.email?.toLowerCase() === email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password: '1234', email_confirm: true, user_metadata: { display_name: displayName, username } });
    if (error) throw error;
  } else {
    const { error } = await admin.auth.admin.createUser({ email, password: '1234', email_confirm: true, user_metadata: { display_name: displayName, username } });
    if (error) throw error;
  }
  console.log(`Provisioned ${username}`);
}

console.log('Disable public signups in Supabase Auth settings. These four accounts share the requested demo password.');
