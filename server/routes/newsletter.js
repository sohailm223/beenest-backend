import express from 'express';
import { sendNewsletterEmails } from '../utils/sendEmail.js';
const router = express.Router();

// Newsletter subscription endpoint
router.post('/subscribe', async (req, res) => {
  try {
    const { email } = req.body;

    // Basic validation
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ 
        error: 'Please enter a valid email address' 
      });
    }

    // Brevo configuration
    const BREVO_API_KEY =
      process.env.BREVO_API_KEY ||
      process.env.BRAVO_API_KEY ||
      process.env.SENDINBLUE_API_KEY;
    const rawListId =
      process.env.BREVO_LIST_ID ||
      process.env.BRAVO_LIST_ID ||
      process.env.SENDINBLUE_LIST_ID ||
      "";
    const BREVO_LIST_ID = Number(String(rawListId).trim() || 0);

    if (!BREVO_API_KEY) {
      return res.status(500).json({ error: 'Brevo API key is missing on server' });
    }

    const encodedEmail = encodeURIComponent(email);
    const existingContactRes = await fetch(
      `https://api.brevo.com/v3/contacts/${encodedEmail}`,
      {
        method: 'GET',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    if (existingContactRes.ok) {
      return res.status(409).json({
        error: 'You have already subscribed with this email.',
      });
    }

    if (existingContactRes.status !== 404) {
      const lookupError = await existingContactRes.json().catch(() => ({}));
      return res.status(400).json({
        error: lookupError?.message || 'Unable to verify existing subscriber',
      });
    }

    const brevoPayload = {
      email,
      updateEnabled: false,
    };

    if (Number.isFinite(BREVO_LIST_ID) && BREVO_LIST_ID > 0) {
      brevoPayload.listIds = [BREVO_LIST_ID];
    }

    const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(brevoPayload),
    });

    if (!brevoRes.ok) {
      const brevoError = await brevoRes.json().catch(() => ({}));
      return res.status(400).json({
        error: brevoError?.message || 'Subscription failed',
      });
    }

    await sendNewsletterEmails({ email, source: 'website' });
    return res.status(200).json({
      message: 'Successfully subscribed! Check your inbox for confirmation.',
    });

  } catch (error) {
    console.error('Subscription error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
