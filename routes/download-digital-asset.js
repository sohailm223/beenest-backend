import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

router.post('/download-digital-asset', async (req, res) => {
  const { clerkId, magazineId } = req.body;

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

    // Step 2: Find the digital asset for that magazine
    const assetRes = await fetch(process.env.HYGRAPH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          query GetDigitalAsset($magazineId: ID!) {
            digitalAssets(where: { magazine: { id: $magazineId } }) {
              id
              file { url }
              downloadsCount
            }
          }
        `,
        variables: { magazineId },
      }),
    });

    const asset = (await assetRes.json())?.data?.digitalAssets[0];
    if (!asset) return res.status(404).json({ error: 'Digital asset not found' });

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
