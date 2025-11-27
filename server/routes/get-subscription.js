import express from "express";
import { GraphQLClient, gql } from "graphql-request";

const router = express.Router();

const hygraph = new GraphQLClient(process.env.HYGRAPH_API, {
  headers: {
    Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
  },
});

// Query memberships linked to customer via clerkId
const GET_MEMBERSHIPS = gql`
  query GetMemberships($clerkId: String!) {
    memberships(
      where: { customer_some: { clerkId_in: [$clerkId] }, planStatus: active }
    ) {
      id
      planId
      razorpaySubscriptionId
      planStatus
      startDate
      endDate
      amount
    }
  }
`;

router.post("/get-subscription", async (req, res) => {
  try {
    const { clerkId } = req.body;
    if (!clerkId) {
      return res.status(400).json({ error: "clerkId is required" });
    }

    const result = await hygraph.request(GET_MEMBERSHIPS, { clerkId });

    res.json({
      success: true,
      memberships: result?.memberships || [],
    });
  } catch (error) {
    console.error("❌ Error fetching subscription:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
