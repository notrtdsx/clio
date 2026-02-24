# clio v0.1

Command line radio for browsing and playing internet stations from your terminal. Powered by the Radio Browser API.

## Features

- Lightweight Node.js CLI
- Interactive usage (no arguments)
- Stream playback via `mpv`
- Click registration for community stats

## Requirements

- Windows, Linux, or macOS
- Node.js 18 or newer
- `mpv` installed and in your PATH

## Install

```bash
npm install -g .
```

## Run

```bash
clio
```

## Usage

- Type a station name (example: `soma fm`)
- Or use `tag:ambient` to search by tag
- Enter a result number to play
- Type `q` to quit

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
