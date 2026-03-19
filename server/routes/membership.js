import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { razorpay, razorpayKeyId } from "../config/razorpay.js";
import { sendSubscriptionEmails } from "../utils/sendEmail.js";
import {
  MEMBERSHIP_PLAN_CATALOG,
  computeIssueEntitlements,
  getPlanConfig,
  normalizePlanKey,
} from "../utils/subscriptionEntitlements.js";

const router = express.Router();

function dateOnly(isoString) {
  if (!isoString) return null;
  return isoString.split("T")[0];
}

function addDaysIso(dateIso, days = 365) {
  const d = new Date(dateIso);
  d.setDate(d.getDate() + Number(days || 365));
  return d.toISOString();
}

async function upsertHygraphMembership({
  clerkId,
  planKey,
  paymentId,
  orderId,
  amount,
  startedAt,
  expiresAt,
  issueIds = [],
}) {
  if (!process.env.HYGRAPH_API || !process.env.HYGRAPH_TOKEN) return;

  const lookupQuery = `
    query ExistingMembership($orderId: String!) {
      membership(where: { razorpaySubscriptionId: $orderId }) {
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
      query: lookupQuery,
      variables: { orderId },
    }),
  });
  const lookupJson = await lookupRes.json();
  if (!lookupRes.ok || lookupJson?.errors?.length) {
    throw new Error("Hygraph membership lookup failed");
  }

  const existingId = lookupJson?.data?.membership?.id || null;
  const planStatus = "active";

  const mutation = existingId
    ? `
      mutation UpdateMembership(
        $id: ID!,
        $clerkId: String!,
        $paymentId: String!,
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
            razorpayPaymentId: $paymentId,
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
        $paymentId: String!,
        $orderId: String!,
        $planId: String!,
        $amount: Int!,
        $planStatus: UserPlanStatus!,
        $startDate: Date!,
        $endDate: DateTime,
        $selectedIssues: [MagazineWhereUniqueInput!]
      ) {
        createMembership(
          data: {
            razorpayPaymentId: $paymentId,
            razorpaySubscriptionId: $orderId,
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
    id: existingId,
    clerkId,
    paymentId,
    orderId,
    planId: planKey,
    amount: Number(amount || 0),
    planStatus,
    startDate: dateOnly(startedAt),
    endDate: expiresAt,
    selectedIssues: issueIds.map((id) => ({ id })),
  };

  const writeRes = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({
      query: mutation,
      variables,
    }),
  });

  const writeJson = await writeRes.json();
  if (!writeRes.ok || writeJson?.errors?.length) {
    throw new Error("Hygraph membership write failed");
  }

  if (!existingId) {
    const createdId = writeJson?.data?.createMembership?.id;
    if (createdId) {
      const publishRes = await fetch(process.env.HYGRAPH_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
        },
        body: JSON.stringify({
          query: `
            mutation PublishMembership($id: ID!) {
              publishMembership(where: { id: $id }) { id }
            }
          `,
          variables: { id: createdId },
        }),
      });
      const publishJson = await publishRes.json();
      if (!publishRes.ok || publishJson?.errors?.length) {
        throw new Error("Hygraph membership publish failed");
      }
    }
  }
}

router.get("/plans", async (req, res) => {
  return res.json({
    success: true,
    plans: Object.values(MEMBERSHIP_PLAN_CATALOG),
  });
});

router.post("/create-order", async (req, res) => {
  try {
    const { planKey, clerkId } = req.body || {};
    if (!planKey || !clerkId) {
      return res.status(400).json({
        success: false,
        error: "planKey and clerkId are required",
      });
    }

    const plan = getPlanConfig(planKey);
    const amount = Math.round(Number(plan.amount || 0) * 100);
    if (!amount) {
      return res.status(400).json({
        success: false,
        error: "Invalid plan amount",
      });
    }

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `mem_${Date.now()}`.slice(0, 40),
      notes: {
        clerkId,
        planKey: normalizePlanKey(planKey),
        planType: plan.planType,
        durationType: plan.durationType,
      },
    });

    return res.json({
      success: true,
      key: razorpayKeyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      plan: {
        key: plan.key,
        label: plan.label,
        amount: plan.amount,
      },
    });
  } catch (error) {
    console.error("Membership create-order error:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Unable to create membership order",
    });
  }
});

router.post("/verify-order", async (req, res) => {
  try {
    const {
      clerkId,
      planKey,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};

    if (!clerkId || !planKey || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    const secret =
      process.env.RAZORPAY_MODE === "test"
        ? process.env.RAZORPAY_TEST_KEY_SECRET
        : process.env.RAZORPAY_LIVE_KEY_SECRET;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: "Invalid signature",
      });
    }

    let payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (!payment) {
      return res.status(400).json({
        success: false,
        error: "Unable to validate payment",
      });
    }

    if (payment.status === "authorized") {
      await razorpay.payments.capture(razorpay_payment_id, payment.amount, payment.currency);
      payment = await razorpay.payments.fetch(razorpay_payment_id);
    }

    if (payment.status !== "captured") {
      return res.status(400).json({
        success: false,
        error: `Payment not captured: ${payment.status}`,
      });
    }

    const plan = getPlanConfig(planKey);
    const entitlements = await computeIssueEntitlements(plan.key, []);
    const startedAt = new Date().toISOString();
    const expiresAt = addDaysIso(startedAt, plan.validityDays);

    const user = await clerkClient.users.getUser(clerkId);
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
      paymentProvider: "razorpay",
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      subscriptionId: razorpay_order_id,
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

    try {
      await upsertHygraphMembership({
        clerkId,
        planKey: plan.key,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        amount: Number(plan.amount || 0),
        startedAt,
        expiresAt,
        issueIds: entitlements.issueIds,
      });
    } catch (hygraphError) {
      console.error("Membership Hygraph sync failed:", hygraphError?.message);
    }

    try {
      const userEmail =
        user?.emailAddresses?.find((email) => email.id === user.primaryEmailAddressId)
          ?.emailAddress ||
        user?.emailAddresses?.[0]?.emailAddress ||
        "";
      const userName =
        user?.fullName ||
        [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
        user?.username ||
        "Member";
      await sendSubscriptionEmails({
        userEmail,
        userName,
        clerkId,
        plan: plan.label,
        status: "active",
        startedAt,
        expiresAt,
        amount: Number(plan.amount || 0),
        paymentId: razorpay_payment_id,
        subscriptionId: razorpay_order_id,
        orderId: razorpay_order_id,
      });
    } catch (emailError) {
      console.error("Membership email send failed:", emailError?.message);
    }

    return res.json({
      success: true,
      subscription: subscriptionMetadata,
      entitlements: {
        slotCount: entitlements.slotCount,
        issueIds: entitlements.issueIds,
        canShare: plan.canShare,
      },
    });
  } catch (error) {
    console.error("Membership verify-order error:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Unable to verify membership payment",
    });
  }
});

export default router;
