import express from "express";
import fetch from "node-fetch"; // Not needed in Node 18+, but safe here

const router = express.Router();

router.post("/create-customer", async (req, res) => {
  const { clerkId, email, name } = req.body;

  console.log("🔥 POST /create-customer hit");
  console.log("📦 Incoming Clerk user data:", req.body);

  try {
    // 1. Check if the customer already exists
    const checkResponse = await fetch(process.env.HYGRAPH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
        variables: { clerkId },
      }),
    });

    const checkData = await checkResponse.json();

    if (checkData?.data?.customer) {
      console.log("✅ Customer already exists:", checkData.data.customer);
      return res.status(200).json({
        message: "Customer already exists",
        customer: checkData.data.customer,
      });
    }

    // 2. Create a new customer
    const createResponse = await fetch(process.env.HYGRAPH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          mutation CreateCustomer($clerkId: String!, $email: String!, $name: String!) {
            createCustomer(data: {
              clerkId: $clerkId,
              email: $email,
              name: $name,
              subscriptionStatus: notAvailable
            }) {
              id
              name
              email
              subscriptionStatus
            }
          }
        `,
        variables: { clerkId, email, name },
      }),
    });

    const createData = await createResponse.json();

    // Debugging: log errors from Hygraph
    if (createData.errors) {
      console.error("❌ Hygraph returned errors:", createData.errors);
      return res.status(400).json({ message: "Hygraph error", errors: createData.errors });
    }

    if (!createData?.data?.createCustomer) {
      console.error("❌ No customer created. Full response:", createData);
      return res.status(400).json({ message: "Customer creation failed", response: createData });
    }

    console.log("✅ Customer created:", createData.data.createCustomer);

    return res.status(200).json({
      message: "Customer created",
      customer: createData.data.createCustomer,
    });
  } catch (err) {
    console.error("❌ Error syncing customer to Hygraph:", err);
    return res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

export default router;
