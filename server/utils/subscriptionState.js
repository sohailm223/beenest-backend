import fetch from "node-fetch";
import { clerkClient } from "@clerk/clerk-sdk-node";
import {
  buildSubscriptionAccessCode,
  canShareForPlan,
  computeIssueEntitlements,
  normalizePlanKey,
  syncMembershipSelectedIssues,
} from "./subscriptionEntitlements.js";

function normalizeSharedReaders(list = []) {
  const map = new Map();
  for (const entry of Array.isArray(list) ? list : []) {
    const clerkId = String(entry?.clerkId || "").trim();
    if (!clerkId) continue;
    const redeemedAt = entry?.redeemedAt ? safeDate(entry.redeemedAt) : null;
    map.set(clerkId, {
      clerkId,
      name: String(entry?.name || "").trim(),
      email: String(entry?.email || "").trim(),
      redeemedAt,
    });
  }
  return Array.from(map.values());
}

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

function normalizeStatus(status, expiresAt) {
  const value = String(status || "").toLowerCase();
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  if (value === "expired") return "expired";
  if (value === "active") {
    if (!expiresAt) return "active";
    return new Date(expiresAt).getTime() > Date.now() ? "active" : "expired";
  }
  return "inactive";
}

function normalizeFromClerk(subscription = {}) {
  const planKey = normalizePlanKey(subscription?.planKey || subscription?.plan || "");
  const sharedReaders = normalizeSharedReaders(subscription?.sharedReaders);
  const sharedReaderLimit = Math.max(1, Number(subscription?.sharedReaderLimit || 100));
  return {
    status: normalizeStatus(subscription?.status, subscription?.expiresAt),
    plan: subscription?.plan || planKey,
    planKey,
    planType: subscription?.planType || null,
    durationType: subscription?.durationType || null,
    startedAt: safeDate(subscription?.startedAt),
    expiresAt: safeDate(subscription?.expiresAt),
    accessType: String(subscription?.accessType || "owner").toLowerCase(),
    paymentProvider: subscription?.paymentProvider || "razorpay",
    paymentId: subscription?.paymentId || null,
    orderId: subscription?.orderId || null,
    subscriptionId: subscription?.subscriptionId || subscription?.orderId || null,
    issueSlotCount: Number(subscription?.issueSlotCount || 0),
    selectedIssueIds: Array.isArray(subscription?.selectedIssueIds)
      ? subscription.selectedIssueIds.filter(Boolean)
      : [],
    printEntitled: Boolean(subscription?.printEntitled),
    digitalEntitled: Boolean(subscription?.digitalEntitled),
    canShare: Boolean(subscription?.canShare),
    sharedReaderLimit,
    sharedReaderUsed: Number(subscription?.sharedReaderUsed || sharedReaders.length || 0),
    sharedReaders,
    freeOrderUsedByIssue:
      subscription?.freeOrderUsedByIssue && typeof subscription.freeOrderUsedByIssue === "object"
        ? subscription.freeOrderUsedByIssue
        : {},
  };
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
  const active = memberships.find((item) => {
    const status = String(item?.planStatus || "").toLowerCase();
    if (status !== "active") return false;
    if (!item?.endDate) return true;
    return new Date(item.endDate).getTime() > now;
  });
  return active || memberships[0];
}

function normalizeFromHygraphMembership(hygraphMembership, clerkSubscription = {}) {
  if (!hygraphMembership) return normalizeFromClerk(clerkSubscription);

  const fallback = normalizeFromClerk(clerkSubscription);
  const planKey = normalizePlanKey(hygraphMembership?.planId || fallback.planKey || fallback.plan);
  const startedAt = dateOnlyToIso(hygraphMembership?.startDate) || fallback.startedAt;
  const expiresAt = safeDate(hygraphMembership?.endDate) || fallback.expiresAt;
  const status = normalizeStatus(hygraphMembership?.planStatus, expiresAt);

  return {
    ...fallback,
    status,
    plan: hygraphMembership?.planId || fallback.plan || planKey,
    planKey,
    startedAt,
    expiresAt,
    paymentId: hygraphMembership?.razorpayPaymentId || fallback.paymentId,
    orderId: hygraphMembership?.razorpaySubscriptionId || fallback.orderId,
    subscriptionId: hygraphMembership?.razorpaySubscriptionId || fallback.subscriptionId,
    selectedIssueIds: (hygraphMembership?.selectedIssues || []).map((item) => item?.id).filter(Boolean),
  };
}

function hasChanged(existing = {}, next = {}) {
  return JSON.stringify(existing || {}) !== JSON.stringify(next || {});
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
  let entitlements = {
    slotCount: Number(subscription?.issueSlotCount || 0),
    issueIds: Array.isArray(subscription?.selectedIssueIds) ? subscription.selectedIssueIds : [],
    accessCode: null,
    canShare: false,
    sharedReaderLimit: Number(subscription?.sharedReaderLimit || 0),
    sharedReaderUsed: Number(subscription?.sharedReaderUsed || 0),
    sharedReaders: Array.isArray(subscription?.sharedReaders) ? subscription.sharedReaders : [],
  };

  if (String(subscription?.status || "") === "active") {
    try {
      const computed = await computeIssueEntitlements(
        subscription?.planKey || subscription?.plan,
        subscription?.selectedIssueIds
      );
      entitlements = {
        slotCount: computed.slotCount,
        issueIds: computed.issueIds,
        accessCode: null,
        canShare: computed.canShare,
        sharedReaderLimit: Number(subscription?.sharedReaderLimit || 0),
        sharedReaderUsed: Number(subscription?.sharedReaderUsed || 0),
        sharedReaders: Array.isArray(subscription?.sharedReaders) ? subscription.sharedReaders : [],
      };
      subscription = {
        ...subscription,
        planKey: computed.planKey,
        planType: computed.planType,
        durationType: computed.durationType,
        issueSlotCount: computed.slotCount,
        selectedIssueIds: computed.issueIds,
        printEntitled: computed.printEntitled,
        digitalEntitled: computed.digitalEntitled,
        canShare: computed.canShare,
      };

      if (hygraphMembership?.id) {
        await syncMembershipSelectedIssues({
          membershipId: hygraphMembership.id,
          issueIds: computed.issueIds,
        });
      }
    } catch (error) {
      console.warn("Entitlement compute/sync failed:", error?.message);
    }
  } else {
    subscription = {
      ...subscription,
      canShare: canShareForPlan(subscription?.planKey || subscription?.plan),
    };
    entitlements = {
      ...entitlements,
      canShare: subscription.canShare,
      sharedReaderLimit: Number(subscription?.sharedReaderLimit || 0),
      sharedReaderUsed: Number(subscription?.sharedReaderUsed || 0),
      sharedReaders: Array.isArray(subscription?.sharedReaders) ? subscription.sharedReaders : [],
    };
  }

  const accessCode = subscription?.canShare
    ? buildSubscriptionAccessCode(
        subscription?.subscriptionId || subscription?.orderId,
        subscription?.accessType === "owner" ? clerkId : subscription?.sharedByClerkId || ""
      )
    : null;
  entitlements.accessCode = accessCode;

  if (syncClerk && hasChanged(existingSubscription, subscription)) {
    await clerkClient.users.updateUser(clerkId, {
      publicMetadata: {
        ...existingPublicMetadata,
        subscription,
      },
    });
  }

  return {
    source: hygraphMembership ? "hygraph" : "clerk",
    subscription,
    entitlements,
    clerkUser,
  };
}
