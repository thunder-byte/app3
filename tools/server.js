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
const vercelDataDirectory = process.env.VERCEL ? "/tmp/mentorshipmatch-data" : null;
const dataDirectory = path.resolve(process.env.MENTORSHIPMATCH_DATA_DIR || vercelDataDirectory || path.join(root, "data"));
const accountsPath = path.join(dataDirectory, "accounts.json");
const port = Number(process.env.PORT || 3000);
const defaultAppOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${port}`;
const appOrigin = (process.env.APP_ORIGIN || defaultAppOrigin).replace(/\/$/, "");
const emailDeliveryMode = process.env.EMAIL_DELIVERY_MODE || "demo";
const verificationLifetimeMs = 60 * 60 * 1000;
const maxRequestBytes = 16 * 1024;
let accounts = [];
let writeQueue = Promise.resolve();
const requestWindows = new Map();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

async function loadAccounts() {
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    const content = await fs.readFile(accountsPath, "utf8");
    accounts = JSON.parse(content);
    if (!Array.isArray(accounts)) throw new Error("Account store must be a JSON array.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    accounts = [];
    await saveAccounts();
  }
}

function saveAccounts() {
  writeQueue = writeQueue.then(async () => {
    const temporaryPath = `${accountsPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(accounts, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, accountsPath);
  });
  return writeQueue;
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

async function sendVerificationEmail(email, name, token) {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_FROM;
  if (!apiKey || !sender) throw new Error("Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM.");

  const verificationUrl = `${appOrigin}/verify-email?token=${encodeURIComponent(token)}`;
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
}

function verificationUrlFor(token) {
  return `${appOrigin}/verify-email?token=${encodeURIComponent(token)}`;
}

async function deliverVerification(email, name, token) {
  if (emailDeliveryMode === "demo") return { demoVerificationUrl: verificationUrlFor(token) };
  if (emailDeliveryMode !== "resend") throw new Error("EMAIL_DELIVERY_MODE must be either demo or resend.");
  await sendVerificationEmail(email, name, token);
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

  const token = crypto.randomBytes(32).toString("base64url");
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
    emailVerified: false,
    verificationTokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    verificationExpiresAt: Date.now() + verificationLifetimeMs,
    ...credentials
  };

  if (accounts.some(item => item.email === email)) {
    sendJson(response, 409, { error: "An account with that email already exists. Please sign in instead." });
    return;
  }
  accounts.push(account);
  await saveAccounts();
  try {
    const delivery = await deliverVerification(email, name, token);
    sendJson(response, 202, {
      message: delivery.demoVerificationUrl
        ? "Demo account created. Use the verification link below; no email was sent."
        : "Check your inbox for an email verification link.",
      ...delivery
    });
  } catch (error) {
    accounts = accounts.filter(item => item.id !== account.id);
    await saveAccounts();
    throw error;
  }
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
  if (!account.emailVerified) {
    sendJson(response, 403, { code: "EMAIL_NOT_VERIFIED", error: "Verify your email address before signing in." });
    return;
  }
  if (account.status !== "Active") {
    sendJson(response, 403, { error: "This account is suspended. Contact an administrator for help." });
    return;
  }
  sendJson(response, 200, { user: publicAccount(account) });
}

async function handleResendVerification(request, response) {
  const body = await readJson(request);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const account = accounts.find(item => item.email === email && !item.emailVerified);
  if (!account) {
    sendJson(response, 200, { message: "If an unverified account exists for that address, a new link will be sent." });
    return;
  }

  const previousTokenHash = account.verificationTokenHash;
  const previousExpiry = account.verificationExpiresAt;
  const token = crypto.randomBytes(32).toString("base64url");
  account.verificationTokenHash = crypto.createHash("sha256").update(token).digest("hex");
  account.verificationExpiresAt = Date.now() + verificationLifetimeMs;
  await saveAccounts();
  try {
    const delivery = await deliverVerification(email, account.name, token);
    sendJson(response, 200, {
      message: delivery.demoVerificationUrl
        ? "Demo verification link ready; no email was sent."
        : "A new verification link has been sent.",
      ...delivery
    });
  } catch (error) {
    account.verificationTokenHash = previousTokenHash;
    account.verificationExpiresAt = previousExpiry;
    await saveAccounts();
    throw error;
  }
}

async function handleVerification(url, response) {
  const token = url.searchParams.get("token") || "";
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const account = accounts.find(item => item.verificationTokenHash && safeEqualHex(item.verificationTokenHash, tokenHash));
  if (!account || account.verificationExpiresAt < Date.now()) {
    response.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Link expired</title><body style=\"font:16px sans-serif;max-width:520px;margin:12vh auto;padding:20px\"><h1>This verification link is invalid or expired.</h1><p>Return to MentorshipMatch, register again, and use the latest email.</p><a href=\"/\">Back to MentorshipMatch</a></body></html>");
    return;
  }
  account.emailVerified = true;
  account.emailVerifiedAt = new Date().toISOString();
  delete account.verificationTokenHash;
  delete account.verificationExpiresAt;
  await saveAccounts();
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Email verified</title><body style=\"font:16px sans-serif;max-width:520px;margin:12vh auto;padding:20px\"><h1>Your email is verified.</h1><p>You can now return to MentorshipMatch and sign in.</p><a href=\"/\">Go to sign in</a></body></html>");
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
  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    if (!allowRequest(request, response, "register", 5, 60 * 60 * 1000)) return;
    return handleRegister(request, response);
  }
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    if (!allowRequest(request, response, "login", 10, 15 * 60 * 1000)) return;
    return handleLogin(request, response);
  }
  if (request.method === "POST" && url.pathname === "/api/auth/resend-verification") {
    if (!allowRequest(request, response, "resend", 3, 60 * 60 * 1000)) return;
    return handleResendVerification(request, response);
  }
  if (request.method === "GET" && url.pathname === "/verify-email") return handleVerification(url, response);
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
  if (!accountsReady) accountsReady = loadAccounts();
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
  await ensureAccountsLoaded();
  return requestErrorHandler(request, response);
};