// Paper sizes people name and keep, so a one-off layout typed into the manual
// fields is offered again next time, next to the built-in presets. Entries stay
// on this device in localStorage; nothing is sent anywhere.
//
// Each tab stores its own paper shape (the warehouse `Paper`, the home `Paper`
// or the labels `LabelLayout`), so `paper` is opaque here and every tab checks
// it with its own validator before saving and again before applying it.
export const CUSTOM_PAPERS_STORE = "barcodemate.customPapers.v1";
export type CustomPaperTab = "labels" | "warehouse" | "retail" | "home";
export type CustomPaperPrinter = "office" | "roll";
export interface CustomPaper<P = Record<string, unknown>> {
  id: string;
  name: string;
  tab: CustomPaperTab;
  // Warehouse and retail lists depend on the printer; the other tabs omit it.
  printer?: CustomPaperPrinter;
  paper: P;
}
export class CustomPaperError extends Error {
  constructor(
    public key: "paperNameError" | "paperNameTaken" | "paperStoreError",
  ) {
    super(key);
  }
}
const tabs: CustomPaperTab[] = ["labels", "warehouse", "retail", "home"];
const printers: CustomPaperPrinter[] = ["office", "roll"];
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function validEntry(v: unknown): CustomPaper | null {
  if (
    !isRecord(v) ||
    typeof v.id !== "string" ||
    !v.id ||
    typeof v.name !== "string" ||
    !v.name.trim() ||
    !tabs.includes(v.tab as CustomPaperTab) ||
    (v.printer !== undefined &&
      !printers.includes(v.printer as CustomPaperPrinter)) ||
    !isRecord(v.paper)
  )
    return null;
  const entry: CustomPaper = {
    id: v.id,
    name: v.name.trim(),
    tab: v.tab as CustomPaperTab,
    paper: v.paper,
  };
  if (v.printer !== undefined) entry.printer = v.printer as CustomPaperPrinter;
  return entry;
}
/** Every saved size, in the order they were saved. Damaged entries are dropped. */
export function loadCustomPapers(): CustomPaper[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PAPERS_STORE);
    if (!raw) return [];
    return validList(JSON.parse(raw));
  } catch {
    return [];
  }
}
function validList(parsed: unknown): CustomPaper[] {
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const list: CustomPaper[] = [];
  for (const item of parsed) {
    const entry = validEntry(item);
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      list.push(entry);
    }
  }
  return list;
}
// The desktop app also keeps the list in a file beside the project library,
// so the sizes outlive anything that empties web storage: a reinstall that
// resets it, a cleared cache, a changed page origin in a later version.
type FileCopy = {
  loadPapers?: () => Promise<unknown>;
  savePapers?: (list: CustomPaper[]) => Promise<unknown>;
};
const fileCopy = () => (globalThis as { desktop?: FileCopy }).desktop;
const copyToFile = (list: CustomPaper[]) => {
  try {
    void fileCopy()
      ?.savePapers?.(list)
      ?.catch(() => {});
  } catch {}
};
/**
 * Run once before the first render. Web storage that has never held the list
 * is refilled from the file; otherwise web storage is the truth and the file
 * is brought up to date with it.
 */
export async function restoreCustomPapers(): Promise<void> {
  const desktop = fileCopy();
  if (!desktop?.loadPapers) return;
  try {
    const kept = validList(await desktop.loadPapers());
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(CUSTOM_PAPERS_STORE);
    } catch {}
    if (raw === null) {
      if (kept.length)
        localStorage.setItem(CUSTOM_PAPERS_STORE, JSON.stringify(kept));
      return;
    }
    const current = loadCustomPapers();
    if (JSON.stringify(current) !== JSON.stringify(kept)) copyToFile(current);
  } catch {}
}
/** The saved sizes one selector offers: its tab, and its printer where that matters. */
export function customPapersFor<P extends object = Record<string, unknown>>(
  tab: CustomPaperTab,
  printer?: CustomPaperPrinter,
): CustomPaper<P>[] {
  return loadCustomPapers().filter(
    (p) => p.tab === tab && (printer === undefined || p.printer === printer),
  ) as CustomPaper<P>[];
}
function write(list: CustomPaper[]) {
  try {
    localStorage.setItem(CUSTOM_PAPERS_STORE, JSON.stringify(list));
  } catch {
    throw new CustomPaperError("paperStoreError");
  }
  copyToFile(list);
}
const sameName = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), undefined, { sensitivity: "accent" }) === 0;
function checkName(
  list: CustomPaper[],
  entry: Omit<CustomPaper<object>, "id"> & { id?: string },
) {
  const name = entry.name.trim();
  if (!name) throw new CustomPaperError("paperNameError");
  if (
    list.some(
      (p) =>
        p.id !== entry.id &&
        p.tab === entry.tab &&
        p.printer === entry.printer &&
        sameName(p.name, name),
    )
  )
    throw new CustomPaperError("paperNameTaken");
  return name;
}
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
/** Keeps a new size. The name must be unique within its tab and printer. */
export function saveCustomPaper<P extends object>(
  entry: Omit<CustomPaper<P>, "id">,
): CustomPaper<P> {
  const list = loadCustomPapers();
  const name = checkName(list, entry);
  const saved: CustomPaper = {
    id: newId(),
    name,
    tab: entry.tab,
    paper: structuredClone(entry.paper) as Record<string, unknown>,
  };
  if (entry.printer !== undefined) saved.printer = entry.printer;
  write([...list, saved]);
  return saved as CustomPaper<P>;
}
/** Renames a size or replaces its dimensions. Unknown ids are left alone. */
export function updateCustomPaper<P extends object>(
  id: string,
  patch: { name?: string; paper?: P },
): CustomPaper<P> | null {
  const list = loadCustomPapers();
  const existing = list.find((p) => p.id === id);
  if (!existing) return null;
  const next: CustomPaper = {
    ...existing,
    paper: patch.paper
      ? (structuredClone(patch.paper) as Record<string, unknown>)
      : existing.paper,
  };
  if (patch.name !== undefined)
    next.name = checkName(list, { ...next, name: patch.name });
  write(list.map((p) => (p.id === id ? next : p)));
  return next as CustomPaper<P>;
}
export function removeCustomPaper(id: string) {
  const list = loadCustomPapers();
  if (!list.some((p) => p.id === id)) return;
  write(list.filter((p) => p.id !== id));
}
