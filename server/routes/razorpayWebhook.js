import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const router = express.Router();

router.post("/", express.json({ type: "*/*" }), async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_KEY_SECRET;

    // Verify Razorpay webhook signature
    const shasum = crypto.createHmac("sha256", secret);
    shasum.update(JSON.stringify(req.body));
    const digest = shasum.digest("hex");

    if (digest !== req.headers["x-razorpay-signature"]) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    console.log("🔔 Webhook:", req.body.event);
    const event = req.body.event;
    const payload = req.body.payload?.subscription?.entity;
    if (!payload) return res.status(200).json({ status: "ignored" });

    const razorpaySubscriptionId = payload.id;

    const mutation = `
      mutation UpdateMembership(
        $razorpaySubscriptionId: String!,
        $planStatus: UserPlanStatus,
        $endDate: DateTime
      ) {
        updateMembership(
          where: { razorpaySubscriptionId: $razorpaySubscriptionId }
          data: { planStatus: $planStatus, endDate: $endDate }
        ) {
          id
          planStatus
        }
        publishMembership(where: { razorpaySubscriptionId: $razorpaySubscriptionId }) {
          id
        }
      }
    `;

    let planStatus = null;
    let endDate = null;

    if (event === "subscription.activated") planStatus = "active";
    if (event === "subscription.charged") planStatus = "active";
    if (event === "subscription.cancelled") {
      planStatus = "cancelled";
      endDate = new Date().toISOString();
    }
    if (event === "subscription.completed") {
      planStatus = "expired";
      endDate = new Date().toISOString();
    }

    if (planStatus) {
      await fetch(process.env.HYGRAPH_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
        },
        body: JSON.stringify({
          query: mutation,
          variables: { razorpaySubscriptionId, planStatus, endDate },
        }),
      });
      console.log(`✅ Membership updated: ${planStatus}`);
    }

    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("❌ Webhook Error:", error);
    res.status(500).json({ error: "Webhook failed" });
  }
});

export default router;
