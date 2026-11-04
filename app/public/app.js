let state = null;
let emailMeta = new Map(); // email id -> subject
const $ = (id) => document.getElementById(id);

const STATUS_PILL = {
  verified: ["good", "✓ Matches email"],
  discrepancies: ["warn", "Doesn't match email"],
  unverified: ["bad", "No email found"],
};

// ---------- rendering ----------
function render() {
  const s = state;
  $("subtitle").textContent = `${s.restaurant} · ${shortDate(s.today)}`;
  const pill = $("ai-pill");
  if (s.ai.forceDemo) [pill.className, pill.textContent] = ["pill warn", "Demo mode: pre-read samples"];
  else if (s.ai.hasKey) [pill.className, pill.textContent] = ["pill good", `Reading with ${s.ai.model}`];
  else [pill.className, pill.textContent] = ["pill warn", "No API key: samples only"];

  const t = s.totals;
  $("t-stock").textContent = gbp(t.stockValue, 0);
  $("t-stock-sub").textContent = `${s.inventory.filter((b) => b.status === "in_stock" && !b.expired).length} batches in stock`;
  $("t-incoming").textContent = gbp(t.incomingValue, 0);
  $("t-incoming-sub").textContent = t.nextArrival ? `Next delivery ${shortDate(t.nextArrival)}` : "Nothing on order";
  $("t-waste").textContent = gbp(t.projectedWaste, 0);
  $("t-waste-sub").textContent = t.wasteItems ? `${t.wasteItems} batches won't be used up in time` : "Everything should get used in time";
  $("tile-waste").classList.toggle("bad", t.projectedWaste > 0);
  $("t-review").textContent = t.needsReview;
  $("tile-review").classList.toggle("warn", t.needsReview > 0);

  renderReceipts();
  renderStorageFilter();
  renderInventory();
}

function renderReceipts() {
  const el = $("receipts");
  if (!state.receipts.length) {
    el.innerHTML = `<div class="empty">No receipts yet. Add one on the left, or try a sample.</div>`;
    return;
  }
  const order = { discrepancies: 0, unverified: 1, verified: 2 };
  const receipts = [...state.receipts].sort((a, b) => order[a.status] - order[b.status] || b.uploadedAt.localeCompare(a.uploadedAt));
  el.innerHTML = receipts.map(receiptHtml).join("");
}

function receiptHtml(r) {
  const [cls, label] = STATUS_PILL[r.status];
  const ex = r.extraction;
  const source =
    r.source === "claude"
      ? `Read by Claude (${esc(r.model)})`
      : `Pre-read sample result: ${esc(r.sourceNote)}`;
  const emailLink = r.emailId
    ? `Matched by ${esc(r.matchMethod)} to <a href="/inbox.html#${esc(r.emailId)}" target="larder-inbox">“${esc(emailMeta.get(r.emailId) ?? "email")}”</a>`
    : "No confirmation email from this supplier for this order";
  const row = (l) => {
      const checks = l.issues.length
        ? l.issues.map((i) => `<span class="issue ${i.code === "low_confidence" ? "warn" : ""}">${esc(i.text)}</span>`).join("")
        : r.emailId
          ? `<span class="check-ok">✓ matches</span>`
          : `<span class="sub">not checked</span>`;
      return `<tr>
        <td>${esc(l.ingredient)}<div class="sub">${esc(l.rawName)}${l.note ? ` · ${esc(l.note)}` : ""}</div></td>
        <td class="num">${qty(l.quantity)} ${esc(l.unit)}</td>
        <td class="num">${gbp(l.unitPrice)}</td>
        <td>${checks}</td>
      </tr>`;
  };
  const missing = r.missingFromReceipt
    .map(
      (m) => `<tr><td>${esc(m.ingredient)}</td><td class="num">${qty(m.quantity)} ${esc(m.unit)}</td><td class="num">${gbp(m.unitPrice)}</td>
        <td><span class="issue">On the email but not on the receipt</span></td></tr>`,
    )
    .join("");
  const table = (body) =>
    `<div class="table-wrap"><table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th>Check</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  // Show only the lines that need attention; the rest are one click away.
  const flagged = r.lines.filter((l) => l.issues.length);
  const flaggedHtml =
    flagged.length || missing
      ? table(flagged.map(row).join("") + missing)
      : r.emailId
        ? `<p class="all-ok">✓ All ${r.lines.length} lines match the email</p>`
        : `<p class="sub">${r.lines.length} lines added to stock without an email to check against</p>`;
  const warnings = ex.warnings.length ? `<ul class="warnings">${ex.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "";
  const dup = r.duplicateOf ? `<span class="pill bad">Possible duplicate of another receipt</span>` : "";
  return `<article class="receipt">
    <div class="receipt-head">
      <h3>${esc(ex.supplier)}</h3>
      <span class="pill ${cls}">${label}</span>${dup}
      <span style="flex:1"></span>
      <button class="btn small ghost" data-delete="${esc(r.id)}" aria-label="Remove receipt from ${esc(ex.supplier)}">Remove</button>
    </div>
    <div class="receipt-meta">
      <span>${ex.orderRef ? `Ref ${esc(ex.orderRef)}` : "No order ref"}</span>
      <span>${ex.receiptDate ? shortDate(ex.receiptDate) : "No date"}</span>
      <span>Total ${gbp(ex.total)}</span>
      <span>${esc(r.fileName)}</span>
    </div>
    <div class="receipt-meta"><span>${source}</span><span>${emailLink}</span></div>
    ${flaggedHtml}
    <details><summary>Show all ${r.lines.length} lines</summary>${table(r.lines.map(row).join("") + missing)}</details>
    ${warnings}
  </article>`;
}

function renderStorageFilter() {
  const sel = $("f-storage");
  const current = sel.value;
  const areas = [...new Set(state.inventory.map((b) => b.storage))].sort();
  sel.innerHTML = `<option value="">All storage</option>` + areas.map((a) => `<option>${esc(a)}</option>`).join("");
  if (areas.includes(current)) sel.value = current;
}

function meterHtml(b) {
  if (!b.dailyUse) return `<span class="sub">Set use / day</span>`;
  const pct = b.pctUsedBeforeExpiry;
  const cls = pct >= 90 ? "good" : pct >= 60 ? "warn" : "bad";
  return `<div class="meter" title="${qty(b.consumed)} of ${qty(b.quantity)} ${esc(b.unit)} used before it expires">
    <div class="bar"><div class="fill ${cls}" style="width:${Math.max(2, Math.min(100, pct))}%"></div></div><b>${pct}%</b></div>`;
}

function renderInventory() {
  const q = $("f-search").value.trim().toLowerCase();
  const storage = $("f-storage").value;
  const status = $("f-status").value;
  const rows = state.inventory
    .filter((b) => !q || b.ingredient.toLowerCase().includes(q) || b.supplier.toLowerCase().includes(q))
    .filter((b) => !storage || b.storage === storage)
    .filter((b) => (status === "risk" ? b.dailyUse > 0 && b.pctUsedBeforeExpiry < 90 : !status || b.status === status))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.ingredient.localeCompare(b.ingredient));

  $("inv-empty").hidden = state.inventory.length > 0;
  $("inventory").innerHTML = rows
    .map((b) => {
      const statusPill =
        b.status === "incoming"
          ? `<span class="pill info">${b.late ? "Late" : "On its way"}</span>`
          : b.expired
            ? `<span class="pill bad">Expired</span>`
            : `<span class="pill good">In stock</span>`;
      const flagged = b.issues?.length ? `<span class="issue">${esc(b.issues[0].text)}</span>` : "";
      const expires = `${shortDate(b.expiryDate)}<div class="sub">${b.expirySource === "printed" ? "printed" : "estimated"} · ${relDays(b.daysToExpiry)}</div>`;
      const arrives = b.status === "incoming" ? `${shortDate(b.arrivalDate)}<div class="sub">${relDays(diffFromToday(b.arrivalDate))}</div>` : `<span class="sub">Arrived ${shortDate(b.arrivalDate)}</span>`;
      const waste = b.dailyUse && b.wasteQty > 0 ? `${qty(b.wasteQty)} ${esc(b.unit)}<div class="sub">${gbp(b.wasteValue)}</div>` : `<span class="sub">—</span>`;
      return `<tr class="${b.expired ? "expired" : ""}">
        <td><strong>${esc(b.ingredient)}</strong><div class="sub">${esc(b.supplier)}</div>${flagged}</td>
        <td>${statusPill}</td>
        <td class="num">${qty(b.quantity)} ${esc(b.unit)}</td>
        <td class="num">${b.status === "incoming" ? `<span class="sub">—</span>` : `${qty(b.leftNow)} ${esc(b.unit)}`}</td>
        <td class="num">${gbp(b.unitPrice)}<div class="sub">per ${esc(b.unit)}</div></td>
        <td>${arrives}</td>
        <td>${expires}</td>
        <td>${esc(b.storage)}</td>
        <td class="num"><input class="use-input" type="number" min="0" step="any" value="${b.dailyUse}" data-use="${esc(b.ingredient)}" aria-label="Daily use of ${esc(b.ingredient)} in ${esc(b.unit)}"></td>
        <td>${meterHtml(b)}</td>
        <td class="num">${waste}</td>
      </tr>`;
    })
    .join("");
}

function diffFromToday(iso) {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(state.today + "T00:00:00Z")) / 86_400_000);
}

// ---------- uploads ----------
// Phone photos are often 4000px+ and several MB; shrink them before upload so they stay
// under Claude's image limit and upload fast. Claude reads receipts fine at 2000px.
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

function showProgress(items) {
  $("progress").innerHTML = items
    .map((i) =>
      i.pending
        ? `<div><span class="spinner"></span>Reading ${esc(i.fileName)}…</div>`
        : i.ok
          ? `<div class="ok">✓ ${esc(i.fileName)} added</div>`
          : `<div class="err">${esc(i.fileName)}: ${esc(i.error)}</div>`,
    )
    .join("");
}

async function uploadFiles(fileList) {
  const files = [...fileList].slice(0, 10);
  if (!files.length) return;
  showProgress(files.map((f) => ({ fileName: f.name, pending: true })));
  const form = new FormData();
  for (const f of await Promise.all(files.map(shrinkImage))) form.append("files", f, f.name);
  try {
    const { results, state: next } = await api("/api/receipts", { method: "POST", body: form });
    showProgress(results);
    update(next);
  } catch (err) {
    showProgress(files.map((f) => ({ fileName: f.name, ok: false, error: err.message })));
  }
}

async function addSamples(names) {
  showProgress(names.map((n) => ({ fileName: n, pending: true })));
  const results = [];
  for (const n of names) {
    try {
      const { results: r, state: next } = await api(`/api/samples/${encodeURIComponent(n)}`, { method: "POST" });
      results.push(...r);
      update(next);
    } catch (err) {
      results.push({ fileName: n, ok: false, error: err.message });
    }
    showProgress([...results, ...names.slice(results.length).map((x) => ({ fileName: x, pending: true }))]);
  }
  loadSamples();
}

async function loadSamples() {
  const samples = await api("/api/samples");
  $("samples").innerHTML = samples
    .map(
      (s) => `<li>
        ${s.mimeType === "application/pdf" ? `<a class="thumb" href="${esc(s.url)}" target="_blank" rel="noopener">PDF</a>` : `<a href="${esc(s.url)}" target="_blank" rel="noopener"><img src="${esc(s.url)}" alt="" loading="lazy"></a>`}
        <span class="name">${esc(s.file)}</span>
        <button class="btn small" data-sample="${esc(s.file)}" ${s.uploaded ? "disabled" : ""}>${s.uploaded ? "Added" : "Add"}</button>
      </li>`,
    )
    .join("");
  $("all-samples").disabled = samples.every((s) => s.uploaded);
  $("all-samples").dataset.names = JSON.stringify(samples.filter((s) => !s.uploaded).map((s) => s.file));
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

$("receipts").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-delete]");
  if (!btn) return;
  update(await api(`/api/receipts/${encodeURIComponent(btn.dataset.delete)}`, { method: "DELETE" }));
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
    alert(err.message);
  }
});

["f-search", "f-storage", "f-status"].forEach((id) => $(id).addEventListener("input", renderInventory));

$("reset").addEventListener("click", async () => {
  if (!confirm("Remove all receipts and usage changes?")) return;
  update(await api("/api/reset", { method: "POST" }));
  $("progress").innerHTML = "";
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
      b.textContent =
        "No Anthropic API key is set, so the sample receipts use results Claude would give for them. To read your own receipts, restart the server with ANTHROPIC_API_KEY set.";
    }
    await loadSamples();
  } catch (err) {
    $("subtitle").textContent = "Couldn't reach the server: " + err.message;
  }
})();
