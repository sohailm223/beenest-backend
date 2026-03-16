import fetch from "node-fetch";

export const MEMBERSHIP_PLAN_CATALOG = {
  print_single: {
    key: "print_single",
    planType: "print",
    durationType: "single",
    label: "Print - Single Latest Issue",
    amount: 950,
    slotCount: 1,
    validityDays: 365,
    printEntitled: true,
    digitalEntitled: false,
    canShare: false,
  },
  digital_single: {
    key: "digital_single",
    planType: "digital",
    durationType: "single",
    label: "Digital - Single Latest Issue",
    amount: 750,
    slotCount: 1,
    validityDays: 365,
    printEntitled: false,
    digitalEntitled: true,
    canShare: false,
  },
  bundle_single: {
    key: "bundle_single",
    planType: "bundle",
    durationType: "single",
    label: "Print + Digital - Single Latest Issue",
    amount: 1700,
    slotCount: 1,
    validityDays: 365,
    printEntitled: true,
    digitalEntitled: true,
    canShare: false,
  },
  print_biannual: {
    key: "print_biannual",
    planType: "print",
    durationType: "biannual",
    label: "Print - Bi-Annual (1 Year)",
    amount: 1800,
    slotCount: 2,
    validityDays: 365,
    printEntitled: true,
    digitalEntitled: false,
    canShare: false,
  },
  digital_biannual: {
    key: "digital_biannual",
    planType: "digital",
    durationType: "biannual",
    label: "Digital - Bi-Annual (1 Year)",
    amount: 1400,
    slotCount: 2,
    validityDays: 365,
    printEntitled: false,
    digitalEntitled: true,
    canShare: true,
  },
  bundle_biannual: {
    key: "bundle_biannual",
    planType: "bundle",
    durationType: "biannual",
    label: "Print + Digital - Bi-Annual (1 Year)",
    amount: 3100,
    slotCount: 2,
    validityDays: 365,
    printEntitled: true,
    digitalEntitled: true,
    canShare: true,
  },
};

function toIdSet(list = []) {
  return Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));
}

export function normalizePlanKey(planKey = "") {
  const key = String(planKey || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (MEMBERSHIP_PLAN_CATALOG[key]) return key;

  if (key.includes("print") && key.includes("digital") && key.includes("bi")) return "bundle_biannual";
  if (key.includes("print") && key.includes("digital")) return "bundle_single";
  if (key.includes("digital") && key.includes("bi")) return "digital_biannual";
  if (key.includes("print") && key.includes("bi")) return "print_biannual";
  if (key.includes("digital")) return "digital_single";
  if (key.includes("print")) return "print_single";

  return "digital_single";
}

export function getPlanConfig(planKey = "") {
  const normalized = normalizePlanKey(planKey);
  return MEMBERSHIP_PLAN_CATALOG[normalized] || MEMBERSHIP_PLAN_CATALOG.digital_single;
}

export function canShareForPlan(planKey = "") {
  return Boolean(getPlanConfig(planKey)?.canShare);
}

export function buildSubscriptionAccessCode(subscriptionId) {
  if (!subscriptionId) return null;
  return `BN-${Buffer.from(String(subscriptionId), "utf8").toString("base64url")}`;
}

export function parseSubscriptionAccessCode(accessCode) {
  if (!accessCode || typeof accessCode !== "string") return null;
  const normalized = accessCode.trim().replace(/\s+/g, "");
  if (!/^BN-/i.test(normalized)) return null;
  const raw = normalized.slice(3).replace(/\s+/g, "");
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

export async function computeIssueEntitlements(planKey = "", existingIssueIds = []) {
  const plan = getPlanConfig(planKey);
  const selected = toIdSet(existingIssueIds);

  // Single plans always pin to latest issue only.
  if (plan.durationType === "single") {
    const latest = await fetchLatestIssueIds(1);
    return {
      slotCount: 1,
      issueIds: latest.slice(0, 1),
      planKey: plan.key,
      planType: plan.planType,
      durationType: plan.durationType,
      printEntitled: plan.printEntitled,
      digitalEntitled: plan.digitalEntitled,
      canShare: plan.canShare,
      amount: plan.amount,
      validityDays: plan.validityDays,
    };
  }

  // Bi-annual:
  // - Keep first assigned issue
  // - Fill second slot only when a new latest issue appears.
  const latest = await fetchLatestIssueIds(1);
  let issueIds = selected;
  if (!issueIds.length && latest.length) {
    issueIds = [latest[0]];
  } else if (issueIds.length < plan.slotCount && latest.length && !issueIds.includes(latest[0])) {
    issueIds = [...issueIds, latest[0]];
  }

  return {
    slotCount: plan.slotCount,
    issueIds: issueIds.slice(0, plan.slotCount),
    planKey: plan.key,
    planType: plan.planType,
    durationType: plan.durationType,
    printEntitled: plan.printEntitled,
    digitalEntitled: plan.digitalEntitled,
    canShare: plan.canShare,
    amount: plan.amount,
    validityDays: plan.validityDays,
  };
}

export async function syncMembershipSelectedIssues({ membershipId, issueIds = [] }) {
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
