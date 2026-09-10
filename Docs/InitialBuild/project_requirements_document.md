# Project Requirements Document (PRD)

## 1. Project Overview

**Teabox** is a desktop-first, browser-native “consignment-shop-in-a-box” solution designed for small community shops. It bundles core ERP functions—inventory, accounting, item intake, point-of-sale (POS), and reporting—onto a locally-hosted server that works offline and automatically syncs to the cloud every 10 minutes. Beyond running in a single store, Teabox also offers an opt-in networked marketplace: stores can request items from one another and coordinate shipping, maximizing value and revenue for consignors and shop owners. The system’s rich, information-dense interface follows a Ming Dynasty aesthetic (crimson, gold, black, white, bone) with clear, no-frills typography.

The main goals are reliability (full local operation when the internet drops), ease of use for low-tech staff, and deep support for consignment-business quirks. Success criteria include zero downtime during internet outages, accurate lifecycle tracking for every secondhand item, seamless device integrations (barcode/scanner/printer), and a straightforward multi-store “request/offer” workflow. Long-term, Teabox will scale into a self-hosted blockchain network to automate escrow and supply-chain transparency, but that’s slated for later phases.

## 2. In-Scope vs. Out-of-Scope

### In-Scope (Version 1)
- Inventory system: full lifecycle tracking (intake, sale, return, donation, disposal) of clothing, books, housewares, electronics, media, etc.
- Account management: support for traditional consignment, buy-outright, booth rentals, and donations, with dynamic payout and liability tracking.
- Intake interface: manual entry + thermal-printer tag printing; computer-vision stub module (cloud-dependent) for later enhancement.
- POS module: multi-register, multi-store, multi-employee support; scanner, cash drawer, payment terminal stubs; daily reconciliation export.
- Reporting & dashboards: consignor portals, store-manager and owner views, scheduled email reports.
- Cloud backup/service heartbeat: sync every ≤10 min; permanent retention; encrypted in transit and at rest.
- Multi-store marketplace (opt-in): request→offer→store acceptance→shipping tracking dialogue.
- UI styling: Ming Dynasty theme, information-dense layout, readable sans-serif fonts.

### Out-of-Scope (Version 1)
- Full offline computer-vision inference—CV requires internet in v1.
- Built-in payment processing (handed off to terminals, no PCI integration beyond logging).
- GDPR or EU data-privacy compliance (US-only focus).
- Mobile-first or native smartphone apps.
- On-chain escrow/smart-contract logic (blockchain research and prototype only).
- Complex dynamic pricing or AI-driven price suggestions.

## 3. User Flow

When a store sets up Teabox, the system installer launches on a Linux or Windows server. The System Administrator creates an Owner account, configures local network settings, and connects POS devices (scanner, cash drawer, Epson T570 printer). The Owner invites Managers and Employees, assigning roles and permissions. Each Manager logs in to review dashboards: inventory turns, pending consignor payouts, donation logs, and low-stock alerts.

During daily operation, an Employee opens the intake screen on a mounted phone camera. They scan or photograph an item; metadata fields (brand, pattern, serial number) are filled manually or queued for cloud CV processing. A thermal tag prints automatically. When a customer checks out, the Employee logs in at Register #1, scans item tags, and records payment on the terminal. The POS closes the sale, updates inventory status to “sold,” and logs payout liabilities. Every 10 minutes, the local database syncs changes to the cloud and checks for inter-store requests or updates.

## 4. Core Features

- **Inventory Management**: item creation, detail fields (size, style, genre, serial), lifecycle states, history of past entries.
- **Consignment Accounting**: multiple consignment types, revenue splits, booth rentals, donation tracking, payout liabilities.
- **Intake Module**: barcode scanning, photo capture stub, manual metadata entry, thermal tag printing (Epson TM-T88V over Ethernet).
- **Point of Sale**: multi-device support (scanner, cash drawer, payment terminal), multiple registers, user logins, daily reconciliation exports.
- **Reporting & Dashboards**: real-time store owner and manager panels, consignor portal, scheduled email reports, aging inventory and payout statements.
- **Cloud Backup & Sync**: heartbeat monitor, encrypted sync every ≤10 min, permanent data retention.
- **Multi-Store Marketplace**: opt-in item request/offers, host-store acceptance, shipping coordination workflow, status tracking.
- **User Roles & Permissions**: System Admin, Owner, Manager, Employee, Register (device), Consignor, Vendor, Donor, Booth Owner.

## 5. Tech Stack & Tools

- **Frontend**: React.js (desktop-optimized), Tailwind CSS for rapid styling, Webpack, Electron wrapper (optional for kiosk mode).
- **Backend**: Node.js with Express; Local database = PostgreSQL; ORM = Prisma.
- **Edge / Offline Engine**: SQLite sync adapter for local operations when PostgreSQL unreachable.
- **Cloud Sync**: Backend microservice in Azure Functions (or DigitalOcean App Platform) writing to cloud PostgreSQL; Azure Blob Storage (or DO Spaces) for backups.
- **Computer Vision Stub**: Azure Cognitive Services Computer Vision API (or optional DigitalOcean GPU droplet + Ultralytics YOLO26).
- **Thermal Printer Integration**: ESC/POS over Ethernet to Epson TM-T88V.
- **Blockchain Prototype**: Hyperledger Fabric (private network) for future escrow tracking.
- **CI/CD & DevOps**: Docker containers, GitHub Actions, VS Code.

## 6. Non-Functional Requirements

- **Performance**: UI actions respond within 200 ms; sync jobs complete within 30 s.
- **Reliability**: 99.5% uptime locally; offline mode supports full inventory, POS, accounting writes.
- **Sync SLA**: cloud heartbeat & data sync every ≤10 minutes.
- **Security**: TLS for all network traffic; AES-256 at rest; role-based access control.
- **Usability**: optimized for 1920×1080 and larger; tooltips and inline documentation; keyboard shortcuts for power users.

## 7. Constraints & Assumptions

- Target hardware: commodity PCs or small form-factor servers (Linux or Windows). No specialized GPU on-premise.
- Internet may be intermittent; local server must never block POS.
- No PCI-level payment processing; terminals handle card data off-site.
- Users in central US; no GDPR/CCPA burden.
- Stakeholders can invest in Azure or DigitalOcean as cloud provider.

## 8. Known Issues & Potential Pitfalls

- **Device Driver Variability**: scanner and cash drawer models differ—use generic HID/Serial stubs, allow manual driver configuration.
- **Data Sync Conflicts**: concurrent edits offline vs. cloud may cause merge conflicts—implement last-write-wins with audit trails.
- **CV Accuracy**: cloud vision latency and false matches—establish manual review queues.
- **Marketplace Race Conditions**: two stores request the same item—enforce request/offer sequence and reservations with expiry timer.
- **Blockchain Overhead**: Hyperledger Fabric adds complexity—keep as a prototype until core features stabilize.

---
*End of PRD. This document serves as the blueprint for all subsequent technical designs.*