// Shared helpers for both pages.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const gbp = (n, dp = 2) => "£" + Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const qty = (n) => Number(n || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 });

function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function relDays(n) {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

// Lets the dashboard and the inbox tab tell each other when something changed.
const channel = "BroadcastChannel" in window ? new BroadcastChannel("lardercheck") : null;
