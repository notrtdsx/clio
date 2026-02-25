# clio v0.1.1

Command line radio for browsing and playing internet stations from your terminal. Powered by the Radio Browser API.

## Features

- Lightweight Node.js CLI with a TUI interface
- Search stations by name or tag
- Now playing metadata when available
- Stream playback via `mpv`
- Click registration for community stats

## Requirements

- Windows, Linux, or macOS
- Node.js 18 or newer
- `mpv` installed and in your PATH
- Install dependencies with `npm install`

## Dependencies

- `blessed` for the TUI

## Install

```bash
npm install -g .
```

## Run

```bash
clio
```

## Usage

- Press `/` or `s` to search
- Type a station name (example: `soma fm`) or `tag:ambient`
- Use arrow keys to choose a result and press Enter to play
- Press `x` to stop playback
- Press `q` to quit

## Radio Browser API

Clio discovers a working API server at startup using `all.api.radio-browser.info`. The project uses the official endpoints and registers clicks when you play a station.

If you want to inspect endpoints manually:

```text
GET /json/stations/search
GET /json/stations/topvote
GET /json/stations/topclick
GET /json/tags
GET /json/countries
GET /json/languages
POST /json/url/{stationuuid}
```
