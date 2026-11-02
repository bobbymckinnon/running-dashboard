import { LatLng, haversineKm, trackMid } from "./geo";
import { pad } from "./importers/io";
import { Activity, Race } from "./types";

export type Units = "km" | "mi";
const MI = 1609.344;

export interface Run extends Activity {
  day: string; // YYYY-MM-DD
  race: boolean;
}

// ---------- dates ----------
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, n: number): string {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function mondayOf(s: string): string {
  const d = parseDay(s);
  const wd = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wd);
  return ymd(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
}

// ---------- formatting ----------
export function fmtDist(m: number, u: Units, digits = 1): string {
  const v = u === "mi" ? m / MI : m / 1000;
  return `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
export function distUnit(u: Units): string {
  return u === "mi" ? "mi" : "km";
}
export function hms(sec: number, short = false): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (short) return h ? `${h}h ${pad(m)}m` : `${m}m`;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}
export function pace(sec: number, m: number, u: Units): string {
  if (!m) return "–";
  const per = sec / (u === "mi" ? m / MI : m / 1000);
  return `${Math.floor(per / 60)}:${pad(Math.floor(per % 60))}`;
}

// ---------- runs ----------
const RUN_TYPES = new Set(["Run"]);

export function buildRuns(acts: Activity[], races: Race[], keywords: string): Run[] {
  const words = (typeof keywords === "string" ? keywords : "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 2 && w.length <= 30)
    .slice(0, 50)
    .map((w) => new RegExp(`(^|[^a-z0-9])${escapeRe(w)}`, "i"));
  const raceDays = new Set(races.map((r) => r.date));
  const notRace = /(shake ?out|recovery|warm ?up|cool ?down)/i;
  return acts
    .filter((a) => RUN_TYPES.has(a.type) && a.distance > 0)
    .map((a) => {
      const day = a.start.slice(0, 10);
      const lower = a.name.toLowerCase();
      const byWord = words.some((re) => re.test(lower));
      const race = (raceDays.has(day) && a.distance >= 3000) || (byWord && !notRace.test(a.name));
      return { ...a, day, race };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface Agg {
  n: number;
  dist: number;
  time: number;
  elev: number;
}
export function agg(rs: Run[]): Agg {
  return rs.reduce((s, r) => ({ n: s.n + 1, dist: s.dist + r.distance, time: s.time + r.movingTime, elev: s.elev + r.elevationGain }), {
    n: 0,
    dist: 0,
    time: 0,
    elev: 0,
  });
}

export function periods(runs: Run[], today: string): { label: string; agg: Agg }[] {
  const yr = today.slice(0, 4);
  const from = (start: string) => agg(runs.filter((r) => r.day >= start && r.day <= today));
  return [
    { label: "This week", agg: from(mondayOf(today)) },
    { label: "This month", agg: from(today.slice(0, 8) + "01") },
    { label: `${yr} so far`, agg: from(`${yr}-01-01`) },
    { label: "Last 12 months", agg: from(addDays(today, -364)) },
  ];
}

export function weekly(runs: Run[], today: string, weeks = 26): { label: string; start: string; dist: number }[] {
  const out: { label: string; start: string; dist: number }[] = [];
  const thisMon = mondayOf(today);
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(thisMon, -7 * i);
    const end = addDays(start, 6);
    const dist = runs.filter((r) => r.day >= start && r.day <= end).reduce((s, r) => s + r.distance, 0);
    const d = parseDay(start);
    out.push({ label: d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }), start, dist });
  }
  return out;
}

export function monthly(runs: Run[], today: string): { label: string; key: string; agg: Agg }[] {
  const out: { label: string; key: string; agg: Agg }[] = [];
  const t = parseDay(today);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    out.push({ label: d.toLocaleDateString(undefined, { month: "short" }), key, agg: agg(runs.filter((r) => r.day.startsWith(key))) });
  }
  return out;
}

export function dailyDistance(runs: Run[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of runs) m.set(r.day, (m.get(r.day) || 0) + r.distance);
  return m;
}

export function longestStreak(runs: Run[]): number {
  const days = [...new Set(runs.map((r) => r.day))].sort();
  let best = 0;
  let cur = 0;
  let prev = "";
  for (const d of days) {
    cur = prev && addDays(prev, 1) === d ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

// ---------- races & readiness ----------
export function raceKm(text: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(text || "");
  if (!m) {
    if (/half|semi|mitja|media/i.test(text)) return 21.1;
    if (/marat/i.test(text)) return 42.2;
    return null;
  }
  return Number(m[1].replace(",", "."));
}

/** Riegel's formula: T2 = T1 × (D2 / D1)^1.06. A rough estimate, not a measurement. */
export function riegel(sec: number, fromM: number, toM: number): number {
  return sec * Math.pow(toM / fromM, 1.06);
}

export interface Readiness {
  race: Race;
  days: number;
  km: number;
  phase: string;
  hint: string;
  estimate: { sec: number; from: Run } | null;
  best: Run | null;
  lowVolume: boolean;
  checks: { ok: boolean; title: string; sub: string }[];
}

export function phaseFor(days: number, km: number): [string, string] {
  if (days <= 7) return ["Taper", "Race week: short easy runs and strides, rest well"];
  if (km >= 40) {
    if (days <= 21) return ["Taper", "Volume coming down, keep some marathon-pace work"];
    if (days <= 42) return ["Peak", "Longest runs of the block happen now"];
    return ["Build", "Grow weekly volume and the long run"];
  }
  if (days <= 14) return ["Sharpen", "One race-pace session, otherwise easy"];
  return ["Build", "Consistent weeks, one quality session"];
}

export function readiness(runs: Run[], races: Race[], today: string, u: Units): { cards: Readiness[]; avg4: number; thisWeek: number; longest6: number } {
  const thisMon = mondayOf(today);
  const weekDist = (start: string) => runs.filter((r) => r.day >= start && r.day <= addDays(start, 6)).reduce((s, r) => s + r.distance, 0);
  const avg4 = [1, 2, 3, 4].reduce((s, i) => s + weekDist(addDays(thisMon, -7 * i)), 0) / 4;
  const thisWeek = weekDist(thisMon);
  const six = runs.filter((r) => daysBetween(r.day, today) <= 42 && r.day <= today);
  const longest6 = six.reduce((m, r) => Math.max(m, r.distance), 0);
  const longTraining = six.filter((r) => !r.race).reduce((m, r) => Math.max(m, r.distance), 0);

  const up = races.filter((r) => r.date >= today);
  const pick = up.slice(0, 2);
  const mara = up.find((r) => (raceKm(r.distanceText) || 0) >= 40 && daysBetween(today, r.date) <= 70);
  if (mara && !pick.includes(mara)) pick.push(mara);

  const recentRaces = runs.filter((r) => r.race && r.distance >= 5000 && daysBetween(r.day, today) <= 120 && r.day <= today);
  const cards = pick.map((race): Readiness => {
    const km = raceKm(race.distanceText) || 21.1;
    const days = daysBetween(today, race.date);
    const [phase, hint] = phaseFor(days, km);
    let estimate: Readiness["estimate"] = null;
    for (const r of recentRaces) {
      const sec = riegel(r.movingTime, r.distance, km * 1000);
      if (!estimate || sec < estimate.sec) estimate = { sec, from: r };
    }
    const same = runs.filter((r) => r.race && Math.abs(r.distance / 1000 - km) <= Math.max(0.6, km * 0.04));
    const best = same.length ? same.reduce((a, b) => (a.movingTime / a.distance <= b.movingTime / b.distance ? a : b)) : null;
    const [needWk, needLong] = km >= 40 ? [45, 28] : km >= 20 ? [30, 16] : [20, 10];
    const toU = (m: number) => (u === "mi" ? m / MI : m / 1000);
    const conv = (k: number) => (u === "mi" ? k / 1.609344 : k);
    const unit = distUnit(u);
    const checks = [
      { ok: avg4 / 1000 >= needWk, title: `Weekly volume ${toU(avg4).toFixed(0)} ${unit}`, sub: `avg of last 4 weeks · target ≥${conv(needWk).toFixed(0)} ${unit}` },
      { ok: longTraining / 1000 >= needLong, title: `Longest training run ${toU(longTraining).toFixed(1)} ${unit}`, sub: `last 6 weeks · target ≥${conv(needLong).toFixed(0)} ${unit}` },
      { ok: six.length / 6 >= 3, title: `${(six.length / 6).toFixed(1)} runs/week`, sub: "last 6 weeks · target ≥3" },
    ];
    return { race, days, km, phase, hint, estimate, best, lowVolume: !checks[0].ok || !checks[1].ok, checks };
  });
  return { cards, avg4, thisWeek, longest6 };
}

// ---------- gear ----------
export function gearTotals(runs: Run[], today: string): { name: string; total: number; year: number }[] {
  const m = new Map<string, { total: number; year: number }>();
  const from = addDays(today, -364);
  for (const r of runs) {
    if (!r.gear) continue;
    const g = m.get(r.gear) || { total: 0, year: 0 };
    g.total += r.distance;
    if (r.day >= from) g.year += r.distance;
    m.set(r.gear, g);
  }
  return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);
}

// ---------- places ----------
export type Place = [string, number, number, string, number]; // name, lat, lng, country, population

/** Finds the most-run area: the 0.05° grid cell with most activity midpoints, refined to their median. */
export function homeCenter(runs: Run[]): LatLng | null {
  const cells = new Map<string, LatLng[]>();
  for (const r of runs) {
    const m = trackMid(r.track);
    if (!m) continue;
    const k = `${Math.round(m[0] / 0.05)},${Math.round(m[1] / 0.05)}`;
    const arr = cells.get(k) || [];
    arr.push(m);
    cells.set(k, arr);
  }
  let best: LatLng[] = [];
  for (const v of cells.values()) if (v.length > best.length) best = v;
  if (!best.length) return null;
  const lat = best.map((p) => p[0]).sort((a, b) => a - b)[Math.floor(best.length / 2)];
  const lng = best.map((p) => p[1]).sort((a, b) => a - b)[Math.floor(best.length / 2)];
  return [lat, lng];
}

/** Nearest known town within maxKm (Natural Earth populated places). */
export function nearestPlace(p: LatLng, places: Place[], maxKm = 25): Place | null {
  let best: Place | null = null;
  let bestScore = Infinity;
  for (const pl of places) {
    if (Math.abs(pl[1] - p[0]) > 0.5 || Math.abs(pl[2] - p[1]) > 0.7) continue;
    const d = haversineKm(p, [pl[1], pl[2]]);
    if (d > maxKm) continue;
    // Prefer bigger towns slightly, so suburbs get named after their city.
    const score = d - Math.log10(Math.max(pl[4], 1000)) * 1.5;
    if (score < bestScore) {
      bestScore = score;
      best = pl;
    }
  }
  return best;
}
