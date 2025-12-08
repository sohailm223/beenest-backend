import express from "express";
import nodemailer from "nodemailer";
import multer from "multer";
import path from "path";

const router = express.Router();

// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// POST route
router.post("/", upload.single("attachment"), async (req, res) => {
  try {
    console.log("📩 Form Data Received:", req.body);
    console.log("📎 File:", req.file);

    let transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: req.body.email,
      to: "your-email@example.com", // change to your email
      subject: req.body.subject,
      text: `
        Name: ${req.body.name}
        Email: ${req.body.email}
        Phone: ${req.body.phone}
        Message: ${req.body.message}
      `,
      attachments: req.file
        ? [{ filename: req.file.originalname, path: req.file.path }]
        : [],
    };

    let info = await transporter.sendMail(mailOptions);
    console.log("✅ Mail sent:", info.messageId);

    res.json({ success: true, message: "Message sent successfully!" });
  } catch (error) {
    console.error("❌ Mail Error:", error);
    res.status(500).json({ success: false, message: "Mail sending failed." });
  }
});

export default router;
