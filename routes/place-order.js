import express from "express";
import fetch from "node-fetch";
import { razorpay, razorpayKeyId } from "../config/razorpay.js";

import { sendOrderEmails } from "../utils/sendEmail.js";

const router = express.Router();

// const razorpay = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_KEY_SECRET,
// });

router.post("/place-order", async (req, res) => {
  const { clerkId, cartItems, shippingInfo, total, paymentMethod } = req.body;

  try {
    console.log("📥 Received order data:", req.body);

    // 1️⃣ Get Customer
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
    if (!customerId) return res.status(404).json({ error: "Customer not found" });

    const orderStatus = paymentMethod === "online" ? "paid" : "cod";

    // 2️⃣ (If Online Payment) Create Razorpay Order
    let razorpayOrderId = null;
    if (paymentMethod === "online") {
      const razorpayOrder = await razorpay.orders.create({
        amount: total * 100, // in paise
        currency: "INR",
        receipt: `receipt_${Date.now()}`,
      });
      razorpayOrderId = razorpayOrder.id;
    }

    // 3️⃣ Create Hygraph Order
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
          totalAmount: total,
          shippingName: shippingInfo.name,
          shippingEmail: shippingInfo.email,
          shippingPhone: shippingInfo.phone,
          shippingAddress: shippingInfo.address,
          paymentMethod,
          customerId,
          razorPayCheckoutId: razorpayOrderId || null, // ✅ Must match camelCase
          orderStatus, // ✅ Added missing field
        },
      }),
    });

    const orderData = await orderRes.json();
    console.log("📤 Hygraph createOrder response:", JSON.stringify(orderData, null, 2));

    const orderId = orderData?.data?.createOrder?.id;
    if (!orderId) return res.status(500).json({ error: "Failed to create order" });

    // 4️⃣ Create Order Items
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
            total: item.price,
            magazineId: item.id,
            orderId,
          },
        }),
      });
    }

    // 5️⃣ Remove Purchased Items from Cart
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

    // 6️⃣ Send Email
    await sendOrderEmails({
      userEmail: shippingInfo.email,
      userName: shippingInfo.name,
      orderId,
      totalAmount: total,
    });

    // 7️⃣ Response
    return res.status(200).json({
      success: true,
      orderId,
      razorpayOrderId,
    });

  } catch (err) {
    console.error("❌ Order Error:", err);
    return res.status(500).json({ error: "Failed to place order" });
  }
});

export default router;
