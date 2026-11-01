# Cloudflare Pages Free Deployment Guide

This guide walks through deploying **DuoWatch** to **Cloudflare Pages** completely free of charge.

## Zero-Cost Guarantee
- **Cloudflare Pages Free Tier**:
  - Unlimited bandwidth
  - Unlimited requests
  - Free `*.pages.dev` subdomain
  - Free custom domain support with automated SSL/TLS
  - 500 builds per month

---

## Step 1: Push Code to GitHub

Initialize your local git repository and push to GitHub:

```bash
cd C:\DuoWatch
git init
git add .
git commit -m "feat: complete DuoWatch private cinema implementation"
git branch -M main
git remote add origin https://github.com/<your-username>/duowatch.git
git push -u origin main
```

---

## Step 2: Connect to Cloudflare Pages

1. Log into your free account at [Cloudflare Dashboard](https://dash.cloudflare.com).
2. In the left navigation, select **Workers & Pages**.
3. Click **Create Application** > **Pages** > **Connect to Git**.
4. Select your `duowatch` repository from GitHub.
5. In the **Set up builds and deployments** section, configure the following:
   - **Project Name**: `duowatch` (or your preferred name)
   - **Production Branch**: `main`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Build Output Directory**: `dist`
   - **Root Directory**: `/` (leave empty/default)

---

## Step 3: Configure Environment Variables

Under **Environment Variables (advanced)**, add:

| Variable Name | Value | Description |
|---|---|---|
| `NODE_VERSION` | `20` | Ensures modern Node.js build runtime |
| `VITE_SUPABASE_URL` | `https://your-project-id.supabase.co` | Your free Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGci...` | Your public `anon` key from Supabase API settings |
| `VITE_STUN_SERVERS` | `stun:stun.l.google.com:19302,stun:global.stun.twilio.com:3478` | Public STUN servers |
| `VITE_ENABLE_LOCAL_FALLBACK` | `false` | Disable broadcast channel fallback in production |

> **Security Note:** Never add `SUPABASE_SERVICE_ROLE_KEY` to Cloudflare Pages environment variables. DuoWatch only uses the public `anon` key.

---

## Step 4: Deploy & Verify SPA Routing

1. Click **Save and Deploy**.
2. Cloudflare Pages will fetch dependencies, execute `npm run build`, and publish your site in ~45 seconds.
3. DuoWatch includes `public/_redirects` which instructs Cloudflare Pages to route all deep links (`/room/:code`, `/join`, `/create`, `/privacy`) to `/index.html`:
   ```
   /*  /index.html  200
   ```
4. Access your live deployment at `https://duowatch.pages.dev`.

---

## Step 5: (Optional) Custom Domain

1. Go to your Cloudflare Pages project settings > **Custom Domains**.
2. Click **Set up a domain**.
3. Enter your domain name. Cloudflare provides free automated SSL/TLS certificates and global HTTP/3 edge routing.
