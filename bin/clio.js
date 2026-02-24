#!/usr/bin/env node

const { spawn } = require("node:child_process");
const dns = require("node:dns");
const readline = require("node:readline");

const DEFAULT_BASE_URL = "https://all.api.radio-browser.info";

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

function playStream(url) {
  if (!url) {
    throw new Error("station has no stream url");
  }
  return new Promise((resolve, reject) => {
    const proc = spawn("mpv", ["--no-video", "--quiet", url], { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error("mpv exited with an error"));
      }
    });
  });
}

function promptLine(rl, label) {
  return new Promise((resolve) => {
    rl.question(label, (answer) => resolve(answer));
  });
}

async function main() {
  const { baseUrl, warning } = await resolveServer();
  if (warning) {
    console.error(`warning: ${warning}`);
  }

  console.log("clio - terminal radio");
  console.log("type a station name (e.g. soma fm) or tag:ambient");
  console.log("press q to quit\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const query = (await promptLine(rl, "search> ")).trim();
      if (!query) {
        continue;
      }
      if (query.toLowerCase() === "q") {
        break;
      }

      let stations;
      try {
        stations = await searchStations(baseUrl, query, 20);
      } catch (err) {
        console.error(`error: ${err.message}`);
        continue;
      }

      if (!Array.isArray(stations) || !stations.length) {
        console.log("no results\n");
        continue;
      }

      stations.forEach((station, index) => {
        console.log(`${String(index + 1).padStart(2, " ")}. ${formatStation(station)}`);
      });

      const selection = (await promptLine(rl, "play # (enter to skip, q to quit)> ")).trim();
      if (selection.toLowerCase() === "q") {
        break;
      }
      if (!selection) {
        console.log("");
        continue;
      }

      const index = Number(selection);
      if (!Number.isInteger(index) || index < 1 || index > stations.length) {
        console.log("invalid selection\n");
        continue;
      }

      const station = stations[index - 1];
      const url = station.url_resolved || station.url || "";

      await registerClick(baseUrl, station.stationuuid);

      try {
        console.log(`playing: ${station.name || "(unnamed station)"}`);
        await playStream(url);
      } catch (err) {
        console.error(`play error: ${err.message}`);
      }

      console.log("");
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
