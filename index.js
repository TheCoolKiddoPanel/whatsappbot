const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs-extra");
const express = require("express");
const bodyParser = require("body-parser");

fs.ensureDirSync("./data");

// ================= CONFIG =================
const config = {
 muteTime: 60000,
 port: 3000
};

// ================= DATA =================
const muteFile = "./data/mute.json";

let mute = fs.existsSync(muteFile)
 ? fs.readJsonSync(muteFile)
 : {};

function saveMute() {
 fs.writeJsonSync(muteFile, mute);
}

// ================= BAD WORDS =================
const badWords = [
 "fuck", "shit", "bitch",
 "kurva", "piča", "kokot",
 "debil", "idiot", "asshole", "dick"
];

// ================= NORMALIZE ID =================
function normalizeId(id) {
 if (!id) return "";
 return id.toString().split("@")[0].split(":")[0];
}

// ================= WHATSAPP CLIENT =================
const client = new Client({
 authStrategy: new LocalAuth(),
 puppeteer: {
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
 }
});

// ================= WEB APP =================
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ---------------- HOME UI ----------------
app.get("/", (req, res) => {
 res.send(`
 <h1>🤖 WhatsApp Bot Control Panel</h1>

 <h2>📤 Send Message</h2>
 <form method="POST" action="/send">
  <input name="msg" placeholder="message" />
  <button>Send</button>
 </form>

 <h2>🔇 Mute User</h2>
 <form method="POST" action="/mute">
  <input name="user" placeholder="421xxxxxxxx" />
  <button>Mute</button>
 </form>

 <h2>🔊 Unmute User</h2>
 <form method="POST" action="/unmute">
  <input name="user" placeholder="421xxxxxxxx" />
  <button>Unmute</button>
 </form>

 <h2>📋 Muted Users</h2>
 <pre>${JSON.stringify(mute, null, 2)}</pre>
 `);
});

// ---------------- SEND MESSAGE ----------------
app.post("/send", async (req, res) => {
 const { msg } = req.body;

 const chats = await client.getChats();
 const group = chats.find(c => c.isGroup);

 if (group) {
  group.sendMessage(msg);
 }

 console.log("📤 WEB MSG:", msg);
 res.send("sent");
});

// ---------------- MUTE ----------------
app.post("/mute", (req, res) => {
 const user = normalizeId(req.body.user);

 if (!user) return res.send("no user");

 mute[user] = Date.now() + config.muteTime;
 saveMute();

 console.log("🔇 WEB MUTE:", user);

 res.send("muted");
});

// ---------------- UNMUTE ----------------
app.post("/unmute", (req, res) => {
 const user = normalizeId(req.body.user);

 delete mute[user];
 saveMute();

 console.log("🔊 WEB UNMUTE:", user);

 res.send("unmuted");
});

// ================= WHATSAPP EVENTS =================
client.on("qr", qr => qrcode.generate(qr, { small: true }));

client.on("ready", () => {
 console.log("🤖 BOT ONLINE");
 console.log(`🌐 WEB UI: http://localhost:${config.port}`);

 app.listen(config.port, () => {
  console.log("🌐 Web UI running");
 });
});

// ---------------- MESSAGE HANDLER ----------------
client.on("message_create", async (m) => {
 try {
  if (!m.body) return;

  const chat = await m.getChat();
  if (!chat.isGroup) return;

  const user = normalizeId(m.author || m.from);
  const text = m.body.toLowerCase();

  // ================= MUTE =================
  if (mute[user] && Date.now() < mute[user]) {
   try { await m.delete(true); } catch {}
   return;
  }

  // ================= ANTI-VULGAR =================
  const bad = badWords.some(w => text.includes(w));

  if (bad) {
   try { await m.delete(true); } catch {}

   mute[user] = Date.now() + config.muteTime;
   saveMute();

   console.log(`🚫 BAD WORD | ${user}`);

   return chat.sendMessage("⚠️ Vulgarizmus nie je povolený!");
  }

 } catch (e) {
  console.log("ERROR:", e);
 }
});

// ================= INIT =================
client.initialize();