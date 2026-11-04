let emails = [];
let statuses = new Map();
let today = "";
let selected = location.hash.slice(1) || null;
let box = "all";
const opened = new Set(selected ? [selected] : []);
const $ = (id) => document.getElementById(id);

const BADGE = {
  matched: ["good", "Matched to receipt"],
  discrepancy: ["warn", "Receipt doesn't match"],
  awaiting_receipt: ["", "Waiting for receipt"],
  incoming: ["info", "Arriving"],
  info: ["", "Not an order"],
};

const BOXES = [
  ["all", "Inbox", () => true],
  ["awaiting_receipt", "Waiting for receipt", (b) => b === "awaiting_receipt"],
  ["incoming", "On its way", (b) => b === "incoming"],
  ["discrepancy", "Needs checking", (b) => b === "discrepancy"],
  ["matched", "Matched", (b) => b === "matched"],
];

const badgeOf = (e) => statuses.get(e.id)?.badge ?? "info";

function badgeHtml(e) {
  const b = badgeOf(e);
  const [cls, label] = BADGE[b];
  return `<span class="pill ${cls}">${esc(b === "incoming" ? `${label} ${shortDate(e.deliveryDate)}` : label)}</span>`;
}

function sentLabel(iso) {
  const d = iso.slice(0, 10);
  if (d === today) return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return shortDate(d);
}

const initials = (name) => name.split(/\s+/).filter((w) => /^[A-Z]/i.test(w) && !/^(ltd|co)$/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

function renderBoxes() {
  $("boxes").innerHTML = BOXES.map(([id, label, test]) => {
    const n = emails.filter((e) => test(badgeOf(e))).length;
    return `<button type="button" class="side-item ${box === id ? "active" : ""}" data-box="${id}">
      <span class="ico"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">${
        id === "all" ? '<path d="M2 9h3l1 2h4l1-2h3"/><path d="M3.5 3.5h9L14 9v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9Z"/>'
        : id === "incoming" ? '<path d="M1.5 4.5h8v6h-8zM9.5 7h3l2 2v1.5h-5"/><circle cx="4" cy="11.5" r="1.2"/><circle cx="12" cy="11.5" r="1.2"/>'
        : id === "matched" ? '<circle cx="8" cy="8" r="5.5"/><path d="m5.5 8 1.8 1.8L10.8 6.3"/>'
        : id === "discrepancy" ? '<path d="M8 2.5 14 13H2Z"/><path d="M8 6.5v3M8 11.2v.1"/>'
        : '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>'
      }</svg></span>${esc(label)}<span class="count">${n || ""}</span>
    </button>`;
  }).join("");
}

function visibleEmails() {
  const test = BOXES.find(([id]) => id === box)[2];
  return emails.filter((e) => test(badgeOf(e)));
}

function renderList(flashIds = []) {
  const list = visibleEmails();
  $("list").innerHTML = list.length
    ? list
        .map(
          (e) => `<li class="${e.id === selected ? "active" : ""} ${flashIds.includes(e.id) ? "flash" : ""}">
        <button class="msg" data-id="${esc(e.id)}">
          ${opened.has(e.id) ? "" : `<span class="unread" aria-label="Unread"></span>`}
          <div class="from"><span>${esc(e.fromName)}</span><time>${esc(sentLabel(e.sentAt))}</time></div>
          <div class="subject">${esc(e.subject)}</div>
          ${badgeHtml(e)}
        </button>
      </li>`,
        )
        .join("")
    : `<li class="mail-empty">No emails here.</li>`;
}

function itemsTable(items) {
  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  return `<div class="list"><div class="table-wrap"><table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
    <tbody>${items
      .map((i) => `<tr><td>${esc(i.ingredient)}</td><td class="num">${qty(i.quantity)} ${esc(i.unit)}</td><td class="num">${gbp(i.unitPrice)}</td><td class="num">${gbp(i.quantity * i.unitPrice)}</td></tr>`)
      .join("")}</tbody>
    <tfoot><tr><td colspan="3">Order total</td><td class="num">${gbp(total)}</td></tr></tfoot>
  </table></div></div>`;
}

function renderView(animate = false) {
  const view = $("view");
  const e = emails.find((x) => x.id === selected);
  if (!e) {
    view.innerHTML = `<div class="mail-empty">Choose an email to read it.</div>`;
    return;
  }
  const st = statuses.get(e.id);
  const p = e.parts;
  const link = st?.receiptId ? `<a href="/#receipts" target="larder-app">See the receipt in LarderCheck</a>` : "";
  view.innerHTML = `
    <div class="mail-top">
      <div class="avatar" style="background:${colourFor(e.fromName)}">${supplierPhoto(e.fromName) ? `<img src="${supplierPhoto(e.fromName)}" alt="${esc(e.fromName)}">` : esc(initials(e.fromName))}</div>
      <div class="who"><b>${esc(e.fromName)}</b><div>${esc(e.from)}</div><div>To: ${esc(mailboxName)}</div></div>
      <time>${esc(new Date(e.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }))}</time>
    </div>
    <h2>${esc(e.subject)}</h2>
    <div class="mail-status">${badgeHtml(e)} ${link}</div>
    <div class="mail-body">
      ${p.greeting ? `<p>${esc(p.greeting)}</p>` : ""}
      ${p.paragraphs.map((t) => `<p>${esc(t)}</p>`).join("")}
      ${p.items ? itemsTable(p.items) : ""}
      ${p.after.map((t) => `<p>${esc(t)}</p>`).join("")}
      <p>${esc(p.signoff)}</p>
    </div>`;
  if (animate && !reduceMotion) {
    view.classList.remove("swap");
    void view.offsetWidth;
    view.classList.add("swap");
  }
}

let mailboxName = "";
async function load(flash = false) {
  const before = new Map([...statuses].map(([k, v]) => [k, v.badge]));
  const data = await api("/api/emails");
  emails = data.emails;
  today = data.today;
  mailboxName = data.mailbox;
  statuses = new Map(data.statuses.map((s) => [s.id, s]));
  $("mailbox").textContent = `— ${data.mailbox}`;
  if (!selected && emails.length) {
    selected = emails[0].id;
    opened.add(selected);
  }
  const changed = flash ? data.statuses.filter((s) => before.has(s.id) && before.get(s.id) !== s.badge).map((s) => s.id) : [];
  renderBoxes();
  renderList(changed);
  if (!flash || changed.includes(selected)) renderView(!flash);
}

function select(id) {
  selected = id;
  opened.add(id);
  history.replaceState(null, "", "#" + id);
  renderList();
  renderView(true);
}

$("list").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-id]");
  if (btn) select(btn.dataset.id);
});
$("list").addEventListener("keydown", (ev) => {
  if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
  const list = visibleEmails();
  const i = list.findIndex((e) => e.id === selected);
  const next = list[Math.max(0, Math.min(list.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)))];
  if (next) {
    ev.preventDefault();
    select(next.id);
    $("list").querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.focus();
  }
});
$("boxes").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-box]");
  if (!btn) return;
  box = btn.dataset.box;
  renderBoxes();
  renderList();
});
window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (id && id !== selected) {
    box = "all";
    renderBoxes();
    select(id);
  }
});

// Update live when receipts are added in the other tab; poll as a fallback.
channel?.addEventListener("message", () => load(true));
setInterval(() => load(true).catch(() => {}), 5000);
load().catch((err) => ($("view").textContent = "Couldn't load emails: " + err.message));
