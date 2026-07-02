const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs-extra");

fs.ensureDirSync("./data");

// ---------------- FILES ----------------
const files = {
 roles: "./data/roles.json",
 mute: "./data/mute.json",
 warnings: "./data/warnings.json",
 spam: "./data/spam.json"
};

for (let k in files) {
 if (!fs.existsSync(files[k])) fs.writeJsonSync(files[k], {});
}

const config = fs.readJsonSync("./config.json");

// ---------------- LOAD DATA ----------------
let roles = fs.readJsonSync(files.roles);
let mute = fs.readJsonSync(files.mute);
let warnings = fs.readJsonSync(files.warnings);
let spam = fs.readJsonSync(files.spam);

// ---------------- CLIENT ----------------
const client = new Client({
 authStrategy: new LocalAuth(),
 puppeteer: {
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
 }
});

// ---------------- ROLE SYSTEM ----------------
function role(u) {
 return roles[u] || "user";
}

function lvl(r) {
 return { user: 0, admin: 1, owner: 2 }[r] || 0;
}

function has(u, need) {
 return lvl(role(u)) >= lvl(need);
}

function can(actor, target) {
 if (!target) return false;
 if (role(target) === "owner") return false;
 return lvl(role(actor)) > lvl(role(target));
}

function save(file, data) {
 fs.writeJsonSync(file, data);
}

// ---------------- WARN SYSTEM ----------------
function addWarn(user, reason = "no reason") {
 if (!warnings[user]) warnings[user] = [];

 warnings[user].push({
  reason,
  time: Date.now()
 });

 save(files.warnings, warnings);

 return warnings[user].length;
}

function getWarns(user) {
 return warnings[user] || [];
}

function clearWarns(user) {
 warnings[user] = [];
 save(files.warnings, warnings);
}

// ---------------- START ----------------
client.on("qr", qr => qrcode.generate(qr, { small: true }));
client.on("ready", () => console.log("🤖 BOT ONLINE"));

// ---------------- MESSAGE (includes own messages) ----------------
client.on("message_create", async (m) => {
 try {
  if (!m.body) return;

  const isOwn = m.fromMe;

  const chat = await m.getChat();
  if (!chat.isGroup) return;

  const user = m.author || m.from;

  // ---------------- MUTE ----------------
  if (mute[user] && Date.now() < mute[user]) {
   if (!isOwn) await m.delete(true);
   return;
  }

  // ---------------- PREFIX ----------------
  if (!m.body.startsWith(config.prefix)) return;

  const args = m.body.slice(config.prefix.length).trim().split(" ");
  const cmd = args.shift().toLowerCase();

  // ---------------- ROLE ----------------
  if (cmd === "role") {
   return m.reply("Your role: " + role(user));
  }

  if (cmd === "rolecheck") {
   return m.reply(role(user));
  }

  // ---------------- SET ROLE ----------------
  if (cmd === "setrole") {
   if (!has(user, "owner")) return;

   const t = m.mentionedIds[0];
   const r = args[0];

   if (!t || !r) return m.reply("Usage: !setrole @user role");

   roles[t] = r;
   save(files.roles, roles);

   console.log(`🛠 SETROLE | ${user} → ${t} = ${r}`);

   return chat.sendMessage("✅ role set: " + r);
  }

  // ---------------- PROMOTE ----------------
  if (cmd === "promote") {
   if (!has(user, "admin")) return;

   const t = m.mentionedIds[0];
   if (!t || !can(user, t)) return;

   roles[t] = "admin";
   save(files.roles, roles);

   await chat.promoteParticipants([t]);

   console.log(`⬆️ PROMOTE | ${user} → ${t}`);

   return chat.sendMessage("⬆️ promoted");
  }

  // ---------------- DEMOTE ----------------
  if (cmd === "demote") {
   if (!has(user, "admin")) return;

   const t = m.mentionedIds[0];
   if (!t || !can(user, t)) return;

   roles[t] = "user";
   save(files.roles, roles);

   await chat.demoteParticipants([t]);

   console.log(`⬇️ DEMOTE | ${user} → ${t}`);

   return chat.sendMessage("⬇️ demoted");
  }

  // ---------------- KICK ----------------
  if (cmd === "kick") {
   if (!has(user, "admin")) return;

   const t = m.mentionedIds[0];
   if (!t || !can(user, t)) return;

   await chat.removeParticipants([t]);

   console.log(`👢 KICK | ${user} → ${t}`);

   return chat.sendMessage("👢 kicked");
  }

  // ---------------- MUTE ----------------
  if (cmd === "mute") {
   if (!has(user, "admin")) return;

   const t = m.mentionedIds[0];
   if (!t) return;

   mute[t] = Date.now() + (config.muteTime || 60000);
   save(files.mute, mute);

   console.log(`🔇 MUTE | ${user} → ${t}`);

   return chat.sendMessage("🔇 muted");
  }

  // ---------------- WARN ----------------
  if (cmd === "warn") {
   if (!has(user, "admin")) return;

   const t = m.mentionedIds[0];
   const reason = args.join(" ") || "no reason";

   if (!t) return m.reply("Usage: !warn @user reason");

   const count = addWarn(t, reason);

   console.log(`⚠️ WARN | ${user} → ${t} | ${reason} | total: ${count}`);

   // AUTO BAN AFTER 3 WARNS
   if (count >= 3) {
    await chat.removeParticipants([t]);
    console.log(`🚫 AUTO-KICK | ${t} (3 warns)`);
    return chat.sendMessage("🚫 User kicked (3 warns)");
   }

   return chat.sendMessage(`⚠️ Warned (${count}/3)`);
  }

  // ---------------- WARNS LIST ----------------
  if (cmd === "warns") {
   const t = m.mentionedIds[0] || user;

   const list = getWarns(t);

   if (!list.length) return m.reply("No warnings");

   return m.reply(
    list.map((w, i) => `${i + 1}. ${w.reason}`).join("\n")
   );
  }

  // ---------------- CLEAR WARNS ----------------
  if (cmd === "clearwarn") {
   if (!has(user, "admin")) return;

   const t = m.mentionedIds[0];
   if (!t) return m.reply("Usage: !clearwarn @user");

   clearWarns(t);

   console.log(`🧹 CLEARWARNS | ${user} → ${t}`);

   return chat.sendMessage("✅ warnings cleared");
  }

  // ---------------- TEST OWN MESSAGE ----------------
  if (cmd === "testself") {
   return m.reply(isOwn ? "Vidím vlastnú správu ✅" : "Cudzia správa");
  }

 } catch (e) {
  console.log("ERROR:", e);
 }
});

// ---------------- START ----------------
client.initialize();