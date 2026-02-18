import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { razorpay } from "../config/razorpay.js";

const router = express.Router();

function toIsoOrNull(unixSeconds) {
  if (!unixSeconds || Number.isNaN(Number(unixSeconds))) return null;
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

function toDateOnly(isoDateString) {
  if (!isoDateString) return null;
  return isoDateString.split("T")[0];
}

function isSubscriptionActive(status, expiresAt) {
  if (status !== "active" || !expiresAt) return false;
  return new Date(expiresAt).getTime() > Date.now();
}

async function updateClerkMetadata({ clerkId, metadata }) {
  // Uses CLERK_SECRET_KEY from environment.
  const user = await clerkClient.users.getUser(clerkId);
  const existing = user?.publicMetadata || {};
  await clerkClient.users.updateUser(clerkId, {
    publicMetadata: {
      ...existing,
      ...metadata,
    },
  });
}

async function createHygraphMembership({
  clerkId,
  plan,
  paymentId,
  subscriptionId,
  amount,
  status,
  startedAt,
  expiresAt,
}) {
  const mutation = `
    mutation CreateMembership(
      $clerkId: String!,
      $razorpayPaymentId: String!,
      $razorpaySubscriptionId: String!,
      $planId: String!,
      $amount: Int!,
      $planStatus: UserPlanStatus!,
      $startDate: Date!,
      $endDate: DateTime
    ) {
      createMembership(
        data: {
          razorpayPaymentId: $razorpayPaymentId,
          razorpaySubscriptionId: $razorpaySubscriptionId,
          planId: $planId,
          amount: $amount,
          planStatus: $planStatus,
          startDate: $startDate,
          endDate: $endDate,
          customer: { connect: { clerkId: $clerkId } }
        }
      ) {
        id
      }
    }
  `;

  const hygraphPlanStatus = status === "active" ? "active" : "cancelled";
  const startDate = toDateOnly(startedAt) || toDateOnly(new Date().toISOString());

  const hygraphRes = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        clerkId,
        razorpayPaymentId: paymentId,
        razorpaySubscriptionId: subscriptionId,
        planId: plan,
        amount,
        planStatus: hygraphPlanStatus,
        startDate,
        endDate: expiresAt,
      },
    }),
  });

  const hygraphData = await hygraphRes.json();
  if (!hygraphRes.ok || hygraphData?.errors?.length) {
    throw new Error(
      `Hygraph update failed: ${JSON.stringify(hygraphData?.errors || hygraphData)}`
    );
  }
}

router.post("/", async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_order_id,
      razorpay_signature,
      clerkId,
      planId,
      planKey,
      amount,
    } = req.body;

    if (!clerkId || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields for payment verification",
      });
    }

    const isTest = process.env.RAZORPAY_MODE === "test";
    const secret = isTest
      ? process.env.RAZORPAY_TEST_KEY_SECRET
      : process.env.RAZORPAY_LIVE_KEY_SECRET;

    if (!secret) {
      return res.status(500).json({ success: false, error: "Server misconfigured" });
    }

    // Verify signature before changing any state.
    // Different checkout flows can produce different payload formats.
    const payloadCandidates = [];
    if (razorpay_subscription_id) {
      payloadCandidates.push(`${razorpay_payment_id}|${razorpay_subscription_id}`);
      payloadCandidates.push(`${razorpay_subscription_id}|${razorpay_payment_id}`);
    }
    if (razorpay_order_id) {
      payloadCandidates.push(`${razorpay_order_id}|${razorpay_payment_id}`);
    }

    if (!payloadCandidates.length) {
      return res.status(400).json({
        success: false,
        error: "Missing subscription_id/order_id for signature verification",
      });
    }

    const signatureValid = payloadCandidates.some((payload) => {
      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
      return expectedSignature === razorpay_signature;
    });

    if (!signatureValid) {
      return res.status(400).json({ success: false, error: "Invalid signature" });
    }

    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (!payment) {
      return res.status(400).json({
        success: false,
        error: "Unable to validate payment with Razorpay",
      });
    }

    // Do not hard-fail on payment.subscription_id mismatch here.
    // Signature validation above already binds payment + subscription from checkout payload.
    // Razorpay response shapes can differ across subscription/payment attempts.

    if (payment.status !== "captured") {
      return res.status(400).json({
        success: false,
        error: `Payment not captured: ${payment.status}`,
      });
    }

    const resolvedSubscriptionId =
      razorpay_subscription_id || payment.subscription_id || null;
    if (!resolvedSubscriptionId) {
      return res.status(400).json({
        success: false,
        error: "Payment is captured but no subscription id found",
      });
    }

    const subscription = await razorpay.subscriptions.fetch(resolvedSubscriptionId);
    if (!subscription) {
      return res.status(400).json({
        success: false,
        error: "Unable to validate subscription with Razorpay",
      });
    }

    const startedAt =
      toIsoOrNull(subscription.current_start) ||
      toIsoOrNull(subscription.start_at) ||
      toIsoOrNull(subscription.created_at) ||
      new Date().toISOString();
    const expiresAt =
      toIsoOrNull(subscription.current_end) ||
      toIsoOrNull(subscription.end_at) ||
      null;

    const status = isSubscriptionActive("active", expiresAt) ? "active" : "expired";
    const plan = planKey || planId || subscription.plan_id || "unknown";
    const paymentId = razorpay_payment_id;
    // Keep orderId as subscription id for subscription management actions.
    const orderId = payment.order_id || resolvedSubscriptionId;
    const resolvedAmount = Number.isFinite(Number(amount))
      ? Number(amount)
      : Math.floor(Number(payment.amount || 0) / 100);

    const subscriptionMetadata = {
      status,
      plan,
      startedAt,
      expiresAt,
      paymentProvider: "razorpay",
      paymentId,
      orderId,
      subscriptionId: resolvedSubscriptionId,
    };

    await updateClerkMetadata({
      clerkId,
      metadata: {
        subscription: subscriptionMetadata,
      },
    });

    try {
      await createHygraphMembership({
        clerkId,
        plan,
        paymentId,
        subscriptionId: resolvedSubscriptionId,
        amount: resolvedAmount,
        status,
        startedAt,
        expiresAt,
      });
    } catch (hygraphError) {
      console.error("Hygraph membership save failed:", hygraphError.message);
    }

    return res.json({
      success: true,
      metadata: {
        subscription: subscriptionMetadata,
      },
    });
  } catch (error) {
    console.error("Verify Payment Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
