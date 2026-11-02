import { ParsedTrack, TrackPoint } from "./track";

/**
 * Minimal, dependency-free FIT decoder. It reads only what the dashboard needs:
 * record messages (position, time, altitude) and session messages (sport, totals).
 * Every read is bounds-checked; malformed files throw instead of reading past the buffer.
 */

const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z
const SEMI = 180 / 2 ** 31;
const MAX_POINTS = 500000;
const MAX_MESSAGES = 2000000;

interface FieldDef {
  num: number;
  size: number;
  base: number;
}
interface MsgDef {
  msgNum: number;
  little: boolean;
  fields: FieldDef[];
  devBytes: number;
}

const SPORTS: Record<number, string> = { 1: "Run", 2: "Ride", 5: "Swim", 11: "Walk", 17: "Hike" };

function baseSize(base: number): number {
  switch (base & 0x1f) {
    case 0x00: case 0x01: case 0x02: case 0x07: case 0x0a: case 0x0d: return 1;
    case 0x03: case 0x04: case 0x0b: return 2;
    case 0x05: case 0x06: case 0x08: case 0x0c: return 4;
    case 0x09: case 0x0e: case 0x0f: case 0x10: return 8;
    default: return 1;
  }
}

/** Reads one numeric field; returns NaN for FIT "invalid" sentinel values or unsupported types. */
function readField(view: DataView, off: number, f: FieldDef, little: boolean): number {
  const bs = baseSize(f.base);
  if (f.size < bs) return NaN;
  switch (f.base & 0x1f) {
    case 0x00: case 0x02: case 0x0a: case 0x0d: {
      const v = view.getUint8(off);
      return v === 0xff ? NaN : v;
    }
    case 0x01: {
      const v = view.getInt8(off);
      return v === 0x7f ? NaN : v;
    }
    case 0x03: {
      const v = view.getInt16(off, little);
      return v === 0x7fff ? NaN : v;
    }
    case 0x04: case 0x0b: {
      const v = view.getUint16(off, little);
      return v === 0xffff ? NaN : v;
    }
    case 0x05: {
      const v = view.getInt32(off, little);
      return v === 0x7fffffff ? NaN : v;
    }
    case 0x06: case 0x0c: {
      const v = view.getUint32(off, little);
      return v === 0xffffffff ? NaN : v;
    }
    case 0x08: {
      const v = view.getFloat32(off, little);
      return Number.isFinite(v) ? v : NaN;
    }
    case 0x09: {
      const v = view.getFloat64(off, little);
      return Number.isFinite(v) ? v : NaN;
    }
    default:
      return NaN;
  }
}

export function parseFit(buf: Uint8Array): ParsedTrack {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 14) throw new Error("FIT file too short");
  const headerSize = view.getUint8(0);
  if (headerSize !== 12 && headerSize !== 14) throw new Error("not a FIT file");
  if (String.fromCharCode(buf[8], buf[9], buf[10], buf[11]) !== ".FIT") throw new Error("not a FIT file");
  const dataSize = view.getUint32(4, true);
  const end = Math.min(buf.length, headerSize + dataSize);

  const defs = new Map<number, MsgDef>();
  const points: TrackPoint[] = [];
  const out: ParsedTrack = { points };
  let pos = headerSize;
  let lastTs = NaN;
  let messages = 0;

  const need = (n: number) => {
    if (pos + n > end) throw new Error("truncated FIT file");
  };

  while (pos < end && messages++ < MAX_MESSAGES) {
    need(1);
    const hdr = view.getUint8(pos++);
    let local: number;
    let compressedOffset = -1;
    if (hdr & 0x80) {
      local = (hdr >> 5) & 0x03;
      compressedOffset = hdr & 0x1f;
    } else {
      local = hdr & 0x0f;
      if (hdr & 0x40) {
        // Definition message
        need(5);
        const little = view.getUint8(pos + 1) === 0;
        const msgNum = view.getUint16(pos + 2, little);
        const nFields = view.getUint8(pos + 4);
        pos += 5;
        need(nFields * 3);
        const fields: FieldDef[] = [];
        for (let i = 0; i < nFields; i++) {
          fields.push({ num: view.getUint8(pos), size: view.getUint8(pos + 1), base: view.getUint8(pos + 2) });
          pos += 3;
        }
        let devBytes = 0;
        if (hdr & 0x20) {
          need(1);
          const nDev = view.getUint8(pos++);
          need(nDev * 3);
          for (let i = 0; i < nDev; i++) {
            devBytes += view.getUint8(pos + 1);
            pos += 3;
          }
        }
        defs.set(local, { msgNum, little, fields, devBytes });
        continue;
      }
    }

    const def = defs.get(local);
    if (!def) throw new Error("FIT data message without definition");
    const total = def.fields.reduce((s, f) => s + f.size, 0) + def.devBytes;
    need(total);
    const vals = new Map<number, number>();
    let off = pos;
    for (const f of def.fields) {
      vals.set(f.num, readField(view, off, f, def.little));
      off += f.size;
    }
    pos += total;

    if (vals.has(253) && Number.isFinite(vals.get(253))) lastTs = vals.get(253) as number;
    else if (compressedOffset >= 0 && Number.isFinite(lastTs)) {
      const lo = lastTs & 0x1f;
      lastTs = compressedOffset >= lo ? lastTs - lo + compressedOffset : lastTs - lo + compressedOffset + 0x20;
    }
    const tMs = Number.isFinite(lastTs) ? (lastTs + FIT_EPOCH_S) * 1000 : NaN;

    if (def.msgNum === 20 && points.length < MAX_POINTS) {
      const la = vals.get(0);
      const ln = vals.get(1);
      if (la !== undefined && ln !== undefined && Number.isFinite(la) && Number.isFinite(ln)) {
        const lat = la * SEMI;
        const lng = ln * SEMI;
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          const enh = vals.get(78);
          const alt = vals.get(2);
          const ele = enh !== undefined && Number.isFinite(enh) ? enh / 5 - 500 : alt !== undefined && Number.isFinite(alt) ? alt / 5 - 500 : NaN;
          points.push({ lat, lng, t: tMs, ele });
        }
      }
    } else if (def.msgNum === 18) {
      const sport = vals.get(5);
      if (sport !== undefined && SPORTS[sport]) out.type = SPORTS[sport];
      const st = vals.get(2);
      if (st !== undefined && Number.isFinite(st)) out.startMs = (st + FIT_EPOCH_S) * 1000;
      const el = vals.get(7);
      if (el !== undefined && Number.isFinite(el)) out.elapsed = (out.elapsed ?? 0) + el / 1000;
      const mv = vals.get(8);
      if (mv !== undefined && Number.isFinite(mv)) out.moving = (out.moving ?? 0) + mv / 1000;
      const di = vals.get(9);
      if (di !== undefined && Number.isFinite(di)) out.distance = (out.distance ?? 0) + di / 100;
      const as = vals.get(22);
      if (as !== undefined && Number.isFinite(as)) out.ascent = (out.ascent ?? 0) + as;
    }
  }
  return out;
}
