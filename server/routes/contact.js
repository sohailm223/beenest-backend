import express from "express";
import nodemailer from "nodemailer";
import multer from "multer";

const router = express.Router();

// Memory storage works on serverless environments like Vercel.
const upload = multer({ storage: multer.memoryStorage() });

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

router.post("/", upload.single("attachment"), async (req, res) => {
  try {
    const { name, email, phone, message, subject } = req.body;
    const smtpUser = (process.env.SMTP_USER || process.env.EMAIL_USER || "").trim();
    const smtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || "").trim();
    const contactTo = (process.env.CONTACT_TO || process.env.EMAIL_TO || "sohailm223@gmail.com").trim();
    const logoUrl = (
      process.env.CONTACT_LOGO_URL ||
      "https://www.beenest.in/static/media/beenest_icon.761d0b8794d27179a786.webp"
    ).trim();

    if (!name || !email || !phone || !message) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required form fields." });
    }

    if (!smtpUser || !smtpPass) {
      return res.status(500).json({
        success: false,
        message: "SMTP credentials are missing. Set SMTP_USER/SMTP_PASS or EMAIL_USER/EMAIL_PASS.",
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safePhone = escapeHtml(phone);
    const safeMessage = escapeHtml(message).replace(/\n/g, "<br/>");
    const safeSubject = escapeHtml(subject || "Contact Form Submission");
    const submittedAt = new Date().toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    });

    const html = `
<div style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
    <tr>
      <td style="padding:18px 24px; text-align:center; background:#fff; border-bottom:1px solid #e5e7eb; ">
        <img src="${logoUrl}" alt="Beenest" style="height:80px;max-width:220px;object-fit:contain;display:block;" />
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        <h2 style="margin:0 0 8px 0;font-size:22px;line-height:1.3;color:#111827;">New Contact Form Submission</h2>
        <p style="margin:0 0 18px 0;color:#6b7280;font-size:14px;">${submittedAt}</p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;width:160px;font-weight:700;">Name</td>
            <td style="padding:10px 12px;border:1px solid #e5e7eb;">${safeName}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">Email</td>
            <td style="padding:10px 12px;border:1px solid #e5e7eb;"><a href="mailto:${safeEmail}" style="color:#2563eb;text-decoration:none;">${safeEmail}</a></td>
          </tr>
          <tr>
            <td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">Phone</td>
            <td style="padding:10px 12px;border:1px solid #e5e7eb;">${safePhone}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">Subject</td>
            <td style="padding:10px 12px;border:1px solid #e5e7eb;">${safeSubject}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;vertical-align:top;">Message</td>
            <td style="padding:10px 12px;border:1px solid #e5e7eb;line-height:1.6;">${safeMessage}</td>
          </tr>
        </table>

        <p style="margin:18px 0 0 0;color:#6b7280;font-size:13px;">Tip: Use reply to respond directly to ${safeName}.</p>
      </td>
    </tr>
  </table>
</div>
    `;

    const mailOptions = {
      from: smtpUser,
      to: contactTo,
      replyTo: email,
      subject: `Contact Form: ${name}`,
      text: `
Name: ${name}
Email: ${email}
Phone: ${phone}
Message: ${message}
      `,
      html,
      attachments: req.file
        ? [{ filename: req.file.originalname, content: req.file.buffer }]
        : [],
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Mail sent:", info.messageId);

    return res.json({ success: true, message: "Message sent successfully!" });
  } catch (error) {
    console.error("Mail Error:", error);
    return res.status(500).json({ success: false, message: "Mail sending failed." });
  }
});

export default router;
