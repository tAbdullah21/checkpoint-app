// Shared helpers for the integration tests: a throwaway database, a running app and a cookie-aware client.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

// Must run before the app (and its database module) is first required.
function useTemporaryDatabase(name) {
  const file = path.join(os.tmpdir(), `checkpoint-test-${name}-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  // The tests talk plain HTTP to the app, so server settings from a developer's .env must not apply
  // (test/integration/production.test.js covers them in separate processes).
  process.env.NODE_ENV = 'test';
  process.env.TRUST_PROXY = '';
  // Only the 60 hand-picked games and no network access: the tests count games and must not reach Steam.
  process.env.CATALOG_EXTENDED = '0';
  process.env.COVER_FETCH = '0';
  return file;
}

async function startApp() {
  const databaseFile = process.env.DATABASE_PATH;
  if (!databaseFile || !databaseFile.includes('checkpoint-test-')) {
    throw new Error('Call useTemporaryDatabase() before startApp() so tests never touch real data.');
  }

  const app = require('../app');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    app,
    baseUrl,
    client: () => new Client(baseUrl),
    async close() {
      server.closeAllConnections?.();
      server.close();
      require('../database/database').closeDatabase();
      for (const file of [databaseFile, `${databaseFile}-shm`, `${databaseFile}-wal`]) {
        fs.rmSync(file, { force: true });
      }
    },
  };
}

// Runs `node app.js` in its own process, exactly as `npm start` does, on a free port (PORT=0) and with the given
// settings added to the environment. Resolves with the server's URL, its output so far, and stop(signal), which
// resolves with the exit code; rejects with the error output if the app refuses to start.
function startServerProcess(settings) {
  const child = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0', ...settings },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const exited = new Promise((done) => child.once('exit', (code) => done(code)));
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/running at http:\/\/localhost:(\d+)/);
      if (match) {
        resolve({
          baseUrl: `http://127.0.0.1:${match[1]}`,
          output: () => output,
          errors: () => errors,
          stop: (signal = 'SIGTERM') => {
            child.kill(signal);
            return exited;
          },
        });
      }
    });
    child.once('error', reject);
    exited.then((code) => reject(new Error(`The server stopped (exit code ${code}): ${errors}`)));
  });
}

// Polls until check() returns true, for output that another process writes when it is ready.
async function waitUntil(check, { timeout = 5000, what = 'the condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function formBody(values) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) parameters.append(key, item);
  }
  return parameters.toString();
}

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async request(pathname, { method = 'GET', form, headers = {} } = {}) {
    const init = { method, redirect: 'manual', headers: { ...headers } };
    if (this.cookie) init.headers.cookie = this.cookie;
    if (form) {
      init.headers['content-type'] = 'application/x-www-form-urlencoded';
      init.body = formBody(form);
    }
    // Browsers send Origin with every form POST; tests behave the same unless a test overrides it.
    if (method !== 'GET' && !Object.keys(init.headers).some((key) => key.toLowerCase() === 'origin')) {
      init.headers.origin = this.baseUrl;
    }

    const response = await fetch(`${this.baseUrl}${pathname}`, init);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const body = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      location: response.headers.get('location'),
      body,
      json: () => JSON.parse(body),
    };
  }

  get(pathname, options) {
    return this.request(pathname, options);
  }

  post(pathname, form = {}, options = {}) {
    return this.request(pathname, { ...options, method: 'POST', form });
  }

  async register({ name, email, password = 'Checkpoint123' }) {
    const response = await this.post('/register', { name, email, password, confirmPassword: password });
    if (response.status !== 302) throw new Error(`Registration failed for ${email}: ${response.status}`);
    return response;
  }

  async login(email, password = 'Checkpoint123') {
    const response = await this.post('/login', { email, password });
    if (response.status !== 302) throw new Error(`Login failed for ${email}: ${response.status}`);
    return response;
  }

  async signUp(name, email, password) {
    await this.register({ name, email, password });
    await this.login(email, password);
    return this;
  }
}

// Reads the numeric ID from a /members/:id link next to a name on the members page.
async function memberIdByName(client, name) {
  const { body } = await client.get(`/members?q=${encodeURIComponent(name)}`);
  const match = body.match(/href="\/members\/(\d+)"/);
  if (!match) throw new Error(`Member ${name} not found`);
  return Number(match[1]);
}

module.exports = { Client, formBody, memberIdByName, startApp, startServerProcess, useTemporaryDatabase, waitUntil };
