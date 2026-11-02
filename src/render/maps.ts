import { LatLng, haversineKm, mercator, pointInRing, trackMid } from "../geo";
import { Place, Run, Units, distUnit, fmtDist, nearestPlace } from "../stats";
import { Race } from "../types";
import { pts, svg, svgRoot } from "./dom";

export interface Country {
  n: string;
  r: number[][][]; // rings of [lng, lat]
}

interface Projection {
  w: number;
  h: number;
  P: (lat: number, lng: number) => [number, number];
}

/** Fits a Mercator projection of a lat/lng box into a given width. */
function fit(lat0: number, lng0: number, lat1: number, lng1: number, w: number, maxH = 640, minH = 300): Projection {
  const [x0, y0] = mercator(lat0, lng0);
  const [x1, y1] = mercator(lat1, lng1);
  let sx = w / (x1 - x0);
  let h = (y1 - y0) * sx;
  if (h > maxH) {
    sx = maxH / (y1 - y0);
    h = maxH;
  }
  const H = Math.max(minH, Math.round(h));
  const ox = (w - (x1 - x0) * sx) / 2;
  const oy = (H - (y1 - y0) * sx) / 2;
  return {
    w,
    h: H,
    P: (lat, lng) => {
      const [x, y] = mercator(lat, lng);
      return [ox + (x - x0) * sx, oy + (y1 - y) * sx];
    },
  };
}

function frame(parent: HTMLElement, w: number, h: number, id: string): { root: SVGElement; g: SVGElement } {
  const root = svgRoot(parent, w, h, "rd-map");
  const cp = svg(root, "clipPath", { id });
  svg(cp, "rect", { x: 0, y: 0, width: w, height: h, rx: 10 });
  svg(root, "rect", { x: 0, y: 0, width: w, height: h, rx: 10, class: "rd-sea" });
  const g = svg(root, "g", { "clip-path": `url(#${id})` });
  return { root, g };
}

/** Places labels next to points, trying several positions and skipping ones that overlap. */
class Labeller {
  private boxes: [number, number, number, number][] = [];
  constructor(private w: number, private h: number, private dots: [number, number][]) {}

  place(g: SVGElement, x: number, y: number, lines: { text: string; cls: string; size: number }[]): void {
    const tw = Math.max(...lines.map((l) => l.text.length * l.size * 0.58));
    const th = lines.length * 14;
    const tries: [number, number, "start" | "end" | "middle"][] = [
      [10, 0, "start"], [-10, 0, "end"], [10, -18, "start"], [-10, -18, "end"],
      [10, 20, "start"], [-10, 20, "end"], [0, -26, "middle"], [0, 28, "middle"],
    ];
    let chosen: [number, number, "start" | "end" | "middle", [number, number, number, number]] | null = null;
    for (const [dx, dy, anc] of tries) {
      const bx = x + dx - (anc === "end" ? tw : anc === "middle" ? tw / 2 : 0);
      const b: [number, number, number, number] = [bx, y + dy - 12, bx + tw, y + dy - 12 + th];
      if (b[0] < 4 || b[2] > this.w - 4 || b[1] < 4 || b[3] > this.h - 26) continue;
      if (this.boxes.some((q) => !(b[2] < q[0] || b[0] > q[2] || b[3] < q[1] || b[1] > q[3]))) continue;
      if (this.dots.some(([px, py]) => (px !== x || py !== y) && px > b[0] - 3 && px < b[2] + 3 && py > b[1] - 3 && py < b[3] + 3)) continue;
      chosen = [dx, dy, anc, b];
      break;
    }
    if (!chosen) {
      const b: [number, number, number, number] = [x + 10, y - 12, x + 10 + tw, y - 12 + th];
      chosen = [10, 0, "start", b];
    }
    const [dx, dy, anc, b] = chosen;
    this.boxes.push(b);
    if (Math.abs(dy) > 10) svg(g, "line", { x1: x, y1: y, x2: x + dx * 0.6, y2: y + dy - (dy > 0 ? 12 : -4), class: "rd-leader" });
    lines.forEach((l, i) => svg(g, "text", { x: x + dx, y: y + dy - 2 + i * 14, "text-anchor": anc, class: `rd-maplabel ${l.cls}` }, l.text));
  }
}

function caption(root: SVGElement, h: number, text: string): void {
  svg(root, "text", { x: 6, y: h - 8, class: "rd-maptext" }, text);
}

// ---------------------------------------------------------------- home routes
export function homeRoutesMap(parent: HTMLElement, runs: Run[], center: LatLng, radiusKm: number, placeName: string): number {
  const sel = runs.filter((r) => {
    const m = trackMid(r.track);
    return m && haversineKm(m, center) <= radiusKm;
  });
  if (!sel.length) return 0;
  const lats: number[] = [];
  const lngs: number[] = [];
  for (const r of sel) for (const p of r.track as LatLng[]) {
    lats.push(p[0]);
    lngs.push(p[1]);
  }
  lats.sort((a, b) => a - b);
  lngs.sort((a, b) => a - b);
  const q = (arr: number[], f: number) => arr[Math.floor(f * (arr.length - 1))];
  let la0 = q(lats, 0.01), la1 = q(lats, 0.99), ln0 = q(lngs, 0.01), ln1 = q(lngs, 0.99);
  const padLa = (la1 - la0) * 0.08 + 0.002;
  const padLn = (ln1 - ln0) * 0.08 + 0.002;
  la0 -= padLa; la1 += padLa; ln0 -= padLn; ln1 += padLn;
  const pr = fit(la0, ln0, la1, ln1, 760, 620, 320);
  const { root, g } = frame(parent, pr.w, pr.h, "rd-home-clip");
  for (const r of sel) svg(g, "polyline", { points: pts((r.track as LatLng[]).map(([a, b]) => pr.P(a, b))), class: "rd-route" });
  for (const r of sel) if (r.race) svg(g, "polyline", { points: pts((r.track as LatLng[]).map(([a, b]) => pr.P(a, b))), class: "rd-route-race" });
  caption(root, pr.h, `${sel.length} runs around ${placeName} · brighter = run more often`);
  return sel.length;
}

// ---------------------------------------------------------------- country
function biggestRing(c: Country): number[][] {
  let best = c.r[0];
  let bestA = 0;
  for (const ring of c.r) {
    let minx = 180, maxx = -180, miny = 90, maxy = -90;
    for (const [x, y] of ring) {
      minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    }
    const a = (maxx - minx) * (maxy - miny);
    if (a > bestA) {
      bestA = a;
      best = ring;
    }
  }
  return best;
}

export function findCountry(p: LatLng, countries: Country[]): Country | null {
  for (const c of countries) for (const ring of c.r) if (pointInRing(p[0], p[1], ring)) return c;
  // Coastal towns can fall just outside simplified outlines: fall back to the nearest border point within 60 km.
  let best: Country | null = null;
  let bestKm = 60;
  for (const c of countries)
    for (const ring of c.r)
      for (const [x, y] of ring) {
        if (Math.abs(y - p[0]) > 1 || Math.abs(x - p[1]) > 1.5) continue;
        const d = haversineKm(p, [y, x]);
        if (d < bestKm) {
          bestKm = d;
          best = c;
        }
      }
  return best;
}

/** Locates an upcoming race by finding a town of the home country whose name appears in the race name. */
function raceLocation(race: Race, places: Place[], countryName: string): Place | null {
  const name = race.name.toLowerCase();
  let best: Place | null = null;
  for (const p of places) {
    if (p[3] !== countryName && !(countryName === "United States of America" && p[3] === "United States of America")) continue;
    const pn = p[0].toLowerCase();
    if (pn.length < 4) continue;
    if (new RegExp(`(^|[^\\p{L}])${pn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u").test(name)) {
      if (!best || p[4] > best[4]) best = p;
    }
  }
  return best;
}

export function countryMap(
  parent: HTMLElement,
  runs: Run[],
  home: Country,
  countries: Country[],
  places: Place[],
  races: Race[],
  today: string,
  u: Units,
): number {
  const ring = biggestRing(home);
  let ln0 = 180, ln1 = -180, la0 = 90, la1 = -90;
  for (const [x, y] of ring) {
    ln0 = Math.min(ln0, x); ln1 = Math.max(ln1, x); la0 = Math.min(la0, y); la1 = Math.max(la1, y);
  }
  const pl = (ln1 - ln0) * 0.06;
  const pa = (la1 - la0) * 0.06;
  ln0 -= pl; ln1 += pl; la0 -= pa; la1 += pa;
  const pr = fit(la0, ln0, la1, ln1, 760, 640, 360);
  const { root, g } = frame(parent, pr.w, pr.h, "rd-country-clip");

  for (const c of countries) {
    const isHome = c === home;
    for (const r of c.r) {
      if (!r.some(([x, y]) => x >= ln0 - 5 && x <= ln1 + 5 && y >= la0 - 5 && y <= la1 + 5)) continue;
      svg(g, "polygon", { points: pts(r.map(([x, y]) => pr.P(y, x))), class: isHome ? "rd-land-home" : "rd-land" });
    }
  }
  const [cx, cy] = pr.P((la0 + la1) / 2, (ln0 + ln1) / 2);
  svg(g, "text", { x: cx, y: cy, "text-anchor": "middle", class: "rd-countryname" }, home.n.toUpperCase());

  const inBox = runs.filter((r) => {
    const m = trackMid(r.track);
    return m && m[0] >= la0 && m[0] <= la1 && m[1] >= ln0 && m[1] <= ln1;
  });
  // cluster distance scales with the map (about 4% of its width)
  const clusterKm = Math.max(15, haversineKm([la0, ln0], [la0, ln1]) * 0.04);
  type Cl = { p: LatLng; runs: Run[] };
  const clusters: Cl[] = [];
  for (const r of inBox) {
    const m = trackMid(r.track) as LatLng;
    const c = clusters.find((c) => haversineKm(c.p, m) <= clusterKm);
    if (c) c.runs.push(r);
    else clusters.push({ p: m, runs: [r] });
  }
  for (const c of clusters) {
    const [x, y] = pr.P(c.p[0], c.p[1]);
    svg(g, "circle", { cx: x, cy: y, r: 8 + 5 * Math.sqrt(c.runs.length), class: "rd-glow" });
  }
  for (const r of inBox) svg(g, "polyline", { points: pts((r.track as LatLng[]).map(([a, b]) => pr.P(a, b))), class: "rd-route-small" });

  // upcoming races
  const upcoming = races.filter((r) => r.date >= today);
  const raceSpots: { p: LatLng; label: string; dates: string[]; used: boolean }[] = [];
  for (const race of upcoming) {
    const loc = raceLocation(race, places, home.n);
    if (!loc) continue;
    const d = new Date(race.date + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short" });
    const spot = raceSpots.find((s) => s.label === loc[0]);
    if (spot) spot.dates.push(d);
    else raceSpots.push({ p: [loc[1], loc[2]], label: loc[0], dates: [d], used: false });
  }

  const dots = clusters.map((c) => pr.P(c.p[0], c.p[1])).concat(raceSpots.map((s) => pr.P(s.p[0], s.p[1])));
  const lab = new Labeller(pr.w, pr.h, dots);
  const ring2 = (x: number, y: number) => {
    svg(g, "circle", { cx: x, cy: y, r: 6, class: "rd-racering" });
    svg(g, "circle", { cx: x, cy: y, r: 11, class: "rd-racering-outer" });
  };
  for (const c of clusters.sort((a, b) => b.runs.length - a.runs.length)) {
    const [x, y] = pr.P(c.p[0], c.p[1]);
    const nearestTown = nearestPlace(c.p, places, 30);
    const n = c.runs.length;
    const nr = c.runs.filter((r) => r.race).length;
    const dist = c.runs.reduce((s, r) => s + r.distance, 0);
    const lines = [
      { text: nearestTown ? nearestTown[0] : `${c.p[0].toFixed(2)}, ${c.p[1].toFixed(2)}`, cls: "rd-label-title", size: 12 },
      { text: `${n} run${n === 1 ? "" : "s"} · ${fmtDist(dist, u, 0)} ${distUnit(u)}${nr ? ` · ${nr} race${nr === 1 ? "" : "s"}` : ""}`, cls: "rd-label-sub", size: 10.5 },
    ];
    const spot = raceSpots.find((s) => !s.used && haversineKm(s.p, c.p) <= clusterKm);
    if (spot) {
      spot.used = true;
      ring2(x, y);
      lines.push({ text: `Next: ${spot.dates.join(" · ")}`, cls: "rd-label-race", size: 10.5 });
    }
    svg(g, "circle", { cx: x, cy: y, r: 2.6, class: "rd-dot" });
    lab.place(g, x, y, lines);
  }
  for (const s of raceSpots.filter((s) => !s.used)) {
    const [x, y] = pr.P(s.p[0], s.p[1]);
    ring2(x, y);
    lab.place(g, x, y, [
      { text: s.label, cls: "rd-label-racetitle", size: 12 },
      { text: s.dates.join(" · "), cls: "rd-label-sub", size: 10.5 },
    ]);
  }
  caption(root, pr.h, `${inBox.length} runs in ${home.n} · rings mark upcoming races · outlines © Natural Earth`);
  return inBox.length;
}

// ---------------------------------------------------------------- world
export function worldMap(parent: HTMLElement, acts: Run[], world: Country[], places: Place[], u: Units): number {
  const pr = fit(-52, -180, 72, 180, 760, 420, 300);
  const { root, g } = frame(parent, pr.w, pr.h, "rd-world-clip");
  const located = acts.map((r) => ({ r, m: trackMid(r.track) })).filter((x): x is { r: Run; m: LatLng } => !!x.m);
  // Highlight only the outline pieces that actually contain activity (so overseas territories stay grey).
  const hit = new Set<string>();
  const hitRings = new Set<number[][]>();
  const countryOf = new Map<string, string>();
  for (const { r, m } of located) {
    let found: Country | null = null;
    for (const c of world) {
      const ring = c.r.find((rg) => pointInRing(m[0], m[1], rg));
      if (ring) {
        hitRings.add(ring);
        found = c;
        break;
      }
    }
    if (!found) {
      found = findCountry(m, world);
      if (found) hitRings.add(found.r.reduce((a, b) => (a.length >= b.length ? a : b)));
    }
    if (found) {
      hit.add(found.n);
      countryOf.set(r.id, found.n === "United States of America" ? "USA" : found.n);
    }
  }
  for (const c of world) for (const ring of c.r) svg(g, "polygon", { points: pts(ring.map(([x, y]) => pr.P(y, x))), class: hitRings.has(ring) ? "rd-land-visited" : "rd-land" });

  type Cl = { p: LatLng; runs: Run[] };
  const clusters: Cl[] = [];
  for (const { r, m } of located) {
    const c = clusters.find((c) => haversineKm(c.p, m) <= 800);
    if (c) c.runs.push(r);
    else clusters.push({ p: m, runs: [r] });
  }
  for (const c of clusters) {
    const [x, y] = pr.P(c.p[0], c.p[1]);
    svg(g, "circle", { cx: x, cy: y, r: 8 + 3.2 * Math.sqrt(c.runs.length), class: "rd-glow" });
  }
  const dots = clusters.map((c) => pr.P(c.p[0], c.p[1]));
  const lab = new Labeller(pr.w, pr.h, dots);
  for (const c of clusters.sort((a, b) => b.runs.length - a.runs.length)) {
    const [x, y] = pr.P(c.p[0], c.p[1]);
    svg(g, "circle", { cx: x, cy: y, r: 3, class: "rd-dot" });
    const towns = new Map<string, number>();
    const ctry = new Map<string, number>();
    for (const r of c.runs) {
      const m = trackMid(r.track) as LatLng;
      const t = nearestPlace(m, places, 40);
      if (t) towns.set(t[0], (towns.get(t[0]) || 0) + 1);
      const cn = countryOf.get(r.id);
      if (cn) ctry.set(cn, (ctry.get(cn) || 0) + 1);
    }
    const topTowns = [...towns.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const topCtry = [...ctry.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const title = topTowns.length > 1 ? topCtry.join(" · ") || topTowns[0] : [topTowns[0], topCtry[0]].filter(Boolean).join(", ") || "Unknown";
    const dist = c.runs.reduce((s, r) => s + r.distance, 0);
    lab.place(g, x, y, [
      { text: title, cls: "rd-label-title", size: 12 },
      { text: `${c.runs.length} run${c.runs.length === 1 ? "" : "s"} · ${fmtDist(dist, u, 0)} ${distUnit(u)}`, cls: "rd-label-sub", size: 10.5 },
    ]);
  }
  caption(root, pr.h, `${located.length} runs worldwide · ${hit.size} countries · outlines © Natural Earth`);
  return located.length;
}
