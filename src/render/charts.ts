import { Run, Units, addDays, dailyDistance, distUnit, fmtDist, mondayOf, parseDay } from "../stats";
import { el, svg, svgRoot, tip } from "./dom";

/** GitHub-style calendar of daily running distance for the last 12 months. */
export function calendarHeatmap(parent: HTMLElement, runs: Run[], today: string, u: Units): void {
  const daily = dailyDistance(runs);
  const raceDays = new Set(runs.filter((r) => r.race).map((r) => r.day));
  const start = mondayOf(addDays(today, -364));
  const weeks = Math.floor((parseDay(today).getTime() - parseDay(start).getTime()) / (7 * 86400000)) + 1;
  const cell = 13;
  const gap = 3;
  const left = 34;
  const top = 22;
  const w = left + weeks * (cell + gap) + 6;
  const h = top + 7 * (cell + gap) + 34;
  const root = svgRoot(parent, w, h, "rd-cal");
  const unit = distUnit(u);
  // thresholds in km: <6, 6–10, 10–13, 13–17, 17+
  const level = (m: number) => (m <= 0 ? -1 : m < 6000 ? 0 : m < 10000 ? 1 : m < 13000 ? 2 : m < 17000 ? 3 : 4);

  [
    [0, "Mon"],
    [2, "Wed"],
    [4, "Fri"],
    [6, "Sun"],
  ].forEach(([i, lab]) => svg(root, "text", { x: left - 6, y: top + Number(i) * (cell + gap) + 10, class: "rd-axis", "text-anchor": "end" }, String(lab)));

  let lastMonth = -1;
  for (let wk = 0; wk < weeks; wk++) {
    const ws = addDays(start, wk * 7);
    const sunday = parseDay(addDays(ws, 6));
    if (sunday.getMonth() !== lastMonth && sunday.getDate() <= 7 && wk < weeks - 2) {
      svg(root, "text", { x: left + wk * (cell + gap), y: top - 8, class: "rd-axis" }, sunday.toLocaleDateString(undefined, { month: "short" }));
      lastMonth = sunday.getMonth();
    }
    for (let d = 0; d < 7; d++) {
      const day = addDays(ws, d);
      if (day > today) continue;
      const m = daily.get(day) || 0;
      const x = left + wk * (cell + gap);
      const y = top + d * (cell + gap);
      const lv = level(m);
      const r = svg(root, "rect", { x, y, width: cell, height: cell, rx: 2.5, class: lv < 0 ? "rd-empty" : `rd-l${lv}` });
      tip(r, `${parseDay(day).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}: ${fmtDist(m, u)} ${unit}`);
      if (raceDays.has(day)) svg(root, "circle", { cx: x + cell / 2, cy: y + cell / 2, r: 2.6, class: "rd-racedot" });
    }
  }
  // legend
  const ly = top + 7 * (cell + gap) + 12;
  let lx = left;
  svg(root, "text", { x: lx, y: ly + 10, class: "rd-axis" }, `0 ${unit}`);
  lx += 34;
  const labels = u === "mi" ? ["<4", "4–6", "6–8", "8–11", "11+"] : ["<6", "6–10", "10–13", "13–17", "17+"];
  svg(root, "rect", { x: lx, y: ly, width: cell, height: cell, rx: 2.5, class: "rd-empty" });
  lx += cell + 8;
  labels.forEach((lab, i) => {
    svg(root, "rect", { x: lx, y: ly, width: cell, height: cell, rx: 2.5, class: `rd-l${i}` });
    svg(root, "text", { x: lx + cell + 3, y: ly + 10, class: "rd-axis" }, lab);
    lx += cell + 3 + lab.length * 7 + 8;
  });
  lx += 8;
  svg(root, "rect", { x: lx, y: ly, width: cell, height: cell, rx: 2.5, class: "rd-l3" });
  svg(root, "circle", { cx: lx + cell / 2, cy: ly + cell / 2, r: 2.6, class: "rd-racedot" });
  svg(root, "text", { x: lx + cell + 4, y: ly + 10, class: "rd-axis" }, "race");
}

/** Simple bar chart; the last bar is drawn lighter when it is still in progress. */
export function barChart(
  parent: HTMLElement,
  items: { label: string; value: number; tip: string }[],
  unitLabel: string,
  opts: { lastInProgress?: boolean; labelEvery?: number; height?: number } = {},
): void {
  const w = 760;
  const h = opts.height ?? 220;
  const left = 36;
  const right = 10;
  const top = 14;
  const bottom = 34;
  const pw = w - left - right;
  const ph = h - top - bottom;
  const vmax = Math.max(1, ...items.map((i) => i.value));
  const step = vmax <= 60 ? 10 : vmax <= 140 ? 20 : vmax <= 300 ? 50 : 100;
  const ymax = Math.ceil(vmax / step) * step;
  const root = svgRoot(parent, w, h, "rd-bars");
  for (let t = 0; t <= ymax; t += step) {
    const y = top + ph - (ph * t) / ymax;
    svg(root, "line", { x1: left, x2: w - right, y1: y, y2: y, class: "rd-grid" });
    svg(root, "text", { x: left - 6, y: y + 3, class: "rd-axis", "text-anchor": "end" }, String(t));
  }
  const bw = pw / items.length;
  const every = opts.labelEvery ?? 1;
  items.forEach((it, i) => {
    const bh = (ph * it.value) / ymax;
    if (it.value > 0) {
      const r = svg(root, "rect", {
        x: left + i * bw + bw * 0.18,
        y: top + ph - bh,
        width: bw * 0.64,
        height: bh,
        rx: 2,
        class: opts.lastInProgress && i === items.length - 1 ? "rd-bar rd-bar-partial" : "rd-bar",
      });
      tip(r, it.tip);
    }
    if (i % every === 0) svg(root, "text", { x: left + i * bw + bw / 2, y: h - bottom + 15, class: "rd-axis", "text-anchor": "middle" }, it.label);
  });
  svg(root, "text", { x: left, y: h - 4, class: "rd-axis" }, unitLabel);
}

export function statCell(parent: HTMLElement, value: string, label: string): void {
  const d = el(parent, "div");
  el(d, "b", undefined, value);
  el(d, "span", undefined, label);
}
