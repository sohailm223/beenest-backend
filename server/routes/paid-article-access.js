import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { razorpay, razorpayKeyId } from "../config/razorpay.js";

const router = express.Router();

async function getPaidArticle({ articleId, slug }) {
  const query = `
    query GetPaidArticle($id: ID, $slug: String) {
      byIdPublished: magazine(where: { id: $id }) {
        id
        slug
        name
        price
        magazineType
      }
      byIdDraft: magazine(where: { id: $id }, stage: DRAFT) {
        id
        slug
        name
        price
        magazineType
      }
      bySlugPublished: magazine(where: { slug: $slug }) {
        id
        slug
        name
        price
        magazineType
      }
      bySlugDraft: magazine(where: { slug: $slug }, stage: DRAFT) {
        id
        slug
        name
        price
        magazineType
      }
    }
  `;

  const response = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({
      query,
      variables: { id: articleId || null, slug: slug || null },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload?.errors?.length) {
    throw new Error("Unable to fetch paid article");
  }

  const article =
    payload?.data?.byIdPublished ||
    payload?.data?.byIdDraft ||
    payload?.data?.bySlugPublished ||
    payload?.data?.bySlugDraft;

  if (!article) return null;
  if (String(article.magazineType || "") !== "articlePaid") return null;

  return article;
}

router.post("/create-paid-article-order", async (req, res) => {
  const { articleId, slug, clerkId } = req.body || {};

  if (!articleId && !slug) {
    return res.status(400).json({
      success: false,
      error: "articleId or slug is required",
    });
  }

  if (!clerkId) {
    return res.status(400).json({
      success: false,
      error: "clerkId is required",
    });
  }

  try {
    const article = await getPaidArticle({ articleId, slug });
    if (!article) {
      return res.status(404).json({
        success: false,
        error: "Paid article not found",
      });
    }

    const user = await clerkClient.users.getUser(clerkId);
    const publicMetadata = user?.publicMetadata || {};
    const existingAccess = Array.isArray(publicMetadata?.paidArticleAccess)
      ? publicMetadata.paidArticleAccess
      : [];
    if (existingAccess.includes(article.id)) {
      return res.json({
        success: true,
        alreadyPurchased: true,
        articleId: article.id,
        articleTitle: article.name,
      });
    }

    const amount = Number(article.price || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid paid article price",
      });
    }

    const shortId = String(article.id || article.slug || "article")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-10);
    const receipt = `art${shortId}${String(Date.now()).slice(-10)}`.slice(0, 40);

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt,
      notes: {
        type: "paid-article",
        articleId: article.id,
        articleSlug: article.slug || "",
        clerkId,
      },
    });

    return res.json({
      success: true,
      key: razorpayKeyId,
      orderId: order.id,
      amount: order.amount,
      articleId: article.id,
      articleTitle: article.name,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to create paid article order",
    });
  }
});

router.post("/verify-paid-article-payment", async (req, res) => {
  try {
    const {
      clerkId,
      articleId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};

    if (
      !clerkId ||
      !articleId ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    const isTest = process.env.RAZORPAY_MODE === "test";
    const secret = isTest
      ? process.env.RAZORPAY_TEST_KEY_SECRET
      : process.env.RAZORPAY_LIVE_KEY_SECRET;

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: "Invalid payment signature",
      });
    }

    let payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (!payment) {
      return res.status(400).json({
        success: false,
        error: "Unable to validate payment",
      });
    }

    if (payment.status === "authorized") {
      await razorpay.payments.capture(razorpay_payment_id, payment.amount, payment.currency);
      payment = await razorpay.payments.fetch(razorpay_payment_id);
    }

    if (payment.status !== "captured") {
      return res.status(400).json({
        success: false,
        error: `Payment not captured: ${payment.status}`,
      });
    }

    const user = await clerkClient.users.getUser(clerkId);
    const publicMetadata = user?.publicMetadata || {};
    const existingAccess = Array.isArray(publicMetadata?.paidArticleAccess)
      ? publicMetadata.paidArticleAccess
      : [];
    const nextAccess = Array.from(new Set([...existingAccess, articleId]));

    await clerkClient.users.updateUser(clerkId, {
      publicMetadata: {
        ...publicMetadata,
        paidArticleAccess: nextAccess,
      },
    });

    return res.json({
      success: true,
      paidArticleAccess: nextAccess,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to verify paid article payment",
    });
  }
});

export default router;
