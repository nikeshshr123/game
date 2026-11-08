# Museum of Us

A 3D picture museum you walk through on a phone (on-screen joystick) or a computer (W A S D / arrow keys, drag to look). Visitors enter their name, gender and age, walk past the pictures you upload, and at the end meet a character holding a rose who asks your question. Their answers appear in the admin panel.

- **Visitors** need no account.
- **Admin login:** username `admin`, password `admin123` (change these in Render, see step 3).

## Deploy (about 10 minutes, free)

### 1. Create the database (Supabase, free)
1. Sign up at [supabase.com](https://supabase.com) and create a **New project** (any name, pick a region near you, save the database password somewhere).
2. Open **SQL Editor → New query**, paste everything from [`supabase/schema.sql`](supabase/schema.sql), and press **Run**. This creates the tables and a `pictures` storage bucket.
3. Open **Project Settings → API** (or **API Keys**) and copy:
   - the **Project URL** (looks like `https://abcd1234.supabase.co`)
   - the **service_role** secret key. Keep this private; never put it in the website code.

### 2. Create the web service (Render, free)
1. Sign in at [render.com](https://render.com) with your GitHub account.
2. Click **New → Blueprint** and choose this repository. Render reads `render.yaml`.
3. When asked, paste `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from step 1, then click **Apply**.
4. Wait for the deploy to finish and open the `https://…onrender.com` address it shows.

### 3. Change the admin password (recommended)
In Render, open the service → **Environment**, change `ADMIN_PASSWORD` (and `ADMIN_USER` if you like), and save. Render redeploys automatically.

## Using it
1. Open your site, tap **Admin login**, and sign in.
2. **Pictures:** upload photos, give each a title and description, reorder or delete them.
3. **Museum & proposal:** set the museum name, your question, the answer buttons, your name and your character.
4. Share the site link. **Visitors & answers** shows everyone who enters and what they chose, refreshing every 10 seconds.

## Notes
- Render's free plan sleeps after 15 minutes without visitors, so the first visit after a break can take about a minute to load. Open it yourself shortly before sharing.
- Without the two Supabase keys the app still runs, but saves to local files that Render's free plan erases on every restart.

## Run on your computer
```bash
npm install
npm start
# open http://localhost:3000
```
