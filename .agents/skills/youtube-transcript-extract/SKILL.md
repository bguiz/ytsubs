---
name: youtube-transcript-extract
description: Extracts transcript/ captions from youtube videos (plus metadata)
activates_on: ["*"]
uses: []
license: MIT
metadata:
  author: bguiz
  version: "0.0.1"
---

# Youtube Transcript Extract, Skill Guide

Youtube is a popular video platform.
However, most bots (and some humans) prefer to simply extract/ use the text (what is spoken) during these videos.
Use this skill to obtain higher information density/ SNR from youtube videos.

Tip: This skill is best used when combined with other skills, e.g. summaries.

## When to apply

- "pls download the transcript of https://youtube.com/watch?v=dQw4w9WgXcQ"
- "extract subs from youtu.be/dQw4w9WgXcQ and save to video-subs.md"
- "for youtube video dQw4w9WgXcQ download all text"

## Activity

Run the following command:

```
npx -y ytsubs "(... URL or ID)"
```

Be sure to place quotes around the video URL or ID, in case of special characters.

This utility will output text containing the following data from the video:
- title
- metadata (JSON)
- description
- text (full transcript based on subtitles)

If unspecified, save the output to file: `video-subs.md`

Sample output: `./references/sample-output.md`

## Related skills

Nil

## Prerequisites

Node.JS 22+ installed
