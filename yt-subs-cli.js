#!/usr/bin/env node

import { realpathSync as fsRealPathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    youtubeScript,
    printResult,
} from './yt-subs-sdk.js';

async function ytSubsCli(input) {
    const videoUrl = input || process.argv[2];
    const result = await youtubeScript({
        videoUrl,
    });
    if (result.err) {
        throw new Error(result.err);
    }
    printResult({
        videoUrl,
        ...result,
    });
    return result;
}

const filePath = fileURLToPath(import.meta.url);
if (fsRealPathSync(process.argv[1]) === filePath) {
    ytSubsCli().catch((err) => {
        console.error(err.message);
        process.exitCode = 1;
    });
}

export default ytSubsCli;
