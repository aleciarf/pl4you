# PL4YOU on Cloudflare Workers

This package contains the PL4YOU HTML site, a Cloudflare Worker, and the
Google Apps Script that stores club records and posters.

## 1. Set up Google storage

1. Sign in to the Google account with permission to create files in the
   [PL4YOU Drive folder](https://drive.google.com/drive/folders/1Am3JAoZG-3FJ2fS4pH2YsUrS6s83svhq).
2. At [Apps Script](https://script.google.com/), create a project and paste
   `google/Code.gs` into its `Code.gs` file. Save it. If you already deployed
   the earlier Watchclub version and want to carry over its data, use that
   same Apps Script project. Setup then reuses and moves its existing app
   database and poster folder. Archive the old web deployment after migration.
3. In **Project Settings → Script properties**, add `API_SECRET` with a long
   random value. Keep it for the Cloudflare setup.
4. Run `setup_` from the Apps Script editor and authorize Google access.
   It creates or reuses the Sheets database and the poster folder inside
   the supplied Drive folder. The execution log shows both links.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as** to **Me**
   and **Who has access** to **Anyone** so Cloudflare can call the backend.
   The API itself checks `API_SECRET` for every operation. Copy the deployed
   URL ending in `/exec`. If your Workspace blocks the **Anyone** option,
   use an account that permits it and can write to the storage folder.

## 2. Deploy the Cloudflare Worker

Install Node.js and run these commands from the extracted folder:

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put GOOGLE_SCRIPT_URL
npx wrangler secret put API_SECRET
```

- `GOOGLE_SCRIPT_URL` is the Apps Script `/exec` URL.
- `API_SECRET` must match the Apps Script property exactly.
Open the Worker URL printed by Wrangler, then add or select your member name.
Any visitor can switch profiles and edit shared titles and watchlists.
Files in the Drive folder follow that folder's Google sharing permissions.

## 3. Verify your deployment

Add a member and a test title with a JPG or PNG poster under 1 MB. Reload PL4YOU
and confirm the title and poster still appear. Check the supplied Drive folder
for the spreadsheet and the uploaded image inside the poster subfolder. Try
Tinderbox and confirm that **Watched** updates **My List** and **Stats**.

You can also open `public/index.html` directly to try the local browser demo.

[Cloudflare Worker assets](https://developers.cloudflare.com/workers/static-assets/binding/) ·
[Google web app deployment](https://developers.google.com/apps-script/guides/web)
