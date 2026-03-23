# clio v0.1.1.1 - The Page Update

IF YOU WANT THE STABLE VERSION, GO TO THE STABLE BRANCH!

Command line radio for browsing and playing internet stations from your terminal. Powered by the Radio Browser API.

Tested on: Debian Testing, Arch Linux, Windows 10, Ubuntu 24.04.4 LTS and Termux on Android

## Features

- Lightweight Node.js CLI
- Interactive usage (no arguments)
- Stream playback via `mpv`

## Requirements

- Windows, Linux (recommended), or macOS
- Node.js v25.8.1
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
