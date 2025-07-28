import express from "express";
import fetch from "node-fetch";
import Razorpay from "razorpay";
import { sendOrderEmails } from "../utils/sendEmail.js";

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

router.post("/place-order", async (req, res) => {
  const { clerkId, cartItems, shippingInfo, total, paymentMethod } = req.body;

  try {
    // 1. Get Customer
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

    // 2. (If Online Payment) Create Razorpay Order
    let razorpayOrderId = null;

    if (paymentMethod === "online") {
      const razorpayOrder = await razorpay.orders.create({
        amount: total * 100, // in paise
        currency: "INR",
        receipt: `receipt_${Date.now()}`,
      });

      razorpayOrderId = razorpayOrder.id;
    }

    // 3. Create Hygraph Order
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
            $razorpayCheckoutId: String
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
                razorpayCheckoutId: $razorpayCheckoutId
                orderStatus: pending
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
          razorpayCheckoutId: razorpayOrderId || null,
        },
      }),
    });

    const orderData = await orderRes.json();
    const orderId = orderData?.data?.createOrder?.id;
    if (!orderId) return res.status(500).json({ error: "Failed to create order" });

    // 4. Create Order Items
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

    // 5. Clear Cart
    await fetch(process.env.HYGRAPH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          mutation ClearCart($id: ID!) {
            updateCustomer(where: { id: $id }, data: { cartMagazines: { disconnectAll: true } }) {
              id
            }
            publishCustomer(where: { id: $id }) {
              id
            }
          }
        `,
        variables: { id: customerId },
      }),
    });

    // 6. Send Email
    await sendOrderEmails({
      userEmail: shippingInfo.email,
      userName: shippingInfo.name,
      orderId,
      totalAmount: total,
    });

    // 7. Response
    return res.status(200).json({
      success: true,
      orderId,
      razorpayOrderId, // frontend needs this if online
    });
  } catch (err) {
    console.error("❌ Order Error:", err);
    return res.status(500).json({ error: "Failed to place order" });
  }
});

export default router;
