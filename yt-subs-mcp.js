#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { extractFromVideo } from './yt-subs-sdk.js';

const server = new McpServer({
  name: 'ytsubs-mcp',
  version: '0.0.1', // TODO extract from package.json
});

server.registerTool(
    'youtube-transcript-extract',
    {
        description: 'Extracts transcript/ captions/ subtitles from youtube videos (plus metadata)',
        inputSchema: z.object({
            videoUrl: z.string().meta({ description: 'Youtube URL or video ID' }),
            onlyText: z.boolean().default(true).meta({ description: 'When false, includes title, description, and metadata' }),
        }),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    },
    async ({ videoUrl, onlyText }) => {
        const result = await extractFromVideo({
            videoUrl,
        });
        let out;
        if (onlyText) {
            out = result.text;
        } else {
            const { title, description, metadata, text } = result;
            out = JSON.stringify({ title, description, metadata, text });
        }
        return {
            content: [{
                type: 'text',
                text: out,
            }],
        };
    },
);

async function runMcpServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runMcpServer()
    .catch(console.error);
