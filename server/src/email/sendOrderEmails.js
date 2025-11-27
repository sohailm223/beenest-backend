import { transporter } from "./mailer.js";
import { customerTemplate, adminTemplate } from "./templates.js";

export async function sendOrderEmails(order) {
  const common = {
    from: `Beenest Magazine <${process.env.FROM_EMAIL}>`,
    replyTo: process.env.SUPPORT_EMAIL || process.env.FROM_EMAIL,
  };

  const toCustomer = transporter.sendMail({
    ...common,
    to: order.customer.email,
    subject: `Order confirmed — #${order.id}`,
    html: customerTemplate(order),
    text: `Thanks for your order #${order.id}. Total: ₹${order.total}.`, // plain-text fallback
  });

  const toAdmin = transporter.sendMail({
    ...common,
    to: process.env.ADMIN_EMAIL,
    subject: `New order #${order.id} — ₹${order.total}`,
    html: adminTemplate(order),
    text: `New order #${order.id} from ${order.customer.name} <${order.customer.email}>.`,
  });

  // Send in parallel:
  await Promise.allSettled([toCustomer, toAdmin]);
}
