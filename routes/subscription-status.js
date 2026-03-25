import express from "express";
import { resolveSubscriptionForUser } from "../utils/subscriptionState.js";

const router = express.Router();

router.post("/subscription-status", async (req, res) => {
  try {
    const { clerkId } = req.body || {};
    if (!clerkId) {
      return res.status(400).json({ success: false, error: "clerkId is required" });
    }

    const result = await resolveSubscriptionForUser(clerkId, { syncClerk: true });
    return res.json({
      success: true,
      source: result.source,
      subscription: result.subscription,
      entitlements: result.entitlements || {
        slotCount: 0,
        issueIds: [],
        accessCode: null,
        canShare: false,
        sharedReaderLimit: 0,
        sharedReaderUsed: 0,
        sharedReaders: [],
      },
    });
  } catch (error) {
    console.error("Subscription status error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
