# MentorshipMatch

## Run the app

1. Install Node.js 18 or later.
2. Copy `.env.example` to `.env` and set `RESEND_API_KEY` and `RESEND_FROM` to your Resend API key and verified sender address. `onboarding@resend.dev` is for testing and Resend restricts its recipients; to verify other users, verify a domain in Resend and use a sender on that domain.
3. Start the app with `npm start`. The server loads values from `.env` automatically.
4. Open <http://localhost:3000> and register with an email address you can access.
5. Follow the verification link sent to your inbox, then sign in with your email and password.

Do not commit real API keys. `.env` is excluded by `.gitignore`.

Accounts are stored in `data/accounts.json` on the server. Passwords are stored as salted PBKDF2 hashes. Verification links expire after one hour. Use HTTPS and a durable database, session management, and appropriate privacy controls before deploying this prototype for real users.

Email delivery uses Resend. The sender address/domain must be verified with Resend. An email address is considered verified only after the recipient opens the one-time verification link.
