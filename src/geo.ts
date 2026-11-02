export type LatLng = [number, number];

const RAD = Math.PI / 180;

export function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** Web Mercator in radians (x, y). Latitude is clamped to avoid infinity at the poles. */
export function mercator(lat: number, lng: number): [number, number] {
  const la = Math.max(Math.min(lat, 85), -85);
  return [lng * RAD, Math.log(Math.tan(Math.PI / 4 + (la * RAD) / 2))];
}

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b[0] - a[0]) * RAD;
  const dLng = (b[1] - a[1]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Ramer–Douglas–Peucker simplification (iterative, so long tracks cannot overflow the stack). */
export function simplify(points: LatLng[], toleranceDeg: number, maxPoints = 400): LatLng[] {
  if (points.length <= 2) return points.slice();
  let tol = toleranceDeg;
  for (let attempt = 0; attempt < 8; attempt++) {
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop() as [number, number];
      let maxD = 0;
      let idx = -1;
      const [ay, ax] = points[s];
      const [by, bx] = points[e];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      for (let i = s + 1; i < e; i++) {
        const [py, px] = points[i];
        let d: number;
        if (len2 === 0) d = Math.hypot(px - ax, py - ay);
        else {
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
          d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        }
        if (d > maxD) {
          maxD = d;
          idx = i;
        }
      }
      if (idx > 0 && maxD > tol) {
        keep[idx] = 1;
        stack.push([s, idx], [idx, e]);
      }
    }
    const out: LatLng[] = [];
    for (let i = 0; i < points.length; i++) if (keep[i]) out.push([round5(points[i][0]), round5(points[i][1])]);
    if (out.length <= maxPoints) return out;
    tol *= 2;
  }
  // Fallback: even sampling.
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0).map((p) => [round5(p[0]), round5(p[1])] as LatLng);
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/** Decodes a Google encoded polyline (as used by the Strava API). Bounded to avoid runaway loops on bad input. */
export function decodePolyline(str: string, maxPoints = 20000): LatLng[] {
  const pts: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const n = str.length;
  while (i < n && pts.length < maxPoints) {
    const vals: number[] = [];
    for (let k = 0; k < 2; k++) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        if (i >= n) return pts;
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && shift < 35);
      vals.push(result & 1 ? ~(result >> 1) : result >> 1);
    }
    lat += vals[0];
    lng += vals[1];
    const p: LatLng = [lat / 1e5, lng / 1e5];
    if (isValidLatLng(p[0], p[1])) pts.push(p);
  }
  return pts;
}

/** Ray casting point-in-polygon. Ring is [lng, lat] pairs. */
export function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Midpoint of a track (by index), used as an activity's location. */
export function trackMid(track?: LatLng[]): LatLng | null {
  if (!track || !track.length) return null;
  return track[Math.floor(track.length / 2)];
}
