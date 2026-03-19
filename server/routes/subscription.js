// server/routes/subscription.js
import express from "express";
// import Razorpay from "razorpay";
import { razorpay, razorpayKeyId } from "../config/razorpay.js";
import { clerkClient } from "@clerk/clerk-sdk-node";
import fetch from "node-fetch";
import { sendSubscriptionCancelledEmails } from "../utils/sendEmail.js";
import {
  canShareForPlan,
  getPlanConfig,
  normalizePlanKey,
  parseSubscriptionAccessCodePayload,
} from "../utils/subscriptionEntitlements.js";

import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const SHARED_READER_LIMIT = 100;
const CLERK_PAGE_SIZE = 100;

function getPrimaryEmailAddress(user) {
  return (
    user?.emailAddresses?.find((email) => email.id === user.primaryEmailAddressId)?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    ""
  );
}

function getDisplayName(user) {
  return (
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    getPrimaryEmailAddress(user) ||
    "Reader"
  );
}

function toIsoOrNow(value) {
  const time = value ? new Date(value).getTime() : NaN;
  if (Number.isNaN(time)) return new Date().toISOString();
  return new Date(time).toISOString();
}

function normalizeSharedReaders(list = []) {
  const map = new Map();
  for (const entry of Array.isArray(list) ? list : []) {
    const clerkId = String(entry?.clerkId || "").trim();
    if (!clerkId) continue;
    map.set(clerkId, {
      clerkId,
      name: String(entry?.name || "").trim(),
      email: String(entry?.email || "").trim(),
      redeemedAt: toIsoOrNow(entry?.redeemedAt),
    });
  }
  return Array.from(map.values());
}

async function findOwnerUserBySubscriptionId(subscriptionId, ownerClerkIdHint = "") {
  const target = String(subscriptionId || "").trim();
  if (!target) return null;

  const hintedOwnerId = String(ownerClerkIdHint || "").trim();
  if (hintedOwnerId) {
    try {
      const hintedUser = await clerkClient.users.getUser(hintedOwnerId);
      const hintedSubscription = hintedUser?.publicMetadata?.subscription || {};
      const accessType = String(hintedSubscription?.accessType || "owner").toLowerCase();
      const ownerSubscriptionId = String(
        hintedSubscription?.subscriptionId || hintedSubscription?.orderId || ""
      ).trim();
      if (accessType === "owner" && ownerSubscriptionId === target) {
        return hintedUser;
      }
    } catch {
      // Fall back to legacy scan below.
    }
  }

  let offset = 0;
  while (true) {
    const response = await clerkClient.users.getUserList({
      limit: CLERK_PAGE_SIZE,
      offset,
    });

    const users = Array.isArray(response?.data) ? response.data : [];
    const ownerUser = users.find((candidate) => {
      const subscription = candidate?.publicMetadata?.subscription || {};
      const accessType = String(subscription?.accessType || "owner").toLowerCase();
      const ownerSubscriptionId = String(
        subscription?.subscriptionId || subscription?.orderId || ""
      ).trim();
      return accessType === "owner" && ownerSubscriptionId && ownerSubscriptionId === target;
    });

    if (ownerUser) return ownerUser;

    offset += users.length;
    const totalCount = Number(response?.totalCount || 0);
    if (!users.length || (totalCount > 0 && offset >= totalCount)) break;
  }

  return null;
}

async function markHygraphMembershipCancelled(subscriptionId, cancelledAt) {
  if (!process.env.HYGRAPH_API || !process.env.HYGRAPH_TOKEN) return;

  const mutation = `
    mutation CancelMembership($subscriptionId: String!, $endDate: DateTime) {
      updateMembership(
        where: { razorpaySubscriptionId: $subscriptionId }
        data: { planStatus: cancelled, endDate: $endDate }
      ) {
        id
      }
      publishMembership(where: { razorpaySubscriptionId: $subscriptionId }) {
        id
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
      query: mutation,
      variables: {
        subscriptionId,
        endDate: cancelledAt,
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload?.errors?.length) {
    throw new Error(JSON.stringify(payload?.errors || payload));
  }
}

// const razorpay = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_KEY_SECRET,
// });

// POST /api/subscription/create
router.post("/create", async (req, res) => {
  try {
    const { planId } = req.body; // Pass Razorpay Plan ID from frontend
    if (!planId) {
      return res.status(400).json({ success: false, message: "Plan ID is required" });
    }

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      customer_notify: 1,
      total_count: 3, // e.g. 3 billing cycles for 3 months
    });

    res.json({
      success: true,
      subscriptionId: subscription.id,
      key: razorpayKeyId,
    });
  } catch (error) {
    console.error("❌ Error creating subscription:", error);
    res.status(500).json({ success: false, message: "Failed to create subscription" });
  }
});

// POST /api/subscription/cancel
router.post("/cancel", async (req, res) => {
  try {
    const { subscriptionId, clerkId } = req.body;
    if (!subscriptionId || !clerkId) {
      return res.status(400).json({
        success: false,
        error: "subscriptionId and clerkId are required",
      });
    }

    if (String(subscriptionId).startsWith("sub_")) {
      await razorpay.subscriptions.cancel(subscriptionId, {
        cancel_at_cycle_end: false,
      });
    }

    const user = await clerkClient.users.getUser(clerkId);
    const existing = user?.publicMetadata || {};
    const existingSubscription = existing?.subscription || {};
    const accessType = String(existingSubscription?.accessType || "").toLowerCase();
    if (accessType === "shared") {
      return res.status(403).json({
        success: false,
        error: "Shared access users cannot cancel this subscription",
      });
    }
    const cancelledAt = new Date().toISOString();

    await clerkClient.users.updateUser(clerkId, {
      publicMetadata: {
        ...existing,
        subscription: {
          ...existingSubscription,
          status: "cancelled",
          cancelledAt,
        },
      },
    });

    try {
      await markHygraphMembershipCancelled(subscriptionId, cancelledAt);
    } catch (hygraphError) {
      console.error("Hygraph cancellation update failed:", hygraphError.message);
    }

    const userEmail =
      user?.emailAddresses?.find(
        (email) => email.id === user.primaryEmailAddressId
      )?.emailAddress ||
      user?.emailAddresses?.[0]?.emailAddress ||
      "";
    const userName =
      user?.fullName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      user?.username ||
      "Member";

    try {
      await sendSubscriptionCancelledEmails({
        userEmail,
        userName,
        clerkId,
        plan: existingSubscription?.plan || "N/A",
        cancelledAt,
        paymentId: existingSubscription?.paymentId || "",
        subscriptionId,
      });
    } catch (emailError) {
      console.error("Cancellation email error:", emailError);
    }

    return res.json({ success: true, message: "Subscription cancelled" });
  } catch (error) {
    console.error("Subscription cancel error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/subscription/pause (stub: Razorpay API does not support pause for all plans)
router.post("/pause", async (req, res) => {
  return res.status(400).json({
    success: false,
    error: "Pause is not supported in current subscription setup",
  });
});

// POST /api/subscription/redeem-access-code
router.post("/redeem-access-code", async (req, res) => {
  try {
    const { clerkId, accessCode } = req.body || {};
    if (!clerkId || !accessCode) {
      return res.status(400).json({
        success: false,
        error: "clerkId and accessCode are required",
      });
    }

    const accessPayload = parseSubscriptionAccessCodePayload(accessCode);
    const subscriptionId = accessPayload?.subscriptionId || null;
    if (!subscriptionId) {
      return res.status(400).json({ success: false, error: "Invalid access code" });
    }

    const query = `
      query MembershipAndCustomer($subscriptionId: String!, $clerkId: String!) {
        membership(where: { razorpaySubscriptionId: $subscriptionId }) {
          id
          planId
          planStatus
          endDate
          selectedIssues {
            id
          }
        }
        customer(where: { clerkId: $clerkId }) {
          id
        }
      }
    `;

    const lookupRes = await fetch(process.env.HYGRAPH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query,
        variables: { subscriptionId, clerkId },
      }),
    });

    const lookupPayload = await lookupRes.json();
    if (!lookupRes.ok || lookupPayload?.errors?.length) {
      throw new Error(JSON.stringify(lookupPayload?.errors || lookupPayload));
    }

    const membership = lookupPayload?.data?.membership;
    const customer = lookupPayload?.data?.customer;
    if (!membership?.id) {
      return res.status(404).json({ success: false, error: "Subscription not found for this code" });
    }
    if (!customer?.id) {
      return res.status(404).json({ success: false, error: "Customer not found for this user" });
    }

    const planKey = normalizePlanKey(membership?.planId || "");
    if (!canShareForPlan(planKey)) {
      return res.status(403).json({
        success: false,
        error: "Access code sharing is available only for digital or bundle plans",
      });
    }

    const status = String(membership?.planStatus || "").toLowerCase();
    const endDateMs = membership?.endDate ? new Date(membership.endDate).getTime() : Infinity;
    const isActive = status === "active" && endDateMs > Date.now();
    if (!isActive) {
      return res.status(403).json({
        success: false,
        error: "This access code is no longer active",
      });
    }

    const ownerUser = await findOwnerUserBySubscriptionId(
      subscriptionId,
      accessPayload?.ownerClerkId || ""
    );
    if (!ownerUser?.id) {
      return res.status(404).json({
        success: false,
        error: "Subscription owner not found for this access code",
      });
    }

    const ownerMetadata = ownerUser?.publicMetadata || {};
    const ownerSubscription = ownerMetadata?.subscription || {};
    const sharedReaderLimit = Math.max(
      1,
      Number(ownerSubscription?.sharedReaderLimit || SHARED_READER_LIMIT)
    );
    const sharedReaders = normalizeSharedReaders(ownerSubscription?.sharedReaders);
    const isOwnerRedeeming = String(ownerUser.id) === String(clerkId);
    const alreadyRedeemed = sharedReaders.some((item) => item.clerkId === clerkId);

    if (!isOwnerRedeeming && !alreadyRedeemed && sharedReaders.length >= sharedReaderLimit) {
      return res.status(403).json({
        success: false,
        error: `Reader seat limit reached (${sharedReaderLimit}) for this subscription`,
      });
    }

    const mutate = `
      mutation RedeemCode($membershipId: ID!, $customerId: ID!) {
        updateMembership(
          where: { id: $membershipId }
          data: {
            customer: { connect: { where: { id: $customerId } } }
          }
        ) {
          id
        }
        publishMembership(where: { id: $membershipId }) {
          id
        }
      }
    `;

    const updateRes = await fetch(process.env.HYGRAPH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: mutate,
        variables: {
          membershipId: membership.id,
          customerId: customer.id,
        },
      }),
    });
    const updatePayload = await updateRes.json();
    if (!updateRes.ok || updatePayload?.errors?.length) {
      throw new Error(JSON.stringify(updatePayload?.errors || updatePayload));
    }

    try {
      const user = await clerkClient.users.getUser(clerkId);
      const existing = user?.publicMetadata || {};
      const existingSubscription = existing?.subscription || {};
      const plan = getPlanConfig(planKey);

      const isOwnerActive =
        String(existingSubscription?.status || "").toLowerCase() === "active" &&
        String(existingSubscription?.accessType || "owner").toLowerCase() === "owner" &&
        (!existingSubscription?.expiresAt ||
          new Date(existingSubscription.expiresAt).getTime() > Date.now());

      // Do not override an existing paid owner membership with shared access.
      if (!isOwnerActive) {
        await clerkClient.users.updateUser(clerkId, {
          publicMetadata: {
            ...existing,
            subscription: {
              ...existingSubscription,
              status: "active",
              planKey,
              plan: membership?.planId || existingSubscription?.plan || "Shared Access",
              planType: plan?.planType || "digital",
              durationType: plan?.durationType || "single",
              startedAt: existingSubscription?.startedAt || new Date().toISOString(),
              expiresAt: membership?.endDate || existingSubscription?.expiresAt || null,
              printEntitled: false,
              digitalEntitled: true,
              canShare: false,
              issueSlotCount: Number(plan?.slotCount || 1),
              selectedIssueIds: (membership?.selectedIssues || [])
                .map((item) => item?.id)
                .filter(Boolean),
              accessType: "shared",
              paymentProvider: "razorpay",
              subscriptionId,
              orderId: subscriptionId,
              sharedByClerkId: ownerUser.id,
            },
          },
        });
      }

      if (!isOwnerRedeeming) {
        const readerSnapshot = {
          clerkId,
          name: getDisplayName(user),
          email: getPrimaryEmailAddress(user),
          redeemedAt: new Date().toISOString(),
        };
        const nextSharedReaders = alreadyRedeemed
          ? sharedReaders.map((item) => (item.clerkId === clerkId ? readerSnapshot : item))
          : [...sharedReaders, readerSnapshot];

        await clerkClient.users.updateUser(ownerUser.id, {
          publicMetadata: {
            ...ownerMetadata,
            subscription: {
              ...ownerSubscription,
              sharedReaderLimit,
              sharedReaderUsed: nextSharedReaders.length,
              sharedReaders: nextSharedReaders,
            },
          },
        });
      }
    } catch (metadataError) {
      console.warn("Failed to mark redeemed access metadata:", metadataError?.message);
    }

    return res.json({
      success: true,
      message: "Access code redeemed successfully",
    });
  } catch (error) {
    console.error("Redeem access code error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
