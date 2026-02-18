// server/routes/subscription.js
import express from "express";
// import Razorpay from "razorpay";
import { razorpay, razorpayKeyId } from "../config/razorpay.js";
import { clerkClient } from "@clerk/clerk-sdk-node";

import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

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

    await clerkClient.users.updateUser(clerkId, {
      publicMetadata: {
        ...existing,
        subscription: {
          ...existingSubscription,
          status: "cancelled",
        },
      },
    });

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

export default router;
