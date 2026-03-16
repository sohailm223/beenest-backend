// utils/sendEmail.js
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatCurrency = (value = 0) => `Rs.${Number(value || 0)}`;

const formatAddress = (shippingInfo = {}) =>
  [
    shippingInfo.address,
    shippingInfo.city,
    shippingInfo.state,
    shippingInfo.zip,
  ]
    .filter(Boolean)
    .join(", ");

const EMAIL_LOGO_URL = (
  process.env.EMAIL_LOGO_URL ||
  process.env.CONTACT_LOGO_URL ||
  "https://www.beenest.in/static/media/beenest_icon.761d0b8794d27179a786.webp"
).trim();

const renderEmailShell = ({ title, contentHtml }) => `
  <div style="margin:0;padding:24px;background:#f5f7fb;font-family:Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:18px 24px;border-bottom:1px solid #e5e7eb;background:#fff;">
          <img src="${escapeHtml(EMAIL_LOGO_URL)}" alt="Beenest" style="height:72px;max-width:220px;object-fit:contain;display:block;" />
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <h2 style="margin:0 0 14px;font-size:30px;color:#111827;">${escapeHtml(title || "Beenest Magazine")}</h2>
          ${contentHtml || ""}
        </td>
      </tr>
    </table>
  </div>
`;

const buildProductRowsForUser = (items = []) =>
  items
    .map((item) => {
      const title = escapeHtml(item?.name || "Magazine");
      const image = item?.featuredImage?.url || "";
      const price = formatCurrency(item?.price || 0);

      return `
        <tr>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;">
            ${
              image
                ? `<img src="${escapeHtml(image)}" alt="${title}" width="72" height="96" style="display:block;border-radius:8px;object-fit:cover;" />`
                : `<div style="width:72px;height:96px;background:#f3f4f6;border-radius:8px;"></div>`
            }
          </td>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;">${title}</td>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:14px;text-align:right;">${price}</td>
        </tr>
      `;
    })
    .join("");

const buildProductRowsForAdmin = (items = []) =>
  items
    .map((item, index) => {
      const title = escapeHtml(item?.name || "Magazine");
      const image = item?.featuredImage?.url || "";
      const price = formatCurrency(item?.price || 0);
      return `
        <tr>
          <td style="padding:10px;border:1px solid #e5e7eb;">${index + 1}</td>
          <td style="padding:10px;border:1px solid #e5e7eb;">${title}</td>
          <td style="padding:10px;border:1px solid #e5e7eb;">${price}</td>
          <td style="padding:10px;border:1px solid #e5e7eb;">${image ? `<a href="${escapeHtml(image)}" target="_blank">View Image</a>` : "-"}</td>
        </tr>
      `;
    })
    .join("");

export const sendOrderEmails = async ({
  userEmail,
  userName,
  orderId,
  totalAmount,
  cartItems = [],
  shippingInfo = {},
  paymentMethod = "cod",
}) => {
  try {
    const safeName = escapeHtml(userName || "Customer");
    const safeEmail = escapeHtml(userEmail || "");
    const safeOrderId = escapeHtml(orderId || "");
    const safePhone = escapeHtml(shippingInfo.phone || "");
    const safeAddress = escapeHtml(formatAddress(shippingInfo));
    const safeDate = escapeHtml(new Date().toLocaleString("en-IN", { hour12: true }));
    const safePaymentMethod = escapeHtml(paymentMethod);
    const productRowsUser = buildProductRowsForUser(cartItems);
    const productRowsAdmin = buildProductRowsForAdmin(cartItems);

    const customerHtml = renderEmailShell({
      title: "Order Confirmed",
      contentHtml: `
        <p style="margin:0 0 16px;color:#4b5563;">Hi ${safeName}, thank you for your order. We have received it successfully.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:20px;">
          <tr><td style="padding:10px 12px;color:#374151;border-bottom:1px solid #e5e7eb;">Order ID</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;">#${safeOrderId}</td></tr>
          <tr><td style="padding:10px 12px;color:#374151;border-bottom:1px solid #e5e7eb;">Order Date</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeDate}</td></tr>
          <tr><td style="padding:10px 12px;color:#374151;border-bottom:1px solid #e5e7eb;">Payment Method</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safePaymentMethod}</td></tr>
          <tr><td style="padding:10px 12px;color:#374151;">Payable Total</td><td style="padding:10px 12px;text-align:right;font-weight:700;">${formatCurrency(totalAmount)}</td></tr>
        </table>
        <h4 style="margin:0 0 8px;font-size:18px;">Ordered Items</h4>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <thead>
            <tr>
              <th style="text-align:left;padding:12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">Image</th>
              <th style="text-align:left;padding:12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">Product</th>
              <th style="text-align:right;padding:12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${productRowsUser || `<tr><td colspan="3" style="padding:12px;color:#6b7280;">No products available.</td></tr>`}
          </tbody>
        </table>
        <p style="margin:18px 0 0;color:#6b7280;font-size:13px;">For support, reply to this email.</p>
      `,
    });

    const adminHtml = renderEmailShell({
      title: "New Order Received",
      contentHtml: `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:20px;">
          <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Order ID</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">#${safeOrderId}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Date</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeDate}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Customer Name</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeName}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Customer Email</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeEmail}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Phone</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safePhone || "-"}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Address</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeAddress || "-"}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Payment Method</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safePaymentMethod}</td></tr>
          <tr><td style="padding:10px 12px;">Payable Total</td><td style="padding:10px 12px;text-align:right;font-weight:700;">${formatCurrency(totalAmount)}</td></tr>
        </table>
        <h4 style="margin:0 0 8px;font-size:18px;">Products</h4>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px;border:1px solid #e5e7eb;text-align:left;">#</th>
              <th style="padding:10px;border:1px solid #e5e7eb;text-align:left;">Product</th>
              <th style="padding:10px;border:1px solid #e5e7eb;text-align:left;">Price</th>
              <th style="padding:10px;border:1px solid #e5e7eb;text-align:left;">Image</th>
            </tr>
          </thead>
          <tbody>
            ${productRowsAdmin || `<tr><td colspan="4" style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">No products available.</td></tr>`}
          </tbody>
        </table>
      `,
    });

    await transporter.sendMail({
      from: `"Beenest Magazine" <${process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: `Beenest Magazine Order Confirmation - #${orderId}`,
      html: customerHtml,
    });

    await transporter.sendMail({
      from: `"Beenest Magazine" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `New Beenest Order Received - #${orderId}`,
      html: adminHtml,
    });

    console.log("Emails sent successfully");
  } catch (err) {
    console.error("Failed to send emails:", err);
  }
};

export const sendNewsletterEmails = async ({ email, source = "website" }) => {
  try {
    const safeEmail = escapeHtml(email || "");
    const safeSource = escapeHtml(source);
    const safeDate = escapeHtml(new Date().toLocaleString("en-IN", { hour12: true }));

    const customerHtml = renderEmailShell({
      title: "Newsletter Subscription Confirmed",
      contentHtml: `
        <p style="margin:0 0 12px;color:#4b5563;">
          Thank you for subscribing to the Beenest Magazine newsletter.
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:8px;">
          <tr><td style="padding:10px 12px;color:#374151;border-bottom:1px solid #e5e7eb;">Email</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeEmail}</td></tr>
          <tr><td style="padding:10px 12px;color:#374151;">Subscribed On</td><td style="padding:10px 12px;text-align:right;">${safeDate}</td></tr>
        </table>
        <p style="margin:16px 0 0;color:#6b7280;font-size:13px;">You will now receive updates, stories, and issue releases from Beenest.</p>
      `,
    });

    const adminHtml = renderEmailShell({
      title: "New Newsletter Signup",
      contentHtml: `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:8px;">
          <tr><td style="padding:10px 12px;color:#374151;border-bottom:1px solid #e5e7eb;">Email</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeEmail}</td></tr>
          <tr><td style="padding:10px 12px;color:#374151;border-bottom:1px solid #e5e7eb;">Source</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeSource}</td></tr>
          <tr><td style="padding:10px 12px;color:#374151;">Date</td><td style="padding:10px 12px;text-align:right;">${safeDate}</td></tr>
        </table>
      `,
    });

    await Promise.all([
      transporter.sendMail({
        from: `"Beenest Magazine" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Welcome to Beenest Magazine Newsletter",
        html: customerHtml,
      }),
      transporter.sendMail({
        from: `"Beenest Magazine" <${process.env.EMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: "New Newsletter Signup - Beenest Magazine",
        html: adminHtml,
      }),
    ]);
  } catch (err) {
    console.error("Failed to send newsletter emails:", err);
    throw err;
  }
};

export const sendSubscriptionEmails = async ({
  userEmail,
  userName,
  clerkId,
  plan,
  status,
  startedAt,
  expiresAt,
  amount,
  paymentId,
  subscriptionId,
  orderId,
}) => {
  try {
    const safeName = escapeHtml(userName || "Member");
    const safeEmail = escapeHtml(userEmail || "");
    const safeClerkId = escapeHtml(clerkId || "");
    const safePlan = escapeHtml(plan || "N/A");
    const safeStatus = escapeHtml(status || "N/A");
    const safeStartedAt = escapeHtml(startedAt ? new Date(startedAt).toLocaleString("en-IN", { hour12: true }) : "N/A");
    const safeExpiresAt = escapeHtml(expiresAt ? new Date(expiresAt).toLocaleString("en-IN", { hour12: true }) : "N/A");
    const safePaymentId = escapeHtml(paymentId || "N/A");
    const safeSubscriptionId = escapeHtml(subscriptionId || "N/A");
    const safeOrderId = escapeHtml(orderId || "N/A");
    const safeAmount = formatCurrency(amount || 0);

    const detailsTable = `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:8px;">
        <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Plan</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safePlan}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Status</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeStatus}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Amount</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeAmount}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Start Date</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeStartedAt}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Expiry Date</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeExpiresAt}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Payment ID</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safePaymentId}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Subscription ID</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeSubscriptionId}</td></tr>
        <tr><td style="padding:10px 12px;">Order ID</td><td style="padding:10px 12px;text-align:right;">${safeOrderId}</td></tr>
      </table>
    `;

    const customerHtml = renderEmailShell({
      title: "Subscription Activated",
      contentHtml: `<p style="margin:0 0 14px;color:#4b5563;">Hi ${safeName}, your membership is now active.</p>${detailsTable}`,
    });

    const adminHtml = renderEmailShell({
      title: "New Subscription Purchase",
      contentHtml: `
        <p style="margin:0 0 14px;color:#4b5563;">A user has purchased a subscription.</p>
        ${detailsTable}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;border:1px solid #e5e7eb;border-radius:8px;">
          <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Customer Name</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeName}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Customer Email</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeEmail || "-"}</td></tr>
          <tr><td style="padding:10px 12px;">Clerk ID</td><td style="padding:10px 12px;text-align:right;">${safeClerkId || "-"}</td></tr>
        </table>
      `,
    });

    const jobs = [];
    if (userEmail) {
      jobs.push(
        transporter.sendMail({
          from: `"Beenest Magazine" <${process.env.EMAIL_USER}>`,
          to: userEmail,
          subject: "Beenest Membership Activated",
          html: customerHtml,
        })
      );
    }

    jobs.push(
      transporter.sendMail({
        from: `"Beenest Magazine" <${process.env.EMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `New Subscription Purchase - ${safePlan}`,
        html: adminHtml,
      })
    );

    await Promise.all(jobs);
  } catch (err) {
    console.error("Failed to send subscription emails:", err);
  }
};

export const sendSubscriptionCancelledEmails = async ({
  userEmail,
  userName,
  clerkId,
  plan,
  cancelledAt,
  paymentId,
  subscriptionId,
}) => {
  try {
    const safeName = escapeHtml(userName || "Member");
    const safeEmail = escapeHtml(userEmail || "");
    const safeClerkId = escapeHtml(clerkId || "");
    const safePlan = escapeHtml(plan || "N/A");
    const safeCancelledAt = escapeHtml(
      cancelledAt ? new Date(cancelledAt).toLocaleString("en-IN", { hour12: true }) : "N/A"
    );
    const safePaymentId = escapeHtml(paymentId || "N/A");
    const safeSubscriptionId = escapeHtml(subscriptionId || "N/A");

    const detailsTable = `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:8px;">
        <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Plan</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safePlan}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Cancelled On</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeCancelledAt}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Subscription ID</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeSubscriptionId}</td></tr>
        <tr><td style="padding:10px 12px;">Last Payment ID</td><td style="padding:10px 12px;text-align:right;">${safePaymentId}</td></tr>
      </table>
    `;

    const customerHtml = renderEmailShell({
      title: "Subscription Cancelled",
      contentHtml: `<p style="margin:0 0 14px;color:#4b5563;">Hi ${safeName}, your subscription has been cancelled successfully.</p>${detailsTable}`,
    });

    const adminHtml = renderEmailShell({
      title: "Subscription Cancelled",
      contentHtml: `
        <p style="margin:0 0 14px;color:#4b5563;">A user cancelled their subscription.</p>
        ${detailsTable}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;border:1px solid #e5e7eb;border-radius:8px;">
          <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Customer Name</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeName}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Customer Email</td><td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">${safeEmail || "-"}</td></tr>
          <tr><td style="padding:10px 12px;">Clerk ID</td><td style="padding:10px 12px;text-align:right;">${safeClerkId || "-"}</td></tr>
        </table>
      `,
    });

    const jobs = [];
    if (userEmail) {
      jobs.push(
        transporter.sendMail({
          from: `"Beenest Magazine" <${process.env.EMAIL_USER}>`,
          to: userEmail,
          subject: "Beenest Membership Cancellation Confirmation",
          html: customerHtml,
        })
      );
    }

    jobs.push(
      transporter.sendMail({
        from: `"Beenest Magazine" <${process.env.EMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `Subscription Cancelled - ${safePlan}`,
        html: adminHtml,
      })
    );

    await Promise.all(jobs);
  } catch (err) {
    console.error("Failed to send cancellation emails:", err);
  }
};
