#!/usr/bin/env node
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import pkg from '../package.json' with { type: 'json' };
import { server as mcpServer } from './yt-subs-mcp.js';
import { extractFromVideo } from './yt-subs-sdk.js';

const TranscriptQuerySchema = z.object({
  videoUrl: z.string().min(11),
  language: z.string().default('en'),
  textType: z.enum(['text', 'srt', 'vtt']).default('text'),
  cache: z.preprocess((v) => typeof v === 'undefined' || v !== 'false', z.boolean()),
  retry: z.preprocess((v) => typeof v === 'undefined' || v !== 'false', z.boolean()),
  onlyText: z.preprocess((v) => v === 'true', z.boolean()),
});

/**
 * Maps a known error message prefix to the appropriate HTTP status code.
 * @param {string} msg Error message returned by the SDK.
 * @returns {number} HTTP status code (400, 404, 422, 503, or 504).
 */
function errToStatus(msg) {
  if (msg.startsWith('video URL is missing') || msg.startsWith('video URL is invalid')) return 400;
  if (
    msg.startsWith('Video is unavailable') ||
    msg.startsWith('Transcripts are disabled') ||
    msg.startsWith('No transcript available')
  )
    return 404;
  if (msg.startsWith('Language not available') || msg.startsWith('Invalid language code')) return 422;
  if (msg.startsWith('Timed out after')) return 504;
  return 503;
}

/**
 * Writes a JSON-encoded `body` with the given `status` code to `res`.
 * @param {ServerResponse} res HTTP response to write to.
 * @param {number} status HTTP status code.
 * @param {object} body Response payload to JSON-encode.
 */
function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Handles GET /transcript: validates query params, extracts the transcript, and writes a JSON response.
 * @param {IncomingMessage} req Incoming HTTP request carrying query parameters.
 * @param {ServerResponse} res HTTP response to write the transcript result to.
 * @returns {Promise<void>} Resolves once the response has been written.
 */
async function handleTranscript(req, res) {
  const { searchParams } = new URL(req.url, `http://localhost`);
  const raw = Object.fromEntries(searchParams.entries());

  const parsed = TranscriptQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(res, 400, { error: parsed.error.issues.map((i) => i.message).join('; ') });
  }

  const { videoUrl, language, textType, cache, retry, onlyText } = parsed.data;
  const result = await extractFromVideo({ videoUrl, options: { language, textType, cache, retry } });

  if (result.err) {
    return jsonResponse(res, errToStatus(result.err), { error: result.err });
  }

  if (onlyText) {
    return jsonResponse(res, 200, { text: result.text });
  }
  return jsonResponse(res, 200, {
    videoUrl: result.videoUrl,
    title: result.title,
    description: result.description,
    metadata: result.metadata,
    text: result.text,
  });
}

/**
 * Handles GET /health: responds with `{ status: 'ok', version }`.
 * @param {IncomingMessage} _req Unused incoming request.
 * @param {ServerResponse} res HTTP response to write to.
 */
function handleHealth(_req, res) {
  jsonResponse(res, 200, { status: 'ok', version: pkg.version });
}

/**
 * Sets permissive CORS headers on `res` for cross-origin browser access.
 * @param {ServerResponse} res HTTP response to attach CORS headers to.
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Starts the combined REST + MCP Streaming HTTP server.
 * Binds to the host and port configured by `YTSUBS_HOST` and `YTSUBS_PORT`
 * (defaults: `127.0.0.1` and `0` for an OS-assigned ephemeral port).
 * Once the server is ready, writes `LISTEN <port>` to stderr.
 *
 * Routes:
 *   /mcp        → MCP Streaming HTTP transport (POST/GET/DELETE)
 *   /transcript → REST transcript extraction (GET)
 *   /health     → REST health check (GET)
 * @returns {Promise<void>}
 */
export async function runWithHttp() {
  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(mcpTransport);

  const httpServer = createServer((req, res) => {
    const { pathname } = new URL(req.url, `http://localhost`);

    // MCP transport writes its own response headers — do not inject CORS there.
    if (pathname === '/mcp') {
      mcpTransport.handleRequest(req, res);
      return;
    }

    // All non-MCP routes: add CORS headers so browser clients (e.g. Swagger UI) can reach them.
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
    } else if (pathname === '/transcript' && req.method === 'GET') {
      handleTranscript(req, res).catch((err) => {
        if (!res.headersSent) jsonResponse(res, 503, { error: err.message });
      });
    } else if (pathname === '/health' && req.method === 'GET') {
      handleHealth(req, res);
    } else {
      jsonResponse(res, 404, { error: 'Not Found' });
    }
  });

  // Allow long-lived MCP SSE streams to stay open indefinitely.
  httpServer.keepAliveTimeout = 0;

  const listenPort = parseInt(process.env.YTSUBS_PORT ?? '0', 10);
  const listenHost = process.env.YTSUBS_HOST ?? '127.0.0.1';

  await new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(listenPort, listenHost, () => {
      const { port } = httpServer.address();
      process.stderr.write(`LISTEN ${port}\n`);
      resolve();
    });
  });
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWithHttp().catch(console.error);
}
