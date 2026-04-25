import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before, after, beforeEach } from 'node:test';

import {
  fileExists,
  downloadFile,
  mcpHeaders,
  sseToJson,
  serve,
  _resetMcpSessionForTest,
} from './yt-subs-docs-openapi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

function mockReq(method, url, body = '') {
  return {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    [Symbol.asyncIterator]: async function* () {
      if (body) yield Buffer.from(body);
    },
  };
}

function mockRes() {
  const chunks = [];
  return {
    statusCode: null,
    headers: {},
    writeHead(status, hdrs = {}) {
      this.statusCode = status;
      if (hdrs) Object.assign(this.headers, hdrs);
    },
    end(body) {
      if (body == null) return;
      chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
    },
    get body() {
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

// ---------------------------------------------------------------------------
// fileExists
// ---------------------------------------------------------------------------

describe('fileExists', () => {
  it('returns true for a file that exists', async () => {
    // process.execPath is the node binary — always present
    assert.equal(await fileExists(process.execPath), true);
  });

  it('returns false for a file that does not exist', async () => {
    assert.equal(await fileExists('/tmp/__yt-subs-no-such-file-12345__'), false);
  });
});

// ---------------------------------------------------------------------------
// downloadFile
// ---------------------------------------------------------------------------

describe('downloadFile', () => {
  let savedFetch;
  before(() => {
    savedFetch = globalThis.fetch;
  });
  after(() => {
    globalThis.fetch = savedFetch;
  });

  it('throws with a descriptive message when fetch returns a non-ok response', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
    await assert.rejects(
      () => downloadFile('https://example.com/fake.js', '/tmp/fake.js'),
      (err) => {
        assert.match(err.message, /Failed to download/);
        assert.match(err.message, /404/);
        return true;
      },
    );
  });

  it('writes file content to disk when fetch succeeds', async () => {
    const tmpPath = `/tmp/__yt-subs-download-test-${Date.now()}__`;
    const content = 'hello swagger content';
    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(content).buffer,
    });
    try {
      await downloadFile('https://example.com/file.js', tmpPath);
      const written = await readFile(tmpPath, 'utf8');
      assert.equal(written, content);
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// serve — static routes (no network I/O required)
// ---------------------------------------------------------------------------

describe('serve — static routes', () => {
  it('GET / returns 200 HTML containing Swagger UI markers', async () => {
    const res = mockRes();
    await serve(mockReq('GET', '/'), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /text\/html/);
    assert.ok(res.body.includes('swagger-ui-bundle.js'), 'body should reference swagger-ui-bundle.js');
    assert.ok(res.body.includes('SwaggerUIBundle'), 'body should initialise SwaggerUIBundle');
    assert.ok(res.body.includes('ytsubs Server API'), 'body should have correct page title');
  });

  it('GET /index.html returns 200 HTML (same as /)', async () => {
    const res = mockRes();
    await serve(mockReq('GET', '/index.html'), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /text\/html/);
  });

  it('GET /openapi.yaml returns 200 YAML starting with "openapi:"', async () => {
    const res = mockRes();
    await serve(mockReq('GET', '/openapi.yaml'), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /text\/yaml/);
    assert.match(res.body, /^openapi:/);
  });

  it('GET /nonexistent returns 404 Not Found', async () => {
    const res = mockRes();
    await serve(mockReq('GET', '/nonexistent'), res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body, 'Not Found');
  });

  it('GET /swagger-ui-bundle.js returns 200 JS if dist file exists, 500 otherwise', async () => {
    const distFile = join(__dirname, '..', 'dist', 'docs-openapi', 'swagger-ui-bundle.js');
    const res = mockRes();
    await serve(mockReq('GET', '/swagger-ui-bundle.js'), res);
    if (existsSync(distFile)) {
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['Content-Type'], /javascript/);
    } else {
      assert.equal(res.statusCode, 500);
    }
  });

  it('GET /swagger-ui.css returns 200 CSS if dist file exists, 500 otherwise', async () => {
    const distFile = join(__dirname, '..', 'dist', 'docs-openapi', 'swagger-ui.css');
    const res = mockRes();
    await serve(mockReq('GET', '/swagger-ui.css'), res);
    if (existsSync(distFile)) {
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['Content-Type'], /css/);
    } else {
      assert.equal(res.statusCode, 500);
    }
  });
});

// ---------------------------------------------------------------------------
// serve — POST /mcp proxy (fetch-mocked)
// ---------------------------------------------------------------------------

describe('serve — POST /mcp proxy', () => {
  let savedFetch;

  before(() => {
    savedFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = savedFetch;
    _resetMcpSessionForTest();
  });

  beforeEach(() => {
    _resetMcpSessionForTest();
  });

  it('returns 502 when the ytsubs server is unreachable (fetch rejects)', async () => {
    globalThis.fetch = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const res = mockRes();
    await serve(mockReq('POST', '/mcp', '{}'), res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body, /Could not reach MCP server/);
  });

  it('returns 502 when the server returns no mcp-session-id on initialize', async () => {
    globalThis.fetch = async () => ({
      headers: { get: () => null },
      text: async () => '',
    });
    const res = mockRes();
    await serve(mockReq('POST', '/mcp', '{}'), res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body, /Could not reach MCP server/);
  });

  it('returns 200 JSON when session init succeeds and server returns JSON', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        // initialize → return a valid session ID
        return {
          headers: { get: (n) => (n === 'mcp-session-id' ? 'test-sid-1' : null) },
          text: async () => '',
        };
      }
      if (callCount === 2) {
        // notifications/initialized → 202
        return { headers: { get: () => null }, text: async () => '' };
      }
      // actual proxy request → JSON response
      return {
        status: 200,
        headers: { get: (n) => (n === 'content-type' ? 'application/json' : null) },
        arrayBuffer: async () => new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"result":{}}').buffer,
      };
    };
    const res = mockRes();
    await serve(mockReq('POST', '/mcp', '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /application\/json/);
  });

  it('returns 200 JSON when server responds with SSE (converts to JSON)', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          headers: { get: (n) => (n === 'mcp-session-id' ? 'test-sid-2' : null) },
          text: async () => '',
        };
      }
      if (callCount === 2) {
        return { headers: { get: () => null }, text: async () => '' };
      }
      // SSE response
      return {
        status: 200,
        headers: { get: (n) => (n === 'content-type' ? 'text/event-stream' : null) },
        text: async () => 'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n',
      };
    };
    const res = mockRes();
    await serve(mockReq('POST', '/mcp', '{}'), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /application\/json/);
    const parsed = JSON.parse(res.body);
    assert.ok(Array.isArray(parsed.result?.tools));
  });

  it('returns 502 when the proxy fetch itself throws (network error mid-session)', async () => {
    // Simulate: session already established, but the proxy request fails
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          headers: { get: (n) => (n === 'mcp-session-id' ? 'test-sid-3' : null) },
          text: async () => '',
        };
      }
      if (callCount === 2) {
        return { headers: { get: () => null }, text: async () => '' };
      }
      // proxy request throws
      throw new Error('socket hang up');
    };
    const res = mockRes();
    await serve(mockReq('POST', '/mcp', '{}'), res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body, /MCP request failed/);
  });

  it('re-establishes session and retries when proxy returns 400 (session expired)', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        // initial initialize
        return {
          headers: { get: (n) => (n === 'mcp-session-id' ? 'sid-old' : null) },
          text: async () => '',
        };
      }
      if (callCount === 2) {
        // initial notifications/initialized
        return { headers: { get: () => null }, text: async () => '' };
      }
      if (callCount === 3) {
        // first proxy attempt — 400 session expired
        return {
          status: 400,
          headers: { get: () => null },
          text: async () => 'session expired',
        };
      }
      if (callCount === 4) {
        // re-initialize
        return {
          headers: { get: (n) => (n === 'mcp-session-id' ? 'sid-new' : null) },
          text: async () => '',
        };
      }
      if (callCount === 5) {
        // re-notifications/initialized
        return { headers: { get: () => null }, text: async () => '' };
      }
      // callCount === 6: second proxy attempt — success
      return {
        status: 200,
        headers: { get: (n) => (n === 'content-type' ? 'application/json' : null) },
        arrayBuffer: async () => new TextEncoder().encode('{"ok":true}').buffer,
      };
    };
    const res = mockRes();
    await serve(mockReq('POST', '/mcp', '{}'), res);
    assert.equal(res.statusCode, 200);
    assert.equal(callCount, 6);
  });

  it('returns 502 when session re-establishment fails after receiving 400', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          headers: { get: (n) => (n === 'mcp-session-id' ? 'sid-old' : null) },
          text: async () => '',
        };
      }
      if (callCount === 2) {
        return { headers: { get: () => null }, text: async () => '' };
      }
      if (callCount === 3) {
        // first proxy attempt — 400
        return {
          status: 400,
          headers: { get: () => null },
          text: async () => '',
        };
      }
      // re-init attempt fails
      throw new Error('server is down');
    };
    const res = mockRes();
    await serve(mockReq('POST', '/mcp', '{}'), res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body, /Could not re-establish MCP session/);
  });

  it('returns 200 with empty content-type when proxy response has no content-type header', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          headers: { get: (n) => (n === 'mcp-session-id' ? 'sid-no-ct' : null) },
          text: async () => '',
        };
      }
      if (callCount === 2) {
        return { headers: { get: () => null }, text: async () => '' };
      }
      // proxy response with null content-type — exercises the ?? '' branch
      return {
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => new TextEncoder().encode('{}').buffer,
      };
    };
    const res = mockRes();
    await serve(mockReq('POST', '/mcp', '{}'), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], '');
  });

  it('returns 500 when request body iteration throws unexpectedly', async () => {
    const req = {
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      // biome-ignore lint/correctness/useYield: allow in tests
      [Symbol.asyncIterator]: async function* () {
        throw new Error('connection reset by peer');
      },
    };
    const res = mockRes();
    await serve(req, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /Internal Server Error/);
    assert.match(res.body, /connection reset by peer/);
  });
});

// ---------------------------------------------------------------------------
// mcpHeaders — explicit branch coverage
// ---------------------------------------------------------------------------

describe('mcpHeaders', () => {
  it('sets default content-type and omits mcp-session-id when sessionId is null', () => {
    const h = mcpHeaders(null);
    assert.equal(h['Content-Type'], 'application/json');
    assert.equal(h.Accept, 'application/json, text/event-stream');
    assert.equal(Object.hasOwn(h, 'mcp-session-id'), false);
  });

  it('includes mcp-session-id when sessionId is provided', () => {
    const h = mcpHeaders('my-session');
    assert.equal(h['mcp-session-id'], 'my-session');
    assert.equal(h['Content-Type'], 'application/json');
  });

  it('uses the provided contentType over the default', () => {
    const h = mcpHeaders('sid', 'application/x-ndjson');
    assert.equal(h['Content-Type'], 'application/x-ndjson');
  });
});

// ---------------------------------------------------------------------------
// sseToJson — direct unit tests
// ---------------------------------------------------------------------------

describe('sseToJson', () => {
  it('extracts JSON from the last data: line', async () => {
    const fakeRes = { text: async () => 'data: {"a":1}\ndata: {"b":2}\n' };
    const result = await sseToJson(fakeRes);
    assert.equal(result, '{"b":2}');
  });

  it('returns "{}" when there are no data: lines', async () => {
    const fakeRes = { text: async () => 'event: message\n\n' };
    const result = await sseToJson(fakeRes);
    assert.equal(result, '{}');
  });

  it('handles a single data: line', async () => {
    const fakeRes = { text: async () => 'data: {"tools":[]}\n' };
    const result = await sseToJson(fakeRes);
    assert.equal(result, '{"tools":[]}');
  });
});
