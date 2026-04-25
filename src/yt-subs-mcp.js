#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import pkg from '../package.json' with { type: 'json' };
import { extractFromVideo } from './yt-subs-sdk.js';

export const server = new McpServer({
  name: 'ytsubs-mcp',
  version: pkg.version,
});

server.registerTool(
  'youtube-transcript-extract',
  {
    description: 'Extracts transcript/ captions/ subtitles from youtube videos (plus metadata)',
    inputSchema: z.object({
      videoUrl: z.string().meta({ description: 'Youtube URL or video ID' }),
      onlyText: z
        .boolean()
        .default(true)
        .meta({ description: 'When false, includes title, description, and metadata' }),
      language: z.string().default('en').meta({ description: 'Two-letter BCP-47 language code, e.g. "en", "fr"' }),
      textType: z.enum(['text', 'srt', 'vtt']).default('text').meta({ description: 'Transcript output format' }),
      cache: z.boolean().default(true).meta({ description: 'Enable filesystem cache; set false to disable' }),
      retry: z
        .boolean()
        .default(true)
        .meta({ description: 'Enable automatic retries on transient failure; set false to disable' }),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ videoUrl, onlyText, language, textType, cache, retry }) => {
    const result = await extractFromVideo({
      videoUrl,
      options: { language, textType, cache, retry },
    });
    if (result.err) {
      return {
        isError: true,
        content: [{ type: 'text', text: result.err }],
      };
    }
    let out;
    if (onlyText) {
      out = result.text;
    } else {
      const { title, description, metadata, text } = result;
      out = JSON.stringify({ title, description, metadata, text });
    }
    return {
      content: [
        {
          type: 'text',
          text: out,
        },
      ],
    };
  },
);

/**
 * Starts the MCP server using the stdio transport.
 * Suitable for use with MCP clients that communicate via stdin/stdout,
 * (any client using `StdioClientTransport`).
 * @returns {Promise<void>}
 */
export async function runWithStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'http') {
    process.stderr.write('Error: HTTP server has moved. Use: node src/yt-subs-server.js (or npm run api:http)\n');
    process.exitCode = 1;
  } else {
    runWithStdio().catch(console.error);
  }
}
