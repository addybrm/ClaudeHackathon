// Turns the fictional order emails in data/emails.json into readable email bodies.

const fmtDate = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function table(items) {
  const rows = items.map((i) => {
    const total = (i.quantity * i.unitPrice).toFixed(2);
    return `${i.ingredient.padEnd(26)}${`${i.quantity} ${i.unit}`.padStart(10)}${`£${i.unitPrice.toFixed(2)}`.padStart(10)}${`£${total}`.padStart(10)}`;
  });
  const sum = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  return [
    `${"Item".padEnd(26)}${"Qty".padStart(10)}${"Price".padStart(10)}${"Total".padStart(10)}`,
    "-".repeat(56),
    ...rows,
    "-".repeat(56),
    `${"Order total".padEnd(46)}${`£${sum.toFixed(2)}`.padStart(10)}`,
  ].join("\n");
}

export function emailBody(e, restaurant) {
  if (e.body) return e.body;
  const intro = {
    delivered: `Your order ${e.orderRef} was delivered on ${fmtDate(e.deliveryDate)}. Here's what we sent:`,
    dispatched: `Good news: order ${e.orderRef} is on its way and will arrive on ${fmtDate(e.deliveryDate)}.`,
    confirmed: `Thanks for your order. We've confirmed ${e.orderRef} for delivery on ${fmtDate(e.deliveryDate)}.`,
  }[e.status] ?? `Order ${e.orderRef}`;
  return [
    `Hi ${restaurant} team,`,
    "",
    intro,
    "",
    table(e.items),
    "",
    ...(e.note ? [e.note, ""] : []),
    "If anything is wrong with this order, just reply to this email.",
    "",
    e.fromName,
  ].join("\n");
}
