import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { youtubeScript } from './yt-subs.js';

const VIDEO_URL = 'https://www.youtube.com/watch?v=wd9WJ8uazVg&list=PLjyCRcs63y81JbTc8bqzkcgRWzA7_H23B&index=1';
const VIDEO_ID = 'wd9WJ8uazVg';

describe('youtubeScript e2e', () => {
    it('fetches transcript for a known video', { timeout: 30000 }, async () => {
        const result = await youtubeScript({ videoUrl: VIDEO_URL });

        assert.equal(typeof result.title, 'string');
        assert.ok(result.title.length > 0, 'title should be non-empty');

        assert.equal(typeof result.text, 'string');
        assert.ok(result.text.length > 0, 'transcript text should be non-empty');

        assert.equal(typeof result.description, 'string');

        assert.equal(typeof result.metadata, 'object');
        assert.equal(result.metadata.videoId, VIDEO_ID);
    });
});
