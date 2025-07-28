// utils/sendEmail.js
import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendOrderEmails({ userEmail, userName, orderId, totalAmount }) {
  const storeEmail = 'yourstore@gmail.com'; // client email

  const userSubject = `🧾 Your Beenest Order #${orderId} is Confirmed`;
  const clientSubject = `🛍️ New COD Order from ${userName}`;

  const htmlContentUser = `
    <h2>Hi ${userName},</h2>
    <p>Thank you for placing an order on Beenest.</p>
    <p><strong>Order ID:</strong> ${orderId}</p>
    <p><strong>Amount:</strong> ₹${totalAmount}</p>
    <p>We will process your COD order soon.</p>
    <br/>
    <p>Regards,<br/>Beenest Team</p>
  `;

  const htmlContentClient = `
    <h2>New COD Order Received</h2>
    <p><strong>Customer:</strong> ${userName} (${userEmail})</p>
    <p><strong>Order ID:</strong> ${orderId}</p>
    <p><strong>Amount:</strong> ₹${totalAmount}</p>
  `;

  await resend.emails.send({
    from: 'Beenest <onboarding@resend.dev>',
    to: [userEmail],
    subject: userSubject,
    html: htmlContentUser,
  });

  await resend.emails.send({
    from: 'Beenest <onboarding@resend.dev>',
    to: [storeEmail],
    subject: clientSubject,
    html: htmlContentClient,
  });
}
