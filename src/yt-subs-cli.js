#!/usr/bin/env node

import { realpathSync as fsRealPathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { extractFromVideo, printResult } from './yt-subs-sdk.js';

/**
 * Extracts the transcript for a Youtube video and prints it to stdout as markdown.
 * When called programmatically (with `input`), CLI flags on `process.argv` are ignored.
 * When invoked as a script, parses the video URL and `--method` from `process.argv`.
 * `--method` precedence (highest first): CLI flag → `YTSUBS_METHOD` env var → `plus` default.
 * @param {string} [input] - YouTube URL or bare video ID. Falls back to argv parsing.
 * @returns {Promise<{videoUrl: string, title: string, description: string, metadata: object, text: string}>}
 *   The extraction result.
 * @throws {Error} If the URL is invalid or the transcript cannot be retrieved.
 */
async function ytSubsCli(input) {
  let videoUrl;
  let cliMethod;

  if (input) {
    videoUrl = input;
  } else {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        method: { type: 'string', short: 'm' },
      },
      allowPositionals: true,
    });
    videoUrl = positionals[0];
    cliMethod = values.method;
  }

  const method = cliMethod || process.env.YTSUBS_METHOD || 'plus';

  const result = await extractFromVideo({
    videoUrl,
    options: { method },
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
