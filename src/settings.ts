import { App, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type RunningDashboardPlugin from "./main";

import { DEFAULT_SETTINGS, RunningDashboardSettings } from "./settings-data";

export { DEFAULT_SETTINGS };
export type { RunningDashboardSettings };

/** Normalises a user-entered vault path; returns "" for empty input. */
export function cleanPath(p: string): string {
  const t = (p || "").trim();
  return t ? normalizePath(t) : "";
}

export class RunningDashboardSettingTab extends PluginSettingTab {
  plugin: RunningDashboardPlugin;

  constructor(app: App, plugin: RunningDashboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Data sources").setHeading();

    new Setting(containerEl)
      .setName("Strava export folder")
      .setDesc("Vault folder with your unzipped export archive (the folder that contains activities.csv). Leave empty to skip.")
      .addText((t) =>
        t.setPlaceholder("Running/strava-export").setValue(this.plugin.settings.stravaExportFolder).onChange(async (v) => {
          this.plugin.settings.stravaExportFolder = cleanPath(v);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Activity files folder")
      .setDesc("Vault folder with .gpx, .tcx or .fit files (also .gz), for example exported from Apple Health apps, Garmin or Coros. Leave empty to skip.")
      .addText((t) =>
        t.setPlaceholder("Running/activities").setValue(this.plugin.settings.activityFilesFolder).onChange(async (v) => {
          this.plugin.settings.activityFilesFolder = cleanPath(v);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Activities JSON file")
      .setDesc("Optional .json file with activities in Strava API format, for example written by an AI assistant with a Strava connection.")
      .addText((t) =>
        t.setPlaceholder("Running/activities.json").setValue(this.plugin.settings.jsonFile).onChange(async (v) => {
          this.plugin.settings.jsonFile = cleanPath(v);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Races and coaching").setHeading();

    new Setting(containerEl)
      .setName("Races note")
      .setDesc("Note with a table of races: date as yyyy-mm-dd, then race, distance, start time and link. The create races note command makes one for you.")
      .addText((t) =>
        t.setPlaceholder("Running/Races.md").setValue(this.plugin.settings.racesNote).onChange(async (v) => {
          this.plugin.settings.racesNote = cleanPath(v);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Coach's note")
      .setDesc("Optional note shown at the top of the dashboard. Add lines such as \"target: race name = 4:00–4:10\" to set race targets.")
      .addText((t) =>
        t.setPlaceholder("Running/Coach.md").setValue(this.plugin.settings.coachNote).onChange(async (v) => {
          this.plugin.settings.coachNote = cleanPath(v);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Race keywords")
      .setDesc("Comma-separated words that mark an activity as a race. Activities on a date in your races note always count as races.")
      .addText((t) =>
        t.setValue(this.plugin.settings.raceKeywords).onChange(async (v) => {
          this.plugin.settings.raceKeywords = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Display").setHeading();

    new Setting(containerEl).setName("Units").addDropdown((d) =>
      d
        .addOption("km", "Kilometres")
        .addOption("mi", "Miles")
        .setValue(this.plugin.settings.units)
        .onChange(async (v) => {
          this.plugin.settings.units = v === "mi" ? "mi" : "km";
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl)
      .setName("Home map radius (km)")
      .setDesc("How far around your most-run area the home route map reaches.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.homeRadiusKm)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 1 && n <= 200) {
            this.plugin.settings.homeRadiusKm = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Shoe lifetime (km)")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.shoeLifeKm)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 100 && n <= 5000) {
            this.plugin.settings.shoeLifeKm = n;
            await this.plugin.saveSettings();
          }
        }),
      );
  }
}
