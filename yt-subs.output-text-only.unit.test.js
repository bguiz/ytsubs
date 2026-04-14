import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import ytSubSdk from './yt-subs-sdk.js';

describe('outputTextOnly', () => {
    it('returns result.text', () => {
        assert.strictEqual(
            ytSubSdk.outputTextOnly({ text: 'some transcript text' }),
            'some transcript text',
        );
    });

    it('returns empty string when text is empty', () => {
        assert.strictEqual(ytSubSdk.outputTextOnly({ text: '' }), '');
    });
});
