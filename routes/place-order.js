import express from "express";
import fetch from "node-fetch";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { razorpay } from "../config/razorpay.js";
import { sendOrderEmails } from "../utils/sendEmail.js";
import { resolveSubscriptionForUser } from "../utils/subscriptionState.js";

const router = express.Router();

function getActiveSubscriptionMetadata(user) {
  const subscription = user?.publicMetadata?.subscription || {};
  const status = String(subscription?.status || "").toLowerCase();
  const expiresAt = subscription?.expiresAt
    ? new Date(subscription.expiresAt).getTime()
    : 0;
  const freeOrderUsedByIssue =
    subscription?.freeOrderUsedByIssue && typeof subscription.freeOrderUsedByIssue === "object"
      ? subscription.freeOrderUsedByIssue
      : {};

  return {
    subscription,
    isActive: status === "active" && expiresAt > Date.now(),
    freeOrderUsedByIssue,
  };
}

function isActiveSubscription(subscription = {}) {
  const status = String(subscription?.status || "").toLowerCase();
  const expiresAt = subscription?.expiresAt ? new Date(subscription.expiresAt).getTime() : 0;
  return status === "active" && expiresAt > Date.now();
}

async function hydrateCartItemsForEmail(items = []) {
  const safeItems = Array.isArray(items) ? items : [];
  const ids = Array.from(new Set(safeItems.map((item) => item?.id).filter(Boolean)));
  if (!ids.length) return safeItems;

  const response = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({
      query: `
        query CartItemsForEmail($ids: [ID!]) {
          magazines(where: { id_in: $ids }, first: 100) {
            id
            name
            slug
            price
            magazineType
            featuredImage {
              url
            }
          }
        }
      `,
      variables: { ids },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload?.errors?.length) {
    throw new Error("Unable to hydrate order items for email");
  }

  const byId = new Map((payload?.data?.magazines || []).map((mag) => [mag.id, mag]));

  return safeItems.map((item) => {
    const hydrated = byId.get(item?.id) || {};
    return {
      ...item,
      name: hydrated?.name || item?.name || "Magazine",
      slug: hydrated?.slug || item?.slug || "",
      price: Number(item?.price || hydrated?.price || 0),
      featuredImage: hydrated?.featuredImage || item?.featuredImage || null,
      magazineType: hydrated?.magazineType || item?.magazineType || "issue",
      type:
        String(hydrated?.magazineType || item?.magazineType || "").toLowerCase() === "articlepaid"
          ? "paid_article"
          : "print_issue",
    };
  });
}

router.post("/place-order", async (req, res) => {
  const { clerkId, cartItems, shippingInfo, total, paymentMethod } = req.body;

  try {
    console.log("Received order data:", req.body);

    const isFreeSubscriptionOrder =
      paymentMethod === "subscription-free" || Number(total || 0) === 0;
    const hygraphPaymentMethod = paymentMethod === "online" ? "online" : "cod";
    const normalizedTotal = isFreeSubscriptionOrder ? 0 : Number(total || 0);

    // 1) Get customer by Clerk ID
    const getCustomer = await fetch(process.env.HYGRAPH_API, {
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
            }
          }
        `,
        variables: { clerkId },
      }),
    });

    const customerData = await getCustomer.json();
    const customerId = customerData?.data?.customer?.id;
    if (!customerId) {
      return res.status(404).json({ error: "Customer not found" });
    }

    let clerkUser = null;
    if (isFreeSubscriptionOrder) {
      const resolved = await resolveSubscriptionForUser(clerkId, { syncClerk: true });
      clerkUser = resolved.clerkUser;
      const isActive = isActiveSubscription(resolved?.subscription);
      const printEntitled = Boolean(resolved?.subscription?.printEntitled);
      const durationType = String(resolved?.subscription?.durationType || "").toLowerCase();
      const freeOrderUsedByIssue =
        resolved?.subscription?.freeOrderUsedByIssue &&
        typeof resolved.subscription.freeOrderUsedByIssue === "object"
          ? resolved.subscription.freeOrderUsedByIssue
          : {};

      if (!isActive) {
        return res.status(403).json({
          error: "Active membership required for free order",
        });
      }

      if (!printEntitled) {
        return res.status(403).json({
          error: "Your active plan does not include print entitlement.",
        });
      }

      const allowedIssueIds = resolved?.entitlements?.issueIds || [];
      const hasAllowedIssuesOnly =
        Array.isArray(cartItems) &&
        cartItems.length > 0 &&
        cartItems.every((item) => allowedIssueIds.includes(item?.id));

      if (!hasAllowedIssuesOnly) {
        return res.status(403).json({
          error: "Membership free order is only available for issues assigned to your plan slots.",
        });
      }

      const alreadyUsedForAnyIssue = cartItems.some(
        (item) => Number(freeOrderUsedByIssue?.[item?.id] || 0) >= 1
      );
      if (alreadyUsedForAnyIssue) {
        return res.status(403).json({
          error:
            durationType === "single"
              ? "Single latest issue print entitlement already used."
              : "Free print order already used for one or more selected issues.",
        });
      }
    }

    const orderStatus =
      paymentMethod === "online" || isFreeSubscriptionOrder ? "paid" : "cod";

    // 2) Create Razorpay order only for paid online checkout
    let razorpayOrderId = null;
    if (paymentMethod === "online" && normalizedTotal > 0) {
      const razorpayOrder = await razorpay.orders.create({
        amount: normalizedTotal * 100,
        currency: "INR",
        receipt: `receipt_${Date.now()}`,
      });
      razorpayOrderId = razorpayOrder.id;
    }

    // 3) Create Hygraph order
    const orderRes = await fetch(process.env.HYGRAPH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          mutation CreateOrder(
            $clerkId: String!
            $totalAmount: Int!
            $shippingName: String!
            $shippingEmail: String!
            $shippingPhone: String!
            $shippingAddress: String!
            $paymentMethod: PaymentMethod!
            $customerId: ID!
            $razorPayCheckoutId: String
            $orderStatus: OrderStatus!
          ) {
            createOrder(
              data: {
                clerkId: $clerkId
                totalAmount: $totalAmount
                shippingName: $shippingName
                shippingEmail: $shippingEmail
                shippingPhone: $shippingPhone
                shippingAddress: $shippingAddress
                paymentMethod: $paymentMethod
                razorPayCheckoutId: $razorPayCheckoutId
                orderStatus: $orderStatus
                customer: { connect: { id: $customerId } }
              }
            ) {
              id
            }
          }
        `,
        variables: {
          clerkId,
          totalAmount: normalizedTotal,
          shippingName: shippingInfo.name,
          shippingEmail: shippingInfo.email,
          shippingPhone: shippingInfo.phone,
          shippingAddress: shippingInfo.address,
          paymentMethod: hygraphPaymentMethod,
          customerId,
          razorPayCheckoutId: razorpayOrderId || null,
          orderStatus,
        },
      }),
    });

    const orderData = await orderRes.json();
    console.log("Hygraph createOrder response:", JSON.stringify(orderData, null, 2));

    const orderId = orderData?.data?.createOrder?.id;
    if (!orderId) {
      return res.status(500).json({ error: "Failed to create order" });
    }

    // 4) Create order items
    for (const item of cartItems) {
      await fetch(process.env.HYGRAPH_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
        },
        body: JSON.stringify({
          query: `
            mutation CreateOrderItem($quantity: Int!, $total: Int!, $magazineId: ID!, $orderId: ID!) {
              createOrderItem(
                data: {
                  quantity: $quantity
                  total: $total
                  magazine: { connect: { id: $magazineId } }
                  order: { connect: { id: $orderId } }
                }
              ) {
                id
              }
            }
          `,
          variables: {
            quantity: 1,
            total: isFreeSubscriptionOrder ? 0 : item.price,
            magazineId: item.id,
            orderId,
          },
        }),
      });
    }

    // 5) Remove purchased items from cart
    await fetch(process.env.HYGRAPH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          mutation RemoveFromCart($id: ID!, $disconnectItems: [MagazineWhereUniqueInput!]) {
            updateCustomer(
              where: { id: $id }
              data: { cartMagazines: { disconnect: $disconnectItems } }
            ) {
              id
            }
            publishCustomer(where: { id: $id }) {
              id
            }
          }
        `,
        variables: {
          id: customerId,
          disconnectItems: cartItems.map((item) => ({ id: item.id })),
        },
      }),
    });

    // 6) Send customer + admin email
    let emailItems = cartItems;
    try {
      emailItems = await hydrateCartItemsForEmail(cartItems);
    } catch (emailItemError) {
      console.warn("Order email item hydration failed:", emailItemError?.message);
    }

    await sendOrderEmails({
      userEmail: shippingInfo.email,
      userName: shippingInfo.name,
      orderId,
      totalAmount: normalizedTotal,
      cartItems: emailItems,
      shippingInfo,
      paymentMethod,
    });

    if (isFreeSubscriptionOrder && clerkUser) {
      const { subscription, freeOrderUsedByIssue } = getActiveSubscriptionMetadata(clerkUser);
      const nextUsage = { ...freeOrderUsedByIssue };
      for (const item of cartItems) {
        if (!item?.id) continue;
        nextUsage[item.id] = Number(nextUsage[item.id] || 0) + 1;
      }

      await clerkClient.users.updateUser(clerkId, {
        publicMetadata: {
          ...(clerkUser?.publicMetadata || {}),
          subscription: {
            ...subscription,
            freeOrderUsedByIssue: nextUsage,
          },
        },
      });
    }

    // 7) Success response
    return res.status(200).json({
      success: true,
      orderId,
      razorpayOrderId,
    });
  } catch (err) {
    console.error("Order error:", err);
    return res.status(500).json({ error: "Failed to place order" });
  }
});

export default router;
