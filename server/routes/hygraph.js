// /routes/hygraph.js
import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

const HYGRAPH_ENDPOINT = 'https://ap-south-1.cdn.hygraph.com/content/cmb58pgyz04f707ujvcq5n3ez/master';
const HYGRAPH_TOKEN = process.env.HYGRAPH_TOKEN;

router.post('/fetch-hygraph', async (req, res) => {
  const { query, variables } = req.body;

  try {
    const response = await fetch(HYGRAPH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error('Hygraph Error:', data.errors);
      return res.status(500).json({ error: 'GraphQL query failed' });
    }

    res.json(data.data);
  } catch (err) {
    console.error('Server Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
