import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import Razorpay from "razorpay";
import crypto from "crypto";
import { request, gql } from "graphql-request";



import createCustomer from "./routes/create-customer.js";
import likeMagazineRoute from "./routes/like-magazine.js";
import addToCartRoute from "./routes/add-to-cart.js";
import removeFromCart from "./routes/remove-from-cart.js";
import downloadDigitalAsset from "./routes/download-digital-asset.js";
import placeOrder from "./routes/place-order.js";
import createOrder from "./routes/create-order.js";
import hyraph from "./routes/hygraph.js";
import sendTestEmailRoute from "./routes/send-test-email.js";
import membershipRoutes from "./routes/membership.js";
import createMembership from "./routes/create-membership.js";
import subscriptionRoutes from "./routes/subscription.js";
import contactRoutes from "./routes/contact.js";
// import contactRoutes from "./routes/contact.js";
import newsletterRoutes from "./routes/newsletter.js";
import customerRoutes from "./routes/updateCustomer.js";
import createSubscriptionRoute from "./routes/create-subscription.js";
import verifyPaymentRoute from "./routes/verifyPayment.js";
import configRoutes from "./routes/config.js";
import getSubscriptionRoutes from "./routes/get-subscription.js"
import razorpayRoutes from "./routes/razorpay.js";


dotenv.config();

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads")); // serve uploaded files





app.use("/api", createCustomer);
app.use("/api", likeMagazineRoute);
app.use("/api", addToCartRoute);
app.use("/api", hyraph);
app.use("/api", removeFromCart);
app.use("/api", downloadDigitalAsset);
app.use("/api", placeOrder);
app.use("/api", createOrder);
app.use("/send-test-email", sendTestEmailRoute);
app.use("/api/membership", createMembership);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/membership", membershipRoutes);
app.use("/api/contact", contactRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use("/api", customerRoutes);
app.use("/api/create-subscription", createSubscriptionRoute);
app.use("/api/verify-payment", verifyPaymentRoute);
app.use("/api", configRoutes);
app.use("/api", getSubscriptionRoutes);
app.use("/api", razorpayRoutes);





app.get("/", (req, res) => {
  res.send("Beenest Magazine Group Backend API is running");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
