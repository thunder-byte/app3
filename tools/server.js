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
const messagesPath = path.join(dataDirectory, "messages.json");
const callsPath = path.join(dataDirectory, "calls.json");
const reviewsPath = path.join(dataDirectory, "reviews.json");
const pollResponsesPath = path.join(dataDirectory, "poll-responses.json");
const appReviewsPath = path.join(dataDirectory, "app-reviews.json");
const port = Number(process.env.PORT || 3000);
const appOrigin = (process.env.APP_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${port}`)).replace(/\/$/, "");
const maxRequestBytes = 256 * 1024;
const presenceOnlineWindowMs = 60 * 1000;
const maxMessageRequestBytes = 4.25 * 1024 * 1024;
const maxAttachmentBytes = 3 * 1024 * 1024;
const adminEmails = new Set(["keithwilliams0127@gmail.com"]);
const experiencePoll = {
  id: "mentorship-experience-v1",
  question: "How is your MentorshipMatch experience so far?",
  options: ["Great", "Good", "Okay", "Needs improvement"]
};
const allowedAttachmentTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/plain"
]);
let accounts = [];
let chatRequests = [];
let messages = [];
let calls = [];
let reviews = [];
let pollResponses = [];
let appReviews = [];
let writeQueue = Promise.resolve();
let requestsWriteQueue = Promise.resolve();
let messagesWriteQueue = Promise.resolve();
let callsWriteQueue = Promise.resolve();
let reviewsWriteQueue = Promise.resolve();
let pollResponsesWriteQueue = Promise.resolve();
let appReviewsWriteQueue = Promise.resolve();
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
    await refreshAccounts();
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

async function refreshAccounts() {
  if (!sql) return;
  const result = await sql`SELECT account FROM mentorship_accounts`;
  const rows = Array.isArray(result) ? result : (result.rows || []);
  accounts = rows
    .map(row => typeof row.account === "string" ? JSON.parse(row.account) : row.account)
    .filter(account => !hiddenDemoEmails.has(String(account.email || "").trim().toLowerCase()));
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

async function loadMessages() {
  if (sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS mentorship_messages (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        message JSONB NOT NULL
      )
    `;
    const result = await sql`SELECT message FROM mentorship_messages ORDER BY id`;
    const rows = Array.isArray(result) ? result : (result.rows || []);
    messages = rows.map(row => typeof row.message === "string" ? JSON.parse(row.message) : row.message);
    return;
  }
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    const storedData = JSON.parse(await fs.readFile(messagesPath, "utf8"));
    messages = Array.isArray(storedData) ? storedData : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    messages = [];
  }
}

async function loadCalls() {
  if (sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS mentorship_calls (
        request_id TEXT PRIMARY KEY,
        call JSONB NOT NULL
      )
    `;
    const result = await sql`SELECT call FROM mentorship_calls`;
    const rows = Array.isArray(result) ? result : (result.rows || []);
    calls = rows.map(row => typeof row.call === "string" ? JSON.parse(row.call) : row.call);
    return;
  }
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    const storedData = JSON.parse(await fs.readFile(callsPath, "utf8"));
    calls = Array.isArray(storedData) ? storedData : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    calls = [];
  }
}

function saveCall(call) {
  callsWriteQueue = callsWriteQueue.then(async () => {
    if (sql) {
      await sql`
        INSERT INTO mentorship_calls (request_id, call)
        VALUES (${call.requestId}, ${JSON.stringify(call)}::jsonb)
        ON CONFLICT (request_id) DO UPDATE SET call = EXCLUDED.call
      `;
      return;
    }
    const temporaryPath = `${callsPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(calls, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, callsPath);
  });
  return callsWriteQueue;
}

function saveCalls() {
  if (sql) return Promise.resolve();
  callsWriteQueue = callsWriteQueue.then(async () => {
    const temporaryPath = `${callsPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(calls, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, callsPath);
  });
  return callsWriteQueue;
}

async function findCall(requestId) {
  if (!sql) return calls.find(call => call.requestId === requestId);
  const result = await sql`
    SELECT call FROM mentorship_calls
    WHERE request_id = ${requestId}
    LIMIT 1
  `;
  const rows = Array.isArray(result) ? result : (result.rows || []);
  if (!rows.length) return undefined;
  const call = typeof rows[0].call === "string" ? JSON.parse(rows[0].call) : rows[0].call;
  const index = calls.findIndex(item => item.requestId === requestId);
  if (index >= 0) calls[index] = call;
  else calls.push(call);
  return call;
}

async function loadReviews() {
  if (sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS mentorship_reviews (
        id TEXT PRIMARY KEY,
        mentor_id TEXT NOT NULL,
        review JSONB NOT NULL
      )
    `;
    const result = await sql`SELECT review FROM mentorship_reviews`;
    const rows = Array.isArray(result) ? result : (result.rows || []);
    reviews = rows.map(row => typeof row.review === "string" ? JSON.parse(row.review) : row.review);
    return;
  }
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    const storedData = JSON.parse(await fs.readFile(reviewsPath, "utf8"));
    reviews = Array.isArray(storedData) ? storedData : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    reviews = [];
  }
}

async function loadPollResponses() {
  if (sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS mentorship_poll_responses (
        poll_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        choice TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (poll_id, account_id)
      )
    `;
    const result = await sql`SELECT poll_id, account_id, choice, created_at FROM mentorship_poll_responses`;
    const rows = Array.isArray(result) ? result : (result.rows || []);
    pollResponses = rows.map(row => ({
      pollId: row.poll_id,
      accountId: row.account_id,
      choice: row.choice,
      createdAt: row.created_at
    }));
    return;
  }
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    const storedData = JSON.parse(await fs.readFile(pollResponsesPath, "utf8"));
    pollResponses = Array.isArray(storedData) ? storedData : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    pollResponses = [];
  }
}

async function loadAppReviews() {
  if (sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS mentorship_app_reviews (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE,
        rating INTEGER NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    const result = await sql`SELECT id, account_id, rating, comment, created_at FROM mentorship_app_reviews`;
    const rows = Array.isArray(result) ? result : (result.rows || []);
    appReviews = rows.map(row => ({
      id: row.id,
      accountId: row.account_id,
      rating: Number(row.rating),
      comment: row.comment,
      createdAt: row.created_at
    }));
    return;
  }
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    const storedData = JSON.parse(await fs.readFile(appReviewsPath, "utf8"));
    appReviews = Array.isArray(storedData) ? storedData : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    appReviews = [];
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

function saveAccount(account) {
  if (!sql) return saveAccounts();
  writeQueue = writeQueue.then(async () => {
    await sql`
      UPDATE mentorship_accounts
      SET account = ${JSON.stringify(account)}
      WHERE id = ${account.id}
    `;
  });
  return writeQueue;
}

function saveChatRequests() {
  requestsWriteQueue = requestsWriteQueue.then(async () => {
    if (sql) {
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

async function findChatRequest(id) {
  if (!sql) return chatRequests.find(request => request.id === id);
  const result = await sql`SELECT request FROM mentorship_chat_requests WHERE id = ${id} LIMIT 1`;
  const rows = Array.isArray(result) ? result : (result.rows || []);
  if (!rows.length) return undefined;
  const request = typeof rows[0].request === "string" ? JSON.parse(rows[0].request) : rows[0].request;
  const index = chatRequests.findIndex(item => item.id === request.id);
  if (index >= 0) chatRequests[index] = request;
  else chatRequests.push(request);
  return request;
}

async function listChatRequestsForAccount(account) {
  let requests;
  if (sql) {
    const result = account.role === "Mentor"
      ? await sql`SELECT request FROM mentorship_chat_requests WHERE mentor_id = ${account.id}`
      : await sql`SELECT request FROM mentorship_chat_requests WHERE requester_email = ${account.email}`;
    const rows = Array.isArray(result) ? result : (result.rows || []);
    requests = rows.map(row => typeof row.request === "string" ? JSON.parse(row.request) : row.request);
  } else {
    requests = chatRequests.filter(request => account.role === "Mentor"
      ? request.mentorId === account.id
      : (request.requesterId || accounts.find(item => item.email === request.requesterEmail)?.id) === account.id);
  }
  for (const request of requests) {
    const index = chatRequests.findIndex(item => item.id === request.id);
    if (index >= 0) chatRequests[index] = request;
    else chatRequests.push(request);
  }
  return requests;
}

function saveMessages() {
  messagesWriteQueue = messagesWriteQueue.then(async () => {
    if (sql) {
      for (const message of messages) {
        await sql`
          INSERT INTO mentorship_messages (id, request_id, message)
          VALUES (${message.id}, ${message.requestId}, ${JSON.stringify(message)})
          ON CONFLICT (id) DO UPDATE SET
            request_id = EXCLUDED.request_id,
            message = EXCLUDED.message
        `;
      }
      return;
    }
    const temporaryPath = `${messagesPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(messages, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, messagesPath);
  });
  return messagesWriteQueue;
}

function saveReviews() {
  reviewsWriteQueue = reviewsWriteQueue.then(async () => {
    if (sql) {
      for (const review of reviews) {
        await sql`
          INSERT INTO mentorship_reviews (id, mentor_id, review)
          VALUES (${review.id}, ${review.mentorId}, ${JSON.stringify(review)})
          ON CONFLICT (id) DO UPDATE SET
            mentor_id = EXCLUDED.mentor_id,
            review = EXCLUDED.review
        `;
      }
      return;
    }
    const temporaryPath = `${reviewsPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(reviews, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, reviewsPath);
  });
  return reviewsWriteQueue;
}

function savePollResponses() {
  if (sql) return Promise.resolve();
  pollResponsesWriteQueue = pollResponsesWriteQueue.then(async () => {
    const temporaryPath = `${pollResponsesPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(pollResponses, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, pollResponsesPath);
  });
  return pollResponsesWriteQueue;
}

function saveAppReviews() {
  appReviewsWriteQueue = appReviewsWriteQueue.then(async () => {
    if (sql) return;
    const temporaryPath = `${appReviewsPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(appReviews, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, appReviewsPath);
  });
  return appReviewsWriteQueue;
}

async function permanentlyDeleteAccount(account) {
  const accountEmail = String(account.email || "").trim().toLowerCase();
  const accountRequests = chatRequests.filter(request =>
    request.mentorId === account.id ||
    request.requesterId === account.id ||
    String(request.requesterEmail || "").trim().toLowerCase() === accountEmail
  );
  const requestIds = new Set(accountRequests.map(request => request.id));
  const accountMessages = messages.filter(message =>
    requestIds.has(message.requestId) || message.senderId === account.id
  );
  const accountReviews = reviews.filter(review =>
    review.mentorId === account.id || review.reviewerId === account.id
  );

  accounts = accounts.filter(item => item.id !== account.id);
  chatRequests = chatRequests.filter(request => !accountRequests.includes(request));
  messages = messages.filter(message => !accountMessages.includes(message));
  reviews = reviews.filter(review => !accountReviews.includes(review));
  pollResponses = pollResponses.filter(response => response.accountId !== account.id);
  appReviews = appReviews.filter(review => review.accountId !== account.id);

  if (sql) {
    for (const request of accountRequests) {
      await sql`DELETE FROM mentorship_chat_requests WHERE id = ${request.id}`;
    }
    for (const message of accountMessages) {
      await sql`DELETE FROM mentorship_messages WHERE id = ${message.id}`;
    }
    for (const review of accountReviews) {
      await sql`DELETE FROM mentorship_reviews WHERE id = ${review.id}`;
    }
    await sql`DELETE FROM mentorship_poll_responses WHERE account_id = ${account.id}`;
    await sql`DELETE FROM mentorship_app_reviews WHERE account_id = ${account.id}`;
  }

  await Promise.all([saveAccounts(), saveChatRequests(), saveMessages(), saveReviews(), savePollResponses(), saveAppReviews()]);
}

async function expirePendingDeletions() {
  const now = Date.now();
  const expiredAccounts = accounts.filter(account =>
    account.status === "PendingDeletion" &&
    Date.parse(account.deletionExpiresAt) <= now
  );
  for (const account of expiredAccounts) {
    await permanentlyDeleteAccount(account);
  }
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

function readJson(request, maxBytes = maxRequestBytes) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
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
  const lastSeenAt = Date.parse(account.lastSeenAt || "");
  return {
    id: account.id,
    name: account.name,
    role: account.role,
    field: account.field,
    school: account.school,
    year: account.year,
    interests: account.interests,
    goal: account.goal,
    status: account.status,
    isOnline: Number.isFinite(lastSeenAt) && Date.now() - lastSeenAt < presenceOnlineWindowMs,
    createdAt: account.createdAt || "",
    profileImage: account.profileImage || ""
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

async function authenticatedAccount(request) {
  const authorization = String(request.headers.authorization || "");
  const tokenMatch = authorization.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  if (!tokenMatch) return null;
  const tokenHash = crypto.createHash("sha256").update(tokenMatch[1]).digest("hex");
  let account;
  if (sql) {
    const result = await sql`
      SELECT account FROM mentorship_accounts
      WHERE account->>'sessionTokenHash' = ${tokenHash}
      LIMIT 1
    `;
    const rows = Array.isArray(result) ? result : (result.rows || []);
    if (rows.length) account = typeof rows[0].account === "string" ? JSON.parse(rows[0].account) : rows[0].account;
  } else {
    account = accounts.find(item => safeEqualHex(String(item.sessionTokenHash || ""), tokenHash));
  }
  if (!account || account.status !== "Active" || Number(account.sessionExpiresAt) <= Date.now()) return null;
  const index = accounts.findIndex(item => item.id === account.id);
  if (index >= 0) accounts[index] = account;
  else accounts.push(account);
  return account;
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
  const existingAccount = accounts.find(account => account.email === email);
  if (existingAccount) {
    const error = existingAccount.status === "PendingDeletion"
      ? "This account is scheduled for deletion. Sign in within 24 hours to restore it."
      : "An account with that email already exists. Please sign in instead.";
    sendJson(response, 409, { error });
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
    createdAt: new Date().toISOString(),
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
  const restored = account.status === "PendingDeletion" &&
    Date.parse(account.deletionExpiresAt) > Date.now();
  if (restored) {
    account.status = "Active";
    delete account.deletionRequestedAt;
    delete account.deletionExpiresAt;
  }
  if (account.status !== "Active") {
    sendJson(response, 403, { error: "This account is suspended. Contact an administrator for help." });
    return;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  account.sessionTokenHash = crypto.createHash("sha256").update(token).digest("hex");
  account.sessionExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  account.lastSeenAt = new Date().toISOString();
  await saveAccounts();
  sendJson(response, 200, {
    user: {
      ...publicAccount(account),
      email: account.email,
      isAdmin: adminEmails.has(String(account.email || "").trim().toLowerCase())
    },
    token,
    restored
  });
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
  await expirePendingDeletions();
  const url = new URL(request.url, appOrigin);
  if (request.method === "POST" && url.pathname === "/api/presence") {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to update your presence." });
      return;
    }
    const body = await readJson(request);
    authenticated.lastSeenAt = body.online === false ? null : new Date().toISOString();
    await saveAccount(authenticated);
    sendJson(response, 200, { isOnline: Boolean(authenticated.lastSeenAt) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/accounts") {
    if (!await authenticatedAccount(request)) {
      sendJson(response, 401, { error: "Please sign in to browse community profiles." });
      return;
    }
    let communityAccounts = accounts;
    if (sql) {
      const result = await sql`SELECT account FROM mentorship_accounts`;
      const rows = Array.isArray(result) ? result : (result.rows || []);
      communityAccounts = rows.map(row => typeof row.account === "string" ? JSON.parse(row.account) : row.account);
    }
    const users = communityAccounts
      .filter(account => account.status === "Active" && !hiddenDemoEmails.has(String(account.email || "").trim().toLowerCase()))
      .map(publicAccount)
    sendJson(response, 200, { users });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/poll") {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in to view the poll." });
      return;
    }
    let hasResponded;
    if (sql) {
      const result = await sql`
        SELECT account_id FROM mentorship_poll_responses
        WHERE poll_id = ${experiencePoll.id} AND account_id = ${authenticated.id}
        LIMIT 1
      `;
      const rows = Array.isArray(result) ? result : (result.rows || []);
      hasResponded = rows.length > 0;
    } else {
      hasResponded = pollResponses.some(response =>
        response.pollId === experiencePoll.id && response.accountId === authenticated.id
      );
    }
    sendJson(response, 200, { poll: experiencePoll, hasResponded });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/poll") {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in to submit a poll response." });
      return;
    }
    const body = await readJson(request);
    const choice = body && typeof body === "object" && !Array.isArray(body) && typeof body.choice === "string"
      ? body.choice
      : "";
    if (!experiencePoll.options.includes(choice)) {
      sendJson(response, 400, { error: "Choose one of the poll options." });
      return;
    }
    if (sql) {
      const result = await sql`
        INSERT INTO mentorship_poll_responses (poll_id, account_id, choice)
        VALUES (${experiencePoll.id}, ${authenticated.id}, ${choice})
        ON CONFLICT (poll_id, account_id) DO NOTHING
        RETURNING account_id
      `;
      const rows = Array.isArray(result) ? result : (result.rows || []);
      if (!rows.length) {
        sendJson(response, 409, { error: "You have already responded to this poll." });
        return;
      }
      pollResponses.push({
        pollId: experiencePoll.id,
        accountId: authenticated.id,
        choice,
        createdAt: new Date().toISOString()
      });
    } else {
      const existing = pollResponses.some(response =>
        response.pollId === experiencePoll.id && response.accountId === authenticated.id
      );
      if (existing) {
        sendJson(response, 409, { error: "You have already responded to this poll." });
        return;
      }
      pollResponses.push({
        pollId: experiencePoll.id,
        accountId: authenticated.id,
        choice,
        createdAt: new Date().toISOString()
      });
      await savePollResponses();
    }
    sendJson(response, 201, { message: "Thanks for sharing your response." });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/app-reviews") {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in to review the app." });
      return;
    }
    const body = await readJson(request);
    const rating = body && typeof body === "object" && !Array.isArray(body) ? Number(body.rating) : 0;
    const comment = body && typeof body === "object" && !Array.isArray(body) && typeof body.comment === "string"
      ? body.comment.trim()
      : "";
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 1000) {
      sendJson(response, 400, { error: "Choose a 1–5 star rating and keep feedback under 1,000 characters." });
      return;
    }
    const createdAt = new Date().toISOString();
    let review;
    if (sql) {
      const id = crypto.randomUUID();
      const result = await sql`
        INSERT INTO mentorship_app_reviews (id, account_id, rating, comment, created_at)
        VALUES (${id}, ${authenticated.id}, ${rating}, ${comment}, ${createdAt})
        ON CONFLICT (account_id) DO UPDATE
        SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = EXCLUDED.created_at
        RETURNING id, account_id, rating, comment, created_at
      `;
      const rows = Array.isArray(result) ? result : (result.rows || []);
      const row = rows[0];
      review = {
        id: row.id,
        accountId: row.account_id,
        rating: Number(row.rating),
        comment: row.comment,
        createdAt: row.created_at
      };
      const existingIndex = appReviews.findIndex(item => item.accountId === authenticated.id);
      if (existingIndex >= 0) appReviews[existingIndex] = review;
      else appReviews.push(review);
    } else {
      const existing = appReviews.find(item => item.accountId === authenticated.id);
      review = {
        id: existing?.id || crypto.randomUUID(),
        accountId: authenticated.id,
        rating,
        comment,
        createdAt
      };
      if (existing) Object.assign(existing, review);
      else appReviews.push(review);
      await saveAppReviews();
    }
    sendJson(response, 201, { message: "Thanks for reviewing the app." });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/admin/app-reviews") {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in to view app feedback." });
      return;
    }
    if (!adminEmails.has(String(authenticated.email || "").trim().toLowerCase())) {
      sendJson(response, 403, { error: "Administrator access is required." });
      return;
    }
    if (sql) {
      await refreshAccounts();
      const result = await sql`SELECT id, account_id, rating, comment, created_at FROM mentorship_app_reviews ORDER BY created_at DESC`;
      const rows = Array.isArray(result) ? result : (result.rows || []);
      appReviews = rows.map(row => ({
        id: row.id,
        accountId: row.account_id,
        rating: Number(row.rating),
        comment: row.comment,
        createdAt: row.created_at
      }));
    }
    const adminReviews = appReviews.map(review => {
      const reviewer = accounts.find(account => account.id === review.accountId);
      return {
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
        reviewerName: reviewer?.name || "Member",
        reviewerEmail: reviewer?.email || ""
      };
    });
    sendJson(response, 200, { reviews: adminReviews });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/admin/accounts") {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in to view the admin area." });
      return;
    }
    if (!adminEmails.has(String(authenticated.email || "").trim().toLowerCase())) {
      sendJson(response, 403, { error: "Administrator access is required." });
      return;
    }
    if (sql) await refreshAccounts();
    const adminAccounts = accounts.map(account => ({
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
      status: account.status,
      createdAt: account.createdAt || "",
      deletionExpiresAt: account.deletionExpiresAt || "",
      isAdmin: adminEmails.has(String(account.email || "").trim().toLowerCase())
    }));
    sendJson(response, 200, { accounts: adminAccounts });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/admin/polls") {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in to view poll results." });
      return;
    }
    if (!adminEmails.has(String(authenticated.email || "").trim().toLowerCase())) {
      sendJson(response, 403, { error: "Administrator access is required." });
      return;
    }
    const counts = new Map(experiencePoll.options.map(choice => [choice, 0]));
    if (sql) {
      const result = await sql`
        SELECT choice, COUNT(*) AS votes
        FROM mentorship_poll_responses
        WHERE poll_id = ${experiencePoll.id}
        GROUP BY choice
      `;
      const rows = Array.isArray(result) ? result : (result.rows || []);
      for (const row of rows) {
        if (counts.has(row.choice)) counts.set(row.choice, Number(row.votes));
      }
    } else {
      for (const response of pollResponses) {
        if (response.pollId === experiencePoll.id && counts.has(response.choice)) {
          counts.set(response.choice, counts.get(response.choice) + 1);
        }
      }
    }
    const results = [...counts].map(([choice, votes]) => ({ choice, votes }));
    sendJson(response, 200, {
      poll: experiencePoll,
      totalVotes: results.reduce((total, result) => total + result.votes, 0),
      results
    });
    return;
  }
  const adminAccountMatch = url.pathname.match(/^\/api\/admin\/accounts\/([a-f0-9-]{36})$/i);
  if (request.method === "POST" && adminAccountMatch) {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in to manage accounts." });
      return;
    }
    if (!adminEmails.has(String(authenticated.email || "").trim().toLowerCase())) {
      sendJson(response, 403, { error: "Administrator access is required." });
      return;
    }
    const target = accounts.find(account => account.id === adminAccountMatch[1]);
    if (!target) {
      sendJson(response, 404, { error: "That account could not be found." });
      return;
    }
    if (target.id === authenticated.id || adminEmails.has(String(target.email || "").trim().toLowerCase())) {
      sendJson(response, 403, { error: "Administrators cannot manage their own account or another administrator." });
      return;
    }
    const body = await readJson(request);
    const action = body && typeof body === "object" && !Array.isArray(body) ? body.action : "";
    if (!["suspend", "restore", "delete"].includes(action)) {
      sendJson(response, 400, { error: "Choose a valid account action." });
      return;
    }
    if (action === "suspend") {
      if (target.status !== "Active") {
        sendJson(response, 400, { error: "Only active accounts can be suspended." });
        return;
      }
      target.status = "Suspended";
      delete target.sessionTokenHash;
      delete target.sessionExpiresAt;
    } else if (action === "restore") {
      if (target.status !== "Suspended" && target.status !== "PendingDeletion") {
        sendJson(response, 400, { error: "Only suspended or pending-deletion accounts can be restored." });
        return;
      }
      target.status = "Active";
      delete target.deletionRequestedAt;
      delete target.deletionExpiresAt;
    } else {
      if (target.status === "PendingDeletion") {
        sendJson(response, 400, { error: "This account is already scheduled for deletion." });
        return;
      }
      const deletionRequestedAt = Date.now();
      target.status = "PendingDeletion";
      target.deletionRequestedAt = new Date(deletionRequestedAt).toISOString();
      target.deletionExpiresAt = new Date(deletionRequestedAt + 24 * 60 * 60 * 1000).toISOString();
      delete target.sessionTokenHash;
      delete target.sessionExpiresAt;
    }
    await saveAccounts();
    sendJson(response, 200, {
      account: {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        status: target.status,
        createdAt: target.createdAt || "",
        deletionExpiresAt: target.deletionExpiresAt || "",
        isAdmin: false
      }
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/account/profile") {
    const body = await readJson(request);
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to update your profile." });
      return;
    }
    const account = accounts.find(item => item.id === body.id && item.id === authenticated.id);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!account || !name || name.length > 100) {
      sendJson(response, 400, { error: "A valid account and name are required." });
      return;
    }
    account.name = name;
    account.role = body.role === "Mentor" ? "Mentor" : "Student";
    account.school = typeof body.school === "string" ? body.school.trim().slice(0, 150) : "";
    account.year = typeof body.year === "string" ? body.year.slice(0, 50) : "";
    account.interests = typeof body.interests === "string" ? body.interests.trim().slice(0, 500) : "";
    account.goal = typeof body.goal === "string" ? body.goal.trim().slice(0, 1000) : "";
    account.field = account.interests.split(",")[0].trim();
    const profileImage = typeof body.profileImage === "string" ? body.profileImage : "";
    if (profileImage && (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(profileImage) || profileImage.length > 200 * 1024)) {
      sendJson(response, 400, { error: "Choose a JPG, PNG, or WebP profile picture smaller than 150 KB." });
      return;
    }
    account.profileImage = profileImage;
    await saveAccounts();
    sendJson(response, 200, { user: publicAccount(account) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/account/password") {
    if (!allowRequest(request, response, "password-change", 5, 15 * 60 * 1000)) return;
    const body = await readJson(request);
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to change your password." });
      return;
    }
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword || currentPassword.length > 256 || newPassword.length < 8 || newPassword.length > 256) {
      sendJson(response, 400, { error: "Enter your current password and a new password with at least 8 characters." });
      return;
    }
    const currentRecord = await passwordRecord(currentPassword, Buffer.from(authenticated.passwordSalt, "hex"));
    if (!safeEqualHex(currentRecord.passwordHash, authenticated.passwordHash)) {
      sendJson(response, 403, { error: "Your current password is incorrect." });
      return;
    }
    if (currentPassword === newPassword) {
      sendJson(response, 400, { error: "Choose a new password different from your current one." });
      return;
    }
    const newRecord = await passwordRecord(newPassword);
    authenticated.passwordSalt = newRecord.passwordSalt;
    authenticated.passwordHash = newRecord.passwordHash;
    await saveAccounts();
    sendJson(response, 200, { message: "Your password has been changed." });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/account/delete") {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to delete your account." });
      return;
    }
    const deletionRequestedAt = Date.now();
    authenticated.status = "PendingDeletion";
    authenticated.deletionRequestedAt = new Date(deletionRequestedAt).toISOString();
    authenticated.deletionExpiresAt = new Date(deletionRequestedAt + 24 * 60 * 60 * 1000).toISOString();
    delete authenticated.sessionTokenHash;
    delete authenticated.sessionExpiresAt;
    await saveAccounts();
    sendJson(response, 200, { deletionExpiresAt: authenticated.deletionExpiresAt });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/chat-requests") {
    const body = await readJson(request);
    const mentorId = typeof body.mentorId === "string" ? body.mentorId.trim() : "";
    const requesterEmail = typeof body.requesterEmail === "string" ? body.requesterEmail.trim().toLowerCase() : "";
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to start a connection." });
      return;
    }
    const mentor = accounts.find(account => account.id === mentorId && account.role === "Mentor" && account.status === "Active");
    const requester = authenticated;
    if (!mentor || requester.id !== body.requesterId || requester.email !== requesterEmail) {
      sendJson(response, 400, { error: "A valid mentor and requester are required." });
      return;
    }
    if (requester.role !== "Student") {
      sendJson(response, 403, { error: "Only students can request chats with mentors." });
      return;
    }
    const chatRequest = {
      id: typeof body.id === "string" && body.id ? body.id : `booking-${Date.now()}`,
      mentorId,
      requesterId: requester.id,
      requesterEmail: requester.email,
      topic: String(body.topic || "").trim().slice(0, 200),
      date: String(body.date || "").slice(0, 20),
      time: String(body.time || "").slice(0, 20),
      format: String(body.format || "").slice(0, 50),
      note: String(body.note || "").slice(0, 1000),
      status: "Pending",
      completedBy: [],
      createdAt: new Date().toISOString()
    };
    if (sql) {
      await sql`
        INSERT INTO mentorship_chat_requests (id, mentor_id, requester_email, request)
        VALUES (${chatRequest.id}, ${chatRequest.mentorId}, ${chatRequest.requesterEmail}, ${JSON.stringify(chatRequest)})
        ON CONFLICT (id) DO UPDATE SET request = EXCLUDED.request
      `;
    }
    const existingIndex = chatRequests.findIndex(item => item.id === chatRequest.id);
    if (existingIndex >= 0) chatRequests[existingIndex] = chatRequest;
    else chatRequests.push(chatRequest);
    if (!sql) await saveChatRequests();
    sendJson(response, 201, { request: chatRequest });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/chat-requests") {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to view your connections." });
      return;
    }
    const requestedUserId = url.searchParams.get("userId");
    if (requestedUserId && requestedUserId !== authenticated.id) {
      sendJson(response, 403, { error: "You can only view your own connections." });
      return;
    }
    const accountRequests = await listChatRequestsForAccount(authenticated);
    const requests = accountRequests.map(request => {
      const requester = accounts.find(account => account.email === request.requesterEmail);
      const mentor = accounts.find(account => account.id === request.mentorId);
      return {
        ...request,
        requesterId: request.requesterId || requester?.id || "",
        requesterName: requester?.name || request.requesterEmail,
        requesterSchool: requester?.school || "",
        requesterYear: requester?.year || "",
        requesterInterests: requester?.interests || "",
        requesterGoal: requester?.goal || "",
        mentorName: mentor?.name || "Mentor"
      };
    });
    sendJson(response, 200, { requests });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/notifications") {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to view notifications." });
      return;
    }
    const connections = (await listChatRequestsForAccount(authenticated))
      .filter(connection => connection.status !== "Cancelled");
    const notifications = [];
    for (const connection of connections) {
      let incomingMessages;
      if (sql) {
        const result = await sql`
          SELECT message FROM mentorship_messages
          WHERE request_id = ${connection.id}
            AND message->>'senderId' <> ${authenticated.id}
          ORDER BY message->>'createdAt' DESC
          LIMIT 5
        `;
        const rows = Array.isArray(result) ? result : (result.rows || []);
        incomingMessages = rows.map(row => typeof row.message === "string" ? JSON.parse(row.message) : row.message);
      } else {
        incomingMessages = messages
          .filter(message => message.requestId === connection.id && message.senderId !== authenticated.id)
          .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
          .slice(0, 5);
      }
      for (const message of incomingMessages) {
        notifications.push({
          id: message.id,
          requestId: connection.id,
          senderId: message.senderId,
          senderName: message.senderName,
          text: message.text || (message.attachment ? "Shared a file" : ""),
          createdAt: message.createdAt
        });
      }
    }
    notifications.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    sendJson(response, 200, { messages: notifications.slice(0, 30) });
    return;
  }
  if (request.method === "DELETE" && url.pathname === "/api/chat-requests") {
    const body = await readJson(request);
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to delete this session." });
      return;
    }
    const connection = await findChatRequest(body.id);
    const requesterId = connection?.requesterId || accounts.find(account => account.email === connection?.requesterEmail)?.id;
    if (!connection || (authenticated.id !== connection.mentorId && authenticated.id !== requesterId)) {
      sendJson(response, 404, { error: "This session could not be found." });
      return;
    }
    messages = messages.filter(message => message.requestId !== connection.id);
    calls = calls.filter(call => call.requestId !== connection.id);
    chatRequests = chatRequests.filter(requestItem => requestItem.id !== connection.id);
    if (sql) {
      await sql`DELETE FROM mentorship_messages WHERE request_id = ${connection.id}`;
      await sql`DELETE FROM mentorship_calls WHERE request_id = ${connection.id}`;
      await sql`DELETE FROM mentorship_chat_requests WHERE id = ${connection.id}`;
    } else {
      await Promise.all([saveMessages(), saveCalls(), saveChatRequests()]);
    }
    sendJson(response, 200, { id: connection.id });
    return;
  }
  if (request.method === "PATCH" && url.pathname === "/api/chat-requests") {
    const body = await readJson(request);
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to update this connection." });
      return;
    }
    const connection = await findChatRequest(body.id);
    const userId = authenticated.id;
    const requesterId = connection?.requesterId || accounts.find(account => account.email === connection?.requesterEmail)?.id;
    if (!connection || connection.status === "Cancelled" || (userId !== connection.mentorId && userId !== requesterId)) {
      sendJson(response, 403, { error: "Only members in this connection can update it." });
      return;
    }
    if (body.action === "complete") {
      const participantIds = [...new Set([connection.mentorId, requesterId].filter(Boolean))];
      const previousCompletedBy = Array.isArray(connection.completedBy)
        ? connection.completedBy
        : connection.status === "Completed" ? participantIds : [];
      const completedBy = [...new Set(previousCompletedBy.filter(id => participantIds.includes(id)))];
      if (!completedBy.includes(userId)) completedBy.push(userId);
      connection.requesterId = requesterId || connection.requesterId;
      connection.completedBy = completedBy;
      const bothParticipantsCompleted = participantIds.length === 2 &&
        participantIds.every(id => completedBy.includes(id));
      connection.status = bothParticipantsCompleted
        ? "Completed"
        : connection.status === "Completed" ? "Pending" : connection.status;
    } else {
      connection.status = "Cancelled";
    }
    if (sql) {
      await sql`UPDATE mentorship_chat_requests SET request = ${JSON.stringify(connection)}::jsonb WHERE id = ${connection.id}`;
    } else {
      await saveChatRequests();
    }
    sendJson(response, 200, { request: connection });
    return;
  }
  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/calls") {
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to use calls." });
      return;
    }

    if (request.method === "GET") {
      let accountCalls;
      if (sql) {
        const result = await sql`
          SELECT call FROM mentorship_calls
          WHERE call->>'callerId' = ${authenticated.id}
             OR call->>'recipientId' = ${authenticated.id}
        `;
        const rows = Array.isArray(result) ? result : (result.rows || []);
        accountCalls = rows.map(row => typeof row.call === "string" ? JSON.parse(row.call) : row.call);
        for (const call of accountCalls) {
          const index = calls.findIndex(item => item.requestId === call.requestId);
          if (index >= 0) calls[index] = call;
          else calls.push(call);
        }
      } else {
        accountCalls = calls.filter(call => call.callerId === authenticated.id || call.recipientId === authenticated.id);
      }
      const now = Date.now();
      const activeCalls = [];
      let callStoreChanged = false;
      for (const call of accountCalls) {
        const age = now - Date.parse(call.updatedAt);
        if (call.status === "ringing" && age > 90 * 1000) {
          call.status = "ended";
          delete call.offer;
          delete call.answer;
          call.updatedAt = new Date(now).toISOString();
          callStoreChanged = true;
          await saveCall(call);
        } else if (call.status === "active" && age > 4 * 60 * 60 * 1000) {
          call.status = "ended";
          delete call.offer;
          delete call.answer;
          call.updatedAt = new Date(now).toISOString();
          callStoreChanged = true;
          await saveCall(call);
        }
        if (call.status === "ended" && age > 5 * 60 * 1000) {
          calls = calls.filter(item => item.requestId !== call.requestId);
          if (sql) await sql`DELETE FROM mentorship_calls WHERE request_id = ${call.requestId}`;
          callStoreChanged = true;
          continue;
        }
        activeCalls.push(call);
      }
      if (!sql && callStoreChanged) await saveCalls();
      sendJson(response, 200, { calls: activeCalls });
      return;
    }

    const body = await readJson(request);
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "start" && !allowRequest(request, response, "call-start", 10, 10 * 60 * 1000)) return;
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const connection = await findChatRequest(requestId);
    const requesterId = connection?.requesterId || accounts.find(account => account.email === connection?.requesterEmail)?.id;
    if (!connection || connection.status === "Cancelled" ||
      (authenticated.id !== connection.mentorId && authenticated.id !== requesterId)) {
      sendJson(response, 403, { error: "Calls are available only to members in this connection." });
      return;
    }

    const now = new Date().toISOString();
    if (action === "start") {
      if (!["audio", "video"].includes(body.mode) ||
        !body.offer || body.offer.type !== "offer" ||
        typeof body.offer.sdp !== "string" || body.offer.sdp.length > 200000) {
        sendJson(response, 400, { error: "A valid audio or video call offer is required." });
        return;
      }
      const currentCall = await findCall(requestId);
      if (currentCall && ["ringing", "active"].includes(currentCall.status)) {
        sendJson(response, 409, { error: "There is already a call in progress for this connection." });
        return;
      }
      const call = {
        id: crypto.randomUUID(),
        requestId,
        callerId: authenticated.id,
        callerName: authenticated.name,
        recipientId: authenticated.id === connection.mentorId ? requesterId : connection.mentorId,
        recipientName: accounts.find(account => account.id === (authenticated.id === connection.mentorId ? requesterId : connection.mentorId))?.name || "Your connection",
        mode: body.mode,
        status: "ringing",
        offer: { type: "offer", sdp: body.offer.sdp },
        answer: null,
        createdAt: now,
        updatedAt: now
      };
      const index = calls.findIndex(item => item.requestId === requestId);
      if (index >= 0) calls[index] = call;
      else calls.push(call);
      await saveCall(call);
      sendJson(response, 201, { call });
      return;
    }

    const call = await findCall(requestId);
    if (!call || call.id !== body.callId || !["ringing", "active"].includes(call.status)) {
      sendJson(response, 404, { error: "This call is no longer available." });
      return;
    }
    if (action === "answer") {
      if (call.recipientId !== authenticated.id || call.status !== "ringing" ||
        !body.answer || body.answer.type !== "answer" ||
        typeof body.answer.sdp !== "string" || body.answer.sdp.length > 200000) {
        sendJson(response, 403, { error: "Only the invited participant can answer this call." });
        return;
      }
      call.answer = { type: "answer", sdp: body.answer.sdp };
      call.status = "active";
      call.updatedAt = now;
      await saveCall(call);
      sendJson(response, 200, { call });
      return;
    }
    if (action === "connected") {
      if (call.callerId !== authenticated.id || call.status !== "active") {
        sendJson(response, 403, { error: "Only the caller can confirm this connection." });
        return;
      }
      delete call.offer;
      delete call.answer;
      call.updatedAt = now;
      await saveCall(call);
      sendJson(response, 200, { call });
      return;
    }
    if (action === "end") {
      if (authenticated.id !== call.callerId && authenticated.id !== call.recipientId) {
        sendJson(response, 403, { error: "Only a participant can end this call." });
        return;
      }
      call.status = "ended";
      call.endedBy = authenticated.id;
      delete call.offer;
      delete call.answer;
      call.updatedAt = now;
      await saveCall(call);
      sendJson(response, 200, { call });
      return;
    }
    sendJson(response, 400, { error: "Choose a valid call action." });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/messages") {
    const requestId = url.searchParams.get("requestId") || "";
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to view messages." });
      return;
    }
    const userId = authenticated.id;
    const connection = await findChatRequest(requestId);
    const requesterId = connection?.requesterId || accounts.find(account => account.email === connection?.requesterEmail)?.id;
    if (!connection || (userId !== connection.mentorId && userId !== requesterId)) {
      sendJson(response, 403, { error: "Messages are available only to members in this connection." });
      return;
    }
    let conversation;
    if (sql) {
      const result = await sql`
        SELECT message FROM mentorship_messages
        WHERE request_id = ${requestId}
        ORDER BY message->>'createdAt', id
      `;
      const rows = Array.isArray(result) ? result : (result.rows || []);
      conversation = rows.map(row => typeof row.message === "string" ? JSON.parse(row.message) : row.message);
    } else {
      conversation = messages.filter(message => message.requestId === requestId);
    }
    let updatedMessages = false;
    for (const message of conversation) {
      if (message.senderId === userId) continue;
      const readBy = Array.isArray(message.readBy)
        ? message.readBy.filter(readerId => typeof readerId === "string")
        : [];
      if (!readBy.includes(userId)) {
        message.readBy = [...readBy, userId];
        updatedMessages = true;
        if (sql) {
          await sql`
            UPDATE mentorship_messages
            SET message = ${JSON.stringify(message)}::jsonb
            WHERE id = ${message.id} AND request_id = ${requestId}
          `;
        }
      }
      const cachedMessage = messages.find(cached => cached.id === message.id);
      if (cachedMessage) cachedMessage.readBy = message.readBy || readBy;
    }
    if (!sql && updatedMessages) await saveMessages();
    conversation = conversation
      .map(({ senderEmail, ...message }) => message)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    sendJson(response, 200, { messages: conversation });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/messages") {
    const body = await readJson(request, maxMessageRequestBytes);
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to send messages." });
      return;
    }
    const senderId = authenticated.id;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const connection = await findChatRequest(requestId);
    const requesterId = connection?.requesterId || accounts.find(account => account.email === connection?.requesterEmail)?.id;
    const sender = authenticated.id === senderId ? authenticated : null;
    let attachment;
    if (body.attachment !== undefined) {
      const suppliedAttachment = body.attachment;
      if (!suppliedAttachment || typeof suppliedAttachment !== "object" || Array.isArray(suppliedAttachment) ||
        typeof suppliedAttachment.name !== "string" || typeof suppliedAttachment.type !== "string" ||
        typeof suppliedAttachment.data !== "string" || !allowedAttachmentTypes.has(suppliedAttachment.type) ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(suppliedAttachment.data)) {
        sendJson(response, 400, { error: "Choose a supported file to share." });
        return;
      }
      const fileData = Buffer.from(suppliedAttachment.data, "base64");
      const fileName = suppliedAttachment.name.trim().replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 255);
      if (!fileName || fileData.length === 0 || fileData.length > maxAttachmentBytes ||
        fileData.toString("base64") !== suppliedAttachment.data) {
        sendJson(response, 400, { error: "Files must be up to 3 MB and have a valid file name." });
        return;
      }
      attachment = {
        name: fileName,
        type: suppliedAttachment.type,
        size: fileData.length,
        data: suppliedAttachment.data
      };
    }
    if (!connection || connection.status === "Cancelled" || !sender || (senderId !== connection.mentorId && senderId !== requesterId) || (!text && !attachment) || text.length > 2000) {
      sendJson(response, 400, { error: "A valid connection and message are required." });
      return;
    }
    const message = {
      id: crypto.randomUUID(),
      requestId,
      senderId,
      senderName: sender.name,
      text,
      ...(attachment ? { attachment } : {}),
      createdAt: new Date().toISOString()
    };
    if (sql) {
      await sql`
        INSERT INTO mentorship_messages (id, request_id, message)
        VALUES (${message.id}, ${message.requestId}, ${JSON.stringify(message)})
      `;
    }
    messages.push(message);
    if (!sql) await saveMessages();
    sendJson(response, 201, { message });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/reviews") {
    if (sql) {
      const result = await sql`SELECT review FROM mentorship_reviews`;
      const rows = Array.isArray(result) ? result : (result.rows || []);
      reviews = rows.map(row => typeof row.review === "string" ? JSON.parse(row.review) : row.review);
    }
    const publicReviews = reviews.map(review => {
      const reviewer = accounts.find(account => account.id === review.reviewerId);
      return { id: review.id, mentorId: review.mentorId, reviewerId: review.reviewerId, rating: review.rating, text: review.text, reviewerName: reviewer?.name || "Community member", createdAt: review.createdAt };
    });
    sendJson(response, 200, { reviews: publicReviews });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/reviews") {
    const body = await readJson(request);
    const mentorId = typeof body.mentorId === "string" ? body.mentorId : "";
    const authenticated = await authenticatedAccount(request);
    if (!authenticated) {
      sendJson(response, 401, { error: "Please sign in again to share a review." });
      return;
    }
    const reviewerId = authenticated.id;
    if (body.reviewerId !== reviewerId) {
      sendJson(response, 403, { error: "A review can only be shared from your own account." });
      return;
    }
    if (authenticated.role !== "Student") {
      sendJson(response, 403, { error: "Only students can review mentors." });
      return;
    }
    const rating = Number(body.rating);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const connected = chatRequests.some(item => {
      if (item.mentorId !== mentorId || item.status !== "Completed") return false;
      const requesterId = item.requesterId || accounts.find(account => account.email === item.requesterEmail)?.id;
      const isReviewer = requesterId === reviewerId ||
        String(item.requesterEmail || "").toLowerCase() === String(authenticated.email || "").toLowerCase();
      const bothParticipantsCompleted = !Array.isArray(item.completedBy) ||
        (item.completedBy.includes(item.mentorId) && item.completedBy.includes(reviewerId));
      return isReviewer && bothParticipantsCompleted;
    });
    const mentor = accounts.find(account => account.id === mentorId && account.role === "Mentor" && account.status === "Active");
    if (!mentor || !connected || !Number.isInteger(rating) || rating < 1 || rating > 5 || !text || text.length > 1000) {
      sendJson(response, 400, { error: "A valid connected member, rating, and review are required." });
      return;
    }
    let existing;
    if (sql) {
      const result = await sql`SELECT review FROM mentorship_reviews WHERE mentor_id = ${mentorId}`;
      const rows = Array.isArray(result) ? result : (result.rows || []);
      existing = rows.map(row => typeof row.review === "string" ? JSON.parse(row.review) : row.review)
        .find(review => review.reviewerId === reviewerId);
    } else {
      existing = reviews.find(review => review.mentorId === mentorId && review.reviewerId === reviewerId);
    }
    const review = {
      id: existing?.id || crypto.randomUUID(),
      mentorId,
      reviewerId,
      rating,
      text,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    const cachedIndex = reviews.findIndex(item => item.id === review.id || (item.mentorId === mentorId && item.reviewerId === reviewerId));
    if (cachedIndex >= 0) reviews[cachedIndex] = review;
    else reviews.push(review);
    if (sql) {
      await sql`
        INSERT INTO mentorship_reviews (id, mentor_id, review)
        VALUES (${review.id}, ${review.mentorId}, ${JSON.stringify(review)})
        ON CONFLICT (id) DO UPDATE SET
          mentor_id = EXCLUDED.mentor_id,
          review = EXCLUDED.review
      `;
    } else {
      await saveReviews();
    }
    const reviewer = accounts.find(account => account.id === reviewerId);
    sendJson(response, 201, { review: { id: review.id, mentorId, reviewerId, rating, text, reviewerName: reviewer?.name || "Community member", createdAt: review.createdAt } });
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
  if (!accountsReady) accountsReady = Promise.all([loadAccounts(), loadChatRequests(), loadMessages(), loadCalls(), loadReviews(), loadPollResponses(), loadAppReviews()]);
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