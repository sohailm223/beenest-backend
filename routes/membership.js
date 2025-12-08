import express from "express";
import crypto from "crypto";
import Razorpay from "razorpay";

const router = express.Router();

// ✅ Create Razorpay order
router.post("/checkout", async (req, res) => {
  try {
    const { amount, currency, planId, userId } = req.body;

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const options = {
      amount, // already multiplied by 100 on frontend
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
      key: process.env.RAZORPAY_KEY_ID, // send public key
    });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ success: false, message: "Checkout failed" });
  }
});

// ✅ Confirm payment & activate membership
router.post("/confirm", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature === expectedSign) {
      // ✅ Success
      return res.json({ success: true, message: "Payment verified successfully" });
    } else {
      // ❌ Signature mismatch
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
