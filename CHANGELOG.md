# Changelog

> Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0]

### Added
- Add a `--method` CLI flag and `YTSUBS_METHOD` environment variable to select between `plus` and `dlp` methods
  - `plus` is the current implementation and requires no new dependencies (default)
  - `dlp` is a new implementation that requires `yt-dlp` to be installed, and uses that to download the subtitles of the video (must be explicitly required)

### Changed
- Refactored `extractFromVideo` implementation to extract the `plus` method
- Improved code coverage for unit tests overall
- Updated agent skill to make use of `dlp` method

## [0.3.0]

### Added
- `timeout` option in `ExtractOptions` — aborts extraction after a given number of milliseconds
- `exports` map in `package.json` defining the public API surface (`.`, `./cli`, `./mcp`)
- Code quality automations
  - JSDoc comments for all exported functions and type definitions
  - GitHub Actions CI workflow with Codecov coverage upload
  - GitHub issue and PR templates
  - Biome for code linting and formatting
  - ESLint + `eslint-plugin-jsdoc` for JSDoc comment enforcement
  - Husky pre-push git hook (`npm run check:prepush`)

### Changed
- `noCache` and `noRetry` options renamed to `cache` and `retry` (positive default `true`; set `false` to disable)
- MCP tool handler now returns `isError: true` on extraction failure
- `extractFromVideo` now always returns `{ err }` on failure rather than throwing
- `extractFromVideo` now includes `videoUrl` in the success result
- CLI and MCP extracted to separate files (refactor split)
- Retry config changed to be less aggressive - wait longer between retries

### Fixed
- URL parsing now handles schemeless URLs and URLs with extra query parameters or fragments
- Default exports now resolve correctly for ESM consumers

## [0.2.0] - 2026-04-16

### Added
- Agent skill output format updated; skill definition refreshed

## [0.1.0] - 2026-04-14

### Added
- MCP server with stdio and streamable HTTP transports
- Gen AI agent skill (`youtube-transcript-extract`)
- `extractFromVideo`, `outputTextOnly`, `outputAsMarkdown` SDK module
- SRT and VTT transcript output formats
- README with CLI, SDK, MCP, and agent skill usage documentation
- Initial implementation: URL validation, transcript extraction via `youtube-transcript-plus`, markdown output
- Basic end-to-end test