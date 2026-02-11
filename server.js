import express from "express";
import axios from "axios";
import sqlite3 from "sqlite3";
import { Client, GatewayIntentBits, SlashCommandBuilder, Routes } from "discord.js";
import { REST } from "@discordjs/rest";

// ===============================
// ENV VARIABLES
// ===============================
const DISCORD_TOKEN = process.env.BOTTOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CUSTOMER_ROLE_ID = process.env.CUSTOMER_ROLE_ID;
const PORT = process.env.PORT || 3000;

const PAYHIP_URL = "https://payhip.com/api/v2/license/verify";

// ===============================
// PAYHIP PRODUCTS (FROM ENV)
// ===============================
const PAYHIP_PRODUCTS = {
  CraftingSystem: process.env.PAYHIP_SECRET_1,
  CharacterCreation: process.env.PAYHIP_SECRET_2,
  HoodSystemsPack: process.env.PAYHIP_SECRET_3,
  CharacterCreation2: process.env.PAYHIP_SECRET_4,
  HoodAssetsPack: process.env.PAYHIP_SECRET_5,
  PoliceSystem: process.env.PAYHIP_SECRET_6,
  AdvancedDuelsGame: process.env.PAYHIP_SECRET_7,
  AdvancedPhoneSystem: process.env.PAYHIP_SECRET_8,
  AdvancedGunSystem: process.env.PAYHIP_SECRET_9,
  LowPolyNYC: process.env.PAYHIP_SECRET_10,
};

// ===============================
// DATABASE
// ===============================
const db = new sqlite3.Database("./licenses.db");

db.run(`
  CREATE TABLE IF NOT EXISTS licenses (
    licenseKey TEXT PRIMARY KEY,
    productId TEXT,
    creatorType TEXT,
    creatorId TEXT,
    discordUserId TEXT
  )
`);

// ===============================
// EXPRESS SERVER (ROBLOX VERIFY)
// ===============================
const app = express();
app.use(express.json());

// Health check for Render
app.get("/", (_, res) => {
  res.send("License server running");
});

// Roblox License Verification
app.post("/verify", async (req, res) => {
  const { licenseKey, productId, creatorType, creatorId } = req.body;

  if (!licenseKey || !productId || !creatorType || !creatorId)
    return res.json({ success: false, error: "Missing data" });

  const secret = PAYHIP_PRODUCTS[productId];
  if (!secret)
    return res.json({ success: false, error: "Unknown product" });

  try {
    const r = await axios.get(PAYHIP_URL, {
      params: { license_key: licenseKey },
      headers: { "product-secret-key": secret }
    });

    if (!r.data?.data?.enabled)
      return res.json({ success: false, error: "Invalid license" });

    db.get("SELECT * FROM licenses WHERE licenseKey = ?", [licenseKey], (err, row) => {

      // If license already locked to another creator
      if (row && row.creatorId && row.creatorId !== creatorId) {
        return res.json({ success: false, error: "License already used in another game" });
      }

      // First time use → lock it
      if (!row) {
        db.run(
          "INSERT INTO licenses VALUES (?, ?, ?, ?, NULL)",
          [licenseKey, productId, creatorType, creatorId]
        );
      }

      return res.json({ success: true });
    });

  } catch (err) {
    console.error("Verify error:", err);
    return res.json({ success: false, error: "Server error" });
  }
});

// ===============================
// DISCORD BOT
// ===============================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const commands = [
  new SlashCommandBuilder()
    .setName("redeem")
    .setDescription("Redeem your license key")
    .addStringOption(opt =>
      opt.setName("key")
        .setDescription("Your license key")
        .setRequired(true)
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

// Register slash command
(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Slash command error:", err);
  }
})();

// Discord Ready
client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// Discord Redeem Handler
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "redeem") return;

  const licenseKey = interaction.options.getString("key");
  const discordUserId = interaction.user.id;

  for (const [productId, secret] of Object.entries(PAYHIP_PRODUCTS)) {
    try {
      const r = await axios.get(PAYHIP_URL, {
        params: { license_key: licenseKey },
        headers: { "product-secret-key": secret }
      });

      if (r.data?.data?.enabled) {

        db.get("SELECT * FROM licenses WHERE licenseKey = ?", [licenseKey], async (_, row) => {

          if (row && row.discordUserId && row.discordUserId !== discordUserId)
            return interaction.reply({ content: "❌ License already used.", ephemeral: true });

          if (!row) {
            db.run(
              "INSERT INTO licenses VALUES (?, ?, NULL, NULL, ?)",
              [licenseKey, productId, discordUserId]
            );
          } else {
            db.run(
              "UPDATE licenses SET discordUserId = ? WHERE licenseKey = ?",
              [discordUserId, licenseKey]
            );
          }

          try {
            const member = await interaction.guild.members.fetch(discordUserId);
            await member.roles.add(CUSTOMER_ROLE_ID);
          } catch (e) {
            console.error("Role error:", e);
          }

          return interaction.reply({
            content: `✅ License verified for **${productId}**`,
            ephemeral: true
          });
        });

        return;
      }
    } catch {}
  }

  return interaction.reply({ content: "❌ Invalid license.", ephemeral: true });
});

client.login(DISCORD_TOKEN);

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log("Server + Bot running on port", PORT);
});
