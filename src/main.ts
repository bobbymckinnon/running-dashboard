import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { FileIO } from "./importers/io";
import { RACES_TEMPLATE } from "./importers/races";
import { DEFAULT_SETTINGS, RunningDashboardSettingTab, RunningDashboardSettings } from "./settings";
import { StoredCache, emptyCache, runImport } from "./store";
import { CACHE_VERSION } from "./types";
import { DashboardView, VIEW_TYPE } from "./view";

/** File access through Obsidian's vault adapter (works on desktop and mobile, stays inside the vault). */
class VaultIO implements FileIO {
  constructor(private plugin: Plugin) {}
  private get adapter() {
    return this.plugin.app.vault.adapter;
  }
  async listFiles(folder: string, maxFiles: number): Promise<string[]> {
    const out: string[] = [];
    const queue = [normalizePath(folder)];
    const seen = new Set<string>();
    while (queue.length && out.length < maxFiles) {
      const dir = queue.shift() as string;
      if (seen.has(dir) || !(await this.adapter.exists(dir))) continue;
      seen.add(dir);
      const l = await this.adapter.list(dir);
      out.push(...l.files.slice(0, maxFiles - out.length));
      // Never descend into the config folder (.obsidian) or other hidden folders.
      queue.push(...l.folders.filter((f) => !f.split("/").pop()?.startsWith(".")));
    }
    return out;
  }
  exists(path: string): Promise<boolean> {
    return this.adapter.exists(normalizePath(path));
  }
  async stat(path: string): Promise<{ mtime: number; size: number } | null> {
    const s = await this.adapter.stat(normalizePath(path));
    return s && s.type === "file" ? { mtime: s.mtime, size: s.size } : null;
  }
  readText(path: string): Promise<string> {
    return this.adapter.read(normalizePath(path));
  }
  readBinary(path: string): Promise<ArrayBuffer> {
    return this.adapter.readBinary(normalizePath(path));
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** Checks the shape of cache.json before use; anything unexpected is dropped (a re-import rebuilds it). */
function validateCache(raw: unknown): StoredCache {
  const c = emptyCache();
  if (typeof raw !== "object" || raw === null) return c;
  const r = raw as Record<string, unknown>;
  if (r.version !== CACHE_VERSION || !Array.isArray(r.activities)) return c;
  for (const a of r.activities.slice(0, 200000)) {
    if (typeof a !== "object" || a === null) continue;
    const x = a as Record<string, unknown>;
    if (!isStr(x.id) || !isStr(x.name) || !isStr(x.type) || !isStr(x.start) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(x.start)) continue;
    if (!isNum(x.distance) || !isNum(x.movingTime) || !isNum(x.elapsedTime) || !isNum(x.elevationGain)) continue;
    const track = Array.isArray(x.track)
      ? (x.track as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1])).slice(0, 2000)
      : undefined;
    c.activities.push({
      id: x.id.slice(0, 40),
      name: x.name.slice(0, 200),
      type: x.type.slice(0, 30),
      start: x.start,
      distance: x.distance,
      movingTime: x.movingTime,
      elapsedTime: x.elapsedTime,
      elevationGain: x.elevationGain,
      gear: isStr(x.gear) ? x.gear.slice(0, 100) : undefined,
      track: track && track.length ? track : undefined,
      source: x.source === "strava-export" || x.source === "file" ? x.source : "json",
      stravaId: isStr(x.stravaId) && /^\d{1,20}$/.test(x.stravaId) ? x.stravaId : undefined,
    });
  }
  c.importedAt = isStr(r.importedAt) ? r.importedAt.slice(0, 40) : "";
  c.warnings = Array.isArray(r.warnings) ? r.warnings.filter(isStr).slice(0, 200).map((w) => w.slice(0, 300)) : [];
  // Track cache entries are re-validated lazily: only well-formed ones are kept.
  if (typeof r.tracks === "object" && r.tracks !== null) {
    for (const [k, v] of Object.entries(r.tracks as Record<string, unknown>)) {
      if (typeof v !== "object" || v === null) continue;
      const e = v as Record<string, unknown>;
      if (!isNum(e.mtime)) continue;
      const p = e.parsed as Record<string, unknown> | null;
      if (p === null) c.tracks[k] = { mtime: e.mtime, parsed: null };
      else if (typeof p === "object" && isStr(p.type) && isNum(p.startMs) && isNum(p.distance) && isNum(p.elapsed) && isNum(p.moving) && isNum(p.ascent) && Array.isArray(p.track))
        c.tracks[k] = {
          mtime: e.mtime,
          parsed: {
            name: isStr(p.name) ? p.name.slice(0, 200) : undefined,
            type: p.type.slice(0, 30),
            startMs: p.startMs,
            distance: p.distance,
            elapsed: p.elapsed,
            moving: p.moving,
            ascent: p.ascent,
            track: (p.track as unknown[]).filter((q): q is [number, number] => Array.isArray(q) && q.length === 2 && isNum(q[0]) && isNum(q[1])).slice(0, 2000),
          },
        };
    }
  }
  return c;
}

export default class RunningDashboardPlugin extends Plugin {
  settings: RunningDashboardSettings = { ...DEFAULT_SETTINGS };
  cache: StoredCache = emptyCache();
  private importing = false;

  private get cachePath(): string {
    return normalizePath(`${this.manifest.dir}/cache.json`);
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadCache();

    this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addRibbonIcon("activity", "Open running dashboard", () => void this.activateView());
    this.addSettingTab(new RunningDashboardSettingTab(this.app, this));

    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.activateView() });
    this.addCommand({ id: "import-activities", name: "Import activities", callback: () => void this.importActivities() });
    this.addCommand({ id: "create-races-note", name: "Create races note", callback: () => void this.createRacesNote() });
  }

  async loadSettings(): Promise<void> {
    const raw: unknown = await this.loadData();
    const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const d = DEFAULT_SETTINGS;
    const str = (k: keyof RunningDashboardSettings) => (typeof r[k] === "string" ? r[k].slice(0, 500) : (d[k] as string));
    const numIn = (k: keyof RunningDashboardSettings, lo: number, hi: number) => {
      const v = r[k];
      return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : (d[k] as number);
    };
    // Only copy known keys with the right types, so a corrupted data.json cannot break the plugin.
    this.settings = {
      stravaExportFolder: str("stravaExportFolder"),
      activityFilesFolder: str("activityFilesFolder"),
      jsonFile: str("jsonFile"),
      racesNote: str("racesNote"),
      coachNote: str("coachNote"),
      units: r.units === "mi" ? "mi" : "km",
      raceKeywords: str("raceKeywords"),
      homeRadiusKm: numIn("homeRadiusKm", 1, 200),
      shoeLifeKm: numIn("shoeLifeKm", 100, 5000),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async loadCache(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(this.cachePath))) return;
      const parsed = JSON.parse(await adapter.read(this.cachePath)) as unknown;
      this.cache = validateCache(parsed);
    } catch {
      this.cache = emptyCache();
    }
  }

  private async saveCache(): Promise<void> {
    await this.app.vault.adapter.write(this.cachePath, JSON.stringify(this.cache));
  }

  openSettings(): void {
    new Notice("Choose your data folders in this plugin's settings.");
  }

  async importActivities(): Promise<void> {
    if (this.importing) {
      new Notice("Running dashboard: an import is already running.");
      return;
    }
    const s = this.settings;
    if (!s.stravaExportFolder && !s.activityFilesFolder && !s.jsonFile) {
      new Notice("Running dashboard: set a data folder or file in the plugin settings first.");
      this.openSettings();
      return;
    }
    this.importing = true;
    await this.detectStravaExport();
    const notice = new Notice("Running dashboard: importing activities…", 0);
    try {
      this.cache = await runImport(new VaultIO(this), s, this.cache);
      await this.saveCache();
      const runs = this.cache.activities.filter((a) => a.type === "Run").length;
      notice.setMessage(
        `Running dashboard: imported ${this.cache.activities.length} activities (${runs} runs)` +
          (this.cache.warnings.length ? `, ${this.cache.warnings.length} warnings (see the dashboard footer).` : "."),
      );
      window.setTimeout(() => notice.hide(), 6000);
      this.refreshViews();
    } catch (e) {
      notice.hide();
      new Notice(`Running dashboard: import failed: ${(e as Error).message}`);
    } finally {
      this.importing = false;
    }
  }

  /**
   * If the configured export folder has no activities.csv, look for one elsewhere in the vault
   * (people often unzip the archive under a different name) and use it.
   */
  private async detectStravaExport(): Promise<void> {
    const s = this.settings;
    const io = new VaultIO(this);
    if (s.stravaExportFolder && (await io.exists(`${s.stravaExportFolder}/activities.csv`))) return;
    const found = this.app.vault
      .getFiles()
      .filter((f) => f.name === "activities.csv" && !f.path.startsWith(this.app.vault.configDir))
      .sort((a, b) => a.path.length - b.path.length)[0];
    if (!found) return;
    const folder = found.parent && !found.parent.isRoot() ? found.parent.path : "";
    if (!folder || folder === s.stravaExportFolder) return;
    s.stravaExportFolder = folder;
    await this.saveSettings();
    new Notice(`Running dashboard: found your Strava export in "${folder}" and will use it.`);
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const v = leaf.view;
      if (v instanceof DashboardView) void v.render();
    }
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async createRacesNote(): Promise<void> {
    const path = this.settings.racesNote || "Races.md";
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.workspace.getLeaf("tab").openFile(existing);
      return;
    }
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder && !(await this.app.vault.adapter.exists(folder))) await this.app.vault.createFolder(folder);
    const f = await this.app.vault.create(path, RACES_TEMPLATE);
    await this.app.workspace.getLeaf("tab").openFile(f);
  }
}
