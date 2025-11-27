// utils/sendEmail.js
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail", // or "smtp.yourhost.com"
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // App password
  },
});

export const sendOrderEmails = async ({ userEmail, userName, orderId, totalAmount }) => {
  try {
    // 1. Customer email
    await transporter.sendMail({
      from: `"Ehaanza Store" <${process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: `Order Confirmation - #${orderId}`,
      html: `
        <h2>Hi ${userName},</h2>
        <p>Thank you for your order!</p>
        <p><b>Order ID:</b> ${orderId}</p>
        <p><b>Total:</b> ₹${totalAmount}</p>
        <p>We’ll send you another email when your order ships.</p>
        <br/>
        <p>– Ehaanza Team</p>
      `,
    });

    // 2. Admin email
    await transporter.sendMail({
      from: `"Ehaanza Store" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL, // set in .env
      subject: `New Order Received - #${orderId}`,
      html: `
        <h2>New Order Received</h2>
        <p><b>Customer:</b> ${userName}</p>
        <p><b>Email:</b> ${userEmail}</p>
        <p><b>Order ID:</b> ${orderId}</p>
        <p><b>Total:</b> ₹${totalAmount}</p>
      `,
    });

    console.log("✅ Emails sent successfully");
  } catch (err) {
    console.error("❌ Failed to send emails:", err);
  }
};
