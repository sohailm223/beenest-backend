import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

// Load environment variables
dotenv.config();

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
import createCustomer from './routes/create-customer.js';
import likeMagazineRoute from './routes/like-magazine.js';
import addToCartRoute from './routes/add-to-cart.js';
import removeFromCart from './routes/remove-from-cart.js'
import downloadDigitalAsset from './routes/download-digital-asset.js'
import placeOrder from './routes/place-order.js'
import createOrder from './routes/create-order.js'
import hyraph from './routes/hygraph.js'


app.use('/api', createCustomer);
app.use('/api', likeMagazineRoute);
app.use('/api', addToCartRoute);
app.use('/api', hyraph);
app.use('/api', removeFromCart);
app.use('/api', downloadDigitalAsset);
app.use('/api', placeOrder);
app.use('/api', createOrder);


// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
