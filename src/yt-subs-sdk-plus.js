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

import { extractVideoId } from './yt-subs-sdk.js';

/**
 * `youtube-transcript-plus`-backed implementation. Not intended to be called directly —
 * use `extractFromVideo` (from `yt-subs-sdk.js`) with `options.method = 'plus'` (the default).
 * @param {{videoUrl: string, options?: object, _deps?: object}} params Parameters.
 * @returns {Promise<object>} Result object on success, or `{ err }` on failure.
 */
async function extractFromVideo_plus({ videoUrl, options = {}, _deps = {} }) {
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

export { extractFromVideo_plus };
