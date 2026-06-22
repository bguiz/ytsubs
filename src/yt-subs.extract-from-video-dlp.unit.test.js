import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractFromVideo } from './yt-subs-sdk.js';
import { YtDlpError } from './yt-subs-sdk-dlp.js';

describe('extractFromVideo_dlp', () => {
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

  /**
   * Builds an extract call with `method: 'dlp'` plus any caller-supplied option overrides.
   * @param {object} [overrides] Extra `extractFromVideo` arguments to merge.
   * @returns {object} The composed argument object.
   */
  function dlpCall(overrides = {}) {
    return {
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      ...overrides,
      options: { method: 'dlp', ...(overrides.options || {}) },
    };
  }

  it('happy case: returns structured result for a valid video URL', async () => {
    const deps = {
      ...fakeDepsBase,
      fetchTranscriptDlp: async () => ({
        videoDetails: fakeVideoDetails,
        segments: fakeSegments,
      }),
      toPlainText: () => fakeTranscriptText,
    };

    const result = await extractFromVideo(dlpCall({ _deps: deps }));

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
      fetchTranscriptDlp: async () => ({ videoDetails: fakeVideoDetails, segments: fakeSegments }),
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
    await extractFromVideo(dlpCall({ _deps: deps }));
    assert.strictEqual(plainTextCalled, true);
  });

  it('with textType srt, uses toSRT instead of toPlainText', async () => {
    let toSRTCalled = false;
    const deps = {
      ...fakeDepsBase,
      fetchTranscriptDlp: async () => ({ videoDetails: fakeVideoDetails, segments: fakeSegments }),
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
    const result = await extractFromVideo(dlpCall({ options: { textType: 'srt' }, _deps: deps }));
    assert.strictEqual(toSRTCalled, true);
    assert.strictEqual(result.text, fakeTranscriptSRT);
  });

  it('with textType vtt, uses toVTT instead of toPlainText', async () => {
    let toVTTCalled = false;
    const deps = {
      ...fakeDepsBase,
      fetchTranscriptDlp: async () => ({ videoDetails: fakeVideoDetails, segments: fakeSegments }),
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
    const result = await extractFromVideo(dlpCall({ options: { textType: 'vtt' }, _deps: deps }));
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
      fetchTranscriptDlp: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo(dlpCall({ options: { cache: false }, _deps: deps }));
    assert.strictEqual(fsCacheConstructed, false);
    assert.strictEqual(capturedFetchOpts.cache, undefined);
  });

  it('without cache option, creates an FsCache and passes it to fetchTranscriptDlp', async () => {
    let fsCacheConstructed = false;
    let capturedFetchOpts;
    const deps = {
      FsCache: class {
        constructor() {
          fsCacheConstructed = true;
        }
      },
      fetchTranscriptDlp: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo(dlpCall({ _deps: deps }));
    assert.strictEqual(fsCacheConstructed, true);
    assert.ok(capturedFetchOpts.cache !== undefined);
  });

  it('with retry: false, passes retries 0 and retryDelay 0 to fetchTranscriptDlp', async () => {
    let capturedFetchOpts;
    const deps = {
      ...fakeDepsBase,
      fetchTranscriptDlp: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo(dlpCall({ options: { retry: false }, _deps: deps }));
    assert.strictEqual(capturedFetchOpts.retries, 0);
    assert.strictEqual(capturedFetchOpts.retryDelay, 0);
  });

  it('without retry option, passes retries 3 and retryDelay 15000 to fetchTranscriptDlp', async () => {
    let capturedFetchOpts;
    const deps = {
      ...fakeDepsBase,
      fetchTranscriptDlp: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo(dlpCall({ _deps: deps }));
    assert.strictEqual(capturedFetchOpts.retries, 3);
    assert.strictEqual(capturedFetchOpts.retryDelay, 15e3);
  });

  it('with language option, passes the correct lang to fetchTranscriptDlp', async () => {
    let capturedFetchOpts;
    const deps = {
      ...fakeDepsBase,
      fetchTranscriptDlp: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo(dlpCall({ options: { language: 'fr' }, _deps: deps }));
    assert.strictEqual(capturedFetchOpts.lang, 'fr');
  });

  it('defaults to lang "en" when no language option is given', async () => {
    let capturedFetchOpts;
    const deps = {
      ...fakeDepsBase,
      fetchTranscriptDlp: async (_, opts) => {
        capturedFetchOpts = opts;
        return { videoDetails: fakeVideoDetails, segments: fakeSegments };
      },
      toPlainText: () => fakeTranscriptText,
    };
    await extractFromVideo(dlpCall({ _deps: deps }));
    assert.strictEqual(capturedFetchOpts.lang, 'en');
  });

  it('with timeout option, returns { err } when fetchTranscriptDlp never resolves', async () => {
    const deps = {
      ...fakeDepsBase,
      fetchTranscriptDlp: () => new Promise(() => {}),
      toPlainText: () => fakeTranscriptText,
    };
    const result = await extractFromVideo(dlpCall({ options: { timeout: 100 }, _deps: deps }));
    assert.match(result.err, /Timed out after 100ms/);
  });

  describe('dispatcher selection', () => {
    it('routes to dlp impl when options.method is "dlp"', async () => {
      let dlpCalled = false;
      const deps = {
        ...fakeDepsBase,
        fetchTranscriptDlp: async () => {
          dlpCalled = true;
          return { videoDetails: fakeVideoDetails, segments: fakeSegments };
        },
        fetchTranscript: async () => {
          throw new Error('fetchTranscript (plus) should not be called');
        },
        toPlainText: () => fakeTranscriptText,
      };
      await extractFromVideo(dlpCall({ _deps: deps }));
      assert.strictEqual(dlpCalled, true);
    });

    it('routes to plus impl when options.method is "plus"', async () => {
      let plusCalled = false;
      const deps = {
        ...fakeDepsBase,
        fetchTranscript: async () => {
          plusCalled = true;
          return { videoDetails: fakeVideoDetails, segments: fakeSegments };
        },
        fetchTranscriptDlp: async () => {
          throw new Error('fetchTranscriptDlp should not be called');
        },
        toPlainText: () => fakeTranscriptText,
      };
      await extractFromVideo({
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        options: { method: 'plus' },
        _deps: deps,
      });
      assert.strictEqual(plusCalled, true);
    });

    it('routes via YTSUBS_METHOD env var when options.method is unset', async () => {
      let dlpCalled = false;
      const deps = {
        ...fakeDepsBase,
        fetchTranscriptDlp: async () => {
          dlpCalled = true;
          return { videoDetails: fakeVideoDetails, segments: fakeSegments };
        },
        toPlainText: () => fakeTranscriptText,
      };
      const originalEnv = process.env.YTSUBS_METHOD;
      process.env.YTSUBS_METHOD = 'dlp';
      try {
        await extractFromVideo({
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          _deps: deps,
        });
      } finally {
        if (originalEnv === undefined) {
          delete process.env.YTSUBS_METHOD;
        } else {
          process.env.YTSUBS_METHOD = originalEnv;
        }
      }
      assert.strictEqual(dlpCalled, true);
    });
  });

  describe('error cases', () => {
    const errorDepsBase = {
      FsCache: class {},
      toPlainText: () => '',
    };

    it('returns { err } for VIDEO_UNAVAILABLE code', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscriptDlp: async () => {
          throw new YtDlpError('Video unavailable', 'VIDEO_UNAVAILABLE', { videoId: 'dQw4w9WgXcQ' });
        },
      };
      const result = await extractFromVideo(dlpCall({ _deps: deps }));
      assert.strictEqual(result.err, 'Video is unavailable: dQw4w9WgXcQ');
    });

    it('returns { err } for TRANSCRIPTS_DISABLED code', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscriptDlp: async () => {
          throw new YtDlpError('disabled', 'TRANSCRIPTS_DISABLED', { videoId: 'dQw4w9WgXcQ' });
        },
      };
      const result = await extractFromVideo(dlpCall({ _deps: deps }));
      assert.strictEqual(result.err, 'Transcripts are disabled: dQw4w9WgXcQ');
    });

    it('returns { err } for NO_TRANSCRIPT code', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscriptDlp: async () => {
          throw new YtDlpError('No transcript', 'NO_TRANSCRIPT', { videoId: 'dQw4w9WgXcQ' });
        },
      };
      const result = await extractFromVideo(dlpCall({ _deps: deps }));
      assert.strictEqual(result.err, 'No transcript available: dQw4w9WgXcQ');
    });

    it('returns { err } for LANG_NOT_AVAILABLE code', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscriptDlp: async () => {
          throw new YtDlpError('Language not available', 'LANG_NOT_AVAILABLE', {
            lang: 'fr',
            availableLangs: ['en', 'es'],
          });
        },
      };
      const result = await extractFromVideo(dlpCall({ _deps: deps }));
      assert.strictEqual(result.err, 'Language not available: fr, available: en,es');
    });

    it('returns { err } for INVALID_LANG code', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscriptDlp: async () => {
          throw new YtDlpError('Invalid language', 'INVALID_LANG', { lang: 'zz' });
        },
      };
      const result = await extractFromVideo(dlpCall({ _deps: deps }));
      assert.strictEqual(result.err, 'Invalid language code: zz');
    });

    it('returns { err } for unexpected errors', async () => {
      const deps = {
        ...errorDepsBase,
        fetchTranscriptDlp: async () => {
          throw new Error('network timeout');
        },
      };
      const result = await extractFromVideo(dlpCall({ _deps: deps }));
      assert.strictEqual(result.err, 'An unexpected error occurred: network timeout');
    });

    it('returns { err } for an invalid video URL instead of throwing', async () => {
      const result = await extractFromVideo({
        videoUrl: 'https://vimeo.com/12345',
        options: { method: 'dlp' },
        _deps: errorDepsBase,
      });
      assert.match(result.err, /video URL is invalid/);
    });
  });
});
