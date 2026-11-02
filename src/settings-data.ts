export interface RunningDashboardSettings {
  /** Vault folder containing an unzipped Strava bulk export (with activities.csv). */
  stravaExportFolder: string;
  /** Vault folder containing loose .gpx / .tcx / .fit files (optionally .gz). */
  activityFilesFolder: string;
  /** Optional JSON file with activities in Strava API format (e.g. written by an AI assistant). */
  jsonFile: string;
  /** Note with a markdown table of upcoming races. */
  racesNote: string;
  /** Optional note with a coach's summary and "Target: Race name = value" lines. */
  coachNote: string;
  units: "km" | "mi";
  /** Extra words (comma separated) that mark an activity name as a race. */
  raceKeywords: string;
  /** Radius around your most-run area used for the home route map, in km. */
  homeRadiusKm: number;
  /** Rough shoe lifetime used for the gear bars, in km. */
  shoeLifeKm: number;
}

export const DEFAULT_SETTINGS: RunningDashboardSettings = {
  stravaExportFolder: "Running/strava-export",
  activityFilesFolder: "",
  jsonFile: "",
  racesNote: "Running/Races.md",
  coachNote: "",
  units: "km",
  raceKeywords: "race, marathon, marato, marató, maratón, maraton, half, semi, 10k, 5k, parkrun, cursa, mitja, carrera, course, lauf",
  homeRadiusKm: 12,
  shoeLifeKm: 800,
};
