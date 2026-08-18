import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8').split('\n');
const envMap: Record<string, string> = {};
for (const line of env) {
  if (line.includes('=')) {
    const [k, ...v] = line.split('=');
    envMap[k] = v.join('=').replace(/^"/, '').replace(/"$/, '');
  }
}

const supabaseUrl = envMap['NEXT_PUBLIC_SUPABASE_URL']!;
const supabaseKey = envMap['SUPABASE_SERVICE_ROLE_KEY']!;
const admin = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await admin.from('company_profile').upsert({
    id: 1,
    name: 'StellarBlue',
    vat_number: '802309756',
    logo_url: '/logo.png'
  }).select();
  console.log(error ? error : "Successfully filled company_profile:", data);
}

main().catch(console.error);
