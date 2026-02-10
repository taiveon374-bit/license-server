
// server.js
const express = require("express");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();

const app = express();
app.use(express.json());

// ONE PRODUCT = ONE PAYHIP SECRET KEY
const PAYHIP_SECRETS = {
  "CraftingSystem": "prod_sk_KBup9_a530f9cdfd350fff471a5f8626b9db0b7a09a397",
  "CharacterCreation": "prod_sk_qn4km_e4160de7181a828134467f7bd3b97a8f9a03de3f"
};

const PAYHIP_URL = "https://payhip.com/api/v2/license/verify";

const db = new sqlite3.Database("./licenses.db");
db.run(`
  CREATE TABLE IF NOT EXISTS licenses (
    productId TEXT PRIMARY KEY,
    robloxUserId TEXT
  )
`);

app.post("/verify", async (req, res) => {
  const { licenseKey, robloxUserId, productId } = req.body;
  if (!licenseKey || !robloxUserId || !productId)
    return res.json({ success: false, error: "Missing data" });

  const secret = PAYHIP_SECRETS[productId];
  if (!secret)
    return res.json({ success: false, error: "Unknown product" });

  try {
    const r = await axios.get(PAYHIP_URL, {
      params: { license_key: licenseKey },
      headers: { "product-secret-key": secret }
    });

    if (!r.data.data || !r.data.data.enabled)
      return res.json({ success: false, error: "Invalid license" });

    db.get("SELECT robloxUserId FROM licenses WHERE productId = ?", [productId], (err, row) => {
      if (row && row.robloxUserId !== robloxUserId)
        return res.json({ success: false, error: "License already used" });

      if (!row) {
        db.run("INSERT INTO licenses VALUES (?, ?)", [productId, robloxUserId]);
      }

      res.json({ success: true, buyer: r.data.data.buyer_email });
    });
  } catch {
    res.json({ success: false, error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));
