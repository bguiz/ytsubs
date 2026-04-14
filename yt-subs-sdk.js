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

async function youtubeScript({
    videoUrl,
    options = {},
    _deps = {},
}) {
    const {
        fetchTranscript: _fetchTranscript = fetchTranscript,
        toPlainText: _toPlainText = toPlainText,
        toSRT: _toSRT = toSRT,
        toVTT: _toVTT = toVTT,
        FsCache: _FsCache = FsCache,
    } = _deps;

    const videoId = extractVideoId(videoUrl);

    let ytScriptFsCache;
    if (!options.noCache) {
        ytScriptFsCache = new _FsCache(
            pathResolve(osHomeDir(), '.yt-subs-cache'),
            86400e3, // 1 day
        );
    }
    let retries = 0;
    let retryDelay = 0;
    if (!options.noRetry) {
        retries = 5;
        retryDelay = 500;
    }

    let rawResult;
    let err;
    try {
        rawResult = await _fetchTranscript(
            videoId,
            {
                lang: (options.language || 'en'),
                cache: ytScriptFsCache,
                videoDetails: true,
                retries,
                retryDelay,
            },
        );
    } catch (error) {
        if (error instanceof YoutubeTranscriptVideoUnavailableError) {
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
        title,
        metadata,
        description,
        text: textTranscript,
    };
}

function extractVideoId(videoUrl) {
    if (!videoUrl || typeof videoUrl !== 'string') {
        throw new Error('video URL is missing');
    }
    if (videoUrl.includes('youtube.com')) {
        const match = videoUrl.match(/v=([a-zA-Z0-9_-]{11})/);
        if (match) {
            return match[1];
        }
    } else if (videoUrl.includes('youtu.be')) {
        const match = videoUrl.match(/\.be\/([a-zA-Z0-9_-]{11})/);
        if (match) {
            return match[1];
        }
    } else if (videoUrl.length === 11) {
        return videoUrl;
    }

    throw new Error(`video URL is invalid: ${videoUrl}`);
}

function outputTextOnly(result) {
    return result.text;
}

function outputAsMarkdown(result) {
    const displayDate = (new Date()).toISOString().slice(0, 19);
    let out = '';
    out = out +(`# ${result.title}\n`);
    out = out +(`Retrieved from ${result.videoUrl} on ${displayDate}Z`);
    out = out +('\n\n## Metadata\n');
    out = out +(JSON.stringify(result.metadata));
    out = out +('\n\n## Description\n')
    out = out +(result.description);
    out = out +('\n\n## Text\n')
    out = out +(result.text);
    return out;
}

function printResult(result) {
    console.log(outputAsMarkdown(result));
}

const ytSubSdk = {
    extractFromVideo: youtubeScript,
    outputTextOnly,
    outputAsMarkdown,
};

export default ytSubSdk;

export {
    youtubeScript,
    extractVideoId,
    printResult,
};
