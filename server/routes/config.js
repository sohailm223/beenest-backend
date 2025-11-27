// routes/config.js
import express from "express";
import { razorpayKeyId, getPlanMapping } from "../config/razorpay.js";

const router = express.Router();

router.get("/razorpay-config", (req, res) => {
  res.json({
    key: razorpayKeyId,
    plans: getPlanMapping(),
  });
});

export default router;
