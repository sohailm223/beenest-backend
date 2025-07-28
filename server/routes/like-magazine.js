import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

router.post('/like-magazine', async (req, res) => {
  const { clerkId, magazineId } = req.body;

  console.log("🔥 POST /like-magazine", { clerkId, magazineId });

  try {
    // 1. Query the customer by Clerk ID
    const customerQuery = await fetch(process.env.HYGRAPH_API, {
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

    const customerData = await customerQuery.json();
    const customerId = customerData?.data?.customer?.id;

    if (!customerId) {
      console.error("❌ Customer not found in Hygraph");
      return res.status(404).json({ error: "Customer not found" });
    }

    // 2. Connect the magazine to the customer's liked list
    const likeMutation = await fetch(process.env.HYGRAPH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
  query: `
    mutation LikeMagazine($customerId: ID!, $magazineId: ID!) {
      updateCustomer(
        where: { id: $customerId }
        data: {
          likedMagazines: {
            connect: {
              where: { id: $magazineId }
            }
          }
        }
      ) {
        id
        likedMagazines {
          id
          name
        }
      }
      publishCustomer(where: { id: $customerId }) {
        id
      }
    }
  `,
  variables: { customerId, magazineId },
}),
    });

    const likeData = await likeMutation.json();

    if (likeData.errors) {
      console.error("❌ GraphQL Errors:", likeData.errors);
      return res.status(500).json({ error: "Failed to like magazine", details: likeData.errors });
    }

    console.log("✅ Magazine liked:", likeData.data);
    res.status(200).json({ message: "Magazine liked", result: likeData.data });
  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
