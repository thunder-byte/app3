const legacyDemoIds = new Set(["maya", "jordan", "amara", "diego", "priya", "alex", "sam", "nina", "student"]);
const legacyDemoEmails = new Set(["maya.chen@example.com", "jordan.lee@example.com", "amara.okafor@example.com", "diego.r@example.com", "taylor.kim@example.com", "jamie.davis@example.com", "test@gmail.com"]);
const TEST_ERROR_LOG = true; // Set to false for the final build.

let debugLogPanel;
let debugLogEntries;
function logTestError(source, error) {
  if (!TEST_ERROR_LOG) return;
  const detail = error && error.message ? error.message : String(error || "Unknown error");
  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.textContent = `[${timestamp}] ${source}: ${detail}`;
  debugLogEntries.append(entry);
  while (debugLogEntries.children.length > 20) debugLogEntries.firstElementChild.remove();
  debugLogEntries.scrollTop = debugLogEntries.scrollHeight;
}

if (TEST_ERROR_LOG) {
  debugLogPanel = document.createElement("div");
  debugLogPanel.className = "debug-log-panel";
  debugLogPanel.innerHTML = '<div class="debug-log-header"><strong>Test error log</strong><button type="button">Clear</button></div><div class="debug-log-entries"></div>';
  document.body.append(debugLogPanel);
  debugLogEntries = debugLogPanel.querySelector(".debug-log-entries");
  debugLogPanel.querySelector("button").addEventListener("click", () => debugLogEntries.replaceChildren());
  window.addEventListener("error", event => logTestError("Window", event.error || event.message));
  window.addEventListener("unhandledrejection", event => logTestError("Promise", event.reason));
}

const readStore = (key, fallback) => {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
  catch (error) { console.error(`Unable to read ${key} from local storage`, error); return fallback; }
};
const savedUsers = readStore("mm-users", []);
const savedBookings = readStore("mm-bookings", []);
const savedReviews = readStore("mm-reviews", {});
const savedReports = readStore("mm-reports", []);
const savedUser = readStore("mm-user", { name: "Your name", email: "", interests: "", goal: "" });
const savedToken = readStore("mm-token", "");
const savedNavigation = readStore("mm-navigation", null);
const validViews = new Set(["discover", "sessions", "profile", "member", "admin", "messages"]);
const savedAuthUsers = readStore("mm-auth-users", []);
const savedUsersHaveClientCredentials = savedUsers.some(user => user.passwordSalt || user.passwordHash);
let authUsers = savedAuthUsers;
let authToken = savedToken;
let navigationOwnerId = savedNavigation?.userId || "";
const restoreNavigation = savedNavigation && savedNavigation.userId === savedUser.id;
const state = {
  view: restoreNavigation && validViews.has(savedNavigation.view) ? savedNavigation.view : "discover",
  profileId: restoreNavigation ? String(savedNavigation.profileId || "") : "",
  activeConversationId: restoreNavigation ? String(savedNavigation.activeConversationId || "") : "",
  messages: {},
  user: legacyDemoEmails.has(savedUser.email)
    ? { name: "Your name", email: "", interests: "", goal: "" }
    : savedUser,
  bookings: savedBookings.filter(item => !legacyDemoIds.has(item.mentorId)),
  reviews: Object.fromEntries(Object.entries(savedReviews)
    .filter(([mentorId]) => !legacyDemoIds.has(mentorId))
    .map(([mentorId, review]) => [mentorId, Array.isArray(review) ? review : [review]])),
  users: savedUsers.filter(user => !legacyDemoIds.has(user.id) && !legacyDemoEmails.has(user.email)).map(({ passwordSalt, passwordHash, ...user }) => user),
  reports: savedReports.filter(report => report.title !== "Inappropriate message reported"),
  filter: "All fields", query: ""
};
const viewContainer = document.getElementById("view-container");
const modalRoot = document.getElementById("modal-root");
let toastTimeout;
const safe = (value) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function apiHeaders(json = false) {
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}
async function syncCommunityAccounts() {
  if (!authToken) return;
  try {
    const [response, reviewResponse] = await Promise.all([
      fetch("/api/accounts", { headers: apiHeaders() }),
      fetch("/api/reviews")
    ]);
    if (!response.ok) throw new Error(`Account request failed (HTTP ${response.status}).`);
    const payload = await readJsonResponse(response);
    const previousUsers = JSON.stringify(state.users);
    const previousReviews = JSON.stringify(state.reviews);
    const sharedUsers = (payload.users || []).filter(user => !legacyDemoEmails.has(String(user.email || "").trim().toLowerCase()));
    const byId = new Map(sharedUsers.map(user => [user.id, user]));
    for (const localUser of state.users) {
      if (!byId.has(localUser.id) && !legacyDemoIds.has(localUser.id)) byId.set(localUser.id, localUser);
    }

    state.users = [...byId.values()];
    if (!reviewResponse.ok) throw new Error(`Review request failed (HTTP ${reviewResponse.status}).`);
    const reviewPayload = await readJsonResponse(reviewResponse);
    state.reviews = (reviewPayload.reviews || []).reduce((grouped, review) => {
      if (!grouped[review.mentorId]) grouped[review.mentorId] = [];
      grouped[review.mentorId].push(review);
      return grouped;
    }, {});
    if (JSON.stringify(state.users) !== previousUsers || JSON.stringify(state.reviews) !== previousReviews) {
      persist();
      if (state.view !== "messages") render();
    }
  } catch (error) {
    console.error("Unable to load shared community accounts", error);
    logTestError("Accounts sync", error);
  }
}

async function syncConnections() {
  if (!state.user.id || !authToken) return;
  try {
    const response = await fetch(`/api/chat-requests?userId=${encodeURIComponent(state.user.id)}`, { headers: apiHeaders() });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `Connection request failed (HTTP ${response.status}).`);
    const remoteRequests = (payload.requests || []).map(request => ({
      id: request.id,
      mentorId: request.mentorId,
      requesterId: request.requesterId,
      mentorName: request.mentorName || (state.user.role === "Mentor" ? state.user.name : "Mentor"),
      requesterEmail: request.requesterEmail,
      requesterName: request.requesterName,
      requesterInterests: request.requesterInterests,
      requesterGoal: request.requesterGoal,
      topic: request.topic,
      date: request.date,
      time: request.time,
      format: request.format,
      note: request.note,
      status: request.status
    }));
    const remoteIds = new Set(remoteRequests.map(request => request.id));
    const previousBookings = JSON.stringify(state.bookings);
    state.bookings = [
      ...state.bookings.filter(request => !remoteIds.has(request.id)),
      ...remoteRequests
    ];
    if (JSON.stringify(state.bookings) !== previousBookings) {
      persist();
      if (state.view !== "messages") render();
    }
    if (state.view === "messages" && state.activeConversationId) syncConversation(state.activeConversationId);
  } catch (error) {
    logTestError("Connections sync", error);
  }
}
async function syncConversation(requestId) {
  if (!requestId || !state.user.id) return;
  try {
    const url = `/api/messages?requestId=${encodeURIComponent(requestId)}&userId=${encodeURIComponent(state.user.id)}`;
    const response = await fetch(url, { headers: apiHeaders() });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `Message request failed (HTTP ${response.status}).`);
    state.messages[requestId] = payload.messages || [];
    if (state.view === "messages" && state.activeConversationId === requestId) {
      const list = document.getElementById("message-list");
      if (list) {
        list.innerHTML = state.messages[requestId].length
          ? state.messages[requestId].map(message => `<div class="chat-message ${message.senderId === state.user.id ? "mine" : ""}"><span>${safe(message.senderName)}</span><p>${safe(message.text)}</p><small>${new Date(message.createdAt).toLocaleString()}</small></div>`).join("")
          : `<div class="empty-state"><strong>Start the conversation.</strong>Say hello or share a question.</div>`;
        list.scrollTop = list.scrollHeight;
      }
    }
  } catch (error) {
    console.error("Unable to load messages", error);
    logTestError("Messages sync", error);
  }
}
function persist() {
  try {
    localStorage.setItem("mm-user", JSON.stringify(state.user));
    localStorage.setItem("mm-bookings", JSON.stringify(state.bookings));
    localStorage.setItem("mm-reviews", JSON.stringify(state.reviews));
    localStorage.setItem("mm-users", JSON.stringify(state.users));
    localStorage.setItem("mm-reports", JSON.stringify(state.reports));
    localStorage.setItem("mm-auth-users", JSON.stringify(authUsers));
  } catch (error) { console.error("Unable to save MentorshipMatch data", error); showToast("Your changes could not be saved in this browser."); }
}
if (state.user !== savedUser || state.bookings.length !== savedBookings.length || Object.keys(state.reviews).length !== Object.keys(savedReviews).length || state.users.length !== savedUsers.length || state.reports.length !== savedReports.length || savedUsersHaveClientCredentials) persist();
function initials(name) { return String(name || "YN").split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase(); }
function updateShell() {
  document.getElementById("topbar-name").textContent = state.user.name;
  document.querySelectorAll(".avatar-you").forEach(el => el.textContent = initials(state.user.name));
  document.getElementById("session-count").textContent = state.bookings.filter(item => item.status !== "Completed" && item.status !== "Cancelled").length;
  const accountRole = document.getElementById("account-role");
  if (accountRole) accountRole.textContent = `${state.user.role || "Student"} account`;
}
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message; toast.classList.add("show");
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
}
function normalizeEmail(email) { return String(email || "").trim().toLowerCase(); }
async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.includes("application/json")) {
    const pageTitle = text.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim();
    throw new Error(pageTitle || text.trim().slice(0, 160) || `Server returned HTTP ${response.status} instead of JSON.`);
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`Server returned invalid JSON (HTTP ${response.status}).`); }
}
async function hashPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function emailAlreadyInUse(email, exceptUserId = null) {
  const normalized = normalizeEmail(email);
  return state.users.some(user => user.id !== exceptUserId && normalizeEmail(user.email) === normalized);
}
function reviewsFor(mentorId) {
  const reviews = state.reviews[mentorId];
  return Array.isArray(reviews) ? reviews : reviews ? [reviews] : [];
}
function connectionFor(memberId) {
  return state.bookings.find(booking => {
    if (booking.status === "Cancelled") return false;
    const requester = state.users.find(user => user.id === memberId);
    const currentUserIsRequester = booking.requesterId === state.user.id ||
      normalizeEmail(booking.requesterEmail) === normalizeEmail(state.user.email);
    return (booking.mentorId === memberId && currentUserIsRequester) ||
      booking.requesterId === memberId ||
      Boolean(requester?.email && normalizeEmail(requester.email) === normalizeEmail(booking.requesterEmail));
  });
}
function mentorCard(mentor) {
  const isMentor = mentor.role === "Mentor";
  const connected = Boolean(connectionFor(mentor.id));
  return `<article class="mentor-card">
    <div class="card-top"><div class="mentor-avatar ${isMentor ? "avatar-blue" : "avatar-you"}">${initials(mentor.name)}</div></div>
    <h3>${safe(mentor.name)}</h3><p class="mentor-role"><strong>${safe(mentor.role)}</strong>${mentor.field ? ` · ${safe(mentor.field)}` : ""}</p>
    <div class="mentor-meta"><span>${isMentor ? "Mentor profile" : "Student profile"}</span></div>
    <p class="mentor-bio">${safe(mentor.goal || mentor.bio || mentor.interests || "This member has shared their profile and preferences.")}</p><div class="tag-list"><span class="tag">${safe(mentor.field || (mentor.interests || "Community member").split(",")[0])}</span></div>
    <div class="card-footer"><button class="button-quiet" data-profile="${safe(mentor.id)}">View profile</button>${connected ? `<button class="button-secondary" data-message="${safe(connectionFor(mentor.id).id)}">Message</button>` : isMentor ? `<button class="button-primary" data-book="${safe(mentor.id)}">Request a chat <span>↗</span></button>` : ""}</div>
  </article>`;
}
function renderDiscover() {
  const activeMembers = state.users.filter(user => user.status === "Active" && user.id !== state.user.id);
  const matches = activeMembers.filter(mentor => {
    const searchMatch = `${mentor.name} ${mentor.role} ${mentor.field || ""} ${mentor.interests || ""} ${mentor.goal || ""}`.toLowerCase().includes(state.query.toLowerCase());
    return searchMatch && (state.filter === "All fields" || mentor.field === state.filter);
  });
  return `<div class="view-wrap">
    <section class="hero"><div><div class="eyebrow">A little guidance goes a long way</div><h1>Your future has a friend in it.</h1><p>Meet students and mentors, explore their interests, and connect when you're ready.</p></div><div class="hero-side"><div class="match-pill">✳ &nbsp;<b>${activeMembers.length} members</b> available</div></div></section>
    <section class="featured-banner"><div class="banner-copy"><span class="banner-tag"><span></span> Your next chapter starts here</span><h2>Big dreams. Real people in your corner.</h2><p>A 20-minute conversation could help you see your next step a little more clearly.</p><button class="button-primary" data-scroll-mentors>Explore your matches <span>↓</span></button></div>
      <div class="banner-art" aria-hidden="true"><div class="floating-card one"><strong>Good things grow here</strong>Curiosity is a great place to start.</div><div class="mentor-illustration"><div class="person-head"></div><div class="person-hair"></div><div class="person-body"></div><div class="person-shirt"></div></div><div class="floating-card two"><span class="tiny-avatar">✳</span><span>New connections,<br>new possibilities</span></div></div>
    </section>
    <section id="mentor-section"><div class="section-heading"><div><h2>Community members</h2><p>Explore member profiles and see what they're interested in.</p></div><button class="button-quiet" data-view="sessions">Your sessions <span>→</span></button></div>
      <div class="filter-row"><label class="search-field"><span>⌕</span><input id="mentor-search" type="search" placeholder="Search by name, role, or interest..." value="${safe(state.query)}" aria-label="Search mentors"></label>
        <select class="filter-select" id="field-filter" aria-label="Filter by industry">${["All fields", "Technology", "Design", "Science", "Business", "Healthcare", "Education"].map(field => `<option ${state.filter === field ? "selected" : ""}>${field}</option>`).join("")}</select>
        <span class="result-count">${matches.length} mentors</span></div>
      <div class="mentor-grid">${matches.length ? matches.map(mentorCard).join("") : `<div class="empty-state"><strong>No community profiles yet.</strong>Member profiles will appear here once they join the community.</div>`}</div>
    </section></div>`;
}
function renderSessions() {
  const bookings = state.bookings.filter(item => item.status !== "Cancelled").sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const next = bookings.filter(item => item.status !== "Completed").length;
  return `<div class="view-wrap"><div class="content-header"><div><div class="eyebrow">Your time, your pace</div><h1>My sessions</h1><p>Every good conversation starts with showing up.</p></div><button class="button-primary" data-view="discover">+ Find a mentor</button></div>
    <div class="stats-row"><div class="stat-card"><span class="stat-label">Upcoming sessions</span><div class="stat-value">${next}</div><span class="stat-foot">On your calendar</span></div><div class="stat-card"><span class="stat-label">People you've met</span><div class="stat-value">${new Set(bookings.map(item => item.mentorId)).size}</div><span class="stat-foot">Connections made</span></div><div class="stat-card"><span class="stat-label">Reviews shared</span><div class="stat-value">${Object.values(state.reviews).reduce((total, items) => total + (Array.isArray(items) ? items.length : 1), 0)}</div><span class="stat-foot">Paying it forward</span></div></div>
    <section class="panel"><div class="panel-heading"><div><h2>Your conversations</h2><p>Manage requests and reflect on past sessions.</p></div></div><div class="panel-body">${bookings.length ? `<div class="session-list">${bookings.map(booking => {
      const date = new Date(`${booking.date}T12:00:00`);
      const statusClass = booking.status === "Pending" ? "pending" : booking.status === "Completed" ? "completed" : "";
      const conversationName = state.user.role === "Mentor"
        ? (booking.requesterName || booking.requesterEmail)
        : (booking.mentorName || "Mentor");
      return `<article class="session-card"><div class="session-date"><b>${date.getDate()}</b><small>${date.toLocaleString("en-US", { month: "short" })}</small></div><div class="session-info"><strong>${safe(conversationName)} · ${safe(booking.topic)}</strong><p>${date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} at ${safe(booking.time)} · ${safe(booking.format)}</p>${state.user.role === "Mentor" && booking.requesterGoal ? `<p>Student goal: ${safe(booking.requesterGoal)}</p>` : ""}</div><span class="status-badge ${statusClass}">${booking.status}</span><div class="session-actions">${booking.status === "Completed" ? state.user.role === "Mentor" ? `<span class="muted-copy">Completed</span>` : `<button class="button-secondary" data-review="${booking.mentorId}">${reviewsFor(booking.mentorId).some(review => review.reviewerId === state.user.id || review.reviewerEmail === state.user.email) ? "Review shared ✓" : "Leave a review"}</button>` : `<button class="button-secondary" data-complete="${booking.id}">Mark complete</button><button class="button-quiet" data-cancel="${booking.id}">Cancel</button>`}<button class="button-quiet" data-message="${safe(booking.id)}">Message</button></div></article>`;
    }).join("")}</div>` : `<div class="empty-state"><strong>Your calendar has room for a great conversation.</strong>Find a mentor and book your first session.<br><button class="button-primary" style="margin-top:15px" data-view="discover">Browse mentors</button></div>`}</div></section></div>`;
}
function renderProfile() {
  return `<div class="view-wrap"><div class="content-header"><div><div class="eyebrow">A little about you</div><h1>My profile</h1><p>Help mentors understand what you care about and where you're headed.</p></div></div>
    <div class="profile-layout"><section class="profile-card"><div class="profile-banner"></div><div class="profile-header"><span class="avatar avatar-you">${initials(state.user.name)}</span><div><h2>${safe(state.user.name)}</h2><p>${safe(state.user.role || "Student")} · Making room for what's next</p></div></div>
      <form id="profile-form"><div class="field-grid"><div class="field"><label for="profile-name">Full name</label><input id="profile-name" name="name" required value="${safe(state.user.name)}"></div><div class="field"><label for="profile-email">Verified email address</label><input id="profile-email" name="email" type="email" readonly value="${safe(state.user.email)}"><small style="color:#888d83;font-size:9px">Your verified sign-in email can't be changed here.</small></div><div class="field"><label for="profile-role">Account type</label><select id="profile-role" name="role"><option value="Student" ${state.user.role !== "Mentor" ? "selected" : ""}>Student</option><option value="Mentor" ${state.user.role === "Mentor" ? "selected" : ""}>Mentor</option></select></div><div class="field"><label for="profile-school">School</label><input id="profile-school" name="school" value="${safe(state.user.school || "")}" placeholder="e.g. Lincoln High School"></div><div class="field"><label for="profile-year">Year of study</label><select id="profile-year" name="year"><option ${state.user.year === "High school" ? "selected" : ""}>High school</option><option ${state.user.year === "Freshman" ? "selected" : ""}>Freshman</option><option ${state.user.year === "Sophomore" ? "selected" : ""}>Sophomore</option><option ${state.user.year === "Junior" ? "selected" : ""}>Junior</option><option ${state.user.year === "Senior" ? "selected" : ""}>Senior</option><option ${state.user.year === "Graduate" ? "selected" : ""}>Graduate</option></select></div><div class="field full"><label for="profile-interests">Academic & career interests</label><input id="profile-interests" name="interests" value="${safe(state.user.interests)}" placeholder="Design, technology, climate science..."></div><div class="field full"><label for="profile-goal">What are you hoping to explore?</label><textarea id="profile-goal" name="goal" placeholder="Tell mentors a bit about your goals...">${safe(state.user.goal)}</textarea></div></div><div class="modal-actions"><button class="button-primary" type="submit">Save changes</button></div></form>
    </section><aside class="profile-side"><section class="panel"><div class="panel-heading"><h2>Your interests</h2><button class="button-quiet" data-profile-edit>Edit</button></div><div class="panel-body">${(state.user.interests || "").split(",").filter(Boolean).map(item => `<div class="interest-item"><span>${safe(item.trim())}</span><span>↗</span></div>`).join("") || `<span style="font-size:11px;color:#96998f">Add interests to personalize your matches.</span>`}</div></section><section class="panel profile-reviews"><div class="panel-heading"><h2>Reviews about you</h2></div><div class="panel-body">${reviewListMarkup(state.user.id)}</div></section><div class="profile-tip"><strong>Good profiles get great conversations.</strong>Sharing what you're curious about helps mentors show up with ideas made for you.</div></aside></div></div>`;
}
function reviewListMarkup(memberId) {
  const memberReviews = reviewsFor(memberId);
  return memberReviews.length
    ? `<div class="review-list">${memberReviews.map(review => `<article class="review-item"><div class="review-rating" aria-label="${Number(review.rating)} out of 5 stars">${"★".repeat(Math.max(0, Math.min(5, Number(review.rating))))}${"☆".repeat(Math.max(0, 5 - Number(review.rating)))}</div><p>${safe(review.text)}</p><small>From ${safe(review.reviewerName || "Community member")}</small></article>`).join("")}</div>`
    : `<span class="muted-copy">No reviews yet.</span>`;
}
function renderMemberProfile() {
  const member = state.users.find(user => user.id === state.profileId && user.status === "Active");
  if (!member) return `<div class="view-wrap"><div class="empty-state"><strong>Profile unavailable.</strong>This account may no longer be active.<br><button class="button-secondary" data-view="discover">Back to community</button></div></div>`;
  const connection = connectionFor(member.id);
  const interests = (member.interests || "").split(",").map(value => value.trim()).filter(Boolean);
  return `<div class="view-wrap"><div class="content-header"><div><div class="eyebrow">Community profile</div><h1>${safe(member.name)}</h1><p>${safe(member.role)}${member.field ? ` · ${safe(member.field)}` : ""}</p></div><button class="button-quiet" data-view="discover">← Back to community</button></div>
    <div class="public-profile-layout"><section class="profile-card public-profile-card"><div class="profile-banner"></div><div class="profile-header"><span class="avatar ${member.role === "Mentor" ? "avatar-blue" : "avatar-you"}">${initials(member.name)}</span><div><h2>${safe(member.name)}</h2><p>${safe(member.role)} · Community member</p></div></div><div class="public-preferences">
      <div><strong>School</strong><span>${safe(member.school || "Not shared")}</span></div><div><strong>Year of study</strong><span>${safe(member.year || "Not shared")}</span></div>
      <div class="preference-wide"><strong>Interests</strong><span>${interests.length ? interests.map(safe).join(", ") : "Not shared"}</span></div>
      <div class="preference-wide"><strong>Goals</strong><span>${safe(member.goal || "Not shared")}</span></div>
    </div><div class="profile-actions">${connection ? `<button class="button-primary" data-message="${safe(connection.id)}">Message ${safe(member.name.split(" ")[0])}</button>` : member.role === "Mentor" ? `<button class="button-primary" data-book="${safe(member.id)}">Request a chat</button>` : `<span class="muted-copy">You can message after you connect through a mentor session.</span>`}</div></section>
    <section class="panel"><div class="panel-heading"><div><h2>Reviews</h2><p>Feedback shared by people who connected with ${safe(member.name.split(" ")[0])}.</p></div></div><div class="panel-body">${reviewListMarkup(member.id)}</div></section></div></div>`;
}
function renderAdmin() {
  return `<div class="view-wrap"><div class="content-header"><div><div class="eyebrow">Keeping this a good place to grow</div><h1>Admin panel</h1><p>Manage the community and review reports that need a human touch.</p></div><span class="status-badge">Admin view</span></div>
    <div class="stats-row"><div class="stat-card"><span class="stat-label">Community members</span><div class="stat-value">${state.users.length}</div><span class="stat-foot">Students and mentors</span></div><div class="stat-card"><span class="stat-label">Mentor profiles</span><div class="stat-value">${state.users.filter(user => user.role === "Mentor").length}</div><span class="stat-foot">Verified professionals</span></div><div class="stat-card"><span class="stat-label">Needs attention</span><div class="stat-value">${state.reports.filter(report => report.status !== "Resolved").length}</div><span class="stat-foot">Community reports</span></div></div>
    <section class="panel" style="margin-bottom:17px"><div class="panel-heading"><div><h2>Community reports</h2><p>Review flagged activity and keep the community welcoming.</p></div></div><div class="panel-body">${state.reports.length ? `<div class="session-list">${state.reports.map(report => `<article class="session-card"><div class="session-date" style="font-size:17px">⚑</div><div class="session-info"><strong>${safe(report.title)}</strong><p>${safe(report.detail)} · ${safe(report.type)}</p></div><span class="status-badge ${report.status === "Resolved" ? "completed" : "pending"}">${report.status}</span>${report.status !== "Resolved" ? `<button class="button-secondary" data-resolve="${report.id}">Mark resolved</button>` : ""}</article>`).join("")}</div>` : `<div class="empty-state"><strong>All clear for now.</strong>No community reports need review.</div>`}</div></section>
    <section class="panel"><div class="panel-heading"><div><h2>Community members</h2><p>Review account status and industry interests.</p></div><button class="button-secondary" data-add-user>+ Add member</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Member</th><th>Role</th><th>Field</th><th>Status</th><th>Actions</th></tr></thead><tbody>${state.users.length ? state.users.map(user => `<tr><td><div class="table-person"><span class="avatar ${user.role === "Mentor" ? "avatar-blue" : "avatar-you"}">${initials(user.name)}</span><span><strong>${safe(user.name)}</strong><small>${safe(user.email)}</small></span></div></td><td>${safe(user.role)}</td><td>${safe(user.field)}</td><td><span class="status-badge ${user.status === "Flagged" ? "pending" : user.status === "Suspended" ? "completed" : ""}">${safe(user.status)}</span></td><td><div style="display:flex;gap:6px"><button class="${user.status === "Suspended" ? "button-secondary" : "button-danger"}" data-user-action="${safe(user.id)}">${user.status === "Suspended" ? "Restore" : "Suspend"}</button><button class="button-quiet" data-delete-member="${safe(user.id)}" aria-label="Delete ${safe(user.name)} account">Delete</button></div></td></tr>`).join("") : `<tr><td colspan="5" style="text-align:center;color:#96998f;padding:25px">No community members yet.</td></tr>`}</tbody></table></div></section>
    <p style="font-size:10px;color:#96998f;margin-top:12px">Admin records are stored in this browser only. Connect an authenticated backend before production use.</p></div>`;
}
function renderMessages() {
  const conversations = state.bookings.filter(booking => booking.status !== "Cancelled");
  const active = conversations.find(booking => booking.id === state.activeConversationId);
  const partner = active && (state.user.role === "Mentor"
    ? state.users.find(user => user.id === active.requesterId) || { name: active.requesterName || "Student", id: active.requesterId }
    : state.users.find(user => user.id === active.mentorId) || { name: active.mentorName || "Mentor", id: active.mentorId });
  const convoPanel = active && partner
    ? `<section class="panel message-panel"><div class="panel-heading"><div><h2>${safe(partner.name)}</h2><p>${safe(active.topic)} · Connected</p></div><button class="button-quiet" data-profile="${safe(partner.id)}">View profile</button></div><div class="message-list" id="message-list">${(state.messages[active.id] || []).map(message => `<div class="chat-message ${message.senderId === state.user.id ? "mine" : ""}"><span>${safe(message.senderName)}</span><p>${safe(message.text)}</p><small>${new Date(message.createdAt).toLocaleString()}</small></div>`).join("") || `<div class="empty-state"><strong>Start the conversation.</strong>Say hello or share a question.</div>`}</div><form class="message-form" id="message-form" data-request="${safe(active.id)}"><input name="text" maxlength="2000" required placeholder="Write a message..." aria-label="Message"><button class="button-primary" type="submit">Send</button></form></section>`
    : `<section class="panel"><div class="panel-body"><div class="empty-state"><strong>Select a connection to message.</strong>Start a mentor session request to connect with another member.</div></div></section>`;
  return `<div class="view-wrap"><div class="content-header"><div><div class="eyebrow">A conversation can start anywhere</div><h1>Messages</h1><p>Message students and mentors after you connect through a session request.</p></div></div><div class="messages-layout"><section class="panel conversation-panel"><div class="panel-heading"><h2>Connections</h2></div><div class="conversation-list">${conversations.length ? conversations.map(booking => {
    const name = state.user.role === "Mentor" ? booking.requesterName || "Student" : booking.mentorName || "Mentor";
    return `<button class="conversation-choice ${booking.id === state.activeConversationId ? "selected" : ""}" data-message="${safe(booking.id)}"><span class="avatar ${state.user.role === "Mentor" ? "avatar-you" : "avatar-blue"}">${initials(name)}</span><span><strong>${safe(name)}</strong><small>${safe(booking.topic)}</small></span></button>`;
  }).join("") : `<div class="muted-copy conversation-empty">No connections yet. Request a mentor chat to start messaging.</div>`}</div></section>${convoPanel}</div></div>`;
}
function render() {
  const views = { discover: renderDiscover, sessions: renderSessions, profile: renderProfile, member: renderMemberProfile, admin: renderAdmin, messages: renderMessages };
  const labels = { discover: "Discover people", sessions: "My sessions", profile: "My profile", member: "Community profile", admin: "Admin panel", messages: "Messages" };
  document.getElementById("crumb-label").textContent = labels[state.view] || labels.discover;
  document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.view === state.view));
  viewContainer.innerHTML = (views[state.view] || renderDiscover)();
  updateShell();
  navigationOwnerId = state.user.id || navigationOwnerId;
  try {
    localStorage.setItem("mm-navigation", JSON.stringify({
      userId: navigationOwnerId,
      view: state.view,
      profileId: state.profileId,
      activeConversationId: state.activeConversationId
    }));
  } catch (error) {
    console.error("Unable to save the current page", error);
    logTestError("Page state save", error);
  }
}
function openModal(title, subtitle, body) {
  modalRoot.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button class="modal-close" data-close-modal aria-label="Close">×</button></header><div class="modal-body">${body}</div></section>`;
  modalRoot.classList.add("open"); modalRoot.setAttribute("aria-hidden", "false");
  modalRoot.querySelector("[data-close-modal]").focus();
}
function closeModal() { modalRoot.classList.remove("open"); modalRoot.setAttribute("aria-hidden", "true"); modalRoot.innerHTML = ""; }
function deleteMemberData(member) {
  state.users = state.users.filter(user => user.id !== member.id);
  authUsers = authUsers.filter(user => user.id !== member.id);
  state.bookings = state.bookings.filter(booking => booking.mentorId !== member.id && booking.requesterEmail !== member.email);
  state.reviews = Object.fromEntries(Object.entries(state.reviews).flatMap(([mentorId, items]) => {
    if (mentorId === member.id) return [];
    const remaining = (Array.isArray(items) ? items : [items]).filter(review =>
      review.reviewerId !== member.id && review.reviewerEmail !== member.email
    );
    return remaining.length ? [[mentorId, remaining]] : [];
  }));
  state.reports = state.reports.filter(report => report.userId !== member.id);
}
function confirmAccountDeletion(member, ownAccount = false) {
  openModal("Delete this account?", "This permanently removes the account and associated local data. This cannot be undone.", `<div class="modal-form"><p style="font-size:12px;color:#656a60;line-height:1.6;margin:0">Account: <strong>${safe(member.name)}</strong>${member.email ? ` (${safe(member.email)})` : ""}</p><div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Keep account</button><button class="button-danger" type="button" ${ownAccount ? "data-delete-own" : `data-confirm-delete="${safe(member.id)}"`}>Delete permanently</button></div></div>`);
}
function openBooking(mentorId) {
  const mentor = state.users.find(item => item.id === mentorId && item.role === "Mentor"); if (!mentor) return;
  const minDate = new Date(); minDate.setDate(minDate.getDate() + 1);
  const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 60);
  openModal("Let's find a time", `Send ${mentor.name.split(" ")[0]} a session request.`, `<div class="modal-mentor"><span class="mentor-avatar avatar-blue">${initials(mentor.name)}</span><span><strong>${safe(mentor.name)}</strong><p>Mentor · ${safe(mentor.field)}</p></span></div><form class="modal-form" id="booking-form" data-mentor="${mentor.id}">
    <div class="field"><label for="booking-topic">What would you like to talk about?</label><input id="booking-topic" name="topic" required maxlength="70" placeholder="e.g. Getting started in product design"></div>
    <div class="field-grid"><div class="field"><label for="booking-date">A date that works</label><input id="booking-date" name="date" type="date" min="${minDate.toISOString().slice(0,10)}" max="${maxDate.toISOString().slice(0,10)}" required></div><div class="field"><label for="booking-time">Preferred time</label><select name="time" id="booking-time" required><option value="">Choose a time</option><option>9:00 AM</option><option>10:30 AM</option><option>12:00 PM</option><option>2:00 PM</option><option>3:30 PM</option><option>5:00 PM</option></select></div></div>
    <div class="field"><label for="booking-format">How would you like to meet?</label><select name="format" id="booking-format"><option>Video call</option><option>Chat</option></select></div>
    <div class="field"><label for="booking-note">A note for ${safe(mentor.name.split(" ")[0])} <span style="color:#999;font-weight:400">(optional)</span></label><textarea id="booking-note" name="note" maxlength="300" placeholder="Share a little context or a question you'd love to explore..."></textarea></div>
    <div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Maybe later</button><button class="button-primary" type="submit">Send request ↗</button></div></form>`);
}
function openReview(mentorId) {
  const mentor = state.users.find(item => item.id === mentorId && item.role === "Mentor"); if (!mentor) return;
  openModal("How did it go?", `Your feedback helps ${mentor.name.split(" ")[0]} and future mentees.`, `<div class="modal-mentor"><span class="mentor-avatar avatar-blue">${initials(mentor.name)}</span><span><strong>${safe(mentor.name)}</strong><p>Mentor · ${safe(mentor.field)}</p></span></div><form class="modal-form" id="review-form" data-mentor="${mentor.id}"><div class="field"><label>Your rating</label><div class="modal-rating" role="radiogroup" aria-label="Rating">${[1,2,3,4,5].map(num => `<button type="button" data-rating="${num}" aria-label="${num} star${num > 1 ? "s" : ""}">★</button>`).join("")}</div><input type="hidden" name="rating" required></div><div class="field"><label for="review-text">What would you like others to know?</label><textarea id="review-text" name="text" maxlength="300" required placeholder="What made this conversation meaningful?"></textarea></div><div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Cancel</button><button class="button-primary" type="submit">Share review</button></div></form>`);
}
function showAuth(mode = "login") {
  document.querySelector(".app-shell").style.display = "none";
  const authRoot = document.getElementById("auth-root");
  authRoot.classList.add("active");
  const isSignup = mode === "signup";
  authRoot.innerHTML = `<div class="auth-screen"><section class="auth-art"><a class="brand auth-logo" href="#"><span class="brand-mark"><span></span><span></span><span></span></span><span>mentorship<span class="brand-light">match</span></span></a><div class="auth-art-content"><span class="eyebrow">A good place to begin</span><h1>There's more than one way to get where you're going.</h1><p>Find people who'll listen, share what they know, and cheer you on along the way.</p></div><div class="auth-shape"></div></section><section class="auth-form-wrap"><form class="auth-form" id="auth-form"><div class="eyebrow">${isSignup ? "Make yourself at home" : "Welcome back"}</div><h2>${isSignup ? "Create your account" : "Good to see you again."}</h2><p>${isSignup ? "Your next conversation could open a new door." : "Pick up where your next step begins."}</p>${isSignup ? `<div class="field"><label for="auth-name">Your name</label><input id="auth-name" name="name" required placeholder="Your name"></div>` : ""}<div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" required placeholder="you@example.com"></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" minlength="8" autocomplete="${isSignup ? "new-password" : "current-password"}" required placeholder="At least 8 characters"></div>${isSignup ? `<div class="field"><label for="auth-role">I’m here as a...</label><select id="auth-role" name="role"><option>Student</option><option>Mentor</option></select></div>` : ""}<button class="button-primary" type="submit">${isSignup ? "Create my account" : "Sign in"} <span>→</span></button><div id="auth-feedback" class="auth-feedback" hidden></div><div class="auth-switch">${isSignup ? "Already have an account?" : "New to MentorshipMatch?"} <button type="button" data-auth-switch>${isSignup ? "Sign in" : "Create an account"}</button></div></form></section></div>`;
  document.querySelector("[data-auth-switch]").addEventListener("click", () => showAuth(isSignup ? "login" : "signup"));
}
document.addEventListener("click", async event => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.view) { closeModal(); state.view = target.dataset.view; render(); document.getElementById("sidebar").classList.remove("open"); return; }
  if (target.hasAttribute("data-profile")) { state.profileId = target.dataset.profile; state.view = "member"; render(); return; }
  if (target.hasAttribute("data-message")) {
    state.activeConversationId = target.dataset.message;
    state.view = "messages";
    render();
    syncConversation(state.activeConversationId);
    return;
  }
  if (target.hasAttribute("data-book")) { openBooking(target.dataset.book); return; }
  if (target.hasAttribute("data-close-modal")) { closeModal(); return; }
  if (target.hasAttribute("data-review")) { openReview(target.dataset.review); return; }
  if (target.hasAttribute("data-cancel")) {
    try {
      const response = await fetch("/api/chat-requests", {
        method: "PATCH",
        headers: apiHeaders(true),
        body: JSON.stringify({ id: target.dataset.cancel, userId: state.user.id })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Cancellation failed (HTTP ${response.status}).`);
      const booking = state.bookings.find(item => item.id === target.dataset.cancel);
      if (booking) booking.status = "Cancelled";
      persist(); render(); showToast("Session request cancelled.");
    } catch (error) {
      console.error("Unable to cancel session request", error);
      logTestError("Session cancellation", error);
      showToast(error.message || "The session request could not be cancelled.");
    }
    return;
  }
  if (target.hasAttribute("data-complete")) {
    const booking = state.bookings.find(item => item.id === target.dataset.complete);
    if (booking) booking.status = "Completed";
    persist(); render(); showToast("Session marked complete. Leave a review when you're ready."); return;
  }
  if (target.hasAttribute("data-rating")) {
    const form = target.closest("form"); const rating = Number(target.dataset.rating);
    form.querySelector('[name="rating"]').value = rating;
    form.querySelectorAll("[data-rating]").forEach(button => button.classList.toggle("selected", Number(button.dataset.rating) <= rating)); return;
  }
  if (target.hasAttribute("data-resolve")) {
    const report = state.reports.find(item => String(item.id) === target.dataset.resolve);
    if (report) report.status = "Resolved";
    persist(); render(); showToast("Report marked as resolved."); return;
  }
  if (target.hasAttribute("data-user-action")) {
    const user = state.users.find(item => item.id === target.dataset.userAction);
    if (user) user.status = user.status === "Suspended" ? "Active" : "Suspended";
    persist(); render(); showToast(user?.status === "Suspended" ? "Member suspended." : "Member account restored."); return;
  }
  if (target.hasAttribute("data-add-user")) {
    openModal("Add a community member", "Create a member record for the community directory.", `<form class="modal-form" id="add-user-form"><div class="field"><label for="new-name">Full name</label><input id="new-name" name="name" required></div><div class="field"><label for="new-email">Email</label><input id="new-email" name="email" type="email" required></div><div class="field-grid"><div class="field"><label for="new-role">Role</label><select id="new-role" name="role"><option>Student</option><option>Mentor</option></select></div><div class="field"><label for="new-field">Field</label><input id="new-field" name="field" required></div></div><div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Cancel</button><button class="button-primary">Add member</button></div></form>`); return;
  }
  if (target.hasAttribute("data-scroll-mentors")) { document.getElementById("mentor-section").scrollIntoView({ behavior: "smooth" }); return; }
  if (target.hasAttribute("data-profile-edit")) { document.getElementById("profile-name").focus(); return; }
  if (target.id === "account-button") {
    openModal("Your account", "Manage your MentorshipMatch account.", `<div class="modal-form"><div class="modal-mentor"><span class="avatar avatar-you">${initials(state.user.name)}</span><span><strong>${safe(state.user.name)}</strong><p>${safe(state.user.email)} · ${safe(state.user.role || "Student")}</p></span></div><button class="button-secondary" data-view="profile">Edit your profile</button><button class="button-quiet" data-logout>Sign out</button><button class="button-danger" data-request-delete-own>Delete my account</button></div>`); return;
  }
  if (target.hasAttribute("data-logout")) {
    authToken = "";
    localStorage.removeItem("mm-token");
    closeModal(); showAuth(); return;
  }
  if (target.hasAttribute("data-request-delete-own")) {
    const member = state.users.find(user => user.email === state.user.email) || { id: "", name: state.user.name, email: state.user.email };
    confirmAccountDeletion(member, true); return;
  }
  if (target.hasAttribute("data-delete-member")) {
    const member = state.users.find(user => user.id === target.dataset.deleteMember);
    if (member) confirmAccountDeletion(member, member.email === state.user.email);
    return;
  }
  if (target.hasAttribute("data-confirm-delete")) {
    const member = state.users.find(user => user.id === target.dataset.confirmDelete);
    if (!member) { closeModal(); showToast("That account could not be found."); return; }
    deleteMemberData(member); persist(); closeModal(); render(); showToast("Account deleted."); return;
  }
  if (target.hasAttribute("data-delete-own")) {
    const email = state.user.email;
    const ownMember = state.users.find(user => user.email === email);
    state.users = state.users.filter(user => user.email !== email);
    authUsers = authUsers.filter(user => normalizeEmail(user.email) !== normalizeEmail(email));
    if (ownMember) state.reports = state.reports.filter(report => report.userId !== ownMember.id);
    state.bookings = [];
    state.reviews = {};
    state.user = { name: "Your name", email: "", interests: "", goal: "" };
    authToken = "";
    localStorage.removeItem("mm-token");
    persist(); closeModal(); showAuth("signup"); showToast("Your account and local data have been deleted."); return;
  }
  if (target.id === "notifications") { showToast("You're all caught up — nice work."); }
});
document.addEventListener("input", event => {
  if (event.target.id === "mentor-search") { state.query = event.target.value; const cursor = event.target.selectionStart; render(); const input = document.getElementById("mentor-search"); input.focus(); input.setSelectionRange(cursor, cursor); }
});
document.addEventListener("change", event => {
  if (event.target.id === "field-filter") { state.filter = event.target.value; render(); }
});
document.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  if (form.id === "booking-form") {
    const data = new FormData(form); const mentor = state.users.find(item => item.id === form.dataset.mentor && item.role === "Mentor" && item.status === "Active");
    if (!mentor) { showToast("That mentor could not be found."); return; }
    const booking = { id: `booking-${Date.now()}`, mentorId: mentor.id, requesterId: state.user.id, mentorName: mentor.name, requesterEmail: state.user.email, topic: data.get("topic").trim(), date: data.get("date"), time: data.get("time"), format: data.get("format"), note: data.get("note").trim(), status: "Pending" };
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const response = await fetch("/api/chat-requests", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify(booking)
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Session request failed (HTTP ${response.status}).`);
      booking.requesterId = payload.request.requesterId;
    } catch (error) {
      console.error("Unable to create session connection", error);
      logTestError("Chat request save", error);
      showToast(error.message || "Your session request could not be sent.");
      submitButton.disabled = false;
      return;
    }
    state.bookings.push(booking);
    persist(); closeModal(); state.view = "sessions"; render(); showToast("Your session request is on its way!"); return;
  }
  if (form.id === "review-form") {
    const data = new FormData(form); const rating = Number(data.get("rating"));
    if (!rating) { showToast("Choose a star rating before sharing."); return; }
    const review = { rating, text: data.get("text").trim(), reviewerId: state.user.id, reviewerName: state.user.name, reviewerEmail: state.user.email, createdAt: new Date().toISOString() };
    const mentorReviews = reviewsFor(form.dataset.mentor);
    const existing = mentorReviews.findIndex(item => item.reviewerId === state.user.id || item.reviewerEmail === state.user.email);
    if (existing >= 0) mentorReviews[existing] = review;
    else mentorReviews.push(review);
    state.reviews[form.dataset.mentor] = mentorReviews;
    const booking = state.bookings.find(item => item.mentorId === form.dataset.mentor);
    if (booking) booking.status = "Completed";
    fetch("/api/reviews", {
      method: "POST",
      headers: apiHeaders(true),
      body: JSON.stringify({ mentorId: form.dataset.mentor, reviewerId: state.user.id, rating, text: review.text })
    }).then(readJsonResponse).then(payload => {
      if (payload.review) {
        const index = reviewsFor(form.dataset.mentor).findIndex(item => item.reviewerId === state.user.id);
        state.reviews[form.dataset.mentor][index] = payload.review;
        persist();
      }
    }).catch(error => {
      console.error("Unable to save review", error);
      logTestError("Review save", error);
      showToast("Your review is saved here but could not be shared with the community.");
    });
    persist(); closeModal(); render(); showToast("Thanks for sharing your experience!"); return;
  }
  if (form.id === "message-form") {
    const data = new FormData(form);
    const text = String(data.get("text") || "").trim();
    if (!text) return;
    const sendButton = form.querySelector('button[type="submit"]');
    sendButton.disabled = true;
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({ requestId: form.dataset.request, senderId: state.user.id, text })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Message send failed (HTTP ${response.status}).`);
      state.messages[form.dataset.request] = [...(state.messages[form.dataset.request] || []), payload.message];
      render();
      const list = document.getElementById("message-list");
      if (list) list.scrollTop = list.scrollHeight;
    } catch (error) {
      console.error("Unable to send message", error);
      logTestError("Message send", error);
      showToast(error.message || "Your message could not be sent.");
    } finally {
      sendButton.disabled = false;
    }
    return;
  }
  if (form.id === "profile-form") {
    const data = new FormData(form);
    const email = normalizeEmail(data.get("email"));
    const ownMember = state.users.find(user => user.id === state.user.id || normalizeEmail(user.email) === normalizeEmail(state.user.email));
    if (emailAlreadyInUse(email, ownMember?.id)) { showToast("That email is already used by another account."); return; }
    const updatedProfile = { name: data.get("name").trim(), email, role: data.get("role"), school: data.get("school").trim(), year: data.get("year"), interests: data.get("interests").trim(), goal: data.get("goal").trim(), field: data.get("interests").trim().split(",")[0].trim() };
    try {
      const response = await fetch("/api/account/profile", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({ id: state.user.id, ...updatedProfile })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Profile save failed (HTTP ${response.status}).`);
    } catch (error) {
      console.error("Unable to save profile", error);
      logTestError("Profile save", error);
      showToast(error.message || "Your profile could not be saved.");
      return;
    }
    state.user = { ...state.user, ...updatedProfile };
    if (ownMember) {
      Object.assign(ownMember, { name: state.user.name, email, role: state.user.role, school: state.user.school, year: state.user.year, interests: state.user.interests, goal: state.user.goal, field: state.user.field });
    } else {
      state.users.push({ id: state.user.id, name: state.user.name, email, role: state.user.role, school: state.user.school, year: state.user.year, interests: state.user.interests, goal: state.user.goal, field: (state.user.interests || "").split(",")[0].trim(), status: "Active" });
    }
    persist(); render(); showToast("Your profile is looking good."); return;
  }
  if (form.id === "add-user-form") {
    const data = new FormData(form);
    const email = normalizeEmail(data.get("email"));
    if (emailAlreadyInUse(email)) { showToast("That email is already used by another account."); return; }
    state.users.push({ id: `member-${Date.now()}`, name: data.get("name").trim(), email, role: data.get("role"), field: data.get("field").trim(), status: "Active" });
    persist(); closeModal(); render(); showToast("Community member added."); return;
  }
  if (form.id === "auth-form") {
    const data = new FormData(form);
    const email = normalizeEmail(data.get("email"));
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      if (data.get("name")) {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: data.get("name").trim(), email, password: data.get("password"), role: data.get("role") })
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) {
          logTestError("Registration", payload.error || `HTTP ${response.status}`);
          showToast(payload.error || "Unable to create your account.");
          return;
        }
        showAuth("login");
        showToast(payload.message || "Account created.");
        await syncCommunityAccounts();
        return;
      } else {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: data.get("password") })
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) {
          logTestError("Login", payload.error || `HTTP ${response.status}`);
          showToast(payload.error || "Unable to sign in.");
          return;
        }
        if (!payload.token) throw new Error("Sign-in did not return a session token.");
        authToken = payload.token;
        localStorage.setItem("mm-token", JSON.stringify(authToken));
        if (navigationOwnerId && navigationOwnerId !== payload.user.id) {
          state.view = "discover";
          state.profileId = "";
          state.activeConversationId = "";
        }
        navigationOwnerId = payload.user.id;
        state.user = payload.user;
        await syncCommunityAccounts();
        await syncConnections();
      }
    } catch (error) {
      console.error("Account authentication request failed", error);
      logTestError("Authentication", error);
      showToast(error && error.message ? error.message : "Unable to process your account in this browser.");
      return;
    } finally {
      submitButton.disabled = false;
    }
    state.user.email = email;
    persist(); document.getElementById("auth-root").classList.remove("active"); document.querySelector(".app-shell").style.display = ""; render(); showToast("You're in. Welcome to the community!");
  }
});
document.getElementById("mobile-menu").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
modalRoot.addEventListener("click", event => { if (event.target === modalRoot) closeModal(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && modalRoot.classList.contains("open")) closeModal(); });
render();
if (normalizeEmail(savedUser.email) && authToken) {
  document.getElementById("auth-root").classList.remove("active");
  document.querySelector(".app-shell").style.display = "";
  syncCommunityAccounts();
  syncConnections();
} else {
  showAuth("login");
  syncCommunityAccounts();
}
setInterval(() => {
  syncCommunityAccounts();
  syncConnections();
  if (state.view === "messages" && state.activeConversationId) syncConversation(state.activeConversationId);
}, 5000);