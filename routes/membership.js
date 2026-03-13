import express from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { sendSubscriptionEmails } from "../utils/sendEmail.js";

const router = express.Router();

// Create Razorpay order
router.post("/checkout", async (req, res) => {
  try {
    const { amount, currency, planId, userId } = req.body;

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const options = {
      amount,
      currency,
      receipt: `receipt_${Date.now()}`,
      notes: {
        planId,
        userId,
      },
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id,
      currency: order.currency,
      amount: order.amount,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ success: false, message: "Checkout failed" });
  }
});

// Confirm payment and send subscription mails
router.post("/confirm", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      userId,
      planId,
    } = req.body;

    const sign = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign)
      .digest("hex");

    if (razorpay_signature !== expectedSign) {
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    // Keep email sending non-blocking for payment confirmation response.
    try {
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      const payment = await razorpay.payments.fetch(razorpay_payment_id);
      const amount = Math.floor(Number(payment?.amount || 0) / 100);
      const startedAt = new Date().toISOString();
      const normalizedPlan = String(planId || "").toLowerCase();
      const expiresAt = (() => {
        const d = new Date(startedAt);
        if (normalizedPlan.includes("premium")) {
          d.setFullYear(d.getFullYear() + 1);
        } else {
          d.setMonth(d.getMonth() + 3);
        }
        return d.toISOString();
      })();

      let userEmail = "";
      let userName = "Member";
      if (userId) {
        const user = await clerkClient.users.getUser(userId);
        userEmail =
          user?.emailAddresses?.find((email) => email.id === user.primaryEmailAddressId)
            ?.emailAddress ||
          user?.emailAddresses?.[0]?.emailAddress ||
          "";
        userName =
          user?.fullName ||
          [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
          user?.username ||
          "Member";
      }

      await sendSubscriptionEmails({
        userEmail,
        userName,
        clerkId: userId || "",
        plan: planId || "standard",
        status: "active",
        startedAt,
        expiresAt,
        amount,
        paymentId: razorpay_payment_id,
        subscriptionId: razorpay_order_id || "",
        orderId: razorpay_order_id || "",
      });
    } catch (emailError) {
      console.error("Membership confirm email error:", emailError?.message || emailError);
    }

    return res.json({ success: true, message: "Payment verified successfully" });
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
