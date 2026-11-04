// Shared helpers for both pages.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const gbp = (n, dp = 2) => "£" + Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const qty = (n) => Number(n || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 });

function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function longDate(iso) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
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

// A stable colour per name, for storage dots and sender avatars.
const PALETTE = ["#0a84ff", "#ff9f0a", "#30b0c7", "#34c759", "#af52de", "#ff375f", "#a2845e", "#5e5ce6"];
function colourFor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Each kind of storage gets its own colour so fridges are easy to tell apart.
// Real photos (Wikimedia Commons, freely licensed; credits in /media/credits.json and /credits.html).
const PHOTO_INGREDIENTS = new Set(["whole-milk","double-cream","free-range-eggs","mature-cheddar","beef-mince","lamb-shoulder","cod-loin","haddock-fillet","king-prawns-frozen","vine-tomatoes","little-gem-lettuce","brown-onions","maris-piper-potatoes","chestnut-mushrooms","fresh-basil","arborio-rice","extra-virgin-olive-oil","unsalted-butter","chicken-breast","plain-flour","smoked-back-bacon","tinned-chopped-tomatoes"]);
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function ingredientPhoto(name) { const k = slug(name); return PHOTO_INGREDIENTS.has(k) ? `/media/ing-${k}.jpg` : null; }
function storagePhoto(name) {
  const n = String(name).toLowerCase();
  const k = n.includes("dairy") ? "dairy" : n.includes("meat") ? "meat" : n.includes("fish") ? "fish" : n.includes("produce") ? "produce" : n.includes("freez") ? "frozen" : "dry";
  return `/media/store-${k}.jpg`;
}
function supplierPhoto(name) {
  const n = String(name).toLowerCase();
  const k = n.includes("holystone") || n.includes("meat") ? "holystone-meats" : n.includes("wansbeck") || n.includes("green") ? "wansbeck-greens" : n.includes("brackenfield") || n.includes("dairy") ? "brackenfield-dairy" : n.includes("coldharbour") || n.includes("fish") ? "coldharbour-fish" : null;
  return k ? `/media/sup-${k}.jpg` : null;
}

function storageColour(name) {
  const n = String(name).toLowerCase();
  if (n.includes("dairy")) return "#0a84ff";
  if (n.includes("meat")) return "#ff453a";
  if (n.includes("fish")) return "#30b0c7";
  if (n.includes("produce")) return "#34c759";
  if (n.includes("freez")) return "#5e5ce6";
  if (n.includes("dry")) return "#a2845e";
  return colourFor(name);
}

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Lets the dashboard and the inbox tab tell each other when something changed.
const channel = "BroadcastChannel" in window ? new BroadcastChannel("lardercheck") : null;
