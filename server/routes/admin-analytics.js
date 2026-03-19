import express from "express";
import fetch from "node-fetch";
import { clerkClient } from "@clerk/clerk-sdk-node";

const router = express.Router();

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseMembershipDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday start
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function isSameOrAfter(input, threshold) {
  if (!input || !threshold) return false;
  return input.getTime() >= threshold.getTime();
}

function getAdminAllowlist() {
  const raw = String(process.env.ADMIN_ANALYTICS_CLERK_IDS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAdminEmailAllowlist() {
  const raw = String(process.env.ADMIN_ANALYTICS_EMAILS || "beenestmag@gmail.com").trim();
  if (!raw) return ["beenestmag@gmail.com"];
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function canAccessAnalytics(clerkId) {
  if (!clerkId) return false;

  const clerkIdAllowlist = getAdminAllowlist();
  if (clerkIdAllowlist.includes(clerkId)) {
    return true;
  }

  try {
    const user = await clerkClient.users.getUser(clerkId);
    const adminEmails = getAdminEmailAllowlist();
    const userEmails = (user?.emailAddresses || [])
      .map((item) => String(item?.emailAddress || "").trim().toLowerCase())
      .filter(Boolean);

    return userEmails.some((email) => adminEmails.includes(email));
  } catch {
    return false;
  }
}

async function hygraphRequest(query, variables = {}) {
  const response = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload?.errors?.length) {
    throw new Error(JSON.stringify(payload?.errors || payload));
  }
  return payload?.data || {};
}

router.post("/admin/analytics", async (req, res) => {
  try {
    const { clerkId } = req.body || {};
    if (!clerkId) {
      return res.status(400).json({ success: false, error: "clerkId is required" });
    }
    if (!(await canAccessAnalytics(clerkId))) {
      return res.status(403).json({ success: false, error: "You do not have access to analytics" });
    }

    const data = await hygraphRequest(
      `
        query AdminAnalyticsData($ordersLimit: Int!, $membershipsLimit: Int!) {
          orders(first: $ordersLimit, orderBy: createdAt_DESC) {
            id
            clerkId
            totalAmount
            paymentMethod
            orderStatus
            createdAt
            shippingName
            shippingEmail
            shippingAddress
            items {
              magazine {
                id
                name
                slug
                magazineType
              }
            }
          }
          memberships(first: $membershipsLimit, orderBy: startDate_DESC) {
            id
            planId
            amount
            planStatus
            startDate
            endDate
            razorpayPaymentId
            razorpaySubscriptionId
            customer {
              clerkId
              name
              email
            }
          }
        }
      `,
      { ordersLimit: 500, membershipsLimit: 500 }
    );

    const orders = Array.isArray(data?.orders) ? data.orders : [];
    const memberships = Array.isArray(data?.memberships) ? data.memberships : [];

    const now = new Date();
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);

    const normalizedOrders = orders.map((order) => {
      const createdAt = parseDate(order?.createdAt);
      const itemTypes = (order?.items || [])
        .map((item) => item?.magazine?.magazineType)
        .filter(Boolean);
      const isDigitalOrder =
        String(order?.shippingAddress || "").toLowerCase() === "digital order" ||
        itemTypes.some((t) => String(t || "").toLowerCase().includes("digital"));

      return {
        id: order?.id,
        type: "order",
        createdAt,
        amount: toNumber(order?.totalAmount),
        orderStatus: order?.orderStatus || "",
        paymentMethod: order?.paymentMethod || "",
        customerName: order?.shippingName || "Customer",
        customerEmail: order?.shippingEmail || "",
        customerClerkId: order?.clerkId || "",
        itemCount: Array.isArray(order?.items) ? order.items.length : 0,
        itemTypes,
        isDigitalOrder,
      };
    });

    const normalizedMemberships = memberships.map((membership) => {
      const createdAt = parseMembershipDate(membership?.startDate);
      const linkedCustomer = Array.isArray(membership?.customer)
        ? membership.customer[0]
        : membership?.customer || {};

      return {
        id: membership?.id,
        type: "subscription",
        createdAt,
        amount: toNumber(membership?.amount),
        planId: membership?.planId || "",
        planStatus: membership?.planStatus || "",
        customerName: linkedCustomer?.name || "Member",
        customerEmail: linkedCustomer?.email || "",
        customerClerkId: linkedCustomer?.clerkId || "",
      };
    });

    const ordersThisWeek = normalizedOrders.filter((o) => isSameOrAfter(o.createdAt, weekStart));
    const ordersThisMonth = normalizedOrders.filter((o) => isSameOrAfter(o.createdAt, monthStart));
    const membershipsThisWeek = normalizedMemberships.filter((m) => isSameOrAfter(m.createdAt, weekStart));
    const membershipsThisMonth = normalizedMemberships.filter((m) => isSameOrAfter(m.createdAt, monthStart));

    const purchases = [...normalizedOrders, ...normalizedMemberships]
      .filter((entry) => entry.createdAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const buyersMap = new Map();
    purchases.forEach((entry) => {
      const key = entry.customerEmail || entry.customerClerkId || entry.customerName;
      if (!key) return;
      const existing = buyersMap.get(key) || {
        key,
        name: entry.customerName || "Customer",
        email: entry.customerEmail || "",
        clerkId: entry.customerClerkId || "",
        purchases: 0,
        totalSpend: 0,
      };
      existing.purchases += 1;
      existing.totalSpend += toNumber(entry.amount);
      buyersMap.set(key, existing);
    });

    const topBuyers = Array.from(buyersMap.values())
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 20);

    const mailStats = {
      subscription: {
        userThisWeek: membershipsThisWeek.length,
        adminThisWeek: membershipsThisWeek.length,
        userThisMonth: membershipsThisMonth.length,
        adminThisMonth: membershipsThisMonth.length,
      },
      productPurchase: {
        userThisWeek: ordersThisWeek.length,
        adminThisWeek: ordersThisWeek.length,
        userThisMonth: ordersThisMonth.length,
        adminThisMonth: ordersThisMonth.length,
      },
      digitalPurchase: {
        userThisWeek: 0,
        adminThisWeek: 0,
        userThisMonth: 0,
        adminThisMonth: 0,
        note: "Digital purchase email logging is not connected yet.",
      },
      contact: {
        userThisWeek: 0,
        adminThisWeek: 0,
        userThisMonth: 0,
        adminThisMonth: 0,
        note: "Contact submission history is not persisted yet.",
      },
      newsletter: {
        userThisWeek: 0,
        adminThisWeek: 0,
        userThisMonth: 0,
        adminThisMonth: 0,
        note: "Newsletter send history is not persisted yet.",
      },
    };

    const summary = {
      now: now.toISOString(),
      weekStart: weekStart.toISOString(),
      monthStart: monthStart.toISOString(),
      purchases: {
        totalCount: purchases.length,
        thisWeekCount: ordersThisWeek.length + membershipsThisWeek.length,
        thisMonthCount: ordersThisMonth.length + membershipsThisMonth.length,
      },
      revenue: {
        total: purchases.reduce((sum, entry) => sum + toNumber(entry.amount), 0),
        thisWeek:
          ordersThisWeek.reduce((sum, entry) => sum + toNumber(entry.amount), 0) +
          membershipsThisWeek.reduce((sum, entry) => sum + toNumber(entry.amount), 0),
        thisMonth:
          ordersThisMonth.reduce((sum, entry) => sum + toNumber(entry.amount), 0) +
          membershipsThisMonth.reduce((sum, entry) => sum + toNumber(entry.amount), 0),
      },
      orders: {
        total: normalizedOrders.length,
        thisWeek: ordersThisWeek.length,
        thisMonth: ordersThisMonth.length,
      },
      subscriptions: {
        total: normalizedMemberships.length,
        thisWeek: membershipsThisWeek.length,
        thisMonth: membershipsThisMonth.length,
      },
    };

    return res.json({
      success: true,
      summary,
      mailStats,
      recentPurchases: purchases.slice(0, 100),
      topBuyers,
      accessControl: {
        usesAllowlist: getAdminAllowlist().length > 0,
        envKey: "ADMIN_ANALYTICS_CLERK_IDS",
        envEmailKey: "ADMIN_ANALYTICS_EMAILS",
      },
    });
  } catch (error) {
    console.error("admin analytics error:", error?.message || error);
    return res.status(500).json({
      success: false,
      error: "Unable to load analytics",
    });
  }
});

router.post("/admin/assigned-issues", async (req, res) => {
  try {
    const { clerkId } = req.body || {};
    if (!clerkId) {
      return res.status(400).json({ success: false, error: "clerkId is required" });
    }
    if (!(await canAccessAnalytics(clerkId))) {
      return res.status(403).json({ success: false, error: "You do not have access to assigned issues" });
    }

    const data = await hygraphRequest(
      `
        query AdminAssignedIssues($limit: Int!) {
          memberships(first: $limit, orderBy: startDate_DESC) {
            id
            planId
            planStatus
            startDate
            endDate
            customer {
              clerkId
              name
              email
            }
            selectedIssues {
              id
              name
              slug
            }
          }
        }
      `,
      { limit: 500 }
    );

    const memberships = Array.isArray(data?.memberships) ? data.memberships : [];
    const rows = memberships.map((membership) => {
      const customer = Array.isArray(membership?.customer) ? membership.customer[0] : membership?.customer || {};
      const issues = Array.isArray(membership?.selectedIssues) ? membership.selectedIssues : [];

      return {
        membershipId: membership?.id,
        customerClerkId: customer?.clerkId || "",
        customerName: customer?.name || "",
        customerEmail: customer?.email || "",
        planId: membership?.planId || "",
        planStatus: membership?.planStatus || "",
        startDate: membership?.startDate || null,
        endDate: membership?.endDate || null,
        issueCount: issues.length,
        issues: issues.map((issue) => ({
          id: issue?.id,
          name: issue?.name || "Issue",
          slug: issue?.slug || "",
        })),
      };
    });

    const customers = new Set(
      rows
        .map((row) => row.customerClerkId || row.customerEmail || "")
        .filter(Boolean)
    );

    const totalAssignedIssues = rows.reduce((sum, row) => sum + Number(row.issueCount || 0), 0);

    return res.json({
      success: true,
      summary: {
        totalCustomers: customers.size,
        totalMemberships: rows.length,
        totalAssignedIssues,
      },
      rows,
    });
  } catch (error) {
    console.error("admin assigned issues error:", error?.message || error);
    return res.status(500).json({
      success: false,
      error: "Unable to load assigned issues",
    });
  }
});

export default router;
