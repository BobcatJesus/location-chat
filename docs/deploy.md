## Frontend Deploy

Production frontend is hosted on Netlify at `https://rad-cassata-e95d89.netlify.app`.

Important: this site is currently using Netlify Drop, not a repo-connected build. A `git push` to `main` does not publish frontend changes by itself.

### Current Build Settings

- Build command: `npm run build`
- Publish directory: `dist`
- Backend env var: `VITE_BACKEND_URL=https://location-chat-production.up.railway.app`

### Manual Publish Steps

1. Run `npm run build`
2. Upload the contents of `dist` to the Netlify project `rad-cassata-e95d89`
3. After publish, verify the site loads a new `assets/index-*.js` bundle

### Notes

- The production site was manually re-published from Netlify Drop on Aug 9, 2026 to ship the mobile chat overlay fixes in commit `974b663`.
- If you want pushes to `main` to deploy automatically, this Netlify site must be reconfigured to use the GitHub repo `https://github.com/BobcatJesus/location-chat.git` as its deploy source.