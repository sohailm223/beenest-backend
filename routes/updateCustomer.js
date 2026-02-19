import express from "express";
import fetch from "node-fetch";

const router = express.Router();

async function hygraphRequest(query, variables) {
  const response = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = await response.json();
  if (!response.ok || result?.errors?.length) {
    throw new Error(JSON.stringify(result?.errors || result));
  }
  return result?.data;
}

router.post("/update-customer", async (req, res) => {
  const { clerkId, customerData = {} } = req.body;
  if (!clerkId) {
    return res.status(400).json({ success: false, error: "clerkId is required" });
  }

  const variables = {
    clerkId,
    name: customerData.name || null,
    email: customerData.email || null,
    phone: customerData.phone || null,
    address: customerData.address || null,
    city: customerData.city || null,
    state: customerData.state || null,
    zip: customerData.zip || null,
  };

  try {
    if (!variables.email) {
      return res.status(400).json({
        success: false,
        error: "email is required",
      });
    }

    const existing = await hygraphRequest(
      `
        query GetCustomer($clerkId: String!) {
          customer(where: { clerkId: $clerkId }) { id }
        }
      `,
      { clerkId }
    );

    if (existing?.customer?.id) {
      const updated = await hygraphRequest(
        `
          mutation UpdateCustomer(
            $clerkId: String!
            $name: String
            $email: String!
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
        variables
      );

      if (!updated?.updateCustomer) {
        return res.status(500).json({ success: false, error: "Customer update failed" });
      }

      return res.status(200).json({ success: true, customer: updated.updateCustomer });
    }

    // Hygraph createCustomer requires email as non-null in this project schema.
    if (!variables.email) {
      return res.status(400).json({
        success: false,
        error: "email is required to create customer",
      });
    }

    const created = await hygraphRequest(
      `
        mutation CreateCustomer(
          $clerkId: String!
          $name: String
          $email: String!
          $phone: String
          $address: String
          $city: String
          $state: String
          $zip: String
        ) {
          createCustomer(
            data: {
              clerkId: $clerkId
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
      variables
    );

    if (!created?.createCustomer) {
      return res.status(500).json({ success: false, error: "Customer creation failed" });
    }

    return res.status(200).json({ success: true, customer: created.createCustomer });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
