import {
  Place, Readiness, Run, Units, addDays, agg, daysBetween, distUnit, fmtDist, gearTotals, hms, homeCenter, longestStreak,
  monthly, mondayOf, nearestPlace, pace, parseDay, periods, readiness, weekly,
} from "../stats";
import { Race } from "../types";
import { barChart, calendarHeatmap, statCell } from "./charts";
import { el, link, stravaUrl, svg, svgRoot } from "./dom";
import { Country, countryMap, findCountry, homeRoutesMap, worldMap } from "./maps";

export interface DashboardInput {
  runs: Run[];
  races: Race[];
  targets: Map<string, string>;
  today: string;
  units: Units;
  homeRadiusKm: number;
  shoeLifeKm: number;
  places: Place[];
  world: Country[];
  countries: Country[];
  importedAt: string;
  warnings: string[];
  /** Rendered coach's note, if any (created by the Obsidian view with MarkdownRenderer). */
  coachNote?: { el: HTMLElement; updated?: string };
  /** Called by the "Edit races" link. */
  onOpenRaces?: () => void;
  /** Called by the empty-state button. */
  onOpenSettings?: () => void;
}

function section(root: HTMLElement, title: string): HTMLElement {
  el(root, "h2", "rd-h2", title);
  return root;
}

function shortDate(day: string, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }): string {
  return parseDay(day).toLocaleDateString(undefined, opts);
}

export function renderDashboard(root: HTMLElement, d: DashboardInput): void {
  while (root.firstChild) root.removeChild(root.firstChild);
  root.classList.add("rd-root");
  const u = d.units;
  const unit = distUnit(u);
  const { runs, today } = d;
  const upcoming = d.races.filter((r) => r.date >= today);

  // ---- hero
  const hero = el(root, "div", "rd-hero");
  el(hero, "div", "rd-title", "Training Dashboard");
  const sub = el(hero, "div", "rd-sub");
  if (upcoming.length) {
    sub.append("Next up: ");
    el(sub, "b", undefined, upcoming[0].name);
    sub.append(` in ${daysBetween(today, upcoming[0].date)} days`);
  } else sub.textContent = parseDay(today).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  if (!runs.length) {
    const empty = el(root, "div", "rd-card rd-empty-state");
    el(empty, "p", undefined, "No runs found yet. Point the plugin at your Strava export folder, a folder of GPX/FIT files or an activities JSON file in the settings, then run \"Running Dashboard: Import activities\".");
    if (d.onOpenSettings) {
      const b = el(empty, "button", "mod-cta", "Open settings");
      b.addEventListener("click", () => d.onOpenSettings?.());
    }
    footer(root, d);
    return;
  }

  // ---- race readiness
  const rd = readiness(runs, d.races, today, u);
  if (rd.cards.length || d.coachNote) {
    section(root, "Race readiness");
    if (d.coachNote) {
      const c = el(root, "div", "rd-coach");
      const head = el(c, "div", "rd-coach-head");
      el(head, "span", "rd-label", "Coach’s note");
      if (d.coachNote.updated) el(head, "span", "rd-small", d.coachNote.updated);
      c.appendChild(d.coachNote.el);
    }
    const inl = el(root, "div", "rd-inline");
    statCell(inl, `${fmtDist(rd.thisWeek, u)} ${unit}`, "this week so far");
    statCell(inl, `${fmtDist(rd.avg4, u)} ${unit}`, "avg of last 4 weeks");
    statCell(inl, `${fmtDist(rd.longest6, u)} ${unit}`, "longest run, last 6 weeks");
    const grid = el(root, "div", "rd-readygrid");
    for (const c of rd.cards) readinessCard(grid, c, d.targets, u);
  }

  // ---- totals
  section(root, "Totals");
  const stats = el(root, "div", "rd-stats");
  for (const p of periods(runs, today)) {
    const c = el(stats, "div", "rd-card");
    el(c, "div", "rd-label", p.label);
    const big = el(c, "div", "rd-big", fmtDist(p.agg.dist, u));
    el(big, "span", undefined, unit);
    el(big, "em", undefined, `${pace(p.agg.time, p.agg.dist, u)} /${unit} avg pace`);
    const row = el(c, "div", "rd-row");
    statCell(row, String(p.agg.n), "Runs");
    statCell(row, hms(p.agg.time, true), "Time");
    statCell(row, `${Math.round(p.agg.elev).toLocaleString()} m`, "Elev");
  }

  // ---- upcoming races
  if (upcoming.length) {
    section(root, "Upcoming races");
    const list = el(root, "div", "rd-races");
    for (const r of upcoming) {
      const item = r.link ? link(list, r.link, "", "rd-race") : el(list, "div", "rd-race");
      const cal = el(item, "div", "rd-calbadge");
      el(cal, "span", "m", parseDay(r.date).toLocaleDateString(undefined, { month: "short" }));
      el(cal, "span", "d", parseDay(r.date).getDate());
      const info = el(item, "div", "rd-race-info");
      el(info, "div", "n", r.name);
      el(info, "div", "s", [parseDay(r.date).toLocaleDateString(undefined, { weekday: "long" }), r.distanceText, r.start].filter(Boolean).join(" · "));
      const cnt = el(item, "div", "rd-count");
      el(cnt, "b", undefined, daysBetween(today, r.date));
      el(cnt, "span", undefined, "days");
    }
    if (d.onOpenRaces) {
      const note = el(root, "div", "rd-note");
      const a = el(note, "a", undefined, "Edit races");
      a.addEventListener("click", (e) => {
        e.preventDefault();
        d.onOpenRaces?.();
      });
    }
  }

  // ---- training heatmap
  section(root, "Training heatmap");
  el(root, "div", "rd-note", "Daily running distance, last 12 months. Dots mark races.");
  calendarHeatmap(el(root, "div", "rd-card rd-chart"), runs, today, u);

  // ---- weekly / monthly
  const toU = (m: number) => (u === "mi" ? m / 1609.344 : m / 1000);
  const wk = weekly(runs, today);
  section(root, "Weekly distance");
  const last4 = wk.slice(-5, -1).reduce((s, w) => s + w.dist, 0) / 4;
  const inl2 = el(root, "div", "rd-inline");
  statCell(inl2, `${fmtDist(last4, u)} ${unit}`, "avg last 4 weeks");
  statCell(inl2, `${fmtDist(Math.max(...wk.map((w) => w.dist)), u)} ${unit}`, "biggest week");
  statCell(inl2, `${fmtDist(wk[wk.length - 1].dist, u)} ${unit}`, "this week");
  barChart(
    el(root, "div", "rd-card rd-chart"),
    wk.map((w) => ({ label: w.label, value: Math.round(toU(w.dist) * 10) / 10, tip: `Week of ${w.label}: ${fmtDist(w.dist, u)} ${unit}` })),
    unit,
    { lastInProgress: true, labelEvery: 3 },
  );

  const mo = monthly(runs, today);
  section(root, "Monthly");
  barChart(
    el(root, "div", "rd-card rd-chart"),
    mo.map((m) => ({ label: m.label, value: Math.round(toU(m.agg.dist) * 10) / 10, tip: `${m.label}: ${fmtDist(m.agg.dist, u)} ${unit}` })),
    unit,
    { lastInProgress: true, height: 200 },
  );
  const tbl = table(root, ["Month", "Runs", "Distance", "Time", "Elevation", "Pace"]);
  for (const m of [...mo].reverse()) {
    row(tbl, [
      parseDay(m.key + "-01").toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      String(m.agg.n),
      `${fmtDist(m.agg.dist, u)} ${unit}`,
      hms(m.agg.time, true),
      `${Math.round(m.agg.elev)} m`,
      `${pace(m.agg.time, m.agg.dist, u)} /${unit}`,
    ]);
  }

  // ---- maps
  const center = homeCenter(runs);
  if (center) {
    section(root, "Route maps");
    const town = nearestPlace(center, d.places, 30);
    const name = town ? town[0] : "home";
    el(root, "div", "rd-note", `Around ${name}`);
    homeRoutesMap(el(root, "div", "rd-card rd-chart"), runs, center, d.homeRadiusKm, name);
    const home = findCountry(center, d.countries);
    if (home) {
      el(root, "div", "rd-note", home.n);
      countryMap(el(root, "div", "rd-card rd-chart"), runs, home, d.countries, d.places, d.races, today, u);
    }
    el(root, "div", "rd-note", "Worldwide");
    worldMap(el(root, "div", "rd-card rd-chart"), runs, d.world, d.places, u);
  }

  // ---- highlights
  section(root, "Highlights");
  const year = runs.filter((r) => r.day >= addDays(today, -364));
  const pool = year.length ? year : runs;
  const longest = pool.reduce((a, b) => (b.distance > a.distance ? b : a));
  const climb = pool.reduce((a, b) => (b.elevationGain > a.elevationGain ? b : a));
  const all = agg(pool);
  const weeksActive = new Set(pool.map((r) => mondayOf(r.day))).size;
  const hl = el(root, "div", "rd-hl");
  const hcard = (label: string, value: string, small: string) => {
    const c = el(hl, "div", "rd-card");
    el(c, "div", "rd-label", label);
    el(c, "div", "rd-mid", value);
    el(c, "div", "rd-small", small);
  };
  hcard("Longest run", `${fmtDist(longest.distance, u)} ${unit}`, `${longest.name} · ${shortDate(longest.day)}`);
  hcard("Most climbing", `${Math.round(climb.elevationGain)} m`, `${climb.name} · ${shortDate(climb.day)}`);
  hcard("Active weeks", `${weeksActive}/52`, "weeks with at least one run");
  hcard("Longest streak", `${longestStreak(pool)} days`, "consecutive days running");
  hcard("Average run", `${fmtDist(all.dist / all.n, u)} ${unit}`, `at ${pace(all.time, all.dist, u)} /${unit}`);

  // ---- race results
  const raced = runs.filter((r) => r.race && r.day <= today).reverse();
  if (raced.length) {
    section(root, "Race results");
    const t = table(root, ["Date", "Race", "Distance", "Time", "Pace"]);
    for (const r of raced.slice(0, 40)) {
      const tr = el(t, "tr");
      el(tr, "td", undefined, shortDate(r.day));
      const td = el(tr, "td");
      const url = stravaUrl(r.stravaId);
      if (url) link(td, url, r.name);
      else td.textContent = r.name;
      el(tr, "td", undefined, `${fmtDist(r.distance, u, 2)} ${unit}`);
      el(el(tr, "td"), "b", undefined, hms(r.movingTime));
      el(tr, "td", undefined, `${pace(r.movingTime, r.distance, u)} /${unit}`);
    }
  }

  // ---- shoes
  const gear = gearTotals(runs, today);
  if (gear.length) {
    section(root, "Shoes");
    const wrap = el(root, "div", "rd-shoes");
    const life = d.shoeLifeKm * 1000;
    for (const g of gear) {
      const c = el(wrap, "div", "rd-card rd-shoe");
      el(c, "div", "n", g.name);
      const bar = svgRoot(c, 200, 6, "rd-shoebar");
      bar.setAttribute("preserveAspectRatio", "none");
      bar.setAttribute("height", "6");
      svg(bar, "rect", { x: 0, y: 0, width: 200, height: 6, rx: 3, class: "rd-track" });
      svg(bar, "rect", { x: 0, y: 0, width: Math.min(200, (200 * g.total) / life), height: 6, rx: 3, class: g.total >= life * 0.8 ? "rd-warnfill" : "rd-fill" });
      const k = el(c, "div", "k", `${fmtDist(g.total, u, 0)} ${unit} `);
      el(k, "span", undefined, `of ~${fmtDist(life, u, 0)} · ${fmtDist(g.year, u, 0)} in the last 12 months`);
    }
  }

  // ---- recent activities
  section(root, "Recent activities");
  const feed = el(root, "div", "rd-feed");
  for (const r of [...runs].reverse().slice(0, 10)) {
    const url = stravaUrl(r.stravaId);
    const card = url ? link(feed, url, "", "rd-card rd-act") : el(feed, "div", "rd-card rd-act");
    const head = el(card, "div", "rd-act-head");
    const n = el(head, "div", "n", r.name);
    if (r.race) el(n, "span", "rd-tag", "Race");
    el(head, "div", "s", `${parseDay(r.day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} · ${r.start.slice(11, 16)}`);
    const rw = el(card, "div", "rd-row");
    statCell(rw, `${fmtDist(r.distance, u, 2)} ${unit}`, "Distance");
    statCell(rw, `${pace(r.movingTime, r.distance, u)} /${unit}`, "Pace");
    statCell(rw, hms(r.movingTime), "Time");
    statCell(rw, `${Math.round(r.elevationGain)} m`, "Elev");
  }

  footer(root, d);
}

function readinessCard(grid: HTMLElement, c: Readiness, targets: Map<string, string>, u: Units): void {
  const card = el(grid, "div", "rd-card rd-ready");
  const head = el(card, "div", "rd-ready-head");
  const left = el(head, "div");
  el(left, "div", "rd-label rd-strong", c.race.name);
  el(left, "div", "rd-small", [parseDay(c.race.date).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" }), c.race.distanceText].filter(Boolean).join(" · "));
  const cnt = el(head, "div", "rd-count");
  el(cnt, "b", undefined, c.days);
  el(cnt, "span", undefined, "days");
  const ph = el(card, "div", "rd-phase");
  el(ph, "span", undefined, c.phase);
  ph.append(c.hint);

  const pred = el(card, "div", "rd-pred");
  const target = targets.get(c.race.name.toLowerCase());
  const est = c.estimate ? `${hms(c.estimate.sec)} (from ${c.estimate.from.name}, ${hms(c.estimate.from.movingTime)})` : "";
  if (target) {
    el(pred, "div", "rd-label", "Target");
    el(pred, "div", "rd-mid", target);
    el(pred, "div", "rd-small", `from the coach’s note${est ? ` · formula estimate ${est}` : ""}`);
  } else {
    el(pred, "div", "rd-label", "Formula estimate");
    el(pred, "div", "rd-mid", c.estimate ? hms(c.estimate.sec) : "–");
    el(pred, "div", "rd-small", c.estimate ? `from ${c.estimate.from.name} (${hms(c.estimate.from.movingTime)}) · Riegel formula` : "no race in the last 4 months to estimate from");
  }
  if (c.lowVolume && c.estimate) el(pred, "div", "rd-small rd-warntext", "Formula estimate is likely optimistic at your current volume.");
  if (c.best) el(pred, "div", "rd-small", `Your best at this distance: ${hms(c.best.movingTime)} · ${c.best.name}, ${shortDate(c.best.day, { month: "short", year: "numeric" })}`);

  for (const ch of c.checks) {
    const row = el(card, "div", `rd-chk ${ch.ok ? "ok" : "warn"}`);
    el(row, "i", undefined, ch.ok ? "✓" : "!");
    const t = el(row, "div");
    el(t, "b", undefined, ch.title);
    el(t, "span", undefined, ch.sub);
  }
  void u;
}

function table(root: HTMLElement, heads: string[]): HTMLTableSectionElement {
  const t = el(root, "table", "rd-table");
  const hr = el(el(t, "thead"), "tr");
  for (const h of heads) el(hr, "th", undefined, h);
  return el(t, "tbody");
}

function row(tb: HTMLTableSectionElement, cells: string[]): void {
  const tr = el(tb, "tr");
  for (const c of cells) el(tr, "td", undefined, c);
}

function footer(root: HTMLElement, d: DashboardInput): void {
  const f = el(root, "div", "rd-foot");
  const when = d.importedAt ? new Date(d.importedAt).toLocaleString() : "never";
  el(f, "div", undefined, `Last import: ${when} · ${d.runs.length} runs`);
  if (d.warnings.length) {
    const det = el(f, "details");
    el(det, "summary", undefined, `${d.warnings.length} import warning${d.warnings.length === 1 ? "" : "s"}`);
    const ul = el(det, "ul");
    for (const w of d.warnings.slice(0, 50)) el(ul, "li", undefined, w);
  }
}
