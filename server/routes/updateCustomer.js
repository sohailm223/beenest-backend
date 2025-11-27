import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// ✅ Update existing customer
router.post("/update-customer", async (req, res) => {
  const { clerkId, customerData } = req.body;

  try {
    const response = await fetch(process.env.HYGRAPH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          mutation UpdateCustomer(
            $clerkId: String!
            $name: String
            $email: String
            $phone: String
            $address: String
            $city: String
            $state: String
            $zip: String
          ) {
            updateCustomer(
              where: { clerkId: $clerkId }
              data: {
                name: $name
                email: $email
                phone: $phone
                address: $address
                city: $city
                state: $state
                zip: $zip
              }
            ) {
              id
              name
              email
              phone
              address
              city
              state
              zip
            }
          }
        `,
        variables: { clerkId, ...customerData },
      }),
    });

    const result = await response.json();

    if (result.errors) {
      return res.status(400).json({ error: result.errors });
    }

    return res.status(200).json({ customer: result.data.updateCustomer });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
