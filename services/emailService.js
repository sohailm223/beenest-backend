import nodemailer from "nodemailer";

export const sendContactEmail = async ({ name, email, subject, phone, message, file }) => {
  // Nodemailer transport
  const transporter = nodemailer.createTransport({
    service: "gmail", // or use SMTP config
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // Email content
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
    attachments: file
      ? [
          {
            filename: file.originalname,
            content: file.buffer,
          },
        ]
      : [],
  };

  // Send email
  return transporter.sendMail(mailOptions);
};
