import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const FRONTEND_BASE_URL = (process.env.FRONTEND_BASE_URL || "https://beenest.in")
  .trim()
  .replace(/\/+$/, "");
const FALLBACK_ADMIN_EMAIL = "beenestmag@gmail.com";

const EMAIL_LOGO_URL = (
  process.env.EMAIL_LOGO_URL ||
  process.env.CONTACT_LOGO_URL ||
  "https://www.beenest.in/static/media/beenest_icon.761d0b8794d27179a786.webp"
).trim();

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatCurrency = (value = 0) => `Rs.${Number(value || 0)}`;

const formatDateTime = (value) => {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "N/A";
  return parsed.toLocaleString("en-IN", { hour12: true });
};

const formatAddress = (shippingInfo = {}) =>
  [shippingInfo.address, shippingInfo.city, shippingInfo.state, shippingInfo.zip]
    .filter(Boolean)
    .join(", ");

function getAdminRecipients() {
  const raw = [process.env.ADMIN_EMAIL, process.env.EMAIL_TO]
    .filter(Boolean)
    .join(",");

  const recipients = String(raw || FALLBACK_ADMIN_EMAIL)
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return Array.from(new Set(recipients));
}

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

function normalizeImageUrl(input) {
  if (!input) return "";
  if (typeof input === "string") return input;
  if (Array.isArray(input)) {
    return normalizeImageUrl(input[0]);
  }
  if (typeof input === "object") {
    if (typeof input.url === "string") return input.url;
    if (input.featuredImage) return normalizeImageUrl(input.featuredImage);
    if (input.imageUrl) return normalizeImageUrl(input.imageUrl);
  }
  return "";
}

function normalizeSlug(value = "") {
  return String(value || "").trim();
}

function resolveItemLink(item = {}) {
  if (item?.linkUrl) return String(item.linkUrl).trim();

  const slug = normalizeSlug(item.slug || item.articleSlug || item.magazineSlug);
  if (!slug) return "";

  const type = String(item.type || item.magazineType || "").toLowerCase();
  const encodedSlug = encodeURIComponent(slug);

  if (type.includes("article")) {
    return `${FRONTEND_BASE_URL}/article/${encodedSlug}`;
  }

  return `${FRONTEND_BASE_URL}/magazine/${encodedSlug}`;
}

function normalizePurchaseItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    name: String(item?.name || item?.title || "Magazine").trim(),
    price: Number(item?.price || item?.amount || item?.total || 0),
    quantity: Number(item?.quantity || 1),
    type: String(item?.type || item?.magazineType || "").trim() || "item",
    imageUrl: normalizeImageUrl(item?.imageUrl || item?.featuredImage || item?.thumbnail),
    linkUrl: resolveItemLink(item),
  }));
}

function buildMetaTable(rows = []) {
  const safeRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.label)
    .map(
      (row) => `
        <tr>
          <td style="padding:10px 12px;color:#374151;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.label)}</td>
          <td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;">${escapeHtml(
            row.value ?? "-"
          )}</td>
        </tr>
      `
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:20px;overflow:hidden;">
      ${safeRows || `<tr><td style="padding:12px;color:#6b7280;">No details available.</td></tr>`}
    </table>
  `;
}

function buildItemRows(items = []) {
  const normalized = normalizePurchaseItems(items);

  return normalized
    .map((item) => {
      const safeName = escapeHtml(item.name || "Item");
      const safeType = escapeHtml(String(item.type || "item").replaceAll("_", " "));
      const safePrice = formatCurrency(item.price || 0);
      const safeQty = Number(item.quantity || 1);
      const image = item.imageUrl
        ? `<img src="${escapeHtml(item.imageUrl)}" alt="${safeName}" width="72" height="96" style="display:block;border-radius:8px;object-fit:cover;" />`
        : `<div style="width:72px;height:96px;background:#f3f4f6;border-radius:8px;"></div>`;
      const link = item.linkUrl
        ? `<a href="${escapeHtml(item.linkUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;">Open</a>`
        : "-";

      return `
        <tr>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;">${image}</td>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;">${safeName}</td>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;color:#4b5563;font-size:13px;">${safeType}</td>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:14px;text-align:right;">${safeQty}</td>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:14px;text-align:right;">${safePrice}</td>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;text-align:right;">${link}</td>
        </tr>
      `;
    })
    .join("");
}

function buildItemsTable(items = [], title = "Purchased Items") {
  return `
    <h4 style="margin:0 0 8px;font-size:18px;">${escapeHtml(title)}</h4>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr>
          <th style="text-align:left;padding:12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">Image</th>
          <th style="text-align:left;padding:12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">Item</th>
          <th style="text-align:left;padding:12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">Type</th>
          <th style="text-align:right;padding:12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">Qty</th>
          <th style="text-align:right;padding:12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">Price</th>
          <th style="text-align:right;padding:12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">Link</th>
        </tr>
      </thead>
      <tbody>
        ${buildItemRows(items) || `<tr><td colspan="6" style="padding:12px;color:#6b7280;">No items available.</td></tr>`}
      </tbody>
    </table>
  `;
}

async function sendUserAndAdminEmails({
  userEmail,
  userSubject,
  userHtml,
  adminSubject,
  adminHtml,
}) {
  const jobs = [];

  if (userEmail) {
    jobs.push(
      transporter.sendMail({
        from: `"Beenest Magazine" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: userSubject,
        html: userHtml,
      })
    );
  }

  jobs.push(
    transporter.sendMail({
      from: `"Beenest Magazine" <${process.env.EMAIL_USER}>`,
      to: getAdminRecipients().join(","),
      subject: adminSubject,
      html: adminHtml,
    })
  );

  await Promise.all(jobs);
}

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
    const safePaymentMethod = escapeHtml(paymentMethod || "cod");

    const detailsRows = [
      { label: "Order ID", value: `#${safeOrderId}` },
      { label: "Order Date", value: formatDateTime(new Date().toISOString()) },
      { label: "Payment Method", value: safePaymentMethod },
      { label: "Payable Total", value: formatCurrency(totalAmount) },
    ];

    const customerHtml = renderEmailShell({
      title: "Order Confirmed",
      contentHtml: `
        <p style="margin:0 0 16px;color:#4b5563;">Hi ${safeName}, thank you for your order. We have received it successfully.</p>
        ${buildMetaTable(detailsRows)}
        ${buildItemsTable(cartItems, "Order Items")}
        <p style="margin:18px 0 0;color:#6b7280;font-size:13px;">For support, reply to this email.</p>
      `,
    });

    const adminHtml = renderEmailShell({
      title: "New Order Received",
      contentHtml: `
        ${buildMetaTable([
          ...detailsRows,
          { label: "Customer Name", value: safeName || "-" },
          { label: "Customer Email", value: safeEmail || "-" },
          { label: "Phone", value: safePhone || "-" },
          { label: "Address", value: safeAddress || "-" },
        ])}
        ${buildItemsTable(cartItems, "Order Items")}
      `,
    });

    await sendUserAndAdminEmails({
      userEmail,
      userSubject: `Beenest Order Confirmation - #${orderId}`,
      userHtml: customerHtml,
      adminSubject: `New Beenest Order - #${orderId}`,
      adminHtml,
    });
  } catch (err) {
    console.error("Failed to send order emails:", err);
  }
};

export const sendDigitalPurchaseEmails = async ({
  userEmail,
  userName,
  clerkId,
  orderId,
  paymentId,
  magazine,
}) => {
  try {
    const safeName = escapeHtml(userName || "Reader");
    const safeEmail = escapeHtml(userEmail || "");
    const safeClerkId = escapeHtml(clerkId || "");
    const safeOrderId = escapeHtml(orderId || "N/A");
    const safePaymentId = escapeHtml(paymentId || "N/A");

    const item = {
      name: magazine?.name || "Digital Issue",
      price: Number(magazine?.price || 0),
      slug: magazine?.slug || "",
      type: "digital_issue",
      featuredImage: magazine?.featuredImage || null,
      magazineType: magazine?.magazineType || "issue",
    };

    const details = [
      { label: "Purchase Type", value: "Digital Issue" },
      { label: "Order ID", value: safeOrderId },
      { label: "Payment ID", value: safePaymentId },
      { label: "Date", value: formatDateTime(new Date().toISOString()) },
      { label: "Amount", value: formatCurrency(magazine?.price || 0) },
    ];

    const customerHtml = renderEmailShell({
      title: "Digital Purchase Confirmed",
      contentHtml: `
        <p style="margin:0 0 16px;color:#4b5563;">Hi ${safeName}, your digital issue purchase is successful.</p>
        ${buildMetaTable(details)}
        ${buildItemsTable([item], "Purchased Digital Issue")}
      `,
    });

    const adminHtml = renderEmailShell({
      title: "New Digital Issue Purchase",
      contentHtml: `
        ${buildMetaTable([
          ...details,
          { label: "Customer Name", value: safeName || "-" },
          { label: "Customer Email", value: safeEmail || "-" },
          { label: "Clerk ID", value: safeClerkId || "-" },
        ])}
        ${buildItemsTable([item], "Purchased Digital Issue")}
      `,
    });

    await sendUserAndAdminEmails({
      userEmail,
      userSubject: "Beenest Digital Purchase Confirmation",
      userHtml: customerHtml,
      adminSubject: "New Digital Issue Purchase - Beenest",
      adminHtml,
    });
  } catch (err) {
    console.error("Failed to send digital purchase emails:", err);
  }
};

export const sendPaidArticlePurchaseEmails = async ({
  userEmail,
  userName,
  clerkId,
  orderId,
  paymentId,
  article,
}) => {
  try {
    const safeName = escapeHtml(userName || "Reader");
    const safeEmail = escapeHtml(userEmail || "");
    const safeClerkId = escapeHtml(clerkId || "");
    const safeOrderId = escapeHtml(orderId || "N/A");
    const safePaymentId = escapeHtml(paymentId || "N/A");

    const item = {
      name: article?.name || "Paid Article",
      price: Number(article?.price || 0),
      slug: article?.slug || "",
      type: "paid_article",
      featuredImage: article?.featuredImage || null,
      magazineType: "articlePaid",
    };

    const details = [
      { label: "Purchase Type", value: "Paid Article" },
      { label: "Order ID", value: safeOrderId },
      { label: "Payment ID", value: safePaymentId },
      { label: "Date", value: formatDateTime(new Date().toISOString()) },
      { label: "Amount", value: formatCurrency(article?.price || 0) },
    ];

    const customerHtml = renderEmailShell({
      title: "Paid Article Unlocked",
      contentHtml: `
        <p style="margin:0 0 16px;color:#4b5563;">Hi ${safeName}, your paid article purchase is successful.</p>
        ${buildMetaTable(details)}
        ${buildItemsTable([item], "Purchased Article")}
      `,
    });

    const adminHtml = renderEmailShell({
      title: "New Paid Article Purchase",
      contentHtml: `
        ${buildMetaTable([
          ...details,
          { label: "Customer Name", value: safeName || "-" },
          { label: "Customer Email", value: safeEmail || "-" },
          { label: "Clerk ID", value: safeClerkId || "-" },
        ])}
        ${buildItemsTable([item], "Purchased Article")}
      `,
    });

    await sendUserAndAdminEmails({
      userEmail,
      userSubject: "Beenest Paid Article Purchase Confirmation",
      userHtml: customerHtml,
      adminSubject: "New Paid Article Purchase - Beenest",
      adminHtml,
    });
  } catch (err) {
    console.error("Failed to send paid article emails:", err);
  }
};

export const sendNewsletterEmails = async ({ email, source = "website" }) => {
  try {
    const safeEmail = escapeHtml(email || "");
    const safeSource = escapeHtml(source);
    const safeDate = escapeHtml(formatDateTime(new Date().toISOString()));

    const customerHtml = renderEmailShell({
      title: "Newsletter Subscription Confirmed",
      contentHtml: `
        <p style="margin:0 0 12px;color:#4b5563;">
          Thank you for subscribing to the Beenest Magazine newsletter.
        </p>
        ${buildMetaTable([
          { label: "Email", value: safeEmail },
          { label: "Subscribed On", value: safeDate },
        ])}
        <p style="margin:16px 0 0;color:#6b7280;font-size:13px;">You will now receive updates, stories, and issue releases from Beenest.</p>
      `,
    });

    const adminHtml = renderEmailShell({
      title: "New Newsletter Signup",
      contentHtml: buildMetaTable([
        { label: "Email", value: safeEmail },
        { label: "Source", value: safeSource },
        { label: "Date", value: safeDate },
      ]),
    });

    await sendUserAndAdminEmails({
      userEmail: email,
      userSubject: "Welcome to Beenest Magazine Newsletter",
      userHtml: customerHtml,
      adminSubject: "New Newsletter Signup - Beenest Magazine",
      adminHtml,
    });
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
  includedItems = [],
}) => {
  try {
    const safeName = escapeHtml(userName || "Member");
    const safeEmail = escapeHtml(userEmail || "");
    const safeClerkId = escapeHtml(clerkId || "");
    const safePlan = escapeHtml(plan || "N/A");
    const safeStatus = escapeHtml(status || "N/A");

    const detailsRows = [
      { label: "Plan", value: safePlan },
      { label: "Status", value: safeStatus },
      { label: "Amount", value: formatCurrency(amount || 0) },
      { label: "Start Date", value: formatDateTime(startedAt) },
      { label: "Expiry Date", value: formatDateTime(expiresAt) },
      { label: "Payment ID", value: paymentId || "N/A" },
      { label: "Subscription ID", value: subscriptionId || "N/A" },
      { label: "Order ID", value: orderId || "N/A" },
    ];

    const includedSection = normalizePurchaseItems(includedItems).length
      ? `<div style="margin-top:14px;">${buildItemsTable(includedItems, "Included Issues / Access")}</div>`
      : "";

    const customerHtml = renderEmailShell({
      title: "Subscription Activated",
      contentHtml: `
        <p style="margin:0 0 14px;color:#4b5563;">Hi ${safeName}, your membership is now active.</p>
        ${buildMetaTable(detailsRows)}
        ${includedSection}
      `,
    });

    const adminHtml = renderEmailShell({
      title: "New Subscription Purchase",
      contentHtml: `
        <p style="margin:0 0 14px;color:#4b5563;">A user has purchased a subscription.</p>
        ${buildMetaTable([
          ...detailsRows,
          { label: "Customer Name", value: safeName || "-" },
          { label: "Customer Email", value: safeEmail || "-" },
          { label: "Clerk ID", value: safeClerkId || "-" },
        ])}
        ${includedSection}
      `,
    });

    await sendUserAndAdminEmails({
      userEmail,
      userSubject: "Beenest Membership Activated",
      userHtml: customerHtml,
      adminSubject: `New Subscription Purchase - ${safePlan}`,
      adminHtml,
    });
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

    const detailsRows = [
      { label: "Plan", value: safePlan },
      { label: "Cancelled On", value: formatDateTime(cancelledAt) },
      { label: "Subscription ID", value: subscriptionId || "N/A" },
      { label: "Last Payment ID", value: paymentId || "N/A" },
    ];

    const customerHtml = renderEmailShell({
      title: "Subscription Cancelled",
      contentHtml: `<p style="margin:0 0 14px;color:#4b5563;">Hi ${safeName}, your subscription has been cancelled successfully.</p>${buildMetaTable(
        detailsRows
      )}`,
    });

    const adminHtml = renderEmailShell({
      title: "Subscription Cancelled",
      contentHtml: `
        <p style="margin:0 0 14px;color:#4b5563;">A user cancelled their subscription.</p>
        ${buildMetaTable([
          ...detailsRows,
          { label: "Customer Name", value: safeName || "-" },
          { label: "Customer Email", value: safeEmail || "-" },
          { label: "Clerk ID", value: safeClerkId || "-" },
        ])}
      `,
    });

    await sendUserAndAdminEmails({
      userEmail,
      userSubject: "Beenest Membership Cancellation Confirmation",
      userHtml: customerHtml,
      adminSubject: `Subscription Cancelled - ${safePlan}`,
      adminHtml,
    });
  } catch (err) {
    console.error("Failed to send cancellation emails:", err);
  }
};