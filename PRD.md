# Product Requirements Document: Canadian Property Management iOS App

**Status:** Approved v1 product baseline

**Date:** August 6, 2026

**Primary market:** Canada, initially validated in Ontario

**Platform:** Native iPhone app, iOS 18 and newer

**Working title:** Property Management App

## Problem Statement

People who own multiple rental properties need a reliable way to understand the state of their portfolio without maintaining separate spreadsheets, email searches, text threads, and handwritten notes. The most important recurring questions are simple but currently difficult to answer:

- Which units have paid rent this month?
- Which tenants still owe rent?
- Which incoming e-Transfers cannot yet be connected to a tenant?
- What maintenance requests are open, and who is responsible for them?
- What should an owner, assigned property manager, or tenant be allowed to see and change?

Rent is commonly paid outside property-management software through Interac e-Transfer. Owners often rely on Gmail notifications to identify incoming payments. The visible sender may not match the tenant's name, a parent or company may pay for a tenant, and one payer may support multiple tenancies. This makes automatic matching unreliable until the owner establishes the relationship once.

Tenants also need a lightweight way to see their rent status and submit non-emergency maintenance requests with photos. They should not need access to the owner's portfolio finances, other tenants' payment amounts, Gmail data, or unrelated properties.

The product must support many unrelated property-owner organizations. Data isolation and authorization cannot depend on hiding controls in the iOS interface; they must be enforced by the backend. A person may be an owner in one organization, a manager in another, and a tenant elsewhere without needing separate accounts.

The first release must remain deliberately focused. It monitors and reconciles payments but does not initiate, receive, or hold money. It manages active month-to-month tenancies but does not attempt to become a legal lease-authoring or electronic-signature platform.

### Target actors

- **Owner:** Creates and controls an organization, properties, units, tenancies, rental obligations, Gmail integration, payment reconciliation, manager permissions, and archived records.
- **Manager:** Operates only assigned properties. Can manage property details, tenants, and maintenance and can see payment status without seeing monetary amounts or Gmail-derived financial details.
- **Tenant:** Belongs to a specific active tenancy for a unit. Can see personal rent information, roommate payment status without amounts, and maintenance requests for the tenancy.
- **Internal support administrator:** Uses a protected internal surface for account support and Gmail-integration troubleshooting. This is not a public product role and must not bypass audit requirements.

### Product outcomes

- An owner can understand monthly portfolio income, paid and unpaid rent, unmatched payments, and maintenance workload from one iPhone app.
- A new property and its units can be created quickly from a Canadian address while keeping owner-entered details authoritative.
- A first payment from a new e-Transfer sender can be matched once and future high-confidence payments can reconcile automatically.
- Managers can operate assigned properties without gaining access to rent amounts, payment amounts, Gmail sender details, or portfolio totals.
- Tenants can report and follow non-emergency maintenance without introducing an unstructured chat system.
- Archived and corrected operational history remains auditable.

## Solution

Build one native SwiftUI iPhone app with role-aware navigation and a Supabase backend hosted in Canada Central. The same account can switch between owner, manager, and tenant contexts. Supabase Auth provides native Sign in with Apple and passwordless email authentication. PostgreSQL stores the domain model, Row Level Security enforces organization and tenancy boundaries, and private Supabase Storage buckets hold maintenance photos and optional documents.

The app has four canonical product areas:

1. **Portfolio:** Organizations, properties, units, assignments, active tenancies, and role-aware dashboards.
2. **Rental ledger:** Monthly obligations, tenant shares, additional charges, manual payments, credits, corrections, and status read models.
3. **Payment reconciliation:** Gmail ingestion, payer identities, sender mappings, automatic matching, exceptions, reversals, and the Payment Inbox.
4. **Maintenance:** Structured non-emergency requests, photos, ownership, state transitions, follow-up forms, and reopen approval.

### Experience principles

- Show the most actionable portfolio information before configuration or analytics.
- Make monetary values explicit for owners and structurally unavailable to managers.
- Prefer status and next actions over dense reporting.
- Distinguish confirmed facts, inferred suggestions, detected payments, reconciled payments, and owner corrections.
- Preserve history through archiving, voiding, and correction events rather than silent deletion.
- Keep Gmail authorization separate from application login and explain exactly what is read and retained.
- Treat maintenance as non-emergency. Every submission surface must direct urgent or dangerous situations to emergency services and the tenant's established emergency contact path.
- Follow native iOS accessibility, Dynamic Type, VoiceOver, contrast, safe-area, and touch-target conventions.

### Role-aware navigation

The app uses an elevated floating bottom navigation capsule adapted to the active role.

- **Owner:** Home, Properties, Payments, Maintenance, Settings.
- **Manager:** Home, Properties, Maintenance, Settings.
- **Tenant:** Home, Payments, Maintenance, Settings.

Quick actions appear in the dashboard header rather than as a permanent centre tab. The account menu contains organization and role switching.

### Owner dashboard

The owner Home screen contains:

- Monthly income received and expected total.
- Paid, partial, unpaid, pending-review, and not-yet-due rent actions.
- A tappable unpaid-rent count that opens the filtered unpaid list.
- A maintenance summary grouped by current status.
- Header quick actions for Add Property, Mark as Paid, Invite Tenant, and Review Unmatched Payments.

### Manager dashboard

The manager Home screen uses the same operational hierarchy for assigned properties but never receives or renders monetary amounts. It shows:

- Tenants or units that are paid, partial, unpaid, pending review, or not yet due.
- Open maintenance requests for assigned properties.
- Property and tenant actions allowed by the owner's assignment.

### Tenant dashboard

The tenant Home screen contains:

- Current monthly rent status and due date.
- The tenant's own assigned share, balance, and payment history.
- Each roommate's paid, partial, unpaid, or pending status without amounts or payment-source information.
- Active maintenance requests.
- A prominent Report Maintenance action.

### Property and unit setup

- The owner enters a Canadian address using Apple MapKit autocomplete restricted to address results.
- The app stores normalized civic-address fields, province, postal code, coordinates, and a formatted display address.
- The setup form pre-populates clearly labelled suggestions and common defaults so it does not begin blank.
- Address-derived or inferred suggestions are never treated as confirmed property facts.
- The owner confirms property type, unit structure, and all operational details.
- A single-family property receives one suggested default unit; multi-unit properties can contain any required number of units.
- Rent, tenancy, payment status, and unit-specific maintenance attach to a unit. Building-wide maintenance can attach directly to the property.
- Property cover photos and galleries are out of scope for v1.

### Organization and invitations

- Any user can self-register as an owner and create an organization.
- One account may create or belong to multiple organizations.
- Owners invite managers and grant property-by-property assignments.
- Owners invite tenants to a specific active tenancy for a specific unit.
- Invitations may be accepted through Sign in with Apple or passwordless email.
- A tenant cannot search for or claim a property without an owner-issued invitation.
- Owners exclusively grant and revoke organization roles. A tenant may also be granted a manager role without creating a second account.
- Ending a tenancy removes the former tenant's access to the property, unit, roommate statuses, payment history, and maintenance history for that tenancy. The owner retains archived operational records.

### Month-to-month tenancy and rental ledger

V1 supports active month-to-month tenancies only. Each tenancy includes a start date and optional end or move-out date. There is no fixed-term renewal workflow.

- Each unit has a total monthly rent obligation.
- The total can be divided into tenant-specific shares.
- Tenant shares must reconcile to the unit-level base rent for the applicable period.
- A payment by any tenant or approved payer may satisfy one or more tenant shares.
- The default due date is the end of the month and is configurable per tenancy.
- Owners may configure mid-month move-in proration, initial first-and-last collections, special payment dates, one-time adjustments, and credits.
- Optional recurring or one-time line items support parking, storage, utilities, and other owner-defined charges.
- Base rent remains distinct from additional charges for display and status calculations.
- Rent and recurring-charge changes are effective-dated; historical obligations are never overwritten.
- Underpayments leave an obligation partially paid.
- Overpayments create unapplied credit. The owner decides how to allocate that credit.
- Owners can quickly record non-e-Transfer payments with Mark as Paid, choosing the tenant or unit, rental period, method, and date. Notes and receipt photos are optional, but receipt generation is out of scope.
- Mistaken manual entries are voided or corrected with a required reason rather than deleted.

### Gmail and e-Transfer monitoring

V1 supports one owner-connected Gmail inbox per organization.

- Gmail connection uses a separate Google OAuth consent flow and the narrowest scope capable of reading supported Interac notification bodies.
- Only owners can connect, disconnect, or troubleshoot the Gmail integration.
- The backend identifies supported Interac e-Transfer notification messages and extracts only the required transaction metadata.
- Retained data is limited to the Gmail message identifier, connected inbox identifier, event type, payer fingerprint, visible sender data needed for matching, amount, received date, transaction status, reference, and processing audit data.
- Full unrelated mailbox contents and full email-body archives are not retained.
- The first payment from every distinct payer identity always requires owner review.
- The owner connects the payer identity to one or more tenant or tenancy destinations.
- A payer may support several tenants or units. When more than one destination is plausible, the payment remains unmatched.
- Future completed-deposit notifications may reconcile automatically only when the sender mapping, destination, amount, status, and rental-period allocation are high confidence.
- Expected recurring payments default to the oldest unpaid applicable period.
- New senders, unusual amounts, already-satisfied periods, duplicate references, reversals, cancellations, and ambiguous destinations are flagged.
- Reversals and cancellations always require owner confirmation before changing rental status.
- Original payment records remain in the audit history after reversal or correction.
- Gmail disconnection stops future synchronization but retains reconciled ledger records. Owners can separately request deletion of Gmail source metadata that is no longer required for the ledger audit.
- The integration begins as a gated beta. Public scale depends on Google OAuth verification and any security assessment required for the restricted Gmail scope.

### Payment Inbox and property payment views

- The portfolio-wide Payment Inbox is the canonical location for new, matched, unmatched, ambiguous, duplicated, cancelled, and reversed payment events.
- An unmatched event remains portfolio-level because its property relationship is not known.
- Tapping an unmatched event opens a focused assignment sheet for selecting payer, tenant, tenancy, rental period, and allocation.
- Once reconciled, the payment appears in the relevant property, unit, tenant, and monthly views.
- Owners see all monetary values and source details.
- Managers receive only a dedicated status projection for assigned properties. That projection contains no monetary columns or Gmail-source fields.
- Tenants see only their own amounts and payment details plus roommate status without roommate amounts.

### Automated reminders

- Owners can enable reminders per tenancy.
- Offered defaults are three days before the due date, on the due date, and three days overdue.
- Owners may enable, disable, or change reminder timing for special arrangements.
- A tenancy can pause reminders without changing the underlying ledger.
- Reminder delivery supports push and email.
- Reminder generation reads the canonical ledger status and must not send an overdue reminder for a satisfied, credited, paused, ended, or owner-exempted obligation.

### Maintenance workflow

Maintenance in v1 is for non-emergency issues only.

- A tenant selects a category: plumbing, electrical, heating/cooling, appliance, pest, structural, access/security, common area, or other.
- The tenant selects normal or time-sensitive and sees a non-emergency disclaimer.
- The tenant provides a description and may attach photos.
- The app supports up to five compressed photos per submission or follow-up. Each upload must remain below 5 MB for reliable standard uploads.
- Failed photo uploads retry safely. Intentional saved drafts are out of scope.
- A request may target the tenant's unit or, when applicable, a shared property area.
- An owner or assigned manager becomes the responsible assignee. Other assigned managers may watch the request.
- Canonical states are Submitted, Acknowledged, Scheduled, In Progress, Waiting on Tenant/Parts, Resolved, and Closed.
- Status changes, requests for information, availability responses, photos, assignments, and notes become timestamped activity entries.
- Internal notes are visible only to owners and appropriately assigned managers.
- Tenant-visible follow-up uses structured forms rather than direct messaging.
- A tenant can request reopening a resolved ticket with a reason and new photos. Only an owner or assigned manager can approve the reopen request.
- Optional contractor name, contact, appointment, and reference information may be recorded internally. Contractors do not receive accounts.

### Notifications

- The app provides an in-app notification centre, APNs push notifications, and transactional email.
- Users can configure channels by notification category.
- Invitations, authentication/security events, and account-critical notices cannot be fully disabled.
- Owners receive new-payment, unmatched-payment, correction, reversal, overdue-rent, and maintenance activity notifications according to settings.
- Managers receive assigned-property operational notifications without monetary content.
- Tenants receive invitation, rent reminder, payment-status, maintenance update, and information-request notifications according to settings.
- Notification payloads must avoid exposing sensitive financial or tenant information on the lock screen.

### Visual direction

The original design system uses Revolut as the primary visual reference: high contrast, restrained colour, strong typography, rounded cards, compact status labels, and polished financial-data presentation. It supports both light and dark themes using the iPhone system setting.

Supporting layout references:

- Owner dashboard hierarchy: [Copilot Money transaction-review flow](https://mobbin.com/flows/29c464c7-82f7-4af9-b1c6-2996f535e515)
- Property cards and action-required states: [Airbnb listings screen](https://mobbin.com/screens/683e7334-9f70-413b-ae4c-661526845f4a)
- Unmatched-payment attention state: [Mercury transaction screen](https://mobbin.com/screens/642b40bf-1b52-4834-aee9-eacaff4ef63c)
- Payment-to-obligation linking: [Revolut Business payment-linking flow](https://mobbin.com/flows/dbcb583d-31fa-49ca-bff0-c434890a54d0)
- Maintenance submission: [Jobber request screen](https://mobbin.com/screens/1b3a7d01-7591-4250-a3dc-2eac5fa91d00)
- Floating navigation: [Craft home screen](https://mobbin.com/screens/86eff422-820b-475a-b47b-4667540c0182)

The product borrows hierarchy and interaction patterns, not branded assets or pixel-for-pixel copies. Light mode uses warm white surfaces and charcoal typography. Dark mode uses near-black surfaces with strong contrast. A deep green accent is primary; orange and red are reserved for review, time-sensitive, and overdue states. Status must never rely on colour alone.

### V1 acceptance criteria

- A new owner can self-register, create an organization, add a Canadian property, create units, configure monthly rent, and invite tenants.
- The same user can switch between multiple organizations and roles without cross-context data leakage.
- Owners can see monthly received and expected totals and drill into paid, partial, unpaid, and pending obligations.
- Managers can see status for assigned properties but cannot retrieve amounts through the UI, client API, cached payloads, exports, or direct Data API access.
- A tenant can see personal amounts and roommate statuses without seeing roommate amounts or payment sources.
- Owners can manually mark rent paid and correct that record through an auditable workflow.
- Owners can connect one Gmail inbox, review the first event from a sender, and establish a reusable payer mapping.
- Later high-confidence completed events can reconcile automatically; all specified exceptions remain flagged.
- Partial payments, overpayments, credits, duplicates, cancellations, and reversals produce deterministic ledger results.
- A tenant can submit a non-emergency maintenance request with photos and track structured updates.
- A reopen request cannot change the ticket state without owner or manager approval.
- Ending a tenancy immediately removes the former tenant's access to tenancy-linked data.
- Every exposed database table and private storage bucket enforces tested authorization policies.
- Archiving or correcting an operational record never silently erases its audit history.
- Light and dark themes, Dynamic Type, VoiceOver labels, contrast, and minimum touch targets are verified for critical flows.

## User Stories

1. As a new property owner, I want to self-register, so that I can begin without an administrator invitation.
2. As a user, I want to sign in with Apple, so that I can authenticate without managing another password.
3. As a user, I want to sign in through passwordless email, so that I have an alternative to Apple sign-in.
4. As an owner, I want to create an organization, so that my portfolio is isolated from other owners.
5. As an owner, I want to create multiple organizations, so that distinct portfolios can remain separate.
6. As a multi-role user, I want to switch organizations and roles, so that I can use one account in every legitimate context.
7. As an owner, I want to invite a manager, so that someone else can operate selected properties.
8. As an owner, I want to assign a manager per property, so that access follows operational responsibility.
9. As an owner, I want to revoke a manager assignment, so that former managers lose access immediately.
10. As an owner, I want to grant a tenant a manager role, so that one account can hold both responsibilities.
11. As a manager, I want to see only assigned properties, so that unrelated portfolio information remains private.
12. As a manager, I want to see who is paid or unpaid, so that I can follow up operationally.
13. As a manager, I want monetary values to remain hidden, so that my access is limited to the owner's intended scope.
14. As an owner, I want to add a property by typing its address, so that setup is fast.
15. As an owner, I want Canadian address autocomplete, so that address fields are normalized and less error-prone.
16. As an owner, I want suggested setup values, so that the property form does not begin blank.
17. As an owner, I want suggestions clearly marked as unconfirmed, so that inferred data is not mistaken for fact.
18. As an owner, I want to divide a property into units, so that multi-unit buildings are represented correctly.
19. As an owner, I want a default unit suggested for a single-family property, so that simple properties require less setup.
20. As an owner, I want unit-specific rent, so that different units in one property can have different obligations.
21. As an owner, I want property-wide maintenance requests, so that shared-building issues are not forced onto one unit.
22. As an owner, I want to invite tenants to a specific unit tenancy, so that access is established through a trusted relationship.
23. As a tenant, I want to accept an invitation with my existing account, so that I do not create duplicate identities.
24. As an owner, I want several tenants on one unit, so that shared tenancies are supported.
25. As an owner, I want to record total unit rent, so that the core monthly obligation remains clear.
26. As an owner, I want to divide rent into tenant shares, so that roommate responsibilities can be monitored.
27. As an owner, I want tenant shares to reconcile to unit rent, so that the ledger cannot contain contradictory obligations.
28. As an owner, I want a configurable due date, so that special payment arrangements are supported.
29. As an owner, I want the end of the month suggested as the default due date, so that common setup is quick.
30. As an owner, I want to prorate a mid-month move-in, so that the first period reflects the arrangement.
31. As an owner, I want to record first-and-last collections, so that initial payments are represented separately.
32. As an owner, I want optional recurring charges, so that parking, storage, or utilities can be tracked.
33. As an owner, I want optional one-time charges and credits, so that unusual arrangements do not require workarounds outside the app.
34. As an owner, I want future rent changes to have an effective date, so that historical rent remains accurate.
35. As an owner, I want partial payments represented, so that an obligation is not incorrectly shown as fully paid.
36. As an owner, I want overpayments stored as unapplied credit, so that excess money is not silently allocated.
37. As an owner, I want a quick Mark as Paid action, so that cash, cheque, or disconnected-inbox payments take seconds to record.
38. As an owner, I want to correct a mistaken manual payment with a reason, so that the ledger remains trustworthy.
39. As an owner, I want to connect a Gmail inbox, so that Interac notifications can be monitored.
40. As an owner, I want Gmail access explained separately from login, so that the consent is informed.
41. As an owner, I want the app to ignore unrelated email, so that mailbox access is narrowly used.
42. As an owner, I want the first payment from every payer reviewed, so that sender identity is established safely.
43. As an owner, I want to map a payer to a tenant, so that future payments can be recognized.
44. As an owner, I want one payer connected to several tenancies, so that parents and companies can pay for multiple tenants.
45. As an owner, I want ambiguous multi-tenancy payments flagged, so that the app does not guess.
46. As an owner, I want high-confidence recurring payments automatically reconciled, so that monthly administration decreases.
47. As an owner, I want expected payments applied to the oldest unpaid period, so that allocation follows a predictable default.
48. As an owner, I want unusual amounts flagged, so that partial, excess, or incorrect payments receive attention.
49. As an owner, I want duplicate references flagged, so that one payment is not counted twice.
50. As an owner, I want reversals and cancellations to require confirmation, so that rent status does not change silently.
51. As an owner, I want a portfolio-wide Payment Inbox, so that every payment exception has one canonical review queue.
52. As an owner, I want unmatched payments to remain outside a property until assigned, so that false relationships are not displayed.
53. As an owner, I want a focused matching sheet, so that I can connect a payment to payer, tenant, period, and allocation quickly.
54. As an owner, I want reconciled payments visible within the property and unit, so that context is easy to understand.
55. As an owner, I want Gmail disconnection to stop new syncing, so that I control continuing access.
56. As an owner, I want reconciled ledger history retained after disconnection, so that payment status does not disappear.
57. As an owner, I want Gmail source metadata removable, so that unnecessary source data can be deleted.
58. As an owner, I want monthly income received and expected totals, so that I can understand current portfolio performance.
59. As an owner, I want to tap the unpaid count, so that I can immediately see who requires follow-up.
60. As an owner, I want a maintenance summary on Home, so that operational issues are visible alongside rent.
61. As a tenant, I want to see my own monthly share and balance, so that I understand my responsibility.
62. As a tenant, I want to see whether roommates have paid without seeing their amounts, so that the unit status is transparent without exposing finances.
63. As a tenant, I want to see my own payment history, so that I can understand how my balance was satisfied.
64. As a tenant, I want to receive configurable rent reminders, so that I do not miss a payment date.
65. As an owner, I want reminders disabled by default until configured, so that special arrangements are respected.
66. As an owner, I want reminder schedules configurable per tenancy, so that timing matches the agreement.
67. As a tenant, I want to submit a non-emergency maintenance request, so that the owner receives structured information.
68. As a tenant, I want maintenance categories, so that the request can be triaged efficiently.
69. As a tenant, I want to mark an issue normal or time-sensitive, so that urgency is communicated without implying emergency dispatch.
70. As a tenant, I want to attach photos, so that the condition is easier to understand.
71. As a tenant, I want failed photo uploads retried, so that weak connectivity does not lose my submission.
72. As a tenant, I want to see maintenance status, so that I know what is happening without direct chat.
73. As a tenant, I want to provide availability through a structured response, so that visits can be coordinated.
74. As a tenant, I want to add requested details or photos, so that the owner can continue diagnosis.
75. As an owner, I want to assign a maintenance request, so that responsibility is explicit.
76. As a manager, I want to manage requests for assigned properties, so that I can handle day-to-day operations.
77. As an owner or manager, I want internal notes, so that operational context is not exposed to tenants.
78. As a tenant, I want to request reopening a resolved issue, so that recurring problems can be reported.
79. As an owner or manager, I want to approve a reopen request, so that ticket state remains controlled.
80. As an owner, I want to record contractor details without creating an account, so that external work can still be tracked.
81. As a user, I want in-app notifications, so that activity has a persistent destination.
82. As a user, I want push notifications, so that important changes reach me promptly.
83. As a user, I want email notifications, so that invitations and important events do not depend on opening the app.
84. As a user, I want category-level notification preferences, so that I can control nonessential alerts.
85. As a user, I want sensitive lock-screen content minimized, so that notifications do not expose private information.
86. As an owner, I want properties and tenancies archived rather than deleted, so that operational history remains available.
87. As an owner, I want payment and maintenance corrections audited, so that disputes can be reconstructed.
88. As a former tenant, I want tenancy access removed at move-out, so that the old property is no longer connected to my app experience.
89. As a user, I want to initiate account deletion in Settings, so that I can exercise control over my personal data.
90. As an internal support administrator, I want audited support tools, so that I can diagnose account and Gmail issues without invisible changes.
91. As a light-mode user, I want a polished high-contrast interface, so that financial and maintenance states are easy to scan.
92. As a dark-mode user, I want a native dark theme, so that the app follows my system preference.
93. As a VoiceOver user, I want every status and action announced meaningfully, so that the app is independently usable.
94. As a Dynamic Type user, I want layouts to reflow at larger sizes, so that information is readable without clipping.

## Implementation Decisions

### Platform and infrastructure

- Build one native SwiftUI iPhone application targeting iOS 18 and newer.
- Use structured concurrency with async/await and typed domain contracts.
- Keep the backend client-neutral so future Android or web clients do not require a data-model rewrite.
- Use Supabase Auth, PostgreSQL, private Storage, server-side functions, and scheduled/background jobs.
- Deploy the primary Supabase project in Canada Central (`ca-central-1`).
- Keep development and production environments separate. Gmail OAuth testing and production verification must use appropriately separated Google Cloud configuration.
- Use Apple MapKit local search completion for Canadian address entry and map previews.
- Use APNs for push notifications and a transactional-email provider behind a replaceable notification interface.
- Use privacy-conscious crash/error diagnostics and minimal product analytics. Do not include advertising identifiers, cross-app tracking, screen recording, or session replay.

### Canonical deep modules

The implementation should preserve the following ownership boundaries:

1. **Identity and Membership** owns accounts, organization memberships, role grants, property assignments, invitations, context switching, and access revocation.
2. **Portfolio** owns organizations, properties, normalized addresses, units, and non-financial property configuration.
3. **Tenancy** owns active month-to-month occupancy, tenant membership, start/end dates, and tenant-share configuration.
4. **Rental Ledger** owns charges, due dates, effective-dated rent terms, tenant shares, manual payments, allocations, credits, voids, reversals, and derived monthly status. No other module computes whether rent is paid.
5. **Payment Intake** owns Gmail connection state, mailbox watch state, provider-message parsing, idempotency, payer fingerprints, and immutable source events. It does not decide ledger allocation.
6. **Reconciliation Engine** owns sender mappings, matching confidence, allocation proposals, exception reasons, owner approval, and conversion of source events into ledger transactions.
7. **Maintenance** owns requests, categories, assignments, state transitions, structured activity, internal notes, reopen requests, and tenant-visible projections.
8. **Media** owns private photo validation, compression expectations, upload authorization, object paths, attachment lifecycle, and signed delivery.
9. **Notification Orchestrator** owns notification preferences, templates, delivery fan-out, deduplication, and redacted payloads. Domain modules emit typed events rather than sending channels directly.
10. **Role Read Models** own owner, manager, and tenant projections. Manager status responses must be amount-free by construction rather than filtered in SwiftUI.
11. **Internal Administration** owns narrowly scoped support operations, audit events, and Gmail integration diagnostics.

These boundaries avoid a single giant property service, repeated paid/unpaid calculations, scattered role checks, Gmail parsing inside UI code, and amount fields that are merely hidden after retrieval.

### Authorization matrix

| Capability | Owner | Manager | Tenant |
|---|---|---|---|
| Create organization | Yes | No | No |
| Grant or revoke roles | Yes | No | No |
| Assign managers to properties | Yes | No | No |
| View all organization properties | Yes | Assigned only | Invited unit context only |
| Edit non-financial property/unit data | Yes | Assigned only | No |
| Configure rent, charges, shares, or credits | Yes | No | No |
| View monetary amounts | All organization amounts | Never | Own amounts only |
| View roommate status | Yes | Assigned properties | Status only, no amounts |
| Connect or disconnect Gmail | Yes | No | No |
| View Gmail sender/source details | Yes | No | No |
| Reconcile or correct payments | Yes | No | No |
| Mark manual payments | Yes | No | No |
| View payment status | Yes | Assigned properties, no amounts | Own details and roommate status |
| Create maintenance request | Yes | Assigned properties | Own active tenancy |
| Assign and change maintenance state | Yes | Assigned properties | No |
| Add tenant-visible follow-up | Yes | Assigned properties | Own requests |
| Add internal maintenance notes | Yes | Assigned properties | No |
| Approve reopen request | Yes | Assigned properties | No |
| Archive property or tenancy | Yes | No | No |

### Core domain entities

- Account profile
- Organization
- Organization membership
- Property assignment
- Invitation
- Property
- Unit
- Tenancy
- Tenancy participant
- Effective rent term
- Charge definition
- Monthly obligation
- Obligation share
- Payment transaction
- Payment allocation
- Unapplied credit
- Ledger correction or reversal
- Gmail connection
- Gmail synchronization cursor/watch
- Payment source event
- Payer identity
- Payer-to-tenancy mapping
- Reconciliation decision
- Maintenance request
- Maintenance assignment
- Maintenance activity
- Reopen request
- Media attachment
- Notification preference
- Notification delivery
- Audit event

Database names are intentionally not specified in this PRD; implementation should choose clear domain vocabulary and capture schema decisions in migrations and ADRs.

### Domain invariants

- Every organization-owned record has one canonical organization identity.
- A role or property assignment is data, not an unverified user-editable metadata claim.
- A manager query cannot return amount, balance, payer, Gmail, or allocation-value fields.
- A tenant query cannot return another tenant's amounts or payment sources.
- Tenant shares for a base-rent term reconcile to the unit base rent.
- Ledger transactions and allocations use integer minor currency units and an explicit currency; v1 organizations operate in CAD.
- Monetary history is effective-dated and append-oriented. Corrections reference prior records.
- The Rental Ledger is the only canonical owner of paid, partial, unpaid, pending, credited, and overdue calculations.
- Source events are idempotent by provider identity and cannot create duplicate ledger payments.
- A source event is not a ledger payment until reconciliation succeeds or an owner approves it.
- Automatic reconciliation requires a completed deposit event and a single high-confidence destination and period.
- Reversal or cancellation never erases its original event.
- An ended tenancy has no active tenant authorization.
- Maintenance transitions follow one state machine; screens do not invent alternate state rules.
- Internal maintenance content never appears in tenant projections or notification payloads.
- Storage objects are private and authorized through tenancy, assignment, or ownership policies.
- Archiving removes active use without deleting operational audit history.

### Supabase security decisions

- Enable Row Level Security on every table in an exposed schema.
- Grant Data API access deliberately and separately from RLS; a table is not considered secure merely because the UI does not link to it.
- Policies must combine authentication with organization membership, property assignment, or active tenancy predicates.
- Never authorize from user-editable `user_metadata`.
- The iOS app receives only a publishable client key. Service-role or secret keys remain server-side.
- RLS update policies require both visibility and valid post-update ownership checks.
- Views used for client read models must preserve caller authorization. Manager projections must be amount-free at the database or trusted API boundary.
- Privileged functions, if unavoidable, live outside exposed schemas, validate the authenticated user explicitly, and have public execution revoked.
- Private Storage policies cover select, insert, and any permitted update behavior. Attachments use non-guessable organization-scoped paths.
- Gmail refresh tokens and provider secrets are stored only in server-side secret management and never returned to the iOS client.
- Audit support operations and sensitive owner actions.
- Run database and RLS security advisors before release.

### Gmail integration decisions

- Request `gmail.readonly`; metadata-only access cannot parse the Interac body needed for payment information.
- Treat the Gmail scope as restricted and plan for OAuth brand verification, restricted-scope review, and any required security assessment before broad release.
- During development and limited beta, configure explicit Google test users and display accurate consent and privacy disclosures.
- Use Gmail mailbox watch notifications through Google Cloud Pub/Sub to notify a server endpoint of mailbox changes.
- Persist Gmail history cursors and process changes idempotently.
- Renew mailbox watches on a scheduled cadence before Google's expiration boundary and run a periodic recovery sync because push notifications may be delayed or dropped.
- Apply provider-specific parsers behind a stable parsed-payment-event interface. Store parser version and parse outcome for diagnostics.
- Do not use Gmail or tenant data for generalized AI or model training.
- Provide owner-visible connection health, last successful sync time, and actionable error state without exposing OAuth tokens.

### Photo decisions

- Accept JPEG, HEIC, or other iOS-supported camera/library input and normalize uploads to a safe display format.
- Compress on device to a maximum practical dimension and below 5 MB.
- Allow up to five photos for each initial request or follow-up.
- Use reliable standard uploads for these small files; retry failed transfers with stable object identities to avoid duplicates.
- Store attachments in a private bucket with bucket-level MIME and size restrictions.
- Strip unnecessary image metadata, including location metadata, before upload unless a future requirement explicitly needs it.

### Archiving and account deletion

- Properties, units, tenancies, payments, and maintenance records use archive, void, reversal, or correction semantics rather than ordinary destructive deletion.
- In-app Settings provides a discoverable account-deletion initiation flow.
- Deletion revokes active sessions and linked provider tokens, including Sign in with Apple revocation when applicable.
- Personal data is deleted or de-identified unless retention is legally or operationally required and disclosed.
- Organization ownership must be transferred or the organization explicitly closed before deleting its last owner.
- The precise Canadian retention schedule and legal basis must be reviewed before App Store launch; the product must not claim legal compliance solely because data is hosted in Canada.

### Maintainability requirements

- Each domain concept has one canonical owner and one typed contract.
- Feature-specific permission branches must not be scattered through SwiftUI views.
- Do not build a generic rule engine for v1; model the agreed roles, ledger states, and maintenance transitions directly.
- Avoid optional booleans for status. Use explicit enums or state types with validated transitions.
- No target source file should approach 1,000 lines without an explicit decomposition plan; feature views should be split by stable responsibility, not arbitrary line count.
- Keep backend provider details behind Payment Intake and Notification interfaces so Gmail or email-vendor changes do not rewrite domain logic.
- Use atomic database operations for reconciliation, allocation, correction, and state transitions so partial updates cannot corrupt status.
- Prefer generated or hand-maintained typed API models over loose dictionaries and runtime casts.
- Cache only role-appropriate read models on device. Changing context clears data that is not valid in the new context.
- Every migration includes corresponding authorization-policy changes and tests.

### Delivery sequence

1. **Foundation:** Xcode project, design tokens, navigation shell, Supabase environments, authentication, account profile, organization membership, and test infrastructure.
2. **Portfolio:** Owner self-registration, organizations, MapKit property entry, units, manager assignments, tenant invitations, and role switching.
3. **Ledger:** Tenancies, effective rent terms, shares, monthly obligations, manual payments, credits, status projections, dashboards, and reminders.
4. **Maintenance:** Request form, private photo uploads, state machine, assignments, structured activity, reopen approval, and notifications.
5. **Gmail beta:** OAuth connection, restricted-scope disclosures, Pub/Sub ingestion, parsing fixtures, payer mappings, Payment Inbox, automatic reconciliation, and connection health.
6. **Hardening:** RLS matrix tests, accessibility, light/dark verification, failure recovery, diagnostics, privacy disclosures, account deletion, TestFlight QA, and App Store preparation.

## Testing Decisions

### Testing philosophy

Tests must verify externally observable behavior and domain invariants rather than private implementation details. A good test describes an actor, authorized context, action, and resulting visible state. Pure domain modules should be tested without networking. Provider integrations should use recorded, redacted fixtures and contract tests. UI tests should cover critical journeys rather than duplicating every unit test.

The workspace contains no existing test prior art. The project must establish conventions during the foundation phase and keep them consistent.

### Modules requiring focused automated tests

- **Identity and Membership:** invitation acceptance, multi-role membership, property assignment, role revocation, tenancy-ending access removal, last-owner constraints.
- **Rental Ledger:** monthly obligation generation, due dates, proration, shares, additional charges, partial payments, overpayments, credits, allocation, effective-dated changes, voids, reversals, and status derivation.
- **Payment Intake:** provider filtering, parser versions, idempotency, cursor advancement, duplicate source events, unsupported messages, and safe parse failure.
- **Reconciliation Engine:** first-sender review, saved mappings, one-to-many payer relationships, oldest-unpaid allocation, confidence failures, unusual amounts, duplicates, cancellations, and owner overrides.
- **Maintenance:** allowed state transitions, assignment authorization, internal-versus-tenant activity, reopen requests, and ended-tenancy behavior.
- **Notification Orchestrator:** preference evaluation, mandatory notices, reminder timing, redacted manager/tenant payloads, deduplication, and delivery retries.
- **Role Read Models:** exact field-shape tests proving manager and roommate responses contain no prohibited monetary or source fields.
- **Media:** file-type validation, compression boundary, size rejection, upload retry, duplicate prevention, signed access, and metadata stripping.

### Authorization and database tests

Create a permission matrix that exercises every meaningful operation as:

- Anonymous user
- Unrelated authenticated user
- Owner in the correct organization
- Owner in another organization
- Assigned manager
- Unassigned manager
- Active tenant in the unit
- Tenant in another unit
- Former tenant after tenancy end
- Internal support role with and without the audited operation

For every exposed table, view, function, and storage bucket, test allowed and denied select, insert, update, and delete behavior as applicable. Include attempts to change organization ownership, property identity, tenancy identity, and attachment paths during updates.

### iOS tests

- Unit-test view models and presentation state through typed domain interfaces.
- Snapshot-test a focused set of high-risk layouts in light and dark mode, standard and accessibility Dynamic Type, and long-content conditions.
- UI-test Sign in with Apple using the appropriate test strategy, passwordless invitation flow, role switching, property creation, Mark as Paid, unmatched-payment review with a test backend, maintenance submission, and reopen request.
- Verify VoiceOver reading order, meaningful labels, non-colour status cues, keyboard behavior, photo permission denial, offline upload failure, and context-change cache clearing.

### Integration and end-to-end scenarios

1. Owner self-registers, creates an organization, adds a property and unit, and invites two tenants.
2. Tenants accept invitations and see only their own amounts plus roommate status.
3. Owner creates divided monthly shares and records one manual partial payment.
4. Manager sees the resulting partial status without any amounts in network payloads or UI.
5. First Gmail payment from a new sender is flagged and mapped by the owner.
6. A later completed payment from the same payer automatically satisfies the expected oldest unpaid obligation.
7. An unusual or ambiguous payment remains in the Payment Inbox and does not change the ledger.
8. A cancellation or reversal requires owner approval and restores the correct outstanding status.
9. Tenant submits a maintenance request with five photos; owner assigns a manager; manager requests information; tenant responds; manager resolves it.
10. Tenant requests reopening; the state changes only after authorized approval.
11. Owner ends the tenancy; the tenant immediately loses tenancy-linked access while the owner retains archived history.
12. Gmail is disconnected; future sync stops while reconciled ledger entries remain.

### Verification gates

- All unit, integration, RLS, storage-policy, and critical UI tests pass.
- Database security advisors have no unresolved security findings relevant to the schema.
- Gmail parser fixtures cover all supported notification forms and safe failure for unknown formats.
- No manager or tenant network response contains prohibited fields.
- No duplicate source event can produce a duplicate payment.
- Accessibility audit passes for all critical workflows in both themes.
- Privacy Nutrition Label inputs, privacy policy, Gmail disclosure, data-deletion behavior, and App Store account-deletion flow match actual runtime behavior.
- A TestFlight build completes the critical owner, manager, and tenant journeys against a non-production environment before production submission.

## Out of Scope

- Android, iPad, macOS, web, watchOS, or visionOS client applications.
- French localization.
- Fixed-term lease expiration, renewals, legal lease generation, legal notice generation, or electronic signatures.
- Tenant self-claiming or public property discovery.
- Public property listing, marketing, estimated value, tax data, listing-photo import, or property-record import.
- Property cover photos and galleries.
- Rent payment initiation, bank transfer initiation, payment processing, holding funds, wallets, escrow, chargebacks, or banking-ledger verification.
- In-app owner subscription billing or App Store purchases.
- More than one connected Gmail inbox per organization.
- Outlook or non-Gmail mailbox integrations.
- Public, unrestricted Gmail integration before Google approval.
- Full email-body storage, unrelated mailbox indexing, or AI analysis of mailbox content.
- Contractor accounts, contractor portal, work-order marketplace, or contractor payments.
- General owner-tenant direct messaging.
- Emergency dispatch or emergency-contact management.
- Maintenance video uploads.
- Intentional saved maintenance drafts.
- Payment receipts, annual tax summaries, PDF reports, or CSV export.
- Advanced analytics, forecasting, property profitability, accounting integration, or tax filing.
- Former-tenant access to ended tenancy information.
- Full offline editing and conflict resolution.
- A public owner-facing web administration app.

## Further Notes

### Current platform constraints

- Supabase currently supports Canada Central as a project region. Region selection should be verified again when provisioning because changing regions later requires migration.
- Supabase recommends standard uploads for files no larger than 6 MB; the app's 5 MB compressed-photo ceiling intentionally stays below that boundary.
- Gmail `gmail.readonly` is currently a restricted scope. Storing or transmitting restricted-scope data server-side may require Google verification and a security assessment.
- Gmail mailbox watches must be renewed before expiration, and the integration must tolerate delayed or dropped push notifications through recovery synchronization.
- App Store applications that create accounts must allow users to initiate account deletion in the app.
- App Store privacy disclosures must describe first-party and third-party data collection accurately. The product does not use cross-app tracking and should avoid adding SDKs that change that posture.

### Documentation required during implementation

- ADR for organization membership, property assignments, and role-specific read models.
- ADR for append-oriented rental ledger and allocation semantics.
- ADR for Gmail source-event ingestion and reconciliation boundary.
- ADR for maintenance state machine and visibility rules.
- Data inventory covering stored personal data, purpose, access, retention, deletion, and subprocessors.
- Google OAuth scope justification, privacy disclosure, demonstration script, and verification evidence.
- App Store privacy questionnaire evidence and account-deletion runbook.

### Unresolved non-product selections

The following vendor or naming selections do not change the approved v1 behavior and can be resolved during foundation work:

- Final product name, icon, and public brand identity.
- Transactional email provider.
- Crash/error reporting vendor and minimal product-analytics vendor.
- Internal administration implementation shape.
- Exact legal retention periods and customer-facing terms, subject to Canadian legal review.
- TestFlight pilot composition and release date.

### Authoritative external references

- [Supabase available regions](https://supabase.com/docs/guides/platform/regions)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- [Supabase Sign in with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Supabase passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple user privacy and data use](https://developer.apple.com/app-store/user-privacy-and-data-use/)
