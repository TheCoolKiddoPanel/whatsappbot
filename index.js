const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs-extra");
const express = require("express");
const bodyParser = require("body-parser");

fs.ensureDirSync("./data");

// ================= CONFIG =================
const config = {
 port: 3000,
 muteTime: 60000,
 warnLimit: 3
};

// ================= FILES =================
const muteFile = "./data/mute.json";
const warnFile = "./data/warns.json";

let mute = fs.existsSync(muteFile) ? fs.readJsonSync(muteFile) : {};
let warns = fs.existsSync(warnFile) ? fs.readJsonSync(warnFile) : {};

function saveMute() {
 fs.writeJsonSync(muteFile, mute);
}

function saveWarns() {
 fs.writeJsonSync(warnFile, warns);
}

// ================= STATE =================
let selectedGroup = null;

// ================= BAD WORDS =================
const badWords = [
 "fuck", "shit", "bitch",
 "kurva", "piča", "kokot",
 "debil", "idiot", "asshole", "dick"
];

// ================= NORMALIZE =================
function normalize(id) {
 if (!id) return "";
 return id.toString().split("@")[0].split(":")[0];
}

// ================= CLIENT =================
const client = new Client({
 authStrategy: new LocalAuth(),
 puppeteer: {
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
 }
});

// ================= WEB =================
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// ---------------- UI ----------------
app.get("/", async (req, res) => {
 const chats = await client.getChats();
 const groups = chats.filter(c => c.isGroup);

 res.send(`
 <h1>🤖 WhatsApp Bot Panel</h1>

 <h2>📌 Select Group</h2>
 <form method="POST" action="/select">
  <select name="group">
   ${groups.map(g => `<option value="${g.id._serialized}">${g.name}</option>`).join("")}
  </select>
  <button>Select</button>
 </form>

 <h2>📤 Send Message</h2>
 <form method="POST" action="/send">
  <input name="msg" placeholder="message" />
  <button>Send</button>
 </form>

 <h2>🔇 Mute User</h2>
 <form method="POST" action="/mute">
  <input name="user" placeholder="421..." />
  <button>Mute</button>
 </form>

 <h2>⚠️ Warn User</h2>
 <form method="POST" action="/warn">
  <input name="user" placeholder="421..." />
  <input name="reason" placeholder="reason" />
  <button>Warn</button>
 </form>

 <h2>📊 Warns</h2>
 <pre>${JSON.stringify(warns, null, 2)}</pre>

 <h2>📋 Muted</h2>
 <pre>${JSON.stringify(mute, null, 2)}</pre>
 `);
});

// ---------------- SELECT GROUP ----------------
app.post("/select", (req, res) => {
 selectedGroup = req.body.group;
 console.log("📌 Group selected:", selectedGroup);
 res.redirect("/");
});

// ---------------- SEND ----------------
app.post("/send", async (req, res) => {
 const msg = req.body.msg;

 if (!selectedGroup) return res.send("No group selected");

 const chat = await client.getChatById(selectedGroup);
 chat.sendMessage(msg);

 console.log("📤 WEB MSG:", msg);
 res.redirect("/");
});

// ---------------- MUTE ----------------
app.post("/mute", (req, res) => {
 const user = normalize(req.body.user);

 mute[user] = Date.now() + config.muteTime;
 saveMute();

 console.log("🔇 MUTE:", user);
 res.redirect("/");
});

// ---------------- WARN (WEB) ----------------
app.post("/warn", (req, res) => {
 const user = normalize(req.body.user);
 const reason = req.body.reason || "manual warn";

 addWarn(user, reason);

 console.log("⚠️ WEB WARN:", user, reason);
 res.redirect("/");
});

// ================= WARN SYSTEM =================
function addWarn(user, reason) {
 if (!warns[user]) warns[user] = [];

 warns[user].push({
  reason,
  time: Date.now()
 });

 saveWarns();

 console.log(`⚠️ WARN | ${user} | total: ${warns[user].length}`);

 return warns[user].length;
}

// ================= BOT =================
client.on("qr", qr => qrcode.generate(qr, { small: true }));

client.on("ready", async () => {
 console.log("🤖 BOT ONLINE");
 console.log("🌐 WEB: http://localhost:" + config.port);

 app.listen(config.port);
});

// ================= MESSAGE =================
client.on("message_create", async (m) => {
 try {
  if (!m.body) return;

  const chat = await m.getChat();
  if (!chat.isGroup) return;

  const user = normalize(m.author || m.from);

  // ---------------- MUTE ----------------
  if (mute[user] && Date.now() < mute[user]) {
   try { await m.delete(true); } catch {}
   return;
  }

  // ---------------- ANTI-VULGAR + WARN ----------------
  const text = m.body.toLowerCase();
  const bad = badWords.some(w => text.includes(w));

  if (bad) {
   try { await m.delete(true); } catch {}

   const count = addWarn(user, "vulgarizmus");

   if (count >= config.warnLimit) {
    await chat.removeParticipants([m.author]);
    console.log(`🚪 KICK | ${user} (3 warns)`);
    return chat.sendMessage("🚫 Kick (3 warns)");
   }

   return chat.sendMessage(`⚠️ Warn ${count}/${config.warnLimit}`);
  }

 } catch (e) {
  console.log("ERROR:", e);
 }
});

// ================= INIT =================
client.initialize();


// ================= TERMINAL =================
process.stdin.setEncoding("utf8");

console.log("💻 TERMINAL READY");

process.stdin.on("data", async (input) => {
 const args = input.trim().split(" ");
 const cmd = args[0];

 if (cmd === "groups") {
  const chats = await client.getChats();
  chats.filter(c => c.isGroup).forEach((g, i) => {
   console.log(`${i}: ${g.name}`);
  });
 }

 if (cmd === "select") {
  const chats = await client.getChats();
  const groups = chats.filter(c => c.isGroup);

  const i = parseInt(args[1]);
  selectedGroup = groups[i].id._serialized;

  console.log("📌 Selected:", groups[i].name);
 }

 if (cmd === "say") {
  const msg = args.slice(1).join(" ");

  if (!selectedGroup) return console.log("No group selected");

  const chat = await client.getChatById(selectedGroup);
  chat.sendMessage(msg);

  console.log("📤 SENT:", msg);
 }

 if (cmd === "warns") {
  console.log(warns);
 }

 if (cmd === "mute") {
  const user = normalize(args[1]);
  mute[user] = Date.now() + config.muteTime;
  saveMute();
  console.log("🔇 MUTED:", user);
 }

 if (cmd === "unmute") {
  const user = normalize(args[1]);
  delete mute[user];
  saveMute();
  console.log("🔊 UNMUTED:", user);
 }

 if (cmd === "help") {
  console.log(`
COMMANDS:

groups
select <id>
say <msg>
mute <user>
unmute <user>
warns
  `);
 }
});