import assert from 'node:assert/strict';
import { describe, it, mock, beforeEach, afterEach } from 'node:test';

import { extractVideoId, printResult, youtubeScript } from './yt-subs.js';

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
        let exitMock;
        let errorMock;

        beforeEach(() => {
            exitMock = mock.method(process, 'exit', (code) => {
                throw new Error(`process.exit(${code})`);
            });
            errorMock = mock.method(console, 'error', () => {});
        });

        afterEach(() => {
            exitMock.mock.restore();
            errorMock.mock.restore();
        });

        it('exits with code 1 for missing videoUrl', () => {
            assert.throws(
                () => extractVideoId(undefined),
                { message: 'process.exit(1)' },
            );
        });

        it('exits with code 1 for non-string videoUrl', () => {
            assert.throws(
                () => extractVideoId(42),
                { message: 'process.exit(1)' },
            );
        });

        it('exits with code 1 for a URL with no recognisable video ID', () => {
            assert.throws(
                () => extractVideoId('https://www.youtube.com/watch?list=PLxxx'),
                { message: 'process.exit(1)' },
            );
        });

        it('exits with code 1 for a string that is not 11 characters and not a YouTube URL', () => {
            assert.throws(
                () => extractVideoId('tooshort'),  // 8 chars, not a URL
                { message: 'process.exit(1)' },
            );
        });
    });
});

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

    it('prints title, metadata, description, and text in order', () => {
        const result = {
            title: 'Never Gonna Give You Up',
            videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            metadata: { videoId: 'dQw4w9WgXcQ', author: 'RickAstleyVEVO' },
            description: 'Official music video',
            text: 'Never gonna give you up, never gonna let you down',
        };

        printResult(result);

        assert.strictEqual(logCalls[0], `# ${result.title}\n`);
        assert.match(
            logCalls[1],
            /^Retrieved from https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ on \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
        );
        assert.strictEqual(logCalls[2], '\n\n## Metadata\n');
        assert.strictEqual(logCalls[3], JSON.stringify(result.metadata));
        assert.strictEqual(logCalls[4], '\n\n## Description\n');
        assert.strictEqual(logCalls[5], result.description);
        assert.strictEqual(logCalls[6], '\n\n## Text\n');
        assert.strictEqual(logCalls[7], result.text);
        assert.strictEqual(logCalls.length, 8);
    });
});

describe('youtubeScript', () => {
    const fakeVideoDetails = {
        title: 'Never Gonna Give You Up',
        description: 'Official Rick Astley music video',
        videoId: 'dQw4w9WgXcQ',
        author: 'RickAstleyVEVO',
    };
    const fakeSegments = [
        { text: 'Never gonna give you up', offset: 0, duration: 2e3 },
        { text: 'never gonna let you down', offset: 2e3, duration: 2e3 },
    ];
    const fakeTranscriptText = 'Never gonna give you up, never gonna let you down';

    const fakeDepsBase = {
        FsCache: class { constructor() {} },
    };

    it('happy case: returns structured result for a valid video URL', async () => {
        const deps = {
            ...fakeDepsBase,
            fetchTranscript: async () => ({
                videoDetails: fakeVideoDetails,
                segments: fakeSegments,
            }),
            toPlainText: () => fakeTranscriptText,
        };

        const result = await youtubeScript({
            videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            _deps: deps,
        });

        assert.strictEqual(result.title, 'Never Gonna Give You Up');
        assert.strictEqual(result.description, 'Official Rick Astley music video');
        assert.strictEqual(result.text, fakeTranscriptText);
        assert.deepStrictEqual(result.metadata, {
            videoId: 'dQw4w9WgXcQ',
            author: 'RickAstleyVEVO',
        });
    });

    it('failure case: exits with code 2 when fetchTranscript throws', async () => {
        class VideoUnavailableError extends Error {
            constructor(videoId) { super('unavailable'); this.videoId = videoId; }
        }

        const deps = {
            ...fakeDepsBase,
            fetchTranscript: async () => { throw new VideoUnavailableError('dQw4w9WgXcQ'); },
            toPlainText: () => '',
        };

        let capturedExitCode;
        const exitMock = mock.method(process, 'exit', (code) => {
            capturedExitCode = code;
            throw new Error(`process.exit(${code})`);
        });
        const errorMock = mock.method(console, 'error', () => {});

        try {
            await assert.rejects(
                () => youtubeScript({
                    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                    _deps: deps,
                }),
                { message: 'process.exit(2)' },
            );
        } finally {
            exitMock.mock.restore();
            errorMock.mock.restore();
        }

        assert.strictEqual(capturedExitCode, 2);
    });
});
