const money = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

const itemsTable = (items = []) => `
  <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
    <thead>
      <tr>
        <th align="left">Item</th>
        <th align="center">Qty</th>
        <th align="right">Price</th>
      </tr>
    </thead>
    <tbody>
      ${items
        .map(
          (it) => `
        <tr>
          <td>${it.title || it.name}</td>
          <td align="center">${it.qty || 1}</td>
          <td align="right">${money(it.price)}</td>
        </tr>`
        )
        .join("")}
    </tbody>
  </table>
`;

export function customerTemplate(order) {
  return `
  <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:620px;margin:auto">
    <h2>Thanks for your order, ${order.customer.name || "there"}!</h2>
    <p>Your order <strong>#${order.id}</strong> has been received.</p>
    ${itemsTable(order.items)}
    <p style="text-align:right;margin-top:8px"><strong>Total: ${money(order.total)}</strong></p>
    <p style="margin-top:16px">We’ll email you again when it’s ready.</p>
    <p style="color:#666">Need help? Reply to this email or write to ${process.env.SUPPORT_EMAIL}.</p>
  </div>`;
}

export function adminTemplate(order) {
  return `
  <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:620px;margin:auto">
    <h2>🛒 New order #${order.id}</h2>
    <p><strong>Customer:</strong> ${order.customer.name} &lt;${order.customer.email}&gt;</p>
    <p><strong>Type:</strong> ${order.type}</p>
    ${itemsTable(order.items)}
    <p style="text-align:right;margin-top:8px"><strong>Total: ${money(order.total)}</strong></p>
  </div>`;
}
