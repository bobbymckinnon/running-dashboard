import { Gunzip } from "fflate";
import { LatLng, haversineKm, isValidLatLng, simplify } from "../geo";

/** Upper bounds that protect against huge or malicious files. */
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024;
const MAX_TRACK_POINTS = 500000;

export interface TrackPoint {
  lat: number;
  lng: number;
  /** Unix ms, or NaN when unknown. */
  t: number;
  ele: number;
}

export interface ParsedTrack {
  name?: string;
  type?: string;
  startMs?: number;
  /** Metres, when the file states it (otherwise computed from points). */
  distance?: number;
  elapsed?: number;
  moving?: number;
  ascent?: number;
  points: TrackPoint[];
}

/** Decompresses .gz data after checking the declared size, so a "zip bomb" is rejected up front. */
export function gunzipSafe(data: Uint8Array): Uint8Array {
  if (data.length < 18) throw new Error("gzip file too short");
  const n = data.length;
  const declared = (data[n - 4] | (data[n - 3] << 8) | (data[n - 2] << 16) | (data[n - 1] << 24)) >>> 0;
  if (declared > MAX_UNZIPPED_BYTES) throw new Error("gzip content too large");
  // The declared size can be forged, so decompress in chunks and stop as soon as the real output passes the cap.
  const chunks: Uint8Array[] = [];
  let total = 0;
  const gz = new Gunzip((chunk) => {
    total += chunk.length;
    if (total > MAX_UNZIPPED_BYTES) throw new Error("gzip content too large");
    chunks.push(chunk);
  });
  const STEP = 64 * 1024;
  for (let i = 0; i < n; i += STEP) gz.push(data.subarray(i, Math.min(n, i + STEP)), i + STEP >= n);
  if (total !== declared) throw new Error("gzip size mismatch");
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export const MAX_XML_CHARS = 25 * 1024 * 1024;

function parseXml(text: string): Document {
  if (text.length > MAX_XML_CHARS) throw new Error("XML file too large");
  // DOMParser in Obsidian (Chromium) never fetches external entities or DTDs, and the result is never inserted into the page.
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("invalid XML");
  return doc;
}

function firstText(el: Element | Document, tag: string): string | undefined {
  const n = el.getElementsByTagName(tag)[0];
  const t = n?.textContent?.trim();
  return t || undefined;
}

export function parseGpx(text: string): ParsedTrack {
  const doc = parseXml(text);
  const trk = doc.getElementsByTagName("trk")[0];
  const pts: TrackPoint[] = [];
  const nodes = doc.getElementsByTagName("trkpt");
  for (let i = 0; i < nodes.length && pts.length < MAX_TRACK_POINTS; i++) {
    const n = nodes[i];
    const lat = Number(n.getAttribute("lat"));
    const lng = Number(n.getAttribute("lon"));
    if (!isValidLatLng(lat, lng)) continue;
    const time = firstText(n, "time");
    const ele = Number(firstText(n, "ele"));
    pts.push({ lat, lng, t: time ? Date.parse(time) : NaN, ele: Number.isFinite(ele) ? ele : NaN });
  }
  return {
    name: trk ? firstText(trk, "name") : firstText(doc, "name"),
    type: trk ? firstText(trk, "type") : undefined,
    points: pts,
  };
}

export function parseTcx(text: string): ParsedTrack {
  const doc = parseXml(text);
  const act = doc.getElementsByTagName("Activity")[0];
  const pts: TrackPoint[] = [];
  const nodes = doc.getElementsByTagName("Trackpoint");
  for (let i = 0; i < nodes.length && pts.length < MAX_TRACK_POINTS; i++) {
    const n = nodes[i];
    const lat = Number(firstText(n, "LatitudeDegrees"));
    const lng = Number(firstText(n, "LongitudeDegrees"));
    if (!isValidLatLng(lat, lng)) continue;
    const time = firstText(n, "Time");
    const ele = Number(firstText(n, "AltitudeMeters"));
    pts.push({ lat, lng, t: time ? Date.parse(time) : NaN, ele: Number.isFinite(ele) ? ele : NaN });
  }
  let distance = 0;
  let elapsed = 0;
  const laps = doc.getElementsByTagName("Lap");
  for (let i = 0; i < laps.length; i++) {
    distance += Number(firstText(laps[i], "DistanceMeters")) || 0;
    elapsed += Number(firstText(laps[i], "TotalTimeSeconds")) || 0;
  }
  return {
    type: act?.getAttribute("Sport") || undefined,
    distance: distance || undefined,
    moving: elapsed || undefined,
    points: pts,
  };
}

/** Fills in distance / time / ascent from the points when the file does not state them. */
export function summarise(p: ParsedTrack): Required<Pick<ParsedTrack, "distance" | "elapsed" | "moving" | "ascent">> & { startMs: number } {
  const pts = p.points;
  let dist = 0;
  let moving = 0;
  let ascent = 0;
  let lastEle = NaN;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineKm([pts[i - 1].lat, pts[i - 1].lng], [pts[i].lat, pts[i].lng]) * 1000;
    dist += d;
    const dt = (pts[i].t - pts[i - 1].t) / 1000;
    if (Number.isFinite(dt) && dt > 0 && dt < 60 && d / dt > 0.5) moving += dt;
  }
  for (const pt of pts) {
    if (!Number.isFinite(pt.ele)) continue;
    if (!Number.isFinite(lastEle)) lastEle = pt.ele;
    else if (pt.ele - lastEle >= 2) {
      ascent += pt.ele - lastEle;
      lastEle = pt.ele;
    } else if (pt.ele < lastEle) lastEle = pt.ele;
  }
  const times = pts.map((x) => x.t).filter((t) => Number.isFinite(t));
  const startMs = p.startMs ?? (times.length ? times[0] : NaN);
  const elapsed = p.elapsed ?? (times.length > 1 ? (times[times.length - 1] - times[0]) / 1000 : 0);
  return {
    distance: p.distance ?? dist,
    elapsed,
    moving: p.moving ?? (moving || elapsed),
    ascent: p.ascent ?? ascent,
    startMs,
  };
}

export function toSimplifiedTrack(points: TrackPoint[]): LatLng[] {
  return simplify(
    points.map((p) => [p.lat, p.lng] as LatLng),
    0.00008,
    400,
  );
}

const TYPE_MAP: Record<string, string> = {
  run: "Run", running: "Run", "9": "Run", trail_run: "Run", trailrun: "Run", virtualrun: "Run", treadmill: "Run",
  walk: "Walk", walking: "Walk", hike: "Hike", hiking: "Hike",
  ride: "Ride", biking: "Ride", cycling: "Ride", bike: "Ride", virtualride: "Ride", ebikeride: "Ride",
  swim: "Swim", swimming: "Swim",
};

/** Maps the many ways sports are written in GPX/TCX/FIT/Strava to a short list. */
export function normaliseType(t?: string): string {
  if (!t) return "Run";
  const k = t.toLowerCase().replace(/[\s-]/g, "");
  if (Object.prototype.hasOwnProperty.call(TYPE_MAP, k)) return TYPE_MAP[k];
  if (k.includes("run")) return "Run";
  if (k.includes("walk")) return "Walk";
  if (k.includes("hike")) return "Hike";
  if (k.includes("ride") || k.includes("cycl") || k.includes("bik")) return "Ride";
  if (k.includes("swim")) return "Swim";
  return t.length > 30 ? "Other" : t.charAt(0).toUpperCase() + t.slice(1);
}
