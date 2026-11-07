# Integrated owner analytics

The owner uses one **Analytics** item in the POS sidebar. Horizontal tabs contain Overview, Sales, Inventory, Forecasts, AI analyst, Alerts and Connection. The existing local Overview and reports remain available offline.

Use the established POS tokens: panel white #ffffff, background #f4f6f7, ink #1c2b30, green #15704f, muted #718187 and amber #936522. Reuse bundled Inter/Sinhala fonts, existing buttons and Radix dialogs. Tabs form a clear horizontal section boundary. Revenue, trends and stock exceptions carry the visual emphasis, with dense readable tables and no duplicate app shell or decorative login page. Dark mode inherits the POS theme variables.

The main process holds the cloud owner bearer session and sends validated API requests. The renderer receives only report/status data through named IPC actions. It never obtains owner/device tokens or unrestricted network access. Unavailable server connectivity hides desktop online reports and disables their actions.

The Connection tab performs owner sign-in, direct POS pairing, synchronization controls and device revocation. PostgreSQL remains the cloud projection; the mobile native app uses the API directly. The former browser project, static hosting, browser cookies and browser launch/build scripts are removed.

Verify native IPC authorization, direct pairing, report rendering, network loss/recovery, offline local checkout, session clearing, mobile cache behavior and native bundles using isolated data.
