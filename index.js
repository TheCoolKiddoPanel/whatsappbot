const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs-extra");

fs.ensureDirSync("./data");

// ---------------- FILES ----------------
const files = {
 roles: "./data/roles.json",
 mute: "./data/mute.json",
 warnings: "./data/warnings.json"
};

for (let k in files) {
 if (!fs.existsSync(files[k])) fs.writeJsonSync(files[k], {});
}

// ---------------- CONFIG ----------------
const configPath = "./config.json";
let config = fs.existsSync(configPath)
 ? fs.readJsonSync(configPath)
 : { prefix: "!", muteTime: 60000 };

function saveConfig() {
 fs.writeJsonSync(configPath, config);
}

// ---------------- LOAD DATA ----------------
let roles = fs.readJsonSync(files.roles);
let mute = fs.readJsonSync(files.mute);
let warnings = fs.readJsonSync(files.warnings);

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

function save(file, data) {
 fs.writeJsonSync(file, data);
}

// ---------------- WARN SYSTEM ----------------
function addWarn(user, reason) {
 if (!warnings[user]) warnings[user] = [];
 warnings[user].push({ reason, time: Date.now() });
 save(files.warnings, warnings);
 return warnings[user].length;
}

// ---------------- START ----------------
client.on("qr", qr => qrcode.generate(qr, { small: true }));

client.on("ready", () => {
 console.log("🤖 BOT ONLINE");

 const botId = client.info.wid._serialized;

 roles[botId] = "owner";
 save(files.roles, roles);

 console.log("🛠 BOT OWNER:", botId);
});

// ---------------- MESSAGE ----------------
client.on("message_create", async (m) => {
 try {
  if (!m.body) return;

  const isOwn = m.fromMe;

  const chat = await m.getChat();
  if (!chat.isGroup) return;

  const user = m.author || m.from;

  if (mute[user] && Date.now() < mute[user]) {
   if (!isOwn) await m.delete(true);
   return;
  }

  if (!m.body.startsWith(config.prefix)) return;

  const args = m.body.slice(config.prefix.length).trim().split(" ");
  const cmd = args.shift().toLowerCase();

  // ---------------- HELP COMMAND ----------------
  if (cmd === "help") {
   return m.reply(
`📌 BOT COMMANDS

👤 INFO:
${config.prefix}role
${config.prefix}rolecheck
${config.prefix}testself

🛡 ADMIN:
${config.prefix}promote @user
${config.prefix}demote @user
${config.prefix}kick @user
${config.prefix}mute @user

⚠️ WARN:
${config.prefix}warn @user reason
${config.prefix}warns @user
${config.prefix}clearwarn @user

⚙️ CONFIG:
${config.prefix}config
${config.prefix}setprefix !
${config.prefix}setmute 60000`
   );
  }

  // ---------------- CONFIG ----------------
  if (cmd === "config") {
   return m.reply(
`⚙️ CONFIG
Prefix: ${config.prefix}
Mute: ${config.muteTime}`
   );
  }

  if (cmd === "setprefix") {
   if (role(user) !== "owner") return;
   config.prefix = args[0];
   saveConfig();
   return m.reply("✅ Prefix: " + config.prefix);
  }

  if (cmd === "setmute") {
   if (role(user) !== "owner") return;
   config.muteTime = Number(args[0]);
   saveConfig();
   return m.reply("✅ Mute: " + config.muteTime);
  }

  // ---------------- ROLE ----------------
  if (cmd === "role") {
   return m.reply("Role: " + role(user));
  }

  // ---------------- TEST ----------------
  if (cmd === "testself") {
   return m.reply(isOwn ? "Own message OK" : "Not own");
  }

  // ---------------- PROMOTE ----------------
  if (cmd === "promote") {
   if (!has(user, "admin")) return;
   const t = m.mentionedIds[0];
   if (!t) return;
   roles[t] = "admin";
   save(files.roles, roles);
   await chat.promoteParticipants([t]);
   return chat.sendMessage("⬆️ promoted");
  }

  // ---------------- DEMOTE ----------------
  if (cmd === "demote") {
   if (!has(user, "admin")) return;
   const t = m.mentionedIds[0];
   if (!t) return;
   roles[t] = "user";
   save(files.roles, roles);
   await chat.demoteParticipants([t]);
   return chat.sendMessage("⬇️ demoted");
  }

  // ---------------- KICK ----------------
  if (cmd === "kick") {
   if (!has(user, "admin")) return;
   const t = m.mentionedIds[0];
   if (!t) return;
   await chat.removeParticipants([t]);
   return chat.sendMessage("👢 kicked");
  }

  // ---------------- MUTE ----------------
  if (cmd === "mute") {
   if (!has(user, "admin")) return;
   const t = m.mentionedIds[0];
   if (!t) return;
   mute[t] = Date.now() + config.muteTime;
   save(files.mute, mute);
   return chat.sendMessage("🔇 muted");
  }

  // ---------------- WARN ----------------
  if (cmd === "warn") {
   if (!has(user, "admin")) return;
   const t = m.mentionedIds[0];
   const reason = args.join(" ") || "no reason";

   if (!warnings[t]) warnings[t] = [];

   warnings[t].push({ reason, time: Date.now() });
   save(files.warnings, warnings);

   const count = warnings[t].length;

   if (count >= 3) {
    await chat.removeParticipants([t]);
    return chat.sendMessage("🚫 KICKED (3 warns)");
   }

   return chat.sendMessage(`⚠️ Warn (${count}/3)`);
  }

  // ---------------- WARNS LIST ----------------
  if (cmd === "warns") {
   const t = m.mentionedIds[0] || user;
   const list = warnings[t] || [];
   if (!list.length) return m.reply("No warns");

   return m.reply(list.map((w,i)=>`${i+1}. ${w.reason}`).join("\n"));
  }

  // ---------------- CLEAR WARNS ----------------
  if (cmd === "clearwarn") {
   if (!has(user, "admin")) return;
   const t = m.mentionedIds[0];
   if (!t) return;
   warnings[t] = [];
   save(files.warnings, warnings);
   return chat.sendMessage("✅ cleared warns");
  }

 } catch (e) {
  console.log("ERROR:", e);
 }
});

// ---------------- INIT ----------------
client.initialize();