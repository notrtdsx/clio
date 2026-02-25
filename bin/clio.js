#!/usr/bin/env node

const { spawn } = require("node:child_process");
const dns = require("node:dns");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const blessed = require("blessed");

const DEFAULT_BASE_URL = "https://all.api.radio-browser.info";
const RESULT_LIMIT = 25;

async function resolveServer() {
  try {
    await dns.promises.lookup("all.api.radio-browser.info");
  } catch {
    // Ignore DNS errors and fall back to the default base URL.
  }

  try {
    const response = await fetch(`${DEFAULT_BASE_URL}/json/servers`);
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    const payload = await response.json();
    const servers = (payload || []).map((item) => item.name).filter(Boolean);
    if (!servers.length) {
      return { baseUrl: DEFAULT_BASE_URL, warning: "server discovery returned no servers" };
    }
    const pick = servers[Math.floor(Math.random() * servers.length)];
    return { baseUrl: `https://${pick}`, warning: null };
  } catch (err) {
    return { baseUrl: DEFAULT_BASE_URL, warning: `server discovery failed: ${err.message}` };
  }
}

async function searchStations(baseUrl, query, limit) {
  const params = new URLSearchParams({
    order: "votes",
    reverse: "true",
    limit: String(limit),
  });

  if (query.startsWith("tag:")) {
    params.set("tag", query.slice(4));
  } else {
    params.set("name", query);
  }

  const response = await fetch(`${baseUrl}/json/stations/search?${params}`);
  if (!response.ok) {
    throw new Error(`search failed with status ${response.status}`);
  }
  return response.json();
}

function formatStation(station) {
  const parts = [];
  if (station.country) {
    parts.push(station.country);
  }
  if (station.codec) {
    parts.push(station.codec.toUpperCase());
  }
  if (station.bitrate) {
    parts.push(`${station.bitrate}kbps`);
  }
  const details = parts.length ? ` (${parts.join(" | ")})` : "";
  const name = station.name || "(unnamed station)";
  return `${name}${details}`;
}

async function registerClick(baseUrl, stationuuid) {
  if (!stationuuid) {
    return;
  }
  try {
    await fetch(`${baseUrl}/json/url/${stationuuid}`, { method: "POST" });
  } catch {
    // Best-effort.
  }
}

function safeUnlink(filePath) {
  try {
    if (filePath) {
      require("node:fs").unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup.
  }
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  const normalized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string" && value.trim()) {
      normalized[key.toLowerCase()] = value.trim();
    }
  }
  return normalized;
}

function pickTrackText(metadata, mediaTitle) {
  const normalized = normalizeMetadata(metadata);
  const artist = normalized.artist || normalized["album_artist"] || "";
  const title = normalized.title || "";
  if (artist && title) {
    return `${artist} - ${title}`;
  }

  const streamTitle =
    normalized["icy-title"] ||
    normalized.streamtitle ||
    normalized["icy_title"] ||
    normalized["stream_title"] ||
    "";
  if (streamTitle) {
    return streamTitle;
  }

  if (typeof mediaTitle === "string" && mediaTitle.trim()) {
    return mediaTitle.trim();
  }

  return "";
}

function requestMpvProperty(socketPath, property) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let buffer = "";

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error("mpv ipc timeout"));
    }, 800);

    client.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    client.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      if (lines.length > 1) {
        const line = lines.shift().trim();
        buffer = lines.join("\n");
        clearTimeout(timeout);
        try {
          const payload = JSON.parse(line);
          resolve(payload.data);
        } catch (err) {
          reject(err);
        }
        client.end();
      }
    });

    client.on("connect", () => {
      client.write(JSON.stringify({ command: ["get_property", property] }) + "\n");
    });
  });
}

function createPlayer(status, nowPlaying) {
  let mpvProcess = null;
  let socketPath = null;
  let pollTimer = null;
  let currentStation = "";
  let lastTrack = "";
  let sessionId = 0;

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const cleanup = () => {
    stopPolling();
    if (socketPath) {
      safeUnlink(socketPath);
      socketPath = null;
    }
  };

  const pollMetadata = async () => {
    if (!socketPath) {
      return;
    }
    const metadata = await requestMpvProperty(socketPath, "metadata").catch(() => null);
    const mediaTitle = await requestMpvProperty(socketPath, "media-title").catch(() => null);
    const track = pickTrackText(metadata, mediaTitle);
    if (track && track !== lastTrack) {
      lastTrack = track;
      nowPlaying(currentStation, track);
    }
  };

  const stop = () => {
    if (mpvProcess) {
      mpvProcess.kill("SIGTERM");
      mpvProcess = null;
    }
    cleanup();
    lastTrack = "";
    nowPlaying(currentStation, "");
    status("stopped");
  };

  const play = (url, name) => {
    if (!url) {
      status("station has no stream url");
      return;
    }
    stop();

    sessionId += 1;
    const activeSession = sessionId;

    currentStation = name || "(unnamed station)";
    nowPlaying(currentStation, "");

    socketPath = path.join(os.tmpdir(), `clio-mpv-${process.pid}-${activeSession}.sock`);
    safeUnlink(socketPath);

    const proc = spawn("mpv", ["--no-video", "--quiet", `--input-ipc-server=${socketPath}`, url], {
      stdio: "ignore",
    });
    mpvProcess = proc;

    pollTimer = setInterval(() => {
      pollMetadata().catch(() => {});
    }, 2000);
    setTimeout(() => {
      pollMetadata().catch(() => {});
    }, 800);

    proc.on("error", (err) => {
      if (mpvProcess !== proc || activeSession !== sessionId) {
        return;
      }
      mpvProcess = null;
      cleanup();
      status(`mpv error: ${err.message}`);
    });

    proc.on("close", (code) => {
      if (mpvProcess !== proc || activeSession !== sessionId) {
        return;
      }
      mpvProcess = null;
      cleanup();
      if (code !== 0) {
        status("mpv exited with error");
      } else {
        status("stopped");
      }
    });
  };

  return { play, stop };
}

function createUi() {
  const screen = blessed.screen({
    smartCSR: true,
    title: "clio",
  });

  const header = blessed.box({
    top: 0,
    left: 0,
    height: 2,
    width: "100%",
    content: "clio - terminal radio\n/ or s search - enter play - x stop - q quit",
    style: { fg: "cyan" },
  });

  const searchInput = blessed.textbox({
    top: 2,
    left: 0,
    height: 3,
    width: "100%",
    label: " search ",
    border: { type: "line" },
    inputOnFocus: true,
  });

  const results = blessed.list({
    top: 5,
    left: 0,
    height: "100%-6",
    width: "100%",
    label: " results ",
    border: { type: "line" },
    keys: true,
    mouse: true,
    vi: true,
    style: {
      selected: { bg: "blue", fg: "white" },
    },
  });

  const statusBar = blessed.box({
    bottom: 0,
    left: 0,
    height: 1,
    width: "100%",
    style: { bg: "white", fg: "black" },
    content: "ready",
  });

  screen.append(header);
  screen.append(searchInput);
  screen.append(results);
  screen.append(statusBar);

  return { screen, searchInput, results, statusBar };
}

async function main() {
  const { baseUrl, warning } = await resolveServer();

  const { screen, searchInput, results, statusBar } = createUi();
  const nowPlayingState = { station: "-", track: "-" };
  let statusMessage = "ready";

  const renderStatusBar = () => {
    const stationText = nowPlayingState.station || "-";
    const trackText = nowPlayingState.track || "-";
    let content = `station: ${stationText} | track: ${trackText}`;
    if (statusMessage && statusMessage !== "ready") {
      content += ` | ${statusMessage}`;
    }
    statusBar.setContent(content);
    screen.render();
  };

  const status = (message) => {
    statusMessage = message || "ready";
    renderStatusBar();
  };

  const updateNowPlaying = (station, track) => {
    nowPlayingState.station = station || "-";
    nowPlayingState.track = track ? track : "(no metadata)";
    renderStatusBar();
  };

  if (warning) {
    status(`warning: ${warning}`);
  }

  const player = createPlayer(status, updateNowPlaying);
  let stations = [];

  const focusSearch = () => {
    searchInput.focus();
    searchInput.readInput();
  };

  const updateResults = (items) => {
    results.setItems(items.length ? items : ["(no results)"]);
    results.select(0);
    screen.render();
  };

  const performSearch = async (query) => {
    if (!query) {
      status("enter a search query");
      return;
    }

    status(`searching: ${query}`);
    let payload;
    try {
      payload = await searchStations(baseUrl, query, RESULT_LIMIT);
    } catch (err) {
      status(`search error: ${err.message}`);
      return;
    }

    if (!Array.isArray(payload) || !payload.length) {
      stations = [];
      updateResults([]);
      status("no results");
      return;
    }

    stations = payload;
    updateResults(stations.map(formatStation));
    status(`results: ${stations.length}`);
    results.focus();
  };

  results.on("select", async (_, index) => {
    const station = stations[index];
    if (!station) {
      return;
    }
    await registerClick(baseUrl, station.stationuuid);
    const url = station.url_resolved || station.url || "";
    player.play(url, station.name);
  });

  searchInput.on("submit", (value) => {
    const query = value.trim();
    searchInput.setValue(query);
    performSearch(query);
  });

  screen.key(["/", "s"], focusSearch);
  screen.key(["x"], () => {
    player.stop();
  });
  screen.key(["q", "C-c"], () => {
    player.stop();
    screen.destroy();
    process.exit(0);
  });

  updateResults([]);
  updateNowPlaying("-", "");
  focusSearch();
  screen.render();
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
