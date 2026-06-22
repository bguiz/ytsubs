import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { tmpdir as osTmpDir } from 'node:os';
import { dirname as pathDirname, join as pathJoin } from 'node:path';
import { describe, it } from 'node:test';

import {
  fetchTranscriptDlp,
  FsCacheDlp,
  parseJson3,
  parseYtDlpError,
  runYtDlpOnce,
  spawnYtDlp,
  YtDlpError,
} from './yt-subs-sdk-dlp.js';

/**
 * Builds the JSON string of a YouTube `json3` caption file with the given events.
 * @param {object[]} events Array of `json3` event objects.
 * @returns {string} JSON-stringified `json3` document.
 */
function makeJson3(events) {
  return JSON.stringify({ wireMagic: 'pb3', events });
}

/**
 * Builds a content event (single phrase) compatible with YouTube's `json3` format.
 * @param {string} text Phrase text; encoded as a single seg.
 * @param {number} [tStartMs] Event start in milliseconds.
 * @param {number} [dDurationMs] Event duration in milliseconds.
 * @returns {object} A `json3` event with `segs`.
 */
function json3Event(text, tStartMs = 0, dDurationMs = 1000) {
  return { tStartMs, dDurationMs, wWinId: 1, segs: [{ utf8: text }] };
}

/**
 * Builds the `aAppend: 1` visual newline separator event YouTube emits between phrases.
 * @returns {object} A `json3` separator event.
 */
function json3Separator() {
  return { tStartMs: 0, dDurationMs: 10, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] };
}

/**
 * Builds a fake child-process replacement compatible with `spawnYtDlp`.
 * `script` runs in a microtask after the parent has registered its listeners,
 * so the test can drive stdout/stderr/error/close events deterministically.
 * @param {(child: EventEmitter) => unknown} script Callback invoked with the
 *   child instance; may emit events and/or await async work before emitting `close`.
 * @returns {EventEmitter} The fake child instance.
 */
function makeFakeChild(script) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    Promise.resolve(script(child)).catch((err) => {
      child.emit('error', err);
    });
  });
  return child;
}

/**
 * Extracts the temp output dir and the requested videoId from the args that
 * `runYtDlpOnce` passes to yt-dlp. Lets fake spawns write into the same dir
 * the real implementation will later read from.
 * @param {string[]} args yt-dlp CLI arguments.
 * @returns {{tmpDir: string, videoId: string}} The temp dir and videoId extracted from the args.
 */
function parseDlpArgs(args) {
  const outputTemplate = args[args.indexOf('-o') + 1];
  const tmpDir = pathDirname(outputTemplate);
  const url = args[args.length - 1];
  const videoId = new URL(url).searchParams.get('v');
  return { tmpDir, videoId };
}

describe('parseJson3', () => {
  it('parses a simple json3 document with multiple content events', () => {
    const json3 = makeJson3([json3Event('hello world', 0, 2000), json3Event('second phrase', 2500, 2500)]);
    const segments = parseJson3(json3);
    assert.deepStrictEqual(segments, [
      { text: 'hello world', offset: 0, duration: 2000 },
      { text: 'second phrase', offset: 2500, duration: 2500 },
    ]);
  });

  it('joins word-level segs within an event into a single phrase', () => {
    const json3 = makeJson3([
      {
        tStartMs: 160,
        dDurationMs: 4480,
        segs: [
          { utf8: 'This' },
          { utf8: ' is', tOffsetMs: 240 },
          { utf8: ' a', tOffsetMs: 400 },
          { utf8: ' very', tOffsetMs: 1200 },
          { utf8: ' long', tOffsetMs: 1520 },
          { utf8: ' talk', tOffsetMs: 1679 },
        ],
      },
    ]);
    const segments = parseJson3(json3);
    assert.strictEqual(segments.length, 1);
    assert.strictEqual(segments[0].text, 'This is a very long talk');
    assert.strictEqual(segments[0].offset, 160);
    assert.strictEqual(segments[0].duration, 4480);
  });

  it('skips visual newline separator events (aAppend: 1 with utf8: "\\n")', () => {
    const json3 = makeJson3([
      json3Event('phrase one', 0, 1000),
      json3Separator(),
      json3Event('phrase two', 2000, 1000),
      json3Separator(),
      json3Event('phrase three', 4000, 1000),
    ]);
    const segments = parseJson3(json3);
    assert.deepStrictEqual(
      segments.map((s) => s.text),
      ['phrase one', 'phrase two', 'phrase three'],
    );
  });

  it('skips events without segs (window/style declarations)', () => {
    const json3 = makeJson3([{ tStartMs: 0, dDurationMs: 999999, id: 1 }, json3Event('real phrase', 0, 1000)]);
    const segments = parseJson3(json3);
    assert.strictEqual(segments.length, 1);
    assert.strictEqual(segments[0].text, 'real phrase');
  });

  it('returns an empty array for invalid JSON', () => {
    assert.deepStrictEqual(parseJson3('not valid json'), []);
  });

  it('returns an empty array for JSON without an events array', () => {
    assert.deepStrictEqual(parseJson3('{}'), []);
    assert.deepStrictEqual(parseJson3('{"events": "not an array"}'), []);
  });

  it('correctly handles the YouTube rolling-window auto-caption case', () => {
    // This is the exact input shape that produced the duplicated VTT output;
    // json3 sidesteps it entirely because each phrase is a single event.
    const json3 = makeJson3([
      { tStartMs: 0, dDurationMs: 422039, id: 1 }, // window declaration
      json3Event("This is a very long talk, but I'm going", 160, 4480),
      json3Separator(),
      json3Event("to do a very short version of it. We'll", 2639, 4481),
      json3Separator(),
      json3Event('talk about not all of these things. The', 4640, 4480),
      json3Separator(),
      json3Event('full version I will eventually record', 7120, 5120),
    ]);
    const segments = parseJson3(json3);
    assert.deepStrictEqual(
      segments.map((s) => s.text),
      [
        "This is a very long talk, but I'm going",
        "to do a very short version of it. We'll",
        'talk about not all of these things. The',
        'full version I will eventually record',
      ],
    );
  });
});

describe('FsCacheDlp', () => {
  /**
   * Creates a fresh temp directory under the OS tmp dir; caller is responsible for cleanup.
   * @returns {Promise<string>} The absolute path of the freshly created directory.
   */
  async function makeTmpDir() {
    return fs.mkdtemp(pathJoin(osTmpDir(), 'ytsubs-cache-test-'));
  }

  it('returns null on miss', async () => {
    const dir = await makeTmpDir();
    try {
      const cache = new FsCacheDlp(dir, 60_000);
      assert.strictEqual(await cache.get('absent'), null);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('round-trips an object through set/get', async () => {
    const dir = await makeTmpDir();
    try {
      const cache = new FsCacheDlp(dir, 60_000);
      await cache.set('mykey', { hello: 'world', n: 42 });
      assert.deepStrictEqual(await cache.get('mykey'), { hello: 'world', n: 42 });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null when entry is older than ttlMs', async () => {
    const dir = await makeTmpDir();
    try {
      const cache = new FsCacheDlp(dir, 1); // 1ms TTL
      await cache.set('expiring', { value: 1 });
      await new Promise((r) => setTimeout(r, 25));
      assert.strictEqual(await cache.get('expiring'), null);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('fetchTranscriptDlp', () => {
  const fakeVideoDetails = { title: 't', description: 'd', videoId: 'abc', author: 'a', thumbnails: [] };
  const fakeSegments = [{ text: 's', offset: 0, duration: 1000 }];

  it('returns cached result without spawning yt-dlp on a cache hit', async () => {
    let spawnCalled = false;
    const fakeSpawn = () => {
      spawnCalled = true;
      throw new Error('spawn should not be called on cache hit');
    };
    const cache = {
      get: async () => ({ videoDetails: fakeVideoDetails, segments: fakeSegments }),
      set: async () => {
        throw new Error('set should not be called on cache hit');
      },
    };
    const result = await fetchTranscriptDlp('abcdefghijk', { lang: 'en', cache, spawn: fakeSpawn });
    assert.deepStrictEqual(result, { videoDetails: fakeVideoDetails, segments: fakeSegments });
    assert.strictEqual(spawnCalled, false);
  });

  it('does not retry permanent failures', async () => {
    let attempts = 0;
    const fakeSpawn = () => {
      attempts++;
      const child = {
        stdout: { on: () => {} },
        stderr: {
          on: (event, cb) => {
            if (event === 'data') cb(Buffer.from('ERROR: [youtube] xxx: Video unavailable'));
          },
        },
        on: (event, cb) => {
          if (event === 'close') queueMicrotask(() => cb(1));
        },
      };
      return child;
    };
    await assert.rejects(
      fetchTranscriptDlp('abcdefghijk', { lang: 'en', retries: 5, retryDelay: 0, spawn: fakeSpawn }),
      (err) => err instanceof YtDlpError && err.code === 'VIDEO_UNAVAILABLE',
    );
    assert.strictEqual(attempts, 1, 'should not have retried on a permanent failure');
  });

  it('retries transient failures up to `retries` times', async () => {
    let attempts = 0;
    const fakeSpawn = () => {
      attempts++;
      const child = {
        stdout: { on: () => {} },
        stderr: {
          on: (event, cb) => {
            if (event === 'data') cb(Buffer.from('temporary network error'));
          },
        },
        on: (event, cb) => {
          if (event === 'close') queueMicrotask(() => cb(1));
        },
      };
      return child;
    };
    await assert.rejects(
      fetchTranscriptDlp('abcdefghijk', { lang: 'en', retries: 2, retryDelay: 0, spawn: fakeSpawn }),
      (err) => err instanceof YtDlpError && err.code === 'UNKNOWN',
    );
    assert.strictEqual(attempts, 3, 'should have attempted 1 initial + 2 retries');
  });

  it('writes the result to cache on a successful run', async () => {
    const fakeSpawn = (_bin, args) => {
      const { tmpDir, videoId } = parseDlpArgs(args);
      return makeFakeChild(async (child) => {
        await fs.writeFile(pathJoin(tmpDir, `${videoId}.info.json`), JSON.stringify({ id: videoId, title: 'cached' }));
        await fs.writeFile(pathJoin(tmpDir, `${videoId}.en.json3`), makeJson3([json3Event('hi', 0, 1000)]));
        child.emit('close', 0);
      });
    };
    let setKey;
    let setValue;
    const cache = {
      get: async () => null,
      set: async (k, v) => {
        setKey = k;
        setValue = v;
      },
    };
    const result = await fetchTranscriptDlp('abcdefghijk', { lang: 'en', cache, spawn: fakeSpawn });
    assert.strictEqual(setKey, 'dlp-abcdefghijk-en');
    assert.strictEqual(setValue.videoDetails.title, 'cached');
    assert.strictEqual(result.segments[0].text, 'hi');
  });

  it('swallows cache.set errors and still returns the result', async () => {
    const fakeSpawn = (_bin, args) => {
      const { tmpDir, videoId } = parseDlpArgs(args);
      return makeFakeChild(async (child) => {
        await fs.writeFile(pathJoin(tmpDir, `${videoId}.info.json`), JSON.stringify({ id: videoId, title: 'ok' }));
        await fs.writeFile(pathJoin(tmpDir, `${videoId}.en.json3`), makeJson3([json3Event('yo', 0, 1000)]));
        child.emit('close', 0);
      });
    };
    const cache = {
      get: async () => null,
      set: async () => {
        throw new Error('disk full');
      },
    };
    const result = await fetchTranscriptDlp('abcdefghijk', { lang: 'en', cache, spawn: fakeSpawn });
    assert.strictEqual(result.videoDetails.title, 'ok');
  });
});

describe('parseYtDlpError', () => {
  it('returns TRANSCRIPTS_DISABLED for "Subtitles are disabled" stderr', () => {
    const err = parseYtDlpError('ERROR: Subtitles are disabled for this video', 'abcdefghijk');
    assert.ok(err instanceof YtDlpError);
    assert.strictEqual(err.code, 'TRANSCRIPTS_DISABLED');
    assert.strictEqual(err.videoId, 'abcdefghijk');
  });

  it('returns UNKNOWN with the last non-empty stderr line otherwise', () => {
    const err = parseYtDlpError('first line\nsecond line\n', 'abcdefghijk');
    assert.strictEqual(err.code, 'UNKNOWN');
    assert.strictEqual(err.message, 'second line');
  });

  it('returns UNKNOWN with a default message when stderr is empty', () => {
    const err = parseYtDlpError('', 'abcdefghijk');
    assert.strictEqual(err.code, 'UNKNOWN');
    assert.strictEqual(err.message, 'yt-dlp failed');
  });
});

describe('spawnYtDlp', () => {
  it('rejects when the spawn function itself throws synchronously', async () => {
    const fakeSpawn = () => {
      throw new Error('ENOENT: yt-dlp not found');
    };
    await assert.rejects(spawnYtDlp('yt-dlp', ['--version'], { spawn: fakeSpawn }), /ENOENT: yt-dlp not found/);
  });

  it('captures stdout data chunks', async () => {
    const fakeSpawn = () =>
      makeFakeChild((child) => {
        child.stdout.emit('data', Buffer.from('hello '));
        child.stdout.emit('data', Buffer.from('world'));
        child.emit('close', 0);
      });
    const result = await spawnYtDlp('yt-dlp', [], { spawn: fakeSpawn });
    assert.strictEqual(result.stdout, 'hello world');
    assert.strictEqual(result.code, 0);
  });

  it('rejects with AbortError when child emits error with code ABORT_ERR', async () => {
    const fakeSpawn = () =>
      makeFakeChild((child) => {
        const e = new Error('The operation was aborted');
        e.code = 'ABORT_ERR';
        child.emit('error', e);
      });
    await assert.rejects(spawnYtDlp('yt-dlp', [], { spawn: fakeSpawn }), (err) => err.name === 'AbortError');
  });

  it('rejects with the original error when child emits a non-abort error', async () => {
    const fakeSpawn = () =>
      makeFakeChild((child) => {
        const e = new Error('exec failure');
        e.code = 'EACCES';
        child.emit('error', e);
      });
    await assert.rejects(spawnYtDlp('yt-dlp', [], { spawn: fakeSpawn }), /exec failure/);
  });
});

describe('runYtDlpOnce', () => {
  it('returns videoDetails + segments on a successful yt-dlp run', async () => {
    const fakeSpawn = (_bin, args) => {
      const { tmpDir, videoId } = parseDlpArgs(args);
      return makeFakeChild(async (child) => {
        await fs.writeFile(
          pathJoin(tmpDir, `${videoId}.info.json`),
          JSON.stringify({
            id: videoId,
            title: 'Test title',
            description: 'a description',
            uploader: 'me',
            thumbnails: [{ url: 'http://x/y.jpg', width: 640, height: 480 }],
          }),
        );
        await fs.writeFile(pathJoin(tmpDir, `${videoId}.en.json3`), makeJson3([json3Event('hello', 0, 1000)]));
        child.emit('close', 0);
      });
    };
    const result = await runYtDlpOnce('abcdefghijk', { lang: 'en', spawn: fakeSpawn });
    assert.strictEqual(result.videoDetails.title, 'Test title');
    assert.strictEqual(result.videoDetails.description, 'a description');
    assert.strictEqual(result.videoDetails.videoId, 'abcdefghijk');
    assert.strictEqual(result.videoDetails.author, 'me');
    assert.deepStrictEqual(result.videoDetails.thumbnails, [{ url: 'http://x/y.jpg', width: 640, height: 480 }]);
    assert.strictEqual(result.segments.length, 1);
    assert.strictEqual(result.segments[0].text, 'hello');
  });

  it('falls back to channel when uploader is absent and defaults empty fields', async () => {
    const fakeSpawn = (_bin, args) => {
      const { tmpDir, videoId } = parseDlpArgs(args);
      return makeFakeChild(async (child) => {
        await fs.writeFile(
          pathJoin(tmpDir, `${videoId}.info.json`),
          JSON.stringify({ id: videoId, channel: 'myChannel' }),
        );
        await fs.writeFile(pathJoin(tmpDir, `${videoId}.en.json3`), makeJson3([json3Event('x', 0, 1000)]));
        child.emit('close', 0);
      });
    };
    const result = await runYtDlpOnce('abcdefghijk', { lang: 'en', spawn: fakeSpawn });
    assert.strictEqual(result.videoDetails.author, 'myChannel');
    assert.strictEqual(result.videoDetails.title, '');
    assert.strictEqual(result.videoDetails.description, '');
    assert.deepStrictEqual(result.videoDetails.thumbnails, []);
  });

  it('throws VIDEO_UNAVAILABLE when info.json is missing despite exit code 0', async () => {
    const fakeSpawn = () =>
      makeFakeChild((child) => {
        child.emit('close', 0);
      });
    await assert.rejects(
      runYtDlpOnce('abcdefghijk', { lang: 'en', spawn: fakeSpawn }),
      (err) => err instanceof YtDlpError && err.code === 'VIDEO_UNAVAILABLE',
    );
  });

  it('throws NO_TRANSCRIPT when no .json3 is written and info.json has no captions', async () => {
    const fakeSpawn = (_bin, args) => {
      const { tmpDir, videoId } = parseDlpArgs(args);
      return makeFakeChild(async (child) => {
        await fs.writeFile(
          pathJoin(tmpDir, `${videoId}.info.json`),
          JSON.stringify({ id: videoId, title: 't', subtitles: {}, automatic_captions: {} }),
        );
        child.emit('close', 0);
      });
    };
    await assert.rejects(
      runYtDlpOnce('abcdefghijk', { lang: 'en', spawn: fakeSpawn }),
      (err) => err instanceof YtDlpError && err.code === 'NO_TRANSCRIPT',
    );
  });

  it('throws LANG_NOT_AVAILABLE when no .json3 is written but other langs exist', async () => {
    const fakeSpawn = (_bin, args) => {
      const { tmpDir, videoId } = parseDlpArgs(args);
      return makeFakeChild(async (child) => {
        await fs.writeFile(
          pathJoin(tmpDir, `${videoId}.info.json`),
          JSON.stringify({
            id: videoId,
            title: 't',
            subtitles: { es: [] },
            automatic_captions: { de: [], es: [] },
          }),
        );
        child.emit('close', 0);
      });
    };
    await assert.rejects(runYtDlpOnce('abcdefghijk', { lang: 'fr', spawn: fakeSpawn }), (err) => {
      if (!(err instanceof YtDlpError) || err.code !== 'LANG_NOT_AVAILABLE') return false;
      assert.strictEqual(err.lang, 'fr');
      assert.deepStrictEqual(err.availableLangs.sort(), ['de', 'es']);
      return true;
    });
  });

  it('classifies stderr via parseYtDlpError on non-zero exit', async () => {
    const fakeSpawn = () =>
      makeFakeChild((child) => {
        child.stderr.emit('data', Buffer.from('ERROR: Private video'));
        child.emit('close', 1);
      });
    await assert.rejects(
      runYtDlpOnce('abcdefghijk', { lang: 'en', spawn: fakeSpawn }),
      (err) => err instanceof YtDlpError && err.code === 'VIDEO_UNAVAILABLE',
    );
  });
});
