import assert from 'node:assert/strict';
import { describe, it, mock, beforeEach, afterEach } from 'node:test';

import { printResult } from './yt-subs-sdk.js';

describe('printResult', () => {
    let logCalls;
    let logMock;

    beforeEach(() => {
        logCalls = [];
        logMock = mock.method(console, 'log', (...args) => logCalls.push(args[0]));
    });

    afterEach(() => {
        logMock.mock.restore();
    });

    it('prints the full markdown output as a single console.log call', () => {
        const result = {
            title: 'Never Gonna Give You Up',
            videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            metadata: { videoId: 'dQw4w9WgXcQ', author: 'RickAstleyVEVO' },
            description: 'Official music video',
            text: 'Never gonna give you up, never gonna let you down',
        };

        printResult(result);

        assert.strictEqual(logCalls.length, 1);
        const output = logCalls[0];
        assert.ok(output.startsWith(`# ${result.title}\n`));
        assert.match(
            output,
            /Retrieved from https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ on \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/,
        );
        assert.ok(output.includes('\n\n## Metadata\n'));
        assert.ok(output.includes(JSON.stringify(result.metadata)));
        assert.ok(output.includes('\n\n## Description\n'));
        assert.ok(output.includes(result.description));
        assert.ok(output.includes('\n\n## Text\n'));
        assert.ok(output.endsWith(result.text));
    });
});
