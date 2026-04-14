import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractVideoId } from './yt-subs-sdk.js';

describe('extractVideoId', () => {
    describe('valid inputs', () => {
        it('extracts ID from youtube.com watch URL', () => {
            assert.strictEqual(
                extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
                'dQw4w9WgXcQ',
            );
        });

        it('extracts ID from youtube.com watch URL with extra params', () => {
            assert.strictEqual(
                extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'),
                'dQw4w9WgXcQ',
            );
        });

        it('extracts ID from youtu.be short URL', () => {
            assert.strictEqual(
                extractVideoId('https://youtu.be/dQw4w9WgXcQ'),
                'dQw4w9WgXcQ',
            );
        });

        it('returns a bare 11-character video ID as-is', () => {
            assert.strictEqual(
                extractVideoId('dQw4w9WgXcQ'),
                'dQw4w9WgXcQ',
            );
        });
    });

    describe('invalid inputs', () => {
        it('throws for missing videoUrl', () => {
            assert.throws(
                () => extractVideoId(undefined),
                { message: 'video URL is missing' },
            );
        });

        it('throws for non-string videoUrl', () => {
            assert.throws(
                () => extractVideoId(42),
                { message: 'video URL is missing' },
            );
        });

        it('throws for a URL with no recognisable video ID', () => {
            assert.throws(
                () => extractVideoId('https://www.youtube.com/watch?list=PLxxx'),
                { message: 'video URL is invalid: https://www.youtube.com/watch?list=PLxxx' },
            );
        });

        it('throws for a string that is not 11 characters and not a YouTube URL', () => {
            assert.throws(
                () => extractVideoId('tooshort'),
                { message: 'video URL is invalid: tooshort' },
            );
        });
    });
});
