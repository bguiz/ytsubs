#!/usr/bin/env node

import { homedir as osHomeDir } from 'node:os';
import { resolve as pathResolve } from 'node:path';

import {
    fetchTranscript,
    toPlainText,
    FsCache,
    YoutubeTranscriptVideoUnavailableError,
    YoutubeTranscriptDisabledError,
    YoutubeTranscriptNotAvailableError,
    YoutubeTranscriptNotAvailableLanguageError,
    YoutubeTranscriptInvalidLangError,
} from 'youtube-transcript-plus';

async function youtubeScript({
    videoUrl,
}) {
    const videoId = extractVideoId(videoUrl);

    const ytScriptFsCache = new FsCache(
        pathResolve(osHomeDir(), '.yt-script-cache'),
        86400e3, // 1 days
    );

    let rawResult;
    try {
        rawResult = await fetchTranscript(
            videoId,
            {
                lang: 'en',
                cache: ytScriptFsCache,
                videoDetails: true,
                retries: 5,
                retryDelay: 500,
            },
        );
    } catch (error) {
        console.error('Error:', videoId);
        if (error instanceof YoutubeTranscriptVideoUnavailableError) {
            console.error('Video is unavailable:', error.videoId);
        } else if (error instanceof YoutubeTranscriptDisabledError) {
            console.error('Transcripts are disabled:', error.videoId);
        } else if (error instanceof YoutubeTranscriptNotAvailableError) {
            console.error('No transcript available:', error.videoId);
        } else if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
            console.error('Language not available:', error.lang, error.availableLangs);
        } else if (error instanceof YoutubeTranscriptInvalidLangError) {
            console.error('Invalid language code:', error.lang);
        } else {
            console.error('An unexpected error occurred:', error.message);
        }
        process.exit(2);
    }

    const { title, description, ...metadata } = rawResult.videoDetails;

    const textTranscript = toPlainText(rawResult.segments);
    return {
        title,
        metadata,
        description,
        text: textTranscript,
    };
}

function extractVideoId(videoUrl) {
    if (!videoUrl || typeof videoUrl !== 'string') {
        console.error('video URL is missing');
        process.exit(1);
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

    console.error('video URL is invalid:', videoUrl);
    process.exit(1);
}

function printResult(result) {
    const displayDate = (new Date()).toISOString().slice(0, 19);
    console.log(`# ${result.title}\n`);
    console.log(`Retrieved from ${result.videoUrl} on ${displayDate}Z`);
    console.log('\n\n## Metadata\n');
    console.log(JSON.stringify(result.metadata));
    console.log('\n\n## Description\n')
    console.log(result.description);
    console.log('\n\n## Text\n')
    console.log(result.text);
}

async function main() {
    const videoUrl = process.argv[2];
    const result = await youtubeScript({
        videoUrl,
    });
    printResult({
        videoUrl,
        ...result,
    });
    process.exit(0);
}

main();

export {
    youtubeScript
};
