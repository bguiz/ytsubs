import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  YoutubeTranscriptVideoUnavailableError,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptInvalidLangError,
} from 'youtube-transcript-plus';

import { extractFromVideo } from './yt-subs-sdk.js';

describe('extractFromVideo', () => {
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
  const fakeTranscriptSRT = '1\n00:00:00,000 --> 00:00:02,000\nNever gonna give you up';
  const fakeTranscriptVTT = 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nNever gonna give you up';

  const fakeDepsBase = {
    FsCache: class {},
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

    const result = await extractFromVideo({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      _deps: deps,
    });

    assert.strictEqual(result.videoUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(result.title, 'Never Gonna Give You Up');
    assert.strictEqual(result.description, 'Official Rick Astley music video');
    assert.strictEqual(result.text, fakeTranscriptText);
    assert.deepStrictEqual(result.metadata, {
      videoId: 'dQw4w9WgXcQ',
      author: 'RickAstleyVEVO',
    });
  });

  it('defaults to plain text output when no textType option is set', async () => {
    let plainTextCalled = false;
    const deps = {
      ...fakeDepsBase,
      fetchTranscript: async () => ({ videoDetails: fakeVideoDetails, segments: fakeSegments }),
      toPlainText: () => {
        plainTextCalled = true;
        return fakeTranscriptText;
      },
      toSRT: () => {
        throw new Error('toSRT should not be called');
      },
      toVTT: () => {
        throw new Error('toVTT should not be called');
      },
    };
    await extractFromVideo({ videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', _deps: deps });
    assert.strictEqual(plainTextCalled, true);
  });

  it('with textType srt, uses toSRT instead of toPlainText', async () => {
    let toSRTCalled = false;
    const deps = {
      ...fakeDepsBase,
      fetchTranscript: async () => ({ videoDetails: fakeVideoDetails, segments: fakeSegments }),
      toPlainText: () => {
        throw new Error('toPlainText should not be called');
      },
      toSRT: () => {
        toSRTCalled = true;
        return fakeTranscriptSRT;
      },
      toVTT: () => {
        throw new Error('toVTT should not be called');
      },
    };
    const result = await extractFromVideo({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      options: { textType: 'srt' },
      _deps: deps,
    });
    assert.strictEqual(toSRTCalled, true);
    assert.strictEqual(result.text, fakeTranscriptSRT);
  });

  it('with textType vtt, uses toVTT instead of toPlainText', async () => {
    let toVTTCalled = false;
    const deps = {
      ...fakeDepsBase,
      fetchTranscript: async () => ({ videoDetails: fakeVideoDetails, segments: fakeSegments }),
      toPlainText: () => {
        throw new Error('toPlainText should not be called');
      },
      toSRT: () => {
        throw new Error('toSRT should not be called');
      },
      toVTT: () => {
        toVTTCalled = true;
        return fakeTranscriptVTT;
      },
    };
    const result = await extractFromVideo({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      options: { textType: 'vtt' },
      _deps: deps,
    });
    assert.strictEqual(toVTTCalled, true);
    assert.strictEqual(result.text, fakeTranscriptVTT);
  });

  it('with cache: false, skips FsCache construction and passes cache: undefined', async () => {
    let fsCacheConstructed = false;
    let capturedFetchOpts;
    const deps = {
      FsCache: class {
        constructor() {
          fsCacheConstructed = true;
        }
      },
      fetchTranscript: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      options: { cache: false },
      _deps: deps,
    });
    assert.strictEqual(fsCacheConstructed, false);
    assert.strictEqual(capturedFetchOpts.cache, undefined);
  });

  it('without cache option, creates an FsCache and passes it to fetchTranscript', async () => {
    let fsCacheConstructed = false;
    let capturedFetchOpts;
    const deps = {
      FsCache: class {
        constructor() {
          fsCacheConstructed = true;
        }
      },
      fetchTranscript: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      _deps: deps,
    });
    assert.strictEqual(fsCacheConstructed, true);
    assert.ok(capturedFetchOpts.cache !== undefined);
  });

  it('with retry: false, passes retries 0 and retryDelay 0 to fetchTranscript', async () => {
    let capturedFetchOpts;
    const deps = {
      ...fakeDepsBase,
      fetchTranscript: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      options: { retry: false },
      _deps: deps,
    });
    assert.strictEqual(capturedFetchOpts.retries, 0);
    assert.strictEqual(capturedFetchOpts.retryDelay, 0);
  });

  it('without retry option, passes retries 3 and retryDelay 15000 to fetchTranscript', async () => {
    let capturedFetchOpts;
    const deps = {
      ...fakeDepsBase,
      fetchTranscript: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      _deps: deps,
    });
    assert.strictEqual(capturedFetchOpts.retries, 3);
    assert.strictEqual(capturedFetchOpts.retryDelay, 15e3);
  });

  it('with language option, passes the correct lang to fetchTranscript', async () => {
    let capturedFetchOpts;
    const deps = {
      ...fakeDepsBase,
      fetchTranscript: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      options: { language: 'fr' },
      _deps: deps,
    });
    assert.strictEqual(capturedFetchOpts.lang, 'fr');
  });

  it('defaults to lang "en" when no language option is given', async () => {
    let capturedFetchOpts;
    const deps = {
      ...fakeDepsBase,
      fetchTranscript: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      _deps: deps,
    });
    assert.strictEqual(capturedFetchOpts.lang, 'en');
  });

  it('with timeout option, returns { err } when fetchTranscript never resolves', async () => {
    const deps = {
      ...fakeDepsBase,
      fetchTranscript: () => new Promise(() => {}),
      toPlainText: () => fakeTranscriptText,
    };
    const result = await extractFromVideo({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      options: { timeout: 100 },
      _deps: deps,
    });
    assert.match(result.err, /Timed out after 100ms/);
  });

  describe('error cases', () => {
    const errorDepsBase = {
      FsCache: class {},
      toPlainText: () => '',
    };

    it('returns { err } for YoutubeTranscriptVideoUnavailableError', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscript: async () => {
          throw new YoutubeTranscriptVideoUnavailableError('dQw4w9WgXcQ');
        },
      };
      const result = await extractFromVideo({
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        _deps: deps,
      });
      assert.strictEqual(result.err, 'Video is unavailable: dQw4w9WgXcQ');
    });

    it('returns { err } for YoutubeTranscriptDisabledError', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscript: async () => {
          throw new YoutubeTranscriptDisabledError('dQw4w9WgXcQ');
        },
      };
      const result = await extractFromVideo({
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        _deps: deps,
      });
      assert.strictEqual(result.err, 'Transcripts are disabled: dQw4w9WgXcQ');
    });

    it('returns { err } for YoutubeTranscriptNotAvailableError', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscript: async () => {
          throw new YoutubeTranscriptNotAvailableError('dQw4w9WgXcQ');
        },
      };
      const result = await extractFromVideo({
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        _deps: deps,
      });
      assert.strictEqual(result.err, 'No transcript available: dQw4w9WgXcQ');
    });

    it('returns { err } for YoutubeTranscriptNotAvailableLanguageError', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscript: async () => {
          throw new YoutubeTranscriptNotAvailableLanguageError('fr', ['en', 'es'], 'dQw4w9WgXcQ');
        },
      };
      const result = await extractFromVideo({
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        _deps: deps,
      });
      assert.strictEqual(result.err, 'Language not available: fr, available: en,es');
    });

    it('returns { err } for YoutubeTranscriptInvalidLangError', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscript: async () => {
          throw new YoutubeTranscriptInvalidLangError('zz');
        },
      };
      const result = await extractFromVideo({
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        _deps: deps,
      });
      assert.strictEqual(result.err, 'Invalid language code: zz');
    });

    it('returns { err } for unexpected errors', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscript: async () => {
          throw new Error('network timeout');
        },
      };
      const result = await extractFromVideo({
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        _deps: deps,
      });
      assert.strictEqual(result.err, 'An unexpected error occurred: network timeout');
    });

    it('returns { err } for an invalid video URL instead of throwing', async () => {
      const result = await extractFromVideo({
        videoUrl: 'https://vimeo.com/12345',
        _deps: errorDepsBase,
      });
      assert.match(result.err, /video URL is invalid/);
    });
  });
});
