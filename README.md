# ytsubs

Extracts the transcript/ subtitles/ captions of Youtube videos.

## Installation

```shell
npm install --global ytsubs
```

Note: For CLI usage only, no installation is required.

Note: Node.Js v22+ recommended.

## Usage

### CLI usage

Run `npx -y ytsubs` followed by either a Youtube URL, or an 11-character ID.

For example, all of the following will extract from the same Youtube video.

```shell
npx -y ytsubs "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

npx -y ytsubs "youtu.be/dQw4w9WgXcQ"

npx -y ytsubs dQw4w9WgXcQ
```

There aren't any options, just one CLI argument to identify which video.
If you would like to specify options, use the SDK programmatically instead.

### SDK usage

In your project, install `ytsubs`:

```shell
npm install ytsubs
```

Import the following methods from the SDK:

```js
import {
    extractFromVideo,
    outputTextOnly,
    outputAsMarkdown,
} from 'ytsubs';
```

Optionally, create an options object to override defaults:

```js
const options = {
    noCache: true, // default: false - saves in `.yt-subs-cache` under home
    toRetry: true, // default: false - if first attempt fails, retry with backoff
    language: 'es', // default: 'en' - can be any 2-letter language code
    textType: 'srt', // default: 'text' - can be 'text', 'srt', or 'vtt'
};
```

**To extract the transcript**:

```js
const result = await youtubeScript({
    videoUrl, // youtube URL or video ID
    options, // optional
});
```

The result object will contain the following fields:
- `title`: Video title
- `metadata`: Miscellaneous info (video ID, thumbnail URLs, etc.)
- `description`: Video description
- `text`: Video transcript (as text, SRT, or VTT)

**To convert the transcript to markdown format**:

```js
const markdown = outputAsMarkdown(result);
```

**To convert the transcript to text format**:

```js
const text = outputTextOnly(result);
```

### Generative AI agent-skill usage

This module comes with its own agent-skill, which complies with
the [agent skills specification](https://agentskills.io/specification).

To use it, you need to place a copy where your generative AI harness
(e.g. Claude Code, Kimi-CLI) is able to find it:

```shell
npx skills add bguiz/ytsubs --skill youtube-transcript-extract
```

To invoke it explicitly within your harness use a *command*, e.g.

```text
/youtube-transcript-extract youtu.be/dQw4w9WgXcQ
```

You can also use natural language to invoke it within your harness, e.g.

```text
download subtitles of youtu.be/dQw4w9WgXcQ and save to subtitles.txt
```

Read the skill file to see how it works:
[`./.agents/skills/youtube-transcript-extract/SKILL.md`](.agents/skills/youtube-transcript-extract/SKILL.md)

### MCP server usage

<!-- TODO -->
(Coming soon)

## Contributing

Your contributions are welcome!

### Submitting an update

Base set up:

[Fork this repo](https://github.com/bguiz/ytsubs/fork) on Github.

```shell
git clone git@github.com:${YOUR_GITHUB_USERNAME}/ytsubs.git
cd ytsubs
npm install
npm link # needed to test `npx` equivalent
ytsubs # test that npm link is active
```

Create a new branch prefixed with `feat/`, `fix/`, `docs/`, `refactor/`, or `test/`.

```shell
git fetch origin main:main
git checkout main

git checkout -b feat/my-new-feature # for features
git checkout -b fix/my-bug-fix # for bugs
git checkout -b docs/my-docs-update # for documentation
git checkout -b refactor/my-code-quality-improvement # for refactors
git checkout -b test/my-new-test # for refactors
```

Make your changes, then ensure that:
- there are no regressions, and
- that code coverage has not worsened

```shell
npm run test # run both unit tests and end-to-end tests

npm run coverage # run unit tests and measure code coverage
```

Push your git branch to the github remote of your fork:

```shell
git push origin ${YOUR_BRANCH_NAME}
```

Then [submit a Github PR](https://github.com/bguiz/ytsubs/pulls)
based on the branch that you have just pushed.

### Submitting a request

[Submit a Github issue](https://github.com/bguiz/ytsubs/issues).

## Author

[Brendan Graetz](https://bguiz.com/)

## Licence

MIT
