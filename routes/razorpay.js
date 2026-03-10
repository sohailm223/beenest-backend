import express from "express";
import fetch from "node-fetch";
import { razorpay, razorpayKeyId } from "../config/razorpay.js";

const router = express.Router();

router.post("/create-razorpay-order", async (req, res) => {
  const { magazineId, slug } = req.body || {};

  if (!magazineId && !slug) {
    return res.status(400).json({
      success: false,
      error: "magazineId or slug is required",
    });
  }

  try {
    const query = `
      query GetMagazinePrice($id: ID, $slug: String) {
        byIdPublished: magazine(where: { id: $id }) {
          id
          name
          price
        }
        byIdDraft: magazine(where: { id: $id }, stage: DRAFT) {
          id
          name
          price
        }
        bySlugPublished: magazine(where: { slug: $slug }) {
          id
          name
          price
        }
        bySlugDraft: magazine(where: { slug: $slug }, stage: DRAFT) {
          id
          name
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
        variables: { id: magazineId || null, slug: slug || null },
      }),
    });

    const hygraphData = await hygraphRes.json();
    if (!hygraphRes.ok || hygraphData?.errors?.length) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch magazine from Hygraph",
      });
    }

    const magazine =
      hygraphData?.data?.byIdPublished ||
      hygraphData?.data?.byIdDraft ||
      hygraphData?.data?.bySlugPublished ||
      hygraphData?.data?.bySlugDraft;
    if (!magazine || magazine.price == null) {
      return res.status(404).json({
        success: false,
        error: "Magazine not found or missing price",
      });
    }

    const amount = Number(magazine.price);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid magazine price configured for payment",
      });
    }

    // Razorpay receipt max length is 40 chars.
    const idForReceipt = magazine?.id || magazineId || slug || "mag";
    const shortId = String(idForReceipt).replace(/[^a-zA-Z0-9]/g, "").slice(-12);
    const ts = String(Date.now()).slice(-10);
    const receipt = `mag${shortId}${ts}`.slice(0, 40);

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt,
    });

    return res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      key: razorpayKeyId,
      magazineTitle: magazine.name,
    });
  } catch (err) {
    console.error("Razorpay order error:", err);
    return res.status(500).json({
      success: false,
      error: err?.error?.description || err?.message || "Failed to create Razorpay order",
    });
  }
});

export default router;
