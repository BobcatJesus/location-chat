import fs from 'node:fs';

const readLocalEnv = () => {
  if (!fs.existsSync('.env.local')) return {};
  return Object.fromEntries(
    fs.readFileSync('.env.local', 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim().replace(/^["']|["']$/g, '')]),
  );
};

const backendUrl = String(process.env.BACKEND_URL || readLocalEnv().VITE_BACKEND_URL || '').replace(/\/$/, '');
if (!backendUrl) {
  console.error('Missing BACKEND_URL or VITE_BACKEND_URL.');
  process.exit(1);
}

const checks = [
  { name: 'Downtown Houston', lat: 29.7604, lng: -95.3698 },
  { name: 'Shepherd Park', lat: 29.834235, lng: -95.4175 },
  { name: 'MD Anderson Library', lat: 29.7218, lng: -95.342 },
];

let failed = false;
for (const check of checks) {
  const url = `${backendUrl}/api/nearby-places?lat=${check.lat}&lng=${check.lng}&radius=1000`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data)) {
      failed = true;
      console.error(`${check.name}: invalid response (HTTP ${response.status}).`);
      continue;
    }
    console.log(`${check.name}: ${data.length} nearby place(s).`);
  } catch (error) {
    failed = true;
    console.error(`${check.name}: ${error.message}`);
  }
}

if (failed) process.exit(1);
console.log('Nearby-place smoke check passed.');