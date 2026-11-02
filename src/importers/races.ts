import { Race } from "../types";

/** Only http(s) links are kept, so a crafted note cannot produce javascript: or file: links. */
export function safeUrl(s: string): string {
  const t = (s || "").trim();
  if (!/^https?:\/\//i.test(t)) return "";
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

/** Parses markdown table rows whose first cell is a YYYY-MM-DD date. */
export function parseRaces(markdown: string): Race[] {
  const races: Race[] = [];
  for (const line of markdown.split("\n").slice(0, 2000)) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0] || "")) continue;
    const d = new Date(cells[0] + "T00:00:00");
    if (isNaN(d.getTime())) continue;
    races.push({
      date: cells[0],
      name: (cells[1] || "Race").slice(0, 120),
      distanceText: (cells[2] || "").slice(0, 40),
      start: (cells[3] || "").slice(0, 20),
      link: safeUrl(cells[4] || ""),
    });
  }
  return races.sort((a, b) => a.date.localeCompare(b.date));
}

/** Reads "Target: Race name = value" lines from the coach's note. Keys are lower-cased race names. */
export function parseTargets(markdown: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of markdown.split("\n").slice(0, 500)) {
    if (line.length > 300) continue;
    const r = /^\s*target:([^=]{1,150})=(.{1,80})$/i.exec(line);
    if (r && r[1].trim() && r[2].trim()) m.set(r[1].trim().toLowerCase(), r[2].trim());
  }
  return m;
}

/** Removes the Target: lines so they are not shown in the rendered note. */
export function stripTargets(markdown: string): string {
  return markdown
    .split("\n")
    .filter((l) => !/^\s{0,20}target:/i.test(l))
    .join("\n");
}

export const RACES_TEMPLATE = `# Races

Upcoming races for the Running Dashboard. One row per race; the date must be YYYY-MM-DD.
Past races stay in the list and are used to mark those activities as races.

| Date       | Race               | Distance | Start | Link |
| ---------- | ------------------ | -------- | ----- | ---- |
| 2026-12-06 | Example Marathon   | 42.2 km  | 08:15 |      |
`;
