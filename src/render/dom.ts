/**
 * Tiny DOM helpers. All text goes through textContent / setAttribute, never innerHTML,
 * so activity names, race names and notes from files can never inject markup or scripts.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

export function el<K extends keyof HTMLElementTagNameMap>(
  parent: Element | null,
  tag: K,
  cls?: string,
  text?: string | number,
): HTMLElementTagNameMap[K] {
  const e = createEl(tag, { cls, text: text === undefined ? undefined : String(text) });
  if (parent) parent.appendChild(e);
  return e;
}

export function svg(parent: Element | null, tag: string, attrs: Record<string, string | number> = {}, text?: string): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function svgRoot(parent: Element, w: number, h: number, cls: string): SVGElement {
  return svg(parent, "svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", class: cls, role: "img" });
}

/** Adds a native tooltip to an SVG element. */
export function tip(e: SVGElement, text: string): void {
  svg(e, "title", {}, text);
}

/** External link that opens in the browser; only http(s) URLs are ever passed in. */
export function link(parent: Element, href: string, text: string, cls?: string): HTMLAnchorElement {
  const a = el(parent, "a", cls, text);
  if (/^https?:\/\//i.test(href)) {
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  return a;
}

export function stravaUrl(id?: string): string {
  return id && /^\d{1,20}$/.test(id) ? `https://www.strava.com/activities/${id}` : "";
}

export function pts(points: [number, number][]): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}
