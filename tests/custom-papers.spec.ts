import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { settled } from "./profile";

// A named size survives closing the app, shows up only where it was saved,
// and leaves the current dimensions in place when it is deleted.
test("saved paper sizes persist across launches in warehouse, home and labels", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "barcodemate-papers-"));
  await settled(temp);
  const launch = () =>
    electron.launch({
      ...(process.env.BARCODEMATE_EXECUTABLE
        ? { executablePath: process.env.BARCODEMATE_EXECUTABLE, args: [] }
        : { args: ["."] }),
      env: { ...process.env, BARCODEMATE_TEST_DIR: temp },
    });
  const options = (p: import("@playwright/test").Locator) =>
    p.evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));

  let app = await launch();
  try {
    const p = await app.firstWindow();
    const errors: string[] = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.locator("#language-select").selectOption("en");

    // Warehouse: type a size by hand, name it, and it becomes the selection.
    await p.locator("[data-workspace=scenarios]").click();
    await p.locator("#case-warehouse .hm-case-open").click();
    await expect(p.locator(".wh-root")).toBeVisible();
    const paper = p.getByTestId("warehouse-paper");
    await expect(
      p.locator("[data-testid=warehouse-paper] optgroup"),
    ).toHaveCount(0);
    // A roll printer, so the 80 mm wide stock below fits a single column.
    await p
      .getByRole("button", { name: /Thermal printer/ })
      .first()
      .click();
    await p.locator(".wh-paper-settings summary").click();
    await p.locator("[data-field=width] input").fill("76");
    await p.locator("[data-field=pageWidth] input").fill("80");
    await expect(paper).toHaveValue("custom");
    // No name, then a name: the first is refused, the second is kept.
    await p
      .getByRole("button", { name: "Save as new size", exact: true })
      .click();
    await expect(p.locator(".wh-notice")).toContainText("Enter a name");
    await p.getByTestId("warehouse-paper-name").fill("Shelf 76 wide");
    await p
      .getByRole("button", { name: "Save as new size", exact: true })
      .click();
    await expect(p.locator(".wh-notice")).toHaveCount(0);
    await expect(
      p.locator("[data-testid=warehouse-paper] optgroup"),
    ).toHaveAttribute("label", "My sizes");
    await expect(
      paper.locator("option", { hasText: "Shelf 76 wide · 76 × 50 mm" }),
    ).toHaveCount(1);
    const savedValue = await paper.inputValue();
    expect(savedValue).toMatch(/^saved:/);
    // A duplicate name is refused; a preset still applies and hides the saved controls.
    await p.getByTestId("warehouse-paper-name").fill("shelf 76 wide");
    await p
      .getByRole("button", { name: "Save as new size", exact: true })
      .click();
    await expect(p.locator(".wh-notice")).toContainText("already exists");
    await paper.selectOption("roll-2");
    await expect(
      p.getByRole("button", { name: "Rename", exact: true }),
    ).toHaveCount(0);
    await paper.selectOption(savedValue);
    await expect(p.locator("[data-field=width] input")).toHaveValue("76");
    await expect(p.locator("[data-field=pageWidth] input")).toHaveValue("80");
    // Sizes saved for a roll printer are not offered for sheets.
    await p
      .getByRole("button", { name: /Office printer/ })
      .first()
      .click();
    await expect(
      p.locator("[data-testid=warehouse-paper] optgroup"),
    ).toHaveCount(0);
    await p
      .getByRole("button", { name: /Thermal printer/ })
      .first()
      .click();
    await expect(
      p.locator("[data-testid=warehouse-paper] optgroup"),
    ).toHaveCount(1);
    await paper.selectOption(savedValue);
    await expect(p.locator("[data-field=width] input")).toHaveValue("76");

    // Home: the same control on its own list, selected by the paper id.
    await p.locator("[data-workspace=home]").click();
    await expect(p.locator(".hm-root")).toBeVisible();
    const home = p.locator("[data-testid=home-paper]");
    expect(await options(home.locator("option"))).not.toContain(savedValue);
    await home.selectOption("custom");
    await p.getByLabel("Columns", { exact: true }).fill("2");
    await p.getByTestId("home-paper-name").fill("Pantry 2 across");
    await p
      .getByRole("button", { name: "Save as new size", exact: true })
      .click();
    await expect(home).toHaveValue(/^saved:/);
    const homeValue = await home.inputValue();
    await expect(
      p.getByRole("button", { name: "Delete", exact: true }),
    ).toBeVisible();

    // Labels: a layout saved with the labels tab's own fields.
    await p.locator("[data-workspace=labels]").click();
    const layoutSelect = p.getByTestId("labels-layout");
    await expect(p.locator("[data-testid=labels-layout] optgroup")).toHaveCount(
      0,
    );
    // Too wide for the sheet is refused; a narrower label is kept.
    await p.getByLabel("Label width", { exact: true }).fill("70");
    await p.getByTestId("labels-layout-name").fill("Narrow 60");
    await p
      .getByRole("button", { name: "Save as new size", exact: true })
      .click();
    await expect(p.locator(".error-banner").first()).toContainText(
      "beyond the paper",
    );
    await expect(p.locator("[data-testid=labels-layout] optgroup")).toHaveCount(
      0,
    );
    await p.getByLabel("Label width", { exact: true }).fill("60");
    await p
      .getByRole("button", { name: "Save as new size", exact: true })
      .click();
    await expect(layoutSelect).toHaveValue(/^saved:/);
    const layoutValue = await layoutSelect.inputValue();
    // Hand edits leave the picker on custom; the saved entry applies again.
    await p.getByLabel("Label width", { exact: true }).fill("61");
    await expect(layoutSelect).toHaveValue("");
    await layoutSelect.selectOption(layoutValue);
    await expect(p.getByLabel("Label width", { exact: true })).toHaveValue(
      "60",
    );
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }

  // Everything is still there after a relaunch, each list in its own tab.
  app = await launch();
  try {
    const p = await app.firstWindow();
    const errors: string[] = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.locator("#language-select").selectOption("en");
    await p.locator("[data-workspace=scenarios]").click();
    await p.locator("#case-warehouse .hm-case-open").click();
    const paper = p.getByTestId("warehouse-paper");
    await expect(paper).toHaveValue(/^saved:/);
    await expect(
      paper.locator("option", { hasText: "Shelf 76 wide" }),
    ).toHaveCount(1);
    // Rename, then delete: the dimensions stay, the entry goes.
    await p.locator(".wh-paper-settings summary").click();
    await p.getByTestId("warehouse-paper-name").fill("Shelf, renamed");
    await p.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(
      paper.locator("option", { hasText: "Shelf, renamed" }),
    ).toHaveCount(1);
    await p.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      p.locator("[data-testid=warehouse-paper] optgroup"),
    ).toHaveCount(0);
    await expect(paper).toHaveValue("custom");
    await expect(p.locator("[data-field=width] input")).toHaveValue("76");

    await p.locator("[data-workspace=home]").click();
    const home = p.locator("[data-testid=home-paper]");
    await expect(home).toHaveValue(/^saved:/);
    await expect(
      home.locator("option", { hasText: "Pantry 2 across" }),
    ).toHaveCount(1);
    await p.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(home).toHaveValue("custom");
    await expect(p.getByLabel("Columns", { exact: true })).toHaveValue("2");
    await expect(p.locator("[data-testid=home-paper] optgroup")).toHaveCount(0);

    await p.locator("[data-workspace=labels]").click();
    const layoutSelect = p.getByTestId("labels-layout");
    await expect(
      layoutSelect.locator("option", { hasText: "Narrow 60" }),
    ).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }

  // The list is also kept in a file beside the library. With web storage
  // gone, as after a reset by an update or a cleared profile, it comes back.
  const kept = JSON.parse(
    await readFile(path.join(temp, "custom-papers.json"), "utf8"),
  );
  expect(kept.map((p: { name: string }) => p.name)).toEqual(["Narrow 60"]);
  await rm(path.join(temp, "Local Storage"), { recursive: true, force: true });
  app = await launch();
  try {
    const p = await app.firstWindow();
    await p.locator("#language-select").selectOption("en");
    await p.locator("[data-workspace=labels]").click();
    const layoutSelect = p.getByTestId("labels-layout");
    await expect(
      layoutSelect.locator("option", { hasText: "Narrow 60" }),
    ).toHaveCount(1);
    await layoutSelect.selectOption({ label: "Narrow 60 · 60 × 38.1 mm" });
    await expect(p.getByLabel("Label width", { exact: true })).toHaveValue(
      "60",
    );
  } finally {
    await app.close();
  }
});
