import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { MODEL, liveAiAvailable } from "@/lib/ai/config";

export const ExtractedInvoice = z.object({
  is_invoice: z.boolean().describe("false if the file is not a receipt, delivery note or invoice for bought goods"),
  supplier_name: z.string(),
  invoice_number: z.string(),
  order_ref: z.string().nullable().describe("Customer order / PO reference exactly as printed, or null"),
  invoice_date: z.string().describe("ISO date YYYY-MM-DD"),
  subtotal: z.number().nullable().describe("Net total before VAT"),
  vat: z.number().nullable(),
  total: z.number().nullable(),
  lines: z.array(z.object({
    description: z.string().describe("Line description exactly as printed"),
    quantity: z.number().describe("Number of invoice units (packs, cases, drums…) as printed"),
    invoice_unit: z.string().describe("Unit as printed, e.g. drum, case, bag, kg"),
    pack_size_quantity: z.number().nullable().describe("Amount of product in ONE invoice unit, e.g. 20 for a 20L drum; null if not stated"),
    pack_size_unit: z.enum(["kg", "g", "l", "ml", "each"]).nullable(),
    unit_price: z.number().describe("Price per invoice unit, ex VAT"),
    line_total: z.number().describe("Line total ex VAT"),
    vat_rate_pct: z.number().nullable(),
    matched_ingredient: z.string().nullable().describe("Exact name from the provided ingredient list if this line is clearly that ingredient, otherwise null"),
    expiry_date: z.string().nullable().describe("Use-by / best-before printed for this line as YYYY-MM-DD, otherwise null"),
    confidence: z.enum(["high", "medium", "low"]).describe("How sure you are that this line was read correctly"),
  })),
  extraction_confidence: z.enum(["high", "medium", "low"]),
  notes: z.string().nullable().describe("Anything unreadable, ambiguous or unusual"),
});
export type ExtractedInvoice = z.infer<typeof ExtractedInvoice>;

export class ExtractionUnavailableError extends Error {}

// Prompt rules adapted from the LarderCheck prototype's receipt reader.
const SYSTEM = `You read supplier invoices, delivery notes and receipts for a UK restaurant's cost system.

Accuracy matters more than completeness: a wrong quantity or price silently corrupts recipe costs and the owner's margin figures. When a value is hard to read, give your best reading, set that line's confidence to "low" and explain in notes. Never invent a line, a date or a reference that is not printed.

Rules:
- One line per purchased product. Skip subtotals, VAT, delivery charges and deposits.
- Match a line to the restaurant's ingredient list only when it is the same product (abbreviations like "CHKN BRST" = "Chicken breast fillet"); otherwise matched_ingredient is null (e.g. packaging).
- Record pack sizes when printed (e.g. a 20L drum: pack_size_quantity 20, pack_size_unit "l"; a 5KG case: 5, "kg").
- Dates as YYYY-MM-DD. UK documents write dates day first (04/11/2026 = 2026-11-04).
- expiry_date only when a use-by or best-before date is printed for that line.
- Amounts are GBP.`;

export async function extractInvoice(bytes: Buffer, mime: string, ingredientNames: string[]): Promise<ExtractedInvoice> {
  if (!liveAiAvailable()) {
    throw new ExtractionUnavailableError("Supplier invoice extraction uses Claude, and no ANTHROPIC_API_KEY is configured. Add a key to .env.local, or use the pre-read demo samples.");
  }
  const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  const data = bytes.toString("base64");
  const doc: Anthropic.ContentBlockParam =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data } };
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(ExtractedInvoice) },
    system: SYSTEM,
    messages: [{ role: "user", content: [doc, { type: "text", text: `Restaurant ingredient list:\n${ingredientNames.map((n) => `- ${n}`).join("\n")}\n\nRead this document.` }] }],
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined to process this document.");
  if (res.stop_reason === "max_tokens") throw new Error("The document was too long to read in one go.");
  if (!res.parsed_output) throw new Error("Claude did not return a valid invoice structure. The document may not be an invoice.");
  return res.parsed_output;
}
