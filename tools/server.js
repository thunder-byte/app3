const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");

const pbkdf2 = promisify(crypto.pbkdf2);
const root = path.resolve(__dirname, "..");
const staticRoot = path.join(root, "public");
const envFile = path.join(root, ".env");
if (fsSync.existsSync(envFile)) {
  const envContent = fsSync.readFileSync(envFile, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !match[1].startsWith("#") && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}
const databaseUrl = (process.env.POSTGRES_URL || process.env.DATABASE_URL || "").trim();
let sql = null;
if (databaseUrl) {
  const { neon } = require("@neondatabase/serverless");
  sql = neon(databaseUrl);
}
const vercelDataDirectory = process.env.VERCEL ? "/tmp/mentorshipmatch-data" : null;
const dataDirectory = path.resolve(process.env.MENTORSHIPMATCH_DATA_DIR || vercelDataDirectory || path.join(root, "data"));
const accountsPath = path.join(dataDirectory, "accounts.json");
const requestsPath = path.join(dataDirectory, "chat-requests.json");
const port = Number(process.env.PORT || 3000);
const appOrigin = (process.env.APP_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${port}`)).replace(/\/$/, "");
const maxRequestBytes = 16 * 1024;
let accounts = [];
let chatRequests = [];
let writeQueue = Promise.resolve();
let requestsWriteQueue = Promise.resolve();
const requestWindows = new Map();
const hiddenDemoEmails = new Set(["test@gmail.com"]);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

async function loadAccounts() {
  if (sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS mentorship_accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        account JSONB NOT NULL
      )
    `;
    await sql`DELETE FROM mentorship_accounts WHERE email = 'test@gmail.com'`;
    const result = await sql`SELECT account FROM mentorship_accounts`;
    const rows = Array.isArray(result) ? result : (result.rows || []);
    accounts = rows.map(row => typeof row.account === "string" ? JSON.parse(row.account) : row.account).filter(account => !hiddenDemoEmails.has(String(account.email || "").trim().toLowerCase()));
    return;
  }

  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    const content = await fs.readFile(accountsPath, "utf8");
    const storedData = JSON.parse(content);
    accounts = storedData;
    if (!Array.isArray(accounts)) throw new Error("Account store must be a JSON array.");
    accounts = accounts.filter(account => !hiddenDemoEmails.has(String(account.email || "").trim().toLowerCase()));
    await saveAccounts();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    accounts = [];
    await saveAccounts();
  }
}

async function loadChatRequests() {
  if (sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS mentorship_chat_requests (
        id TEXT PRIMARY KEY,
        mentor_id TEXT NOT NULL,
        requester_email TEXT NOT NULL,
        request JSONB NOT NULL
      )
    `;
    const result = await sql`SELECT request FROM mentorship_chat_requests`;
    const rows = Array.isArray(result) ? result : (result.rows || []);
    chatRequests = rows.map(row => typeof row.request === "string" ? JSON.parse(row.request) : row.request);
    return;
  }
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    const storedData = JSON.parse(await fs.readFile(requestsPath, "utf8"));
    chatRequests = Array.isArray(storedData) ? storedData : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    chatRequests = [];
  }
}

function saveAccounts() {
  writeQueue = writeQueue.then(async () => {
    if (sql) {
      const storedResult = await sql`SELECT id FROM mentorship_accounts`;
      const storedAccounts = Array.isArray(storedResult) ? storedResult : (storedResult.rows || []);
      const accountIds = new Set(accounts.map(account => account.id));
      for (const stored of storedAccounts) {
        if (!accountIds.has(stored.id)) {
          await sql`DELETE FROM mentorship_accounts WHERE id = ${stored.id}`;
        }
      }
      for (const account of accounts) {
        await sql`
          INSERT INTO mentorship_accounts (id, email, account)
          VALUES (${account.id}, ${account.email}, ${JSON.stringify(account)})
          ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            account = EXCLUDED.account
        `;
      }
      return;
    }
    const temporaryPath = `${accountsPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(accounts, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, accountsPath);
  });
  return writeQueue;
}

function saveChatRequests() {
  requestsWriteQueue = requestsWriteQueue.then(async () => {
    if (sql) {
      const storedResult = await sql`SELECT id FROM mentorship_chat_requests`;
      const rows = Array.isArray(storedResult) ? storedResult : (storedResult.rows || []);
      const requestIds = new Set(chatRequests.map(request => request.id));
      for (const stored of rows) {
        if (!requestIds.has(stored.id)) await sql`DELETE FROM mentorship_chat_requests WHERE id = ${stored.id}`;
      }
      for (const request of chatRequests) {
        await sql`
          INSERT INTO mentorship_chat_requests (id, mentor_id, requester_email, request)
          VALUES (${request.id}, ${request.mentorId}, ${request.requesterEmail}, ${JSON.stringify(request)})
          ON CONFLICT (id) DO UPDATE SET
            mentor_id = EXCLUDED.mentor_id,
            requester_email = EXCLUDED.requester_email,
            request = EXCLUDED.request
        `;
      }
      return;
    }
    const temporaryPath = `${requestsPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(chatRequests, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, requestsPath);
  });
  return requestsWriteQueue;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function allowRequest(request, response, scope, limit, windowMs) {
  const now = Date.now();
  const key = `${scope}:${request.socket.remoteAddress || "unknown"}`;
  let window = requestWindows.get(key);
  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + windowMs };
    requestWindows.set(key, window);
  }
  if (window.count >= limit) {
    sendJson(response, 429, { error: "Too many attempts. Please wait a little and try again." });
    return false;
  }
  window.count += 1;
  for (const [windowKey, value] of requestWindows) {
    if (value.resetAt <= now) requestWindows.delete(windowKey);
  }
  return true;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxRequestBytes) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 })); }
    });
    request.on("error", reject);
  });
}

function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    field: account.field,
    school: account.school,
    year: account.year,
    interests: account.interests,
    goal: account.goal,
    status: account.status
  };
}

async function passwordRecord(password, salt = crypto.randomBytes(16)) {
  const hash = await pbkdf2(password, salt, 210000, 32, "sha256");
  return { passwordSalt: salt.toString("hex"), passwordHash: hash.toString("hex") };
}

function safeEqualHex(leftHex, rightHex) {
  if (!/^[0-9a-f]+$/i.test(leftHex) || !/^[0-9a-f]+$/i.test(rightHex) || leftHex.length !== rightHex.length || leftHex.length % 2 !== 0) return false;
  return crypto.timingSafeEqual(Buffer.from(leftHex, "hex"), Buffer.from(rightHex, "hex"));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function sendVerificationEmail(email, name, token, origin) {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_FROM;
  if (!apiKey || !sender) throw new Error("Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM.");

  const verificationUrl = `${origin}/verify-email?token=${encodeURIComponent(token)}`;
  const safeName = escapeHtml(name);
  const result = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: sender,
      to: [email],
      subject: "Verify your MentorshipMatch email",
      text: `Hi ${name}, verify your MentorshipMatch email by opening this link: ${verificationUrl}\n\nThis link expires in one hour. If you didn't create this account, you can ignore this email.`,
      html: `<p>Hi ${safeName},</p><p>Verify your MentorshipMatch email by clicking below:</p><p><a href="${verificationUrl}">Verify my email address</a></p><p>This link expires in one hour. If you didn't create this account, you can ignore this email.</p>`
    })
  });
  if (!result.ok) {
    const detail = await result.text();
    throw new Error(`Email provider rejected the verification email (${result.status}): ${detail.slice(0, 300)}`);
  }

  async function sendVerificationEmailFixed(email, name, token, origin) {
    const apiKey = process.env.RESEND_API_KEY;
    const sender = process.env.RESEND_FROM;
    if (!apiKey || !sender) throw new Error("Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM.");
    const verificationUrl = `${origin}/verify-email?token=${encodeURIComponent(token)}`;
    const result = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: sender,
        to: [email],
        subject: "Verify your MentorshipMatch email",
        text: `Hi ${name}, verify your MentorshipMatch email by opening: ${verificationUrl}\n\nThis link expires in one hour.`
      })
    });
    if (!result.ok) {
      const detail = await result.text();
      throw new Error(`Email provider rejected the verification email (${result.status}): ${detail.slice(0, 300)}`);
    }
  }
}

function verificationUrlFor(token, origin) {
  return `${origin}/verify-email?token=${encodeURIComponent(token)}`;
}

function requestOrigin(request) {
  const forwardedHost = request.headers["x-forwarded-host"];
  const host = String(forwardedHost || request.headers.host || "").split(",")[0].trim();
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  const protocol = String(forwardedProtocol || (request.socket.encrypted ? "https" : "http")).split(",")[0];
  return host ? `${protocol}://${host}` : appOrigin;
}

async function deliverVerification(request, email, name, token) {
  const origin = requestOrigin(request);
  if (emailDeliveryMode === "demo") return { demoVerificationUrl: verificationUrlFor(token, origin) };
  if (emailDeliveryMode !== "resend") throw new Error("EMAIL_DELIVERY_MODE must be either demo or resend.");
  await sendVerificationEmailFixed(email, name, token, origin);
  return {};
}

async function handleRegister(request, response) {
  const body = await readJson(request);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = body.role === "Mentor" ? "Mentor" : "Student";
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 256) {
    sendJson(response, 400, { error: "Enter a name, valid email address, and password of at least 8 characters." });
    return;
  }
  if (accounts.some(account => account.email === email)) {
    sendJson(response, 409, { error: "An account with that email already exists. Please sign in instead." });
    return;
  }

  const credentials = await passwordRecord(password);
  const account = {
    id: crypto.randomUUID(),
    name,
    email,
    role,
    field: "",
    school: "",
    year: "",
    interests: "",
    goal: "",
    status: "Active",
    emailVerified: true,
    ...credentials
  };

  if (accounts.some(item => item.email === email)) {
    sendJson(response, 409, { error: "An account with that email already exists. Please sign in instead." });
    return;
  }
  accounts.push(account);
  await saveAccounts();
  sendJson(response, 201, { message: "Account created. You can sign in now." });
}

async function handleLogin(request, response) {
  const body = await readJson(request);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const account = accounts.find(item => item.email === email);
  if (!account || !account.passwordSalt || !account.passwordHash) {
    sendJson(response, 401, { error: "Incorrect email or password." });
    return;
  }
  const candidate = await passwordRecord(password, Buffer.from(account.passwordSalt, "hex"));
  if (!safeEqualHex(candidate.passwordHash, account.passwordHash)) {
    sendJson(response, 401, { error: "Incorrect email or password." });
    return;
  }
  if (account.status !== "Active") {
    sendJson(response, 403, { error: "This account is suspended. Contact an administrator for help." });
    return;
  }
  sendJson(response, 200, { user: publicAccount(account) });
}


async function serveStatic(url, response) {
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const pathParts = requestedPath.split(/[\\/]+/).filter(Boolean);
  if (pathParts.some(part => part.startsWith(".") || part.toLowerCase() === "data")) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const fullPath = path.resolve(staticRoot, `.${requestedPath}`);
  if (!fullPath.startsWith(`${staticRoot}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  let contents;
  try { contents = await fs.readFile(fullPath); }
  catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(fullPath)] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(contents);
}

async function handleRequest(request, response) {
  const url = new URL(request.url, appOrigin);
  if (request.method === "GET" && url.pathname === "/api/accounts") {
    response.setHeader?.("Access-Control-Allow-Origin", "*");
    const users = accounts
      .filter(account => account.role === "Mentor" && account.status !== "Suspended")
      .map(publicAccount)
      .filter(account => !hiddenDemoEmails.has(account.email));
    sendJson(response, 200, { users });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/chat-requests") {
    const body = await readJson(request);
    const mentorId = typeof body.mentorId === "string" ? body.mentorId.trim() : "";
    const requesterEmail = typeof body.requesterEmail === "string" ? body.requesterEmail.trim().toLowerCase() : "";
    const mentor = accounts.find(account => account.id === mentorId && account.role === "Mentor" && account.status === "Active");
    if (!mentor || !requesterEmail) {
      sendJson(response, 400, { error: "A valid mentor and requester are required." });
      return;
    }
    const chatRequest = {
      id: typeof body.id === "string" && body.id ? body.id : `booking-${Date.now()}`,
      mentorId,
      requesterEmail,
      topic: String(body.topic || "").trim().slice(0, 200),
      date: String(body.date || "").slice(0, 20),
      time: String(body.time || "").slice(0, 20),
      format: String(body.format || "").slice(0, 50),
      note: String(body.note || "").slice(0, 1000),
      status: "Pending",
      createdAt: new Date().toISOString()
    };
    chatRequests.push(chatRequest);
    await saveChatRequests();
    sendJson(response, 201, { request: chatRequest });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/chat-requests") {
    const mentorId = url.searchParams.get("mentorId") || "";
    const requests = chatRequests.filter(request => request.mentorId === mentorId).map(request => {
      const requester = accounts.find(account => account.email === request.requesterEmail);
      return { ...request, requesterName: requester?.name || request.requesterEmail, requesterSchool: requester?.school || "", requesterYear: requester?.year || "", requesterInterests: requester?.interests || "", requesterGoal: requester?.goal || "" };
    });
    sendJson(response, 200, { requests });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    if (!allowRequest(request, response, "register", 5, 60 * 60 * 1000)) return;
    return handleRegister(request, response);
  }
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    if (!allowRequest(request, response, "login", 10, 15 * 60 * 1000)) return;
    return handleLogin(request, response);
  }
  if (request.method === "GET") return serveStatic(url, response);
  sendJson(response, 404, { error: "Not found." });
}

let accountsReady = null;

function requestErrorHandler(request, response) {
    handleRequest(request, response).catch(error => {
      console.error("Request failed:", error);
      if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : "The request could not be completed." });
      else response.destroy(error);
    });
}

function ensureAccountsLoaded() {
  if (!accountsReady) accountsReady = Promise.all([loadAccounts(), loadChatRequests()]);
  return accountsReady;
}

if (require.main === module) {
  ensureAccountsLoaded().then(() => {
  http.createServer(requestErrorHandler).listen(port, "0.0.0.0", () => {
    console.log(`MentorshipMatch listening at ${appOrigin}`);
  });
}).catch(error => {
  console.error("Unable to load account store:", error);
  process.exitCode = 1;
});
}

module.exports = async function vercelHandler(request, response) {
  try {
    await ensureAccountsLoaded();
    await handleRequest(request, response).catch(error => {
      console.error("Request failed:", error);
      if (!response.headersSent) {
        sendJson(response, error.status || 500, {
          error: error.status ? error.message : "The request could not be completed."
        });
      } else {
        response.destroy(error);
      }
    });
  } catch (error) {
    console.error("Unable to initialize account storage:", error);
    if (!response.headersSent) {
      const detail = databaseUrl ? "Neon database initialization failed." : "Account store could not be loaded.";
      sendJson(response, 500, { error: `Account storage could not be initialized. ${detail}` });
    } else {
      response.destroy(error);
    }
  }
};