// routes/send-test-email.js
import express from "express";
import { sendOrderEmails } from "../utils/sendEmail.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    // fake order info just for testing
    await sendOrderEmails({
      userEmail: "sohailm223@gmail.com",
      userName: "Test User",
      orderId: "TEST123",
      totalAmount: 999,
    });

    res.json({ success: true, message: "Test email sent ✅" });
  } catch (err) {
    console.error("Test email error:", err);
    res.status(500).json({ success: false, message: "Failed to send test email ❌" });
  }
});

export default router;
