# Backend Structure Document

This document explains the backend architecture, hosting solutions, and infrastructure components for **Teabox**, our consignment-shop-in-a-box system. It uses everyday language so that anyone can understand how the backend is built and why each part exists.

---

## 1. Backend Architecture

### Overall Design

• **Monolithic core + Microservices**: The core ERP (inventory, accounts, intake, POS, reporting) runs on a single Node.js/Express service locally. Cloud-only features (computer vision, marketplace sync) live in small serverless functions or containerized microservices.  
• **MVC & Repository Patterns**: Business logic is organized into Controllers (handling HTTP requests), Services/Repositories (data access), and Models (Prisma definitions).  
• **Adapters & Strategies**: Device integrations (printer, scanner, cash drawer) and sync logic use adapter classes. This makes it easy to swap in new hardware or cloud providers.

### Scalability, Maintainability, Performance

• **Local & Cloud Separation** keeps critical functions running offline while letting cloud components scale independently.  
• **Stateless Cloud Services** (Azure Functions or DigitalOcean App Platform) can auto-scale based on load.  
• **Containerization** (Docker) ensures the same environment on a store’s PC or in the cloud.  
• **ORM (Prisma)** centralizes data access patterns, simplifies migrations, and catches schema drift early.  

---

## 2. Database Management

• **Primary Database: PostgreSQL** in both local and cloud deployments. Ideal for complex queries (inventory searches, reports).  
• **Offline Fallback: SQLite** sync adapter. If the local Postgres is unreachable, the app writes to SQLite and replays changes later.  
• **ORM: Prisma** manages schema, migrations, and type-safe queries in JavaScript/TypeScript.  
• **Data Sync & Heartbeat**: Every ten minutes, a sync service pushes local changes to cloud Postgres and pulls marketplace requests. If a store doesn’t check in, an alert fires.  
• **Data Management Practices**:  
  – **Last-Write-Wins** conflict resolution with audit logs.  
  – **Permanent Retention** of all records; users can’t delete their data (except where law requires).  
  – **AES-256 Encryption** at rest; TLS for all network traffic.  

---

## 3. Database Schema

Below is a human-readable overview of the main tables. After that, you’ll find PostgreSQL schema definitions.

### Human-Readable Schema

• **Users**: store owners, managers, employees, and devices (registers). Each user has a role, email, name, and password hash.  
• **Roles**: System Administrator, Owner, Manager, Employee, Register (device), Consignor, Vendor, Donor, Booth Owner.  
• **Stores**: shop locations. Each user belongs to one store.  
• **Devices**: barcode scanners, cash drawers, printers tied to a store.  
• **Items**: every piece of inventory, unique by SKU. Tracks category, brand, style, serial number, condition, consignment type, status, intake date, price, and owning store.  
• **ItemHistory**: records every change to an item (price update, status change, edits).  
• **Photos**: URLs for item images stored in blob storage.  
• **Transactions (Sales)**: captures item sales, sale price, date, payment type, register used, and cashier.  
• **Consignors / Vendors / Donors / BoothOwners**: contact details, payment method, current balance for each external partner.  
• **Payouts**: records when consignors are paid, amount, and status.  
• **MarketplaceRequests**: when one store requests an item from another, with offer price and status.  
• **Offers**: consignor & host-store responses to a request.  
• **ShippingLogs**: tracks send/receive dates between stores.  
• **Heartbeats**: last sync times per store, for monitoring.  
• **AuditLogs**: immutable log of key actions and sync conflicts.

### PostgreSQL Schema (Simplified)

```sql
-- Roles
CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

-- Users (includes devices as "Register" role)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role_id INT REFERENCES roles(id),
  store_id INT REFERENCES stores(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Stores
CREATE TABLE stores (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  owner_id INT REFERENCES users(id)
);

-- Devices
CREATE TABLE devices (
  id SERIAL PRIMARY KEY,
  name TEXT,
  type TEXT,
  connection_info JSONB,
  store_id INT REFERENCES stores(id),
  status TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Items
CREATE TABLE items (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  category TEXT,
  subcategory TEXT,
  brand TEXT,
  style TEXT,
  pattern TEXT,
  size TEXT,
  serial_number TEXT,
  condition TEXT,
  consignment_type TEXT,
  source_type TEXT,
  status TEXT,
  intake_date DATE,
  price NUMERIC(10,2),
  store_id INT REFERENCES stores(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Item History
CREATE TABLE item_history (
  id SERIAL PRIMARY KEY,
  item_id INT REFERENCES items(id),
  change_type TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by INT REFERENCES users(id),
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Photos
CREATE TABLE photos (
  id SERIAL PRIMARY KEY,
  item_id INT REFERENCES items(id),
  url TEXT,
  source TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Transactions (Sales)
CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  item_id INT REFERENCES items(id),
  sale_price NUMERIC(10,2),
  sale_date TIMESTAMP DEFAULT NOW(),
  payment_type TEXT,
  register_id INT REFERENCES devices(id),
  processed_by INT REFERENCES users(id)
);

-- Consignors (similar tables for vendors, donors, booth_owners)
CREATE TABLE consignors (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  payment_method JSONB,
  current_balance NUMERIC(10,2)
);

-- Payouts
CREATE TABLE payouts (
  id SERIAL PRIMARY KEY,
  consignor_id INT REFERENCES consignors(id),
  amount NUMERIC(10,2),
  status TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP
);

-- Marketplace Requests & Offers
CREATE TABLE marketplace_requests (
  id SERIAL PRIMARY KEY,
  requesting_store_id INT REFERENCES stores(id),
  item_id INT REFERENCES items(id),
  offer_price NUMERIC(10,2),
  status TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE offers (
  id SERIAL PRIMARY KEY,
  request_id INT REFERENCES marketplace_requests(id),
  consignor_id INT REFERENCES consignors(id),
  host_store_id INT REFERENCES stores(id),
  status TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Shipping Logs
CREATE TABLE shipping_logs (
  id SERIAL PRIMARY KEY,
  request_id INT REFERENCES marketplace_requests(id),
  sender_store_id INT REFERENCES stores(id),
  receiver_store_id INT REFERENCES stores(id),
  sent_date TIMESTAMP,
  received_date TIMESTAMP
);

-- Heartbeats
CREATE TABLE heartbeats (
  id SERIAL PRIMARY KEY,
  store_id INT REFERENCES stores(id),
  last_synced_at TIMESTAMP
);

-- Audit Logs
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  entity TEXT,
  entity_id INT,
  action TEXT,
  performed_by INT REFERENCES users(id),
  timestamp TIMESTAMP DEFAULT NOW(),
  details JSONB
);
```

---

## 4. API Design and Endpoints

We use a **RESTful API** with JSON. Key endpoints include:

• **Authentication**  
  - POST `/api/auth/register`  
  - POST `/api/auth/login`  
  - POST `/api/auth/logout`

• **Users & Roles**  
  - GET `/api/users`  
  - POST `/api/users`  
  - GET `/api/roles`

• **Stores & Devices**  
  - GET `/api/stores`  
  - POST `/api/stores`  
  - GET/PUT `/api/devices/:id`

• **Items**  
  - GET `/api/items`  
  - POST `/api/items`  
  - GET/PUT/DELETE `/api/items/:id`  
  - GET `/api/items/:id/history`

• **Photos**  
  - POST `/api/items/:id/photos`  
  - GET `/api/photos/:id`

• **Transactions (Sales)**  
  - POST `/api/sales`  
  - GET `/api/sales`

• **Consignors & Payouts**  
  - GET `/api/consignors`  
  - GET `/api/consignors/:id/payouts`  
  - POST `/api/payouts`

• **Marketplace**  
  - GET `/api/marketplace/items`  
  - POST `/api/marketplace/requests`  
  - PUT `/api/marketplace/requests/:id/offer`

• **Shipping**  
  - POST `/api/shipments`  
  - GET `/api/shipments/:id`

• **Sync & Heartbeat**  
  - POST `/api/sync/push`  
  - GET `/api/sync/pull`  
  - POST `/api/heartbeat`

Authentication uses JWT tokens. Permissions are enforced by middleware checking **only the active session role** (see Security section) against endpoint requirements.

---

## 5. Hosting Solutions

• **On-Premises Server**  
  - Commodity PC or small form-factor server running Linux (preferred) or Windows.  
  - Deployed as Docker containers or directly via Node.js, PostgreSQL, and SQLite.  

• **Cloud**  
  - **Azure**: Functions for microservices, Azure Database for PostgreSQL, Azure Blob Storage for backups and photos, Azure CDN for static assets, Azure Monitor for logs and alerts.  
  - **DigitalOcean** (alternative): App Platform for services, Managed PostgreSQL, Spaces for storage, CDN and Monitoring.

**Benefits**  
• Auto-scaling cloud services  
• High reliability and global reach via CDNs  
• Cost-effective plans for small businesses  

---

## 6. Infrastructure Components

• **Load Balancers** (cloud): Distribute HTTP traffic across service instances.  
• **Caching**: Redis for session caching and rate-limiting.  
• **Content Delivery Network (CDN)**: Serves frontend assets (JavaScript, CSS, images) with low latency.  
• **Database Backups**: Scheduled snapshots of PostgreSQL and uploaded to Blob/Spaces.  
• **Blockchain Prototype**: Private Hyperledger Fabric network (future phase) for inter-store escrow and item-tracking.  
• **CI/CD**: GitHub Actions builds Docker images, runs tests, and deploys to Azure or DigitalOcean.

All components communicate over secure channels, with network rules preventing unauthorized access.

---

## 7. Security Measures

• **Transport Security**: TLS (HTTPS) for all internal and external traffic.  
• **Data Encryption**: AES-256 at rest for databases and storage.  
• **Authentication & Authorization**: JWT tokens, bcrypt password hashing, Role-Based Access Control (RBAC).  
• **Audit Logging**: Immutable logs for critical operations and data sync conflicts.  
• **Device Security**: Printers and scanners connect via secure local network; generic HID/serial stubs prevent driver issues.  
• **Compliance Boundaries**: Offloading payment processing to terminals (no PCI scope) and no GDPR obligations (US focus).

### Multi-Role Users and Session Constraints

Some individuals may participate in the Teabox network under multiple roles over time (e.g., a consignor who later becomes an employee, or a booth owner who opens their own store). The data model allows a single person to be associated with multiple roles.

**Design Constraint – One Active Role per Session**  
At the application level, each login session is always bound to exactly one active role. When a user with multiple roles signs in, they must pick which role they are acting as for that session (e.g., “Log in as Consignor” vs. “Log in as Employee”). All permissions, UI options, and audit logs for that session are evaluated solely against this active role.

Switching roles is implemented via an explicit **“Switch Role”** action. When invoked, the system validates that the user is allowed to assume the requested role and then issues a **new session token** (JWT) that encodes this active role.

### Preventing Cross-Role Permission Leakage

A person may simultaneously hold a high-privilege internal role (e.g., **Manager**) and a low-privilege external role (e.g., **Consignor**). To prevent any cross-role permission leakage:

1. **Token Payload is Role-Scoped**  
   • Each JWT includes: `user_id`, `active_role_id`, and `store_id` (plus standard claims).  
   • Authorization middleware and downstream services must **never infer or aggregate permissions from `user_id` alone**; they read only `active_role_id` from the token.  
   • The backend is explicitly prohibited from “upgrading” or merging privileges based on other roles that the same person might hold.

2. **RBAC Evaluation Uses Only Active Role**  
   • Every protected endpoint declares a required role or set of roles (e.g., `['Manager', 'Owner']`).  
   • The authorization layer compares the endpoint’s requirements **only** to the `active_role_id` in the JWT.  
   • The user’s other roles (historical or concurrent) are ignored for the duration of that session.

3. **Separate Identities for External Roles (Implementation Detail)**  
   • For marketplace-facing roles (Consignor, Vendor, Donor, Booth Owner), the recommended implementation is to use **separate user records** from staff accounts, even if they refer to the same human being.  
   • Any linkage (e.g., an employee who is also a consignor) is represented via explicit relational tables (e.g., `consignors.user_id`) and **not** via permission merging.

4. **No Implicit Escalation Through Related Data**  
   • Business logic must not grant staff-level operations when the active role is an external role, even if the related entities (e.g., a `consignors.user_id`) point to a staff account.  
   • Example: A `Consignor` session can view their own items and payouts, but cannot perform inventory intake, price overrides, or staff-only reporting, even if that person also has a `Manager` role on a different login.

5. **Audit Logs Capture Active Role**  
   • `audit_logs` records must store the `active_role_id` (or derived role name) alongside `performed_by`.  
   • When reviewing logs, an action is interpreted strictly in the context of the active role, not the full set of roles linked to the underlying user.

These rules together ensure that "logging in as Consignor" always yields a strictly limited permission set, even for someone who also serves as Manager, Owner, or other elevated roles.

---

## 8. Monitoring and Maintenance

• **Logging**: Winston (or similar) aggregated to Azure Log Analytics or a centralized ELK stack.  
• **Metrics & Alerts**: Prometheus/Grafana or Azure Monitor watches CPU, memory, database health, sync heartbeats, and error rates.  
• **Health Checks**: Readiness and liveness probes (in Kubernetes or Docker Compose) restart services that fail.  
• **Backups**: Automated daily database snapshots and photo backups with retention policies.  
• **Schema Migrations**: Managed by Prisma; migrations run automatically on deploy or via manual review.  
• **Dependency Updates**: Regular security patching of Node.js, PostgreSQL, and container images.

---

## 9. Conclusion and Overall Backend Summary

Teabox’s backend is a resilient, offline-first ERP built with Node.js/Express and PostgreSQL locally, plus SQLite as a fallback. It syncs to the cloud every 10 minutes using serverless functions or containers on Azure/DigitalOcean. The data model covers everything from unique secondhand items to complex consignment accounting, multi-store marketplaces, and device integrations. Security is baked in with TLS, encryption, RBAC, and audit trails. Monitoring and CI/CD pipelines keep the system healthy and up-to-date. This architecture meets small-store needs for reliability and low technical overhead, while offering a clear path for future growth—adding computer vision, blockchain escrow, and advanced analytics in the cloud.
