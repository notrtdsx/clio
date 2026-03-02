#!/usr/bin/env node

const { spawn } = require("node:child_process");
const dns = require("node:dns");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const blessed = require("blessed");

const DEFAULT_BASE_URL = "https://all.api.radio-browser.info";
const PAGE_SIZE = 25;
const RESULT_LIMIT = 500;

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
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup.
  }
}

function sanitizeFilePart(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTrack(trackText) {
  if (typeof trackText !== "string") {
    return { artist: "", title: "" };
  }
  const trimmed = trackText.trim();
  if (!trimmed) {
    return { artist: "", title: "" };
  }

  const separatorIndex = trimmed.indexOf(" - ");
  if (separatorIndex === -1) {
    return { artist: "", title: trimmed };
  }

  return {
    artist: trimmed.slice(0, separatorIndex).trim(),
    title: trimmed.slice(separatorIndex + 3).trim(),
  };
}

function createRecorder(status) {
  let enabled = false;
  let ffmpegProcess = null;
  let activeTrack = "";
  const recordingsDir = path.join(process.cwd(), "recordings");

  const ensureRecordingsDir = () => {
    fs.mkdirSync(recordingsDir, { recursive: true });
  };

  const buildOutputPath = (trackText) => {
    const { artist, title } = parseTrack(trackText);
    const safeArtist = sanitizeFilePart(artist);
    const safeTitle = sanitizeFilePart(title);
    const safeTrack = sanitizeFilePart(trackText);
    const baseName =
      safeArtist && safeTitle
        ? `${safeArtist} - ${safeTitle}`
        : safeTitle || safeArtist || safeTrack || "unknown-track";

    let suffix = 0;
    while (true) {
      const candidateName = suffix === 0 ? `${baseName}.ogg` : `${baseName} (${suffix}).ogg`;
      const candidatePath = path.join(recordingsDir, candidateName);
      if (!fs.existsSync(candidatePath)) {
        return candidatePath;
      }
      suffix += 1;
    }
  };

  const stopRecordingProcess = () => {
    if (!ffmpegProcess) {
      return;
    }
    ffmpegProcess.kill("SIGINT");
    ffmpegProcess = null;
  };

  const startRecording = (url, trackText) => {
    if (!url || !trackText) {
      return;
    }

    ensureRecordingsDir();
    const outputPath = buildOutputPath(trackText);
    const proc = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        url,
        "-vn",
        "-c:a",
        "libvorbis",
        "-y",
        outputPath,
      ],
      { stdio: "ignore" }
    );

    ffmpegProcess = proc;
    activeTrack = trackText;
    status(`recording: ${trackText}`);

    proc.on("error", (err) => {
      if (ffmpegProcess !== proc) {
        return;
      }
      ffmpegProcess = null;
      status(`recorder error: ${err.message}`);
    });

    proc.on("close", (code) => {
      if (ffmpegProcess === proc) {
        ffmpegProcess = null;
      }
      const savedFile = path.basename(outputPath);
      if (code === 0 || code === 255) {
        status(`saved: ${savedFile}`);
      } else {
        status(`recorder exited with code ${code}`);
      }
    });
  };

  const handleTrackChange = ({ track, url, stopped }) => {
    if (!enabled) {
      return;
    }

    if (stopped || !url) {
      stopRecordingProcess();
      activeTrack = "";
      return;
    }

    if (!track || track === "(no metadata)" || track === activeTrack) {
      return;
    }

    stopRecordingProcess();
    startRecording(url, track);
  };

  const toggle = (context) => {
    enabled = !enabled;

    if (!enabled) {
      stopRecordingProcess();
      activeTrack = "";
      status("recorder off");
      return;
    }

    status("recorder on");
    if (context && context.url && context.track && context.track !== "(no metadata)") {
      handleTrackChange(context);
    }
  };

  const stop = () => {
    stopRecordingProcess();
    activeTrack = "";
  };

  const isEnabled = () => enabled;

  return { handleTrackChange, toggle, stop, isEnabled };
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

function createPlayer(status, nowPlaying, onTrackChange = () => {}) {
  let mpvProcess = null;
  let socketPath = null;
  let pollTimer = null;
  let currentStation = "";
  let currentUrl = "";
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
      onTrackChange({ station: currentStation, track, url: currentUrl, stopped: false });
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
    onTrackChange({ station: currentStation, track: "", url: "", stopped: true });
    currentUrl = "";
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
    currentUrl = url;
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
      currentUrl = "";
      status(`mpv error: ${err.message}`);
    });

    proc.on("close", (code) => {
      if (mpvProcess !== proc || activeSession !== sessionId) {
        return;
      }
      mpvProcess = null;
      cleanup();
      currentUrl = "";
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
    content: "clio - terminal radio",
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
    height: "100%-7",
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

  const helpBar = blessed.box({
    bottom: 1,
    left: 0,
    height: 1,
    width: "100%",
    style: { bg: "blue", fg: "white" },
    content: "^S Search  ^Enter Play  ^N Next  ^P Prev  ^R Record  ^X Stop  ^Q Quit",
  });

  screen.append(header);
  screen.append(searchInput);
  screen.append(results);
  screen.append(helpBar);
  screen.append(statusBar);

  return { screen, searchInput, results, statusBar, helpBar };
}

async function main() {
  const { baseUrl, warning } = await resolveServer();

  const { screen, searchInput, results, statusBar } = createUi();
  const nowPlayingState = { station: "-", track: "-" };
  let statusMessage = "ready";
  let scrollTimer = null;
  let scrollOffset = 0;
  let scrollText = "";

  const getStatusWidth = () => {
    const width = typeof statusBar.width === "number" ? statusBar.width : screen.width;
    return Math.max(1, width || 1);
  };

  const renderStatusBarFrame = () => {
    const width = getStatusWidth();
    if (!scrollText) {
      statusBar.setContent("");
      screen.render();
      return;
    }
    if (scrollText.length <= width) {
      statusBar.setContent(scrollText);
      screen.render();
      return;
    }
    const spacer = "   ";
    const source = `${scrollText}${spacer}`;
    const total = source.length;
    const start = scrollOffset % total;
    let view = source.slice(start, start + width);
    if (view.length < width) {
      view += source.slice(0, width - view.length);
    }
    statusBar.setContent(view);
    screen.render();
  };

  const renderStatusBar = () => {
    const stationText = nowPlayingState.station || "-";
    const trackText = nowPlayingState.track || "-";
    let content = `station: ${stationText} | track: ${trackText}`;
    if (statusMessage && statusMessage !== "ready") {
      content += ` | ${statusMessage}`;
    }
    scrollText = content;
    scrollOffset = 0;
    if (scrollText.length <= getStatusWidth()) {
      if (scrollTimer) {
        clearInterval(scrollTimer);
        scrollTimer = null;
      }
      renderStatusBarFrame();
      return;
    }
    if (!scrollTimer) {
      scrollTimer = setInterval(() => {
        scrollOffset += 1;
        renderStatusBarFrame();
      }, 200);
    }
    renderStatusBarFrame();
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

  const recorder = createRecorder(status);
  const player = createPlayer(status, updateNowPlaying, recorder.handleTrackChange);
  let stations = [];
  let currentPage = 0;
  let currentStreamUrl = "";

  const focusSearch = () => {
    searchInput.focus();
    searchInput.readInput();
  };

  const getTotalPages = () => Math.max(1, Math.ceil(stations.length / PAGE_SIZE));

  const updateResults = () => {
    const totalPages = getTotalPages();
    currentPage = Math.min(Math.max(currentPage, 0), totalPages - 1);

    const start = currentPage * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const items = stations.slice(start, end).map(formatStation);

    results.setLabel(` results (page ${currentPage + 1}/${totalPages}) `);
    results.setItems(items.length ? items : ["(no results)"]);
    results.select(0);
    screen.render();
  };

  const goToPage = (page) => {
    if (!stations.length) {
      return;
    }
    const totalPages = getTotalPages();
    const nextPage = Math.min(Math.max(page, 0), totalPages - 1);
    if (nextPage === currentPage) {
      return;
    }
    currentPage = nextPage;
    updateResults();
    status(`results: ${stations.length} | page ${currentPage + 1}/${totalPages}`);
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
      currentPage = 0;
      updateResults();
      status("no results");
      return;
    }

    stations = payload;
    currentPage = 0;
    updateResults();
    status(`results: ${stations.length} | page 1/${getTotalPages()}`);
    results.focus();
  };

  const getCurrentStationContext = () => {
    return {
      station: nowPlayingState.station,
      track: nowPlayingState.track,
      url: currentStreamUrl,
    };
  };

  results.on("select", async (_, index) => {
    const station = stations[currentPage * PAGE_SIZE + index];
    if (!station) {
      return;
    }
    await registerClick(baseUrl, station.stationuuid);
    const url = station.url_resolved || station.url || "";
    currentStreamUrl = url;
    player.play(url, station.name);
  });

  searchInput.on("submit", (value) => {
    const query = value.trim();
    searchInput.setValue(query);
    performSearch(query);
  });

  screen.key(["/", "s"], focusSearch);
  screen.key(["n", "pagedown"], () => {
    goToPage(currentPage + 1);
  });
  screen.key(["p", "pageup"], () => {
    goToPage(currentPage - 1);
  });
  screen.key(["r"], () => {
    recorder.toggle(getCurrentStationContext());
  });
  screen.key(["x"], () => {
    recorder.stop();
    currentStreamUrl = "";
    player.stop();
  });
  screen.key(["q", "C-c"], () => {
    recorder.stop();
    currentStreamUrl = "";
    player.stop();
    if (scrollTimer) {
      clearInterval(scrollTimer);
      scrollTimer = null;
    }
    screen.destroy();
    process.exit(0);
  });

  screen.on("resize", () => {
    renderStatusBar();
  });

  updateResults();
  updateNowPlaying("-", "");
  focusSearch();
  screen.render();
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
