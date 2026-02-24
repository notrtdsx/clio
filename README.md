# clio

Command line radio for browsing and playing internet stations from your terminal. Powered by the Radio Browser API.

## Features

- Search stations by name
- Top voted and most clicked lists
- Browse by tag, country, and language
- Stream playback via `mpv`
- Favorites saved locally
- Click registration for community stats

## Requirements

- Python 3.14 or newer
- `mpv` installed and in your PATH

## Install

```bash
git clone https://github.com/notrtdsx/clio.git
cd clio
python -m venv .venv
```

macOS/Linux:

```bash
source .venv/bin/activate
pip install -e .
```

Windows:

```powershell
.venv\Scripts\Activate.ps1
pip install -e .
```

## Run

```bash
clio
```

Or without installing:

```bash
python -m clio
```

## Controls

- `tab` / `shift+tab`: switch tabs
- `enter`: search/open selection or play station
- `f`: add or remove favorite
- `s`: stop playback
- `q`: quit
- `/` or `i`: focus the search input

## Data

Favorites are stored in your user config folder:

- Windows: `%AppData%/clio/favorites.json`
- macOS: `~/Library/Application Support/clio/favorites.json`
- Linux: `~/.config/clio/favorites.json`

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
