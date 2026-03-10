// server/routes/subscription.js
import express from "express";
// import Razorpay from "razorpay";
import { razorpay, razorpayKeyId } from "../config/razorpay.js";
import { clerkClient } from "@clerk/clerk-sdk-node";
import fetch from "node-fetch";
import { sendSubscriptionCancelledEmails } from "../utils/sendEmail.js";
import { parseSubscriptionAccessCode } from "../utils/subscriptionEntitlements.js";

import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

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

    await razorpay.subscriptions.cancel(subscriptionId, {
      cancel_at_cycle_end: false,
    });

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

    const subscriptionId = parseSubscriptionAccessCode(accessCode);
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

    const plan = String(membership?.planId || "").toLowerCase();
    if (!plan.includes("premium")) {
      return res.status(403).json({
        success: false,
        error: "Access code sharing is available only for premium subscriptions",
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

      // Keep owner accounts unchanged; shared users cannot cancel the source subscription.
      if (String(existingSubscription?.accessType || "").toLowerCase() !== "owner") {
        await clerkClient.users.updateUser(clerkId, {
          publicMetadata: {
            ...existing,
            subscription: {
              ...existingSubscription,
              accessType: "shared",
              subscriptionId,
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
