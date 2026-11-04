export const gbp = (n: number | null | undefined, dp = 0) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : `${n < 0 ? "−" : ""}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export const gbp2 = (n: number | null | undefined) => gbp(n, 2);

export const pct = (n: number | null | undefined, dp = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toFixed(dp)}%`);

export const signed = (n: number | null | undefined, suffix = "%", dp = 1) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(dp)}${suffix}`;

export const signedGbp = (n: number | null | undefined, dp = 0) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${gbp(n, dp)}`);

export const int = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("en-GB"));

export const qty = (n: number, unit: string) => `${n.toLocaleString("en-GB", { maximumFractionDigits: unit === "each" || unit === "portion" ? 0 : 2 })} ${unit}`;

export const dateShort = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

export const dateLong = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

export const dateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export const channelLabel: Record<string, string> = { all: "All channels", dine_in: "Dine-in", collection: "Collection", delivery: "Delivery" };

export const sourceLabel: Record<string, string> = {
  pos_sales: "POS sales",
  supplier_invoice: "Supplier invoice",
  menu_recipes: "Menu & recipes",
  delivery_settlement: "Delivery settlement",
  waste: "Waste log",
  labour: "Labour & rota",
  supplier_orders: "Supplier orders",
};

export const costSourceLabel: Record<string, string> = {
  invoice_period: "Invoices this month",
  invoice_prior: "Earlier invoice",
  standard_estimate: "Estimated cost",
  missing: "No cost",
};

export const quadrantLabel: Record<string, string> = {
  high_volume_high_contribution: "High volume, high contribution",
  high_volume_low_contribution: "High volume, low contribution",
  low_volume_high_contribution: "Low volume, high contribution",
  low_volume_low_contribution: "Low volume, low contribution",
};
