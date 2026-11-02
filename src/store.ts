import { TrackCacheEntry, importFolder } from "./importers/files";
import { FileIO } from "./importers/io";
import { importJson } from "./importers/json";
import { importStravaExport } from "./importers/strava-export";
import type { RunningDashboardSettings } from "./settings-data";
import { Activity, CACHE_VERSION, DataCache } from "./types";

export interface StoredCache extends DataCache {
  tracks: Record<string, TrackCacheEntry>;
}

export function emptyCache(): StoredCache {
  return { version: CACHE_VERSION, importedAt: "", activities: [], fileMtimes: {}, warnings: [], tracks: {} };
}

function startMs(a: Activity): number {
  return new Date(a.start).getTime();
}

/**
 * Merges activities from all sources. The same run often appears twice (e.g. in the Strava export and
 * as a watch file); activities that start within 2 minutes of each other with similar distance are merged,
 * keeping the richer record.
 */
export function mergeActivities(lists: Activity[][]): Activity[] {
  const byId = new Map<string, Activity>();
  for (const list of lists) {
    for (const a of list) {
      const prev = byId.get(a.id);
      if (!prev) byId.set(a.id, a);
      else {
        // Same activity from two sources: keep the newest metadata, but prefer the full-resolution track
        // from a Strava export or watch file over a simplified API polyline.
        const richTrack = prev.source !== "json" && prev.track ? prev.track : a.source !== "json" && a.track ? a.track : a.track || prev.track;
        byId.set(a.id, { ...prev, ...a, track: richTrack, gear: a.gear || prev.gear, source: prev.source !== "json" ? prev.source : a.source });
      }
    }
  }
  const all = [...byId.values()].sort((a, b) => a.start.localeCompare(b.start));
  const out: Activity[] = [];
  const outMs: number[] = [];
  for (const a of all) {
    const ms = startMs(a);
    // Sorted by start time, so only the last few kept activities can be within 2 minutes.
    let dup: Activity | undefined;
    for (let j = out.length - 1; j >= 0 && ms - outMs[j] < 120000; j--) {
      const b = out[j];
      if (Math.abs(a.distance - b.distance) < Math.max(300, 0.05 * Math.max(a.distance, b.distance)) || !a.distance || !b.distance) {
        dup = b;
        break;
      }
    }
    if (!dup) {
      out.push(a);
      outMs.push(ms);
      continue;
    }
    // Prefer Strava records for names/ids, keep the best available track and gear.
    const keepA = a.stravaId && !dup.stravaId;
    const base = keepA ? a : dup;
    const other = keepA ? dup : a;
    Object.assign(base, {
      track: base.track || other.track,
      gear: base.gear || other.gear,
      elevationGain: base.elevationGain || other.elevationGain,
    });
    if (keepA) out[out.indexOf(dup)] = base;
  }
  return out;
}

export async function runImport(io: FileIO, s: RunningDashboardSettings, prev: StoredCache): Promise<StoredCache> {
  const warnings: string[] = [];
  const tracks: Record<string, TrackCacheEntry> = { ...prev.tracks };
  const lists: Activity[][] = [];
  if (s.stravaExportFolder) lists.push(await importStravaExport(io, s.stravaExportFolder, tracks, warnings));
  if (s.activityFilesFolder) lists.push(await importFolder(io, s.activityFilesFolder, tracks, warnings));
  if (s.jsonFile) lists.push(await importJson(io, s.jsonFile, warnings));
  // Drop cache entries for files that no longer exist so the cache cannot grow forever.
  const live: Record<string, TrackCacheEntry> = {};
  for (const [k, v] of Object.entries(tracks)) if (await io.exists(k)) live[k] = v;
  return {
    version: CACHE_VERSION,
    importedAt: new Date().toISOString(),
    activities: mergeActivities(lists),
    fileMtimes: {},
    warnings: warnings.slice(0, 200),
    tracks: live,
  };
}
