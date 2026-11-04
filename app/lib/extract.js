// Reads a receipt photo or PDF with Claude and returns structured line items.

import Anthropic from "@anthropic-ai/sdk";
import { isIsoDate } from "./dates.js";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
export const CATEGORIES = ["dairy", "meat", "fish", "produce", "frozen", "dry", "other"];

export const SUPPORTED_TYPES = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "application/pdf": "document",
};

export class ExtractionError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isReceipt", "supplier", "orderRef", "receiptDate", "currency", "total", "items", "warnings"],
  properties: {
    isReceipt: { type: "boolean", description: "false if the file is not a receipt, delivery note or invoice for bought goods" },
    supplier: { type: "string" },
    orderRef: { type: "string", description: "Order, invoice or PO reference exactly as printed; empty string if none" },
    receiptDate: { type: "string", description: "YYYY-MM-DD; empty string if not printed" },
    currency: { type: "string", description: "ISO code, e.g. GBP" },
    total: { type: "number", description: "Grand total as printed; 0 if not printed" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rawName", "ingredient", "category", "quantity", "unit", "unitPrice", "lineTotal", "expiryDate", "confidence", "note"],
        properties: {
          rawName: { type: "string", description: "Line description exactly as printed" },
          ingredient: { type: "string", description: "Catalog name if it is the same product, otherwise a short plain name" },
          category: { type: "string", enum: CATEGORIES },
          quantity: { type: "number", description: "Quantity in `unit` (after converting packs to the catalog unit)" },
          unit: { type: "string", description: "kg, g, l, ml, each or pack; use the catalog unit for catalog items" },
          unitPrice: { type: "number", description: "Price per `unit`" },
          lineTotal: { type: "number", description: "Line total as printed" },
          expiryDate: { type: "string", description: "YYYY-MM-DD use-by or best-before printed for this line; empty string if none printed" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          note: { type: "string", description: "Conversions made or anything unclear; empty string if nothing" },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" }, description: "Problems with the whole document: blurry, cut off, handwritten changes, etc." },
  },
};

const SYSTEM = `You read supplier receipts, delivery notes and invoices for a restaurant kitchen and turn them into structured stock records.

Accuracy matters more than completeness: a wrong quantity or price silently corrupts the stock count and the manager's cost figures. When a value is hard to read, give your best reading, set confidence to "low" and say what is unclear in the note. Never invent a line, a date or a reference that is not printed.

Rules:
- One item per purchased product line. Skip subtotals, VAT, delivery charges and deposits.
- Match each product to the restaurant's ingredient catalog when it is the same product (abbreviations like "CHKN BRST" = "Chicken breast"). Use the catalog name and unit exactly.
- If a line is priced per pack, case, tray, sack or tin and the pack size is printed, convert quantity and unitPrice into the catalog unit (e.g. 12 trays of 30 eggs = 360 each) and record the conversion in the note. If the pack size is not printed, keep the printed unit and set confidence to "medium".
- Dates as YYYY-MM-DD. UK receipts write dates day first (04/11/2026 = 2026-11-04).
- expiryDate only when a use-by or best-before date is printed for that line.`;

let client;
function getClient() {
  client ??= new Anthropic();
  return client;
}

function catalogText(catalog) {
  return catalog.ingredients.map((i) => `- ${i.name} (${i.unit}, ${i.category})`).join("\n");
}

/**
 * @param {{buffer: Buffer, mimeType: string, catalog: object}} input
 * @returns {Promise<object>} normalised extraction
 */
export async function extractWithClaude({ buffer, mimeType, catalog }) {
  const kind = SUPPORTED_TYPES[mimeType];
  if (!kind) throw new ExtractionError(`Unsupported file type ${mimeType}`);
  const data = buffer.toString("base64");
  const fileBlock =
    kind === "document"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mimeType, data } };

  let response;
  try {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            fileBlock,
            { type: "text", text: `Ingredient catalog for this restaurant:\n${catalogText(catalog)}\n\nRead this document.` },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new ExtractionError("No valid Anthropic API key is configured");
    if (err instanceof Anthropic.RateLimitError) throw new ExtractionError("Claude is rate-limited right now; try again in a minute", { retryable: true });
    if (err instanceof Anthropic.BadRequestError) throw new ExtractionError(`Claude couldn't accept this file: ${err.message}`);
    if (err instanceof Anthropic.APIError) throw new ExtractionError(`Claude API error ${err.status ?? ""}: ${err.message}`, { retryable: true });
    // No credentials at all: the SDK throws before sending the request.
    if (/api key|apiKey|authToken|credential/i.test(String(err?.message))) throw new ExtractionError("No Anthropic API key is configured");
    throw new ExtractionError(`Couldn't reach Claude: ${err?.message ?? err}`, { retryable: true });
  }

  if (response.stop_reason === "refusal") throw new ExtractionError("Claude declined to read this file");
  if (response.stop_reason === "max_tokens") throw new ExtractionError("The receipt was too long to read in one go");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExtractionError("Claude's answer wasn't valid JSON", { retryable: true });
  }
  return { ...normalise(parsed, catalog), model: response.model, usage: response.usage };
}

/** Cleans up an extraction and adds checks that don't depend on trusting the model. */
export function normalise(x, catalog) {
  const byName = new Map(catalog.ingredients.map((i) => [i.name.toLowerCase(), i]));
  const warnings = Array.isArray(x.warnings) ? x.warnings.map(String) : [];
  const items = (Array.isArray(x.items) ? x.items : [])
    .filter((i) => i && String(i.ingredient ?? "").trim() && Number.isFinite(i.quantity) && i.quantity > 0)
    .map((i) => {
      const known = byName.get(String(i.ingredient).trim().toLowerCase());
      const quantity = Number(i.quantity);
      const unitPrice = Number.isFinite(i.unitPrice) ? Number(i.unitPrice) : 0;
      const lineTotal = Number.isFinite(i.lineTotal) ? Number(i.lineTotal) : 0;
      // Guard against confident misreads: the printed line total should equal qty × price.
      const arithmetic = lineTotal > 0 ? Math.abs(quantity * unitPrice - lineTotal) <= Math.max(0.02, lineTotal * 0.01) : true;
      return {
        rawName: String(i.rawName ?? ""),
        ingredient: known ? known.name : String(i.ingredient).trim(),
        category: known ? known.category : CATEGORIES.includes(i.category) ? i.category : "other",
        quantity,
        unit: known ? known.unit : String(i.unit || "each"),
        unitPrice,
        lineTotal,
        expiryDate: isIsoDate(i.expiryDate) ? i.expiryDate : "",
        confidence: ["high", "medium", "low"].includes(i.confidence) ? i.confidence : "medium",
        note: String(i.note ?? ""),
        arithmetic,
        inCatalog: Boolean(known),
      };
    });

  const sum = items.reduce((s, i) => s + i.lineTotal, 0);
  if (Number(x.total) > 0 && Math.abs(sum - Number(x.total)) > 0.05) {
    warnings.push(`Line totals add up to £${sum.toFixed(2)} but the receipt total is £${Number(x.total).toFixed(2)}`);
  }
  if (!isIsoDate(x.receiptDate)) warnings.push("No readable date on the receipt; using today's date");

  return {
    isReceipt: x.isReceipt !== false,
    supplier: String(x.supplier ?? "").trim() || "Unknown supplier",
    orderRef: String(x.orderRef ?? "").trim(),
    receiptDate: isIsoDate(x.receiptDate) ? x.receiptDate : "",
    currency: String(x.currency || "GBP"),
    total: Number(x.total) || 0,
    items,
    warnings,
  };
}
