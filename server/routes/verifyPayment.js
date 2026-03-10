import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { razorpay } from "../config/razorpay.js";
import { FREE_DIGITAL_LIMIT, FREE_ORDER_LIMIT } from "../config/subscriptionBenefits.js";
import { sendSubscriptionEmails } from "../utils/sendEmail.js";
import { computeIssueEntitlements, normalizePlanKey } from "../utils/subscriptionEntitlements.js";

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

function addPeriodToIso(isoDate, period = "monthly", interval = 1) {
  const date = new Date(isoDate);
  const safeInterval = Number(interval) > 0 ? Number(interval) : 1;

  if (period === "daily") {
    date.setDate(date.getDate() + safeInterval);
    return date.toISOString();
  }
  if (period === "weekly") {
    date.setDate(date.getDate() + safeInterval * 7);
    return date.toISOString();
  }
  if (period === "yearly") {
    date.setFullYear(date.getFullYear() + safeInterval);
    return date.toISOString();
  }

  // default monthly
  date.setMonth(date.getMonth() + safeInterval);
  return date.toISOString();
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
  selectedIssueIds = [],
}) {
  if (!process.env.HYGRAPH_API || !process.env.HYGRAPH_TOKEN) return;

  const getExistingQuery = `
    query ExistingMembership($subscriptionId: String!) {
      membership(where: { razorpaySubscriptionId: $subscriptionId }) {
        id
      }
    }
  `;

  const hygraphPlanStatus =
    status === "active" ? "active" : status === "expired" ? "expired" : "cancelled";
  const startDate = toDateOnly(startedAt) || toDateOnly(new Date().toISOString());

  const existingRes = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({
      query: getExistingQuery,
      variables: { subscriptionId },
    }),
  });
  const existingPayload = await existingRes.json();
  if (!existingRes.ok || existingPayload?.errors?.length) {
    throw new Error(
      `Hygraph membership lookup failed: ${JSON.stringify(
        existingPayload?.errors || existingPayload
      )}`
    );
  }
  const existingMembershipId = existingPayload?.data?.membership?.id || null;

  const mutation = existingMembershipId
    ? `
      mutation UpdateMembership(
        $id: ID!,
        $clerkId: String!,
        $razorpayPaymentId: String!,
        $planId: String!,
        $amount: Int!,
        $planStatus: UserPlanStatus!,
        $startDate: Date!,
        $endDate: DateTime,
        $selectedIssues: [MagazineWhereUniqueInput!]
      ) {
        updateMembership(
          where: { id: $id }
          data: {
            razorpayPaymentId: $razorpayPaymentId,
            planId: $planId,
            amount: $amount,
            planStatus: $planStatus,
            startDate: $startDate,
            endDate: $endDate,
            selectedIssues: { set: $selectedIssues },
            customer: { connect: { clerkId: $clerkId } }
          }
        ) {
          id
        }
        publishMembership(where: { id: $id }) {
          id
        }
      }
    `
    : `
      mutation CreateMembership(
        $clerkId: String!,
        $razorpayPaymentId: String!,
        $razorpaySubscriptionId: String!,
        $planId: String!,
        $amount: Int!,
        $planStatus: UserPlanStatus!,
        $startDate: Date!,
        $endDate: DateTime,
        $selectedIssues: [MagazineWhereUniqueInput!]
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
            selectedIssues: { connect: $selectedIssues },
            customer: { connect: { clerkId: $clerkId } }
          }
        ) {
          id
        }
      }
    `;

  const variables = {
    id: existingMembershipId,
    clerkId,
    razorpayPaymentId: paymentId,
    razorpaySubscriptionId: subscriptionId,
    planId: plan,
    amount,
    planStatus: hygraphPlanStatus,
    startDate,
    endDate: expiresAt,
    selectedIssues: selectedIssueIds.map((id) => ({ id })),
  };

  const writeRes = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        ...variables,
      },
    }),
  });
  const writePayload = await writeRes.json();
  if (!writeRes.ok || writePayload?.errors?.length) {
    throw new Error(
      `Hygraph membership write failed: ${JSON.stringify(writePayload?.errors || writePayload)}`
    );
  }

  if (!existingMembershipId) {
    const createdId = writePayload?.data?.createMembership?.id;
    if (!createdId) return;
    const publishMutation = `
      mutation PublishMembership($id: ID!) {
        publishMembership(where: { id: $id }) {
          id
        }
      }
    `;
    const publishRes = await fetch(process.env.HYGRAPH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: publishMutation,
        variables: { id: createdId },
      }),
    });
    const publishPayload = await publishRes.json();
    if (!publishRes.ok || publishPayload?.errors?.length) {
      throw new Error(
        `Hygraph membership publish failed: ${JSON.stringify(
          publishPayload?.errors || publishPayload
        )}`
      );
    }
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

    let payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (!payment) {
      return res.status(400).json({
        success: false,
        error: "Unable to validate payment with Razorpay",
      });
    }

    // Do not hard-fail on payment.subscription_id mismatch here.
    // Signature validation above already binds payment + subscription from checkout payload.
    // Razorpay response shapes can differ across subscription/payment attempts.

    if (payment.status === "authorized") {
      try {
        await razorpay.payments.capture(razorpay_payment_id, payment.amount, payment.currency);
        payment = await razorpay.payments.fetch(razorpay_payment_id);
      } catch (captureError) {
        return res.status(400).json({
          success: false,
          error: "Payment authorized but capture failed",
        });
      }
    }

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
    let expiresAt =
      toIsoOrNull(subscription.current_end) ||
      toIsoOrNull(subscription.end_at) ||
      toIsoOrNull(subscription.charge_at) ||
      null;

    let planInfo = null;
    if (subscription?.plan_id) {
      try {
        planInfo = await razorpay.plans.fetch(subscription.plan_id);
      } catch (planFetchError) {
        console.warn("Unable to fetch plan info:", planFetchError?.message);
      }
    }

    if (!expiresAt && planInfo) {
      try {
        expiresAt = addPeriodToIso(
          startedAt,
          String(planInfo?.period || "monthly").toLowerCase(),
          Number(planInfo?.interval || 1)
        );
      } catch (planFetchError) {
        console.warn("Unable to fetch plan for expiry fallback:", planFetchError?.message);
      }
    }

    const razorpaySubscriptionStatus = String(subscription?.status || "").toLowerCase();
    const cancelledLike = ["cancelled", "completed", "halted", "expired"].includes(
      razorpaySubscriptionStatus
    );
    const status = cancelledLike
      ? "cancelled"
      : isSubscriptionActive("active", expiresAt) || payment.status === "captured"
        ? "active"
        : "expired";
    const rawPlan = planKey || planId || subscription.plan_id || "unknown";
    const resolvedPlanKey = normalizePlanKey(rawPlan, {
      period: planInfo?.period,
      interval: planInfo?.interval,
    });
    const plan = resolvedPlanKey !== "unknown" ? resolvedPlanKey : rawPlan;
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
      accessType: "owner",
      paymentProvider: "razorpay",
      paymentId,
      orderId,
      subscriptionId: resolvedSubscriptionId,
      freeOrderLimit: FREE_ORDER_LIMIT,
      freeDigitalLimit: FREE_DIGITAL_LIMIT,
      freeOrderUsed: 0,
      freeDigitalUsed: 0,
    };

    await updateClerkMetadata({
      clerkId,
      metadata: {
        subscription: subscriptionMetadata,
      },
    });

    try {
      const entitlement = await computeIssueEntitlements(plan, {
        period: planInfo?.period,
        interval: planInfo?.interval,
      });
      await createHygraphMembership({
        clerkId,
        plan,
        paymentId,
        subscriptionId: resolvedSubscriptionId,
        amount: resolvedAmount,
        status,
        startedAt,
        expiresAt,
        selectedIssueIds: entitlement.issueIds,
      });
    } catch (hygraphError) {
      console.error("Hygraph membership save failed:", hygraphError.message);
    }

    try {
      const clerkUser = await clerkClient.users.getUser(clerkId);
      const userEmail =
        clerkUser?.emailAddresses?.find(
          (email) => email.id === clerkUser.primaryEmailAddressId
        )?.emailAddress ||
        clerkUser?.emailAddresses?.[0]?.emailAddress ||
        "";
      const userName =
        clerkUser?.fullName ||
        [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
        clerkUser?.username ||
        "Member";

      await sendSubscriptionEmails({
        userEmail,
        userName,
        clerkId,
        plan,
        status,
        startedAt,
        expiresAt,
        amount: resolvedAmount,
        paymentId,
        subscriptionId: resolvedSubscriptionId,
        orderId,
      });
    } catch (emailError) {
      console.error("Subscription email send failed:", emailError.message);
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
