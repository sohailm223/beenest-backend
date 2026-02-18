import express from "express";
import { razorpay, razorpayKeyId, getPlanMapping } from "../config/razorpay.js";

const router = express.Router();

router.get("/razorpay-config", (req, res) => {
  return res.json({
    key: razorpayKeyId,
    plans: getPlanMapping(),
  });
});

router.get("/razorpay-plans", async (req, res) => {
  try {
    const planMapping = getPlanMapping();
    const planEntries = Object.entries(planMapping).filter(
      ([, planId]) => !!planId
    );

    const settled = await Promise.allSettled(
      planEntries.map(async ([key, planId]) => {
        const plan = await razorpay.plans.fetch(planId);
        return {
          key,
          id: plan.id,
          name: plan.item?.name || key,
          amount: plan.item?.amount || 0,
          currency: plan.item?.currency || "INR",
          period: plan.period,
          interval: plan.interval,
          notes: plan.notes || {},
        };
      })
    );

    const plans = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    const errors = settled
      .filter((result) => result.status === "rejected")
      .map((result) => String(result.reason?.message || result.reason));

    if (!plans.length) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch plans",
        errors,
      });
    }

    return res.json({
      success: true,
      plans,
      warnings: errors,
    });
  } catch (error) {
    console.error("Failed to fetch Razorpay plans:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch plans" });
  }
});

export default router;
