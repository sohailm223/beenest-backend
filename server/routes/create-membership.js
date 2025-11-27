// backend/routes/create-membership.js
import express from "express";
// import Razorpay from "razorpay";
import { razorpay, razorpayKeyId } from "../config/razorpay.js";

import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// const razorpay = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_KEY_SECRET,
// });

// POST /api/membership/create
router.post("/create", async (req, res) => {
  try {
    const { amount } = req.body; // e.g. 50000 for ₹500
    if (!amount) {
      return res.status(400).json({ success: false, message: "Amount is required" });
    }

    const options = {
      amount: amount, // amount in paise
      currency: "INR",
      receipt: "receipt_" + Date.now(),
      payment_capture: 1,
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id,
      currency: order.currency,
      amount: order.amount,
      key: razorpayKeyId,
    });
  } catch (error) {
    console.error("❌ Error creating membership order:", error);
    res.status(500).json({ success: false, message: "Failed to create order" });
  }
});

export default router;
