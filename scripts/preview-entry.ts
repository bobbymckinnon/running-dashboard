// Browser harness for development: runs the real importers and renderer against files in test-data/vault.
import { FileIO } from "../src/importers/io";
import { parseRaces, parseTargets, stripTargets } from "../src/importers/races";
import { renderDashboard } from "../src/render/dashboard";
import { Country } from "../src/render/maps";
import { DEFAULT_SETTINGS } from "../src/settings-data";
import { Place, buildRuns } from "../src/stats";
import { emptyCache, runImport } from "../src/store";
import places from "../src/assets/places.json";
import world from "../src/assets/world110.json";
import countries from "../src/assets/countries50.json";

declare global {
  interface Window {
    __FILES: Record<string, { b64: string; mtime: number }>;
    __TODAY: string;
    __RESULT: unknown;
  }
}

function bytes(path: string): Uint8Array {
  const f = window.__FILES[path];
  if (!f) throw new Error("missing " + path);
  const bin = atob(f.b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const io: FileIO = {
  async listFiles(folder) {
    return Object.keys(window.__FILES).filter((p) => p.startsWith(folder + "/"));
  },
  async exists(p) {
    return p in window.__FILES || Object.keys(window.__FILES).some((k) => k.startsWith(p + "/"));
  },
  async stat(p) {
    const f = window.__FILES[p];
    return f ? { mtime: f.mtime, size: atob(f.b64).length } : null;
  },
  async readText(p) {
    return new TextDecoder().decode(bytes(p));
  },
  async readBinary(p) {
    const b = bytes(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
};

// Minimal stand-in for Obsidian's global createEl helper.
(window as unknown as { createEl: unknown }).createEl = (tag: string, o: { cls?: string; text?: string } = {}) => {
  const e = document.createElement(tag);
  if (o.cls) e.className = o.cls;
  if (o.text !== undefined) e.textContent = o.text;
  return e;
};

async function main() {
  const s = { ...DEFAULT_SETTINGS, activityFilesFolder: "Running/watch", coachNote: "Running/Coach.md" };
  const cache = await runImport(io, s, emptyCache());
  const racesMd = await io.readText(s.racesNote);
  const races = parseRaces(racesMd);
  const coachMd = (await io.exists(s.coachNote)) ? await io.readText(s.coachNote) : "";
  const runs = buildRuns(cache.activities, races, s.raceKeywords);
  const view = document.createElement("div");
  view.className = "rd-view";
  document.body.appendChild(view);
  const note = document.createElement("div");
  note.className = "rd-coach-body";
  for (const para of stripTargets(coachMd).split("\n\n").slice(1)) {
    // The real plugin uses Obsidian's MarkdownRenderer; here **bold** is handled safely with text nodes.
    const p = document.createElement("p");
    para.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        const b = document.createElement("b");
        b.textContent = part.slice(2, -2);
        p.appendChild(b);
      } else p.appendChild(document.createTextNode(part));
    });
    note.appendChild(p);
  }
  renderDashboard(view, {
    runs, races, targets: parseTargets(coachMd), today: window.__TODAY, units: (new URLSearchParams(location.search).get("u") as "km" | "mi") || "km",
    homeRadiusKm: s.homeRadiusKm, shoeLifeKm: s.shoeLifeKm,
    places: places as Place[], world: world as Country[], countries: countries as Country[],
    importedAt: cache.importedAt, warnings: cache.warnings,
    coachNote: coachMd ? { el: note, updated: (coachMd.split("\n")[0] || "").replace(/^updated:\s*/i, "") } : undefined,
  });
  window.__RESULT = {
    activities: cache.activities.length,
    runs: runs.length,
    races: runs.filter((r) => r.race).length,
    warnings: cache.warnings,
    fit: cache.activities.filter((a) => a.source === "file").map((a) => [a.name, a.start, Math.round(a.distance), a.movingTime, a.track?.length]),
    evil: cache.activities.filter((a) => a.id === "s999").map((a) => [a.name, !!a.track]),
    dupCheck: cache.activities.filter((a) => a.start.startsWith("2026-10-15")).map((a) => [a.id, a.name, !!a.track]),
  };
}
document.addEventListener("DOMContentLoaded", () => void main().catch((e) => {
  window.__RESULT = { error: String((e && e.stack) || e) };
}));
