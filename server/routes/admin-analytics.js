import express from "express";
import fetch from "node-fetch";
import { clerkClient } from "@clerk/clerk-sdk-node";
import {
  MEMBERSHIP_PLAN_CATALOG,
  computeIssueEntitlements,
  getPlanConfig,
  normalizePlanKey,
} from "../utils/subscriptionEntitlements.js";

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

function dateOnly(value) {
  if (!value) return null;
  return String(value).split("T")[0];
}

function parseDateOnlyInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function addDaysIso(dateIso, days = 365) {
  const d = new Date(dateIso);
  d.setUTCDate(d.getUTCDate() + Number(days || 365));
  return d.toISOString();
}

function getPrimaryEmailAddress(user) {
  return (
    user?.emailAddresses?.find((item) => item.id === user.primaryEmailAddressId)?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    ""
  );
}

function getDisplayNameFromEmail(email = "") {
  const localPart = String(email || "").split("@")[0] || "Member";
  const tokens = localPart
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return "Member";
  return tokens.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

async function findUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;

  try {
    const result = await clerkClient.users.getUserList({
      emailAddress: [normalized],
      limit: 1,
    });
    const direct = Array.isArray(result?.data) ? result.data[0] : null;
    if (direct) return direct;
  } catch {
    // Fallback below.
  }

  let offset = 0;
  while (true) {
    const result = await clerkClient.users.getUserList({ limit: 100, offset });
    const users = Array.isArray(result?.data) ? result.data : [];
    const match = users.find((candidate) => {
      const emails = (candidate?.emailAddresses || [])
        .map((entry) => String(entry?.emailAddress || "").trim().toLowerCase())
        .filter(Boolean);
      return emails.includes(normalized);
    });
    if (match) return match;

    offset += users.length;
    const totalCount = Number(result?.totalCount || 0);
    if (!users.length || (totalCount > 0 && offset >= totalCount)) break;
  }

  return null;
}

async function ensureHygraphCustomer({ clerkId, email, name }) {
  const existing = await hygraphRequest(
    `
      query ExistingCustomer($clerkId: String!) {
        customer(where: { clerkId: $clerkId }) {
          id
          clerkId
          email
          name
        }
      }
    `,
    { clerkId }
  );

  if (existing?.customer?.id) {
    return existing.customer;
  }

  const created = await hygraphRequest(
    `
      mutation CreateCustomer($clerkId: String!, $email: String!, $name: String!) {
        createCustomer(
          data: {
            clerkId: $clerkId
            email: $email
            name: $name
          }
        ) {
          id
          clerkId
          email
          name
        }
      }
    `,
    {
      clerkId,
      email,
      name,
    }
  );

  const customer = created?.createCustomer;
  if (!customer?.id) {
    throw new Error("Unable to create customer in Hygraph");
  }

  await hygraphRequest(
    `
      mutation PublishCustomer($id: ID!) {
        publishCustomer(where: { id: $id }) {
          id
        }
      }
    `,
    { id: customer.id }
  );

  return customer;
}

async function createHygraphMembership({
  clerkId,
  planKey,
  amount,
  paymentId,
  subscriptionId,
  startedAt,
  expiresAt,
  issueIds = [],
}) {
  const created = await hygraphRequest(
    `
      mutation CreateMembership(
        $clerkId: String!
        $paymentId: String!
        $subscriptionId: String!
        $planId: String!
        $amount: Int!
        $planStatus: UserPlanStatus!
        $startDate: Date!
        $endDate: DateTime
        $selectedIssues: [MagazineWhereUniqueInput!]
      ) {
        createMembership(
          data: {
            razorpayPaymentId: $paymentId
            razorpaySubscriptionId: $subscriptionId
            planId: $planId
            amount: $amount
            planStatus: $planStatus
            startDate: $startDate
            endDate: $endDate
            selectedIssues: { connect: $selectedIssues }
            customer: { connect: { clerkId: $clerkId } }
          }
        ) {
          id
        }
      }
    `,
    {
      clerkId,
      paymentId,
      subscriptionId,
      planId: planKey,
      amount: Number(amount || 0),
      planStatus: "active",
      startDate: dateOnly(startedAt),
      endDate: expiresAt,
      selectedIssues: issueIds.map((id) => ({ id })),
    }
  );

  const membershipId = created?.createMembership?.id;
  if (!membershipId) {
    throw new Error("Unable to create membership in Hygraph");
  }

  await hygraphRequest(
    `
      mutation PublishMembership($id: ID!) {
        publishMembership(where: { id: $id }) {
          id
        }
      }
    `,
    { id: membershipId }
  );

  return membershipId;
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

router.post("/admin/manual-subscriber", async (req, res) => {
  try {
    const { adminClerkId, email, password, planKey, startDate } = req.body || {};

    if (!adminClerkId) {
      return res.status(400).json({ success: false, error: "adminClerkId is required" });
    }
    if (!email || !planKey) {
      return res.status(400).json({ success: false, error: "email and planKey are required" });
    }
    if (!(await canAccessAnalytics(adminClerkId))) {
      return res.status(403).json({ success: false, error: "You do not have access to this action" });
    }

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const requestedPlanKey = String(planKey || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!MEMBERSHIP_PLAN_CATALOG[requestedPlanKey]) {
      return res.status(400).json({ success: false, error: "Invalid planKey" });
    }

    const normalizedPlanKey = normalizePlanKey(requestedPlanKey);
    const plan = getPlanConfig(normalizedPlanKey);
    const parsedStartDate = parseDateOnlyInput(startDate) || new Date();
    const startedAt = new Date(
      Date.UTC(
        parsedStartDate.getUTCFullYear(),
        parsedStartDate.getUTCMonth(),
        parsedStartDate.getUTCDate(),
        0,
        0,
        0,
        0
      )
    ).toISOString();
    const expiresAt = addDaysIso(startedAt, Number(plan.validityDays || 365));

    let user = await findUserByEmail(normalizedEmail);
    const userWasCreated = !user;
    if (!user) {
      if (!password || String(password).length < 8) {
        return res.status(400).json({
          success: false,
          error: "Password with minimum 8 characters is required for new user",
        });
      }

      const displayName = getDisplayNameFromEmail(normalizedEmail);
      user = await clerkClient.users.createUser({
        emailAddress: [normalizedEmail],
        password: String(password),
        firstName: displayName.split(" ")[0] || "Member",
      });
    }

    const clerkId = user?.id;
    if (!clerkId) {
      return res.status(500).json({ success: false, error: "Unable to resolve subscriber user" });
    }

    const entitlements = await computeIssueEntitlements(plan.key, []);
    const nowStamp = Date.now();
    const suffix = Math.random().toString(36).slice(2, 8);
    const paymentId = `manual_pay_${nowStamp}_${suffix}`;
    const subscriptionId = `manual_sub_${nowStamp}_${suffix}`;

    const customerName =
      user?.fullName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      getDisplayNameFromEmail(normalizedEmail);

    await ensureHygraphCustomer({
      clerkId,
      email: getPrimaryEmailAddress(user) || normalizedEmail,
      name: customerName,
    });

    const membershipId = await createHygraphMembership({
      clerkId,
      planKey: plan.key,
      amount: Number(plan.amount || 0),
      paymentId,
      subscriptionId,
      startedAt,
      expiresAt,
      issueIds: entitlements.issueIds,
    });

    const existingPublicMetadata = user?.publicMetadata || {};
    const subscriptionMetadata = {
      status: "active",
      plan: plan.label,
      planKey: plan.key,
      planType: plan.planType,
      durationType: plan.durationType,
      startedAt,
      expiresAt,
      accessType: "owner",
      paymentProvider: "manual",
      paymentId,
      orderId: subscriptionId,
      subscriptionId,
      issueSlotCount: entitlements.slotCount,
      selectedIssueIds: entitlements.issueIds,
      printEntitled: plan.printEntitled,
      digitalEntitled: plan.digitalEntitled,
      canShare: plan.canShare,
      sharedReaderLimit: 100,
      sharedReaderUsed: 0,
      sharedReaders: [],
      freeOrderUsedByIssue: {},
    };

    await clerkClient.users.updateUser(clerkId, {
      publicMetadata: {
        ...existingPublicMetadata,
        subscription: subscriptionMetadata,
      },
    });

    return res.json({
      success: true,
      message: "Subscriber added successfully",
      data: {
        membershipId,
        user: {
          clerkId,
          email: getPrimaryEmailAddress(user) || normalizedEmail,
          name: customerName,
          created: userWasCreated,
        },
        subscription: {
          planKey: plan.key,
          planLabel: plan.label,
          startDate: dateOnly(startedAt),
          endDate: dateOnly(expiresAt),
          amount: Number(plan.amount || 0),
          status: "active",
        },
      },
    });
  } catch (error) {
    console.error("manual subscriber creation error:", error?.message || error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Unable to add subscriber manually",
    });
  }
});

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
