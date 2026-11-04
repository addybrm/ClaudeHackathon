import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The demo must tell a coherent story both before and after the held-back sample files are imported.
process.env.MARGINOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "marginos-story-"));

const { loadDemo } = await import("@/lib/demo/seed");
const { getActiveBusiness } = await import("@/lib/business");
const { sampleContent, SAMPLE_FILES } = await import("@/lib/demo/samples");
const pipeline = await import("@/lib/imports/pipeline");
const engine = await import("@/lib/finance/engine");

describe("demo storyline", () => {
  it("revenue up and contribution down, before and after importing the samples", async () => {
    await loadDemo();
    const b = (await getActiveBusiness())!;
    const before = (await engine.investigateProfitChange(b, "2026-10")).headline;
    for (const f of SAMPLE_FILES.filter((s) => s.mime === "text/csv")) {
      const r = await pipeline.stageUpload(b, { sourceType: f.sourceType as never, fileName: f.name, mime: f.mime, bytes: sampleContent(f.name)! });
      await pipeline.confirmUpload(b, (r as { id: string }).id);
    }
    const after = (await engine.investigateProfitChange(b, "2026-10")).headline;
    if (process.env.MARGINOS_PRINT) fs.writeFileSync(process.env.MARGINOS_PRINT, JSON.stringify({ before, after }, null, 1));
    for (const h of [before, after]) {
      expect(h.netRevenue.changePct!).toBeGreaterThan(2);
      expect(h.contribution.changePct!).toBeLessThan(-2.5);
    }
  });
});
