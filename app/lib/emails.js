// Turns the fictional order emails in data/emails.json into the parts of a readable email.

const fmtDate = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** @returns {{greeting:string, paragraphs:string[], items:Array|null, after:string[], signoff:string}} */
export function emailParts(e, restaurant) {
  if (e.body) {
    const paras = e.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    return { greeting: "", paragraphs: paras.slice(0, -1), items: null, after: [], signoff: paras.at(-1) ?? "" };
  }
  const intro = {
    delivered: `Your order ${e.orderRef} was delivered on ${fmtDate(e.deliveryDate)}. Here's what we sent:`,
    dispatched: `Good news: order ${e.orderRef} is on its way and will arrive on ${fmtDate(e.deliveryDate)}.`,
    confirmed: `Thanks for your order. We've confirmed ${e.orderRef} for delivery on ${fmtDate(e.deliveryDate)}.`,
  }[e.status] ?? `Order ${e.orderRef}`;
  return {
    greeting: `Hi ${restaurant} team,`,
    paragraphs: [intro],
    items: e.items,
    after: [...(e.note ? [e.note] : []), "If anything is wrong with this order, just reply to this email."],
    signoff: e.fromName,
  };
}
