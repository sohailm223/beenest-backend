import fetch from "node-fetch";

export function normalizePlanKey(plan = "", options = {}) {
  const value = String(plan || "").toLowerCase();
  const period = String(options?.period || "").toLowerCase();
  const interval = Number(options?.interval || 0);
  const standardIds = [
    process.env.RAZORPAY_TEST_PLAN_STANDARD,
    process.env.RAZORPAY_LIVE_PLAN_STANDARD,
  ]
    .filter(Boolean)
    .map((id) => String(id).toLowerCase());
  const premiumIds = [
    process.env.RAZORPAY_TEST_PLAN_PREMIUM,
    process.env.RAZORPAY_LIVE_PLAN_PREMIUM,
  ]
    .filter(Boolean)
    .map((id) => String(id).toLowerCase());

  if (premiumIds.includes(value)) return "premium";
  if (standardIds.includes(value)) return "standard";
  if (value.includes("premium")) return "premium";
  if (value.includes("standard")) return "standard";
  if (value.includes("yearly")) return "premium";
  if ((value.includes("12") && value.includes("month")) || value.includes("12month")) return "premium";
  if (value.includes("quarter")) return "standard";
  if ((value.includes("3") && value.includes("month")) || value.includes("3month")) return "standard";

  if (period === "yearly") return "premium";
  if (period === "monthly" && interval >= 12) return "premium";
  if (period === "monthly" && interval > 0 && interval <= 3) return "standard";
  if (interval >= 12) return "premium";
  if (interval > 0 && interval <= 3) return "standard";

  return "unknown";
}

function getSlotCount(plan = "", options = {}) {
  const key = normalizePlanKey(plan, options);
  if (key === "premium") return 2;
  if (key === "standard") return 1;
  return 0;
}

function toIdSet(list = []) {
  return Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));
}

export function buildSubscriptionAccessCode(subscriptionId) {
  if (!subscriptionId) return null;
  return `BN-${Buffer.from(String(subscriptionId), "utf8").toString("base64url")}`;
}

export function parseSubscriptionAccessCode(accessCode) {
  if (!accessCode || typeof accessCode !== "string") return null;
  const normalized = accessCode.trim();
  if (!/^BN-/i.test(normalized)) return null;
  const raw = normalized.slice(3);
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    return decoded || null;
  } catch {
    return null;
  }
}

export async function fetchLatestIssueIds(limit = 2) {
  if (!process.env.HYGRAPH_API || !process.env.HYGRAPH_TOKEN) return [];

  const response = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({
      query: `
        query LatestIssues($first: Int!) {
          magazines(
            where: { magazineType: issue }
            first: $first
            orderBy: publishDate_DESC
          ) {
            id
          }
        }
      `,
      variables: { first: limit },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload?.errors?.length) {
    throw new Error(JSON.stringify(payload?.errors || payload));
  }

  return toIdSet((payload?.data?.magazines || []).map((item) => item?.id));
}

export async function computeIssueEntitlements(plan = "", options = {}) {
  const slotCount = getSlotCount(plan, options);
  const planKey = normalizePlanKey(plan, options);
  if (!slotCount) {
    return {
      slotCount: 0,
      issueIds: [],
      planKey,
    };
  }

  const issueIds = await fetchLatestIssueIds(slotCount);
  return {
    slotCount,
    issueIds,
    planKey,
  };
}

export async function syncMembershipSelectedIssues({
  membershipId,
  issueIds = [],
}) {
  if (!membershipId || !process.env.HYGRAPH_API || !process.env.HYGRAPH_TOKEN) return;

  const safeIds = toIdSet(issueIds);
  const response = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({
      query: `
        mutation SyncSelectedIssues($id: ID!, $selectedIssues: [MagazineWhereUniqueInput!]) {
          updateMembership(
            where: { id: $id }
            data: { selectedIssues: { set: $selectedIssues } }
          ) {
            id
          }
          publishMembership(where: { id: $id }) {
            id
          }
        }
      `,
      variables: {
        id: membershipId,
        selectedIssues: safeIds.map((id) => ({ id })),
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload?.errors?.length) {
    throw new Error(JSON.stringify(payload?.errors || payload));
  }
}
