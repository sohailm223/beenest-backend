import express from "express";
// import Razorpay from "razorpay";
import { razorpay, razorpayKeyId } from "../config/razorpay.js";

const router = express.Router();

// const razorpay = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_KEY_SECRET,
// });

router.post("/", async (req, res) => {
  try {
    const { planId, customerEmail, customerName, customerPhone } = req.body;

    if (!planId) {
      return res.status(400).json({ success: false, error: "Plan ID is required" });
    }

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      customer_notify: 1,
      total_count: 12, // e.g., for yearly/monthly cycles
      notes: {
        email: customerEmail,
        name: customerName,
        phone: customerPhone,
      },
    });

    res.json({
      success: true,
      key: razorpayKeyId,
      razorpaySubscriptionId: subscription.id,
    });
  } catch (error) {
    console.error("❌ Subscription Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
