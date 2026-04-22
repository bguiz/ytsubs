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
    cache: false,    // default: true  - caches responses in `.yt-subs-cache` under home directory
    retry: false,    // default: true  - retries with exponential backoff on transient failure
    language: 'es',  // default: 'en'  - any two-letter BCP-47 language code
    textType: 'srt', // default: 'text' - can be 'text', 'srt', or 'vtt'
    timeout: 30e3,  // default: none  - abort after this many milliseconds
};
```

**To extract the transcript**:

```js
const result = await extractFromVideo({
    videoUrl, // youtube URL or video ID
    options, // optional
});
```

The result object will contain the following fields:
- `videoUrl`: The video URL or ID that was passed in
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

This module comes with its own MCP server, which complies with
the [Model Context Protocol specification](https://modelcontextprotocol.io/specification/2025-11-25)
(dated 2025/11/25).
It supports both **stdio** and **streamable HTTP** transports.

**Terminal**:
To run the MCP server in a terminal, enter the following command:

```shell
npx -y -p ytsubs ytsubs-mcp stdio # for stdio transport
npx -y -p ytsubs ytsubs-mcp http # for streamable HTTP transport
```

**Inspector**:
To connect using the MCP inspector tool:

```shell
MCP_AUTO_OPEN_ENABLED=false DANGEROUSLY_OMIT_AUTH=true npx @modelcontextprotocol/inspector $( which node ) $PWD/yt-subs-mcp.js
```

Run the above command to start an MCP client that is connected to
the MCP server over stdio.
You should output similar to:

```text
🚀 MCP Inspector is up and running at:
   http://localhost:6274
```

Visit that URL in a browser, press the "connect" button,
then press the "list tools" button,
then press the "youtube-transcript-extract" button,
and finally, press the "run tool" button.

In the "history" pane, you should see a new invocation of "tools/call".
Expand the view from this using the triangular icon,
and yopu will be able to see both the request and response in full.

**Programmatically**:
To run and connect programmatically from Node.JS:

Import MCP modules.

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
```

For MCP over *stdio*, initialise a `transport` object like this (simple):

```js
const transport = new StdioClientTransport({
    command: 'ytsubs-mcp',
    args: ['stdio'],
    stderr: 'pipe',
});
```

For MCP over *streamable HTTP*, initialise a `transport` object like this (complex):

```js
serverProcess = spawn(
    'ytsubs-mcp',
    ['http'], {
        stdio: ['ignore', 'ignore', 'pipe'],
    },
);

let port;
try {
    port = await new Promise((resolve, reject) => {
        let stderr = '';
        serverProcess.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
            const match = stderr.match(/LISTEN (\d+)/);
            if (match) {
                resolve(parseInt(match[1], 10));
            }
        });
        serverProcess.on('error', reject);
        serverProcess.on('close', (code) => {
            reject(new Error(`server exited (code ${code}) before announcing port`));
        });
    });
} catch (err) {
    if (err.code === 'ENOENT') {
        assert.fail('ytsubs-mcp not found on PATH — run in the project directory: npm link');
    }
    throw err;
}

const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
);
```

Then create na MCP client that connects to the `transport`.

```js
client = new Client({ name: 'test-client', version: '0.0.1' });
await client.connect(transport);

// interact with MCP server using client
await client.listTools();
await client.callTool({
    name: 'youtube-transcript-extract',
    arguments: { videoUrl: VIDEO_URL },
});
```

## Contributing

Your contributions are welcome!

### Development tooling

The following commands are available for local development.

| Command | Tool | What it does |
|---|---|---|
| `npm run lint:comment` | `eslint`, `eslint-plugin-jsdoc` | Checks JSDoc comment structure |
| `npm run lint:code` | `biome` | Validates code lint rules |
| `npm run format:check` | `biome` | Validate formatting |
| `npm run format:write` | `biome` | Same as `format:check`, then overwrites files in place |
| `npm run test` | `node` | Runs all tests |
| `npm run test:unit` | `node` | Runs only unit tests |
| `npm run test:e2e` | `node` | Runs only e2e tests |
| `npm run coverage` | `node` | Same as `test`, and adds line/branch/function code coverage report |
| `npm run coverage:lcov` | `node` | Same as `coverage`, also writes `coverage.lcov` for upload to Codecov |


A subset of these checks also run automatically as a **pre-push git hook** (via Husky).
To bypass temporarily (not recommended): `git push --no-verify`.
To invoke them manually:

```shell
npm run check:prepush
```

### Submitting an update

Base set up:

[Fork this repo](https://github.com/bguiz/ytsubs/fork) on Github.

```shell
git clone git@github.com:${YOUR_GITHUB_USERNAME}/ytsubs.git
cd ytsubs
npm install
npm link # needed to test `npx` equivalent, used in e2e tests
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

When you `git push` your branch associated with a PR,
this project will kick off a Github CI workflow,
which you can find in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

### Submitting a request

[Submit a Github issue](https://github.com/bguiz/ytsubs/issues).

## Author

[Brendan Graetz](https://bguiz.com/)

## Licence

MIT
