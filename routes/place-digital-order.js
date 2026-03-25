import express from "express";
import fetch from "node-fetch";
import { sendDigitalPurchaseEmails } from "../utils/sendEmail.js";

const router = express.Router();

async function hygraphRequest(query, variables = {}) {
  const response = await fetch(process.env.HYGRAPH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload?.errors?.length) {
    throw new Error(JSON.stringify(payload?.errors || payload));
  }

  return payload?.data;
}

router.post("/place-digital-order", async (req, res) => {
  const { clerkId, magazineId, payment } = req.body || {};

  if (!clerkId || !magazineId) {
    return res.status(400).json({
      success: false,
      error: "clerkId and magazineId are required",
    });
  }

  try {
    const customerData = await hygraphRequest(
      `
        query GetCustomerForDigitalOrder($clerkId: String!) {
          customer(where: { clerkId: $clerkId }) {
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
      { clerkId }
    );

    const customer = customerData?.customer;
    if (!customer?.id) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    const magazineData = await hygraphRequest(
      `
        query GetMagazineForDigitalOrder($magazineId: ID!) {
          magazine(where: { id: $magazineId }) {
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
      { magazineId }
    );

    const magazine = magazineData?.magazine;
    if (!magazine?.id) {
      return res.status(404).json({ success: false, error: "Magazine not found" });
    }

    const itemPrice = Number(magazine?.price || 0);
    const totalAmount = Number.isFinite(itemPrice) && itemPrice > 0 ? itemPrice : 0;

    const orderData = await hygraphRequest(
      `
        mutation CreateDigitalOrder(
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
      {
        clerkId,
        totalAmount,
        shippingName: customer.name || "Digital Customer",
        shippingEmail: customer.email || "",
        shippingPhone: customer.phone || "0000000000",
        shippingAddress:
          [customer.address, customer.city, customer.state, customer.zip]
            .filter(Boolean)
            .join(", ") || "Digital Order",
        paymentMethod: "online",
        customerId: customer.id,
        razorPayCheckoutId: payment?.razorpay_order_id || null,
        orderStatus: "paid",
      }
    );

    const orderId = orderData?.createOrder?.id;
    if (!orderId) {
      return res.status(500).json({ success: false, error: "Failed to create digital order" });
    }

    await hygraphRequest(
      `
        mutation CreateDigitalOrderItem($quantity: Int!, $total: Int!, $magazineId: ID!, $orderId: ID!) {
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
      {
        quantity: 1,
        total: totalAmount,
        magazineId,
        orderId,
      }
    );

    try {
      await sendDigitalPurchaseEmails({
        userEmail: customer.email || "",
        userName: customer.name || "Reader",
        clerkId,
        orderId,
        paymentId: payment?.razorpay_payment_id || "",
        magazine,
      });
    } catch (emailError) {
      console.error("Digital order email send failed:", emailError?.message || emailError);
    }

    return res.json({ success: true, orderId });
  } catch (error) {
    console.error("place-digital-order error:", error?.message || error);
    return res.status(500).json({
      success: false,
      error: "Failed to place digital order",
    });
  }
});

export default router;
