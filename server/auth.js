import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';

export function createAuthService({ pool } = {}) {
  const authUsersMemory = {};
  const authResetMemory = {};
  const RESET_WINDOW_MS = 15 * 60 * 1000;

  const normalizeAuthEmail = (value = '') => String(value).trim().toLowerCase();

  const hashPassword = (password, saltHex) => {
    const salt = saltHex || randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
  };

  const verifyPassword = (password, saltHex, expectedHash) => {
    const { hash } = hashPassword(password, saltHex);
    try {
      return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
    } catch {
      return false;
    }
  };

  const toComparableHex = (value) => String(value || '').trim().toLowerCase();

  const verifyLegacyPassword = (password, expectedHash) => {
    const normalizedHash = toComparableHex(expectedHash);
    if (!normalizedHash) return false;

    if (/^\$2[aby]\$\d{2}\$/.test(String(expectedHash || ''))) {
      try {
        return bcrypt.compareSync(String(password), String(expectedHash));
      } catch {
        return false;
      }
    }

    // Legacy records may have stored plaintext passwords directly.
    if (String(expectedHash) === String(password)) return true;

    const sha256 = createHash('sha256').update(String(password)).digest('hex');
    if (normalizedHash === sha256) return true;

    const sha512 = createHash('sha512').update(String(password)).digest('hex');
    return normalizedHash === sha512;
  };

  const verifyPasswordRecord = (password, user) => {
    const passwordHash = String(user?.password_hash || '');
    const passwordSalt = String(user?.password_salt || '');

    const scryptOk = passwordSalt && verifyPassword(password, passwordSalt, passwordHash);
    if (scryptOk) {
      return { ok: true, needsRehash: false };
    }

    const legacyOk = verifyLegacyPassword(password, passwordHash);
    if (legacyOk) {
      return { ok: true, needsRehash: true };
    }

    return { ok: false, needsRehash: false };
  };

  const init = async () => {
    if (!pool) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_users (
        email TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        profile_json JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query("ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS profile_json JSONB DEFAULT '{}'::jsonb");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_password_resets (
        email TEXT PRIMARY KEY,
        reset_code TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  };

  const upsertAuthUser = async (email, password, profile = null) => {
    const normalizedEmail = normalizeAuthEmail(email);
    const { salt, hash } = hashPassword(password);
    const normalizedProfile = profile && typeof profile === 'object' ? profile : {};

    if (!pool) {
      const now = new Date().toISOString();
      authUsersMemory[normalizedEmail] = {
        email: normalizedEmail,
        password_hash: hash,
        password_salt: salt,
        profile_json: normalizedProfile,
        created_at: authUsersMemory[normalizedEmail]?.created_at || now,
        updated_at: now,
      };
      return authUsersMemory[normalizedEmail];
    }

    const { rows } = await pool.query(
      `INSERT INTO auth_users (email, password_hash, password_salt, profile_json)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (email)
       DO UPDATE SET password_hash = EXCLUDED.password_hash, password_salt = EXCLUDED.password_salt, profile_json = EXCLUDED.profile_json, updated_at = NOW()
       RETURNING email, password_hash, password_salt, profile_json, created_at, updated_at`,
      [normalizedEmail, hash, salt, JSON.stringify(normalizedProfile)]
    );

    return rows[0] || null;
  };

  const getAuthUser = async (email) => {
    const normalizedEmail = normalizeAuthEmail(email);
    if (!normalizedEmail) return null;

    if (!pool) {
      return authUsersMemory[normalizedEmail] || null;
    }

    const { rows } = await pool.query(
      'SELECT email, password_hash, password_salt, profile_json, created_at, updated_at FROM auth_users WHERE email = $1',
      [normalizedEmail]
    );
    return rows[0] || null;
  };

  const setAuthPassword = async (email, password) => {
    const normalizedEmail = normalizeAuthEmail(email);
    if (!normalizedEmail) return null;
    const { salt, hash } = hashPassword(password);

    if (!pool) {
      if (!authUsersMemory[normalizedEmail]) return null;
      authUsersMemory[normalizedEmail] = {
        ...authUsersMemory[normalizedEmail],
        password_hash: hash,
        password_salt: salt,
        updated_at: new Date().toISOString(),
      };
      return authUsersMemory[normalizedEmail];
    }

    const { rows } = await pool.query(
      `UPDATE auth_users
       SET password_hash = $2, password_salt = $3, updated_at = NOW()
       WHERE email = $1
       RETURNING email, password_hash, password_salt, profile_json, created_at, updated_at`,
      [normalizedEmail, hash, salt]
    );
    return rows[0] || null;
  };

  const setAuthProfile = async (email, profile) => {
    const normalizedEmail = normalizeAuthEmail(email);
    if (!normalizedEmail) return null;
    const normalizedProfile = profile && typeof profile === 'object' ? profile : {};

    if (!pool) {
      if (!authUsersMemory[normalizedEmail]) return null;
      authUsersMemory[normalizedEmail] = {
        ...authUsersMemory[normalizedEmail],
        profile_json: normalizedProfile,
        updated_at: new Date().toISOString(),
      };
      return authUsersMemory[normalizedEmail];
    }

    const { rows } = await pool.query(
      `UPDATE auth_users
       SET profile_json = $2::jsonb, updated_at = NOW()
       WHERE email = $1
       RETURNING email, password_hash, password_salt, profile_json, created_at, updated_at`,
      [normalizedEmail, JSON.stringify(normalizedProfile)]
    );
    return rows[0] || null;
  };

  const createPasswordReset = async (email) => {
    const normalizedEmail = normalizeAuthEmail(email);
    if (!normalizedEmail) return null;
    const resetCode = randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + RESET_WINDOW_MS);

    if (!pool) {
      authResetMemory[normalizedEmail] = {
        reset_code: resetCode,
        expires_at: expiresAt.toISOString(),
      };
      return { email: normalizedEmail, resetCode, expiresAt };
    }

    await pool.query(
      `INSERT INTO auth_password_resets (email, reset_code, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (email)
       DO UPDATE SET reset_code = EXCLUDED.reset_code, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
      [normalizedEmail, resetCode, expiresAt.toISOString()]
    );

    return { email: normalizedEmail, resetCode, expiresAt };
  };

  const consumePasswordReset = async (email, resetCode) => {
    const normalizedEmail = normalizeAuthEmail(email);
    const normalizedCode = String(resetCode || '').trim().toUpperCase();
    if (!normalizedEmail || !normalizedCode) {
      return { ok: false, code: 'INVALID_RESET_CODE' };
    }

    if (!pool) {
      const row = authResetMemory[normalizedEmail];
      if (!row) return { ok: false, code: 'INVALID_RESET_CODE' };
      if (row.reset_code !== normalizedCode) return { ok: false, code: 'INVALID_RESET_CODE' };
      if (new Date(row.expires_at).getTime() < Date.now()) {
        delete authResetMemory[normalizedEmail];
        return { ok: false, code: 'RESET_CODE_EXPIRED' };
      }
      delete authResetMemory[normalizedEmail];
      return { ok: true };
    }

    const { rows } = await pool.query(
      'SELECT reset_code, expires_at FROM auth_password_resets WHERE email = $1',
      [normalizedEmail]
    );
    const row = rows[0];
    if (!row) return { ok: false, code: 'INVALID_RESET_CODE' };

    if (String(row.reset_code || '').toUpperCase() !== normalizedCode) {
      return { ok: false, code: 'INVALID_RESET_CODE' };
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await pool.query('DELETE FROM auth_password_resets WHERE email = $1', [normalizedEmail]);
      return { ok: false, code: 'RESET_CODE_EXPIRED' };
    }

    await pool.query('DELETE FROM auth_password_resets WHERE email = $1', [normalizedEmail]);
    return { ok: true };
  };

  return {
    init,
    normalizeAuthEmail,
    verifyPassword,
    verifyPasswordRecord,
    upsertAuthUser,
    getAuthUser,
    setAuthPassword,
    setAuthProfile,
    createPasswordReset,
    consumePasswordReset,
  };
}

export function registerAuthRoutes(app, authService) {
  const authAttempts = new Map();
  const AUTH_WINDOW_MS = 15 * 60 * 1000;
  const AUTH_LIMIT = 8;

  const getClientKey = (req, email) => {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
    const normalizedEmail = authService.normalizeAuthEmail(email);
    return `${ip}:${normalizedEmail || 'anonymous'}`;
  };

  const checkAuthRateLimit = (req, email, route) => {
    const key = `${route}:${getClientKey(req, email)}`;
    const now = Date.now();
    const bucket = authAttempts.get(key);

    if (!bucket || now - bucket.windowStart >= AUTH_WINDOW_MS) {
      authAttempts.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: AUTH_LIMIT - 1 };
    }

    if (bucket.count >= AUTH_LIMIT) {
      const retryAfterSeconds = Math.ceil((bucket.windowStart + AUTH_WINDOW_MS - now) / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    bucket.count += 1;
    return { allowed: true, remaining: AUTH_LIMIT - bucket.count };
  };

  app.post('/api/auth/signup', async (req, res) => {
    const email = authService.normalizeAuthEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const profile = req.body?.profile;
    const rateLimit = checkAuthRateLimit(req, email, 'signup');
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many auth attempts. Please try again later.', code: 'RATE_LIMITED' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email is required.', code: 'INVALID_EMAIL' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.', code: 'WEAK_PASSWORD' });
    }

    try {
      await authService.upsertAuthUser(email, password, profile);
      return res.json({ ok: true, email });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Failed to create account.', code: 'SIGNUP_FAILED' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = authService.normalizeAuthEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const rateLimit = checkAuthRateLimit(req, email, 'login');
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many auth attempts. Please try again later.', code: 'RATE_LIMITED' });
    }
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.', code: 'MISSING_FIELDS' });
    }

    try {
      const user = await authService.getAuthUser(email);
      if (!user) {
        return res.status(404).json({ error: 'Account not found.', code: 'ACCOUNT_NOT_FOUND' });
      }

      const verified = authService.verifyPasswordRecord(password, user);
      if (!verified.ok) {
        return res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
      }

      if (verified.needsRehash) {
        try {
          await authService.setAuthPassword(email, password);
        } catch {
          // Login should still succeed if migration rehash fails transiently.
        }
      }

      return res.json({ ok: true, email, profile: user.profile_json || null });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Login failed.', code: 'LOGIN_FAILED' });
    }
  });

  app.post('/api/auth/request-reset', async (req, res) => {
    const email = authService.normalizeAuthEmail(req.body?.email);
    const rateLimit = checkAuthRateLimit(req, email, 'reset-request');
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many auth attempts. Please try again later.', code: 'RATE_LIMITED' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email is required.', code: 'INVALID_EMAIL' });
    }

    try {
      const user = await authService.getAuthUser(email);
      if (!user) {
        return res.status(404).json({ error: 'Account not found.', code: 'ACCOUNT_NOT_FOUND' });
      }
      const reset = await authService.createPasswordReset(email);
      return res.json({ ok: true, email, resetCode: reset.resetCode, expiresInMinutes: 15 });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Failed to create reset code.', code: 'RESET_REQUEST_FAILED' });
    }
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    const email = authService.normalizeAuthEmail(req.body?.email);
    const resetCode = String(req.body?.resetCode || '').trim();
    const password = String(req.body?.password || '');
    const rateLimit = checkAuthRateLimit(req, email, 'reset-apply');
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many auth attempts. Please try again later.', code: 'RATE_LIMITED' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email is required.', code: 'INVALID_EMAIL' });
    }
    if (!resetCode) {
      return res.status(400).json({ error: 'Reset code is required.', code: 'MISSING_RESET_CODE' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.', code: 'WEAK_PASSWORD' });
    }

    try {
      const consumed = await authService.consumePasswordReset(email, resetCode);
      if (!consumed.ok) {
        const status = consumed.code === 'RESET_CODE_EXPIRED' ? 410 : 400;
        return res.status(status).json({
          error: consumed.code === 'RESET_CODE_EXPIRED' ? 'Reset code expired.' : 'Invalid reset code.',
          code: consumed.code,
        });
      }
      const updated = await authService.setAuthPassword(email, password);
      if (!updated) {
        return res.status(404).json({ error: 'Account not found.', code: 'ACCOUNT_NOT_FOUND' });
      }
      return res.json({ ok: true, email });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Password reset failed.', code: 'RESET_FAILED' });
    }
  });

  app.post('/api/auth/profile', async (req, res) => {
    const email = authService.normalizeAuthEmail(req.body?.email);
    const profile = req.body?.profile;
    const rateLimit = checkAuthRateLimit(req, email, 'profile-save');
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many auth attempts. Please try again later.', code: 'RATE_LIMITED' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email is required.', code: 'INVALID_EMAIL' });
    }
    if (!profile || typeof profile !== 'object') {
      return res.status(400).json({ error: 'Profile payload is required.', code: 'MISSING_PROFILE' });
    }

    try {
      const updated = await authService.setAuthProfile(email, profile);
      if (!updated) {
        return res.status(404).json({ error: 'Account not found.', code: 'ACCOUNT_NOT_FOUND' });
      }
      return res.json({ ok: true, email, profile: updated.profile_json || null });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Profile save failed.', code: 'PROFILE_SAVE_FAILED' });
    }
  });
}
