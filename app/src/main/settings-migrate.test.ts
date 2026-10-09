import { describe, expect, it } from "vitest";
import { migrateSettings } from "./settings-migrate";

describe("migrateSettings", () => {
  it("moves a saved blob character and its default name to Non", () => {
    const { settings, changed } = migrateSettings({ onboarded: true, character: "ember", companionName: "Ember" });
    expect(changed).toBe(true);
    expect(settings).toMatchObject({ onboarded: true, character: "non", companionName: "Non" });
  });

  it("moves the first-run placeholder name too", () => {
    expect(migrateSettings({ character: "pebble", companionName: "Your companion" }).settings.companionName).toBe("Non");
  });

  it("keeps a name the person typed themselves", () => {
    const { settings } = migrateSettings({ character: "moss", companionName: "Biscuit" });
    expect(settings).toMatchObject({ character: "non", companionName: "Biscuit" });
  });

  it("leaves current settings and empty files alone", () => {
    expect(migrateSettings({ character: "non", companionName: "Non" }).changed).toBe(false);
    expect(migrateSettings({}).changed).toBe(false);
  });
});
