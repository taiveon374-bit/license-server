// server.js
const express = require("express");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();

const app = express();
app.use(express.json());

// PAYHIP SECRET KEYS
const PAYHIP_SECRETS = {
  "CraftingSystem": "prod_sk_KBup9_a530f9cdfd350fff471a5f8626b9db0b7a09a397",
  "CharacterCreation": "prod_sk_qn4km_e4160de7181a828134467f7bd3b97a8f9a03de3f"
};

const PAYHIP_URL = "https://payhip.com/api/v2/license/verify";

// DATABASE
const db = new sqlite3.Database("./licenses.db");
db.run(`
  CREATE TABLE IF NOT EXISTS licenses (
    licenseKey TEXT PRIMARY KEY,
    productId TEXT,
    creatorType TEXT, -- 'user' or 'group'
    creatorId TEXT    -- player.UserId or groupId
  )
`);

// VERIFY ENDPOINT
app.post("/verify", async (req, res) => {
  const { licenseKey, productId, creatorType, creatorId } = req.body;

  if (!licenseKey || !productId || !creatorType || !creatorId)
    return res.json({ success: false, error: "Missing data" });

  const secret = PAYHIP_SECRETS[productId];
  if (!secret)
    return res.json({ success: false, error: "Unknown product" });

  try {
    // Check license with Payhip
    const r = await axios.get(PAYHIP_URL, {
      params: { license_key: licenseKey },
      headers: { "product-secret-key": secret }
    });

    if (!r.data.data || !r.data.data.enabled)
      return res.json({ success: false, error: "Invalid license" });

    // Check DB
    db.get(
      "SELECT creatorType, creatorId FROM licenses WHERE licenseKey = ?",
      [licenseKey],
      (err, row) => {
        if (err) return res.json({ success: false, error: "DB error" });

        if (row) {
          // License already linked to someone
          if (row.creatorType !== creatorType || row.creatorId !== creatorId) {
            return res.json({ success: false, error: "License already used by another creator" });
          }
          // License valid for this creator
          return res.json({ success: true, buyer: r.data.data.buyer_email });
        }

        // First-time use → assign to creator
        db.run(
          "INSERT INTO licenses (licenseKey, productId, creatorType, creatorId) VALUES (?, ?, ?, ?)",
          [licenseKey, productId, creatorType, creatorId],
          (err) => {
            if (err) return res.json({ success: false, error: "DB insert error" });
            return res.json({ success: true, buyer: r.data.data.buyer_email });
          }
        );
      }
    );

  } catch (e) {
    return res.json({ success: false, error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));
