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
let lockedGroups = {}; // 🔒 LOCKDOWN

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

// ================= WARN SYSTEM =================
function addWarn(user, reason) {
 if (!warns[user]) warns[user] = [];

 warns[user].push({ reason, time: Date.now() });
 saveWarns();

 return warns[user].length;
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

app.get("/", async (req, res) => {
 const chats = await client.getChats();
 const groups = chats.filter(c => c.isGroup);

 res.send(`
 <h1>🤖 Bot Panel</h1>

 <h2>📌 Group</h2>
 <form method="POST" action="/select">
  <select name="group">
   ${groups.map(g => `<option value="${g.id._serialized}">${g.name}</option>`).join("")}
  </select>
  <button>Select</button>
 </form>

 <h2>📤 Send</h2>
 <form method="POST" action="/send">
  <input name="msg" />
  <button>Send</button>
 </form>

 <h2>📊 Warns</h2>
 <pre>${JSON.stringify(warns, null, 2)}</pre>

 <h2>🔒 Locked groups</h2>
 <pre>${JSON.stringify(lockedGroups, null, 2)}</pre>
 `);
});

app.post("/select", (req, res) => {
 selectedGroup = req.body.group;
 res.redirect("/");
});

app.post("/send", async (req, res) => {
 if (!selectedGroup) return res.send("no group");

 const chat = await client.getChatById(selectedGroup);
 chat.sendMessage(req.body.msg);

 res.redirect("/");
});

// ================= BOT =================
client.on("qr", qr => qrcode.generate(qr, { small: true }));

client.on("ready", () => {
 console.log("🤖 BOT ONLINE");
 console.log("🌐 http://localhost:" + config.port);

 app.listen(config.port);
});

// ================= MESSAGE =================
client.on("message_create", async (m) => {
 try {
  if (!m.body) return;

  const chat = await m.getChat();
  if (!chat.isGroup) return;

  const user = normalize(m.author || m.from);
  const groupId = chat.id._serialized;

  // 🔒 LOCKDOWN
  if (lockedGroups[groupId]) {
   if (!m.fromMe) {
    try { await m.delete(true); } catch {}
    return;
   }
  }

  // 🔇 MUTE
  if (mute[user] && Date.now() < mute[user]) {
   try { await m.delete(true); } catch {}
   return;
  }

  // 🚫 ANTI-VULGAR + WARN
  const text = m.body.toLowerCase();
  const bad = badWords.some(w => text.includes(w));

  if (bad) {
   try { await m.delete(true); } catch {}

   const count = addWarn(user, "vulgarizmus");

   if (count >= config.warnLimit) {
    await chat.removeParticipants([m.author]);
    return chat.sendMessage("🚫 Kick (3 warns)");
   }

   return chat.sendMessage(`⚠️ Warn ${count}/${config.warnLimit}`);
  }

 } catch (e) {
  console.log(e);
 }
});

// ================= TERMINAL =================
process.stdin.setEncoding("utf8");
console.log("💻 TERMINAL READY");

process.stdin.on("data", async (input) => {
 const args = input.trim().split(" ");
 const cmd = args[0];

 const chats = await client.getChats();
 const groups = chats.filter(c => c.isGroup);

 // LIST GROUPS
 if (cmd === "groups") {
  groups.forEach((g, i) => console.log(`${i}: ${g.name}`));
 }

 // SELECT GROUP
 if (cmd === "select") {
  const i = parseInt(args[1]);
  selectedGroup = groups[i].id._serialized;
  console.log("📌 Selected:", groups[i].name);
 }

 // SEND MESSAGE
 if (cmd === "say") {
  const msg = args.slice(1).join(" ");
  const chat = await client.getChatById(selectedGroup);
  chat.sendMessage(msg);
 }

 // MUTE
 if (cmd === "mute") {
  const u = normalize(args[1]);
  mute[u] = Date.now() + config.muteTime;
  saveMute();
 }

 // UNMUTE
 if (cmd === "unmute") {
  delete mute[normalize(args[1])];
  saveMute();
 }

 // WARN
 if (cmd === "warn") {
  const u = normalize(args[1]);
  addWarn(u, "manual warn");
 }

 // UNWARN ⭐ NOVÉ
 if (cmd === "unwarn") {
  const u = normalize(args[1]);
  if (warns[u]) warns[u].pop();
  saveWarns();
  console.log("⚠️ UNWARN:", u);
 }

 // CLEAR WARNS
 if (cmd === "clearwarns") {
  delete warns[normalize(args[1])];
  saveWarns();
 }

 // LOCKDOWN ⭐ NOVÉ
 if (cmd === "lock") {
  const g = selectedGroup;
  lockedGroups[g] = true;
  console.log("🔒 LOCKED");
 }

 // UNLOCK ⭐ NOVÉ
 if (cmd === "unlock") {
  const g = selectedGroup;
  delete lockedGroups[g];
  console.log("🔓 UNLOCKED");
 }

 // KICK
 if (cmd === "kick") {
  const chat = await client.getChatById(selectedGroup);
  await chat.removeParticipants([args[1]]);
 }

 // WARN LIST
 if (cmd === "warns") {
  console.log(warns);
 }

 // HELP (+10+ commands)
 if (cmd === "help") {
  console.log(`
COMMANDS:

groups
select <id>
say <msg>

mute <num>
unmute <num>

warn <num>
unwarn <num> ⭐
clearwarns <num>

lock ⭐
unlock ⭐

kick <num>
warns
  `);
 }
});