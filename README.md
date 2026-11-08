# Vacation Planner

Plan vacations by cost: build and compare options, then track the chosen trip's real spending in ₪ across currencies and payment methods. See [SPEC.md](SPEC.md).

Live: https://matanyaa.github.io/vacation-planner/

## Stack
Plain HTML/CSS/JS ES modules, no build step. Firebase Auth (Google) + Firestore with offline persistence. Hosted on GitHub Pages (branch `main`, root).

```
index.html, css/, icons/, manifest.json, sw.js (offline shell), version.json
js/app.js        router, auth, update prompt, offline-rate sweeper
js/firebase.js   Firebase init (config lives here)
js/store.js      live mirror of users/{uid}/{vacations,plans,entries,tx,rates,meta}
js/rates.js      official rates: Bank of Israel → ECB (Frankfurter) → open.er-api, cached in Firestore
js/calc.js       pure: categories, gratuity, entry ₪ cost, plan totals, comparison merging
js/wallet.js     pure: wallet ledger (average rates, debts/settlement, exchanges, corrections)
js/data.js       domain ops: plan lifecycle (choose, finalize, save for reuse), settings
js/views/*.js    screens
firebase/        Firestore rules (auto-deployed by .github/workflows/deploy-firestore-rules.yml)
tests/           node tests/engine.test.mjs
```

## Deploying
- **App:** push to `main`. Bump the version in `js/version.js`, `version.json` and `CACHE` in `sw.js` together so open copies show "Update available — refresh?".
- **Firestore rules:** edit `firebase/firestore.rules` and push; the GitHub Action deploys them. Needs the `FIREBASE_SERVICE_ACCOUNT` repo secret (service-account JSON from Firebase → Project settings → Service accounts).

## Local dev
Serve the folder (e.g. `npx http-server -p 8080 -c-1`) and open http://localhost:8080. `localhost` is an authorized Auth domain by default.
