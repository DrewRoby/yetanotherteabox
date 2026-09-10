# Tech Stack Document

This document explains the technologies chosen for **Teabox**, our "consignment-shop-in-a-box" application, in everyday language. It shows what we used on the front end, back end, infrastructure, third-party services, and how we keep things secure and fast. Anyone can read this and understand why each piece is there.

---

## 1. Frontend Technologies

These are the tools we used to build the part of Teabox that runs in your web browser:

- **React.js**
  - A popular JavaScript library for building user interfaces.
  - Lets us create reusable components (like buttons, forms, tables) and update them quickly when data changes.
- **Tailwind CSS**
  - A utility-first CSS framework for styling.
  - Speeds up design so our Ming Dynasty–inspired theme (crimson, gold, black, white, bone) comes together fast and stays consistent.
- **Webpack**
  - Bundles all our JavaScript, CSS, and assets into optimized files.
  - Ensures users download only what they need for a fast load.
- **Electron (optional kiosk mode)**
  - Wraps the browser app into a desktop application if you need a locked-down register or intake station.
- **Responsive, Desktop-First Layout**
  - Optimized for 1920×1080 and larger screens.
  - Dense information layout, clear sans-serif fonts, no frills—designed for power users.

**Why these choices?**
- React + Tailwind give us speed in development and a consistent look.
- Webpack keeps load times short.
- Electron lets us run the same code as a standalone desktop app if desired.

---

## 2. Backend Technologies

This is what powers Teabox behind the scenes, managing your data, devices, and business logic:

- **Node.js & Express**
  - A JavaScript runtime and web framework.
  - Handles API requests from the browser, device integrations, and local server duties.
- **PostgreSQL**
  - Our main database for storing inventory, accounts, transactions, and reports.
  - Reliable, open source, and well-suited for complex queries.
- **Prisma ORM**
  - A developer‐friendly tool for interacting with PostgreSQL using JavaScript/TypeScript.
  - Simplifies queries and migrations while catching errors early.
- **SQLite Sync Adapter**
  - A lightweight local database that mirrors PostgreSQL when internet is down.
  - Ensures the POS, inventory, and accounting still work fully offline.
- **Cloud Sync Service**
  - Runs in **Azure Functions** or **DigitalOcean App Platform**.
  - Listens for local changes (heartbeats every 10 minutes) and syncs to a cloud PostgreSQL instance.
- **File Storage**
  - **Azure Blob Storage** or **DO Spaces** for item photos and backups.
- **Thermal Printer & Devices**
  - Integrates with the Epson TM-T88V (T570) over Ethernet using ESC/POS commands.
  - Stubs for barcode scanners and cash drawers using generic HID or serial standards.
- **Blockchain Prototype**
  - **Hyperledger Fabric** for future escrow and item-tracking features.
  - Stores only hashes on chain, keeps actual data off chain to protect privacy.

**How it works together:**
1. **Local server** runs Node.js + Express with PostgreSQL as the source of truth.
2. If PostgreSQL is unreachable, the SQLite adapter takes over seamlessly.
3. Every 10 minutes, the sync service pushes updates to the cloud and pulls in new marketplace requests.
4. Devices (printer, scanner, register) connect locally to update the system in real time.

---

## 3. Infrastructure and Deployment

The backbone that keeps Teabox running smoothly, up to date, and easy to manage:

- **Hosting Platforms**
  - **On-Premises**: Commodity PC or small server running Linux (preferred) or Windows.
  - **Cloud**: Microsoft Azure or DigitalOcean.
- **Containerization**
  - **Docker** for packaging all services (Node.js, PostgreSQL, sync workers) into portable containers.
- **Version Control**
  - **Git** hosted on **GitHub** for source code and configuration.
- **CI/CD Pipeline**
  - **GitHub Actions** to build, test, and push Docker images to a registry.
  - Automatic deployment to Azure App Service or DO App Platform when code is merged to main.
- **Backup & Monitoring**
  - Automated database and photo backups to Azure Blob or DO Spaces.
  - Heartbeat monitor logs last check-in time, alerts if a store hasn’t synced in >10 min.

**Benefits:**
- Containers ensure the same environment everywhere: your basement server or the cloud.
- CI/CD automates tests and deployments, reducing human error.
- GitHub keeps a history of changes and makes collaboration easier.

---

## 4. Third-Party Integrations

We connect to several external services to enhance Teabox’s capabilities:

- **Payment Terminals**
  - External terminals handle card data; Teabox simply logs the result (no PCI burden).
- **Thermal Tag Printer**
  - Epson TM-T88V via ESC/POS over Ethernet for printing item tags.
- **Computer Vision API**
  - **Azure Cognitive Services Computer Vision** (or optional DigitalOcean GPU droplet with YOLO).
  - Gives automated suggestions for brand, style, serial numbers, and common metadata.
- **Email Service**
  - **SendGrid** or **Mailgun** for scheduled report emails (daily sales, aging inventory, consignor statements).
- **Blockchain Networks**
  - **Hyperledger Fabric** private network for future escrow and inter-store transactions.

**Why these services?**
- Offloading payments and email reduces compliance scope.
- Using a managed CV API speeds up development and keeps a path open for future on-prem inference.
- Blockchain adds transparency without exposing sensitive PII or large data.

---

## 5. Security and Performance Considerations

### Security Measures

- **Transport Encryption**: TLS (HTTPS) on all web and device communication.
- **Data Encryption at Rest**: AES-256 for database backups, Blob/Spaces storage.
- **Role-Based Access Control (RBAC)**:
  - System Administrator, Owner, Manager, Employee, Register (device), Consignor, Vendor, Donor, Booth Owner.
  - Fine-grained permissions ensure users only see what they need.
- **Audit Trails**:
  - Last-write-wins conflict resolution with logs for any sync or data merge.
- **Password Policies**: Secure passwords, email verification, reset links.

### Performance Optimizations

- **Offline-First**: Local SQLite fallback keeps POS and intake blazing fast even without internet.
- **Database Indexing**: Key fields (SKU, barcode, dates) are indexed for sub-200ms queries.
- **Lazy Loading & Pagination**:
  - Inventory lists and reports load in pages to avoid overwhelming the browser.
- **Batch Syncs**: Group updates during heartbeat to minimize network overhead.
- **CDN for Static Assets**: Frontend JavaScript and CSS loaded from a global CDN (if you choose cloud-hosted front end).

These strategies ensure Teabox stays responsive for staff and resilient against connectivity issues.

---

## 6. Conclusion and Overall Tech Stack Summary

We chose a modern, battle-tested stack that matches Teabox’s goals:

- **React + Tailwind** for a rich, desktop-focused interface with a Ming Dynasty aesthetic.
- **Node.js + Express + PostgreSQL + Prisma** for a robust, JavaScript-centric backend.
- **SQLite Adapter** for seamless offline operation on the local server.
- **Azure/DigitalOcean** for cloud sync, CV APIs, and backups—flexible to your budget.
- **Docker + GitHub Actions** for consistent deployments and developer productivity.
- **Third-party APIs** (printer, payment terminal, email, blockchain) to reduce compliance burdens and speed up feature delivery.
- **Security** built in with encryption, RBAC, and audit trails.
- **Performance** tuned with offline-first design, indexing, lazy loading, and batch syncs.

This tech stack supports every part of the consignment business: from item intake and detailed inventory tracking, through consignment accounting and POS, to reporting and a multi-store marketplace. It keeps critical functions local, so you never lose sales, while giving you the power of the cloud for backups, analytics, and future growth (including blockchain-based escrow). Teabox is designed to grow with your shop and your network of partner stores, all powered by a coherent, easy-to-understand technology foundation.