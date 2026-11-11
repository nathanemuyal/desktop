import test from "node:test";
import assert from "node:assert/strict";

// The module reads and writes window.localStorage; Node has none, so each test
// starts from an empty in-memory one that can also be made to fail or lie.
const memory = new Map<string, string>();
let failWrites = false;
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (failWrites) throw new Error("QuotaExceededError");
    memory.set(k, String(v));
  },
  removeItem: (k: string) => memory.delete(k),
};
const {
  CUSTOM_PAPERS_STORE,
  CustomPaperError,
  loadCustomPapers,
  customPapersFor,
  saveCustomPaper,
  updateCustomPaper,
  removeCustomPaper,
} = await import("../src/core/customPapers");
test.beforeEach(() => {
  memory.clear();
  failWrites = false;
});
const roll = {
  medium: "roll",
  pageWidth: 80,
  pageHeight: 40,
  width: 76,
  height: 40,
  columns: 1,
  rows: 1,
  left: 2,
  top: 0,
  gapX: 0,
  gapY: 0,
};

test("saved sizes come back after a reload, filtered by tab and printer", () => {
  const a = saveCustomPaper({
    name: "Shelf 76 × 40",
    tab: "warehouse",
    printer: "roll",
    paper: roll,
  });
  saveCustomPaper({
    name: "Office sheet",
    tab: "warehouse",
    printer: "office",
    paper: { ...roll, medium: "sheet" },
  });
  saveCustomPaper({
    name: "Price tag",
    tab: "retail",
    printer: "roll",
    paper: roll,
  });
  saveCustomPaper({
    name: "Pantry",
    tab: "home",
    paper: { ...roll, shape: "round" },
  });
  assert.equal(loadCustomPapers().length, 4);
  assert.deepEqual(
    customPapersFor("warehouse", "roll").map((p) => p.name),
    ["Shelf 76 × 40"],
  );
  assert.deepEqual(
    customPapersFor("warehouse", "office").map((p) => p.name),
    ["Office sheet"],
  );
  assert.deepEqual(
    customPapersFor("retail", "roll").map((p) => p.name),
    ["Price tag"],
  );
  assert.deepEqual(
    customPapersFor("home").map((p) => p.name),
    ["Pantry"],
  );
  assert.equal(customPapersFor("labels").length, 0);
  // The stored paper is a copy, not the object that was passed in.
  assert.deepEqual(a.paper, roll);
  assert.notEqual(a.paper, roll);
  assert.equal(JSON.parse(memory.get(CUSTOM_PAPERS_STORE)!)[0].id, a.id);
});

test("names are required and unique within a tab and printer, ignoring case and spacing", () => {
  saveCustomPaper({
    name: "Shelf",
    tab: "warehouse",
    printer: "roll",
    paper: roll,
  });
  assert.throws(
    () =>
      saveCustomPaper({
        name: "  ",
        tab: "warehouse",
        printer: "roll",
        paper: roll,
      }),
    (e: unknown) => e instanceof CustomPaperError && e.key === "paperNameError",
  );
  assert.throws(
    () =>
      saveCustomPaper({
        name: " shelf ",
        tab: "warehouse",
        printer: "roll",
        paper: roll,
      }),
    (e: unknown) => e instanceof CustomPaperError && e.key === "paperNameTaken",
  );
  // The same name is fine for another printer or tab: those lists never meet.
  saveCustomPaper({
    name: "Shelf",
    tab: "warehouse",
    printer: "office",
    paper: roll,
  });
  saveCustomPaper({
    name: "Shelf",
    tab: "retail",
    printer: "roll",
    paper: roll,
  });
  assert.equal(loadCustomPapers().length, 3);
});

test("rename, replace dimensions and remove, leaving the other entries alone", () => {
  const a = saveCustomPaper({
    name: "A",
    tab: "labels",
    paper: { paperWidth: 100 },
  });
  const b = saveCustomPaper({
    name: "B",
    tab: "labels",
    paper: { paperWidth: 200 },
  });
  assert.equal(updateCustomPaper(a.id, { name: "A2" })?.name, "A2");
  assert.throws(
    () => updateCustomPaper(a.id, { name: "b" }),
    (e: unknown) => e instanceof CustomPaperError && e.key === "paperNameTaken",
  );
  // Renaming to its own name, differently spaced, is not a collision.
  assert.equal(updateCustomPaper(a.id, { name: " A2 " })?.name, "A2");
  assert.deepEqual(
    updateCustomPaper(b.id, { paper: { paperWidth: 210 } })?.paper,
    { paperWidth: 210 },
  );
  assert.equal(updateCustomPaper("missing", { name: "X" }), null);
  removeCustomPaper(a.id);
  removeCustomPaper("missing");
  assert.deepEqual(
    loadCustomPapers().map((p) => [p.name, p.paper.paperWidth]),
    [["B", 210]],
  );
});

test("damaged storage is read as empty and bad entries are dropped", () => {
  memory.set(CUSTOM_PAPERS_STORE, "{not json");
  assert.deepEqual(loadCustomPapers(), []);
  memory.set(CUSTOM_PAPERS_STORE, JSON.stringify({ id: "x" }));
  assert.deepEqual(loadCustomPapers(), []);
  memory.set(
    CUSTOM_PAPERS_STORE,
    JSON.stringify([
      { id: "ok", name: " Kept ", tab: "home", paper: { width: 1 } },
      { id: "dup", name: "First", tab: "home", paper: {} },
      { id: "dup", name: "Second", tab: "home", paper: {} },
      { id: "", name: "No id", tab: "home", paper: {} },
      { id: "n", name: "", tab: "home", paper: {} },
      { id: "t", name: "Bad tab", tab: "design", paper: {} },
      {
        id: "p",
        name: "Bad printer",
        tab: "warehouse",
        printer: "laser",
        paper: {},
      },
      { id: "a", name: "Array paper", tab: "home", paper: [] },
      { id: "s", name: "No paper", tab: "home" },
      null,
      "text",
    ]),
  );
  assert.deepEqual(
    loadCustomPapers().map((p) => [p.id, p.name]),
    [
      ["ok", "Kept"],
      ["dup", "First"],
    ],
  );
  // A write that saves nothing reports so, instead of pretending it kept the size.
  failWrites = true;
  assert.throws(
    () => saveCustomPaper({ name: "Nope", tab: "home", paper: {} }),
    (e: unknown) =>
      e instanceof CustomPaperError && e.key === "paperStoreError",
  );
});

test("the desktop file copy follows every change and refills emptied web storage", async () => {
  const { restoreCustomPapers } = await import("../src/core/customPapers");
  let file: unknown = [];
  const desktop = {
    loadPapers: async () => file,
    savePapers: async (list: unknown) => {
      file = JSON.parse(JSON.stringify(list));
    },
  };
  (globalThis as { desktop?: unknown }).desktop = desktop;
  try {
    const a = saveCustomPaper({ name: "Kept", tab: "home", paper: { w: 1 } });
    saveCustomPaper({ name: "Gone", tab: "home", paper: { w: 2 } });
    removeCustomPaper(loadCustomPapers()[1].id);
    assert.deepEqual(file, [a]);
    // Web storage that no longer holds the list is refilled from the file.
    memory.clear();
    await restoreCustomPapers();
    assert.deepEqual(loadCustomPapers(), [a]);
    // A list emptied on purpose stays empty, and the file follows it.
    removeCustomPaper(a.id);
    file = [a];
    await restoreCustomPapers();
    assert.deepEqual(loadCustomPapers(), []);
    assert.deepEqual(file, []);
    // An unreadable or failing file never blocks the app from starting.
    file = "not a list";
    memory.clear();
    await restoreCustomPapers();
    desktop.loadPapers = async () => {
      throw new Error("disk");
    };
    await restoreCustomPapers();
    assert.deepEqual(loadCustomPapers(), []);
  } finally {
    delete (globalThis as { desktop?: unknown }).desktop;
  }
});
