import { Activity } from "../types";
import { parseFit } from "./fit";
import { FileIO, hashId, toLocalIso } from "./io";
import { MAX_FILE_BYTES, ParsedTrack, gunzipSafe, normaliseType, parseGpx, parseTcx, summarise, toSimplifiedTrack } from "./track";

export const TRACK_EXT = /\.(gpx|tcx|fit)(\.gz)?$/i;

export interface TrackCacheEntry {
  mtime: number;
  /** null means the file could not be parsed (and should not be retried until it changes). */
  parsed: {
    name?: string;
    type: string;
    startMs: number;
    distance: number;
    elapsed: number;
    moving: number;
    ascent: number;
    track: [number, number][];
  } | null;
}

/** Reads and parses one GPX/TCX/FIT file (optionally gzipped). Throws on unreadable or oversized files. */
export async function readTrackFile(io: FileIO, path: string): Promise<TrackCacheEntry["parsed"]> {
  const st = await io.stat(path);
  if (!st) throw new Error("file not found");
  if (st.size > MAX_FILE_BYTES) throw new Error("file too large");
  let bytes: Uint8Array = new Uint8Array(await io.readBinary(path));
  const lower = path.toLowerCase();
  if (lower.endsWith(".gz")) bytes = gunzipSafe(bytes);
  let parsed: ParsedTrack;
  if (/\.fit(\.gz)?$/.test(lower)) parsed = parseFit(bytes);
  else {
    const text = new TextDecoder("utf-8").decode(bytes);
    parsed = /\.tcx(\.gz)?$/.test(lower) ? parseTcx(text.trimStart()) : parseGpx(text.trimStart());
  }
  const s = summarise(parsed);
  return {
    name: parsed.name?.slice(0, 200),
    type: normaliseType(parsed.type),
    startMs: s.startMs,
    distance: s.distance,
    elapsed: s.elapsed,
    moving: s.moving,
    ascent: s.ascent,
    track: toSimplifiedTrack(parsed.points),
  };
}

/** Imports every track file in a folder as its own activity. */
export async function importFolder(
  io: FileIO,
  folder: string,
  cache: Record<string, TrackCacheEntry>,
  warnings: string[],
): Promise<Activity[]> {
  const out: Activity[] = [];
  const files = (await io.listFiles(folder, 20000)).filter((p) => TRACK_EXT.test(p));
  for (const path of files) {
    const st = await io.stat(path);
    if (!st) continue;
    let entry = cache[path];
    if (!entry || entry.mtime !== st.mtime) {
      try {
        entry = { mtime: st.mtime, parsed: await readTrackFile(io, path) };
      } catch (e) {
        entry = { mtime: st.mtime, parsed: null };
        warnings.push(`${path}: ${(e as Error).message}`);
      }
      cache[path] = entry;
    }
    const p = entry.parsed;
    if (!p || !Number.isFinite(p.startMs)) continue;
    const base = path.split("/").pop() || path;
    out.push({
      id: "f" + hashId(path + p.startMs),
      name: p.name || base.replace(TRACK_EXT, ""),
      type: p.type,
      start: toLocalIso(p.startMs),
      distance: p.distance,
      movingTime: p.moving,
      elapsedTime: p.elapsed,
      elevationGain: p.ascent,
      track: p.track.length ? p.track : undefined,
      source: "file",
    });
  }
  return out;
}
