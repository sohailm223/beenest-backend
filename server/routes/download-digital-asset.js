import express from 'express';
import fetch from 'node-fetch';
import { clerkClient } from "@clerk/clerk-sdk-node";
import { resolveSubscriptionForUser } from "../utils/subscriptionState.js";

const router = express.Router();

function getSubscriptionMetadata(user) {
  const subscription = user?.publicMetadata?.subscription || {};
  const status = String(subscription?.status || "").toLowerCase();
  const expiresAt = subscription?.expiresAt ? new Date(subscription.expiresAt).getTime() : 0;

  return {
    subscription,
    isActive: status === "active" && expiresAt > Date.now(),
  };
}

router.post('/download-digital-asset', async (req, res) => {
  const { clerkId, magazineId, requireActiveMembership = false } = req.body;

  try {
    // Step 1: Find the customer
    const customerRes = await fetch(process.env.HYGRAPH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          query GetCustomer($clerkId: String!) {
            customer(where: { clerkId: $clerkId }) {
              id
            }
          }
        `,
        variables: { clerkId },
      }),
    });

    const customerData = await customerRes.json();
    const customerId = customerData?.data?.customer?.id;
    if (!customerId) return res.status(404).json({ error: 'Customer not found' });

    // Step 2: Find the digital asset for that magazine and membership state
    const assetRes = await fetch(process.env.HYGRAPH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          query GetDigitalAsset($magazineId: ID!, $customerId: ID!, $clerkId: String!, $now: DateTime!) {
            digitalAssets(where: { magazine: { id: $magazineId } }) {
              id
              file { url }
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
        variables: {
          magazineId,
          customerId,
          now: new Date().toISOString(),
          clerkId,
        },
      }),
    });

    const assetPayload = await assetRes.json();
    const asset = assetPayload?.data?.digitalAssets?.[0];
    if (!asset) return res.status(404).json({ error: 'Digital asset not found' });

    const alreadyPurchased = Array.isArray(asset.customer) && asset.customer.length > 0;
    const hasHygraphMembership =
      Array.isArray(assetPayload?.data?.memberships) && assetPayload.data.memberships.length > 0;
    let clerkUser = null;
    let hasResolvedMembership = false;
    let digitalEntitled = false;
    let allowedIssueIds = [];

    if (requireActiveMembership && clerkId) {
      try {
        const resolved = await resolveSubscriptionForUser(clerkId, { syncClerk: true });
        clerkUser = resolved.clerkUser;
        const status = String(resolved?.subscription?.status || "").toLowerCase();
        const expiresAt = resolved?.subscription?.expiresAt
          ? new Date(resolved.subscription.expiresAt).getTime()
          : 0;
        hasResolvedMembership = status === "active" && expiresAt > Date.now();
        digitalEntitled = Boolean(resolved?.subscription?.digitalEntitled);
        allowedIssueIds = resolved?.entitlements?.issueIds || [];
      } catch (clerkError) {
        console.warn("Unable to verify Clerk membership metadata:", clerkError?.message);
      }
    }

    const hasActiveMembership = hasHygraphMembership || hasResolvedMembership;

    if (requireActiveMembership && !hasActiveMembership && !alreadyPurchased) {
      return res.status(403).json({ error: 'Active membership required for free download' });
    }

    if (requireActiveMembership && !alreadyPurchased && !allowedIssueIds.includes(magazineId)) {
      return res.status(403).json({
        error: "This issue is not assigned to your subscription slots.",
      });
    }

    if (requireActiveMembership && !alreadyPurchased && !digitalEntitled) {
      return res.status(403).json({
        error: "Your active plan does not include digital entitlement.",
      });
    }

    // Step 3: Update the asset to associate this customer + increment download count
    const updateRes = await fetch(process.env.HYGRAPH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
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
        variables: {
          assetId: asset.id,
          customerId,
          newCount: (asset.downloadsCount || 0) + 1,
        },
      }),
    });

    const updateResult = await updateRes.json();
    if (updateResult.errors) {
      return res.status(500).json({ error: 'Failed to update download record', details: updateResult.errors });
    }

    // Step 4: Return download URL
    res.status(200).json({ fileUrl: asset.file.url });
  } catch (err) {
    console.error("❌ Server Error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

