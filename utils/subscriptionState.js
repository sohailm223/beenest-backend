import fetch from "node-fetch";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { FREE_DIGITAL_LIMIT, FREE_ORDER_LIMIT } from "../config/subscriptionBenefits.js";
import {
  buildSubscriptionAccessCode,
  computeIssueEntitlements,
  syncMembershipSelectedIssues,
} from "./subscriptionEntitlements.js";

function safeDate(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function dateOnlyToIso(value) {
  if (!value) return null;
  return safeDate(`${value}T00:00:00.000Z`);
}

function normalizeFromClerk(subscription = {}) {
  const status = String(subscription?.status || "inactive").toLowerCase();
  const startedAt = safeDate(subscription?.startedAt);
  const expiresAt = safeDate(subscription?.expiresAt);
  const accessType = String(subscription?.accessType || "owner").toLowerCase();
  return {
    status,
    plan: subscription?.plan || null,
    startedAt,
    expiresAt,
    accessType,
    paymentProvider: subscription?.paymentProvider || "razorpay",
    paymentId: subscription?.paymentId || null,
    orderId: subscription?.orderId || subscription?.subscriptionId || null,
    subscriptionId: subscription?.subscriptionId || subscription?.orderId || null,
    freeOrderLimit: Number(subscription?.freeOrderLimit || FREE_ORDER_LIMIT),
    freeDigitalLimit: Number(subscription?.freeDigitalLimit || FREE_DIGITAL_LIMIT),
    freeOrderUsed: Number(subscription?.freeOrderUsed || 0),
    freeDigitalUsed: Number(subscription?.freeDigitalUsed || 0),
  };
}

function normalizeStatus(planStatus, endDateIso) {
  const status = String(planStatus || "").toLowerCase();
  if (status === "cancelled") return "cancelled";
  if (status === "expired") return "expired";
  if (status === "active") {
    if (!endDateIso) return "active";
    return new Date(endDateIso).getTime() > Date.now() ? "active" : "expired";
  }
  return "inactive";
}

export async function fetchLatestHygraphMembership(clerkId) {
  if (!process.env.HYGRAPH_API || !process.env.HYGRAPH_TOKEN || !clerkId) return null;

  const query = `
    query LatestMembership($clerkId: String!) {
      memberships(
        where: { customer_some: { clerkId_in: [$clerkId] } }
        first: 20
        orderBy: startDate_DESC
      ) {
        id
        planId
        planStatus
        startDate
        endDate
        razorpayPaymentId
        razorpaySubscriptionId
        selectedIssues {
          id
        }
      }
    }
  `;

  const response = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({
      query,
      variables: { clerkId },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload?.errors?.length) {
    throw new Error(JSON.stringify(payload?.errors || payload));
  }

  const memberships = Array.isArray(payload?.data?.memberships) ? payload.data.memberships : [];
  if (!memberships.length) return null;

  const now = Date.now();
  const activeMembership = memberships.find((item) => {
    if (String(item?.planStatus || "").toLowerCase() !== "active") return false;
    if (!item?.endDate) return true;
    return new Date(item.endDate).getTime() > now;
  });

  return activeMembership || memberships[0];
}

export function normalizeFromHygraphMembership(hygraphMembership, clerkSubscription = {}) {
  if (!hygraphMembership) return normalizeFromClerk(clerkSubscription);

  const startedAt = dateOnlyToIso(hygraphMembership?.startDate);
  const expiresAt = safeDate(hygraphMembership?.endDate);
  const status = normalizeStatus(hygraphMembership?.planStatus, expiresAt);
  const clerkNormalized = normalizeFromClerk(clerkSubscription);

  return {
    ...clerkNormalized,
    status,
    plan: hygraphMembership?.planId || clerkNormalized.plan,
    startedAt: startedAt || clerkNormalized.startedAt,
    expiresAt: expiresAt || clerkNormalized.expiresAt,
    paymentId: hygraphMembership?.razorpayPaymentId || clerkNormalized.paymentId,
    orderId: hygraphMembership?.razorpaySubscriptionId || clerkNormalized.orderId,
    subscriptionId: hygraphMembership?.razorpaySubscriptionId || clerkNormalized.subscriptionId,
    paymentProvider: "razorpay",
    selectedIssueIds: (hygraphMembership?.selectedIssues || []).map((item) => item?.id).filter(Boolean),
  };
}

function hasChanged(existing = {}, next = {}) {
  return (
    String(existing?.status || "") !== String(next?.status || "") ||
    String(existing?.plan || "") !== String(next?.plan || "") ||
    String(existing?.startedAt || "") !== String(next?.startedAt || "") ||
    String(existing?.expiresAt || "") !== String(next?.expiresAt || "") ||
    String(existing?.accessType || "") !== String(next?.accessType || "") ||
    String(existing?.paymentId || "") !== String(next?.paymentId || "") ||
    String(existing?.subscriptionId || "") !== String(next?.subscriptionId || "") ||
    String(existing?.orderId || "") !== String(next?.orderId || "")
  );
}

export async function resolveSubscriptionForUser(clerkId, { syncClerk = true } = {}) {
  const clerkUser = await clerkClient.users.getUser(clerkId);
  const existingPublicMetadata = clerkUser?.publicMetadata || {};
  const existingSubscription = existingPublicMetadata?.subscription || {};

  let hygraphMembership = null;
  try {
    hygraphMembership = await fetchLatestHygraphMembership(clerkId);
  } catch (error) {
    console.warn("Hygraph membership fetch failed:", error?.message);
  }

  let subscription = normalizeFromHygraphMembership(hygraphMembership, existingSubscription);
  let issueEntitlements = Array.isArray(subscription?.selectedIssueIds)
    ? subscription.selectedIssueIds
    : [];
  let slotCount = issueEntitlements.length;

  if (hygraphMembership && String(subscription?.status || "") === "active") {
    try {
      const computed = await computeIssueEntitlements(subscription?.plan || hygraphMembership?.planId);
      slotCount = computed.slotCount;
      issueEntitlements = computed.issueIds;

      if (hygraphMembership?.id) {
        await syncMembershipSelectedIssues({
          membershipId: hygraphMembership.id,
          issueIds: issueEntitlements,
        });
      }

      subscription = {
        ...subscription,
        selectedIssueIds: issueEntitlements,
      };
    } catch (error) {
      console.warn("Entitlement sync failed:", error?.message);
    }
  }

  const source = hygraphMembership ? "hygraph" : "clerk";
  const accessCode = buildSubscriptionAccessCode(subscription?.subscriptionId || subscription?.orderId);
  const canShare = String(subscription?.plan || "").toLowerCase().includes("premium");

  if (syncClerk && hasChanged(existingSubscription, subscription)) {
    await clerkClient.users.updateUser(clerkId, {
      publicMetadata: {
        ...existingPublicMetadata,
        subscription,
      },
    });
  }

  return {
    source,
    subscription,
    entitlements: {
      slotCount,
      issueIds: issueEntitlements,
      accessCode: canShare ? accessCode : null,
      canShare,
    },
    clerkUser,
  };
}
