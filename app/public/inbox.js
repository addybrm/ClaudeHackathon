let emails = [];
let statuses = new Map();
let today = "";
let selected = location.hash.slice(1) || null;

const BADGE = {
  matched: ["good", "✓ Matched to receipt"],
  discrepancy: ["warn", "Receipt doesn't match"],
  awaiting_receipt: ["", "Delivered, waiting for receipt"],
  incoming: ["info", "Arriving"],
  info: ["", "Not an order"],
};

function badgeHtml(e) {
  const st = statuses.get(e.id) ?? { badge: "info" };
  const [cls, label] = BADGE[st.badge];
  const text = st.badge === "incoming" ? `${label} ${shortDate(e.deliveryDate)}` : label;
  return `<span class="pill ${cls}">${esc(text)}</span>`;
}

function sentLabel(iso) {
  const d = iso.slice(0, 10);
  if (d === today) return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return shortDate(d);
}

function renderList(flashIds = []) {
  document.getElementById("list").innerHTML = emails
    .map(
      (e) => `<li class="${e.id === selected ? "active" : ""} ${flashIds.includes(e.id) ? "flash" : ""}">
        <button data-id="${esc(e.id)}">
          <div class="from"><span>${esc(e.fromName)}</span><time>${esc(sentLabel(e.sentAt))}</time></div>
          <div class="subject">${esc(e.subject)}</div>
          ${badgeHtml(e)}
        </button>
      </li>`,
    )
    .join("");
}

function renderView() {
  const view = document.getElementById("view");
  const e = emails.find((x) => x.id === selected);
  if (!e) {
    view.innerHTML = `<div class="empty">Choose an email</div>`;
    return;
  }
  const st = statuses.get(e.id);
  const link = st?.receiptId ? `<a href="/#${esc(st.receiptId)}" target="larder-app">Open in LarderCheck</a>` : "";
  view.innerHTML = `
    <h2>${esc(e.subject)}</h2>
    <div class="hdr">
      <span>From: ${esc(e.fromName)} &lt;${esc(e.from)}&gt;</span>
      <span>Sent: ${esc(new Date(e.sentAt).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }))}</span>
    </div>
    <div class="status-line">${badgeHtml(e)} ${link}</div>
    <pre>${esc(e.body)}</pre>`;
}

async function load(flash = false) {
  const before = new Map(statuses);
  const data = await api("/api/emails");
  emails = data.emails;
  today = data.today;
  statuses = new Map(data.statuses.map((s) => [s.id, s]));
  document.getElementById("mailbox").textContent = data.mailbox;
  if (!selected && emails.length) selected = emails[0].id;
  const changed = flash ? data.statuses.filter((s) => before.get(s.id)?.badge !== s.badge).map((s) => s.id) : [];
  renderList(changed);
  renderView();
}

document.getElementById("list").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-id]");
  if (!btn) return;
  selected = btn.dataset.id;
  history.replaceState(null, "", "#" + selected);
  renderList();
  renderView();
});

window.addEventListener("hashchange", () => {
  selected = location.hash.slice(1) || selected;
  renderList();
  renderView();
});

// Update live when receipts are added in the other tab; poll as a fallback.
channel?.addEventListener("message", () => load(true));
setInterval(() => load(true).catch(() => {}), 5000);
load().catch((err) => (document.getElementById("view").textContent = "Couldn't load emails: " + err.message));
