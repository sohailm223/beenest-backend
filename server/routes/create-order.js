import express from 'express';
import { razorpay, razorpayKeyId } from "../config/razorpay.js";

import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// const razorpay = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_KEY_SECRET,
// });

router.post('/create-order', async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const options = {
      amount,
      currency: 'INR',
      receipt: `order_rcptid_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);

    // ✅ Wrap in { order } to match frontend expectation
    res.status(200).json({ order });
  } catch (err) {
    console.error('❌ Razorpay order error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

export default router;
