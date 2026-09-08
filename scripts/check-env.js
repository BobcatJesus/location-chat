import fs from 'node:fs';
import process from 'node:process';

const envPath = '.env.local';
const required = ['VITE_BACKEND_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

if (!fs.existsSync(envPath)) {
  console.error(`Missing ${envPath}. Copy .env.example to ${envPath} and fill in the values.`);
  process.exit(1);
}

const values = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match) values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
}

const errors = [];
for (const name of required) {
  if (!values[name]) errors.push(`${name} is missing.`);
}

for (const name of ['VITE_BACKEND_URL', 'VITE_SUPABASE_URL']) {
  if (!values[name]) continue;
  try {
    const url = new URL(values[name]);
    if (!['http:', 'https:'].includes(url.protocol)) errors.push(`${name} must use http:// or https://.`);
  } catch {
    errors.push(`${name} is not a valid URL.`);
  }
}

if (values.VITE_SUPABASE_URL && !/\.supabase\.co$/i.test(new URL(values.VITE_SUPABASE_URL).hostname)) {
  errors.push('VITE_SUPABASE_URL must point to a *.supabase.co project URL.');
}

if (values.VITE_SUPABASE_ANON_KEY && /service_role|secret/i.test(values.VITE_SUPABASE_ANON_KEY)) {
  errors.push('VITE_SUPABASE_ANON_KEY must be a publishable/anon key, not a service-role or secret key.');
}

if (errors.length) {
  console.error('Environment check failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Environment check passed: backend URL and Supabase browser configuration are valid.');