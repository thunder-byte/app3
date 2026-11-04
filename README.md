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

## Deploy to Vercel

1. Push the repository to GitHub and import it at https://vercel.com/new.
2. Vercel should detect `vercel.json` and deploy it as a Node.js site.
3. Keep `EMAIL_DELIVERY_MODE=demo`, or configure Resend variables for email delivery.
4. Optionally set `APP_ORIGIN` after deployment to the final Vercel URL.

Vercel provides `VERCEL_URL` automatically, so verification links can be generated without manual configuration.

The included file account store is temporary on Vercel and may reset between deployments or serverless executions. Connect a hosted database before launching a real service.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, choose **New > Blueprint** and select the GitHub repository.
3. Open the deployed service's environment settings and set `APP_ORIGIN` to the public Render URL, for example `https://mentorshipmatch.onrender.com`, without a trailing slash.
4. Redeploy after setting `APP_ORIGIN`.

GitHub Pages is not suitable for this app because it has a Node server and writes accounts to `data/accounts.json`. Render's free web service is stateless; accounts and verification state may be lost when the service restarts. For a real site, use a persistent disk or database and configure real email delivery with Resend.
_