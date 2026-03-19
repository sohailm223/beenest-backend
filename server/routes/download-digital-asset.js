import express from "express";
import fetch from "node-fetch";
import { verifyToken } from "@clerk/clerk-sdk-node";
import { resolveSubscriptionForUser } from "../utils/subscriptionState.js";

const router = express.Router();

async function hygraphRequest(query, variables = {}) {
  const response = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload?.errors?.length) {
    const message = payload?.errors?.[0]?.message || "Hygraph request failed";
    throw new Error(message);
  }

  return payload?.data || {};
}

function getBearerToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
}

async function getClerkIdFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) {
    return { success: false, status: 401, error: "Missing Authorization token" };
  }
  if (!process.env.CLERK_SECRET_KEY) {
    return { success: false, status: 500, error: "Missing Clerk secret key on server" };
  }

  try {
    const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    const clerkId = claims?.sub;
    if (!clerkId) {
      return { success: false, status: 401, error: "Invalid session token" };
    }
    return { success: true, clerkId };
  } catch (error) {
    return { success: false, status: 401, error: error?.message || "Unauthorized" };
  }
}

router.post("/download-digital-asset", async (req, res) => {
  const { clerkId, magazineId, requireActiveMembership = false } = req.body || {};

  if (!clerkId || !magazineId) {
    return res.status(400).json({ success: false, error: "clerkId and magazineId are required" });
  }

  try {
    const auth = await getClerkIdFromRequest(req);
    if (!auth.success) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    if (auth.clerkId !== clerkId) {
      return res.status(403).json({ success: false, error: "Session does not match requested user" });
    }

    const customerData = await hygraphRequest(
      `
        query GetCustomer($clerkId: String!) {
          customer(where: { clerkId: $clerkId }) {
            id
          }
        }
      `,
      { clerkId }
    );

    const customerId = customerData?.customer?.id;
    if (!customerId) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    const assetPayload = await hygraphRequest(
      `
        query GetDigitalAsset($magazineId: ID!, $customerId: ID!, $clerkId: String!, $now: DateTime!) {
          digitalAssets(where: { magazine: { id: $magazineId } }, first: 1) {
            id
            downloadsCount
            customer(where: { id: $customerId }) {
              id
            }
          }
          memberships(
            where: {
              customer_some: { clerkId_in: [$clerkId] }
              planStatus: active
              OR: [{ endDate_gte: $now }, { endDate: null }]
            }
          ) {
            id
          }
        }
      `,
      {
        magazineId,
        customerId,
        now: new Date().toISOString(),
        clerkId,
      }
    );

    const asset = assetPayload?.digitalAssets?.[0];
    if (!asset) {
      return res.status(404).json({ success: false, error: "Digital asset not found" });
    }

    const alreadyPurchased = Array.isArray(asset.customer) && asset.customer.length > 0;
    const hasHygraphMembership =
      Array.isArray(assetPayload?.memberships) && assetPayload.memberships.length > 0;
    let hasResolvedMembership = false;
    let digitalEntitled = false;
    let allowedIssueIds = [];

    if (requireActiveMembership) {
      try {
        const resolved = await resolveSubscriptionForUser(clerkId, { syncClerk: true });
        const status = String(resolved?.subscription?.status || "").toLowerCase();
        const expiresAt = resolved?.subscription?.expiresAt
          ? new Date(resolved.subscription.expiresAt).getTime()
          : 0;
        hasResolvedMembership = status === "active" && expiresAt > Date.now();
        digitalEntitled = Boolean(resolved?.subscription?.digitalEntitled);
        allowedIssueIds = resolved?.entitlements?.issueIds || [];
      } catch (error) {
        console.warn("Unable to verify Clerk membership metadata:", error?.message);
      }
    }

    const hasActiveMembership = hasHygraphMembership || hasResolvedMembership;

    if (requireActiveMembership && !hasActiveMembership && !alreadyPurchased) {
      return res.status(403).json({ success: false, error: "Active membership required for free access" });
    }

    if (requireActiveMembership && !alreadyPurchased && !allowedIssueIds.includes(magazineId)) {
      return res.status(403).json({
        success: false,
        error: "This issue is not assigned to your subscription slots.",
      });
    }

    if (requireActiveMembership && !alreadyPurchased && !digitalEntitled) {
      return res.status(403).json({
        success: false,
        error: "Your active plan does not include digital entitlement.",
      });
    }

    await hygraphRequest(
      `
        mutation UpdateAsset($assetId: ID!, $customerId: ID!, $newCount: Int!) {
          updateDigitalAsset(
            where: { id: $assetId }
            data: {
              customer: { connect: { where: { id: $customerId } } }
              downloadsCount: $newCount
            }
          ) {
            id
          }
          publishDigitalAsset(where: { id: $assetId }) {
            id
          }
          publishCustomer(where: { id: $customerId }) {
            id
          }
        }
      `,
      {
        assetId: asset.id,
        customerId,
        newCount: Number(asset.downloadsCount || 0) + 1,
      }
    );

    return res.status(200).json({
      success: true,
      assetId: asset.id,
      message: "Issue added to your library.",
    });
  } catch (error) {
    console.error("download-digital-asset error:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/digital-asset/:assetId/preview", async (req, res) => {
  const { assetId } = req.params;
  if (!assetId) {
    return res.status(400).json({ success: false, error: "assetId is required" });
  }

  try {
    const auth = await getClerkIdFromRequest(req);
    if (!auth.success) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }

    const data = await hygraphRequest(
      `
        query ReaderAssetSecure($assetId: ID!, $clerkId: String!) {
          digitalAssets(
            where: { id: $assetId, customer_some: { clerkId_in: [$clerkId] } }
            first: 1
          ) {
            id
            name
            previewPdf { url }
            file { url }
          }
        }
      `,
      { assetId, clerkId: auth.clerkId }
    );

    const asset = data?.digitalAssets?.[0];
    const sourceUrl = asset?.previewPdf?.url || asset?.file?.url || "";
    if (!sourceUrl) {
      return res.status(404).json({ success: false, error: "Preview not found" });
    }

    const upstream = await fetch(sourceUrl);
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ success: false, error: "Unable to fetch preview file" });
    }

    const contentType = upstream.headers.get("content-type") || "application/pdf";
    const safeName = String(asset?.name || "beenest-issue")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename=\"${safeName || "issue"}.pdf\"`);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");

    upstream.body.pipe(res);
  } catch (error) {
    console.error("digital-asset preview error:", error);
    return res.status(500).json({ success: false, error: "Unable to open issue preview" });
  }
});

export default router;
