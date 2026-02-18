import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import Razorpay from "razorpay";
import crypto from "crypto";
import { request, gql } from "graphql-request";

dotenv.config();

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// Config
// const HYGRAPH_ENDPOINT = process.env.HYGRAPH_ENDPOINT;
// const HYGRAPH_TOKEN = process.env.HYGRAPH_TOKEN;
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const HYGRAPH_ENDPOINT = process.env.HYGRAPH_ENDPOINT;
const HYGRAPH_TOKEN = process.env.HYGRAPH_TOKEN;

const UPSERT_CUSTOMER = gql`
  mutation UpsertCustomer(
    $clerkId: String!
    $email: String!
    $name: String!
    $phone: String
    $city: String
    $address: String
    $state: String
    $zip: String
    $planId: String
    $razorpaySubscriptionId: String
    $subscriptionStatus: SubscriptionStatus
    $paymentStatus: PaymentStatus
  ) {
    upsertCustomer(
      where: { clerkId: $clerkId }
      upsert: {
        create: {
          clerkId: $clerkId
          email: $email
          name: $name
          phone: $phone
          city: $city
          address: $address
          state: $state
          zip: $zip
          planId: $planId
          razorpaySubscriptionId: $razorpaySubscriptionId
          subscriptionStatus: $subscriptionStatus
          paymentStatus: $paymentStatus
        }
        update: {
          name: $name
          phone: $phone
          city: $city
          address: $address
          state: $state
          zip: $zip
          planId: $planId
          razorpaySubscriptionId: $razorpaySubscriptionId
          subscriptionStatus: $subscriptionStatus
          paymentStatus: $paymentStatus
        }
      }
    ) {
      id
      clerkId
      email
      name
      phone
      city
      address
      state
      zip
      planId
      razorpaySubscriptionId
      subscriptionStatus
      paymentStatus
    }
  }
`;

// Helper function to save customer data to Hygraph
async function saveCustomerToHygraph(customerData) {
  try {
    console.log("💾 Saving customer data to Hygraph:", customerData.email);
    
    const result = await request(
      HYGRAPH_ENDPOINT,
      UPSERT_CUSTOMER,
      customerData,
      { Authorization: `Bearer ${HYGRAPH_TOKEN}` }
    );
    
    console.log("✅ Customer saved successfully:", result.upsertCustomer.email);
    return result.upsertCustomer;
  } catch (error) {
    console.error("❌ Hygraph save error:", error);
    throw error;
  }
}

// 1️⃣ Create Subscription
app.post("/api/create-subscription", async (req, res) => {
  try {
    const { clerkId, email, name, phone, planId, city, state, zip, address } = req.body;

    // Add validation to ensure required fields are present
    if (!clerkId || !email || !name || !planId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: clerkId, email, name, or planId"
      });
    }

    console.log("📌 Creating subscription for:", email);
    console.log("📌 Plan ID:", planId);
    console.log("📌 Razorpay Key ID:", process.env.RAZORPAY_KEY_ID ? "Present" : "Missing");

    // Verify Razorpay credentials
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({
        success: false,
        error: "Razorpay credentials not configured"
      });
    }

    // Create Razorpay subscription
    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: 12,
      quantity: 1,
      notes: { 
        clerkId,
        email, 
        name, 
        phone, 
        city, 
        state, 
        zip,
        address 
      }
    });

    console.log("✅ Subscription created:", subscription.id);
    console.log("📋 Subscription details:", JSON.stringify(subscription, null, 2));

    res.json({
      success: true,
      razorpaySubscriptionId: subscription.id,
      key: process.env.RAZORPAY_KEY_ID,
    });

  } catch (error) {
    console.error("❌ Error creating subscription:", error);
    console.error("❌ Error details:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || "Unknown error"
    });
  }
});

// 2️⃣ Verify Payment

// 2️⃣ Verify Payment
app.post("/api/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_subscription_id,
      razorpay_payment_id,
      razorpay_signature,
      email,
      name,
      phone,
      planId,
      address,
      city,
      state,
      zip,
    } = req.body;

    if ((!razorpay_order_id && !razorpay_subscription_id) || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: "Missing payment verification data",
      });
    }

    // Build signature string (order flow vs subscription flow)
    const signaturePayload = razorpay_order_id
      ? `${razorpay_order_id}|${razorpay_payment_id}`
      : `${razorpay_subscription_id}|${razorpay_payment_id}`;

    // Generate expected signature
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(signaturePayload)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: "Invalid signature",
      });
    }

    console.log("✅ Payment verified for:", email || name);
    console.log("✅ Payment ID:", razorpay_payment_id);
    if (razorpay_subscription_id) console.log("✅ Subscription ID:", razorpay_subscription_id);
    if (razorpay_order_id) console.log("✅ Order ID:", razorpay_order_id);

    // TODO: Save customer data into Hygraph here if needed

    res.json({
      success: true,
      message: "Payment successful!",
      subscriptionId: razorpay_subscription_id || null,
      orderId: razorpay_order_id || null,
      paymentId: razorpay_payment_id,
    });
  } catch (error) {
    console.error("❌ Verification error:", error);
    res.status(500).json({
      success: false,
      error: "Payment verification failed",
    });
  }
});


// 3️⃣ Webhook (Optional - for tracking subscription events)
app.post("/api/webhook", async (req, res) => {
  try {
    const { event, payload } = req.body;

    console.log("📌 Webhook received:", event);

    if (event === 'subscription.charged' && payload.payment.status === 'captured') {
      const subscription = payload.subscription;
      const payment = payload.payment;
      const { clerkId, email, name, phone, city, state, zip, address } = subscription.notes;
      
      console.log("✅ Subscription charged successfully:");
      console.log("   - Subscription ID:", subscription.id);
      console.log("   - Payment ID:", payment.id);
      console.log("   - Amount:", payment.amount);
      console.log("   - User Email:", email);

      // Update customer data in Hygraph for recurring payments
      if (clerkId && email) {
        try {
          await saveCustomerToHygraph({
            clerkId,
            email,
            name,
            phone,
            city,
            address,
            state,
            zip,
            planId: subscription.plan_id,
            razorpaySubscriptionId: subscription.id,
            subscriptionStatus: "Active",
            paymentStatus: "Completed"
          });
          console.log("💾 Customer data updated via webhook");
        } catch (error) {
          console.error("❌ Webhook: Failed to update customer data:", error);
        }
      }
    }

    if (event === 'subscription.cancelled') {
      console.log("❌ Subscription cancelled:", payload.subscription.id);
      const subscription = payload.subscription;
      const { clerkId, email } = subscription.notes;
      
      // Update subscription status to cancelled
      if (clerkId && email) {
        try {
          await saveCustomerToHygraph({
            clerkId,
            email,
            name: subscription.notes.name,
            phone: subscription.notes.phone,
            city: subscription.notes.city,
            address: subscription.notes.address,
            state: subscription.notes.state,
            zip: subscription.notes.zip,
            planId: subscription.plan_id,
            razorpaySubscriptionId: subscription.id,
            subscriptionStatus: "Cancelled", // Update status to cancelled
            paymentStatus: "Cancelled"
          });
          console.log("💾 Customer subscription status updated to cancelled");
        } catch (error) {
          console.error("❌ Webhook: Failed to update cancellation status:", error);
        }
      }
    }

    if (event === 'subscription.completed') {
      console.log("✅ Subscription completed:", payload.subscription.id);
      const subscription = payload.subscription;
      const { clerkId, email } = subscription.notes;
      
      // Update subscription status to completed
      if (clerkId && email) {
        try {
          await saveCustomerToHygraph({
            clerkId,
            email,
            name: subscription.notes.name,
            phone: subscription.notes.phone,
            city: subscription.notes.city,
            address: subscription.notes.address,
            state: subscription.notes.state,
            zip: subscription.notes.zip,
            planId: subscription.plan_id,
            razorpaySubscriptionId: subscription.id,
            subscriptionStatus: "Completed", // Update status to completed
            paymentStatus: "Completed"
          });
          console.log("💾 Customer subscription status updated to completed");
        } catch (error) {
          console.error("❌ Webhook: Failed to update completion status:", error);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).json({ error: "Webhook failed" });
  }
});

// 5️⃣ Get Customer Data by Clerk ID or Email
app.get("/api/customer/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const { type = 'clerkId' } = req.query; // type can be 'clerkId' or 'email'

    const GET_CUSTOMER = gql`
      query GetCustomer($clerkId: String, $email: String) {
        customer(where: { 
          ${type === 'email' ? 'email: $email' : 'clerkId: $clerkId'}
        }) {
          id
          clerkId
          email
          name
          phone
          city
          address
          state
          zip
          planId
          razorpaySubscriptionId
          subscriptionStatus
          paymentStatus
          createdAt
          updatedAt
        }
      }
    `;

    const variables = type === 'email' ? { email: identifier } : { clerkId: identifier };
    
    const result = await request(
      HYGRAPH_ENDPOINT,
      GET_CUSTOMER,
      variables,
      { Authorization: `Bearer ${HYGRAPH_TOKEN}` }
    );

    if (!result.customer) {
      return res.status(404).json({ 
        success: false, 
        error: "Customer not found" 
      });
    }

    res.json({
      success: true,
      customer: result.customer
    });

  } catch (error) {
    console.error("❌ Error fetching customer:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customer data"
    });
  }
});

// 6️⃣ Get All Customers (Optional - for admin)
app.get("/api/customers", async (req, res) => {
  try {
    const { limit = 50, skip = 0, subscriptionStatus } = req.query;

    const GET_CUSTOMERS = gql`
      query GetCustomers($limit: Int, $skip: Int, $subscriptionStatus: SubscriptionStatus) {
        customers(
          first: $limit
          skip: $skip
          ${subscriptionStatus ? 'where: { subscriptionStatus: $subscriptionStatus }' : ''}
          orderBy: createdAt_DESC
        ) {
          id
          clerkId
          email
          name
          phone
          city
          state
          planId
          subscriptionStatus
          paymentStatus
          createdAt
        }
      }
    `;

    const variables = {
      limit: parseInt(limit),
      skip: parseInt(skip),
      ...(subscriptionStatus && { subscriptionStatus })
    };
    
    const result = await request(
      HYGRAPH_ENDPOINT,
      GET_CUSTOMERS,
      variables,
      { Authorization: `Bearer ${HYGRAPH_TOKEN}` }
    );

    res.json({
      success: true,
      customers: result.customers,
      count: result.customers.length
    });

  } catch (error) {
    console.error("❌ Error fetching customers:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customers"
    });
  }
});
app.get("/", (req, res) => {
  res.send("Beenest Magazine Group Backend API is running");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
