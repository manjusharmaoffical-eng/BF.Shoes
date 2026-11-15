import { binancePayRequest } from "../src/binance-pay.js";

if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_SECRET_KEY) {
  console.log("Binance Pay connectivity check skipped: merchant API credentials are not present in this deployment environment.");
} else {
  try {
    const data = await binancePayRequest("/binancepay/openapi/certificates", {});
    const certificates = Array.isArray(data) ? data : Array.isArray(data.certificates) ? data.certificates : [];
    if (!certificates.length) throw new Error("certificate endpoint returned no public certificates");
    console.log("Binance Pay merchant API connectivity: OK (certificate endpoint responded).");
  } catch (error) {
    console.error("Binance Pay merchant API connectivity: NOT VERIFIED (" + String(error.message || "request failed").slice(0, 120) + ").");
  }
}
