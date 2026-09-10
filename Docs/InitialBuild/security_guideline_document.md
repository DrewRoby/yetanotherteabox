# Security Guidelines for Teabox: Consignment-Shop-in-a-Box

## 1. Introduction & Scope
These guidelines provide a security-by-design foundation for Teabox, the desktop-first, browser-native consignment ERP system. They cover on-premise core functions (inventory, POS, intake, accounting), device integrations (scanner, printer, cash drawer), offline resilience, cloud backup/sync, and the future multi-store blockchain network.

**Scope:**
- Local server (Linux/Windows) and offline operations
- Cloud sync and backup (Azure or DigitalOcean)
- Device endpoints (thermal printer, scanners, registers)
- Web UI, APIs, RPCs, and inter-store blockchain messaging

---

## 2. Authentication & Access Control
- **Strong Authentication**
  - Enforce password complexity (min. 12 characters, mixed case, symbols).
  - Use Argon2 or bcrypt with unique salts for password hashing.
  - Enforce email verification and secure password-reset flows.
- **Session Management**
  - Generate unpredictable session tokens; store in HttpOnly, Secure cookies with `SameSite=Strict`.
  - Implement idle (15 min) and absolute timeouts (8 hr) for all roles.
  - Protect against session fixation (regenerate on login) and CSRF with synchronizer tokens.
- **Multi-Factor Authentication (MFA)**
  - Offer TOTP/Email‐OTP for all internal roles (Admin, Owner, Manager, Employee).
- **Role-Based Access Control (RBAC)**
  - Define fine-grained permissions for: System Admin, Owner, Manager, Employee, Register (device), Consignor, Vendor, Donor, Booth Owner.
  - Enforce server-side authorization checks on every API and data operation.
  - Use the principle of least privilege for device accounts and microservices.

---

## 3. Input Handling & Processing
- **Untrusted Input**
  - Validate and sanitize all user-supplied data (forms, JSON, URL parameters).
  - Enforce strict schemas (JSON Schema, server-side validators) for API requests.
- **File Uploads & Images**
  - Limit file types (JPEG/PNG only), max size (5 MB), and scan for malware.
  - Store uploads outside the webroot; serve via temporary signed URLs.
- **Prevent Injection**
  - Use parameterized queries/ORM (Prisma) to avoid SQL injection.
  - Escape and encode output in HTML contexts to mitigate XSS.
- **Device Commands**
  - Restrict ESC/POS printer commands to a sanitized subset.
  - Authenticate device connections (mutual TLS or token-based) on the local network.

---

## 4. Data Protection & Privacy
- **Encryption**
  - TLS 1.2+ for all in-transit traffic (browser ↔ server, server ↔ cloud, device ↔ server).
  - AES-256 encryption for data at rest (PostgreSQL disks, SQLite files, backups, blob storage).
- **Secrets Management**
  - Do not hardcode credentials; use environment variables with restricted access.
  - Integrate with a secrets manager (e.g., Azure Key Vault or HashiCorp Vault) for cloud services.
- **Data Retention & Privacy**
  - Retain user data per SLA (permanent retention), disallow forced deletion beyond legal requirements.
  - Mask or exclude PII (email, phone) from logs and dashboards visible to non-authorized roles.
- **Backup Integrity**
  - Verify backup checksums; rotate encryption keys yearly.
  - Audit backup access and perform periodic restores to test integrity.

---

## 5. API & Service Security
- **Transport & Authentication**
  - Enforce HTTPS; disable HTTP.
  - Use JWTs or opaque tokens with short lifetimes (≤ 15 minutes) for inter-service calls.
- **Rate Limiting & Throttling**
  - Limit requests per IP/user per endpoint to mitigate brute-force and DoS.
- **CORS**
  - Restrict allowed origins to the local server domain and known cloud domains.
- **Versioning & Deprecation**
  - Prefix APIs with `/v1/`; require explicit migration for breaking changes.
- **Minimal Data Exposure**
  - Only return fields required by the client; avoid leaking internal IDs or metadata.

---

## 6. Web Application Security Hygiene
- **Security Headers**
  - `Content-Security-Policy`: Allow only self for scripts/styles; define allowed device endpoints.
  - `Strict-Transport-Security`: `max-age=31536000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer-when-downgrade`
- **CSRF Protection**
  - Anti-CSRF tokens on state-changing forms and AJAX calls.
- **Cookie Security**
  - `Secure`, `HttpOnly`, `SameSite=Strict` on session and JWT cookies.
- **Clickjacking & SRI**
  - Use Subresource Integrity for all external scripts.
  - Disallow framing to prevent clickjacking.

---

## 7. Infrastructure & Configuration Management
- **Server Hardening**
  - Disable unused services and ports; enforce firewall rules (allow only 443, 22/3389 to admins, internal DB ports only from localhost).
  - Regularly apply OS and package updates; automate with patch management tools.
- **Container & VM Security**
  - Run services in minimal Docker containers; scan images for vulnerabilities (e.g., Trivy, Clair).
  - Use read-only root filesystems and non-root users in containers.
- **Network Segmentation**
  - Separate the local LAN (devices, server) from Internet-facing cloud sync networks; use VPN or SSH tunnels for sync.
- **Disable Debug in Production**
  - Turn off verbose error messages; log errors to a secure store without stack traces to end users.

---

## 8. Dependency Management
- **Secure Dependencies**
  - Only use actively maintained libraries; vet transitive dependencies with SCA tools (e.g., Dependabot, Snyk).
- **Lockfiles & Pinning**
  - Commit `package-lock.json`/`yarn.lock`; pin Docker base images to digests.
- **Regular Audits**
  - Automate weekly vulnerability scans; address high/critical CVEs within 48 hours.
- **Minimize Attack Surface**
  - Remove unused packages and disable optional features.

---

## 9. Blockchain & Multi-Store Network Security
- **Permissioned Network**
  - Use Hyperledger Fabric or a private Ethereum network with RBAC and mTLS between nodes.
- **Data Partitioning**
  - Store only event hashes on-chain; keep sensitive business data off-chain with on-chain proofs.
- **Consensus & Governance**
  - Choose BFT consensus (SmartBFT/QBFT) for multi-party trust.
  - Codify consortium rules on-chain; implement revocation and membership-change protocols.
- **Key Management**
  - Use HSMs or secured KMS for node signing keys; rotate keys annually or on compromise.

---

## 10. Monitoring, Logging & Incident Response
- **Audit Trails**
  - Log all data modifications (intake, sale, payout) with actor, timestamp, and source (user or device).
- **Real-Time Alerts**
  - Monitor heartbeat failures, sync errors, repeated auth failures, and high-rate device commands.
- **Log Protection**
  - Ship logs to a central, write-once storage with access controls; retain per compliance policy.
- **Incident Response**
  - Define playbooks for unauthorized access, data corruption, device compromise, and sync breaches.
  - Conduct annual tabletop exercises with store staff and cloud operations teams.

---

*Adherence to these guidelines ensures Teabox remains secure, resilient, and trustworthy—both offline and in the cloud.*