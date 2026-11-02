import { Activity } from "../types";
import { parseCsv } from "./csv";
import { TrackCacheEntry, readTrackFile } from "./files";
import { FileIO, safeJoin, toLocalIso } from "./io";
import { normaliseType } from "./track";

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Parses Strava's "Activity Date" (UTC), e.g. "Oct 13, 2026, 6:14:28 AM". Returns NaN if the format is unknown. */
export function parseStravaDate(s: string): number {
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}):(\d{2})\s*([AaPp][Mm])?$/.exec(s.trim());
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon === undefined) return NaN;
    let h = Number(m[4]);
    if (m[7]) {
      const pm = m[7].toLowerCase() === "pm";
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
    }
    return Date.UTC(Number(m[3]), mon, Number(m[2]), h, Number(m[5]), Number(m[6]));
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5], +iso[6]);
  return NaN;
}

function num(s: string | undefined): number {
  if (s === undefined) return NaN;
  const t = s.trim();
  if (!t) return NaN;
  // Some locales write decimals with a comma ("10,02"); only treat a single comma as a decimal mark.
  const n = Number(/^-?\d+,\d+$/.test(t) ? t.replace(",", ".") : t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Imports an unzipped Strava bulk export: activities.csv plus the original files it references
 * (activities/*.gpx, *.fit.gz, *.tcx.gz) for the route maps.
 */
export async function importStravaExport(
  io: FileIO,
  folder: string,
  cache: Record<string, TrackCacheEntry>,
  warnings: string[],
): Promise<Activity[]> {
  const csvPath = safeJoin(folder, "activities.csv");
  if (!csvPath || !(await io.exists(csvPath))) {
    warnings.push(`No activities.csv found in "${folder}".`);
    return [];
  }
  const st = await io.stat(csvPath);
  if (st && st.size > 50 * 1024 * 1024) {
    warnings.push("activities.csv is larger than 50 MB and was skipped.");
    return [];
  }
  const rows = parseCsv(await io.readText(csvPath));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  // Strava repeats some column names (e.g. "Distance" in km, then in metres). Use the last occurrence for raw units.
  const first = (name: string) => header.indexOf(name);
  const last = (name: string) => header.lastIndexOf(name);
  const col = {
    id: first("Activity ID"),
    date: first("Activity Date"),
    name: first("Activity Name"),
    type: first("Activity Type"),
    distKm: first("Distance"),
    distM: last("Distance"),
    elapsed: last("Elapsed Time"),
    moving: last("Moving Time"),
    elev: last("Elevation Gain"),
    gear: first("Activity Gear"),
    file: first("Filename"),
  };
  if (col.id < 0 || col.date < 0) {
    warnings.push("activities.csv does not look like a Strava export (missing Activity ID / Activity Date).");
    return [];
  }

  const out: Activity[] = [];
  for (const r of rows.slice(1)) {
    const rawId = (r[col.id] || "").trim();
    if (!/^\d{1,20}$/.test(rawId)) continue;
    let startMs = parseStravaDate(r[col.date] || "");
    let distance = col.distM > col.distKm ? num(r[col.distM]) : NaN;
    if (!Number.isFinite(distance)) distance = num(r[col.distKm]) * 1000;
    const elapsed = num(r[col.elapsed]);
    const moving = num(r[col.moving]);

    let track: [number, number][] | undefined;
    const rel = col.file >= 0 ? (r[col.file] || "").trim() : "";
    if (rel) {
      const p = safeJoin(folder, rel);
      if (!p) warnings.push(`Skipped unsafe file path in activities.csv: ${rel.slice(0, 80)}`);
      else {
        const fst = await io.stat(p);
        if (fst) {
          let entry = cache[p];
          if (!entry || entry.mtime !== fst.mtime) {
            try {
              entry = { mtime: fst.mtime, parsed: await readTrackFile(io, p) };
            } catch (e) {
              entry = { mtime: fst.mtime, parsed: null };
              warnings.push(`${p}: ${(e as Error).message}`);
            }
            cache[p] = entry;
          }
          if (entry.parsed) {
            if (entry.parsed.track.length) track = entry.parsed.track;
            if (!Number.isFinite(startMs)) startMs = entry.parsed.startMs;
          }
        }
      }
    }
    if (!Number.isFinite(startMs)) continue;

    out.push({
      id: "s" + rawId,
      stravaId: rawId,
      name: (r[col.name] || "Activity").trim().slice(0, 200),
      type: normaliseType(r[col.type]),
      start: toLocalIso(startMs),
      distance: Number.isFinite(distance) ? distance : 0,
      movingTime: Number.isFinite(moving) ? moving : Number.isFinite(elapsed) ? elapsed : 0,
      elapsedTime: Number.isFinite(elapsed) ? elapsed : 0,
      elevationGain: num(r[col.elev]) || 0,
      gear: col.gear >= 0 ? (r[col.gear] || "").trim().slice(0, 100) || undefined : undefined,
      track,
      source: "strava-export",
    });
  }
  return out;
}
