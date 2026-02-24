# clio

Command line radio for browsing and playing internet stations from your terminal. Powered by the Radio Browser API.

## Features

- Fast Rust CLI
- Search stations by name or tag
- Stream playback via `mpv`
- Click registration for community stats

## Requirements

- Rust (stable) and Cargo
- `mpv` installed and in your PATH

## Build

```bash
git clone https://github.com/notrtdsx/clio.git
cd clio
cargo build --release
```

## Install

Windows (CMD):

```cmd
mkdir %LOCALAPPDATA%\clio
copy target\release\clio.exe %LOCALAPPDATA%\clio\clio.exe
setx PATH "%PATH%;%LOCALAPPDATA%\clio"
```

Linux/macOS:

```bash
cargo install --path .
```

## Run

Linux/macOS:

```bash
clio
```

Windows (CMD):

```cmd
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
