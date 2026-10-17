# My Car Log

Personal fuel, servicing and running-cost tracker. A Progressive Web App on GitHub Pages with Firebase for login and sync. No ads, no review prompts.

## What's in it

- **Vehicles**: as many as you like, switch from the top bar.
- **Fuel**: litres, c/L and total (enter any two, the third is worked out), full/partial tank, "missed a fill-up" flag, servo, notes.
- **Service & expenses**: category, cost, workshop, notes.
- **Receipt photos** on any entry (shrunk on the phone and stored in Firestore, so no paid Storage plan needed).
- **Home**: spend this year, all-time split, average and last-tank L/100km, cost per km, odometer.
- **Charts**: economy trend, monthly spend (12 months), spend by category, fuel price paid.
- **Import from My Car** (.xlsx or .csv export). Re-importing the same file skips rows already brought in.
- **Export CSV** per vehicle, for backups or your accountant.
- Works with no signal: entries save on the phone and sync when you're back online.

Fuel economy uses the full-to-full method, so tick "Filled the tank to full" when you brim it.
`my_car_history.csv` (sent separately; keep it out of the GitHub repo, since Pages is public) holds the My Car history for both vehicles: My Work Van (from the PDF report and Excel export, with litres, servo, and two partial fills marked) and NOOPIE (from its Events report and Excel export, with litres, servo, four partial fills and one fill after a missed fill-up marked). Two van fill-ups that followed an unlogged fill (12 Mar 2024 and 29 Jun 2026) are flagged so they don't drag the economy average down.

## Setup (about 15 minutes)

1. **Firebase project.** Go to console.firebase.google.com and add a project (e.g. `carlog`). Analytics isn't needed.
2. **Web app.** Project settings → General → Your apps → Web (`</>`). Register it, then copy the `firebaseConfig` values into `firebase-config.js`.
3. **Sign-in.** Build → Authentication → Get started. Enable **Email/Password** and **Google**.
4. **Database.** Build → Firestore Database → Create database (location `australia-southeast1`, production mode). On the **Rules** tab, paste in the contents of `firestore.rules` and publish.
5. **GitHub.** Create a repo (e.g. `carlog`), upload all these files, then Settings → Pages → deploy from the `main` branch, root folder.
6. **Authorise the domain.** Authentication → Settings → Authorized domains → add `<your-github-username>.github.io`.
7. **Install on your phone.** Open the GitHub Pages link. iPhone: Share → Add to Home Screen. Android: menu → Install app.
8. **Import your history.** Garage → Import from My Car → pick `my_car_history.csv`.

On an iPhone home-screen app, email/password sign-in is the most reliable. Google sign-in from inside the installed app can be blocked by Safari's privacy rules.

## Updating

After changing any file, bump `VERSION` in `sw.js` (e.g. `carlog-v2`) so phones fetch the new version.

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell |
| `styles.css` | Look and feel (light and dark mode) |
| `app.js` | Screens, forms, Firebase reads and writes |
| `calc.js` | Economy, totals, charts data, CSV export |
| `import.js` | Reads the My Car export |
| `firebase-config.js` | Your Firebase keys |
| `firestore.rules` | Security rules: each user sees only their own data |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app and offline support |
