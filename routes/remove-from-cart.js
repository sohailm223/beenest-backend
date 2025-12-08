import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();

router.post('/remove-from-cart', async (req, res) => {
  const { clerkId, magazineId } = req.body;

  try {
    // Step 1: Fetch Customer ID using Clerk ID
    const userQuery = await fetch(process.env.HYGRAPH_API, {
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

    const userData = await userQuery.json();
    const customerId = userData?.data?.customer?.id;

    if (!customerId) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Step 2: Disconnect magazine and publish customer
    const mutation = await fetch(process.env.HYGRAPH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          mutation RemoveFromCart($customerId: ID!, $magazineId: ID!) {
            updateCustomer(
              where: { id: $customerId },
              data: {
                cartMagazines: { disconnect: { id: $magazineId } }
              }
            ) {
              id
            }
            publishCustomer(where: { id: $customerId }) {
              id
            }
          }
        `,
        variables: { customerId, magazineId },
      }),
    });

    const result = await mutation.json();

    if (result.errors) {
      console.error("GraphQL Error:", result.errors);
      return res.status(500).json({ error: "Failed to remove from cart" });
    }

    res.status(200).json({ message: "Magazine removed and published", result });
  } catch (err) {
    console.error("❌ Server Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
