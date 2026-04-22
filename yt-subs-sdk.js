import { homedir as osHomeDir } from 'node:os';
import { resolve as pathResolve } from 'node:path';

import {
  fetchTranscript,
  toPlainText,
  toSRT,
  toVTT,
  FsCache,
  YoutubeTranscriptVideoUnavailableError,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptInvalidLangError,
} from 'youtube-transcript-plus';

/**
 * @typedef {object} ExtractOptions
 * @property {boolean} [cache] - Enable filesystem cache for transcripts; default true.
 * @property {boolean} [retry] - Enable automatic retries on transient failure; default true.
 * @property {string} [language] - Two-letter BCP-47 language code; default 'en'.
 * @property {'text'|'srt'|'vtt'} [textType] - Transcript output format; default 'text'.
 * @property {number} [timeout] - Abort after this many milliseconds; no timeout by default.
 */

/**
 * @typedef {object} ExtractResult
 * @property {string} videoUrl - The YouTube URL or video ID that was passed in.
 * @property {string} title - Video title.
 * @property {object} metadata - Miscellaneous video metadata (thumbnails, author, etc.).
 * @property {string} description - Video description.
 * @property {string} text - Transcript content.
 */

/**
 * @typedef {object} ExtractError
 * @property {string} err - Error message describing what went wrong.
 */

/**
 * Extracts the transcript and metadata from a Youtube video.
 * Returns `{ err }` on failure rather than throwing, so callers must check
 * `result.err` *before* accessing other fields.
 * @param {object} params - Input parameters.
 * @param {string} params.videoUrl - Youtube URL, schemeless URL, or bare 11-character video ID.
 * @param {ExtractOptions} [params.options] - Extraction options.
 * @param {object} [params._deps] - For unit testing only — do not pass in production code. Internal.
 * @returns {Promise<ExtractResult|ExtractError>} Resolves to either a result object or error object.
 */
async function extractFromVideo({ videoUrl, options = {}, _deps = {} }) {
  const {
    fetchTranscript: _fetchTranscript = fetchTranscript,
    toPlainText: _toPlainText = toPlainText,
    toSRT: _toSRT = toSRT,
    toVTT: _toVTT = toVTT,
    FsCache: _FsCache = FsCache,
  } = _deps;

  let videoId;
  try {
    videoId = extractVideoId(videoUrl);
  } catch (error) {
    return { err: error.message };
  }

  let ytScriptFsCache;
  if (options.cache !== false) {
    ytScriptFsCache = new _FsCache(
      pathResolve(osHomeDir(), '.yt-subs-cache'),
      86400e3, // 1 day
    );
  }
  let retries = 0;
  let retryDelay = 0;
  if (options.retry !== false) {
    // retry up to 3 times, at 15s, 30s, 60s
    retries = 3;
    retryDelay = 15e3;
  }

  const controller = options.timeout != null ? new AbortController() : null;
  let timeoutId;
  let rawResult;
  let err;

  try {
    const fetchPromise = _fetchTranscript(videoId, {
      lang: options.language || 'en',
      cache: ytScriptFsCache,
      videoDetails: true,
      retries,
      retryDelay,
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (controller) {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          const e = new Error(`Timed out after ${options.timeout}ms`);
          e.name = 'AbortError';
          reject(e);
        }, options.timeout);
      });
      rawResult = await Promise.race([fetchPromise, timeoutPromise]);
    } else {
      rawResult = await fetchPromise;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      err = error.message;
    } else if (error instanceof YoutubeTranscriptVideoUnavailableError) {
      err = `Video is unavailable: ${error.videoId}`;
    } else if (error instanceof YoutubeTranscriptDisabledError) {
      err = `Transcripts are disabled: ${error.videoId}`;
    } else if (error instanceof YoutubeTranscriptNotAvailableError) {
      err = `No transcript available: ${error.videoId}`;
    } else if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
      err = `Language not available: ${error.lang}, available: ${error.availableLangs}`;
    } else if (error instanceof YoutubeTranscriptInvalidLangError) {
      err = `Invalid language code: ${error.lang}`;
    } else {
      err = `An unexpected error occurred: ${error.message}`;
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (err) {
    return { err };
  }

  const { title, description, ...metadata } = rawResult.videoDetails;

  let textTranscript;
  switch (options.textType) {
    case 'srt':
      textTranscript = _toSRT(rawResult.segments);
      break;
    case 'vtt':
      textTranscript = _toVTT(rawResult.segments);
      break;
    default:
      textTranscript = _toPlainText(rawResult.segments);
  }
  return {
    videoUrl,
    title,
    metadata,
    description,
    text: textTranscript,
  };
}

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extracts the 11-character video ID from a Youtube URL or bare video ID.
 * Accepts full URLs (`https://www.youtube.com/watch?v=...`), short URLs
 * (`https://youtu.be/...`), schemeless variants (`youtu.be/...`), and bare
 * 11-character video IDs. Extra query parameters and URL fragments are ignored.
 * @param {string} videoUrl - Youtube URL, schemeless URL, or bare 11-character video ID.
 * @returns {string} The extracted 11-character video ID.
 * @throws {Error} If `videoUrl` is missing, not a string, or cannot be parsed as a valid Youtube URL or video ID.
 */
function extractVideoId(videoUrl) {
  if (!videoUrl || typeof videoUrl !== 'string') {
    throw new Error('video URL is missing');
  }

  // Try parsing as URL, then with https:// prefix for schemeless inputs (e.g. youtu.be/...)
  let parsed;
  for (const candidate of [videoUrl, `https://${videoUrl}`]) {
    try {
      parsed = new URL(candidate);
      break;
    } catch {
      // continue to next candidate
    }
  }

  if (parsed) {
    const { hostname, pathname, searchParams } = parsed;
    if (hostname.endsWith('youtube.com')) {
      const v = searchParams.get('v');
      if (v && VIDEO_ID_RE.test(v)) {
        return v;
      }
    } else if (hostname === 'youtu.be') {
      const id = pathname.slice(1);
      if (VIDEO_ID_RE.test(id)) {
        return id;
      }
    }
  }

  // Fallback: bare 11-character video ID with valid characters
  if (VIDEO_ID_RE.test(videoUrl)) {
    return videoUrl;
  }

  throw new Error(`video URL is invalid: ${videoUrl}`);
}

/**
 * Returns only the transcript text from an extraction result.
 * @param {{text: string}} result - The extraction result returned by {@link extractFromVideo}.
 * @returns {string} The plain transcript text.
 */
function outputTextOnly(result) {
  return result.text;
}

/**
 * Formats an extraction result as a Markdown document.
 * Includes the video title as an H1 heading, an optional thumbnail image
 * (when a thumbnail of >= 480px wide is available), a retrieval
 * attribution line, and sections for metadata, description, and transcript text.
 * @param {{videoUrl: string, title: string, description: string, metadata: object, text: string}} result
 *   The extraction result returned by {@link extractFromVideo}.
 * @returns {string} The formatted Markdown string.
 */
function outputAsMarkdown(result) {
  const displayDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const thumbnailUrl = result.metadata?.thumbnails?.filter((tn) => tn.width >= 480)[0]?.url;
  const parts = [`# ${result.title}\n`];
  if (thumbnailUrl) {
    parts.push(`\n![${result.title}](${thumbnailUrl})\n`);
  }
  parts.push(
    `\n> Retrieved from ${result.videoUrl} on ${displayDate} via ytsubs`,
    '\n\n## Metadata\n',
    JSON.stringify(result.metadata),
    '\n\n## Description\n',
    result.description,
    '\n\n## Text\n',
    result.text,
  );
  return parts.join('');
}

/**
 * Prints the extraction result to stdout as a markdown.
 * @param {{videoUrl: string, title: string, description: string, metadata: object, text: string}} result
 *   The extraction result returned by {@link extractFromVideo}.
 * @returns {void}
 */
function printResult(result) {
  console.log(outputAsMarkdown(result));
}

const ytSubSdk = {
  extractFromVideo,
  outputTextOnly,
  outputAsMarkdown,
};

export default ytSubSdk;

export { extractFromVideo, outputTextOnly, outputAsMarkdown, extractVideoId, printResult };