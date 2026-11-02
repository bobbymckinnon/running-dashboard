import { decodePolyline, simplify } from "../geo";
import { Activity } from "../types";
import { FileIO } from "./io";
import { normaliseType } from "./track";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const nr = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Imports a JSON file of activities. Accepts the Strava API v3 shape
 * (distance, moving_time, start_date_local, map.summary_polyline, ...) and the shape used by
 * Strava's AI connector (summary.distance, start_local, reduced_polyline, ...).
 * The file is treated as untrusted data: every field is type-checked and length-limited.
 */
export async function importJson(io: FileIO, path: string, warnings: string[]): Promise<Activity[]> {
  if (!(await io.exists(path))) {
    warnings.push(`JSON file "${path}" not found.`);
    return [];
  }
  const st = await io.stat(path);
  if (st && st.size > 50 * 1024 * 1024) {
    warnings.push(`JSON file "${path}" is larger than 50 MB and was skipped.`);
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(await io.readText(path));
  } catch {
    warnings.push(`JSON file "${path}" is not valid JSON.`);
    return [];
  }

  let list: unknown[] = [];
  const gearNames = new Map<string, string>();
  if (Array.isArray(data)) list = data;
  else if (isObj(data)) {
    for (const key of ["activities", "history"]) {
      const v = data[key];
      if (Array.isArray(v)) list = list.concat(v);
    }
    const gear = data["gear"];
    if (Array.isArray(gear)) {
      for (const g of gear) {
        if (!isObj(g)) continue;
        const gid = isObj(g["gear_id"]) ? str(g["gear_id"]["id"]) : str(g["id"]);
        const label = [str(g["brand"]) || str(g["brand_name"]), str(g["model_name"]) || str(g["name"])].filter(Boolean).join(" ");
        if (gid && label) gearNames.set(gid, label.slice(0, 100));
      }
    }
  }

  const out: Activity[] = [];
  for (const a of list.slice(0, 100000)) {
    if (!isObj(a)) continue;
    const id = str(a["id"]);
    if (!id || !/^\d{1,20}$/.test(id)) continue;
    const s = isObj(a["summary"]) ? a["summary"] : a;
    const start = str(a["start_local"]) || str(a["start_date_local"]);
    if (!start || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(start)) continue;
    const poly = str(a["reduced_polyline"]) || (isObj(a["map"]) ? str(a["map"]["summary_polyline"]) : undefined);
    const track = poly && poly.length < 200000 ? simplify(decodePolyline(poly), 0.00008, 400) : undefined;
    const gid = str(a["gear_id"]);
    out.push({
      id: "s" + id,
      stravaId: id,
      name: (str(a["name"]) || "Activity").slice(0, 200),
      type: normaliseType(str(a["sport_type"]) || str(a["type"])),
      start: start.slice(0, 19),
      distance: nr(s["distance"]),
      movingTime: nr(s["moving_time"]),
      elapsedTime: nr(s["elapsed_time"]),
      elevationGain: nr(s["elevation_gain"]) || nr(s["total_elevation_gain"]),
      gear: gid ? gearNames.get(gid) : undefined,
      track: track && track.length ? track : undefined,
      source: "json",
    });
  }
  return out;
}
