import { Component, ItemView, MarkdownRenderer, TFile, WorkspaceLeaf } from "obsidian";
import { parseRaces, parseTargets, stripTargets } from "./importers/races";
import type RunningDashboardPlugin from "./main";
import { renderDashboard } from "./render/dashboard";
import { Place, buildRuns, ymd } from "./stats";
import placesData from "./assets/places.json";
import worldData from "./assets/world110.json";
import countriesData from "./assets/countries50.json";

export const VIEW_TYPE = "running-dashboard-view";

export class DashboardView extends ItemView {
  private plugin: RunningDashboardPlugin;
  private noteComponent: Component | null = null;
  private renderTimer: number | null = null;
  private renderToken = 0;

  constructor(leaf: WorkspaceLeaf, plugin: RunningDashboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Running dashboard";
  }
  getIcon(): string {
    return "activity";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("rd-view");
    // Re-render when the races note or coach's note changes.
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        const s = this.plugin.settings;
        if (f.path === s.racesNote || f.path === s.coachNote) this.scheduleRender();
      }),
    );
    await this.render();
  }

  async onClose(): Promise<void> {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    if (this.noteComponent) this.removeChild(this.noteComponent);
    this.noteComponent = null;
  }

  scheduleRender(): void {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      void this.render();
    }, 400);
  }

  private async readNote(path: string): Promise<string | null> {
    if (!path) return null;
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? this.app.vault.cachedRead(f) : null;
  }

  async render(): Promise<void> {
    // Renders are async; if a newer one starts, older ones stop before touching the page.
    const token = ++this.renderToken;
    const s = this.plugin.settings;
    const cache = this.plugin.cache;
    const racesMd = await this.readNote(s.racesNote);
    const races = racesMd ? parseRaces(racesMd) : [];
    const coachMd = await this.readNote(s.coachNote);

    if (token !== this.renderToken) return;
    // Markdown in the coach's note is rendered by Obsidian's own renderer, which sanitises HTML.
    if (this.noteComponent) this.removeChild(this.noteComponent);
    this.noteComponent = null;
    let coachNote: { el: HTMLElement; updated?: string } | undefined;
    if (coachMd) {
      const comp = this.addChild(new Component());
      this.noteComponent = comp;
      const body = createDiv({ cls: "rd-coach-body" });
      const lines = stripTargets(coachMd).split("\n");
      let updated: string | undefined;
      if (lines.length && /^updated:/i.test(lines[0])) updated = (lines.shift() as string).replace(/^updated:\s*/i, "").slice(0, 120);
      await MarkdownRenderer.render(this.app, lines.join("\n"), body, s.coachNote, comp);
      if (token !== this.renderToken) return;
      coachNote = { el: body, updated };
    }

    const runs = buildRuns(cache.activities, races, s.raceKeywords);
    const root = this.contentEl;
    root.empty();
    renderDashboard(root, {
      runs,
      races,
      targets: coachMd ? parseTargets(coachMd) : new Map<string, string>(),
      today: ymd(new Date()),
      units: s.units,
      homeRadiusKm: s.homeRadiusKm,
      shoeLifeKm: s.shoeLifeKm,
      places: placesData as Place[],
      world: worldData,
      countries: countriesData,
      importedAt: cache.importedAt,
      warnings: cache.warnings,
      coachNote,
      onOpenRaces: s.racesNote ? () => void this.app.workspace.openLinkText(s.racesNote, "", false) : undefined,
      onOpenSettings: () => this.plugin.openSettings(),
    });
  }
}
