import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import app from "../app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load local .env for dev; on Vercel, env vars come from project settings.
dotenv.config({ path: path.join(__dirname, "..", ".env") });

export default app;
