import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import ytSubSdk from './yt-subs-sdk.js';

describe('outputAsMarkdown', () => {
    const result = {
        title: 'Never Gonna Give You Up',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        metadata: { videoId: 'dQw4w9WgXcQ', author: 'RickAstleyVEVO' },
        description: 'Official music video',
        text: 'Never gonna give you up, never gonna let you down',
    };

    it('returns a string starting with the title heading', () => {
        const out = ytSubSdk.outputAsMarkdown(result);
        assert.ok(out.startsWith(`# ${result.title}\n`));
    });

    it('includes a retrieval line with the video URL and an ISO timestamp', () => {
        const out = ytSubSdk.outputAsMarkdown(result);
        assert.match(
            out,
            /Retrieved from https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ on \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/,
        );
    });

    it('includes metadata as JSON', () => {
        const out = ytSubSdk.outputAsMarkdown(result);
        assert.ok(out.includes('\n\n## Metadata\n'));
        assert.ok(out.includes(JSON.stringify(result.metadata)));
    });

    it('includes description and text sections', () => {
        const out = ytSubSdk.outputAsMarkdown(result);
        assert.ok(out.includes('\n\n## Description\n'));
        assert.ok(out.includes(result.description));
        assert.ok(out.includes('\n\n## Text\n'));
        assert.ok(out.endsWith(result.text));
    });
});
