import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it, before, after } from 'node:test';

const VIDEO_URL = 'https://www.youtube.com/watch?v=wd9WJ8uazVg&list=PLjyCRcs63y81JbTc8bqzkcgRWzA7_H23B&index=1';
const VIDEO_ID = 'wd9WJ8uazVg';

describe('ytsubs-server e2e (REST)', () => {
  let baseUrl;
  let serverProcess;

  before(
    async () => {
      serverProcess = spawn('ytsubs-server', [], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let port;
      try {
        port = await new Promise((resolve, reject) => {
          let stderr = '';
          serverProcess.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
            const match = stderr.match(/LISTEN (\d+)/);
            if (match) {
              resolve(parseInt(match[1], 10));
            }
          });
          serverProcess.on('error', reject);
          serverProcess.on('close', (code) => {
            reject(new Error(`server exited (code ${code}) before announcing port`));
          });
        });
      } catch (err) {
        if (err.code === 'ENOENT') {
          assert.fail('ytsubs-server not found on PATH — run in the project directory: npm link');
        }
        throw err;
      }

      baseUrl = `http://127.0.0.1:${port}`;
    },
    { timeout: 15e3 },
  );

  after(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
  });

  it('GET /health returns 200 with status ok and CORS header', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(typeof data.version, 'string');
    assert.ok(data.version.length > 0);
  });

  it('OPTIONS /health returns 204 with CORS headers', async () => {
    const res = await fetch(`${baseUrl}/health`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /GET/);
  });

  it('OPTIONS /transcript returns 204 with CORS headers', async () => {
    const res = await fetch(`${baseUrl}/transcript`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /GET/);
  });

  it('GET /transcript without videoUrl returns 400', async () => {
    const res = await fetch(`${baseUrl}/transcript`);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(typeof data.error, 'string');
    assert.ok(data.error.length > 0);
  });

  it('GET /transcript with too-short videoUrl returns 400', async () => {
    const res = await fetch(`${baseUrl}/transcript?videoUrl=short`);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(typeof data.error, 'string');
  });

  it('GET /transcript returns full JSON by default', { timeout: 30_000 }, async () => {
    const res = await fetch(`${baseUrl}/transcript?videoUrl=${encodeURIComponent(VIDEO_URL)}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.videoUrl, VIDEO_URL);
    assert.equal(typeof data.title, 'string');
    assert.ok(data.title.length > 0);
    assert.equal(typeof data.description, 'string');
    assert.equal(typeof data.metadata, 'object');
    assert.equal(data.metadata.videoId, VIDEO_ID);
    assert.equal(typeof data.text, 'string');
    assert.ok(data.text.length > 0);
  });

  it('GET /transcript?onlyText=true returns { text } only', { timeout: 30_000 }, async () => {
    const res = await fetch(`${baseUrl}/transcript?videoUrl=${encodeURIComponent(VIDEO_URL)}&onlyText=true`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(typeof data.text, 'string');
    assert.ok(data.text.length > 0);
    assert.equal(data.title, undefined, 'title should not be present when onlyText=true');
  });

  it('GET /transcript?textType=srt returns SRT-formatted text', { timeout: 30_000 }, async () => {
    const res = await fetch(`${baseUrl}/transcript?videoUrl=${encodeURIComponent(VIDEO_URL)}&textType=srt`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.text, /^\d+\n\d{2}:\d{2}:\d{2},\d{3} --> /);
  });

  it('GET /nonexistent returns 404', async () => {
    const res = await fetch(`${baseUrl}/nonexistent`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(typeof data.error, 'string');
  });
});
