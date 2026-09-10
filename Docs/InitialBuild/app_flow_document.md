# App Flow Document

## Public Access, Website, and Invite-Only Gating

MyResale.Boutique (currently implemented at `https://myresaleboutique.wordpress.com`) is the **only** Teabox touchpoint exposed to the general public on the internet. The Teabox application itself (local server, web client, and installers) is **invite-only** and must **not** be downloadable or directly accessible without prior vetting.

### Public Website (MyResale.Boutique)

The public website has the following purposes:

- Introduce Teabox as a product for consignment and resale businesses
- Describe core features (inventory, intake, POS, reporting, marketplace, offline-first design)
- Explain the invite-only nature of the platform and the focus on a higher-trust network
- Provide a single, controlled path for interested business owners to request access

The public site **does not**:

- Expose Teabox installers (no direct download links)
- Expose live app URLs or API endpoints
- Allow self-service account creation for the Teabox app

### Invite Request Flow

From MyResale.Boutique, a business owner can click a prominent **“Request an Invite”** button. This starts the invite-request flow:

1. **Request Form**
   - Fields: business name, business type, website (optional), contact person name, contact email, approximate store location, and a brief description of their use case.
   - On submit, the system validates required fields and shows a confirmation acknowledgment on the site.

2. **Automated Scheduling Invitation**
   - Submitting the form triggers an automated email to the requester.
   - The email contains:
     - A brief thank-you and explanation of the invite-only review process
     - A link to schedule a meeting (e.g., via a calendar scheduling tool)

3. **Calendar Integration**
   - The scheduling link is connected to a calendar owned and managed by `andrew@robydata.com`.
   - Prospective customers choose a date and time for a meeting from available slots.
   - When a time is selected, the scheduling system:
     - Creates a calendar event on the `andrew@robydata.com` calendar
     - Sends calendar invites and/or confirmations to both parties

4. **Manual Vetting and Approval**
   - During or after the meeting, the administrator (Andrew or delegate) decides whether to approve the store for Teabox access.
   - Only approved businesses proceed to the onboarding and setup flows described below.

### Resulting Access Constraints

- **No public downloads**: Installers for Linux/Windows and any hosted Teabox web client URLs must be behind this vetting and invitation process.
- **Controlled distribution**: All installer links, server endpoints, and first-time setup URLs are shared only via direct, private communication with approved store owners.
- **Higher-trust network**: This gating is a core part of the system’s administrative infrastructure, intended to:
  - Maintain a curated network of stores in the multi-store marketplace
  - Allow for flexible, case-by-case implementation and support
  - Reduce misuse or misconfiguration by unvetted users

## Onboarding and Sign-In/Sign-Up

Once a store owner has been vetted and approved through the invite process, they receive private instructions to access Teabox. This may include a private installer link, local server setup instructions, or a secure URL to an already-hosted instance. These access details are **never** provided on the public MyResale.Boutique site.

When the approved store owner first accesses their Teabox instance (via local server address or a private landing page for the application), they see the Teabox landing page.

On this landing page, they can choose to download an installer for Linux or Windows if that is part of their deployment, or proceed to a web-only setup if it is already installed and hosted for them. Once the system is running, the first user visit leads to a Sign Up form. The form requests an email address, a secure password, and the store’s basic name and location. After submitting, the system sends a confirmation link to the provided email, which the store owner clicks to verify their address. At that point, the owner account is created. Subsequent visits to the same address present a Sign In form requiring email and password. There is a “Forgot Password” link on the Sign In page that prompts the user for their email, sends a reset link, and then allows them to choose a new password. Once signed in, a user can sign out by clicking their avatar or name in the top header and choosing “Sign Out.” There are no social login options in version one, so all users use email and password authentication.

After the store owner creates the first account, they are recognized as the System Administrator and Owner by default. This user can invite Managers, Employees, Consignors, Vendors, Donors, Booth Owners, and Customers by navigating to the Users section under Settings. Invitations appear as email links that, once clicked, allow those individuals to set their own passwords and access the system with their assigned roles.

### Multi-Role Users and Session Constraints

Some individuals may participate in the Teabox network under multiple roles over time (e.g., a consignor who later becomes an employee, or a booth owner who opens their own store). The data model allows a single person to be associated with multiple roles.

**Design Constraint – One Active Role per Session**  
At the application level, each login session is always bound to exactly one active role. When a user with multiple roles signs in, they must pick which role they are acting as for that session (e.g., “Log in as Consignor” vs. “Log in as Employee”). All permissions, UI options, and audit logs for that session are evaluated solely against this active role.

To prevent cross-role permission leakage, **authorization checks and data access are based strictly on the active session role**, not on the union of all roles a user holds. For example, if a Manager also has a Consignor role and chooses to log in as Consignor, they see and can act only on consignor-appropriate data (e.g., their own items and statements) and do **not** retain any Manager-level privileges in that session.

Switching roles is handled via an explicit **“Switch Role”** action accessible from the user menu in the header. When a user initiates a role switch, the system verifies that the user is allowed to assume the requested role and then issues a new session token bound to the newly selected active role. This constraint simplifies authorization logic, clarifies auditing, and reduces the risk of accidental privilege overlaps as the network grows in complexity.

## Main Dashboard or Home Page

Upon successful sign-in, the user lands on the Main Dashboard. The top header displays the store name on the left and the current user’s avatar, name, active role, and a Switch Role option on the right. A collapsible sidebar on the left lists Inventory, Intake, Point of Sale, Reports, Marketplace, and Settings. The center area shows role-specific widgets.

The dashboard content is **role-appropriate**:
- For an **Owner**, the dashboard highlights total inventory count, pending consignor payouts, cumulative sales for the current day, and recent system heartbeat status.
- A **Manager** sees low-stock alerts, upcoming item expirations, and open intake requests.
- An **Employee** sees a button to open the Intake Module and a quick link to launch the POS register.
- **Consignors** and **Vendors** see their own active items, sales history, and current balance where applicable.

UI elements, metrics, and available navigation options must always be tailored to the active role, ensuring users only see and act on information appropriate to that role.

From this home page, every feature is reachable via the sidebar, with each click replacing the center area without a full page reload.

## Detailed Feature Flows and Page Transitions

### Inventory Management Flow

When a user clicks Inventory in the sidebar, the system displays a searchable, sortable table of all items in stock. Above the table is a button labeled “New Item.” Clicking that brings up a full-screen form to enter item details such as category, subcategory, brand, style or pattern, size or dimensions, serial number, condition, intake date, and consignment type. The user can save the form to create the item, which then immediately appears in the table. From any item row, clicking on the item name opens a detail page that shows the full history of the item, including timestamps for intake, edits, price changes, and sale or disposal actions. A “Back to Inventory” link returns the user to the table view.

### Accounts and Consignor Management Flow

Selecting Accounts under the sidebar reveals tabs for Consignors, Vendors, Donors, and Booth Owners. Each tab lists the corresponding entities. The **layout and data shown in each profile is tailored to the account type**, ensuring role- and function-appropriate views.

- **Consignors**: Clicking on a consignor name opens their profile page, showing contact information, payout method, current balance, and a table of all items they have in the system along with status and price. There is also a “Payout History” link that shows a list of past payout transactions and dates. This view emphasizes balances and payout-related data.

- **Vendors and Booth Owners**: Their profiles are similar to consignors, with appropriate balance and settlement information where applicable, plus item lists and status. Booth Owner views may also highlight booth-specific metrics or fees.

- **Donors**: Donor profiles are intentionally simpler and **do not show an account balance**, as donors are not owed payouts. A Donor profile shows contact information (if collected), a list of donated items, and for each item, status and sold price (if sold). Any summary metrics are limited to counts and total realized sale value, without implying a payable balance.

On each profile page, there is an “Edit Profile” button that brings up a form to update personal details or relevant preferences (such as payout method where applicable). When changes are saved, the user returns to the profile page.

All account-related screens must be **role- and function-appropriate**:
- Users only see financial/balance information for account types where it makes sense (e.g., Consignors, some Vendors/Booth Owners, but not Donors).
- Actions offered (e.g., "Generate Payout", "Print Statement") depend on both the account type and the active user role.

### Intake Module Flow

Item intake is always performed on behalf of a specific account. Every intake operation must be linked to either a consignor, vendor, donor, booth owner, or the store’s own inventory account.

When an Employee selects Intake, the interface first requires them to choose the target account for which the intake is happening, unless one is implied by their active role. The top of the Intake screen shows a persistent "Intake For" indicator displaying the name and type of the current intake account.

- When a **Consignor** or **Booth Owner** role is selected as the active role, that user’s own account is automatically and always the intake target. The Intake screen does not allow changing the target account in this case.
- When a **store-level** role (Employee, Manager, or Owner) is the active role, the user must select an account for which intake is happening (e.g., a specific consignor, booth owner, vendor, donor, or the store-owned inventory account) before any items can be captured. The intake controls remain disabled until a valid target account is chosen.

Once the target account is established, the interface switches to a camera view if using a mounted phone or to a form if using desktop. For camera view, the user clicks “Capture Item,” and Teabox takes three guided photos: front, back, and a close-up of a tag if applicable. The images upload automatically to the local server and are associated with the selected intake account. The system immediately prints a thermal tag on the Epson T570 printer, showing a barcode and brief description. If internet is available, the photos are flagged for cloud computer vision analysis, and a notification appears when attribute suggestions are ready. The user can then click “Complete Intake,” review suggested metadata, adjust as needed, and save. The item moves into the Inventory list under the chosen account.

### Point-of-Sale Flow

When an Employee clicks Point of Sale, they choose a register from a dropdown of physical devices. The register view shows a scan field and a cart panel. Scanning a barcode or typing an SKU adds the item to the cart. The user can adjust quantity or price overrides directly in the cart.

If an item has **lost its tag** or cannot be scanned, the user can click a **“Search Inventory”** button next to the scan field. This opens a pop-up modal that allows searching inventory by description (and optionally other filters such as category, size, or brand). The user selects the correct item from the search results list, and the system adds that item to the cart as though it had been scanned.

Once all items are scanned or selected, the user clicks “Checkout,” which opens a payment pane. The pane logs the payment type (cash, credit card, or external terminal). If using an external terminal, the system waits for the terminal to confirm approval before finalizing the sale. Upon confirmation, Teabox updates the item status to Sold, generates a receipt for printing or email, and updates consignor or store-owned inventory accounting. A “New Sale” button resets the register for the next customer.

### Reporting and Dashboard Flow

Clicking Reports opens a page with tabs for Daily Sales Summary, Unsold Inventory Aging, Consignor Payout Statements, and Custom Reports. Each tab shows a chart or table of real-time data. Above the charts, there is an option called “Schedule Report,” which brings up a form to enter an email address and frequency. When scheduled, reports are emailed automatically in PDF format. Managers and Owners can click on any data point in a chart to drill down into the raw records, which replaces the chart area with a detailed table and a back link to the chart.

### Multi-Store Marketplace Flow

When a Manager opts into the Marketplace under Settings, a new menu item called Marketplace appears in the sidebar. Clicking it brings up a list of items shared by other stores in the vetted Teabox network. Instead of a Buy Now button, each listing has a Send Request button. When clicked, a dialog asks for an offer price, then submits the request. The owning store and the consignor see the request in their Pending Requests pages. If the consignor accepts, the host store receives an alert to accept or reject. Accepting converts the item to store-owned inventory, triggers payout liability to the consignor, and starts a shipping dialogue between the two stores. Both parties update shipping status in a shared chat pane until the receiving store marks the item Received. At that moment, the sale finalizes automatically.

Because Teabox access is invite-only, every store visible in the Marketplace has been vetted in advance, reinforcing a higher-trust environment for inter-store transactions.

## Settings and Account Management

In the sidebar, Settings opens to a page with tabs for Profile, Users & Permissions, Notifications, Devices, and System Sync. The Profile tab lets a user change their name, password, and contact email. The Users & Permissions tab is available only to the System Administrator and Owner; it shows a list of all invited accounts, their roles, and a button to change roles or deactivate users. The Notifications tab lets users choose email alerts for low stock, intake completion, pending requests, and scheduled reports. The Devices tab lists connected hardware—barcode scanners, cash drawers, printer—and indicates online or offline status, along with a button to test the connection. The System Sync tab shows the last heartbeat timestamp and lets the admin manually trigger a cloud sync. Saving settings in any tab returns the user to the Settings overview.

## Error States and Alternate Paths

If a user enters an invalid email or password at sign in, the form displays a red error message beneath the field and clears the password input. During intake, if the printer fails to respond, the camera form shows a banner reading “Printer not found,” and provides a Retry button. If the network connection drops, a persistent offline indicator appears in the header. All actions that require cloud connectivity are queued locally and replayed when connection restores. In the rare event of a data conflict during sync, the system uses a last-write-wins policy and logs the conflict in an audit trail accessible via Settings. If a user tries to access a page they do not have permission for, Teabox redirects them to an Access Denied page with a link back to the Dashboard.

## Conclusion and Overall App Journey

A new store discovers Teabox via the public MyResale.Boutique website, submits a Request an Invite form, and schedules a meeting with the administrator using the calendar linked to `andrew@robydata.com`. After being vetted and approved, the store owner receives private installation or access instructions. They complete initial setup, create an Owner account, and then invite Managers, Employees, and external parties (Consignors, Vendors, Donors, Booth Owners, Customers) as needed.

From there, daily work happens through role-appropriate dashboards and modules: Owners and Managers monitor inventory, sales, payouts, and marketplace activity; Employees focus on Intake and POS; Consignors, Vendors, Donors, and Booth Owners access tailored account views that reflect their relationship with the store. All actions are scoped to the user’s active role and to the relevant accounts, preventing cross-role permission leakage and keeping Teabox’s multi-party environment secure, understandable, and well-audited.
