import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
const shouldApply = process.argv.includes('--apply');

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  console.error('Set DATABASE_URL in your shell and run again.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const before = await client.query('SELECT COUNT(*)::int AS count FROM auth_users');
    const beforeCount = before.rows[0]?.count ?? 0;

    if (!shouldApply) {
      console.log(`Dry run: auth_users has ${beforeCount} account(s).`);
      console.log('No rows were deleted. Re-run with --apply to delete all accounts.');
      return;
    }

    const deleted = await client.query('DELETE FROM auth_users');
    const after = await client.query('SELECT COUNT(*)::int AS count FROM auth_users');
    const afterCount = after.rows[0]?.count ?? 0;

    console.log(`Deleted ${deleted.rowCount ?? 0} account(s) from auth_users.`);
    console.log(`Remaining accounts: ${afterCount}`);
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error('Failed to delete auth users:', err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
