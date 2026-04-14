import assert from 'node:assert/strict';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';

import { youtubeScript } from './yt-subs-sdk.js';

const execAsync = promisify(exec);

const VIDEO_URL = 'https://www.youtube.com/watch?v=wd9WJ8uazVg&list=PLjyCRcs63y81JbTc8bqzkcgRWzA7_H23B&index=1';
const VIDEO_ID = 'wd9WJ8uazVg';

describe('youtubeScript e2e (programmatic)', () => {
    it('fetches transcript for a known video', { timeout: 30000 }, async () => {
        const result = await youtubeScript({ videoUrl: VIDEO_URL });

        assert.ok(!result.err, `unexpected error: ${result.err}`);

        assert.equal(typeof result.title, 'string');
        assert.ok(result.title.length > 0, 'title should be non-empty');

        assert.equal(typeof result.text, 'string');
        assert.ok(result.text.length > 0, 'transcript text should be non-empty');

        assert.equal(typeof result.description, 'string');

        assert.equal(typeof result.metadata, 'object');
        assert.equal(result.metadata.videoId, VIDEO_ID);
    });
});

describe('yt-cli e2e (CLI invocation)', () => {
    it('prints markdown transcript output when invoked on the command line', { timeout: 30000 }, async () => {
        let stdout;
        try {
            ({ stdout } = await execAsync(`yt-cli "${VIDEO_URL}"`));
        } catch (err) {
            if (err.code === 127) {
                assert.fail('yt-cli not found on PATH — run in the project directory: npm link');
            }
            throw err;
        }

        assert.match(stdout, /^# .+/m);
        assert.ok(stdout.includes('## Metadata'));
        assert.ok(stdout.includes('## Description'));
        assert.ok(stdout.includes('## Text'));
        assert.ok(stdout.includes(VIDEO_ID));
    });
});
