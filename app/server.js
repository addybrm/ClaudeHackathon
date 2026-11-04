import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";

import { addDays, diffDays, isIsoDate } from "./lib/dates.js";
import { emailBody } from "./lib/emails.js";
import { ExtractionError, MODEL, SUPPORTED_TYPES, extractWithClaude, normalise } from "./lib/extract.js";
import { forecast } from "./lib/forecast.js";
import { compareLines, findEmail, receiptStatus } from "./lib/reconcile.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// The sample data is set around the hackathon day. Set TODAY=YYYY-MM-DD to change it.
const TODAY = isIsoDate(process.env.TODAY) ? process.env.TODAY : "2026-11-04";
// LARDER_DEMO=1 uses the pre-read results for the sample receipts even when an API key
// is set: a backup for a live pitch on bad wifi.
const FORCE_DEMO = process.env.LARDER_DEMO === "1";
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const catalog = readJson(path.join(here, "data/catalog.json"));
const { emails, mailbox } = readJson(path.join(here, "data/emails.json"));

// ---- sample receipts and their pre-read results (demo mode) ----
const SAMPLES_DIR = path.join(here, "samples/receipts");
const EXT_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf" };
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const samples = fs
  .readdirSync(SAMPLES_DIR)
  .filter((f) => EXT_TYPES[path.extname(f).toLowerCase()])
  .sort()
  .map((file) => {
    const buffer = fs.readFileSync(path.join(SAMPLES_DIR, file));
    const expectedPath = path.join(here, "samples/expected", file + ".json");
    return {
      file,
      mimeType: EXT_TYPES[path.extname(file).toLowerCase()],
      hash: sha256(buffer),
      expected: fs.existsSync(expectedPath) ? readJson(expectedPath) : null,
    };
  });
const demoByHash = new Map(samples.filter((s) => s.expected).map((s) => [s.hash, s.expected]));

// ---- persisted state ----
const STATE_PATH = path.join(here, "data/state.json");
const emptyState = () => ({ receipts: [], dailyUse: {} });
let state = fs.existsSync(STATE_PATH) ? { ...emptyState(), ...readJson(STATE_PATH) } : emptyState();
const save = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

// ---- ingredient lookups ----
function ingredientInfo(name, category = "other") {
  const known = catalog.ingredients.find((i) => i.name.toLowerCase() === name.toLowerCase());
  const cat = known?.category ?? category;
  return {
    name: known?.name ?? name,
    category: cat,
    unit: known?.unit,
    inCatalog: Boolean(known),
    shelfLifeDays: known?.shelfLifeDays ?? catalog.categoryShelfLifeDays[cat] ?? 14,
    storage: known?.storage ?? catalog.storageAreas[cat] ?? "Dry store",
    dailyUse: state.dailyUse[name.toLowerCase()] ?? known?.dailyUse ?? 0,
  };
}

// ---- receipts ----
async function readReceipt({ buffer, mimeType }) {
  const hash = sha256(buffer);
  const cached = demoByHash.get(hash);
  if (cached && (FORCE_DEMO || !HAS_KEY)) {
    return { extraction: normalise(cached, catalog), source: "demo", sourceNote: FORCE_DEMO ? "Demo mode is on" : "No API key set" };
  }
  if (!HAS_KEY) {
    throw new ExtractionError("No Anthropic API key is set, so only the sample receipts can be read. Start the server with ANTHROPIC_API_KEY to read your own.");
  }
  try {
    const extraction = await extractWithClaude({ buffer, mimeType, catalog });
    return { extraction, source: "claude", model: extraction.model };
  } catch (err) {
    if (cached) return { extraction: normalise(cached, catalog), source: "demo", sourceNote: `Claude call failed (${err.message})` };
    throw err;
  }
}

function buildReceipt({ fileName, mimeType, hash, read }) {
  const ex = read.extraction;
  const match = findEmail(ex, emails);
  const { lines, missingFromReceipt } = compareLines(ex.items, match?.email);
  const duplicateOf = ex.orderRef
    ? state.receipts.find((r) => r.extraction.orderRef && r.extraction.orderRef.toLowerCase() === ex.orderRef.toLowerCase())?.id
    : undefined;
  return {
    id: "r-" + hash.slice(0, 10),
    fileName,
    mimeType,
    hash,
    uploadedAt: new Date().toISOString(),
    source: read.source,
    sourceNote: read.sourceNote ?? "",
    model: read.model ?? "",
    extraction: { ...ex, items: undefined },
    lines,
    missingFromReceipt,
    emailId: match?.email.id ?? null,
    matchMethod: match?.method ?? null,
    status: receiptStatus(match?.email, lines, missingFromReceipt),
    duplicateOf: duplicateOf ?? null,
  };
}

async function processFile({ fileName, mimeType, buffer }) {
  const hash = sha256(buffer);
  const existing = state.receipts.find((r) => r.hash === hash);
  if (existing) return { fileName, ok: false, error: "Already uploaded", receiptId: existing.id };
  if (!SUPPORTED_TYPES[mimeType]) {
    const hint = /hei[cf]/i.test(mimeType + fileName) ? " Save HEIC photos as JPEG first." : "";
    return { fileName, ok: false, error: `Can't read ${mimeType || "this file type"}. Use a JPEG, PNG, WebP or PDF.${hint}` };
  }
  if (SUPPORTED_TYPES[mimeType] === "image" && buffer.length > 5 * 1024 * 1024) {
    return { fileName, ok: false, error: "Image is over 5 MB. The page shrinks photos automatically; upload through the page or resize it." };
  }
  try {
    const read = await readReceipt({ buffer, mimeType });
    if (!read.extraction.isReceipt || !read.extraction.items.length) {
      return { fileName, ok: false, error: "This doesn't look like a receipt for stock (no product lines found)." };
    }
    const receipt = buildReceipt({ fileName, mimeType, hash, read });
    // Re-check: another request may have added the same file while Claude was reading.
    if (!state.receipts.some((r) => r.hash === hash)) {
      state.receipts.push(receipt);
      save();
    }
    return { fileName, ok: true, receiptId: receipt.id, status: receipt.status };
  } catch (err) {
    if (!(err instanceof ExtractionError)) console.error(err);
    return { fileName, ok: false, error: err instanceof ExtractionError ? err.message : "Something went wrong reading this file", retryable: Boolean(err.retryable) };
  }
}

// ---- inventory ----
function buildInventory() {
  const batches = [];
  for (const r of state.receipts) {
    const arrival = r.extraction.receiptDate || r.uploadedAt.slice(0, 10);
    r.lines.forEach((l, idx) => {
      const info = ingredientInfo(l.ingredient, l.category);
      batches.push({
        id: `${r.id}-${idx}`,
        ingredient: info.name,
        category: info.category,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        supplier: r.extraction.supplier,
        status: "in_stock",
        arrivalDate: arrival,
        expiryDate: l.expiryDate || addDays(arrival, info.shelfLifeDays),
        expirySource: l.expiryDate ? "printed" : "estimated",
        storage: info.storage,
        receiptId: r.id,
        emailId: r.emailId,
        issues: l.issues,
      });
    });
  }
  const receivedRefs = new Set(state.receipts.map((r) => r.extraction.orderRef.toLowerCase()).filter(Boolean));
  for (const e of emails) {
    if (!["dispatched", "confirmed"].includes(e.status) || receivedRefs.has(e.orderRef.toLowerCase())) continue;
    e.items.forEach((item, idx) => {
      const info = ingredientInfo(item.ingredient);
      batches.push({
        id: `${e.id}-${idx}`,
        ingredient: info.name,
        category: info.category,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        supplier: e.fromName,
        status: "incoming",
        arrivalDate: e.deliveryDate,
        late: diffDays(e.deliveryDate, TODAY) < 0,
        expiryDate: addDays(e.deliveryDate, info.shelfLifeDays),
        expirySource: "estimated",
        storage: info.storage,
        receiptId: null,
        emailId: e.id,
        issues: [],
      });
    });
  }
  const f = forecast(batches, (name) => ingredientInfo(name).dailyUse, TODAY);
  return batches.map((b) => ({ ...b, ...f.get(b.id) }));
}

function emailStatuses() {
  return emails.map((e) => {
    const receipt = state.receipts.find((r) => r.emailId === e.id);
    let badge;
    if (receipt) badge = receipt.status === "verified" ? "matched" : "discrepancy";
    else if (e.status === "delivered") badge = "awaiting_receipt";
    else if (e.status === "dispatched" || e.status === "confirmed") badge = "incoming";
    else badge = "info";
    return { id: e.id, badge, receiptId: receipt?.id ?? null };
  });
}

function snapshot() {
  const inventory = buildInventory();
  const live = inventory.filter((b) => b.status === "in_stock" && !b.expired);
  const incoming = inventory.filter((b) => b.status === "incoming");
  const sum = (xs, fn) => Math.round(xs.reduce((s, x) => s + fn(x), 0) * 100) / 100;
  const ingredients = [...new Set(inventory.map((b) => b.ingredient))].map((n) => ingredientInfo(n));
  return {
    today: TODAY,
    restaurant: catalog.restaurant,
    ai: { model: MODEL, hasKey: HAS_KEY, forceDemo: FORCE_DEMO },
    totals: {
      stockValue: sum(live, (b) => b.leftNow * b.unitPrice),
      incomingValue: sum(incoming, (b) => b.quantity * b.unitPrice),
      nextArrival: incoming.map((b) => b.arrivalDate).sort()[0] ?? null,
      projectedWaste: sum(inventory, (b) => b.wasteValue ?? 0),
      wasteItems: inventory.filter((b) => (b.wasteQty ?? 0) > 0).length,
      needsReview: state.receipts.reduce((n, r) => n + r.lines.filter((l) => l.issues.length).length + r.missingFromReceipt.length, 0),
    },
    receipts: state.receipts,
    inventory,
    ingredients,
    emails: emailStatuses(),
  };
}

// ---- HTTP ----
const app = express();
app.use(express.json());
app.use(express.static(path.join(here, "public")));
app.use("/samples", express.static(SAMPLES_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 10 } });

app.get("/api/state", (_req, res) => res.json(snapshot()));

app.get("/api/emails", (_req, res) =>
  res.json({
    mailbox,
    emails: emails.map((e) => ({ ...e, body: emailBody(e, catalog.restaurant) })),
    statuses: emailStatuses(),
    today: TODAY,
  }),
);

app.post("/api/receipts", upload.array("files", 10), async (req, res) => {
  const files = req.files ?? [];
  if (!files.length) return res.status(400).json({ error: "No files uploaded" });
  const results = await Promise.all(
    files.map((f) => processFile({ fileName: f.originalname, mimeType: f.mimetype, buffer: f.buffer })),
  );
  res.json({ results, state: snapshot() });
});

app.get("/api/samples", (_req, res) =>
  res.json(samples.map((s) => ({ file: s.file, url: `/samples/${encodeURIComponent(s.file)}`, mimeType: s.mimeType, uploaded: state.receipts.some((r) => r.hash === s.hash) }))),
);

app.post("/api/samples/:file", async (req, res) => {
  const sample = samples.find((s) => s.file === req.params.file);
  if (!sample) return res.status(404).json({ error: "No such sample" });
  const buffer = fs.readFileSync(path.join(SAMPLES_DIR, sample.file));
  const result = await processFile({ fileName: sample.file, mimeType: sample.mimeType, buffer });
  res.json({ results: [result], state: snapshot() });
});

app.patch("/api/ingredients/:name", (req, res) => {
  const value = Number(req.body?.dailyUse);
  if (!Number.isFinite(value) || value < 0 || value > 100000) return res.status(400).json({ error: "dailyUse must be a number ≥ 0" });
  state.dailyUse[req.params.name.toLowerCase()] = value;
  save();
  res.json(snapshot());
});

app.delete("/api/receipts/:id", (req, res) => {
  state.receipts = state.receipts.filter((r) => r.id !== req.params.id);
  save();
  res.json(snapshot());
});

app.post("/api/reset", (_req, res) => {
  state = emptyState();
  save();
  res.json(snapshot());
});

app.use((err, _req, res, _next) => {
  const status = err instanceof multer.MulterError ? 400 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err instanceof multer.MulterError ? err.message : "Server error" });
});

app.listen(PORT, () => {
  console.log(`LarderCheck running at http://localhost:${PORT}  (today = ${TODAY})`);
  console.log(
    FORCE_DEMO
      ? "Demo mode: sample receipts use their pre-read results."
      : HAS_KEY
        ? `Reading receipts with ${MODEL}.`
        : "No ANTHROPIC_API_KEY set: only the sample receipts can be read (pre-read results).",
  );
});
