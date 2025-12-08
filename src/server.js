import express from "express";
import cors from "cors";
import orderRouter from "./routes/place-order.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use(orderRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
