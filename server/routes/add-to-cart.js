import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

router.post('/add-to-cart', async (req, res) => {
  const { clerkId, magazineId } = req.body;
  console.log("🛒 Add to Cart:", { clerkId, magazineId });

  try {
    // 1. Fetch Customer by Clerk ID
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
      console.error("❌ Customer not found");
      return res.status(404).json({ error: "Customer not found" });
    }

    // 2. Add Magazine to Customer's Cart
    const cartMutation = await fetch(process.env.HYGRAPH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          mutation AddToCart($customerId: ID!, $magazineId: ID!) {
            updateCustomer(
              where: { id: $customerId }
              data: {
                cartMagazines: {
                  connect: {
                    where: { id: $magazineId }
                  }
                }
              }
            ) {
              id
              cartMagazines {
                id
                name
              }
            }
            publishCustomer(where: { id: $customerId }) {
              id
            }
          }
        `,
        variables: {
          customerId,
          magazineId,
        },
      }),
    });

    const cartData = await cartMutation.json();

    if (cartData.errors) {
      console.error("❌ GraphQL Error:", cartData.errors);
      return res.status(500).json({ error: "Failed to add to cart", details: cartData.errors });
    }

    console.log("✅ Added to cart:", cartData.data);
    res.status(200).json({ message: "Added to cart", result: cartData.data });

  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
