// backend/routes/create-plan.js
import express from "express";
import Razorpay from "razorpay";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create a new plan
router.post("/create-plan", async (req, res) => {
  try {
    const { period, interval, name, amount } = req.body;

    const plan = await razorpay.plans.create({
      period, // "monthly" or "yearly"
      interval, // e.g. 3 for 3 months, 12 for 12 months
      item: {
        name,
        amount, // in paise (₹500 = 50000)
        currency: "INR",
      },
    });

    res.json({ success: true, plan });
  } catch (error) {
    console.error("❌ Error creating plan:", error);
    res.status(500).json({ success: false, message: "Failed to create plan" });
  }
});

export default router;
