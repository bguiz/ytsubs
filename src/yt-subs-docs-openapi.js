#!/usr/bin/env node
/**
 * Serves the OpenAPI spec for the ytsubs server using Swagger UI.
 *
 * Also proxies POST /mcp to the running ytsubs server so Swagger UI's
 * "Try it out" works cross-origin and with the correct Accept header.
 * The proxy establishes one persistent MCP session and reuses it for all
 * requests. If the session is invalidated (e.g. server restart), it
 * re-initializes automatically on the next request.
 *
 * On first run, downloads Swagger UI assets into dist/docs-openapi/.
 * Then starts an HTTP server on YTSUBS_DOCS_PORT (default 8080).
 *
 * Environment variables:
 *   YTSUBS_DOCS_PORT   Port for the docs server (default 8080; 0 = ephemeral)
 *   YTSUBS_PORT        Port of the running ytsubs server to proxy to (default 3456)
 */

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DIST_DIR = join(__dirname, '..', 'dist', 'docs-openapi');
const SPEC_FILE = join(__dirname, '..', 'openapi.yaml');
const PORT = parseInt(process.env.YTSUBS_DOCS_PORT ?? '8080', 10);
const SERVER_PORT = parseInt(process.env.YTSUBS_PORT ?? '3456', 10);

const SWAGGER_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist';
const DIST_FILES = ['swagger-ui-bundle.js', 'swagger-ui.css'];

const INDEX_HTML = `<!DOCTYPE html>
<html>
  <head>
    <title>ytsubs Server API</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/swagger-ui.css">
    <style>body { margin: 0; } .topbar { display: none; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({
        url: '/openapi.yaml',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
        deepLinking: true,
        requestInterceptor: (req) => {
          // Route /mcp calls through this server's proxy so that:
          // (a) cross-origin CORS is not needed, and
          // (b) the MCP transport Accept header is set correctly.
          try {
            if (new URL(req.url).pathname === '/mcp') req.url = '/mcp';
          } catch {}
          req.headers['Accept'] = 'application/json, text/event-stream';
          return req;
        },
      });
    </script>
  </body>
</html>`;

const MCP_CLIENT_INIT_PARAMS = {
  protocolVersion: '2025-11-25',
  clientInfo: { name: 'swagger-ui-proxy', version: '0.0.1' },
  capabilities: {},
};

/**
 * Returns true if the file at `path` is accessible, false otherwise.
 * @param {string} path Absolute path to check.
 * @returns {Promise<boolean>} True when accessible, false when not found or inaccessible.
 */
export async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches `url` and writes the response body to `dest`.
 * @param {string} url Remote URL to download.
 * @param {string} dest Absolute path to write the downloaded bytes to.
 * @returns {Promise<void>} Resolves when the file has been written.
 */
export async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/**
 * Downloads Swagger UI assets into dist/docs-openapi/ if they are not already present.
 * @returns {Promise<void>} Resolves when all required assets are on disk.
 */
async function ensureDistFiles() {
  await mkdir(DIST_DIR, { recursive: true });
  for (const file of DIST_FILES) {
    const dest = join(DIST_DIR, file);
    if (!(await fileExists(dest))) {
      process.stdout.write(`Downloading ${file}...\n`);
      await downloadFile(`${SWAGGER_CDN}/${file}`, dest);
    }
  }
}

/**
 * Builds the HTTP headers object required for MCP JSON-RPC requests.
 * @param {string|null} sessionId Active MCP session ID, or null before the session is established.
 * @param {string} [contentType] Overrides the default `application/json` Content-Type.
 * @returns {Record<string, string>} Headers object ready to pass to `fetch`.
 */
export function mcpHeaders(sessionId, contentType) {
  const h = {
    'Content-Type': contentType ?? 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) h['mcp-session-id'] = sessionId;
  return h;
}

/**
 * Reads a `text/event-stream` response body and returns the JSON string from the last `data:` line.
 * Falls back to `'{}'` when no `data:` lines are present.
 * @param {object} res Fetch response carrying a text/event-stream body.
 * @returns {Promise<string>} Raw JSON string extracted from the SSE payload.
 */
export async function sseToJson(res) {
  const text = await res.text();
  return (
    text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))
      .at(-1) ?? '{}'
  );
}

// Persistent MCP session — one session shared across all proxy requests.
// null means uninitialized; set to a session ID string after handshake.
let mcpSessionId = null;

/**
 * Sends `initialize` then `notifications/initialized` to the upstream MCP server and stores
 * the returned session ID in the module-level `mcpSessionId` variable.
 * @returns {Promise<void>} Resolves once the session handshake is complete.
 */
async function initMcpSession() {
  const mcpUrl = `http://127.0.0.1:${SERVER_PORT}/mcp`;

  // 1. initialize — server creates a new session and returns its ID
  const initRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: mcpHeaders(null),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: MCP_CLIENT_INIT_PARAMS,
    }),
  });
  const sessionId = initRes.headers.get('mcp-session-id');
  await initRes.text(); // consume body
  if (!sessionId) throw new Error('MCP server did not return mcp-session-id after initialize');

  // 2. notifications/initialized — one-way; server responds with 202
  const notificationRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: mcpHeaders(sessionId),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
  });
  await notificationRes.text(); // consume body

  mcpSessionId = sessionId;
}

/**
 * Forwards the request body to the upstream MCP server, managing session lifecycle
 * automatically: lazy init on first call, one automatic retry on session expiry (400).
 * @param {import('node:http').IncomingMessage} req Incoming HTTP request from the docs server.
 * @param {import('node:http').ServerResponse} res HTTP response to write the proxied result to.
 * @returns {Promise<void>} Resolves once the proxied response has been written.
 */
async function proxyMcp(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const requestBody = Buffer.concat(chunks);

  // Establish session on first call; reuse on all subsequent calls.
  if (mcpSessionId === null) {
    try {
      await initMcpSession();
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      // TODO respond with error message inside a JSON object instead
      res.end(`Could not reach MCP server at port ${SERVER_PORT}: ${err.message}`);
      return;
    }
  }

  // One automatic retry: if the session was invalidated (MCP server
  // restarted), reset and re-initialize, then try the request once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    let mcpRes;
    try {
      mcpRes = await fetch(`http://127.0.0.1:${SERVER_PORT}/mcp`, {
        method: 'POST',
        headers: mcpHeaders(mcpSessionId, req.headers['content-type']),
        body: requestBody,
      });
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`MCP request failed: ${err.message}`);
      return;
    }

    if (mcpRes.status === 400 && attempt === 0) {
      // Session likely expired; reset and retry with a fresh session.
      await mcpRes.text(); // consume error body
      mcpSessionId = null;
      try {
        await initMcpSession();
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Could not re-establish MCP session: ${err.message}`);
        return;
      }
      continue;
    }

    const contentType = mcpRes.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      // The MCP server responds with SSE. Extract the last data line and
      // return it as plain JSON so Swagger UI can display it correctly.
      const payload = await sseToJson(mcpRes);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(payload);
    } else {
      const data = await mcpRes.arrayBuffer();
      res.writeHead(mcpRes.status, { 'Content-Type': contentType });
      res.end(Buffer.from(data));
    }
    return;
  }
}

/**
 * HTTP request handler for the docs server.
 * Routes: `/` and `/index.html` → Swagger UI HTML; `/openapi.yaml` → spec file;
 * `POST /mcp` → MCP proxy; `/swagger-ui-bundle.js` and `/swagger-ui.css` → static assets.
 * @param {import('node:http').IncomingMessage} req Incoming HTTP request.
 * @param {import('node:http').ServerResponse} res HTTP response to write to.
 * @returns {Promise<void>} Resolves once the response has been written.
 */
export async function serve(req, res) {
  const pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;

  try {
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(INDEX_HTML);
      return;
    }

    if (pathname === '/openapi.yaml') {
      const content = await readFile(SPEC_FILE);
      res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8' });
      res.end(content);
      return;
    }

    if (pathname === '/mcp' && req.method === 'POST') {
      await proxyMcp(req, res);
      return;
    }

    for (const file of DIST_FILES) {
      if (pathname === `/${file}`) {
        const content = await readFile(join(DIST_DIR, file));
        const ct = file.endsWith('.css') ? 'text/css' : 'application/javascript';
        res.writeHead(200, { 'Content-Type': ct });
        res.end(content);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Internal Server Error: ${err.message}`);
  }
}

/**
 * Resets the cached MCP session ID to `null`. Exported for unit-test isolation only.
 */
export function _resetMcpSessionForTest() {
  mcpSessionId = null;
}

// Only start the server when this file is executed directly (not imported).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await ensureDistFiles();
  const server = createServer(serve);
  server.listen(PORT, '127.0.0.1', () => {
    const { port: actualPort } = server.address();
    process.stdout.write(`OpenAPI docs: http://127.0.0.1:${actualPort}/\n`);
  });
}
