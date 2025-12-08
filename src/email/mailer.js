import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Optional: check config at startup
export async function verifyTransport() {
  try {
    await transporter.verify();
    console.log("📨 SMTP ready");
  } catch (e) {
    console.error("SMTP error:", e.message);
  }
}
