import express from "express";
import fetch from "node-fetch";

const router = express.Router();

function hygraphRequest(query, variables) {
  return fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
}

async function getOrCreateCustomer({ clerkId, email, name, imageUrl }) {
  const findRes = await hygraphRequest(
    `
      query GetCustomer($clerkId: String!) {
        customer(where: { clerkId: $clerkId }) {
          id
        }
      }
    `,
    { clerkId }
  );

  const findData = await findRes.json();
  const existingCustomerId = findData?.data?.customer?.id;
  if (existingCustomerId) return existingCustomerId;

  const safeEmail = (email || "").trim() || `${clerkId}@beenest.local`;
  const safeName = (name || "").trim() || "Beenest User";

  const createRes = await hygraphRequest(
    `
      mutation CreateCustomer(
        $clerkId: String!
        $email: String!
        $name: String!
        $imageUrl: String
      ) {
        createCustomer(
          data: {
            clerkId: $clerkId
            email: $email
            name: $name
            imageUrl: $imageUrl
            subscriptionStatus: notAvailable
          }
        ) {
          id
        }
        publishManyCustomersConnection(to: PUBLISHED) {
          edges {
            node {
              id
            }
          }
        }
      }
    `,
    {
      clerkId,
      email: safeEmail,
      name: safeName,
      imageUrl: imageUrl || null,
    }
  );

  const createData = await createRes.json();
  if (createData?.errors) {
    throw new Error(JSON.stringify(createData.errors));
  }

  return createData?.data?.createCustomer?.id || null;
}

router.post("/add-to-cart", async (req, res) => {
  const { clerkId, magazineId, email, name, imageUrl } = req.body;
  console.log("Add to Cart:", { clerkId, magazineId });

  if (!clerkId || !magazineId) {
    return res.status(400).json({ error: "clerkId and magazineId are required" });
  }

  try {
    const customerId = await getOrCreateCustomer({
      clerkId,
      email,
      name,
      imageUrl,
    });

    if (!customerId) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const cartRes = await hygraphRequest(
      `
        mutation AddToCart($customerId: ID!, $magazineId: ID!) {
          updateCustomer(
            where: { id: $customerId }
            data: {
              cartMagazines: {
                connect: { where: { id: $magazineId } }
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
      { customerId, magazineId }
    );

    const cartData = await cartRes.json();
    if (cartData?.errors) {
      return res.status(500).json({
        error: "Failed to add to cart",
        details: cartData.errors,
      });
    }

    return res.status(200).json({
      message: "Added to cart",
      result: cartData.data,
    });
  } catch (err) {
    console.error("add-to-cart error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
