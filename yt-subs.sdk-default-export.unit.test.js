import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import ytSubSdk, { youtubeScript } from './yt-subs-sdk.js';

describe('ytSubSdk default export', () => {
    it('exposes extractFromVideo, outputTextOnly, and outputAsMarkdown', () => {
        assert.strictEqual(typeof ytSubSdk.extractFromVideo, 'function');
        assert.strictEqual(typeof ytSubSdk.outputTextOnly, 'function');
        assert.strictEqual(typeof ytSubSdk.outputAsMarkdown, 'function');
    });

    it('extractFromVideo is the same function as the named youtubeScript export', () => {
        assert.strictEqual(ytSubSdk.extractFromVideo, youtubeScript);
    });
});
