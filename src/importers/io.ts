/** The small slice of file access the importers need. Implemented with Obsidian's adapter in main.ts and with Node in tests. */
export interface FileIO {
  /** Recursively lists files under a folder (vault-relative paths). */
  listFiles(folder: string, maxFiles: number): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ mtime: number; size: number } | null>;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
}

/**
 * Joins a folder and a relative path from inside a data file (e.g. the "Filename" column of a Strava CSV)
 * and guarantees the result stays inside that folder. Returns null for anything suspicious.
 */
export function safeJoin(folder: string, rel: string): string | null {
  if (!rel || rel.length > 512) return null;
  if (rel.includes("\0") || rel.startsWith("/") || rel.startsWith("\\") || /^[a-zA-Z]:/.test(rel)) return null;
  const parts: string[] = [];
  for (const p of rel.replace(/\\/g, "/").split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") return null;
    parts.push(p);
  }
  if (!parts.length) return null;
  return (folder ? folder.replace(/\/+$/, "") + "/" : "") + parts.join("/");
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Formats a timestamp as a local "YYYY-MM-DDTHH:mm:ss" string (the user's device timezone). */
export function toLocalIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Short, stable, non-cryptographic hash used for ids of file-based activities. */
export function hashId(s: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(36);
}
