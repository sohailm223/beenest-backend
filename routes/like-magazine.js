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

async function getOrCreateCustomer({ clerkId, email, name }) {
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

  // Keep flow working for first-time users if profile sync has not run yet.
  const safeEmail = (email || "").trim() || `${clerkId}@beenest.local`;
  const safeName = (name || "").trim() || "Beenest User";

  const createRes = await hygraphRequest(
    `
      mutation CreateCustomer(
        $clerkId: String!
        $email: String!
        $name: String!
      ) {
        createCustomer(
          data: {
            clerkId: $clerkId
            email: $email
            name: $name
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
    }
  );

  const createData = await createRes.json();
  if (createData?.errors) {
    throw new Error(JSON.stringify(createData.errors));
  }

  return createData?.data?.createCustomer?.id || null;
}

router.post("/like-magazine", async (req, res) => {
  const { clerkId, magazineId, email, name } = req.body;
  console.log("POST /like-magazine", { clerkId, magazineId });

  if (!clerkId || !magazineId) {
    return res.status(400).json({ error: "clerkId and magazineId are required" });
  }

  try {
    const customerId = await getOrCreateCustomer({
      clerkId,
      email,
      name,
    });

    if (!customerId) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const likeRes = await hygraphRequest(
      `
        mutation LikeMagazine($customerId: ID!, $magazineId: ID!) {
          updateCustomer(
            where: { id: $customerId }
            data: {
              likedMagazines: {
                connect: { where: { id: $magazineId } }
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
      { customerId, magazineId }
    );

    const likeData = await likeRes.json();
    if (likeData?.errors) {
      return res.status(500).json({
        error: "Failed to like magazine",
        details: likeData.errors,
      });
    }

    return res.status(200).json({
      message: "Magazine liked",
      result: likeData.data,
    });
  } catch (err) {
    console.error("like-magazine error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/user-liked-magazines/:clerkId", async (req, res) => {
  const { clerkId } = req.params;

  if (!clerkId) {
    return res.status(400).json({ error: "clerkId is required" });
  }

  try {
    const likedRes = await hygraphRequest(
      `
        query GetUserLikedMagazines($clerkId: String!) {
          customer(where: { clerkId: $clerkId }) {
            likedMagazines {
              id
              name
              slug
            }
          }
        }
      `,
      { clerkId }
    );

    const likedData = await likedRes.json();
    if (likedData?.errors) {
      return res.status(500).json({
        error: "Failed to fetch liked magazines",
        details: likedData.errors,
      });
    }

    const likedMagazines = likedData?.data?.customer?.likedMagazines || [];
    return res.status(200).json({
      likedMagazines: likedMagazines.map((mag) => ({
        magazineId: mag.id,
        ...mag,
      })),
    });
  } catch (err) {
    console.error("user-liked-magazines error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/unlike-magazine", async (req, res) => {
  const { clerkId, magazineId } = req.body;
  console.log("POST /unlike-magazine", { clerkId, magazineId });

  if (!clerkId || !magazineId) {
    return res.status(400).json({ error: "clerkId and magazineId are required" });
  }

  try {
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
    const customerId = findData?.data?.customer?.id;

    if (!customerId) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const unlikeRes = await hygraphRequest(
      `
        mutation UnlikeMagazine($customerId: ID!, $magazineId: ID!) {
          updateCustomer(
            where: { id: $customerId }
            data: {
              likedMagazines: {
                disconnect: { id: $magazineId }
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
      { customerId, magazineId }
    );

    const unlikeData = await unlikeRes.json();
    if (unlikeData?.errors) {
      return res.status(500).json({
        error: "Failed to unlike magazine",
        details: unlikeData.errors,
      });
    }

    return res.status(200).json({
      message: "Magazine removed from wishlist",
      result: unlikeData.data,
    });
  } catch (err) {
    console.error("unlike-magazine error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
