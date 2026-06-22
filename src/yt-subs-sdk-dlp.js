import { spawn as childSpawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir as osTmpDir } from 'node:os';
import { resolve as pathResolve, join as pathJoin } from 'node:path';

const YT_DLP_BIN = process.env.YTSUBS_YT_DLP_BIN || 'yt-dlp';

class YtDlpError extends Error {
  /**
   * @param {string} message Human-readable error message.
   * @param {string} code Stable code used by `extractFromVideo_dlp` to map errors to user-facing strings.
   * @param {object} [extra] Additional fields copied onto the error (e.g. `videoId`, `lang`, `availableLangs`).
   */
  constructor(message, code, extra = {}) {
    super(message);
    this.name = 'YtDlpError';
    this.code = code;
    Object.assign(this, extra);
  }
}

class FsCacheDlp {
  /**
   * @param {string} dir Absolute path of the cache directory.
   * @param {number} ttlMs Cache entry lifetime in milliseconds.
   */
  constructor(dir, ttlMs) {
    this.dir = dir;
    this.ttlMs = ttlMs;
  }

  /**
   * @param {string} key Cache key.
   * @returns {Promise<object|null>} Cached value, or null on miss/expiry/read error.
   */
  async get(key) {
    try {
      const file = pathResolve(this.dir, `${key}.json`);
      const stat = await fs.stat(file);
      if (Date.now() - stat.mtimeMs > this.ttlMs) return null;
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * @param {string} key Cache key.
   * @param {object} value JSON-serialisable value to persist.
   * @returns {Promise<void>}
   */
  async set(key, value) {
    await fs.mkdir(this.dir, { recursive: true });
    const file = pathResolve(this.dir, `${key}.json`);
    await fs.writeFile(file, JSON.stringify(value), 'utf8');
  }
}

/**
 * Parses YouTube's `json3` caption format into transcript segments matching
 * the `{ text, offset, duration }` shape expected by youtube-transcript-plus formatters.
 *
 * `json3` is YouTube's native caption format (consumed by their player).
 * Each phrase is represented by a single event with word-level `segs`.
 * The rolling-window duplication seen in auto-caption VTT does not exist here.
 * Visual newline markers (events with `aAppend: 1` and `segs: [{utf8: "\n"}]`)
 * collapse to empty text and are skipped.
 * @param {string} jsonContent Raw `.json3` file contents.
 * @returns {Array<{text: string, offset: number, duration: number}>} Parsed segments in document order.
 */
function parseJson3(jsonContent) {
  let data;
  try {
    data = JSON.parse(jsonContent);
  } catch {
    return [];
  }
  const events = Array.isArray(data?.events) ? data.events : [];
  const segments = [];

  for (const event of events) {
    if (!Array.isArray(event.segs)) continue;
    const rawText = event.segs.map((s) => (typeof s?.utf8 === 'string' ? s.utf8 : '')).join('');
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    segments.push({
      text,
      offset: typeof event.tStartMs === 'number' ? event.tStartMs : 0,
      duration: typeof event.dDurationMs === 'number' ? event.dDurationMs : 0,
    });
  }

  return segments;
}

/**
 * Heuristically classifies a non-zero `yt-dlp` stderr into a `YtDlpError` with a known `code`.
 * Unknown errors are returned with code `UNKNOWN`, which the caller treats as transient.
 * @param {string} stderr Captured stderr text from the yt-dlp process.
 * @param {string} videoId 11-character YouTube video ID, attached to the error for downstream messages.
 * @returns {YtDlpError} The classified error.
 */
function parseYtDlpError(stderr, videoId) {
  if (
    /Private video/i.test(stderr) ||
    /This video has been removed/i.test(stderr) ||
    /Video unavailable/i.test(stderr)
  ) {
    return new YtDlpError('Video unavailable', 'VIDEO_UNAVAILABLE', { videoId });
  }
  if (/Subtitles are disabled/i.test(stderr)) {
    return new YtDlpError('Transcripts disabled', 'TRANSCRIPTS_DISABLED', { videoId });
  }
  const lastLine = stderr.split('\n').filter(Boolean).pop() || 'yt-dlp failed';
  return new YtDlpError(lastLine, 'UNKNOWN');
}

/**
 * Spawns yt-dlp once and resolves with captured streams + exit code.
 * Rejects with an AbortError when the abort signal fires.
 * @param {string} bin yt-dlp binary path or name on PATH.
 * @param {string[]} args yt-dlp CLI arguments.
 * @param {object} opts Execution options.
 * @param {object} [opts.signal] Optional AbortSignal forwarded to the child process.
 * @param {(bin: string, args: string[], opts: object) => object} [opts.spawn] Injectable spawn fn; defaults to `child_process.spawn`. For testing.
 * @returns {Promise<{stdout: string, stderr: string, code: number|null}>} Captured streams and exit code from the yt-dlp run.
 */
async function spawnYtDlp(bin, args, { signal, spawn = childSpawn }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { signal });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (err.code === 'ABORT_ERR' || err.name === 'AbortError') {
        const e = new Error(err.message || 'aborted');
        e.name = 'AbortError';
        reject(e);
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

/**
 * Runs yt-dlp once for `videoId` and returns the parsed transcript + metadata.
 * Writes outputs to a temp dir which is removed before returning.
 * @param {string} videoId 11-character YouTube video ID.
 * @param {object} opts Per-attempt options (`lang`, `signal`, `spawn`).
 * @returns {Promise<{videoDetails: object, segments: Array<{text:string,offset:number,duration:number}>}>}
 *   Resolves to the same shape as `youtube-transcript-plus`'s `fetchTranscript` result.
 * @throws {YtDlpError} For known failure modes (e.g. VIDEO_UNAVAILABLE, NO_TRANSCRIPT, LANG_NOT_AVAILABLE).
 */
async function runYtDlpOnce(videoId, opts) {
  const { lang = 'en', signal, spawn = childSpawn } = opts;
  const tmpDir = await fs.mkdtemp(pathJoin(osTmpDir(), 'ytsubs-dlp-'));

  try {
    const args = [
      '--skip-download',
      '--write-info-json',
      '--write-auto-subs',
      '--write-subs',
      '--sub-langs',
      lang,
      '--sub-format',
      'json3',
      '-o',
      pathJoin(tmpDir, '%(id)s.%(ext)s'),
      '--no-progress',
      '--quiet',
      '--no-warnings',
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    const { stderr, code } = await spawnYtDlp(YT_DLP_BIN, args, { signal, spawn });

    if (code !== 0) {
      throw parseYtDlpError(stderr, videoId);
    }

    const infoPath = pathJoin(tmpDir, `${videoId}.info.json`);
    let info;
    try {
      info = JSON.parse(await fs.readFile(infoPath, 'utf8'));
    } catch {
      throw new YtDlpError(`Failed to read info for ${videoId}`, 'VIDEO_UNAVAILABLE', { videoId });
    }

    const videoDetails = {
      title: info.title ?? '',
      description: info.description ?? '',
      videoId: info.id ?? videoId,
      author: info.uploader ?? info.channel ?? '',
      thumbnails: (info.thumbnails ?? []).map((t) => ({ url: t.url, width: t.width, height: t.height })),
    };

    // yt-dlp may write the file under a slightly different lang code (e.g. en-US).
    const dirEntries = await fs.readdir(tmpDir);
    const subFile = dirEntries.find((f) => f.startsWith(`${videoId}.`) && f.endsWith('.json3'));

    if (!subFile) {
      const subLangs = Object.keys(info.subtitles ?? {});
      const autoLangs = Object.keys(info.automatic_captions ?? {});
      const availableLangs = [...new Set([...subLangs, ...autoLangs])];

      if (availableLangs.length === 0) {
        throw new YtDlpError('No transcript', 'NO_TRANSCRIPT', { videoId });
      }

      throw new YtDlpError('Language not available', 'LANG_NOT_AVAILABLE', {
        videoId,
        lang,
        availableLangs,
      });
    }

    const jsonContent = await fs.readFile(pathJoin(tmpDir, subFile), 'utf8');
    const segments = parseJson3(jsonContent);

    return { videoDetails, segments };
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

const PERMANENT_ERROR_CODES = new Set([
  'VIDEO_UNAVAILABLE',
  'TRANSCRIPTS_DISABLED',
  'NO_TRANSCRIPT',
  'LANG_NOT_AVAILABLE',
  'INVALID_LANG',
]);

/**
 * yt-dlp counterpart to youtube-transcript-plus's `fetchTranscript`.
 * Caches per (videoId, lang) and retries transient failures.
 * @param {string} videoId 11-character YouTube video ID.
 * @param {object} [opts] Options (`lang`, `cache`, `retries`, `retryDelay`, `signal`, `spawn`).
 * @returns {Promise<{videoDetails: object, segments: Array<{text:string,offset:number,duration:number}>}>}
 *   Transcript and metadata for the requested (videoId, lang).
 * @throws {YtDlpError|Error} Throws on permanent failures or after exhausting retries.
 */
async function fetchTranscriptDlp(videoId, opts = {}) {
  const { lang = 'en', cache, retries = 0, retryDelay = 0, signal, spawn } = opts;
  const cacheKey = `dlp-${videoId}-${lang}`;

  if (cache) {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, retryDelay));
    }
    try {
      const result = await runYtDlpOnce(videoId, { lang, signal, spawn });
      if (cache) {
        try {
          await cache.set(cacheKey, result);
        } catch {
          // best-effort cache write
        }
      }
      return result;
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError' || (err.code && PERMANENT_ERROR_CODES.has(err.code))) {
        throw err;
      }
    }
  }
  throw lastErr;
}

export { fetchTranscriptDlp, FsCacheDlp, parseJson3, YtDlpError, parseYtDlpError, spawnYtDlp, runYtDlpOnce };
