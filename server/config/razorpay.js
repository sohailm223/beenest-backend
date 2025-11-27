import dotenv from "dotenv";
import Razorpay from "razorpay";
dotenv.config();

const isTest = process.env.RAZORPAY_MODE === "test";

const key_id = isTest
  ? process.env.RAZORPAY_TEST_KEY_ID
  : process.env.RAZORPAY_LIVE_KEY_ID;

const key_secret = isTest
  ? process.env.RAZORPAY_TEST_KEY_SECRET
  : process.env.RAZORPAY_LIVE_KEY_SECRET;

if (!key_id || !key_secret) {
  console.error("❌ Razorpay Key ID/Secret missing!");
  console.error("key_id:", key_id);
  console.error("key_secret:", key_secret);
  throw new Error("Razorpay keys are not set in environment variables");
}

export const razorpay = new Razorpay({ key_id, key_secret });
export const razorpayKeyId = key_id;


export const getPlanMapping = () => {
  const isTest = process.env.RAZORPAY_MODE === "test";
  return {
    standard: isTest
      ? process.env.RAZORPAY_TEST_PLAN_STANDARD
      : process.env.RAZORPAY_LIVE_PLAN_STANDARD,
    premium: isTest
      ? process.env.RAZORPAY_TEST_PLAN_PREMIUM
      : process.env.RAZORPAY_LIVE_PLAN_PREMIUM,
    developer: isTest
      ? process.env.RAZORPAY_TEST_PLAN_DEVELOPER
      : process.env.RAZORPAY_LIVE_PLAN_DEVELOPER,
  };
};
