/** A single activity, normalised from any supported source. */
export interface Activity {
  /** Stable id: Strava activity id when known, otherwise a hash of source path + start time. */
  id: string;
  name: string;
  /** Normalised sport, e.g. "Run", "Walk", "Ride", "Hike", "Workout". */
  type: string;
  /** Local start time as "YYYY-MM-DDTHH:mm:ss" (no timezone). */
  start: string;
  /** Metres. */
  distance: number;
  /** Seconds. */
  movingTime: number;
  /** Seconds. */
  elapsedTime: number;
  /** Metres. */
  elevationGain: number;
  /** Shoe or bike name, if known. */
  gear?: string;
  /** Simplified track as [lat, lng] pairs (at most a few hundred points). */
  track?: [number, number][];
  /** Where the data came from. */
  source: "strava-export" | "file" | "json";
  /** Strava activity id, only when the data came from Strava. Digits only. */
  stravaId?: string;
}

export interface Race {
  date: string; // YYYY-MM-DD
  name: string;
  distanceText: string;
  start: string;
  link: string;
}

export interface DataCache {
  version: number;
  importedAt: string;
  activities: Activity[];
  /** Per-file modification time, used to skip unchanged files on re-import. */
  fileMtimes: Record<string, number>;
  warnings: string[];
}

export const CACHE_VERSION = 1;
