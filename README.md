# MentorshipMatch

## Run the app

1. Install Node.js 18 or later.
2. Start the app with `npm start`. The server loads values from `.env` automatically.
3. Open <http://localhost:3000>, create an account, and sign in immediately with your email and password.

Accounts are stored in `data/accounts.json` on local servers or in the `mentorship_accounts` Neon table on Vercel. Passwords are stored as salted PBKDF2 hashes. Email verification is not used.
## Neon on Vercel

Connect the Vercel project to the `neon-aureolin-cushion` Neon database. Add its connection string as `POSTGRES_URL` (or `DATABASE_URL`) in the Vercel project environment settings. Neon-backed deployments store accounts in `mentorship_accounts`; local JSON storage is used only for development.

The local `.env` file is not uploaded to Vercel. In the Vercel project, open **Settings > Environment Variables** and add `POSTGRES_URL` for Production, Preview, and Development, then redeploy.

## Deploy to Vercel

1. Push the repository to GitHub and import it at https://vercel.com/new.
2. Vercel should detect `vercel.json` and deploy it as a Node.js site.
3. Optionally set `APP_ORIGIN` after deployment to the final Vercel URL.

The included file account store is temporary on Vercel and may reset between deployments or serverless executions. Connect a hosted database before launching a real service.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, choose **New > Blueprint** and select the GitHub repository.
3. Open the deployed service's environment settings and set `APP_ORIGIN` to the public Render URL, for example `https://mentorshipmatch.onrender.com`, without a trailing slash.
4. Redeploy after setting `APP_ORIGIN`.

GitHub Pages is not suitable for this app because it has a Node server and writes accounts to `data/accounts.json`. Render's free web service is stateless; accounts and verification state may be lost when the service restarts. For a real site, use a persistent disk or database.
_