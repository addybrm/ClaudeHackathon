import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth";

describe("passwords", () => {
  it("hashes with a per-password salt and verifies only the right password", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterz", a)).toBe(false);
    expect(await verifyPassword("anything", "plain-text")).toBe(false);
  });
});
