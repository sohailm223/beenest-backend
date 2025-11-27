import nodemailer from "nodemailer";

export const handleContactForm = async (req, res) => {
  try {
    const { name, email, subject, phone, message } = req.body;

    const transporter = nodemailer.createTransport({
      service: "gmail", // or SMTP provider
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: email,
      to: process.env.EMAIL_TO,
      subject: subject || "New Contact Form Submission",
      text: `
        Name: ${name}
        Email: ${email}
        Phone: ${phone}
        Message: ${message}
      `,
      attachments: req.file
        ? [
            {
              filename: req.file.originalname,
              content: req.file.buffer,
            },
          ]
        : [],
    };

    await transporter.sendMail(mailOptions);

    res.json({ message: "✅ Message sent successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "❌ Error sending message" });
  }
};
