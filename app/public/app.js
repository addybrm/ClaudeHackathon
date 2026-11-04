let state = null;
let emailMeta = new Map(); // email id -> subject
const $ = (id) => document.getElementById(id);
const ui = { status: "", storage: "", q: "" };
const seenReceipts = new Set();
const shownPct = new Map(); // batch id -> % currently drawn, so bars animate from where they were
const tileNow = new Map(); // tile id -> number currently shown
let firstRender = true;

const STATUS = {
  verified: ["good", "Matches email"],
  discrepancies: ["warn", "Needs checking"],
  unverified: ["bad", "No email found"],
};

const APP_ICON = `<span class="app-icon" aria-hidden="true"><img src="/media/app-larder.jpg" alt=""></span>`;

// ---------- motion helpers ----------
function countTo(el, to, fmt) {
  const from = tileNow.get(el.id) ?? 0;
  tileNow.set(el.id, to);
  if (reduceMotion || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  const dur = 800;
  const token = (el._token = Symbol());
  const step = (t) => {
    if (el._token !== token) return;
    const p = Math.min(1, (t - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function toast(title, body, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${APP_ICON}<b>${esc(title)}</b><span>${esc(body)}</span>`;
  $("toasts").prepend(el);
  const dismiss = () => {
    el.classList.add("out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    if (reduceMotion) el.remove();
  };
  el.addEventListener("click", dismiss);
  setTimeout(dismiss, 5200);
}

// ---------- rendering ----------
function render() {
  const s = state;
  const t = s.totals;
  $("kitchen").textContent = `— ${s.restaurant}`;
  $("today").textContent = longDate(s.today);

  const live = s.inventory.filter((b) => b.status === "in_stock" && !b.expired);
  if (!s.inventory.length) {
    $("lede").textContent = "Add your first receipt and LarderCheck builds your stock list from it.";
  } else {
    const parts = [`You have about ${gbp(t.stockValue, 0)} of stock in the kitchen`];
    if (t.incomingValue) parts[0] += ` and ${gbp(t.incomingValue, 0)} on its way`;
    parts[0] += ".";
    parts.push(
      t.projectedWaste > 0
        ? `${t.wasteItems} ${t.wasteItems === 1 ? "batch is" : "batches are"} likely to go off before you use ${t.wasteItems === 1 ? "it" : "them"}, about ${gbp(t.projectedWaste, 0)}.`
        : "Everything should get used before it goes off.",
    );
    if (t.needsReview) parts.push(`${t.needsReview} receipt ${t.needsReview === 1 ? "line needs" : "lines need"} checking.`);
    $("lede").textContent = parts.join(" ");
  }

  const pill = $("ai-pill");
  if (s.ai.forceDemo) [pill.className, pill.textContent] = ["pill warn", "Demo mode"];
  else if (s.ai.hasKey) [pill.className, pill.textContent] = ["pill good", "Claude is reading receipts"];
  else [pill.className, pill.textContent] = ["pill warn", "Samples only"];

  countTo($("t-stock"), t.stockValue, (v) => gbp(v, 0));
  $("t-stock-sub").textContent = `${live.length} ${live.length === 1 ? "batch" : "batches"} in the kitchen`;
  countTo($("t-incoming"), t.incomingValue, (v) => gbp(v, 0));
  $("t-incoming-sub").textContent = t.nextArrival ? `Next delivery ${shortDate(t.nextArrival)}` : "Nothing on order";
  countTo($("t-waste"), t.projectedWaste, (v) => gbp(v, 0));
  $("t-waste-sub").textContent = t.wasteItems ? `Across ${t.wasteItems} ${t.wasteItems === 1 ? "batch" : "batches"}` : "Nothing expected to go off";
  $("tile-waste").classList.toggle("bad", t.projectedWaste > 0);
  countTo($("t-review"), t.needsReview, (v) => String(Math.round(v)));
  $("tile-review").classList.toggle("warn", t.needsReview > 0);

  $("c-receipts").textContent = s.receipts.length || "";
  $("c-stock").textContent = s.inventory.length || "";
  renderSidebarStorage();
  renderReceipts();
  renderInventory();
  firstRender = false;
}

function renderSidebarStorage() {
  const counts = new Map();
  for (const b of state.inventory) counts.set(b.storage, (counts.get(b.storage) ?? 0) + 1);
  const areas = [...counts.keys()].sort();
  if (ui.storage && !counts.has(ui.storage)) ui.storage = "";
  const item = (value, label, count, dot) =>
    `<button type="button" class="side-item ${ui.storage === value ? "active" : ""}" data-storage="${esc(value)}">
      <span class="ico"><img src="${dot ? storagePhoto(value) : "/media/nav-stock.jpg"}" alt=""></span>
      ${esc(label)}<span class="count">${count || ""}</span>
    </button>`;
  $("side-storage").innerHTML = areas.length
    ? item("", "Everywhere", state.inventory.length) + areas.map((a) => item(a, a, counts.get(a), storageColour(a))).join("")
    : `<div class="side-item" style="color:var(--faint);cursor:default">Nothing stored yet</div>`;
}

function renderReceipts() {
  const el = $("receipt-list");
  if (!state.receipts.length) {
    el.innerHTML = `<div class="empty">No receipts yet. Drop one above or try a sample.</div>`;
    return;
  }
  const order = { discrepancies: 0, unverified: 1, verified: 2 };
  const receipts = [...state.receipts].sort((a, b) => order[a.status] - order[b.status] || b.uploadedAt.localeCompare(a.uploadedAt));
  el.innerHTML = receipts.map((r) => receiptHtml(r, !firstRender && !seenReceipts.has(r.id))).join("");
  receipts.forEach((r) => seenReceipts.add(r.id));
}

function receiptHtml(r, isNew) {
  const [cls, label] = STATUS[r.status];
  const ex = r.extraction;
  const source = r.source === "claude" ? `Read by Claude (${esc(r.model)})` : `Sample: pre-read result (${esc(r.sourceNote.toLowerCase())})`;
  const emailLine = r.emailId
    ? `Checked against <a href="/inbox.html#${esc(r.emailId)}" target="larder-inbox">${esc(emailMeta.get(r.emailId) ?? "the order email")}</a>`
    : "No order email from this supplier to check against";

  const flags = [
    ...r.lines.filter((l) => l.issues.length).map((l) => ({
      title: l.ingredient,
      text: l.issues.map((i) => i.text).join(". "),
      bad: l.issues.some((i) => i.code !== "low_confidence"),
    })),
    ...r.missingFromReceipt.map((m) => ({ title: m.ingredient, text: `${qty(m.quantity)} ${m.unit} is on the email but not the receipt`, bad: true })),
  ];
  const summary = flags.length
    ? `<ul class="flag-list">${flags.map((f) => `<li class="${f.bad ? "bad" : ""}"><span class="mark">!</span><b>${esc(f.title)}</b><span>${esc(f.text)}</span></li>`).join("")}</ul>`
    : r.emailId
      ? `<p class="all-ok"><i>✓</i>All ${r.lines.length} lines match the email</p>`
      : `<p class="note">${r.lines.length} lines added to stock. With no email to compare, check this one by eye.</p>`;

  const rows = r.lines
    .map((l) => {
      const check = l.issues.length
        ? l.issues.map((i) => `<span class="issue ${i.code === "low_confidence" ? "warn" : ""}">${esc(i.text)}</span>`).join("")
        : r.emailId
          ? `<span class="check-ok">✓</span>`
          : `<span class="sub">—</span>`;
      return `<tr>
        <td>${esc(l.ingredient)}<div class="sub">${esc(l.rawName)}${l.note ? ` (${esc(l.note.toLowerCase())})` : ""}</div></td>
        <td class="num">${qty(l.quantity)} ${esc(l.unit)}</td>
        <td class="num">${gbp(l.unitPrice)}</td>
        <td>${check}</td>
      </tr>`;
    })
    .join("");
  const warnings = ex.warnings.length ? `<ul class="warnings">${ex.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "";
  const dup = r.duplicateOf ? `<span class="pill bad">Possible duplicate</span>` : "";
  const facts = [ex.orderRef ? `Order ${esc(ex.orderRef)}` : "No order number", ex.receiptDate ? shortDate(ex.receiptDate) : "No date", gbp(ex.total)].join(", ");

  return `<article class="receipt ${isNew ? "enter" : ""}" data-id="${esc(r.id)}">
    <div class="receipt-head">
      <h3>${esc(ex.supplier)}</h3><span class="pill ${cls}">${label}</span>${dup}
      <span class="spacer"></span>
      <button class="btn plain" data-delete="${esc(r.id)}" aria-label="Remove the receipt from ${esc(ex.supplier)}">Remove</button>
    </div>
    <p class="receipt-meta">${facts}</p>
    <p class="receipt-meta">${emailLine}</p>
    ${summary}
    ${warnings}
    <details><summary>All ${r.lines.length} lines</summary>
      <div class="table-wrap"><table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th>Email</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="receipt-meta" style="margin-top:8px">${source}</p>
    </details>
  </article>`;
}

function meterHtml(b) {
  if (!b.dailyUse) return `<span class="sub">Set "use a day"</span>`;
  const pct = b.pctUsedBeforeExpiry;
  const cls = pct >= 90 ? "good" : pct >= 60 ? "warn" : "bad";
  const from = shownPct.get(b.id) ?? 0;
  return `<div class="meter" title="${qty(b.consumed)} of ${qty(b.quantity)} ${esc(b.unit)} used before it goes off">
    <div class="bar"><div class="fill ${cls}" data-id="${esc(b.id)}" data-pct="${Math.max(2, Math.min(100, pct))}" style="width:${from}%"></div></div><b>${pct}%</b></div>`;
}

function renderInventory() {
  const q = ui.q.trim().toLowerCase();
  const rows = state.inventory
    .filter((b) => !q || b.ingredient.toLowerCase().includes(q) || b.supplier.toLowerCase().includes(q))
    .filter((b) => !ui.storage || b.storage === ui.storage)
    .filter((b) => (ui.status === "risk" ? b.dailyUse > 0 && b.pctUsedBeforeExpiry < 90 : !ui.status || b.status === ui.status))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.ingredient.localeCompare(b.ingredient));

  $("inv-empty").hidden = rows.length > 0;
  $("inv-empty").textContent = state.inventory.length
    ? "Nothing matches. Try another filter."
    : "Nothing here yet. Add a receipt and your stock appears here.";

  $("inventory").innerHTML = rows
    .map((b) => {
      const statusPill =
        b.status === "incoming"
          ? `<span class="pill info">${b.late ? "Late" : "On its way"}</span><div class="sub">Arrives ${shortDate(b.arrivalDate)}</div>`
          : b.expired
            ? `<span class="pill bad">Gone off</span><div class="sub">Came ${shortDate(b.arrivalDate)}</div>`
            : `<span class="pill good">In stock</span><div class="sub">Came ${shortDate(b.arrivalDate)}</div>`;
      const flagged = b.issues?.length ? `<span class="issue">${esc(b.issues[0].text)}</span>` : "";
      const useBy = `${shortDate(b.expiryDate)}<div class="sub">${relDays(b.daysToExpiry)}${b.expirySource === "printed" ? "" : " (est.)"}</div>`;
      const waste = b.dailyUse && b.wasteQty > 0 ? `${qty(b.wasteQty)} ${esc(b.unit)}<div class="sub">${gbp(b.wasteValue)}</div>` : `<span class="sub">—</span>`;
      return `<tr class="${b.expired ? "expired" : ""}">
        <td class="ingredient"><div class="ing-row">${ingredientPhoto(b.ingredient) ? `<img class="ing-photo" src="${ingredientPhoto(b.ingredient)}" alt="" loading="lazy">` : ""}<div><strong>${esc(b.ingredient)}</strong><div class="sub">${esc(b.supplier)}</div>${flagged}</div></div></td>
        <td class="nowrap">${statusPill}</td>
        <td class="num">${qty(b.quantity)} ${esc(b.unit)}<div class="sub">${gbp(b.unitPrice)} a ${esc(b.unit === "each" ? "piece" : b.unit)}</div></td>
        <td class="num">${b.status === "incoming" ? `<span class="sub">—</span>` : `${qty(b.leftNow)} ${esc(b.unit)}`}</td>
        <td class="nowrap">${useBy}</td>
        <td class="nowrap"><span class="store"><img src="${storagePhoto(b.storage)}" alt="">${esc(b.storage)}</span></td>
        <td class="num"><input class="use-input" type="number" min="0" step="any" value="${b.dailyUse}" data-use="${esc(b.ingredient)}" aria-label="How much ${esc(b.ingredient)} you use a day, in ${esc(b.unit)}"></td>
        <td>${meterHtml(b)}</td>
        <td class="num">${waste}</td>
      </tr>`;
    })
    .join("");

  // Grow each bar from where it was to where it is now.
  const fills = [...$("inventory").querySelectorAll(".fill")];
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      fills.forEach((f, i) => {
        if (!reduceMotion && firstRender) f.style.transitionDelay = `${Math.min(i * 25, 500)}ms`;
        f.style.width = f.dataset.pct + "%";
        shownPct.set(f.dataset.id, Number(f.dataset.pct));
      }),
    ),
  );
}

function diffFromToday(iso) {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(state.today + "T00:00:00Z")) / 86_400_000);
}

// ---------- uploads ----------
// Phone photos are often 4000px+ and several MB. Shrink them before upload so they stay
// under Claude's image limit and upload fast; receipts read fine at 2000px.
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 4 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function setBusy(n) {
  const drop = $("drop");
  drop.classList.toggle("busy", n > 0);
  $("drop-title").innerHTML = n > 0 ? `<span class="spinner"></span>&nbsp; Reading ${n} ${n === 1 ? "receipt" : "receipts"}…` : "Drop receipts here";
  $("drop-sub").textContent = n > 0 ? "Claude is reading each line and checking it against your emails" : "or click to choose up to 10 photos or PDFs";
}

function announce(results) {
  for (const r of results) {
    if (!r.ok) {
      toast(r.error === "Already uploaded" ? "Already added" : "Couldn't add receipt", r.error === "Already uploaded" ? `${r.fileName} is already in your receipts.` : `${r.fileName}: ${r.error}`, r.error === "Already uploaded" ? "" : "bad");
      continue;
    }
    const rec = state.receipts.find((x) => x.id === r.receiptId);
    const name = rec?.extraction.supplier ?? r.fileName;
    const issues = rec ? rec.lines.filter((l) => l.issues.length).length + rec.missingFromReceipt.length : 0;
    const body =
      r.status === "verified"
        ? `${rec.lines.length} items added. Everything matches the email.`
        : r.status === "unverified"
          ? `${rec.lines.length} items added. No order email to check it against.`
          : `${issues} ${issues === 1 ? "line doesn't" : "lines don't"} match the email.`;
    toast(`${name} added`, body, r.status === "discrepancies" ? "" : "");
  }
}

async function uploadFiles(fileList) {
  const files = [...fileList].slice(0, 10);
  if (!files.length) return;
  setBusy(files.length);
  const form = new FormData();
  for (const f of await Promise.all(files.map(shrinkImage))) form.append("files", f, f.name);
  try {
    const { results, state: next } = await api("/api/receipts", { method: "POST", body: form });
    update(next);
    announce(results);
  } catch (err) {
    toast("Couldn't upload", err.message, "bad");
  } finally {
    setBusy(0);
    loadSamples();
  }
}

async function addSamples(names) {
  if (!names.length) return;
  for (let i = 0; i < names.length; i++) {
    setBusy(names.length - i);
    try {
      const { results, state: next } = await api(`/api/samples/${encodeURIComponent(names[i])}`, { method: "POST" });
      update(next);
      announce(results);
    } catch (err) {
      toast("Couldn't add sample", err.message, "bad");
    }
  }
  setBusy(0);
  loadSamples();
}

async function loadSamples() {
  const samples = await api("/api/samples");
  const label = (f) => f.replace(/\.\w+$/, "").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  $("samples").innerHTML = samples
    .map(
      (s) => `<li>
        ${s.mimeType === "application/pdf" ? `<a class="thumb" href="${esc(s.url)}" target="_blank" rel="noopener">PDF</a>` : `<a href="${esc(s.url)}" target="_blank" rel="noopener"><img class="thumb" src="${esc(s.url)}" alt="Sample receipt ${esc(label(s.file))}" loading="lazy"></a>`}
        <span class="name">${esc(label(s.file))}<small>${s.mimeType === "application/pdf" ? "PDF invoice" : s.file.includes("photo") ? "Phone photo" : "Receipt scan"}</small></span>
        <button class="btn" data-sample="${esc(s.file)}" ${s.uploaded ? "disabled" : ""}>${s.uploaded ? "Added" : "Add"}</button>
      </li>`,
    )
    .join("");
  const remaining = samples.filter((s) => !s.uploaded).map((s) => s.file);
  $("all-samples").disabled = !remaining.length;
  $("all-samples").dataset.names = JSON.stringify(remaining);
}

function update(next, { broadcast = true } = {}) {
  state = next;
  render();
  if (broadcast) channel?.postMessage({ type: "updated" });
}

// ---------- events ----------
const drop = $("drop");
$("file").addEventListener("change", (e) => {
  uploadFiles(e.target.files);
  e.target.value = "";
});
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add("over"))));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadFiles(e.dataTransfer.files);
});

$("samples").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-sample]");
  if (btn) addSamples([btn.dataset.sample]);
});
$("all-samples").addEventListener("click", (e) => addSamples(JSON.parse(e.currentTarget.dataset.names || "[]")));

$("receipt-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-delete]");
  if (!btn) return;
  const card = btn.closest(".receipt");
  card.classList.add("leave");
  const next = await api(`/api/receipts/${encodeURIComponent(btn.dataset.delete)}`, { method: "DELETE" });
  setTimeout(() => update(next), reduceMotion ? 0 : 250);
  loadSamples();
});

$("inventory").addEventListener("change", async (e) => {
  const input = e.target.closest("[data-use]");
  if (!input) return;
  try {
    update(
      await api(`/api/ingredients/${encodeURIComponent(input.dataset.use)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyUse: Number(input.value) }),
      }),
    );
  } catch (err) {
    toast("Couldn't save", err.message, "bad");
  }
});

$("f-status").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-status]");
  if (!btn) return;
  ui.status = btn.dataset.status;
  $("f-status").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  renderInventory();
});
$("f-search").addEventListener("input", (e) => {
  ui.q = e.target.value;
  renderInventory();
});
$("side-storage").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-storage]");
  if (!btn) return;
  ui.storage = btn.dataset.storage;
  renderSidebarStorage();
  renderInventory();
  $("stock").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
});

$("reset").addEventListener("click", async () => {
  if (!confirm("Remove all receipts and go back to an empty kitchen?")) return;
  seenReceipts.clear();
  update(await api("/api/reset", { method: "POST" }));
  loadSamples();
});

channel?.addEventListener("message", async () => update(await api("/api/state"), { broadcast: false }));

(async function init() {
  try {
    const [s, mail] = await Promise.all([api("/api/state"), api("/api/emails")]);
    emailMeta = new Map(mail.emails.map((e) => [e.id, e.subject]));
    update(s, { broadcast: false });
    if (!s.ai.hasKey && !s.ai.forceDemo) {
      const b = $("banner");
      b.hidden = false;
      b.textContent = "Claude isn't connected yet, so only the sample receipts can be read. To read your own, restart LarderCheck with an Anthropic API key.";
    }
    await loadSamples();
  } catch (err) {
    $("lede").textContent = "LarderCheck can't reach its server. Check it's running, then reload. (" + err.message + ")";
  }
})();
