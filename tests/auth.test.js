import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import bcrypt from 'bcryptjs';
import { createAuthService, registerAuthRoutes } from '../server/auth.js';

describe('auth endpoints', () => {
  let httpServer;
  let baseUrl;
  let authService;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());

    authService = createAuthService();
    await authService.init();
    registerAuthRoutes(app, authService);

    httpServer = createServer(app);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address();
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    if (!httpServer) return;
    await new Promise((resolve) => httpServer.close(resolve));
  });

  const postJson = async (path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    return { response, data };
  };

  it('signs up successfully', async () => {
    const { response, data } = await postJson('/api/auth/signup', {
      email: 'AuthUser@Side.Quest',
      password: 'hunter22',
    });

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.email).toBe('authuser@side.quest');
  });

  it('logs in with correct password', async () => {
    await postJson('/api/auth/signup', {
      email: 'login-ok@side.quest',
      password: 'safe-pass',
    });

    const { response, data } = await postJson('/api/auth/login', {
      email: 'login-ok@side.quest',
      password: 'safe-pass',
    });

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('rejects wrong password', async () => {
    await postJson('/api/auth/signup', {
      email: 'wrong-pass@side.quest',
      password: 'safe-pass',
    });

    const { response, data } = await postJson('/api/auth/login', {
      email: 'wrong-pass@side.quest',
      password: 'not-the-pass',
    });

    expect(response.status).toBe(401);
    expect(data.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns account not found for unknown email', async () => {
    const { response, data } = await postJson('/api/auth/login', {
      email: 'missing@side.quest',
      password: 'safe-pass',
    });

    expect(response.status).toBe(404);
    expect(data.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('resets password with a one-time code', async () => {
    await postJson('/api/auth/signup', {
      email: 'reset-me@side.quest',
      password: 'old-pass-1',
    });

    const requestReset = await postJson('/api/auth/request-reset', {
      email: 'reset-me@side.quest',
    });

    expect(requestReset.response.status).toBe(200);
    expect(requestReset.data.ok).toBe(true);
    expect(typeof requestReset.data.resetCode).toBe('string');
    expect(requestReset.data.resetCode.length).toBeGreaterThanOrEqual(6);

    const resetPassword = await postJson('/api/auth/reset-password', {
      email: 'reset-me@side.quest',
      resetCode: requestReset.data.resetCode,
      password: 'new-pass-2',
    });

    expect(resetPassword.response.status).toBe(200);
    expect(resetPassword.data.ok).toBe(true);

    const oldLogin = await postJson('/api/auth/login', {
      email: 'reset-me@side.quest',
      password: 'old-pass-1',
    });
    expect(oldLogin.response.status).toBe(401);

    const newLogin = await postJson('/api/auth/login', {
      email: 'reset-me@side.quest',
      password: 'new-pass-2',
    });
    expect(newLogin.response.status).toBe(200);
    expect(newLogin.data.ok).toBe(true);
  });

  it('rejects reused reset code', async () => {
    await postJson('/api/auth/signup', {
      email: 'reset-once@side.quest',
      password: 'initial-pass',
    });

    const requestReset = await postJson('/api/auth/request-reset', {
      email: 'reset-once@side.quest',
    });

    const firstApply = await postJson('/api/auth/reset-password', {
      email: 'reset-once@side.quest',
      resetCode: requestReset.data.resetCode,
      password: 'changed-pass',
    });
    expect(firstApply.response.status).toBe(200);

    const secondApply = await postJson('/api/auth/reset-password', {
      email: 'reset-once@side.quest',
      resetCode: requestReset.data.resetCode,
      password: 'another-pass',
    });
    expect(secondApply.response.status).toBe(400);
    expect(secondApply.data.code).toBe('INVALID_RESET_CODE');
  });

  it('rate limits repeated auth attempts', async () => {
    let lastResponse;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      lastResponse = await postJson('/api/auth/login', {
        email: 'ratelimit@side.quest',
        password: `attempt-${attempt}`,
      });
    }

    expect(lastResponse.response.status).toBe(429);
    expect(lastResponse.data.code).toBe('RATE_LIMITED');
  });

  it('accepts legacy plaintext password records and rehashes them', async () => {
    await authService.upsertAuthUser('legacy-plain@side.quest', 'seed-pass');
    const legacyUser = await authService.getAuthUser('legacy-plain@side.quest');
    legacyUser.password_hash = 'old-pass-plain';
    legacyUser.password_salt = '';

    const login = await postJson('/api/auth/login', {
      email: 'legacy-plain@side.quest',
      password: 'old-pass-plain',
    });

    expect(login.response.status).toBe(200);
    expect(login.data.ok).toBe(true);

    const migrated = await authService.getAuthUser('legacy-plain@side.quest');
    expect(migrated.password_salt).toBeTruthy();
    expect(migrated.password_hash).not.toBe('old-pass-plain');
  });

  it('accepts legacy sha256 password records and rehashes them', async () => {
    await authService.upsertAuthUser('legacy-sha@side.quest', 'seed-pass');
    const legacyUser = await authService.getAuthUser('legacy-sha@side.quest');
    legacyUser.password_hash = '8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8';
    legacyUser.password_salt = '';

    const login = await postJson('/api/auth/login', {
      email: 'legacy-sha@side.quest',
      password: 'alpha',
    });

    expect(login.response.status).toBe(200);
    expect(login.data.ok).toBe(true);

    const migrated = await authService.getAuthUser('legacy-sha@side.quest');
    expect(migrated.password_salt).toBeTruthy();
    expect(migrated.password_hash).not.toBe('8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8');
  });

  it('accepts legacy bcrypt password records and rehashes them', async () => {
    await authService.upsertAuthUser('legacy-bcrypt@side.quest', 'seed-pass');
    const legacyUser = await authService.getAuthUser('legacy-bcrypt@side.quest');
    legacyUser.password_hash = bcrypt.hashSync('legacy-bcrypt-pass', 10);
    legacyUser.password_salt = '';

    const login = await postJson('/api/auth/login', {
      email: 'legacy-bcrypt@side.quest',
      password: 'legacy-bcrypt-pass',
    });

    expect(login.response.status).toBe(200);
    expect(login.data.ok).toBe(true);

    const migrated = await authService.getAuthUser('legacy-bcrypt@side.quest');
    expect(migrated.password_salt).toBeTruthy();
    expect(migrated.password_hash.startsWith('$2')).toBe(false);
  });

  it('saves profile updates and returns photo on login', async () => {
    await postJson('/api/auth/signup', {
      email: 'profile-photo@side.quest',
      password: 'safe-pass',
      profile: { characterName: 'profile_photo', firstName: 'Profile' },
    });

    const saveProfile = await postJson('/api/auth/profile', {
      email: 'profile-photo@side.quest',
      profile: {
        email: 'profile-photo@side.quest',
        characterName: 'profile_photo',
        firstName: 'Profile',
        photo: 'data:image/jpeg;base64,abc123',
      },
    });
    expect(saveProfile.response.status).toBe(200);
    expect(saveProfile.data.ok).toBe(true);
    expect(saveProfile.data.profile?.photo).toBe('data:image/jpeg;base64,abc123');

    const login = await postJson('/api/auth/login', {
      email: 'profile-photo@side.quest',
      password: 'safe-pass',
    });
    expect(login.response.status).toBe(200);
    expect(login.data.profile?.photo).toBe('data:image/jpeg;base64,abc123');
  });
});
