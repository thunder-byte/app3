const legacyDemoIds = new Set(["maya", "jordan", "amara", "diego", "priya", "alex", "sam", "nina", "student"]);
const legacyDemoEmails = new Set(["maya.chen@example.com", "jordan.lee@example.com", "amara.okafor@example.com", "diego.r@example.com", "taylor.kim@example.com", "jamie.davis@example.com", "test@gmail.com"]);
const allowedChatAttachmentTypes = new Set([
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
const chatAttachmentExtensions = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};
const profileInterestOptions = [
  "Accounting", "Aerospace Engineering", "Agriculture", "Animal Science", "Anthropology",
  "Architecture", "Art History", "Artificial Intelligence", "Astronomy", "Biochemistry",
  "Biology", "Biomedical Engineering", "Business", "Chemical Engineering", "Chemistry",
  "Civil Engineering", "Climate Science", "Communications", "Computer Science", "Creative Writing",
  "Cybersecurity", "Data Science", "Dentistry", "Design", "Economics",
  "Education", "Electrical Engineering", "Environmental Science", "Film", "Finance",
  "Fine Arts", "Food Science", "Game Development", "Geology", "Graphic Design",
  "Health Sciences", "History", "Human Resources", "Industrial Design", "Information Technology",
  "Journalism", "Law", "Linguistics", "Marketing", "Mathematics",
  "Mechanical Engineering", "Medicine", "Music", "Neuroscience", "Nursing",
  "Nutrition", "Pharmacy", "Philosophy", "Physics", "Political Science",
  "Psychology", "Public Health", "Public Policy", "Robotics", "Social Work",
  "Sociology", "Software Engineering", "Sports Science", "Statistics", "Theater",
  "Urban Planning", "Veterinary Science", "Web Development"
];
const maxChatAttachmentBytes = 3 * 1024 * 1024;
const pollAfterActivityMs = 10 * 60 * 1000;
const pollRecentActivityWindowMs = 60 * 1000;
const pollSnoozeDurationMs = 5 * 60 * 1000;
function logTestError(source, error) {
  console.error(`${source}:`, error);
}

const readStore = (key, fallback) => {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
  catch (error) { console.error(`Unable to read ${key} from local storage`, error); return fallback; }
};
const readStoredIds = key => {
  const value = readStore(key, []);
  return Array.isArray(value) ? value.filter(id => typeof id === "string") : [];
};
const savedUsers = readStore("mm-users", []);
const savedBookings = readStore("mm-bookings", []);
const savedReviews = readStore("mm-reviews", {});
const savedReports = readStore("mm-reports", []);
const savedUser = readStore("mm-user", { name: "Your name", email: "", interests: "", goal: "" });
const savedToken = readStore("mm-token", "");
const savedRecentAccounts = readStore("mm-recent-accounts", []);
const savedNavigation = readStore("mm-navigation", null);
const validViews = new Set(["discover", "sessions", "profile", "member", "messages", "admin"]);
const savedAuthUsers = readStore("mm-auth-users", []);
const savedUsersHaveClientCredentials = savedUsers.some(user => user.passwordSalt || user.passwordHash);
let authUsers = savedAuthUsers;
let authToken = savedToken;
let recentAccounts = Array.isArray(savedRecentAccounts)
  ? savedRecentAccounts.filter(account => account && typeof account.id === "string" && typeof account.token === "string" && account.user && typeof account.user.email === "string")
  : [];
let navigationOwnerId = savedNavigation?.userId || "";
const restoreNavigation = savedNavigation && savedNavigation.userId === savedUser.id;
const messageSyncVersions = new Map();
const messageSyncInFlight = new Map();
const conversationHistorySyncs = new Set();
let presenceSyncTask = Promise.resolve();
let reviewSyncVersion = 0;
const state = {
  view: restoreNavigation && validViews.has(savedNavigation.view) ? savedNavigation.view : "discover",
  profileId: restoreNavigation ? String(savedNavigation.profileId || "") : "",
  activeConversationId: restoreNavigation ? String(savedNavigation.activeConversationId || "") : "",
  messages: {},
  user: legacyDemoEmails.has(savedUser.email)
    ? { name: "Your name", email: "", interests: "", goal: "" }
    : savedUser,
  bookings: savedBookings.filter(item => !legacyDemoIds.has(item.mentorId)),
  hiddenConversationPartnerIds: readStoredIds(`mm-hidden-conversations-${savedUser.id || ""}`),
  notificationMessages: [],
  readMessageIds: readStoredIds(`mm-read-messages-${savedUser.id || ""}`),
  dismissedMessageIds: readStoredIds(`mm-dismissed-messages-${savedUser.id || ""}`),
  readReminderIds: readStoredIds(`mm-read-reminders-${savedUser.id || ""}`),
  dismissedReminderIds: readStoredIds(`mm-dismissed-reminders-${savedUser.id || ""}`),
  newMentorNotifications: readStoredIds(`mm-new-mentors-${savedUser.id || ""}`),
  readMentorNotificationIds: readStoredIds(`mm-read-mentors-${savedUser.id || ""}`),
  dismissedMentorNotificationIds: readStoredIds(`mm-dismissed-mentors-${savedUser.id || ""}`),
  reviews: Object.fromEntries(Object.entries(savedReviews)
    .filter(([mentorId]) => !legacyDemoIds.has(mentorId))
    .map(([mentorId, review]) => [mentorId, Array.isArray(review) ? review : [review]])),
  users: savedUsers.filter(user => !legacyDemoIds.has(user.id) && !legacyDemoEmails.has(user.email)).map(({ passwordSalt, passwordHash, ...user }) => user),
  adminAccounts: [],
  poll: null,
  adminPollResults: null,
  adminAppReviews: [],
  reports: savedReports.filter(report => report.title !== "Inappropriate message reported"),
  query: "",
  memberType: "all",
  mentorSort: "name"
};
let selectedProfileImage = state.user.profileImage || "";
let profileImageTask = Promise.resolve();
let profileImageSelectionVersion = 0;
let notificationOwnerId = "";
let knownMentorIds = null;
const viewContainer = document.getElementById("view-container");
const modalRoot = document.getElementById("modal-root");
const callRoot = document.getElementById("call-root");
let modalReturnFocus = null;
let callReturnFocus = null;
let callSession = null;
let callPeerConnection = null;
let callLocalStream = null;
let callRemoteStream = null;
let callPollInFlight = false;
let callAnswerAppliedId = "";
let callStatusText = "";
let callFailureNotified = false;
let toastTimeout;
let pollActiveMs = 0;
let pollLastTickAt = Date.now();
let pollLastActivityAt = 0;
let pollSnoozedUntilActivityMs = 0;
let pollStateLoaded = false;
let pollStateRequest = null;
let pollLastStateAttemptAt = 0;
const safe = (value) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function apiHeaders(json = false) {
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}
function initializeNotificationState() {
  const userId = String(state.user.id || "");
  if (!userId || notificationOwnerId === userId) return;
  notificationOwnerId = userId;
  state.notificationMessages = [];
  state.readMessageIds = readStoredIds(`mm-read-messages-${userId}`);
  state.dismissedMessageIds = readStoredIds(`mm-dismissed-messages-${userId}`);
  state.readReminderIds = readStoredIds(`mm-read-reminders-${userId}`);
  state.dismissedReminderIds = readStoredIds(`mm-dismissed-reminders-${userId}`);
  state.newMentorNotifications = readStoredIds(`mm-new-mentors-${userId}`);
  state.readMentorNotificationIds = readStoredIds(`mm-read-mentors-${userId}`);
  state.dismissedMentorNotificationIds = readStoredIds(`mm-dismissed-mentors-${userId}`);
  state.hiddenConversationPartnerIds = readStoredIds(`mm-hidden-conversations-${userId}`);
  knownMentorIds = readStore(`mm-known-mentors-${userId}`, null);
  if (!Array.isArray(knownMentorIds)) knownMentorIds = null;
}
function persistNotificationState() {
  if (!notificationOwnerId) return;
  try {
    localStorage.setItem(`mm-read-messages-${notificationOwnerId}`, JSON.stringify(state.readMessageIds));
    localStorage.setItem(`mm-dismissed-messages-${notificationOwnerId}`, JSON.stringify(state.dismissedMessageIds));
    localStorage.setItem(`mm-read-reminders-${notificationOwnerId}`, JSON.stringify(state.readReminderIds));
    localStorage.setItem(`mm-dismissed-reminders-${notificationOwnerId}`, JSON.stringify(state.dismissedReminderIds));
    localStorage.setItem(`mm-new-mentors-${notificationOwnerId}`, JSON.stringify(state.newMentorNotifications));
    localStorage.setItem(`mm-read-mentors-${notificationOwnerId}`, JSON.stringify(state.readMentorNotificationIds));
    localStorage.setItem(`mm-dismissed-mentors-${notificationOwnerId}`, JSON.stringify(state.dismissedMentorNotificationIds));
    localStorage.setItem(`mm-hidden-conversations-${notificationOwnerId}`, JSON.stringify(state.hiddenConversationPartnerIds));
    if (knownMentorIds) localStorage.setItem(`mm-known-mentors-${notificationOwnerId}`, JSON.stringify(knownMentorIds));
  } catch (error) {
    console.error("Unable to save notification state", error);
    logTestError("Notification state save", error);
  }
}
function interestTokens(member) {
  return new Set(`${member.interests || ""},${member.field || ""}`
    .split(/[;,]/)
    .map(interest => interest
      .toLocaleLowerCase()
      .replace(/[^a-z0-9+#. ]/g, " ")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean));
}
function matchingInterest(user, mentor) {
  const userInterests = interestTokens(user);
  return [...interestTokens(mentor)].find(token => userInterests.has(token)) || "";
}
function sharedInterestCount(user, member) {
  const userInterests = interestTokens(user);
  return [...interestTokens(member)].filter(token => userInterests.has(token)).length;
}
function updatePresence(isOnline = true) {
  if (!authToken || !state.user.id || (isOnline && (document.visibilityState === "hidden" || !navigator.onLine))) {
    return Promise.resolve();
  }
  const token = authToken;
  const userId = state.user.id;
  presenceSyncTask = presenceSyncTask.catch(() => {}).then(async () => {
    const response = await fetch("/api/presence", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ online: isOnline })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `Presence update failed (HTTP ${response.status}).`);
    if (state.user.id === userId) state.user.isOnline = Boolean(payload.isOnline);
  }).catch(error => {
    console.error("Unable to update online status", error);
    logTestError("Presence update", error);
  });
  return presenceSyncTask;
}
async function syncCommunityAccounts() {
  if (!authToken) return;
  initializeNotificationState();
  const reviewsVersion = reviewSyncVersion;
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
    state.users = [...byId.values()];
    const activeMentors = state.users.filter(user => user.role === "Mentor" && user.status === "Active" && user.id !== state.user.id);
    const currentMentorIds = activeMentors.map(user => user.id);
    if (knownMentorIds === null) {
      knownMentorIds = currentMentorIds;
    } else {
      const knownIds = new Set(knownMentorIds);
      const newMatches = activeMentors
        .filter(mentor => !knownIds.has(mentor.id) && matchingInterest(state.user, mentor))
        .map(mentor => mentor.id);
      state.newMentorNotifications = [...new Set([...state.newMentorNotifications, ...newMatches])].slice(-20);
      knownMentorIds = [...new Set([...knownMentorIds, ...newMatches])];
    }
    persistNotificationState();
    if (!reviewResponse.ok) throw new Error(`Review request failed (HTTP ${reviewResponse.status}).`);
    const reviewPayload = await readJsonResponse(reviewResponse);
    if (reviewsVersion === reviewSyncVersion) {
      state.reviews = (reviewPayload.reviews || []).reduce((grouped, review) => {
        if (!grouped[review.mentorId]) grouped[review.mentorId] = [];
        grouped[review.mentorId].push(review);
        return grouped;
      }, {});
    }
    if (JSON.stringify(state.users) !== previousUsers || JSON.stringify(state.reviews) !== previousReviews) {
      persist();
      if (state.view !== "messages") render();
    }
    updateNotificationMenu();
  } catch (error) {
    console.error("Unable to load shared community accounts", error);
    logTestError("Accounts sync", error);
  }
}
async function syncAdminAccounts() {
  const response = await fetch("/api/admin/accounts", { headers: apiHeaders() });
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new Error(payload.error || `Admin account request failed (HTTP ${response.status}).`);
  state.adminAccounts = payload.accounts || [];
}
async function syncAdminPollResults() {
  const response = await fetch("/api/admin/polls", { headers: apiHeaders() });
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new Error(payload.error || `Poll results request failed (HTTP ${response.status}).`);
  state.adminPollResults = payload;
}
async function syncAdminAppReviews() {
  const response = await fetch("/api/admin/app-reviews", { headers: apiHeaders() });
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new Error(payload.error || `App feedback request failed (HTTP ${response.status}).`);
  state.adminAppReviews = payload.reviews || [];
}
async function syncAdminDashboard() {
  await Promise.all([syncAdminAccounts(), syncAdminPollResults(), syncAdminAppReviews()]);
}
function resetPollTracker(userId) {
  const accountId = String(userId || "");
  pollActiveMs = 0;
  pollLastTickAt = Date.now();
  pollLastActivityAt = accountId ? Date.now() : 0;
  pollSnoozedUntilActivityMs = 0;
  pollStateLoaded = false;
  pollStateRequest = null;
  pollLastStateAttemptAt = 0;
  state.poll = null;
}
function syncPollState() {
  if (!authToken || !state.user.id) return Promise.resolve();
  const userId = state.user.id;
  const token = authToken;
  if (pollStateRequest?.userId === userId) return pollStateRequest.promise;
  pollLastStateAttemptAt = Date.now();
  const promise = (async () => {
    const response = await fetch("/api/poll", { headers: { Authorization: `Bearer ${token}` } });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `Poll status request failed (HTTP ${response.status}).`);
    if (state.user.id !== userId || authToken !== token) return;
    state.poll = { ...payload.poll, hasResponded: Boolean(payload.hasResponded) };
    pollStateLoaded = true;
  })();
  const request = { userId, promise };
  pollStateRequest = request;
  return promise.finally(() => {
    if (pollStateRequest === request) pollStateRequest = null;
  });
}
function recordPollActivity() {
  if (authToken && state.user.id && document.visibilityState === "visible") {
    accruePollActivity(Date.now());
    pollLastActivityAt = Date.now();
  }
}
function accruePollActivity(now) {
  const elapsed = now - pollLastTickAt;
  if (elapsed > 0 && authToken && state.user.id && document.visibilityState === "visible" &&
      navigator.onLine && now - pollLastActivityAt <= pollRecentActivityWindowMs) {
    pollActiveMs += elapsed;
  }
  pollLastTickAt = now;
}
function isInActiveConversation() {
  if (state.view !== "messages" || !state.activeConversationId) return false;
  return state.bookings.some(booking =>
    booking.id === state.activeConversationId && booking.status !== "Cancelled"
  );
}
function openExperiencePoll() {
  if (!state.poll || state.poll.hasResponded) return;
  const options = state.poll.options.map(option =>
    `<label class="poll-option"><input type="radio" name="choice" value="${safe(option)}" required><span>${safe(option)}</span></label>`
  ).join("");
  openModal("Quick poll", "Your feedback helps us improve MentorshipMatch.", `<form id="experience-poll-form" class="modal-form"><fieldset class="poll-fieldset"><legend>${safe(state.poll.question)}</legend>${options}</fieldset><div class="modal-actions"><button class="button-quiet" type="button" data-poll-dismiss>Not now</button><button class="button-primary" type="submit">Submit response</button></div></form>`);
}
function checkExperiencePoll() {
  const now = Date.now();
  accruePollActivity(now);
  if (!authToken || !state.user.id) return;
  if (!pollStateLoaded) {
    if (!pollStateRequest && now - pollLastStateAttemptAt >= 30000) {
      syncPollState().catch(error => {
        console.error("Unable to load poll status", error);
      });
    }
    return;
  }
  if (!state.poll || state.poll.hasResponded || pollActiveMs < pollAfterActivityMs ||
      pollActiveMs < pollSnoozedUntilActivityMs || callSession || callPeerConnection ||
      isInActiveConversation() || modalRoot.classList.contains("open")) {
    return;
  }
  openExperiencePoll();
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
      status: request.status,
      createdAt: request.createdAt,
      questionAnswers: Array.isArray(request.questionAnswers) ? request.questionAnswers : [],
      completedBy: Array.isArray(request.completedBy) ? request.completedBy : []
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
    updateNotificationMenu();
  } catch (error) {
    logTestError("Connections sync", error);
  }
}
function callStatusLabel() {
  if (callPeerConnection?.connectionState === "connected") return "Connected";
  if (callPeerConnection?.connectionState === "connecting") return "Connecting…";
  return callStatusText || "Connecting…";
}
function renderCallOverlay() {
  if (!callRoot) return;
  if (!callSession) {
    callRoot.innerHTML = "";
    if (callReturnFocus) {
      const returnFocus = callReturnFocus;
      callReturnFocus = null;
      setModalBackgroundHidden(false);
      if (returnFocus.isConnected) returnFocus.focus();
    }
    return;
  }
  const callDialogIsNew = !callRoot.querySelector('[role="dialog"]');
  const hadCallFocus = callRoot.contains(document.activeElement);
  const focusedCallAction = hadCallFocus
    ? ["data-call-decline", "data-call-accept", "data-call-mute", "data-call-video", "data-call-end"]
      .find(attribute => document.activeElement.hasAttribute(attribute))
    : "";
  if (callDialogIsNew) {
    callReturnFocus = document.activeElement;
    setModalBackgroundHidden(true);
  }
  const incoming = callSession.status === "ringing" && callSession.recipientId === state.user.id && !callPeerConnection;
  if (incoming) {
    callRoot.innerHTML = `<section class="call-card incoming-call" role="dialog" aria-modal="true" aria-labelledby="call-title"><span class="call-eyebrow">Incoming ${callSession.mode} call</span><h2 id="call-title">${safe(callSession.callerName)} is calling</h2><p>Answer this call from your connected conversation?</p><div class="call-actions"><button class="button-secondary" type="button" data-call-decline>Decline</button><button class="button-primary" type="button" data-call-accept>Answer</button></div></section>`;
    const focusTarget = callDialogIsNew ? callRoot.querySelector("[data-call-accept]") : focusedCallAction && callRoot.querySelector(`[${focusedCallAction}]`);
    focusTarget?.focus();
    return;
  }
  const videoCall = callSession.mode === "video";
  callRoot.innerHTML = `<section class="call-card active-call" role="dialog" aria-modal="true" aria-labelledby="call-title"><div class="call-header"><div><span class="call-eyebrow">${videoCall ? "Video" : "Audio"} call</span><h2 id="call-title">${safe(callSession.callerId === state.user.id ? callSession.recipientName || "Your connection" : callSession.callerName)}</h2></div><span class="call-status" aria-live="polite">${safe(callStatusLabel())}</span></div><div class="call-media ${videoCall ? "" : "audio-call"}"><video id="call-remote-video" autoplay muted playsinline ${videoCall ? "" : "hidden"}></video><audio id="call-remote-audio" autoplay></audio><div class="call-audio-placeholder" ${videoCall ? "hidden" : ""}>${safe((callSession.callerId === state.user.id ? callSession.recipientName : callSession.callerName) || "Connected")}</div><video id="call-local-video" autoplay muted playsinline ${videoCall ? "" : "hidden"}></video></div><div class="call-actions"><button class="button-secondary" type="button" data-call-mute aria-pressed="false">Mute</button>${videoCall ? `<button class="button-secondary" type="button" data-call-video aria-pressed="true">Turn camera off</button>` : ""}<button class="button-danger" type="button" data-call-end>End call</button></div></section>`;
  const localVideo = callRoot.querySelector("#call-local-video");
  const remoteVideo = callRoot.querySelector("#call-remote-video");
  const remoteAudio = callRoot.querySelector("#call-remote-audio");
  if (localVideo && callLocalStream) localVideo.srcObject = callLocalStream;
  if (remoteVideo && callRemoteStream) remoteVideo.srcObject = callRemoteStream;
  if (remoteAudio && callRemoteStream) remoteAudio.srcObject = callRemoteStream;
  const focusTarget = callDialogIsNew ? callRoot.querySelector("[data-call-mute]") : focusedCallAction && callRoot.querySelector(`[${focusedCallAction}]`);
  focusTarget?.focus();
}
async function callApi(action, details) {
  const response = await fetch("/api/calls", {
    method: "POST",
    headers: apiHeaders(true),
    body: JSON.stringify({ action, ...details })
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new Error(payload.error || `Call request failed (HTTP ${response.status}).`);
  return payload;
}
async function waitForIceGathering(peerConnection) {
  if (peerConnection.iceGatheringState === "complete") return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      peerConnection.removeEventListener("icegatheringstatechange", onGatheringStateChange);
      reject(new Error("Call setup timed out while connecting. Please try again."));
    }, 15000);
    function onGatheringStateChange() {
      if (peerConnection.iceGatheringState !== "complete") return;
      clearTimeout(timeout);
      peerConnection.removeEventListener("icegatheringstatechange", onGatheringStateChange);
      resolve();
    }
    peerConnection.addEventListener("icegatheringstatechange", onGatheringStateChange);
  });
}
async function prepareCallPeerConnection(mode) {
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
    throw new Error("Calls require a supported browser and a secure connection (HTTPS or localhost).");
  }
  callLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
  callRemoteStream = new MediaStream();
  callPeerConnection = new RTCPeerConnection({ iceServers: [] });
  for (const track of callLocalStream.getTracks()) callPeerConnection.addTrack(track, callLocalStream);
  callPeerConnection.ontrack = event => {
    for (const track of event.streams[0]?.getTracks() || [event.track]) {
      if (!callRemoteStream.getTracks().some(existing => existing.id === track.id)) callRemoteStream.addTrack(track);
    }
    renderCallOverlay();
  };
  callPeerConnection.onconnectionstatechange = () => {
    if (callPeerConnection?.connectionState === "connected") callStatusText = "Connected";
    else if (callPeerConnection?.connectionState === "connecting") callStatusText = "Connecting…";
    else if (callPeerConnection?.connectionState === "disconnected") callStatusText = "Reconnecting…";
    else if (callPeerConnection?.connectionState === "failed") {
      callStatusText = "Direct connection blocked. Try the same Wi-Fi network.";
      if (!callFailureNotified) {
        callFailureNotified = true;
        showToast("Your network blocked the direct call. Calls work without a relay when both devices allow a direct connection, such as on the same Wi-Fi.");
      }
    }
    renderCallOverlay();
  };
}
async function startCall(requestId, mode, button) {
  if (callSession || callPeerConnection) {
    showToast("Finish your current call before starting another.");
    return;
  }
  button.disabled = true;
  callStatusText = "Calling…";
  try {
    await prepareCallPeerConnection(mode);
    const offer = await callPeerConnection.createOffer();
    await callPeerConnection.setLocalDescription(offer);
    await waitForIceGathering(callPeerConnection);
    const payload = await callApi("start", {
      requestId,
      mode,
      offer: { type: callPeerConnection.localDescription.type, sdp: callPeerConnection.localDescription.sdp }
    });
    const connection = state.bookings.find(item => item.id === requestId);
    const recipient = state.user.role === "Mentor"
      ? state.users.find(user => user.id === connection?.requesterId)
      : state.users.find(user => user.id === connection?.mentorId);
    callSession = { ...payload.call, recipientName: payload.call.recipientName || recipient?.name || "Your connection" };
    renderCallOverlay();
  } catch (error) {
    console.error("Unable to start call", error);
    logTestError("Call start", error);
    await clearCallState();
    showToast(error.message || "The call could not be started.");
  } finally {
    button.disabled = false;
  }
}
async function acceptCall(button) {
  if (!callSession || callSession.recipientId !== state.user.id || callPeerConnection) return;
  const call = callSession;
  button.disabled = true;
  callStatusText = "Joining…";
  try {
    await prepareCallPeerConnection(call.mode);
    await callPeerConnection.setRemoteDescription(call.offer);
    const answer = await callPeerConnection.createAnswer();
    await callPeerConnection.setLocalDescription(answer);
    await waitForIceGathering(callPeerConnection);
    const payload = await callApi("answer", {
      requestId: call.requestId,
      callId: call.id,
      answer: { type: callPeerConnection.localDescription.type, sdp: callPeerConnection.localDescription.sdp }
    });
    callSession = payload.call;
    callStatusText = "Connecting…";
    renderCallOverlay();
  } catch (error) {
    console.error("Unable to answer call", error);
    logTestError("Call answer", error);
    await clearCallState();
    showToast(error.message || "The call could not be answered.");
    try { await callApi("end", { requestId: call.requestId, callId: call.id }); } catch (endError) {
      console.error("Unable to end unanswered call", endError);
    }
  }
}
async function clearCallState() {
  if (callPeerConnection) {
    callPeerConnection.ontrack = null;
    callPeerConnection.onconnectionstatechange = null;
    callPeerConnection.close();
  }
  for (const track of callLocalStream?.getTracks() || []) track.stop();
  callSession = null;
  callPeerConnection = null;
  callLocalStream = null;
  callRemoteStream = null;
  callAnswerAppliedId = "";
  callStatusText = "";
  callFailureNotified = false;
  renderCallOverlay();
}
async function finishCall(notifyServer = true, showMessage = false) {
  const endedCall = callSession;
  if (!endedCall) return;
  try {
    if (notifyServer) await callApi("end", { requestId: endedCall.requestId, callId: endedCall.id });
  } catch (error) {
    console.error("Unable to end call", error);
    logTestError("Call end", error);
    if (notifyServer) showToast(error.message || "The call could not be ended.");
  } finally {
    await clearCallState();
    if (showMessage) showToast("Call ended.");
  }
}
async function syncCalls() {
  if (!authToken || !state.user.id || callPollInFlight || !navigator.onLine || (!callSession && callPeerConnection)) return;
  callPollInFlight = true;
  try {
    const response = await fetch("/api/calls", { headers: apiHeaders() });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `Call sync failed (HTTP ${response.status}).`);
    const calls = Array.isArray(payload.calls) ? payload.calls : [];
    if (callSession) {
      const current = calls.find(call => call.id === callSession.id);
      if (!current) {
        await finishCall(false, true);
      } else if (current.status === "ended") {
        const endedByOther = current.endedBy && current.endedBy !== state.user.id;
        await finishCall(false, endedByOther);
      } else {
        const changed = current.status !== callSession.status ||
          current.updatedAt !== callSession.updatedAt ||
          current.answer?.sdp !== callSession.answer?.sdp;
        callSession = { ...current, recipientName: callSession.recipientName || current.recipientName };
        if (callSession.callerId === state.user.id && current.answer && callAnswerAppliedId !== current.id && callPeerConnection) {
          if (!callPeerConnection.remoteDescription) await callPeerConnection.setRemoteDescription(current.answer);
          const connected = await callApi("connected", { requestId: current.requestId, callId: current.id });
          callSession = { ...connected.call, recipientName: callSession.recipientName };
          callAnswerAppliedId = current.id;
          callStatusText = "Connecting…";
        }
        if (changed) renderCallOverlay();
      }
    } else {
      const incoming = calls.find(call => call.status === "ringing" && call.recipientId === state.user.id);
      if (incoming) {
        callSession = incoming;
        state.activeConversationId = incoming.requestId;
        callStatusText = "Incoming call";
        renderCallOverlay();
      }
    }
  } catch (error) {
    console.error("Unable to sync calls", error);
    logTestError("Call sync", error);
  } finally {
    callPollInFlight = false;
  }
}
async function syncConversation(requestId) {
  if (!requestId || !state.user.id) return;
  requestId = canonicalConversationBooking(requestId)?.id || requestId;
  if (messageSyncInFlight.has(requestId)) return messageSyncInFlight.get(requestId);
  const version = messageSyncVersions.get(requestId) || 0;
  const syncPromise = (async () => {
    try {
      const historyKey = `${state.user.id}:${requestId}`;
      const relatedRequestIds = conversationBookings(requestId).map(booking => booking.id);
      const requestIds = [
        requestId,
        ...relatedRequestIds.filter(id => id !== requestId && !conversationHistorySyncs.has(`${historyKey}:${id}`))
      ];
      const payloads = await Promise.all(requestIds.map(async relatedRequestId => {
        const url = `/api/messages?requestId=${encodeURIComponent(relatedRequestId)}&userId=${encodeURIComponent(state.user.id)}`;
        const response = await fetch(url, { headers: apiHeaders() });
        const payload = await readJsonResponse(response);
        if (!response.ok) throw new Error(payload.error || `Message request failed (HTTP ${response.status}).`);
        return { requestId: relatedRequestId, messages: payload.messages || [] };
      }));
      if (version !== (messageSyncVersions.get(requestId) || 0)) return;
      const merged = new Map((state.messages[requestId] || []).map(message => [message.id, message]));
      for (const payload of payloads) {
        for (const message of payload.messages) merged.set(message.id, message);
        if (payload.requestId !== requestId) conversationHistorySyncs.add(`${historyKey}:${payload.requestId}`);
      }
      state.messages[requestId] = [...merged.values()].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      );
      if (state.view === "messages" &&
          (canonicalConversationBooking(state.activeConversationId)?.id || state.activeConversationId) === requestId) {
        markConversationMessagesRead(requestId);
        const list = document.getElementById("message-list");
        if (list) {
          list.innerHTML = state.messages[requestId].length
            ? state.messages[requestId].map(messageMarkup).join("")
            : `<div class="empty-state"><strong>Start the conversation.</strong>Say hello or share a question.</div>`;
          list.scrollTop = list.scrollHeight;
        }
      }
    } catch (error) {
      console.error("Unable to load messages", error);
      logTestError("Messages sync", error);
    }
  })();
  messageSyncInFlight.set(requestId, syncPromise);
  try {
    await syncPromise;
  } finally {
    if (messageSyncInFlight.get(requestId) === syncPromise) messageSyncInFlight.delete(requestId);
    if (version !== (messageSyncVersions.get(requestId) || 0) &&
      state.view === "messages" &&
      (canonicalConversationBooking(state.activeConversationId)?.id || state.activeConversationId) === requestId) {
      syncConversation(requestId);
    }
  }
}
function markConversationMessagesRead(requestId) {
  const readIds = new Set(state.readMessageIds);
  for (const message of state.messages[requestId] || []) {
    if (message.senderId !== state.user.id) readIds.add(message.id);
  }
  state.readMessageIds = [...readIds].slice(-500);
  persistNotificationState();
  updateNotificationMenu();
}
async function syncNotifications() {
  if (!authToken || !state.user.id) return;
  initializeNotificationState();
  try {
    const response = await fetch("/api/notifications", { headers: apiHeaders() });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `Notification request failed (HTTP ${response.status}).`);
    state.notificationMessages = payload.messages || [];
    updateNotificationMenu();
  } catch (error) {
    console.error("Unable to load notifications", error);
    logTestError("Notifications sync", error);
  }
}
function notificationTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
function sessionReminderItems() {
  const now = Date.now();
  const dismissed = new Set(state.dismissedReminderIds);
  const offsets = [
    { type: "day", offset: 24 * 60 * 60 * 1000, title: "Session is tomorrow" },
    { type: "hour", offset: 60 * 60 * 1000, title: "Session starts in an hour" }
  ];
  return state.bookings.flatMap(booking => {
    if (["Cancelled", "Completed"].includes(booking.status)) return [];
    const startsAt = new Date(`${booking.date}T${booking.time}`).getTime();
    if (!Number.isFinite(startsAt) || startsAt <= now) return [];
    const createdAt = Date.parse(booking.createdAt || "");
    return offsets.flatMap(reminder => {
      const id = `${booking.id}:${reminder.type}`;
      const reminderAt = startsAt - reminder.offset;
      if (reminderAt > now || (Number.isFinite(createdAt) && createdAt > reminderAt) || dismissed.has(id)) return [];
      return [{
        id,
        type: reminder.type,
        title: reminder.title,
        bookingId: booking.id,
        startsAt,
        person: state.user.role === "Mentor"
          ? booking.requesterName || booking.requesterEmail || "your student"
          : booking.mentorName || "your mentor",
        topic: booking.topic || "Mentorship session"
      }];
    });
  }).sort((left, right) => left.startsAt - right.startsAt);
}
function updateNotificationMenu() {
  const menu = document.getElementById("notification-menu");
  const indicator = document.getElementById("notification-indicator");
  if (!menu || !indicator) return;
  const readMessages = new Set(state.readMessageIds);
  const readReminders = new Set(state.readReminderIds);
  const dismissedMessages = new Set(state.dismissedMessageIds);
  const readMentors = new Set(state.readMentorNotificationIds);
  const dismissedMentors = new Set(state.dismissedMentorNotificationIds);
  const messageItems = [...state.notificationMessages]
    .filter(message => !dismissedMessages.has(message.id))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, 8);
  const mentorItems = state.newMentorNotifications
    .filter(id => !dismissedMentors.has(id))
    .map(id => state.users.find(user => user.id === id && user.role === "Mentor" && user.status === "Active"))
    .filter(Boolean)
    .slice(-8)
    .reverse();
  const reminderItems = sessionReminderItems();
  const unreadCount = messageItems.filter(message => !readMessages.has(message.id)).length +
    mentorItems.filter(mentor => !readMentors.has(mentor.id)).length +
    reminderItems.filter(reminder => !readReminders.has(reminder.id)).length;
  document.getElementById("notifications")?.setAttribute("aria-label", unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications");
  indicator.hidden = unreadCount === 0;
  const contents = `<header class="notification-menu-header"><div><h2>Notifications</h2><p>Messages, session reminders, and mentors matched to your interests.</p></div></header>
    <section class="notification-section"><h3>Session reminders</h3>${reminderItems.length ? reminderItems.map(reminder => `<div class="notification-item ${readReminders.has(reminder.id) ? "read" : "unread"}"><button type="button" class="notification-item-open" data-notification-session="${safe(reminder.bookingId)}"><span class="notification-item-copy"><strong>${safe(reminder.title)}</strong><span>${safe(reminder.person)} · ${safe(reminder.topic)}</span><small>${safe(notificationTime(reminder.startsAt))}</small></span></button><button type="button" class="notification-dismiss" data-dismiss-notification="reminder" data-notification-id="${safe(reminder.id)}" aria-label="Dismiss ${safe(reminder.title.toLowerCase())} for ${safe(reminder.person)}">×</button></div>`).join("") : `<p class="notification-empty">No upcoming session reminders.</p>`}</section>
    <section class="notification-section"><h3>Messages</h3>${messageItems.length ? messageItems.map(message => `<div class="notification-item ${readMessages.has(message.id) ? "read" : "unread"}"><button type="button" class="notification-item-open" data-notification-message="${safe(message.requestId)}"><span class="notification-item-copy"><strong>${safe(message.senderName || "New message")}</strong><span>${safe(String(message.text || "").slice(0, 120))}</span><small>${safe(notificationTime(message.createdAt))}</small></span></button><button type="button" class="notification-dismiss" data-dismiss-notification="message" data-notification-id="${safe(message.id)}" aria-label="Dismiss message notification from ${safe(message.senderName || "New message")}">×</button></div>`).join("") : `<p class="notification-empty">No new messages.</p>`}</section>
    <section class="notification-section"><h3>New mentors for you</h3>${mentorItems.length ? mentorItems.map(mentor => `<div class="notification-item ${readMentors.has(mentor.id) ? "read" : "unread"}"><button type="button" class="notification-item-open" data-notification-mentor="${safe(mentor.id)}"><span class="notification-item-copy"><strong>${safe(mentor.name)} joined</strong><span>Shares your interest in ${safe(matchingInterest(state.user, mentor) || mentor.field || mentor.interests || "your interests")}.</span><small>${safe(notificationTime(mentor.createdAt))}</small></span></button><button type="button" class="notification-dismiss" data-dismiss-notification="mentor" data-notification-id="${safe(mentor.id)}" aria-label="Dismiss mentor notification for ${safe(mentor.name)}">×</button></div>`).join("") : `<p class="notification-empty">We’ll let you know when a new mentor shares your interests.</p>`}</section>`;
  if (menu.innerHTML !== contents) menu.innerHTML = contents;
}
function dismissNotification(type, id) {
  if (!id) return;
  if (type === "message") {
    state.dismissedMessageIds = [...new Set([...state.dismissedMessageIds, id])].slice(-500);
  } else if (type === "mentor") {
    state.dismissedMentorNotificationIds = [...new Set([...state.dismissedMentorNotificationIds, id])].slice(-100);
  } else if (type === "reminder") {
    state.dismissedReminderIds = [...new Set([...state.dismissedReminderIds, id])].slice(-500);
  } else {
    return;
  }
  persistNotificationState();
  updateNotificationMenu();
}
function toggleNotificationMenu() {
  const button = document.getElementById("notifications");
  const menu = document.getElementById("notification-menu");
  if (!button || !menu) return;
  const open = menu.hidden;
  if (open) {
    state.readMessageIds = [...new Set([...state.readMessageIds, ...state.notificationMessages.map(message => message.id)])].slice(-500);
    state.readMentorNotificationIds = [...new Set([...state.readMentorNotificationIds, ...state.newMentorNotifications])].slice(-100);
    state.readReminderIds = [...new Set([...state.readReminderIds, ...sessionReminderItems().map(reminder => reminder.id)])].slice(-500);
    persistNotificationState();
  }
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  updateNotificationMenu();
}
function closeNotificationMenu() {
  const button = document.getElementById("notifications");
  const menu = document.getElementById("notification-menu");
  if (!button || !menu) return;
  menu.hidden = true;
  button.setAttribute("aria-expanded", "false");
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
function saveRecentAccounts() {
  try {
    localStorage.setItem("mm-recent-accounts", JSON.stringify(recentAccounts));
  } catch (error) {
    console.error("Unable to save recently used accounts", error);
    showToast("Recently used accounts could not be saved in this browser.");
  }
}
function rememberRecentAccount(user, token) {
  if (!user?.id || !user.email || !token) return;
  recentAccounts = [
    { id: user.id, user: { ...user }, token, lastUsedAt: Date.now() },
    ...recentAccounts.filter(account => account.id !== user.id)
  ].slice(0, 5);
  saveRecentAccounts();
}
function removeRecentAccount(userId) {
  recentAccounts = recentAccounts.filter(account => account.id !== userId);
  saveRecentAccounts();
}
if (savedUser.id && savedUser.email && savedToken && !recentAccounts.some(account => account.id === savedUser.id)) {
  rememberRecentAccount(savedUser, savedToken);
}
function initials(name) { return String(name || "YN").split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase(); }
function avatarContent(name, image) {
  return image ? `<img src="${safe(image)}" alt="" />` : initials(name);
}
function resizeProfileImage(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return Promise.reject(new Error("Choose a JPG, PNG, or WebP image."));
  }
  if (file.size > 8 * 1024 * 1024) {
    return Promise.reject(new Error("Choose an image smaller than 8 MB."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("The selected image could not be opened."));
      image.onload = () => {
        if (image.naturalWidth * image.naturalHeight > 40000000) {
          reject(new Error("Choose an image with fewer than 40 megapixels."));
          return;
        }
        const canvas = document.createElement("canvas");
        const size = 256;
        canvas.width = size;
        canvas.height = size;
        const crop = Math.min(image.naturalWidth, image.naturalHeight);
        const x = (image.naturalWidth - crop) / 2;
        const y = (image.naturalHeight - crop) / 2;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Your browser could not process the selected image."));
          return;
        }
        context.drawImage(image, x, y, crop, crop, 0, 0, size, size);
        for (const quality of [0.82, 0.72, 0.62, 0.52]) {
          const resized = canvas.toDataURL("image/jpeg", quality);
          if (resized.length <= 190 * 1024) {
            resolve(resized);
            return;
          }
        }
        reject(new Error("That image could not be resized small enough. Try another image."));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function updateShell() {
  document.getElementById("topbar-name").textContent = state.user.name;
  document.querySelector(".topbar-user .avatar").innerHTML = avatarContent(state.user.name, state.user.profileImage);
  document.getElementById("session-count").textContent = state.bookings.filter(item => item.status !== "Completed" && item.status !== "Cancelled").length;
  const accountRole = document.getElementById("account-role");
  if (accountRole) accountRole.textContent = state.user.isAdmin ? "Administrator" : `${state.user.role || "Student"} account`;
  const adminLink = document.getElementById("admin-nav-link");
  if (adminLink) adminLink.hidden = !state.user.isAdmin;
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
function chatAttachmentType(file) {
  const declaredType = file.type.toLocaleLowerCase();
  if (allowedChatAttachmentTypes.has(declaredType)) return declaredType;
  const extension = file.name.split(".").pop().toLocaleLowerCase();
  return chatAttachmentExtensions[extension] || "";
}
function readChatAttachment(file) {
  if (!file || !chatAttachmentType(file)) {
    return Promise.reject(new Error("Choose a PDF, Office document, image, CSV, or text file."));
  }
  if (file.size === 0 || file.size > maxChatAttachmentBytes) {
    return Promise.reject(new Error("Choose a file up to 3 MB."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected file could not be read."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const data = result.slice(result.indexOf(",") + 1);
      if (!data) {
        reject(new Error("The selected file could not be read."));
        return;
      }
      resolve({ name: file.name, type: chatAttachmentType(file), size: file.size, data });
    };
    reader.readAsDataURL(file);
  });
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
function conversationPartnerId(booking) {
  if (!booking) return "";
  if (state.user.role !== "Mentor") return booking.mentorId || "";
  return booking.requesterId ||
    state.users.find(user => normalizeEmail(user.email) === normalizeEmail(booking.requesterEmail))?.id ||
    (booking.requesterEmail ? `email:${normalizeEmail(booking.requesterEmail)}` : "");
}
function conversationBookings(requestId) {
  const booking = state.bookings.find(item => item.id === requestId && item.status !== "Cancelled");
  if (!booking) return [];
  const partnerId = conversationPartnerId(booking);
  if (!partnerId) return [booking];
  return state.bookings.filter(item =>
    item.status !== "Cancelled" && conversationPartnerId(item) === partnerId
  );
}
function canonicalConversationBooking(requestId) {
  return conversationBookings(requestId).sort((left, right) =>
    String(left.createdAt || left.id).localeCompare(String(right.createdAt || right.id)) ||
    left.id.localeCompare(right.id)
  )[0];
}
function uniqueConversations() {
  const groups = new Map();
  for (const booking of state.bookings.filter(item => item.status !== "Cancelled")) {
    const partnerId = conversationPartnerId(booking) || `request:${booking.id}`;
    const current = groups.get(partnerId);
    if (!current || String(booking.createdAt || booking.id).localeCompare(String(current.createdAt || current.id)) < 0) {
      groups.set(partnerId, booking);
    }
  }
  return [...groups.entries()].map(([partnerId, booking]) => ({ partnerId, booking }));
}
function matchesMemberSearch(member, query) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const profile = [
    member.name,
    member.role,
    member.field,
    member.interests,
    member.goal,
    member.school,
    member.year
  ].join(" ").toLocaleLowerCase();
  return terms.some(term => profile.includes(term));
}
function presenceMarkup(member) {
  const isOnline = Boolean(member?.isOnline);
  return `<span class="presence-status ${isOnline ? "online" : "offline"}" aria-label="${isOnline ? "Online" : "Offline"}"><span class="presence-indicator"></span>${isOnline ? "Online" : "Offline"}</span>`;
}
function mentorCard(mentor) {
  const isMentor = mentor.role === "Mentor";
  const canRequestChat = state.user.role === "Student" && isMentor;
  const connected = Boolean(connectionFor(mentor.id));
  return `<article class="mentor-card">
    <div class="card-top"><div class="mentor-avatar ${isMentor ? "avatar-blue" : "avatar-you"}">${avatarContent(mentor.name, mentor.profileImage)}</div></div>
    <h3>${safe(mentor.name)}</h3><p class="mentor-role"><strong>${safe(mentor.role)}</strong>${mentor.field ? ` · ${safe(mentor.field)}` : ""}</p>
    <div class="mentor-meta"><span>${isMentor ? "Mentor profile" : "Student profile"}</span>${presenceMarkup(mentor)}</div>
    <p class="mentor-bio">${safe(mentor.goal || mentor.bio || mentor.interests || "This member has shared their profile and preferences.")}</p><div class="tag-list"><span class="tag">${safe(mentor.field || (mentor.interests || "Community member").split(",")[0])}</span></div>
    <div class="card-footer"><button class="button-quiet" data-profile="${safe(mentor.id)}">View profile</button>${connected || canRequestChat ? `<div class="card-footer-actions">${connected ? `<button class="button-secondary" data-message="${safe(connectionFor(mentor.id).id)}">Message</button>` : ""}${canRequestChat ? `<button class="button-primary" data-book="${safe(mentor.id)}">${connected ? "Schedule" : "Schedule a session"} <span>↗</span></button>` : ""}</div>` : ""}</div>
  </article>`;
}
function renderDiscover() {
  const activeMembers = state.users.filter(user => user.status === "Active" && user.id !== state.user.id);
  const matches = activeMembers.filter(member =>
    (state.memberType === "all" || member.role === state.memberType) &&
    matchesMemberSearch(member, state.query)
  );
  matches.sort((left, right) => {
    if (state.mentorSort === "name") return left.name.localeCompare(right.name);
    if (state.mentorSort === "newest") return String(right.createdAt || "").localeCompare(String(left.createdAt || "")) || left.name.localeCompare(right.name);
    if (state.mentorSort === "online") return Number(Boolean(right.isOnline)) - Number(Boolean(left.isOnline)) || left.name.localeCompare(right.name);
    if (state.mentorSort === "interest") {
      const leftInterests = String(left.interests || left.field || "").toLocaleLowerCase();
      const rightInterests = String(right.interests || right.field || "").toLocaleLowerCase();
      return leftInterests.localeCompare(rightInterests) || left.name.localeCompare(right.name);
    }
    const leftMatch = sharedInterestCount(state.user, left);
    const rightMatch = sharedInterestCount(state.user, right);
    return rightMatch - leftMatch || left.name.localeCompare(right.name);
  });
  return `<div class="view-wrap">
    <section class="hero"><div><div class="eyebrow">A little guidance goes a long way</div><h1>Your future has a friend in it.</h1><p>Meet students and mentors, explore their interests, and connect when you're ready.</p></div><div class="hero-side"><div class="match-pill">✳ &nbsp;<b>${activeMembers.length} members</b> available</div></div></section>
    <section class="featured-banner"><div class="banner-copy"><span class="banner-tag"><span></span> Your next chapter starts here</span><h2>Big dreams. Real people in your corner.</h2><p>A 20-minute conversation could help you see your next step a little more clearly.</p><button class="button-primary" data-scroll-mentors>Explore your matches <span>↓</span></button></div>
      <div class="banner-art" aria-hidden="true"><div class="floating-card one"><strong>Good things grow here</strong>Curiosity is a great place to start.</div><div class="mentor-illustration"><div class="person-head"></div><div class="person-hair"></div><div class="person-body"></div><div class="person-shirt"></div></div><div class="floating-card two"><span class="tiny-avatar">✳</span><span>New connections,<br>new possibilities</span></div></div>
    </section>
    <section id="mentor-section"><div class="section-heading"><div><h2>Community members</h2><p>Explore member profiles and see what they're interested in.</p></div><button class="button-quiet" data-view="sessions">Your sessions <span>→</span></button></div>
      <div class="filter-row"><label class="search-field"><span aria-hidden="true">⌕</span><input id="mentor-search" type="search" placeholder="Search community members by skill, interest, goal, or phrase..." value="${safe(state.query)}" aria-label="Search community members by any profile detail"></label><label class="sort-control"><span>Show</span><select id="community-role" class="filter-select" aria-label="Filter community members by role"><option value="all" ${state.memberType === "all" ? "selected" : ""}>Everyone</option><option value="Mentor" ${state.memberType === "Mentor" ? "selected" : ""}>Mentors</option><option value="Student" ${state.memberType === "Student" ? "selected" : ""}>Students</option></select></label><label class="sort-control"><span>Sort by</span><select id="mentor-sort" class="filter-select" aria-label="Sort community members"><option value="recommended" ${state.mentorSort === "recommended" ? "selected" : ""}>Recommended</option><option value="name" ${state.mentorSort === "name" ? "selected" : ""}>Name A–Z</option><option value="interest" ${state.mentorSort === "interest" ? "selected" : ""}>Academic interest A–Z</option><option value="newest" ${state.mentorSort === "newest" ? "selected" : ""}>Newest</option><option value="online" ${state.mentorSort === "online" ? "selected" : ""}>Online first</option></select></label>
        <span class="result-count">${matches.length} member${matches.length === 1 ? "" : "s"}</span></div>
      <div class="mentor-grid">${matches.length ? matches.map(mentorCard).join("") : `<div class="empty-state"><strong>${state.query || state.memberType !== "all" ? `No ${state.memberType === "all" ? "matching" : state.memberType.toLocaleLowerCase()} members found.` : "No community profiles yet."}</strong>${state.query || state.memberType !== "all" ? "Try changing the search or role filter." : "Member profiles will appear here once they join the community."}</div>`}</div>
    </section></div>`;
}
function canReviewMentor(mentorId) {
  const userEmail = normalizeEmail(state.user.email);
  return state.user.role === "Student" && state.bookings.some(booking =>
    booking.mentorId === mentorId &&
    booking.status === "Completed" &&
    (booking.requesterId === state.user.id || (userEmail && normalizeEmail(booking.requesterEmail) === userEmail))
  );
}
function renderSessionActions(booking, hasMarkedComplete) {
  if (booking.status === "Completed") {
    if (canReviewMentor(booking.mentorId)) {
      const hasReviewed = reviewsFor(booking.mentorId).some(review =>
        review.reviewerId === state.user.id || review.reviewerEmail === state.user.email
      );
      return `<button class="button-secondary" data-review="${safe(booking.mentorId)}">${hasReviewed ? "Review shared ✓" : "Leave a review"}</button>`;
    }
    return `<span class="muted-copy">Completed</span>`;
  }
  const completionAction = hasMarkedComplete
    ? `<span class="muted-copy">Waiting for other participant</span>`
    : `<button class="button-secondary" data-complete="${safe(booking.id)}">Mark complete</button>`;
  return `${completionAction}<button class="button-quiet" data-cancel="${safe(booking.id)}">Cancel</button>`;
}
function renderSessions() {
  const bookings = state.bookings.filter(item => item.status !== "Cancelled").sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const next = bookings.filter(item => item.status !== "Completed").length;
  return `<div class="view-wrap"><div class="content-header"><div><div class="eyebrow">Your time, your pace</div><h1>My sessions</h1><p>Every good conversation starts with showing up.</p></div><button class="button-primary" data-view="discover">+ Find a mentor</button></div>
    <div class="stats-row"><div class="stat-card"><span class="stat-label">Upcoming sessions</span><div class="stat-value">${next}</div><span class="stat-foot">On your calendar</span></div><div class="stat-card"><span class="stat-label">People you've met</span><div class="stat-value">${new Set(bookings.map(item => item.mentorId)).size}</div><span class="stat-foot">Connections made</span></div><div class="stat-card"><span class="stat-label">Reviews shared</span><div class="stat-value">${Object.values(state.reviews).reduce((total, items) => total + (Array.isArray(items) ? items.length : 1), 0)}</div><span class="stat-foot">Paying it forward</span></div></div>
    <section class="panel"><div class="panel-heading"><div><h2>Your conversations</h2><p>Manage requests and reflect on past sessions.</p></div></div><div class="panel-body">${bookings.length ? `<div class="session-list">${bookings.map(booking => {
      const date = new Date(`${booking.date}T12:00:00`);
      const statusClass = booking.status === "Pending" ? "pending" : booking.status === "Completed" ? "completed" : "";
      const hasMarkedComplete = Array.isArray(booking.completedBy) && booking.completedBy.includes(state.user.id);
      const statusLabel = booking.status === "Completed" ? "Completed" : hasMarkedComplete ? "Waiting for other participant" : booking.status;
      const hasStudentAnswers = state.user.role === "Mentor" && booking.mentorId === state.user.id &&
        Array.isArray(booking.questionAnswers) && booking.questionAnswers.length > 0;
      const conversationName = state.user.role === "Mentor"
        ? (booking.requesterName || booking.requesterEmail)
        : (booking.mentorName || "Mentor");
      const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(booking.time);
      const displayTime = time
        ? `${Number(time[1]) % 12 || 12}:${time[2]} ${Number(time[1]) < 12 ? "AM" : "PM"}`
        : booking.time;
      return `<article class="session-card"><div class="session-date"><b>${date.getDate()}</b><small>${date.toLocaleString("en-US", { month: "short" })}</small></div><div class="session-info"><strong>${safe(conversationName)} · ${safe(booking.topic)}</strong><p>${date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} at ${safe(displayTime)} · ${safe(booking.format)}</p>${state.user.role === "Mentor" && booking.requesterGoal ? `<p>Student about me: ${safe(booking.requesterGoal)}</p>` : ""}</div><span class="status-badge ${statusClass}">${statusLabel}</span><div class="session-actions">${renderSessionActions(booking, hasMarkedComplete)}${hasStudentAnswers ? `<button class="button-quiet" data-view-booking-answers="${safe(booking.id)}">View student answers</button>` : ""}<button class="button-quiet" data-message="${safe(booking.id)}">Message</button><button class="button-danger" data-delete-session="${safe(booking.id)}">Delete</button></div></article>`;
    }).join("")}</div>` : `<div class="empty-state"><strong>Your calendar has room for a great conversation.</strong>Find a mentor and book your first session.<br><button class="button-primary" style="margin-top:15px" data-view="discover">Browse mentors</button></div>`}</div></section></div>`;
}
function renderProfileInterestOptions(interests) {
  const selectedValues = (Array.isArray(interests) ? interests : String(interests || "").split(","))
    .map(value => value.trim())
    .filter(Boolean);
  const selectedSet = new Set(selectedValues.map(value => value.toLocaleLowerCase()));
  const knownValues = new Set(profileInterestOptions.map(value => value.toLocaleLowerCase()));
  const legacyOptions = selectedValues.filter(value => !knownValues.has(value.toLocaleLowerCase()));
  const options = [
    ...profileInterestOptions.map(value => ({ value, selected: selectedSet.has(value.toLocaleLowerCase()) })),
    ...legacyOptions.map(value => ({ value, selected: true }))
  ];
  if (!options.length) return `<option disabled>No matching interests</option>`;
  return options.map(option => `<option value="${safe(option.value)}" ${option.selected ? "disabled" : ""}>${safe(option.value)}${option.selected ? " (already added)" : ""}</option>`).join("");
}
function renderSelectedProfileInterestOptions(interests) {
  const selectedValues = Array.isArray(interests) ? interests : String(interests || "").split(",");
  return selectedValues.map(value => value.trim()).filter(Boolean)
    .map(value => `<option value="${safe(value)}" selected>${safe(value)}</option>`).join("");
}
function normalizedBookingQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.slice(0, 10)
    .map(question => ({
      text: String(question?.text || "").trim().slice(0, 250),
      required: question?.required !== false
    }))
    .filter(question => question.text);
}
function bookingQuestionRowsMarkup(questions) {
  return questions.map((question, index) => `<div class="field booking-question-row" data-booking-question-row>
    <label for="booking-question-text-${index}">Question ${index + 1}</label>
    <input id="booking-question-text-${index}" type="text" maxlength="250" required value="${safe(question.text)}" placeholder="What would you like to ask?">
    <div class="booking-question-controls"><label><input type="checkbox" data-booking-question-required ${question.required ? "checked" : ""}> Required</label><button class="button-quiet" type="button" data-remove-booking-question="${index}" aria-label="Remove question ${index + 1}" ${questions.length <= 1 ? "disabled" : ""}>Remove</button></div>
  </div>`).join("");
}
function updateBookingQuestionRows(form, questions, focusIndex = -1) {
  form.querySelector(".booking-question-editor-list").innerHTML = bookingQuestionRowsMarkup(questions);
  form.querySelector("[data-booking-question-count]").textContent = `${questions.length} of 10 questions`;
  form.querySelector("[data-add-booking-question]").disabled = questions.length >= 10;
  if (focusIndex >= 0) form.querySelector(`#booking-question-text-${focusIndex}`)?.focus();
}
function readBookingQuestionRows(form) {
  return [...form.querySelectorAll("[data-booking-question-row]")].map(row => ({
    text: row.querySelector("input[type=text]").value.trim(),
    required: row.querySelector("[data-booking-question-required]").checked
  }));
}
function openBookingQuestionsEditor() {
  const savedQuestions = normalizedBookingQuestions(JSON.parse(document.getElementById("booking-questions-data").value || "[]"));
  const questions = savedQuestions.length ? savedQuestions : [{ text: "", required: true }];
  openModal("Questions for students", "Students will answer these when requesting a session. Choose which answers are required.", `<form class="modal-form" id="booking-questions-form">
    <p class="muted-copy">Questions are saved with your profile when you select Save changes.</p>
    <div class="booking-question-editor-list">${bookingQuestionRowsMarkup(questions)}</div>
    <div class="booking-question-editor-footer"><span class="muted-copy" data-booking-question-count>${questions.length} of 10 questions</span><button class="button-secondary" type="button" data-add-booking-question>Add a question</button></div>
    <div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Cancel</button><button class="button-primary" type="submit">Save questions</button></div>
  </form>`);
}
function renderSelectedProfileInterestChips(interests) {
  const selectedValues = Array.isArray(interests) ? interests : String(interests || "").split(",");
  const values = selectedValues.map(value => value.trim()).filter(Boolean);
  if (!values.length) return `<span class="profile-interest-empty" role="listitem">No interests selected yet.</span>`;
  return values.map(value => `<span class="profile-interest-chip" role="listitem">${safe(value)}<button type="button" data-remove-profile-interest="${safe(value)}" aria-label="Remove ${safe(value)}">×</button></span>`).join("");
}
function selectedProfileInterests() {
  const select = document.getElementById("profile-interests");
  return [...select.selectedOptions].map(option => option.value);
}
function updateProfileInterestControls(interests) {
  const hiddenSelect = document.getElementById("profile-interests");
  hiddenSelect.innerHTML = renderSelectedProfileInterestOptions(interests);
  const dropdown = document.getElementById("profile-interest-select");
  dropdown.innerHTML = `<option value="" selected>Choose an interest to add</option>${renderProfileInterestOptions(interests)}`;
  document.getElementById("profile-selected-interests").innerHTML = renderSelectedProfileInterestChips(interests);
}
function renderProfile() {
  const profileImage = selectedProfileImage || state.user.profileImage || "";
  const bookingQuestions = normalizedBookingQuestions(state.user.bookingQuestions);
  const questionsEnabled = state.user.bookingQuestionsEnabled === true;
  return `<div class="view-wrap"><div class="content-header"><div><div class="eyebrow">A little about you</div><h1>My profile</h1><p>Share your interests and a little about yourself with the community.</p></div></div>
    <div class="profile-layout"><section class="profile-card"><div class="profile-banner"></div><div class="profile-header"><span class="avatar avatar-you profile-picture-preview">${avatarContent(state.user.name, profileImage)}</span><div><h2>${safe(state.user.name)}</h2><p>${safe(state.user.role || "Student")} · Making room for what's next</p></div></div>
      <form id="profile-form"><div class="field-grid"><div class="field full"><label for="profile-picture">Profile picture</label><input id="profile-picture" type="file" accept="image/jpeg,image/png,image/webp"><small class="muted-copy">Choose a JPG, PNG, or WebP image. It will be resized before saving.</small></div><div class="field"><label for="profile-name">Full name</label><input id="profile-name" name="name" required value="${safe(state.user.name)}"></div><div class="field"><label for="profile-email">Verified email address</label><input id="profile-email" name="email" type="email" readonly value="${safe(state.user.email)}"><small style="color:#6d7169;font-size:13px">Your verified sign-in email can't be changed here.</small></div><div class="field"><label for="profile-role">Account type</label><select id="profile-role" name="role"><option value="Student" ${state.user.role !== "Mentor" ? "selected" : ""}>Student</option><option value="Mentor" ${state.user.role === "Mentor" ? "selected" : ""}>Mentor</option></select></div><div class="field"><label for="profile-school">School</label><input id="profile-school" name="school" value="${safe(state.user.school || "")}" placeholder="e.g. Lincoln High School"></div><div class="field"><label for="profile-year">Year of study</label><select id="profile-year" name="year"><option ${state.user.year === "High school" ? "selected" : ""}>High school</option><option ${state.user.year === "Freshman" ? "selected" : ""}>Freshman</option><option ${state.user.year === "Sophomore" ? "selected" : ""}>Sophomore</option><option ${state.user.year === "Junior" ? "selected" : ""}>Junior</option><option ${state.user.year === "Senior" ? "selected" : ""}>Senior</option><option ${state.user.year === "Graduate" ? "selected" : ""}>Graduate</option></select></div><div class="field full"><label for="profile-interest-select">Academic & career interests</label><select id="profile-interest-select" aria-describedby="profile-interests-help"><option value="" selected>Choose an interest to add</option>${renderProfileInterestOptions(state.user.interests)}</select><div id="profile-selected-interests" class="profile-interest-list" role="list" aria-label="Selected academic and career interests">${renderSelectedProfileInterestChips(state.user.interests)}</div><select id="profile-interests" name="interests" multiple hidden aria-hidden="true">${renderSelectedProfileInterestOptions(state.user.interests)}</select><small class="muted-copy" id="profile-interests-help">Choose an interest from the dropdown to add it. You can remove selected interests below; press Save changes to save your updates.</small></div><div class="field full"><label for="profile-goal">About me</label><textarea id="profile-goal" name="goal" rows="5" placeholder="Tell the community a little about yourself, your experience, and what you'd like to share...">${safe(state.user.goal)}</textarea></div></div>
      <section class="booking-question-settings" data-mentor-question-settings ${state.user.role === "Mentor" ? "" : "hidden"}><div class="booking-question-toggle"><label for="booking-questions-enabled"><input id="booking-questions-enabled" name="bookingQuestionsEnabled" type="checkbox" value="true" ${questionsEnabled ? "checked" : ""}> Ask students questions when they request a session</label><small class="muted-copy">Configure up to 10 questions. Your changes are saved with your profile.</small></div><input id="booking-questions-data" name="bookingQuestions" type="hidden" value="${safe(JSON.stringify(bookingQuestions))}"><button class="button-secondary" type="button" data-open-booking-questions ${questionsEnabled ? "" : "hidden"}>${bookingQuestions.length ? `Edit questions (${bookingQuestions.length})` : "Set questions"}</button></section>
      <div class="modal-actions"><button class="button-primary" type="submit">Save changes</button></div></form>
    </section><aside class="profile-side"><section class="panel"><div class="panel-heading"><h2>Your interests</h2><button class="button-quiet" data-profile-edit>Edit</button></div><div class="panel-body">${(state.user.interests || "").split(",").filter(Boolean).map(item => `<div class="interest-item"><span>${safe(item.trim())}</span><span>↗</span></div>`).join("") || `<span style="font-size:15px;color:#787a72">Add interests to personalize your matches.</span>`}</div></section><section class="panel profile-reviews"><div class="panel-heading"><h2>Reviews about you</h2></div><div class="panel-body">${reviewListMarkup(state.user.id)}</div></section><div class="profile-tip"><strong>Good profiles get great conversations.</strong>Sharing what you're curious about helps mentors show up with ideas made for you.</div></aside></div></div>`;
}
function reviewListMarkup(memberId) {
  const memberReviews = reviewsFor(memberId);
  if (!memberReviews.length) return `<span class="muted-copy">No reviews yet.</span>`;
  const average = memberReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / memberReviews.length;
  return `<div class="review-summary"><strong>${average.toFixed(1)}</strong><span class="review-rating" aria-label="${average.toFixed(1)} out of 5 stars">${"★".repeat(Math.round(average))}${"☆".repeat(5 - Math.round(average))}</span><small>Average from ${memberReviews.length} ${memberReviews.length === 1 ? "review" : "reviews"}</small></div><div class="review-list">${memberReviews.map(review => `<article class="review-item"><div class="review-rating" aria-label="${Number(review.rating)} out of 5 stars">${"★".repeat(Math.max(0, Math.min(5, Number(review.rating))))}${"☆".repeat(Math.max(0, 5 - Number(review.rating)))}</div><p>${safe(review.text)}</p><small>From ${safe(review.reviewerName || "Community member")}</small></article>`).join("")}</div>`;
}
function renderMemberProfile() {
  const member = state.users.find(user => user.id === state.profileId && user.status === "Active");
  if (!member) return `<div class="view-wrap"><div class="empty-state"><strong>Profile unavailable.</strong>This account may no longer be active.<br><button class="button-secondary" data-view="discover">Back to community</button></div></div>`;
  const connection = connectionFor(member.id);
  const interests = (member.interests || "").split(",").map(value => value.trim()).filter(Boolean);
  const canRequestChat = state.user.role === "Student" && member.role === "Mentor";
  return `<div class="view-wrap"><div class="content-header"><div><div class="eyebrow">Community profile</div><h1>${safe(member.name)}</h1><p>${safe(member.role)}${member.field ? ` · ${safe(member.field)}` : ""}</p></div><button class="button-quiet" data-view="discover">← Back to community</button></div>
    <div class="public-profile-layout"><section class="profile-card public-profile-card"><div class="profile-banner"></div><div class="profile-header"><span class="avatar ${member.role === "Mentor" ? "avatar-blue" : "avatar-you"}">${avatarContent(member.name, member.profileImage)}</span><div><h2>${safe(member.name)}</h2><p>${safe(member.role)} · Community member</p>${presenceMarkup(member)}</div></div><div class="public-preferences">
      <div><strong>School</strong><span>${safe(member.school || "Not shared")}</span></div><div><strong>Year of study</strong><span>${safe(member.year || "Not shared")}</span></div>
      <div class="preference-wide"><strong>Interests</strong><span>${interests.length ? interests.map(safe).join(", ") : "Not shared"}</span></div>
      <div class="preference-wide"><strong>About me</strong><span>${safe(member.goal || "Not shared")}</span></div>
    </div><div class="profile-actions">${connection ? `<button class="button-secondary" data-message="${safe(connection.id)}">Message ${safe(member.name.split(" ")[0])}</button>${canRequestChat ? `<button class="button-primary" data-book="${safe(member.id)}">Schedule another session</button>` : ""}` : canRequestChat ? `<button class="button-primary" data-book="${safe(member.id)}">Schedule a session</button>` : `<span class="muted-copy">You can message after you connect through a mentor session.</span>`}</div></section>
    <section class="panel"><div class="panel-heading"><div><h2>Reviews</h2><p>Feedback shared by people who connected with ${safe(member.name.split(" ")[0])}.</p></div></div><div class="panel-body">${reviewListMarkup(member.id)}</div></section></div></div>`;
}
function messageMarkup(message) {
  const attachment = message.attachment;
  const attachmentMarkup = attachment
    ? `<a class="chat-attachment" href="data:${safe(attachment.type)};base64,${safe(attachment.data)}" download="${safe(attachment.name)}"><span aria-hidden="true">↧</span><span><strong>${safe(attachment.name)}</strong><small>${(Number(attachment.size) / (1024 * 1024)).toFixed(2)} MB</small></span></a>`
    : "";
  const isMine = message.senderId === state.user.id;
  const connection = state.bookings.find(booking => booking.id === message.requestId);
  const partnerId = connection?.mentorId === state.user.id
    ? connection.requesterId || state.users.find(user => normalizeEmail(user.email) === normalizeEmail(connection.requesterEmail))?.id
    : connection?.mentorId;
  const seen = isMine && partnerId && Array.isArray(message.readBy) && message.readBy.includes(partnerId);
  return `<div class="chat-message ${isMine ? "mine" : ""}"><span>${safe(message.senderName)}</span>${message.text ? `<p>${safe(message.text)}</p>` : ""}${attachmentMarkup}<time datetime="${safe(message.createdAt)}">${new Date(message.createdAt).toLocaleString()}</time>${seen ? `<small aria-label="Seen by recipient"> · Seen</small>` : ""}</div>`;
}
function renderMessages() {
  const hiddenPartners = new Set(state.hiddenConversationPartnerIds);
  const conversations = uniqueConversations()
    .filter(conversation => !hiddenPartners.has(conversation.partnerId))
    .map(conversation => conversation.booking);
  const activeBooking = canonicalConversationBooking(state.activeConversationId);
  const active = activeBooking && !hiddenPartners.has(conversationPartnerId(activeBooking))
    ? activeBooking
    : undefined;
  if (active && state.activeConversationId !== active.id) state.activeConversationId = active.id;
  const partner = active && (state.user.role === "Mentor"
    ? state.users.find(user => user.id === active.requesterId) || { name: active.requesterName || "Student", id: active.requesterId }
    : state.users.find(user => user.id === active.mentorId) || { name: active.mentorName || "Mentor", id: active.mentorId });
  const convoPanel = active && partner
    ? `<section class="panel message-panel"><div class="panel-heading"><div><h2>${safe(partner.name)}</h2>${presenceMarkup(partner)}<p>${safe(active.topic)} · Connected</p></div><div class="message-header-actions"><button class="button-quiet" data-call="${safe(active.id)}" data-call-mode="audio" aria-label="Start audio call">Audio call</button><button class="button-quiet" data-call="${safe(active.id)}" data-call-mode="video" aria-label="Start video call">Video call</button><button class="button-quiet" data-profile="${safe(partner.id)}">View profile</button><button class="button-quiet" data-delete-conversation="${safe(conversationPartnerId(active))}">Delete conversation</button></div></div><div class="message-list" id="message-list" role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions text" tabindex="0">${(state.messages[active.id] || []).map(messageMarkup).join("") || `<div class="empty-state"><strong>Start the conversation.</strong>Say hello or share a question.</div>`}</div><form class="message-form" id="message-form" data-request="${safe(active.id)}"><input name="text" maxlength="2000" placeholder="Write a message..." aria-label="Message"><button class="message-attach-button" type="button" data-trigger-attachment aria-label="Attach a file"><span aria-hidden="true">＋</span></button><input id="message-attachment" class="message-attachment-input" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.gif,.jpg,.jpeg,.png,.webp,.csv,.txt" aria-hidden="true" tabindex="-1"><span class="message-attachment-name" id="message-attachment-name" hidden aria-live="polite"></span><button class="message-attachment-clear" type="button" data-remove-attachment hidden aria-label="Remove attachment">×</button><button class="button-primary" type="submit">Send</button><small class="message-attachment-hint">Files up to 3 MB</small></form></section>`
    : `<section class="panel"><div class="panel-body"><div class="empty-state"><strong>Select a connection to message.</strong>Start a mentor session request to connect with another member.</div></div></section>`;
  return `<div class="view-wrap"><div class="content-header"><div><div class="eyebrow">A conversation can start anywhere</div><h1>Messages</h1><p>Message students and mentors after you connect through a session request.</p></div></div><div class="messages-layout"><section class="panel conversation-panel"><div class="panel-heading"><h2>Connections</h2></div><div class="conversation-list">${conversations.length ? conversations.map(booking => {
    const name = state.user.role === "Mentor" ? booking.requesterName || "Student" : booking.mentorName || "Mentor";
    const person = state.users.find(user => user.id === (state.user.role === "Mentor" ? booking.requesterId : booking.mentorId));
    return `<button class="conversation-choice ${booking.id === active?.id ? "selected" : ""}" data-message="${safe(booking.id)}"><span class="avatar ${state.user.role === "Mentor" ? "avatar-you" : "avatar-blue"}">${avatarContent(name, person?.profileImage)}</span><span><strong>${safe(name)}</strong><small>${safe(booking.topic)}</small>${presenceMarkup(person)}</span></button>`;
  }).join("") : `<div class="muted-copy conversation-empty">No connections yet. Request a mentor chat to start messaging.</div>`}</div></section>${convoPanel}</div></div>`;
}
function renderAdmin() {
  const statusClass = { Active: "active", Suspended: "suspended", PendingDeletion: "pending" };
  const accountRows = state.adminAccounts.map(account => {
    const status = account.status || "Unknown";
    const statusLabel = status === "PendingDeletion" ? "Deletion scheduled" : status;
    const isProtected = account.isAdmin;
    const actions = isProtected
      ? `<span class="muted-copy">Administrator</span>`
      : status === "Active"
        ? `<button class="button-secondary" data-admin-action="suspend" data-admin-id="${safe(account.id)}">Suspend</button><button class="button-danger" data-admin-action="delete" data-admin-id="${safe(account.id)}">Delete</button>`
        : status === "PendingDeletion"
          ? `<button class="button-secondary" data-admin-action="restore" data-admin-id="${safe(account.id)}">Restore</button>`
          : `<button class="button-secondary" data-admin-action="restore" data-admin-id="${safe(account.id)}">Restore</button><button class="button-danger" data-admin-action="delete" data-admin-id="${safe(account.id)}">Delete</button>`;
    const deletionNote = status === "PendingDeletion" && account.deletionExpiresAt
      ? `<small>Permanent deletion after ${safe(new Date(account.deletionExpiresAt).toLocaleString())}</small>`
      : "";
    return `<article class="admin-account-row"><div class="admin-account-person"><strong>${safe(account.name || "Unnamed account")}</strong><span>${safe(account.email)}</span></div><span class="admin-account-role">${safe(account.role || "Student")}</span><span class="admin-status ${statusClass[status] || ""}">${safe(statusLabel)}</span><div class="admin-account-actions">${actions}${deletionNote}</div></article>`;
  }).join("");
  const pollResults = state.adminPollResults;
  const resultRows = (pollResults?.results || []).map(result => {
    const percentage = pollResults.totalVotes
      ? Math.round((result.votes / pollResults.totalVotes) * 100)
      : 0;
    return `<div class="poll-result-row"><div><span>${safe(result.choice)}</span><strong>${result.votes} · ${percentage}%</strong></div><div class="poll-result-track"><span style="width:${percentage}%"></span></div></div>`;
  }).join("");
  const appReviewRows = state.adminAppReviews.map(review => `<article class="review-item"><div class="review-rating" aria-label="${review.rating} out of 5 stars">${"★".repeat(Math.max(0, Math.min(5, Number(review.rating))))}${"☆".repeat(Math.max(0, 5 - Number(review.rating)))}</div><p>${safe(review.comment || "No written feedback.")}</p><small>${safe(review.reviewerName)}${review.reviewerEmail ? ` · ${safe(review.reviewerEmail)}` : ""}${review.createdAt ? ` · ${safe(new Date(review.createdAt).toLocaleString())}` : ""}</small></article>`).join("");
  return `<div class="view-wrap"><div class="content-header"><div><div class="eyebrow">Administrator tools</div><h1>Account management</h1><p>Review member accounts and manage access.</p></div><button class="button-secondary" data-admin-refresh>Refresh</button></div><section class="panel admin-panel"><div class="panel-heading"><div><h2>Accounts</h2><p>${state.adminAccounts.length} account${state.adminAccounts.length === 1 ? "" : "s"}</p></div></div><div class="admin-account-list">${accountRows || `<div class="empty-state"><strong>No accounts yet.</strong>Accounts will appear here after members sign up.</div>`}</div></section><section class="panel admin-polls"><div class="panel-heading"><div><h2>Poll results</h2><p>${safe(pollResults?.poll.question || "Loading poll results...")}</p></div><strong class="poll-total">${pollResults?.totalVotes || 0} responses</strong></div><div class="panel-body">${pollResults?.totalVotes ? `<div class="poll-result-list">${resultRows}</div>` : `<p class="muted-copy">No responses yet. Results show aggregate counts only.</p>`}</div></section><section class="panel admin-polls"><div class="panel-heading"><div><h2>Private app feedback</h2><p>Visible only to administrators.</p></div><strong class="poll-total">${state.adminAppReviews.length} review${state.adminAppReviews.length === 1 ? "" : "s"}</strong></div><div class="panel-body">${appReviewRows ? `<div class="review-list">${appReviewRows}</div>` : `<p class="muted-copy">No app reviews yet.</p>`}</div></section></div>`;
}
function render() {
  if (state.view === "admin" && !state.user.isAdmin) state.view = "discover";
  const views = { discover: renderDiscover, sessions: renderSessions, profile: renderProfile, member: renderMemberProfile, messages: renderMessages, admin: renderAdmin };
  const labels = { discover: "Discover people", sessions: "My sessions", profile: "My profile", member: "Community profile", messages: "Messages", admin: "Admin" };
  document.getElementById("crumb-label").textContent = labels[state.view] || labels.discover;
  document.querySelector(".skip-link").setAttribute("href", document.getElementById("auth-root").classList.contains("active") ? "#auth-root" : "#main-content");
  document.querySelectorAll(".nav-link").forEach(button => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  viewContainer.innerHTML = (views[state.view] || renderDiscover)();
  const pageHeading = viewContainer.querySelector("h1");
  if (pageHeading) document.title = `${pageHeading.textContent.trim()} — MentorshipMatch`;
  updateShell();
  updateNotificationMenu();
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
function focusPageHeading() {
  const heading = viewContainer.querySelector("h1");
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus();
}
function setMobileNavigation(open) {
  const sidebar = document.getElementById("sidebar");
  const button = document.getElementById("mobile-menu");
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const shouldHideSidebar = isMobile && !open;
  sidebar.classList.toggle("open", isMobile && open);
  sidebar.setAttribute("aria-hidden", String(shouldHideSidebar));
  sidebar.toggleAttribute("inert", shouldHideSidebar);
  button.setAttribute("aria-expanded", String(isMobile && open));
  button.setAttribute("aria-label", isMobile && open ? "Close navigation" : "Open navigation");
  if (shouldHideSidebar && sidebar.contains(document.activeElement)) button.focus();
}
function setModalBackgroundHidden(hidden) {
  const shouldHide = hidden || Boolean(callSession);
  for (const element of [document.querySelector(".app-shell"), document.getElementById("auth-root")]) {
    if (!element) continue;
    if (shouldHide) {
      element.setAttribute("aria-hidden", "true");
      element.toggleAttribute("inert", true);
    } else {
      element.removeAttribute("aria-hidden");
      element.toggleAttribute("inert", false);
    }
  }
}
function openModal(title, subtitle, body) {
  if (!modalRoot.classList.contains("open")) modalReturnFocus = document.activeElement;
  modalRoot.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description"><header class="modal-header"><div><h2 id="modal-title">${title}</h2><p id="modal-description">${subtitle}</p></div><button class="modal-close" type="button" data-close-modal aria-label="Close dialog">×</button></header><div class="modal-body">${body}</div></section>`;
  setModalBackgroundHidden(true);
  modalRoot.classList.add("open"); modalRoot.setAttribute("aria-hidden", "false");
  modalRoot.querySelector("[data-close-modal]").focus();
}
function closeModal() {
  modalRoot.classList.remove("open");
  modalRoot.setAttribute("aria-hidden", "true");
  modalRoot.innerHTML = "";
  setModalBackgroundHidden(false);
  const returnFocus = modalReturnFocus;
  modalReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus();
}
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
  openModal("Delete this account?", "Your account will be deactivated now and permanently deleted after 24 hours. Sign in within that time to restore it.", `<div class="modal-form"><p style="font-size:15px;color:#656a60;line-height:1.6;margin:0">Account: <strong>${safe(member.name)}</strong>${member.email ? ` (${safe(member.email)})` : ""}</p><div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Keep account</button><button class="button-danger" type="button" ${ownAccount ? "data-delete-own" : `data-confirm-delete="${safe(member.id)}"`}>Delete account</button></div></div>`);
}
function confirmSessionDeletion(bookingId) {
  const booking = state.bookings.find(item => item.id === bookingId);
  if (!booking) return;
  openModal("Delete this session?", "This permanently removes the session and its messages for both participants.", `<div class="modal-form"><p style="font-size:15px;color:#656a60;line-height:1.6;margin:0"><strong>${safe(booking.topic)}</strong> · ${safe(booking.date)} at ${safe(booking.time)}</p><div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Keep session</button><button class="button-danger" type="button" data-confirm-delete-session="${safe(booking.id)}">Delete session</button></div></div>`);
}
function confirmConversationDeletion(partnerId) {
  const conversation = uniqueConversations().find(item => item.partnerId === partnerId);
  if (!conversation) return;
  const partner = state.users.find(user => user.id === partnerId);
  const name = partner?.name ||
    (state.user.role === "Mentor" ? conversation.booking.requesterName : conversation.booking.mentorName) ||
    "this person";
  openModal("Delete this conversation?", `${safe(name)}'s conversation will be hidden from your Messages list. Its history stays saved and returns if you message them again.`, `<div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Keep conversation</button><button class="button-danger" type="button" data-confirm-delete-conversation="${safe(partnerId)}">Delete conversation</button></div>`);
}
function openConversation(requestId) {
  const booking = canonicalConversationBooking(requestId);
  if (!booking) {
    showToast("That conversation could not be found.");
    return;
  }
  const partnerId = conversationPartnerId(booking);
  if (state.hiddenConversationPartnerIds.includes(partnerId)) {
    state.hiddenConversationPartnerIds = state.hiddenConversationPartnerIds.filter(id => id !== partnerId);
    persistNotificationState();
  }
  state.activeConversationId = booking.id;
  state.view = "messages";
  render();
  focusPageHeading();
  syncConversation(booking.id);
}
async function openBooking(mentorId) {
  if (state.user.role !== "Student") {
    showToast("Only students can request chats with mentors.");
    return;
  }
  let mentor;
  try {
    const response = await fetch("/api/accounts", { headers: apiHeaders() });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `Mentor request failed (HTTP ${response.status}).`);
    mentor = (payload.users || []).find(item => item.id === mentorId && item.role === "Mentor" && item.status === "Active");
    if (!mentor) {
      showToast("That mentor could not be found.");
      return;
    }
    const cachedMentorIndex = state.users.findIndex(item => item.id === mentor.id);
    if (cachedMentorIndex >= 0) state.users[cachedMentorIndex] = mentor;
    else state.users.push(mentor);
  } catch (error) {
    console.error("Unable to load current mentor scheduling details", error);
    showToast(error.message || "The mentor's scheduling details could not be loaded.");
    return;
  }
  const questions = mentor.bookingQuestionsEnabled === true ? normalizedBookingQuestions(mentor.bookingQuestions) : [];
  const questionFields = questions.map((question, index) => `<div class="field"><label for="booking-question-${index}">${safe(question.text)}${question.required ? ` <span class="required-indicator">(required)</span>` : ` <span class="muted-copy">(optional)</span>`}</label><textarea id="booking-question-${index}" name="booking-question-${index}" rows="3" maxlength="1000" ${question.required ? "required" : ""}></textarea></div>`).join("");
  const questionSection = questionFields
    ? `<section class="booking-question-prompt" aria-label="Questions from ${safe(mentor.name)}"><h3>Questions from ${safe(mentor.name.split(" ")[0])}</h3><p class="muted-copy">Please answer these before scheduling your session.</p>${questionFields}</section>`
    : "";
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  openModal("Schedule a session", `Choose a time to meet with ${mentor.name.split(" ")[0]}.`, `<div class="modal-mentor"><span class="mentor-avatar avatar-blue">${initials(mentor.name)}</span><span><strong>${safe(mentor.name)}</strong><p>Mentor · ${safe(mentor.field)}</p></span></div><form class="modal-form" id="booking-form" data-mentor="${mentor.id}">
    ${questionSection}
    <div class="field"><label for="booking-topic">What would you like to talk about?</label><input id="booking-topic" name="topic" required maxlength="70" placeholder="e.g. Getting started in product design"></div>
    <div class="field-grid"><div class="field"><label for="booking-date">A date that works</label><input id="booking-date" name="date" type="date" min="${today}" required></div><div class="field"><label for="booking-time">Preferred time</label><input id="booking-time" name="time" type="time" step="60" required></div></div>
    <div class="field"><label for="booking-format">How would you like to meet?</label><select name="format" id="booking-format"><option>Video call</option><option>Chat</option></select></div>
    <div class="field"><label for="booking-note">A note for ${safe(mentor.name.split(" ")[0])} <span style="color:#7a7a7a;font-weight:400">(optional)</span></label><textarea id="booking-note" name="note" maxlength="300" placeholder="Share a little context or a question you'd love to explore..."></textarea></div>
    <div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Maybe later</button><button class="button-primary" type="submit">Send scheduling request ↗</button></div></form>`);
}
function openBookingAnswers(bookingId) {
  const booking = state.bookings.find(item => item.id === bookingId);
  if (!booking || state.user.role !== "Mentor" || booking.mentorId !== state.user.id) {
    showToast("Those student answers are not available.");
    return;
  }
  const answers = Array.isArray(booking.questionAnswers) ? booking.questionAnswers : [];
  if (!answers.length) {
    showToast("This session has no booking questions.");
    return;
  }
  const rows = answers.map(item => `<div><dt>${safe(item.question || "Question")}</dt><dd>${safe(item.answer || "No answer provided.")}</dd></div>`).join("");
  openModal("Student's answers", `${safe(booking.requesterName || "Your student")} shared these responses when requesting the session.`, `<dl class="booking-answer-list">${rows}</dl><div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Close</button></div>`);
}
function openReview(mentorId) {
  if (!canReviewMentor(mentorId)) return;
  const mentor = state.users.find(item => item.id === mentorId && item.role === "Mentor"); if (!mentor) return;
  openModal("How did it go?", `Your feedback helps ${mentor.name.split(" ")[0]} and future mentees.`, `<div class="modal-mentor"><span class="mentor-avatar avatar-blue">${initials(mentor.name)}</span><span><strong>${safe(mentor.name)}</strong><p>Mentor · ${safe(mentor.field)}</p></span></div><form class="modal-form" id="review-form" data-mentor="${mentor.id}"><fieldset class="field rating-field"><legend>Your rating</legend><div class="modal-rating">${[1,2,3,4,5].map(num => `<label class="rating-option"><input class="visually-hidden" type="radio" name="rating" value="${num}" aria-label="${num} star${num > 1 ? "s" : ""}" required><span aria-hidden="true">★</span></label>`).join("")}</div></fieldset><div class="field"><label for="review-text">What would you like others to know?</label><textarea id="review-text" name="text" maxlength="300" required placeholder="What made this conversation meaningful?"></textarea></div><div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Cancel</button><button class="button-primary" type="submit">Share review</button></div></form>`);
}
function openAppReview() {
  openModal("Give Feedback", "Your feedback is private to the admin team and associated with your account.", `<form class="modal-form" id="app-review-form"><fieldset class="field rating-field"><legend>Your rating</legend><div class="modal-rating">${[1,2,3,4,5].map(num => `<label class="rating-option"><input class="visually-hidden" type="radio" name="rating" value="${num}" aria-label="${num} star${num > 1 ? "s" : ""}" required><span aria-hidden="true">★</span></label>`).join("")}</div></fieldset><div class="field"><label for="app-review-comment">What could we improve?</label><textarea id="app-review-comment" name="comment" maxlength="1000" placeholder="Share any thoughts about your experience..."></textarea></div><div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Cancel</button><button class="button-primary" type="submit">Send private feedback</button></div></form>`);
}
function showAuth(mode = "login") {
  document.querySelector(".app-shell").style.display = "none";
  const authRoot = document.getElementById("auth-root");
  authRoot.classList.add("active");
  document.querySelector(".skip-link").setAttribute("href", "#auth-root");
  const isSignup = mode === "signup";
  const recentAccountList = !isSignup && recentAccounts.length
    ? `<div class="recent-accounts"><p>Switch to a recently used account</p>${recentAccounts.map(account => `<button type="button" class="recent-account" data-switch-account="${safe(account.id)}"><span class="avatar avatar-you">${avatarContent(account.user.name, account.user.profileImage)}</span><span><strong>${safe(account.user.name || account.user.email)}</strong><small>${safe(account.user.email)}</small></span></button>`).join("")}</div>`
    : "";
  authRoot.innerHTML = `<div class="auth-screen"><section class="auth-art"><a class="brand auth-logo" href="#"><svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="20" height="20" fill="rgba(255,255,255,.55)" stroke="#4b704e" stroke-width="2" /><rect x="11" y="11" width="20" height="20" fill="rgba(255,255,255,.55)" stroke="#4b704e" stroke-width="2" /><path d="M1 1 31 31" fill="none" stroke="#4b704e" stroke-width="2" /></svg><span>mentorship<span class="brand-light">match</span></span></a><div class="auth-art-content"><span class="eyebrow">A good place to begin</span><h2>There's more than one way to get where you're going.</h2><p>Find people who'll listen, share what they know, and cheer you on along the way.</p></div><div class="auth-shape" aria-hidden="true"></div></section><section class="auth-form-wrap"><form class="auth-form" id="auth-form"><div class="eyebrow">${isSignup ? "Make yourself at home" : "Welcome back"}</div><h1>${isSignup ? "Create your account" : "Good to see you again."}</h1><p>${isSignup ? "Your next conversation could open a new door." : "Sign in within 24 hours of requesting deletion to restore it."}</p>${isSignup ? `<div class="field"><label for="auth-name">Your name</label><input id="auth-name" name="name" required placeholder="Your name"></div>` : ""}<div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" required placeholder="you@example.com"></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" minlength="8" autocomplete="${isSignup ? "new-password" : "current-password"}" required placeholder="At least 8 characters"></div>${isSignup ? `<div class="field"><label for="auth-role">I’m here as a...</label><select id="auth-role" name="role"><option>Student</option><option>Mentor</option></select></div>` : ""}<button class="button-primary" type="submit">${isSignup ? "Create my account" : "Sign in"} <span aria-hidden="true">→</span></button><div id="auth-feedback" class="auth-feedback" hidden></div>${recentAccountList}<div class="auth-switch">${isSignup ? "Already have an account?" : "New to MentorshipMatch?"} <button type="button" data-auth-switch>${isSignup ? "Sign in" : "Create an account"}</button></div></form></section></div>`;
  const authHeading = authRoot.querySelector("h1");
  authHeading.tabIndex = -1;
  authHeading.focus();
  document.title = `${authHeading.textContent.trim()} — MentorshipMatch`;
  document.querySelector("[data-auth-switch]").addEventListener("click", () => showAuth(isSignup ? "login" : "signup"));
}
async function switchRecentAccount(userId) {
  const account = recentAccounts.find(item => item.id === userId);
  if (!account) {
    showToast("That recently used account is no longer available.");
    return;
  }
  if (callSession) await finishCall(true, false);
  const previousToken = authToken;
  authToken = account.token;
  try {
    const response = await fetch("/api/accounts", { headers: apiHeaders() });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      if (response.status === 401) {
        removeRecentAccount(userId);
        authToken = previousToken;
        showToast("That saved session has expired. Sign in with your password to continue.");
        return;
      }
      throw new Error(payload.error || `Account switch failed (HTTP ${response.status}).`);
    }
    const verifiedUser = (payload.users || []).find(user => user.id === account.id);
    if (!verifiedUser) {
      removeRecentAccount(userId);
      throw new Error("That account is no longer active. Sign in again to continue.");
    }
    localStorage.setItem("mm-token", JSON.stringify(authToken));
    state.user = { ...account.user, ...verifiedUser, email: account.user.email };
    resetPollTracker(state.user.id);
    state.adminPollResults = null;
    syncPollState().catch(error => console.error("Unable to load poll status", error));
    state.bookings = [];
    state.messages = {};
    state.view = "discover";
    state.profileId = "";
    state.activeConversationId = "";
    navigationOwnerId = state.user.id;
    selectedProfileImage = state.user.profileImage || "";
    initializeNotificationState();
    rememberRecentAccount(state.user, authToken);
    await updatePresence();
    closeModal();
    await syncCommunityAccounts();
    await syncConnections();
    await syncNotifications();
    persist();
    document.getElementById("auth-root").classList.remove("active");
    document.querySelector(".app-shell").style.display = "";
    render();
    showToast(`Switched to ${state.user.name || state.user.email}.`);
  } catch (error) {
    authToken = previousToken;
    console.error("Unable to switch accounts", error);
    showToast(error.message || "Unable to switch to that account.");
  }
}
document.addEventListener("click", async event => {
  if (!event.target.closest(".notification-menu-wrap")) closeNotificationMenu();
  const removeInterestButton = event.target.closest("[data-remove-profile-interest]");
  if (removeInterestButton) {
    const valueToRemove = removeInterestButton.dataset.removeProfileInterest.toLocaleLowerCase();
    const interests = selectedProfileInterests().filter(value => value.toLocaleLowerCase() !== valueToRemove);
    updateProfileInterestControls(interests);
    document.getElementById("profile-interest-select").focus();
    return;
  }
  const target = event.target.closest("button");
  if (!target) return;
  if (target.hasAttribute("data-call-mode")) { await startCall(target.dataset.call, target.dataset.callMode, target); return; }
  if (target.hasAttribute("data-call-accept")) { await acceptCall(target); return; }
  if (target.hasAttribute("data-call-decline")) { target.disabled = true; await finishCall(true, false); return; }
  if (target.hasAttribute("data-call-end")) { target.disabled = true; await finishCall(true, true); return; }
  if (target.hasAttribute("data-call-mute")) {
    const audioTracks = callLocalStream?.getAudioTracks() || [];
    const enableAudio = audioTracks.some(track => !track.enabled);
    for (const track of audioTracks) track.enabled = enableAudio;
    target.textContent = enableAudio ? "Mute" : "Unmute";
    target.setAttribute("aria-pressed", String(!enableAudio));
    return;
  }
  if (target.hasAttribute("data-call-video")) {
    const videoTracks = callLocalStream?.getVideoTracks() || [];
    const enableVideo = videoTracks.some(track => !track.enabled);
    for (const track of videoTracks) track.enabled = enableVideo;
    target.textContent = enableVideo ? "Turn camera off" : "Turn camera on";
    target.setAttribute("aria-pressed", String(enableVideo));
    return;
  }
  if (target.hasAttribute("data-switch-account")) { await switchRecentAccount(target.dataset.switchAccount); return; }
  if (target.hasAttribute("data-poll-dismiss")) {
    pollSnoozedUntilActivityMs = pollActiveMs + pollSnoozeDurationMs;
    closeModal();
    return;
  }
  if (target.hasAttribute("data-remove-attachment")) {
    const form = target.closest("#message-form");
    form.querySelector("#message-attachment").value = "";
    form.querySelector("#message-attachment-name").textContent = "";
    form.querySelector("#message-attachment-name").hidden = true;
    target.hidden = true;
    return;
  }
  if (target.hasAttribute("data-trigger-attachment")) {
    target.closest("#message-form").querySelector("#message-attachment").click();
    return;
  }
  if (target.hasAttribute("data-open-booking-questions")) {
    openBookingQuestionsEditor();
    return;
  }
  if (target.hasAttribute("data-add-booking-question") || target.hasAttribute("data-remove-booking-question")) {
    const form = target.closest("#booking-questions-form");
    const questions = readBookingQuestionRows(form);
    let focusIndex = -1;
    if (target.hasAttribute("data-add-booking-question") && questions.length < 10) {
      questions.push({ text: "", required: true });
      focusIndex = questions.length - 1;
    } else if (target.hasAttribute("data-remove-booking-question") && questions.length > 1) {
      const removeIndex = Number(target.dataset.removeBookingQuestion);
      questions.splice(removeIndex, 1);
      focusIndex = Math.min(removeIndex, questions.length - 1);
    }
    updateBookingQuestionRows(form, questions, focusIndex);
    return;
  }
  if (target.id === "notifications") { toggleNotificationMenu(); return; }
  if (target.hasAttribute("data-dismiss-notification")) {
    dismissNotification(target.dataset.dismissNotification, target.dataset.notificationId);
    const nextDismissButton = document.querySelector("#notification-menu .notification-dismiss");
    (nextDismissButton || document.getElementById("notifications")).focus();
    return;
  }
  if (target.hasAttribute("data-notification-message")) {
    closeNotificationMenu();
    openConversation(target.dataset.notificationMessage);
    return;
  }
  if (target.hasAttribute("data-notification-mentor")) {
    closeNotificationMenu();
    state.profileId = target.dataset.notificationMentor;
    state.view = "member";
    render();
    focusPageHeading();
    return;
  }
  if (target.hasAttribute("data-notification-session")) {
    closeNotificationMenu();
    state.view = "sessions";
    state.activeConversationId = "";
    render();
    focusPageHeading();
    return;
  }
  if (target.dataset.view) {
    if (target.dataset.view === "admin") {
      try {
        await syncAdminDashboard();
      } catch (error) {
        console.error("Unable to load admin accounts", error);
        showToast(error.message || "The admin area could not be loaded.");
        return;
      }
    }
    closeModal();
    state.view = target.dataset.view;
    render();
    setMobileNavigation(false);
    focusPageHeading();
    return;
  }
  if (target.hasAttribute("data-admin-refresh")) {
    target.disabled = true;
    try {
      await syncAdminDashboard();
      render();
      showToast("Account list refreshed.");
    } catch (error) {
      console.error("Unable to refresh admin accounts", error);
      showToast(error.message || "Accounts could not be refreshed.");
      target.disabled = false;
    }
    return;
  }
  if (target.hasAttribute("data-admin-action")) {
    const account = state.adminAccounts.find(item => item.id === target.dataset.adminId);
    if (!account) { showToast("That account could not be found."); return; }
    const action = target.dataset.adminAction;
    const confirmation = action === "delete"
      ? `Schedule ${account.email} for deletion? They will have 24 hours to restore the account.`
      : action === "suspend"
        ? `Suspend ${account.email}? They will no longer be able to sign in.`
        : `Restore ${account.email} and allow them to sign in again?`;
    if (!window.confirm(confirmation)) return;
    target.disabled = true;
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(account.id)}`, {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({ action })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Account update failed (HTTP ${response.status}).`);
      state.adminAccounts = state.adminAccounts.map(item => item.id === payload.account.id ? payload.account : item);
      render();
      showToast(action === "delete" ? "Account scheduled for deletion." : action === "suspend" ? "Account suspended." : "Account restored.");
    } catch (error) {
      console.error("Unable to update account", error);
      showToast(error.message || "The account could not be updated.");
      target.disabled = false;
    }
    return;
  }
  if (target.hasAttribute("data-delete-conversation")) {
    confirmConversationDeletion(target.dataset.deleteConversation);
    return;
  }
  if (target.hasAttribute("data-confirm-delete-conversation")) {
    const partnerId = target.dataset.confirmDeleteConversation;
    state.hiddenConversationPartnerIds = [...new Set([...state.hiddenConversationPartnerIds, partnerId])];
    persistNotificationState();
    if (conversationPartnerId(canonicalConversationBooking(state.activeConversationId)) === partnerId) {
      state.activeConversationId = "";
    }
    closeModal();
    render();
    showToast("Conversation removed from Messages. Its history is saved.");
    return;
  }
  if (target.hasAttribute("data-profile")) { state.profileId = target.dataset.profile; state.view = "member"; render(); focusPageHeading(); return; }
  if (target.hasAttribute("data-message")) {
    openConversation(target.dataset.message);
    return;
  }
  if (target.hasAttribute("data-book")) {
    target.disabled = true;
    target.setAttribute("aria-busy", "true");
    try {
      await openBooking(target.dataset.book);
    } finally {
      target.disabled = false;
      target.removeAttribute("aria-busy");
    }
    return;
  }
  if (target.hasAttribute("data-close-modal")) {
    if (modalRoot.querySelector("#experience-poll-form")) {
      pollSnoozedUntilActivityMs = pollActiveMs + pollSnoozeDurationMs;
    }
    closeModal();
    return;
  }
  if (target.hasAttribute("data-review")) { openReview(target.dataset.review); return; }
  if (target.hasAttribute("data-delete-session")) {
    confirmSessionDeletion(target.dataset.deleteSession);
    return;
  }
  if (target.hasAttribute("data-view-booking-answers")) {
    openBookingAnswers(target.dataset.viewBookingAnswers);
    return;
  }
  if (target.hasAttribute("data-confirm-delete-session")) {
    const bookingId = target.dataset.confirmDeleteSession;
    target.disabled = true;
    try {
      const response = await fetch("/api/chat-requests", {
        method: "DELETE",
        headers: apiHeaders(true),
        body: JSON.stringify({ id: bookingId })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Session deletion failed (HTTP ${response.status}).`);
      state.bookings = state.bookings.filter(item => item.id !== bookingId);
      delete state.messages[bookingId];
      if (state.activeConversationId === bookingId) state.activeConversationId = "";
      persist();
      closeModal();
      render();
      showToast("Session deleted.");
    } catch (error) {
      console.error("Unable to delete session", error);
      showToast(error.message || "The session could not be deleted.");
      target.disabled = false;
    }
    return;
  }
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
    target.disabled = true;
    try {
      const response = await fetch("/api/chat-requests", {
        method: "PATCH",
        headers: apiHeaders(true),
        body: JSON.stringify({ id: target.dataset.complete, userId: state.user.id, action: "complete" })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Completion update failed (HTTP ${response.status}).`);
      const booking = state.bookings.find(item => item.id === target.dataset.complete);
      if (booking) {
        booking.status = payload.request.status;
        booking.completedBy = Array.isArray(payload.request.completedBy) ? payload.request.completedBy : [];
      }
      persist();
      render();
      showToast(payload.request.status === "Completed"
        ? "Both participants marked the session complete."
        : "You marked this session complete. Waiting for the other participant.");
    } catch (error) {
      console.error("Unable to mark session complete", error);
      showToast(error.message || "The session could not be marked complete.");
      target.disabled = false;
    }
    return;
  }
  if (target.hasAttribute("data-scroll-mentors")) { document.getElementById("mentor-section").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); return; }
  if (target.hasAttribute("data-profile-edit")) { document.getElementById("profile-name").focus(); return; }
  if (target.id === "account-button") {
    const otherAccounts = recentAccounts.filter(account => account.id !== state.user.id);
    openModal("Your account", "Manage your MentorshipMatch account.", `<div class="modal-form"><div class="modal-mentor"><span class="avatar avatar-you">${avatarContent(state.user.name, state.user.profileImage)}</span><span><strong>${safe(state.user.name)}</strong><p>${safe(state.user.email)} · ${safe(state.user.role || "Student")}</p></span></div><button class="button-secondary" data-view="profile">Edit your profile</button><button class="button-secondary" data-change-password>Change password</button><button class="button-secondary" data-app-review>Give Feedback</button>${otherAccounts.length ? `<div class="recent-accounts"><p>Switch account</p>${otherAccounts.map(account => `<button type="button" class="recent-account" data-switch-account="${safe(account.id)}"><span class="avatar avatar-you">${avatarContent(account.user.name, account.user.profileImage)}</span><span><strong>${safe(account.user.name || account.user.email)}</strong><small>${safe(account.user.email)}</small></span></button>`).join("")}</div>` : ""}<button class="button-quiet" data-logout>Sign out</button><button class="button-danger" data-request-delete-own>Delete my account</button></div>`); return;
  }
  if (target.hasAttribute("data-app-review")) { openAppReview(); return; }
  if (target.hasAttribute("data-change-password")) {
    openModal("Change password", "Confirm your current password, then choose a new one.", `<form id="change-password-form" class="modal-form"><div class="field"><label for="current-password">Current password</label><input id="current-password" name="currentPassword" type="password" maxlength="256" autocomplete="current-password" required></div><div class="field"><label for="new-password">New password</label><input id="new-password" name="newPassword" type="password" minlength="8" maxlength="256" autocomplete="new-password" required><small class="muted-copy">Use at least 8 characters.</small></div><div class="field"><label for="confirm-password">Confirm new password</label><input id="confirm-password" name="confirmPassword" type="password" minlength="8" maxlength="256" autocomplete="new-password" required></div><div class="modal-actions"><button class="button-secondary" type="button" data-close-modal>Cancel</button><button class="button-primary" type="submit">Update password</button></div></form>`);
    return;
  }
  if (target.hasAttribute("data-logout")) {
    if (callSession) await finishCall(true, false);
    await updatePresence(false);
    authToken = "";
    resetPollTracker("");
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
    const deletedUserId = state.user.id;
    const ownMember = state.users.find(user => user.email === email);
    target.disabled = true;
    if (callSession) await finishCall(true, false);
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({})
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Account deletion failed (HTTP ${response.status}).`);
    } catch (error) {
      console.error("Unable to schedule account deletion", error);
      logTestError("Account deletion", error);
      showToast(error.message || "Your account could not be scheduled for deletion.");
      target.disabled = false;
      return;
    }
    state.users = state.users.filter(user => user.email !== email);
    authUsers = authUsers.filter(user => normalizeEmail(user.email) !== normalizeEmail(email));
    if (ownMember) state.reports = state.reports.filter(report => report.userId !== ownMember.id);
    state.bookings = [];
    state.reviews = {};
    state.user = { name: "Your name", email: "", interests: "", goal: "" };
    resetPollTracker("");
    removeRecentAccount(deletedUserId);
    authToken = "";
    localStorage.removeItem("mm-token");
    persist(); closeModal(); showAuth("login"); showToast("Account scheduled for deletion. Sign in within 24 hours to restore it."); return;
  }
  if (target.id === "notifications") { showToast("You're all caught up — nice work."); }
});
document.addEventListener("input", event => {
  if (event.target.id === "mentor-search") { state.query = event.target.value; const cursor = event.target.selectionStart; render(); const input = document.getElementById("mentor-search"); input.focus(); input.setSelectionRange(cursor, cursor); }
});
document.addEventListener("change", event => {
  if (event.target.id === "profile-interest-select" && event.target.value) {
    const interests = selectedProfileInterests();
    const selectedValue = event.target.value;
    if (!interests.some(value => value.toLocaleLowerCase() === selectedValue.toLocaleLowerCase())) interests.push(selectedValue);
    updateProfileInterestControls(interests);
    event.target.focus();
    return;
  }
  if (event.target.matches('input[type="radio"][name="rating"]')) {
    const rating = Number(event.target.value);
    event.target.closest("fieldset").querySelectorAll(".rating-option").forEach((option, index) => {
      option.classList.toggle("selected", index < rating);
    });
  }
  if (event.target.id === "profile-role") {
    const settings = document.querySelector("[data-mentor-question-settings]");
    if (settings) settings.hidden = event.target.value !== "Mentor";
  }
  if (event.target.id === "booking-questions-enabled") {
    const button = document.querySelector("[data-open-booking-questions]");
    if (button) button.hidden = !event.target.checked;
  }
  if (event.target.id === "community-role") {
    state.memberType = event.target.value;
    render();
    document.getElementById("community-role").focus();
  }
  if (event.target.id === "mentor-sort") {
    state.mentorSort = event.target.value;
    render();
    document.getElementById("mentor-sort").focus();
  }
  if (event.target.id === "message-attachment" && event.target.files?.[0]) {
    const file = event.target.files[0];
    if (!chatAttachmentType(file) || file.size === 0 || file.size > maxChatAttachmentBytes) {
      showToast(file.size > maxChatAttachmentBytes
        ? "Choose a file up to 3 MB."
        : "Choose a PDF, Office document, image, CSV, or text file.");
      event.target.value = "";
      return;
    }
    const form = event.target.closest("#message-form");
    const fileName = form.querySelector("#message-attachment-name");
    fileName.textContent = file.name;
    fileName.hidden = false;
    form.querySelector("[data-remove-attachment]").hidden = false;
  }
  if (event.target.id === "profile-picture" && event.target.files?.[0]) {
    const selectionVersion = ++profileImageSelectionVersion;
    profileImageTask = resizeProfileImage(event.target.files[0]).then(image => {
      if (selectionVersion !== profileImageSelectionVersion) return;
      selectedProfileImage = image;
      document.querySelectorAll(".profile-picture-preview").forEach(el => { el.innerHTML = avatarContent(state.user.name, image); });
    }).catch(error => {
      if (selectionVersion !== profileImageSelectionVersion) return;
      console.error("Unable to process profile picture", error);
      showToast(error.message || "The profile picture could not be processed.");
      event.target.value = "";
    });
  }
});
document.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  if (form.id === "experience-poll-form") {
    const choice = new FormData(form).get("choice");
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const response = await fetch("/api/poll", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({ choice })
      });
      const payload = await readJsonResponse(response);
      if (response.status === 409) {
        await syncPollState();
        if (state.poll?.hasResponded) {
          closeModal();
          showToast("You have already responded to this poll.");
          return;
        }
      }
      if (!response.ok) throw new Error(payload.error || `Poll response failed (HTTP ${response.status}).`);
      if (state.poll) state.poll.hasResponded = true;
      closeModal();
      showToast(payload.message || "Thanks for sharing your response.");
    } catch (error) {
      console.error("Unable to submit poll response", error);
      showToast(error.message || "Your poll response could not be saved.");
      submitButton.disabled = false;
    }
    return;
  }
  if (form.id === "booking-questions-form") {
    const questions = readBookingQuestionRows(form);
    if (!questions.length || questions.length > 10 || questions.some(question => !question.text)) {
      showToast("Add between 1 and 10 non-empty questions.");
      return;
    }
    document.getElementById("booking-questions-data").value = JSON.stringify(questions);
    document.querySelector("[data-open-booking-questions]").textContent = `Edit questions (${questions.length})`;
    closeModal();
    return;
  }
  if (form.id === "booking-form") {
    const data = new FormData(form); const mentor = state.users.find(item => item.id === form.dataset.mentor && item.role === "Mentor" && item.status === "Active");
    if (!mentor) { showToast("That mentor could not be found."); return; }
    const mentorQuestions = mentor.bookingQuestionsEnabled === true ? normalizedBookingQuestions(mentor.bookingQuestions) : [];
    const questionAnswers = mentorQuestions.map((question, index) => ({
      questionIndex: index,
      question: question.text,
      answer: String(data.get(`booking-question-${index}`) || "").trim()
    }));
    const booking = { id: `booking-${Date.now()}`, mentorId: mentor.id, requesterId: state.user.id, mentorName: mentor.name, requesterEmail: state.user.email, topic: data.get("topic").trim(), date: data.get("date"), time: data.get("time"), format: data.get("format"), note: data.get("note").trim(), questionAnswers, status: "Pending", completedBy: [] };
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
    persist(); closeModal(); state.view = "sessions"; render(); focusPageHeading(); showToast("Your session request is on its way!"); return;
  }
  if (form.id === "review-form") {
    const data = new FormData(form); const rating = Number(data.get("rating"));
    if (!rating) { showToast("Choose a star rating before sharing."); return; }
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({ mentorId: form.dataset.mentor, reviewerId: state.user.id, rating, text: data.get("text").trim() })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Review save failed (HTTP ${response.status}).`);
      const mentorReviews = reviewsFor(form.dataset.mentor);
      const existing = mentorReviews.findIndex(item => item.reviewerId === state.user.id);
      if (existing >= 0) mentorReviews[existing] = payload.review;
      else mentorReviews.push(payload.review);
      state.reviews[form.dataset.mentor] = mentorReviews;
      reviewSyncVersion++;
      persist();
      closeModal();
      render();
      showToast("Thanks for sharing your experience!");
    } catch (error) {
      console.error("Unable to save review", error);
      logTestError("Review save", error);
      showToast(error.message || "Your review could not be saved.");
      submitButton.disabled = false;
    }
    return;
  }
  if (form.id === "app-review-form") {
    const data = new FormData(form);
    const rating = Number(data.get("rating"));
    if (!rating) { showToast("Choose a star rating before sharing."); return; }
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const response = await fetch("/api/app-reviews", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({ rating, comment: String(data.get("comment") || "").trim() })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `App review request failed (HTTP ${response.status}).`);
      closeModal();
      showToast("Thanks for reviewing the app!");
    } catch (error) {
      console.error("Unable to save app review", error);
      logTestError("App review save", error);
      showToast(error.message || "Your app review could not be saved.");
      submitButton.disabled = false;
    }
    return;
  }
  if (form.id === "message-form") {
    const data = new FormData(form);
    const text = String(data.get("text") || "").trim();
    const file = form.querySelector("#message-attachment").files?.[0];
    if (!text && !file) {
      showToast("Write a message or attach a file before sending.");
      return;
    }
    const sendButton = form.querySelector('button[type="submit"]');
    sendButton.disabled = true;
    try {
      const attachment = file ? await readChatAttachment(file) : undefined;
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({ requestId: form.dataset.request, senderId: state.user.id, text, ...(attachment ? { attachment } : {}) })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Message send failed (HTTP ${response.status}).`);
      const requestId = form.dataset.request;
      messageSyncVersions.set(requestId, (messageSyncVersions.get(requestId) || 0) + 1);
      const messages = new Map((state.messages[requestId] || []).map(message => [message.id, message]));
      messages.set(payload.message.id, payload.message);
      state.messages[requestId] = [...messages.values()].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      );
      render();
      const list = document.getElementById("message-list");
      if (list) list.scrollTop = list.scrollHeight;
      syncConversation(requestId);
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
    await profileImageTask;
    const data = new FormData(form);
    const email = normalizeEmail(data.get("email"));
    const ownMember = state.users.find(user => user.id === state.user.id || normalizeEmail(user.email) === normalizeEmail(state.user.email));
    if (emailAlreadyInUse(email, ownMember?.id)) { showToast("That email is already used by another account."); return; }
    const interests = data.getAll("interests").map(value => String(value).trim()).filter(Boolean).join(", ");
    let bookingQuestions;
    try {
      bookingQuestions = normalizedBookingQuestions(JSON.parse(String(data.get("bookingQuestions") || "[]")));
    } catch (error) {
      console.error("Unable to read booking questions", error);
      showToast("Your booking questions could not be read. Please reopen and save them again.");
      return;
    }
    const bookingQuestionsEnabled = data.get("bookingQuestionsEnabled") === "true" && data.get("role") === "Mentor";
    if (bookingQuestionsEnabled && !bookingQuestions.length) {
      showToast("Add at least one question before enabling questions for students.");
      document.querySelector("[data-open-booking-questions]")?.focus();
      return;
    }
    const updatedProfile = { name: data.get("name").trim(), email, role: data.get("role"), school: data.get("school").trim(), year: data.get("year"), interests, goal: data.get("goal").trim(), field: interests.split(",")[0].trim(), profileImage: selectedProfileImage || state.user.profileImage || "", bookingQuestionsEnabled, bookingQuestions };
    let savedProfile;
    try {
      const response = await fetch("/api/account/profile", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({ id: state.user.id, ...updatedProfile })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Profile save failed (HTTP ${response.status}).`);
      if (!payload.user || payload.user.id !== state.user.id) throw new Error("The server did not confirm the saved profile.");
      savedProfile = payload.user;
    } catch (error) {
      console.error("Unable to save profile", error);
      logTestError("Profile save", error);
      showToast(error.message || "Your profile could not be saved.");
      return;
    }
    state.user = { ...state.user, ...savedProfile, email };
    selectedProfileImage = state.user.profileImage || "";
    if (ownMember) {
      Object.assign(ownMember, { name: state.user.name, email, role: state.user.role, school: state.user.school, year: state.user.year, interests: state.user.interests, goal: state.user.goal, field: state.user.field, profileImage: state.user.profileImage, bookingQuestionsEnabled: state.user.bookingQuestionsEnabled, bookingQuestions: state.user.bookingQuestions });
    } else {
      state.users.push({ id: state.user.id, name: state.user.name, email, role: state.user.role, school: state.user.school, year: state.user.year, interests: state.user.interests, goal: state.user.goal, field: (state.user.interests || "").split(",")[0].trim(), profileImage: state.user.profileImage, bookingQuestionsEnabled: state.user.bookingQuestionsEnabled, bookingQuestions: state.user.bookingQuestions, status: "Active" });
    }
    rememberRecentAccount(state.user, authToken);
    persist(); render(); showToast("Your profile is looking good."); return;
  }
  if (form.id === "change-password-form") {
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") || "");
    const newPassword = String(data.get("newPassword") || "");
    const confirmPassword = String(data.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      showToast("The new passwords don't match.");
      return;
    }
    if (newPassword === currentPassword) {
      showToast("Choose a new password different from your current one.");
      return;
    }
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Password change failed (HTTP ${response.status}).`);
      closeModal();
      showToast(payload.message || "Your password has been changed.");
    } catch (error) {
      console.error("Unable to change password", error);
      logTestError("Password change", error);
      showToast(error.message || "Your password could not be changed.");
      submitButton.disabled = false;
    }
    return;
  }
  if (form.id === "auth-form") {
    const data = new FormData(form);
    const email = normalizeEmail(data.get("email"));
    const submitButton = form.querySelector('button[type="submit"]');
    let accountRestored = false;
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
        accountRestored = Boolean(payload.restored);
        if (navigationOwnerId && navigationOwnerId !== payload.user.id) {
          state.view = "discover";
          state.profileId = "";
          state.activeConversationId = "";
        }
        navigationOwnerId = payload.user.id;
        state.user = payload.user;
        resetPollTracker(state.user.id);
        state.adminPollResults = null;
        syncPollState().catch(error => console.error("Unable to load poll status", error));
        if (!state.user.isAdmin) state.adminAccounts = [];
        selectedProfileImage = state.user.profileImage || "";
        rememberRecentAccount(state.user, authToken);
        initializeNotificationState();
        await updatePresence();
        await syncCommunityAccounts();
        await syncConnections();
        await syncNotifications();
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
    persist(); document.getElementById("auth-root").classList.remove("active"); document.querySelector(".app-shell").style.display = ""; render(); focusPageHeading(); showToast(accountRestored ? "Your account has been restored. Welcome back!" : "You're in. Welcome to the community!");
  }
});
document.getElementById("mobile-menu").addEventListener("click", () => {
  const isOpen = document.getElementById("mobile-menu").getAttribute("aria-expanded") === "true";
  setMobileNavigation(!isOpen);
  if (!isOpen) document.querySelector("#sidebar [data-view]")?.focus();
});
setMobileNavigation(false);
const mobileNavigationMedia = window.matchMedia("(max-width: 760px)");
if (typeof mobileNavigationMedia.addEventListener === "function") {
  mobileNavigationMedia.addEventListener("change", () => setMobileNavigation(false));
} else {
  mobileNavigationMedia.addListener(() => setMobileNavigation(false));
}
modalRoot.addEventListener("click", event => {
  if (event.target === modalRoot) {
    if (modalRoot.querySelector("#experience-poll-form")) {
      pollSnoozedUntilActivityMs = pollActiveMs + pollSnoozeDurationMs;
    }
    closeModal();
  }
});
document.addEventListener("pointerdown", recordPollActivity, { passive: true });
document.addEventListener("touchstart", recordPollActivity, { passive: true });
document.addEventListener("keydown", recordPollActivity);
document.addEventListener("input", recordPollActivity);
document.addEventListener("keydown", event => {
  const openDialog = modalRoot.classList.contains("open")
    ? modalRoot.querySelector('[role="dialog"]')
    : callRoot.querySelector('[role="dialog"]');
  if (event.key === "Tab" && openDialog) {
    const focusable = [...openDialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.hidden && element.getClientRects().length);
    if (!focusable.length) {
      event.preventDefault();
      openDialog.focus();
    } else if (event.shiftKey && (document.activeElement === focusable[0] || !openDialog.contains(document.activeElement))) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && (document.activeElement === focusable[focusable.length - 1] || !openDialog.contains(document.activeElement))) {
      event.preventDefault();
      focusable[0].focus();
    }
  }
  if (event.key === "Escape" && modalRoot.classList.contains("open")) {
    event.preventDefault();
    if (modalRoot.querySelector("#experience-poll-form")) {
      pollSnoozedUntilActivityMs = pollActiveMs + pollSnoozeDurationMs;
    }
    closeModal();
  } else if (event.key === "Escape" && !document.getElementById("notification-menu").hidden) {
    closeNotificationMenu();
    document.getElementById("notifications").focus();
  } else if (event.key === "Escape" && document.getElementById("mobile-menu").getAttribute("aria-expanded") === "true") {
    setMobileNavigation(false);
    document.getElementById("mobile-menu").focus();
  }
});
render();
if (normalizeEmail(savedUser.email) && authToken) {
  document.getElementById("auth-root").classList.remove("active");
  document.querySelector(".app-shell").style.display = "";
  resetPollTracker(state.user.id);
  syncPollState().catch(error => console.error("Unable to load poll status", error));
  initializeNotificationState();
  updatePresence();
  syncCommunityAccounts();
  syncConnections();
  syncNotifications();
  syncCalls();
  if (state.view === "admin" && state.user.isAdmin) {
    syncAdminDashboard().then(render).catch(error => {
      console.error("Unable to load admin accounts", error);
      state.view = "discover";
      render();
      showToast(error.message || "The admin area could not be loaded.");
    });
  }
} else {
  showAuth("login");
  syncCommunityAccounts();
}
setInterval(checkExperiencePoll, 1000);
setInterval(() => updatePresence(), 25000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") updatePresence();
});
window.addEventListener("online", () => updatePresence());
setInterval(() => {
  syncCommunityAccounts();
  syncConnections();
  syncCalls();
  if (state.view === "messages" && state.activeConversationId) syncConversation(state.activeConversationId);
}, 1800);
setInterval(syncNotifications, 15000);