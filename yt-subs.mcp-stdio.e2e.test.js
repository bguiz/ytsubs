import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const VIDEO_URL = 'https://www.youtube.com/watch?v=wd9WJ8uazVg&list=PLjyCRcs63y81JbTc8bqzkcgRWzA7_H23B&index=1';
const VIDEO_ID = 'wd9WJ8uazVg';

describe('ytsubs-mcp e2e', () => {
    let client;

    // set up an MCP client which will run `ytsubs-mcp stdio`,
    // then connect to the MCP server which that command spawns, over the Stdio transport
    before(async () => {
        const transport = new StdioClientTransport({
            command: 'ytsubs-mcp',
            args: ['stdio'],
            stderr: 'pipe',
        });
        client = new Client({ name: 'test-client', version: '0.0.1' });
        try {
            await client.connect(transport);
        } catch (err) {
            if (err.code === 'ENOENT') {
                assert.fail('ytsubs-mcp not found on PATH — run in the project directory: npm link');
            }
            throw err;
        }
    }, { timeout: 10e3 });

    after(async () => {
        try {
            await client?.close();
        } catch {
            // ignore cleanup errors
        }
    });

    it('lists the youtube-transcript-extract tool with correct metadata', async () => {
        const { tools } = await client.listTools();

        const tool = tools.find(t => t.name === 'youtube-transcript-extract');
        assert.ok(tool, 'youtube-transcript-extract tool not registered');
        assert.match(tool.description, /transcript/i);
        assert.ok(tool.inputSchema, 'tool should have an inputSchema');
    });

    it('returns plain transcript text with onlyText: true', { timeout: 30000 }, async () => {
        const response = await client.callTool({
            name: 'youtube-transcript-extract',
            arguments: { videoUrl: VIDEO_URL, onlyText: true },
        });

        assert.ok(!response.isError, `unexpected error: ${JSON.stringify(response.content)}`);
        assert.strictEqual(response.content.length, 1);
        assert.strictEqual(response.content[0].type, 'text');
        assert.ok(response.content[0].text.length > 0, 'transcript text should be non-empty');
    });

    it('returns full result as JSON with onlyText: false', { timeout: 30000 }, async () => {
        const response = await client.callTool({
            name: 'youtube-transcript-extract',
            arguments: { videoUrl: VIDEO_URL, onlyText: false },
        });

        assert.ok(!response.isError, `unexpected error: ${JSON.stringify(response.content)}`);
        assert.strictEqual(response.content.length, 1);
        assert.strictEqual(response.content[0].type, 'text');

        const data = JSON.parse(response.content[0].text);
        assert.equal(typeof data.title, 'string');
        assert.ok(data.title.length > 0, 'title should be non-empty');
        assert.equal(typeof data.text, 'string');
        assert.ok(data.text.length > 0, 'transcript should be non-empty');
        assert.equal(typeof data.description, 'string');
        assert.equal(typeof data.metadata, 'object');
        assert.equal(data.metadata.videoId, VIDEO_ID);
    });
});
