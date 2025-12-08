import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
      clerkId,
      planId,
      amount,
    } = req.body;

    // ✅ Pick correct secret based on mode
    const isTest = process.env.RAZORPAY_MODE === "test";
    const secret = isTest
      ? process.env.RAZORPAY_TEST_KEY_SECRET
      : process.env.RAZORPAY_LIVE_KEY_SECRET;

    if (!secret) {
      console.error("❌ Razorpay secret is missing!");
      return res.status(500).json({ success: false, error: "Server misconfigured" });
    }

    // ✅ Verify signature
    const body = razorpay_payment_id + "|" + razorpay_subscription_id;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Invalid signature" });
    }

    // ✅ Save Membership in Hygraph (example)
    const mutation = `
      mutation CreateMembership(
        $clerkId: String!,
        $razorpayPaymentId: String!,
        $razorpaySubscriptionId: String!,
        $planId: String!,
        $amount: Int!,
        $planStatus: UserPlanStatus!,
        $startDate: Date!
      ) {
        createMembership(
          data: {
            razorpayPaymentId: $razorpayPaymentId,
            razorpaySubscriptionId: $razorpaySubscriptionId,
            planId: $planId,
            amount: $amount,
            planStatus: $planStatus,
            startDate: $startDate,
            customer: { connect: { clerkId: $clerkId } }
          }
        ) {
          id
        }
      }
    `;

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
          razorpayPaymentId: razorpay_payment_id,
          razorpaySubscriptionId: razorpay_subscription_id,
          planId,
          amount,
          planStatus: "active",
          startDate: new Date().toISOString(),
        },
      }),
    });

    const hygraphData = await hygraphRes.json();
    console.log("✅ Membership saved:", hygraphData);

    return res.json({ success: true });
  } catch (error) {
    console.error("❌ Verify Payment Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
