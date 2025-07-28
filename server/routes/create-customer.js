import express from 'express';
import fetch from 'node-fetch'; // Use only if you're not on Node 18+

const router = express.Router();

router.post('/create-customer', async (req, res) => {
  const { clerkId, email, name, imageUrl } = req.body;

  console.log("🔥 POST /create-customer hit");
  console.log("📦 Incoming Clerk user data:", req.body);

  try {
    // 1. First check if the user already exists in Hygraph
    const checkResponse = await fetch(process.env.HYGRAPH_API, {
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
              name
              email
            }
          }
        `,
        variables: {
          clerkId,
        },
      }),
    });

    const checkData = await checkResponse.json();

    if (checkData?.data?.customer) {
      console.log("✅ Customer already exists:", checkData.data.customer);
      return res.status(200).json({ message: 'Customer already exists', customer: checkData.data.customer });
    }

    // 2. Create new customer in Hygraph
    const createResponse = await fetch(process.env.HYGRAPH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          mutation CreateCustomer($clerkId: String!, $email: String!, $name: String!) {
            createCustomer(data: {
              clerkId: $clerkId,
              email: $email,
              name: $name
            }) {
              id
              name
              email
            }
          }
        `,
        variables: {
          clerkId,
          email,
          name,
        },
      }),
    });

    const createData = await createResponse.json();
    console.log("✅ Customer created in Hygraph:", createData.data.createCustomer);

    return res.status(200).json({ message: 'Customer created', customer: createData.data.createCustomer });

  } catch (err) {
    console.error("❌ Error syncing customer to Hygraph:", err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
