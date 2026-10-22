# MentorshipMatch

## Run the app

1. Install Node.js 18 or later.
2. For this demo, leave `EMAIL_DELIVERY_MODE=demo` in `.env.example` (or set it in `.env`). Registration will show a local verification link in the sign-in screen; no email is sent.
3. Start the app with `npm start`. The server loads values from `.env` automatically.
4. Open <http://localhost:3000>, create an account, and open the **Verify email for demo** link shown after signup.
5. Return to the sign-in screen and sign in with your email and password.

For real email delivery, set `EMAIL_DELIVERY_MODE=resend`, `RESEND_API_KEY`, and `RESEND_FROM` in `.env`. The sender address/domain must be verified in Resend. `onboarding@resend.dev` is for testing and Resend restricts its recipients; verify your own domain to send verification emails to other users. Do not commit real API keys. `.env` is excluded by `.gitignore`.

Accounts are stored in `data/accounts.json` on the server. Passwords are stored as salted PBKDF2 hashes. Verification links expire after one hour. Use HTTPS and a durable database, session management, and appropriate privacy controls before deploying this prototype for real users.

Email verification links expire after one hour. In demo mode, the link is shown on screen and does not prove mailbox ownership. In Resend mode, an email address is verified only after the recipient opens the one-time link delivered to that mailbox.
_