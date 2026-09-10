# Checkout Reporter

A standalone bookmarklet that runs on the USEFULL Assignments admin page, pulls assignment rows through the panel's authenticated read request, deduplicates them locally, and exports:

[Open the installer](https://owenbarron.github.io/checkout-reporter/)

- daily totals with optional location and container-type breakdowns;
- timestamped grouped-transaction detail.

Multiple containers assigned to the same user at the same location within 30 seconds are one transaction by default. The threshold is editable in the side panel.

Daily downloads are broken out by location by default. The side panel has independent Location and Container type checkboxes, so either, both, or neither dimension can be included. The transaction log always includes the container name and type for each assignment.

The first sync pulls 14 days by default (editable up to 90). Later syncs resume from the newest locally stored assignment. A small internal overlap catches boundary rows, which assignment-ID deduplication safely skips.

The report refreshes the Assigned On table column automatically to establish the authenticated connection. Its own paginated requests are always ordered by Assigned On, newest first.

## Build and test

```bash
node scripts/build.mjs
node --test test/core.test.mjs
```

Open `dist/install.html`, then drag the teal link to your browser's bookmarks bar.

## Browser support

Desktop Chrome is tested. The reporter uses standard bookmarklet, Fetch, Shadow DOM, and IndexedDB features, so current desktop versions of Edge, Brave, and Firefox are expected to work. Safari and mobile browsers have not been tested. Saved report data is separate for each browser profile.

## Privacy and scope

- Data stays in IndexedDB in the browser profile where the bookmarklet runs.
- Assignment IDs are the primary deduplication key.
- The captured Firebase credential remains in memory only and is not persisted or exported.
- The GraphQL query requests only report fields and preserves a selected Corporate Client filter when one is present.
- If rows from more than one Corporate Client are detected, the sync stops before saving and asks the admin to select one client.
- This is a temporary client-side report, not a production admin-panel feature.
