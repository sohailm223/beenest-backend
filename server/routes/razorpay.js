// routes/razorpay.js
import express from "express";
import Razorpay from "razorpay";
import fetch from "node-fetch"; // for Hygraph request

const router = express.Router();

// ✅ Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_TEST_KEY_ID,
  key_secret: process.env.RAZORPAY_TEST_KEY_SECRET,
});

// ✅ Create Razorpay order based on magazineId
router.post("/create-razorpay-order", async (req, res) => {
  const { magazineId } = req.body;

  if (!magazineId) {
    return res.status(400).json({ error: "magazineId is required" });
  }

  try {
    // 1️⃣ Fetch magazine price from Hygraph
    const query = `
      query GetMagazinePrice($id: ID!) {
        magazine(where: { id: $id }) {
          id
          title
          price
        }
      }
    `;

    const hygraphRes = await fetch(process.env.HYGRAPH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query,
        variables: { id: magazineId },
      }),
    });

    const hygraphData = await hygraphRes.json();
    const magazine = hygraphData?.data?.magazine;

    if (!magazine || !magazine.price) {
      return res.status(404).json({ error: "Magazine not found or missing price" });
    }

    const amount = magazine.price;

    // 2️⃣ Create Razorpay order
    const order = await razorpay.orders.create({
      amount: amount * 100, // convert to paisa
      currency: "INR",
      receipt: `mag_${magazineId}_${Date.now()}`,
    });

    // 3️⃣ Send response
    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      key: process.env.RAZORPAY_TEST_KEY_ID,
      magazineTitle: magazine.title,
    });
  } catch (err) {
    console.error("❌ Razorpay order error:", err);
    res.status(500).json({ error: "Failed to create Razorpay order" });
  }
});

export default router;
