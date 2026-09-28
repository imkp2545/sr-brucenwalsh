const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const { invoiceProfile } = require('../config/invoiceConfig');

const profile = invoiceProfile();
const outputPath = path.resolve(
  process.argv[2] || path.join(__dirname, '..', 'docs', 'Bruce-and-Walsh-Customer-Policies.pdf'),
);

const PAGE = {
  width: 595.28,
  height: 841.89,
  left: 52,
  right: 52,
  top: 84,
  bottom: 68,
};
PAGE.contentWidth = PAGE.width - PAGE.left - PAGE.right;
PAGE.contentBottom = PAGE.height - PAGE.bottom;

const COLOR = {
  orange: '#F59A00',
  orangeDark: '#D98100',
  orangePale: '#FFF4E2',
  brown: '#7A4A2A',
  brownPale: '#F5EEE9',
  ink: '#171513',
  muted: '#625E59',
  soft: '#8B857F',
  line: '#E7C79A',
  lightLine: '#E9E4DE',
  white: '#FFFFFF',
  paper: '#FFFCF8',
};

const DOCUMENT_TITLE = 'Customer Policies & Terms';
const DOCUMENT_VERSION = '1.0';
const EFFECTIVE_DATE = '28 July 2026';

const sections = [
  {
    key: 'terms',
    number: '01',
    title: 'Terms and Conditions',
    subtitle: 'Rules governing accounts, purchases, payments, use of the platform, and customer transactions.',
    blocks: [
      {
        type: 'callout',
        title: 'Acceptance',
        text: 'By creating an account, placing an order, booking an appointment, submitting a return or buyback request, or otherwise using the Platform, you agree to these Terms and the policies incorporated into them. Mandatory rights available under applicable law are not excluded.',
      },
      {
        type: 'clause',
        title: '1. About us and scope',
        paragraphs: [
          `${profile.companyName} ("Bruce & Walsh", "we", "us" or "our") operates the digital commerce and service platform through which customers may view products, purchase eligible products, manage orders, request returns and refunds, book appointments, and use the eligible jewellery buyback process.`,
          'These Terms apply to customer-facing use of the website, applications, account area, communications and connected services. Separate written terms accepted for a specific transaction will apply to that transaction if they are more specific.',
        ],
      },
      {
        type: 'clause',
        title: '2. Eligibility and account registration',
        bullets: [
          'You must be legally competent to contract under applicable law. A minor may use the Platform only through a parent or legal guardian who accepts responsibility for the transaction.',
          'Checkout is available only to an active customer account with a verified email address.',
          'You must provide accurate, complete and current account, billing, shipping and contact information.',
          'You are responsible for safeguarding credentials and for activity performed through your account. Notify us promptly if you suspect unauthorised access.',
          'We may require reasonable identity or transaction verification before fulfilling an order, return, refund or buyback request.',
        ],
      },
      {
        type: 'clause',
        title: '3. Products, availability and appointments',
        paragraphs: [
          'Product photographs, videos, measurements, weights, colours and descriptions are provided to help evaluation. Screen settings, lighting, handcrafted variation and permitted manufacturing tolerances may cause minor visual differences. The final invoice, product specification and any accompanying certificate form part of the transaction record.',
          'Products may be designated for online purchase or as appointment-only. Appointment-only products cannot be purchased through the standard cart. Availability and stock remain subject to final validation during payment and order confirmation.',
        ],
        bullets: [
          'A product shown online is not reserved merely because it is in a cart or wishlist.',
          'We may correct a manifest pricing, tax, specification or inventory error before dispatch and will contact the customer where the correction materially affects an accepted order.',
          'Home or store appointments remain subject to location, schedule, product eligibility and the appointment rules displayed at booking.',
        ],
      },
      {
        type: 'clause',
        title: '4. Price, discounts and tax',
        paragraphs: [
          'The price payable is the price revalidated at checkout, after eligible discounts and before order confirmation. Coupon use is subject to activation, validity dates, minimum spend, usage limits and product or customer restrictions configured for that coupon.',
          'GST is calculated using the shipping destination as the place of supply. For delivery within Maharashtra, the applicable GST is shown as CGST and SGST in equal parts. For delivery outside Maharashtra, the applicable GST is shown as IGST. The same stored tax breakup is used across checkout, order details, administration and invoice records.',
        ],
        bullets: [
          'The current jewellery tax configuration is reflected at checkout and on the tax invoice.',
          'A coupon cannot reduce an order below the permitted minimum or exceed its configured benefit.',
          'Current standard checkout does not add a shipping charge. Any future exceptional charge must be displayed before confirmation.',
        ],
      },
      {
        type: 'clause',
        title: '5. Orders and confirmation',
        paragraphs: [
          'Submitting checkout information or starting payment is an offer to purchase. An order is created only after the payment result and amount are verified and the order passes final stock and commercial checks. An order identifier, payment reference and invoice or order record provide evidence of confirmation.',
        ],
        bullets: [
          'We may decline or cancel an order for unavailable stock, failed verification, suspected fraud, legal restriction, serviceability failure, manifest error or another legitimate operational reason.',
          'If payment is captured but the order cannot be completed, the transaction is escalated for reconciliation and, where appropriate, the formal refund workflow.',
          'Orders may be fulfilled in more than one shipment where products are dispatched separately.',
        ],
      },
      {
        type: 'clause',
        title: '6. Payment',
        paragraphs: [
          'Online payments are processed through the HDFC/Juspay payment integration using the payment methods made available at checkout, which may include cards, UPI, net banking or supported wallets. A payment is treated as successful only after server-side verification of the gateway status, currency and amount.',
        ],
        bullets: [
          'Do not refresh, duplicate or retry a payment unless the Platform indicates that the earlier attempt failed or expired.',
          'Bank, card, UPI or wallet terms may apply independently between you and the relevant provider.',
          'We may keep transaction identifiers, masked payment details and gateway status records for reconciliation, security, tax, refund and support purposes.',
        ],
      },
      {
        type: 'clause',
        title: '7. Cancellation',
        paragraphs: [
          'An unpaid checkout may be abandoned. After payment and order creation, a customer cannot self-cancel the paid order through a generic status change. Contact support promptly with the order ID. Any cancellation accepted after payment must use the controlled cancellation and refund process and may be unavailable after dispatch or carrier movement.',
          'A shipment waybill may be cancelled administratively only before pickup, while it remains pending or pickup-scheduled. Cancellation of a waybill does not by itself complete a customer refund.',
        ],
      },
      {
        type: 'clause',
        title: '8. Delivery, returns, refunds and buyback',
        paragraphs: [
          'The Shipping Policy, Return Policy, Refund Policy and Buyback Policy in this document are incorporated into these Terms. Each process has separate eligibility and status requirements. A return or buyback request does not by itself establish acceptance, refund entitlement or settlement.',
        ],
      },
      {
        type: 'clause',
        title: '9. Certificates, authenticity and care',
        paragraphs: [
          'Where a product is sold with an invoice, IGI certificate or another product document, retain the original safely. Such records may be required for service, verification or buyback. Jewellery should be handled and stored in accordance with any care guidance supplied with the product.',
          'A warranty, service benefit or certification applies only to the extent stated in the listing, invoice, certificate or separate written warranty. Nothing in these Terms limits a statutory remedy for goods that do not conform to applicable law.',
        ],
      },
      {
        type: 'clause',
        title: '10. Reviews, content and uploads',
        bullets: [
          'Reviews may be limited to verified purchasers and may be moderated for relevance, authenticity, privacy, abuse or unlawful content.',
          'You retain rights in content you submit, but grant us a non-exclusive licence to host, process and display it for the requested service, moderation, support and transaction record.',
          'You must not upload content that is unlawful, misleading, infringing, malicious or that exposes another person\'s confidential or personal information without authority.',
          'Return and buyback evidence must accurately show the relevant product and supporting documents and must not be manipulated.',
        ],
      },
      {
        type: 'clause',
        title: '11. Acceptable use and intellectual property',
        paragraphs: [
          'The Platform, brand assets, catalog content, software, layout and original materials are owned by or licensed to Bruce & Walsh. Except as permitted by law or written consent, you may not copy, scrape, reverse engineer, commercially exploit or create misleading derivative use of them.',
        ],
        bullets: [
          'Do not interfere with security, rate limits, authentication, payment, tracking, inventory or administration functions.',
          'Do not submit fraudulent orders, coupons, returns, refunds, reviews, certificates, identity records or buyback claims.',
          'Do not use automated means that degrade service, obtain unauthorised data or circumvent access controls.',
        ],
      },
      {
        type: 'clause',
        title: '12. Communications',
        paragraphs: [
          'We may send transactional messages about verification, payment, orders, shipping, appointments, returns, refunds, buyback, security and support through email, SMS, push notification, telephone or in-account notification as appropriate. Marketing messages are sent in accordance with consent and applicable law, and may be opted out of without stopping necessary transactional messages.',
        ],
      },
      {
        type: 'clause',
        title: '13. Platform availability and third-party services',
        paragraphs: [
          'We aim to keep the Platform accurate and available but do not guarantee uninterrupted operation. Payment, logistics, messaging, media storage and infrastructure providers operate services outside our direct control. Temporary interruption, maintenance, bank processing, carrier delay or network failure may affect a transaction.',
        ],
      },
      {
        type: 'clause',
        title: '14. Liability',
        paragraphs: [
          'To the extent permitted by law, neither party is liable for indirect or consequential loss that was not reasonably foreseeable from the relevant breach. Our aggregate contractual liability for a specific order will ordinarily not exceed the amount paid for the affected product, except where applicable law requires otherwise.',
          'No limitation applies where liability cannot lawfully be excluded or limited, including applicable consumer rights, fraud, wilful misconduct, or death or personal injury caused by negligence where such limitation is prohibited.',
        ],
      },
      {
        type: 'clause',
        title: '15. Suspension, changes and severability',
        paragraphs: [
          'We may restrict or suspend an account where reasonably necessary for security, fraud prevention, legal compliance, misuse or investigation. Policies may be updated prospectively. The version accepted or otherwise applicable when a request is created remains part of that transaction record where the Platform stores a policy snapshot.',
          'If a provision is held unenforceable, it will be limited or removed only to the minimum extent necessary, and the remaining provisions continue.',
        ],
      },
      {
        type: 'clause',
        title: '16. Governing law and disputes',
        paragraphs: [
          'These Terms are governed by the laws of India. Subject to mandatory consumer rights and the jurisdiction of competent statutory authorities and consumer commissions, courts at Mumbai, Maharashtra will have jurisdiction. Please first contact support so that the transaction record can be reviewed and a practical resolution attempted.',
        ],
      },
    ],
  },
  {
    key: 'privacy',
    number: '02',
    title: 'Privacy Policy',
    subtitle: 'How personal data is collected, used, shared, protected, retained, and handled across the customer lifecycle.',
    blocks: [
      {
        type: 'callout',
        title: 'Privacy commitment',
        text: 'We process personal data for clear commerce, service, security and legal purposes. We do not sell personal data. This Policy should be read with transaction-specific notices and consent choices shown on the Platform.',
      },
      {
        type: 'clause',
        title: '1. Data fiduciary and contact',
        paragraphs: [
          `${profile.companyName} is responsible for personal data processed through the Platform for its own purposes. Questions, rights requests and grievances may be sent to the contact details in the final section of this document.`,
        ],
      },
      {
        type: 'clause',
        title: '2. Personal data we collect',
        bullets: [
          'Account and profile data: name, email, phone, gender, date of birth where supplied, avatar, authentication provider, verification status, addresses and notification preferences.',
          'Authentication and security data: password hash, token hash, sign-in time, IP address, user agent, failed attempts, account lock information and token revocation or expiry records.',
          'Commerce data: cart, wishlist, product interests, coupons, orders, billing and shipping addresses, invoice and tax information, returns, refunds and support history.',
          'Payment data: gateway order and transaction references, amount, currency, status, method, bank references, masked card network or last digits, masked UPI information, refund records and reconciliation metadata. Our application is not designed to store full card numbers or CVV.',
          'Delivery data: recipient contact information, address, pin code, Blue Dart waybill, label, tracking events, delivery attempts and proof-of-delivery information made available by the carrier.',
          'Return data: product, quantity, reason, declared condition, requested resolution, pickup address, evidence images, inspection decisions, approved amount and operational notes.',
          'Buyback data: invoice and order linkage, jewellery images, IGI certificate image and number, declarations, appointment slots, identity and ownership verification results, inspection record, offer acceptance IP, settlement mode, reference and proof.',
          'Appointment and support data: preferred schedule, address, products, budget or occasion details, accessibility or security instructions, communications and support notes.',
          'Content and device data: reviews, ratings, uploads, push-notification tokens, browser or device information, logs, timestamps and security events.',
        ],
      },
      {
        type: 'clause',
        title: '3. How data is collected',
        bullets: [
          'Directly from you when you register, order, communicate, upload evidence, book an appointment, request a return or participate in buyback.',
          'Automatically from the Platform, local browser storage, server logs, security controls and connected devices.',
          'From payment providers, logistics providers, identity or certificate evidence, notification providers and other service partners involved in a transaction.',
          'From an administrator or support representative who records a transaction action or verification outcome.',
        ],
      },
      {
        type: 'clause',
        title: '4. Purposes of processing',
        bullets: [
          'Create and secure accounts, verify contact details and maintain sessions.',
          'Display products, maintain carts and wishlists, calculate price and tax, apply coupons, process payment and create invoices.',
          'Confirm, dispatch, track and deliver orders and send transaction notifications.',
          'Assess and administer cancellations, returns, inspection, refunds, buyback, settlement, appointments and customer support.',
          'Prevent fraud, abuse, duplicate processing, unauthorised access and payment or logistics manipulation.',
          'Comply with tax, accounting, audit, consumer, corporate, payment, legal and dispute-resolution obligations.',
          'Operate, troubleshoot, measure and improve the Platform, products, support and customer experience using proportionate data.',
          'Send marketing only where permitted, with the relevant preference or consent control.',
        ],
      },
      {
        type: 'clause',
        title: '5. Grounds and consent',
        paragraphs: [
          'We process data where necessary to provide a requested product or service, perform or administer a transaction, comply with law, protect legitimate security interests, establish or defend claims, or where valid consent has been obtained. Where consent is the basis, it may be withdrawn through the available preference control or by contacting us, without affecting prior lawful processing.',
        ],
      },
      {
        type: 'clause',
        title: '6. Payment handling',
        paragraphs: [
          'Payment details are transmitted to and processed by HDFC/Juspay and the selected banking or payment network. We receive transaction status and limited payment metadata needed to confirm orders, investigate failures, prevent fraud and process refunds. The payment provider\'s privacy and security terms also apply to its processing.',
        ],
      },
      {
        type: 'clause',
        title: '7. Sharing and service providers',
        paragraphs: [
          'We disclose only the data reasonably required for the relevant purpose. Provider access is governed by contract, applicable law, technical controls or the provider\'s regulated role.',
        ],
        bullets: [
          'HDFC/Juspay, banks, card networks, UPI participants and payment partners for payment, reconciliation and refund.',
          'Blue Dart and logistics partners for serviceability, labels, pickup, tracking, delivery, reverse pickup and proof of delivery.',
          'Cloudinary for product, return, review, invoice-related or buyback media storage and controlled delivery.',
          'Email, SMS, Firebase Cloud Messaging and communication providers for verification, alerts and support.',
          'Hosting, database, monitoring, security, audit and professional advisers supporting reliable operation and compliance.',
          'Government, regulators, courts, law enforcement or other persons where disclosure is legally required or necessary to protect rights and safety.',
          'A successor in a merger, restructuring or business transfer, subject to appropriate confidentiality and legal safeguards.',
        ],
      },
      {
        type: 'clause',
        title: '8. Local storage and similar technologies',
        paragraphs: [
          'The current Platform stores session and authentication tokens in local storage to keep customers signed in. If non-essential tracking technologies are introduced, an appropriate notice and choice will be provided where required.',
        ],
      },
      {
        type: 'clause',
        title: '9. Cross-border and remote processing',
        paragraphs: [
          'Some service providers may process or store data in locations outside the customer\'s state or outside India, subject to applicable transfer restrictions. We use reasonable contractual, access and security measures appropriate to the provider and processing context.',
        ],
      },
      {
        type: 'clause',
        title: '10. Security',
        bullets: [
          'Passwords and refresh tokens are stored as hashes rather than readable values.',
          'Role-based access separates customer and administrative operations.',
          'Token expiry and revocation, request rate limits, security headers, input sanitisation and request validation reduce common risks.',
          'Payment, carrier and webhook results are verified server-side; signed carrier callbacks and gateway status checks are used where supported.',
          'Buyback evidence is stored as authenticated/private media and accessed through time-limited signed delivery links.',
          'Security controls reduce risk but no internet or storage system can guarantee absolute security.',
        ],
      },
      {
        type: 'clause',
        title: '11. Retention',
        paragraphs: [
          'We retain personal data only for as long as reasonably needed for the service and for applicable tax, accounting, audit, warranty, consumer, fraud-prevention, security, legal and dispute requirements. Retention varies by record type and transaction status. Data is deleted, anonymised or access-restricted when it is no longer required, subject to lawful archival and backup cycles.',
        ],
      },
      {
        type: 'clause',
        title: '12. Your choices and rights',
        bullets: [
          'Access information about personal data and processing, subject to applicable law.',
          'Correct inaccurate or incomplete profile and address information through the account area or support.',
          'Request erasure of data that is no longer needed, subject to transaction, tax, security, legal and dispute-retention requirements.',
          'Withdraw consent or change optional communication preferences.',
          'Raise a grievance and receive a response through the contact channel stated below.',
          'Nominate or exercise any additional right made available under applicable data-protection law when that right applies.',
        ],
      },
      {
        type: 'clause',
        title: '13. Children',
        paragraphs: [
          'The Platform is not intended for children to conduct independent commercial transactions. A parent or legal guardian should supervise any permitted use involving a minor and should not submit unnecessary child data.',
        ],
      },
      {
        type: 'clause',
        title: '14. Changes and grievances',
        paragraphs: [
          'Material changes will be published through the Platform or another appropriate channel. The effective date identifies this version. A privacy grievance should include enough information to identify the account or transaction, but should not include a full card number, CVV, password or one-time password.',
        ],
      },
    ],
  },
  {
    key: 'shipping',
    number: '03',
    title: 'Shipping Policy',
    subtitle: 'Payment confirmation, serviceability, shipment creation, tracking, delivery, and issue reporting.',
    blocks: [
      {
        type: 'callout',
        title: 'Current shipping arrangement',
        text: 'Customer orders are shipped through Blue Dart after verified payment and operational confirmation. Current standard checkout does not add a shipping charge. Delivery estimates are carrier-generated estimates, not guaranteed dates.',
      },
      {
        type: 'clause',
        title: '1. Shipping eligibility',
        bullets: [
          'An order must be paid, active and not cancelled or returned before shipment creation.',
          'The delivery address must contain a valid Indian six-digit pin code and complete recipient contact information.',
          'The destination must be serviceable by the carrier for the relevant shipment type.',
          'Appointment-only products or products requiring a separate fulfilment arrangement are not shipped through standard checkout unless specifically confirmed.',
        ],
      },
      {
        type: 'clause',
        title: '2. Address accuracy',
        paragraphs: [
          'Customers must review the recipient name, phone, email, address, landmark, city, state and pin code before payment. Carrier routing and tax treatment rely on this information. Contact support immediately if a correction is needed. A change cannot be guaranteed after waybill creation, pickup or carrier movement.',
        ],
      },
      {
        type: 'clause',
        title: '3. Dispatch and packages',
        paragraphs: [
          'Dispatch occurs after payment verification, stock allocation, invoice readiness, packaging and carrier serviceability checks. One order may be split into multiple shipments. Each active shipment has its own waybill and tracking history, while the order is considered delivered only when all active shipments are delivered.',
        ],
      },
      {
        type: 'clause',
        title: '4. Shipping charge and declared value',
        paragraphs: [
          'Current standard checkout shipping is INR 0. The shipment is created as prepaid, with no cash-on-delivery collection. The carrier consignment includes the order\'s declared commercial value and shipment information required for transport. Any exceptional delivery charge introduced for a specific service must be disclosed before confirmation.',
        ],
      },
      {
        type: 'clause',
        title: '5. Tracking',
        paragraphs: [
          'After waybill creation, tracking may be viewed in the customer account and through transaction notifications. Tracking is refreshed from Blue Dart. Carrier events may include pickup scheduled, picked up, in transit, out for delivery, delivered, delivery failed, return initiated, returned or cancelled.',
        ],
      },
      {
        type: 'clause',
        title: '6. Delivery estimates and delays',
        paragraphs: [
          'An estimated delivery date is displayed only when supplied by the carrier. It is not a guaranteed delivery date. Weather, public restrictions, operational disruption, address verification, remote-area service, customer unavailability and force-majeure events may affect delivery.',
          'Where tracking is delayed or inconsistent, contact support with the order ID and waybill number. We will use the carrier record and available scan history to investigate.',
        ],
      },
      {
        type: 'clause',
        title: '7. Delivery attempts and receipt',
        bullets: [
          'Keep the registered phone available and ensure an authorised recipient can receive the package.',
          'The carrier may record delivery attempts, comments and proof of delivery in accordance with its operating process.',
          'Do not share an OTP or sensitive payment credential except through the carrier\'s legitimate delivery verification process.',
          'Inspect the outer package promptly. Retain the package, label, invoice and contents if tampering, shortage, wrong item or damage is suspected.',
        ],
      },
      {
        type: 'clause',
        title: '8. Damage, shortage, loss or wrong item',
        paragraphs: [
          'Report a delivery issue promptly through support or the return workflow and within the applicable return window. Provide the order ID, waybill, description and clear photographs or video where available. We may compare packaging, dispatch, carrier, product and delivery records before determining the appropriate remedy.',
        ],
      },
      {
        type: 'clause',
        title: '9. Shipment cancellation and return to origin',
        paragraphs: [
          'A waybill can be cancelled administratively only before pickup while it is pending or pickup-scheduled. If delivery fails or the carrier returns a package to origin, the order is reviewed after carrier confirmation and receipt. Any resulting cancellation or refund remains subject to reconciliation and the Refund Policy.',
        ],
      },
      {
        type: 'clause',
        title: '10. Customer support',
        paragraphs: [
          'For a shipment query, provide the order ID, waybill number, recipient phone and a concise description. Never send passwords, CVV or OTP values. Carrier escalation and resolution depend on scan events and supporting records.',
        ],
      },
    ],
  },
  {
    key: 'returns',
    number: '04',
    title: 'Return Policy',
    subtitle: 'Eligibility, customer request, review, reverse pickup, receipt, inspection, and final decision.',
    blocks: [
      {
        type: 'callout',
        title: 'Current return window',
        text: 'The current default return request window is 7 calendar days from recorded delivery. A different window displayed for an order or configured before the request will govern that request. Every return remains subject to review, receipt and item-level inspection.',
      },
      {
        type: 'clause',
        title: '1. Basic eligibility',
        bullets: [
          'The order must have a recorded delivered date.',
          'The request must be submitted within the return window measured from delivery.',
          'The item and requested quantity must belong to the order and must not exceed the quantity still available after other active returns and reserved or completed buyback requests.',
          'Each item must include a reason, declared condition and requested resolution.',
          'Eligibility to submit a request does not guarantee approval after inspection.',
        ],
      },
      {
        type: 'clause',
        title: '2. Supported reasons and condition declarations',
        paragraphs: [
          'The Platform currently records reasons including damaged, defective, wrong item, not as described, size issue, quality issue, changed mind and other. The customer must declare the condition as unopened, unused, opened or damaged and provide an accurate explanation.',
        ],
      },
      {
        type: 'clause',
        title: '3. Requested resolution',
        paragraphs: [
          'For each item, the customer may request refund or store credit where that option is presented. The requested outcome remains subject to review and inspection. A store-credit outcome, if approved, is confirmed through the applicable support or transaction reference and is not automatically exchangeable for cash unless separately stated.',
        ],
      },
      {
        type: 'clause',
        title: '4. Evidence and pickup address',
        paragraphs: [
          'Clear images may be uploaded to support the request, subject to the Platform upload limit. The pickup address defaults to the original shipping address but may be replaced with a valid address accepted by the reverse-logistics process. Evidence should show the product, packaging, label and issue without exposing unrelated personal data.',
        ],
      },
      {
        type: 'clause',
        title: '5. Request and review flow',
        paragraphs: [
          'A submitted request moves through controlled statuses. The normal sequence is requested, under review, approved or rejected, pickup scheduled, picked up, received, inspected, refund initiated where applicable, and completed. Some statuses may be skipped or repeated where operational correction is required.',
        ],
        bullets: [
          'An administrator reviews eligibility and may approve or reject the request. A rejection includes a reason.',
          'The customer may cancel only while the request is requested or under review.',
          'Approval authorises the next operational step; it is not the final inspection decision or refund confirmation.',
        ],
      },
      {
        type: 'clause',
        title: '6. Reverse pickup',
        paragraphs: [
          'An approved return may use Blue Dart reverse pickup, customer-arranged delivery or a manual logistics method confirmed by support. Blue Dart pickup is subject to address serviceability, shipment dimensions, weight and carrier scheduling rules. A scheduled carrier pickup may be cancelled only before carrier movement begins.',
        ],
        bullets: [
          'Package the item securely and hand over only the approved item and quantity.',
          'Keep the reverse waybill or handover proof until the return is completed.',
          'Do not include unrelated valuables, documents or personal items.',
          'Carrier scheduling is not confirmation that the returned product has been received or accepted by us.',
        ],
      },
      {
        type: 'clause',
        title: '7. Receipt and inspection',
        paragraphs: [
          'Inspection begins only after the return is recorded as received. Each returned item is independently approved or rejected. Inspection may compare the item, quantity, identity, condition, photographs, order specification, packaging, invoice, certificate and fulfilment records as relevant to the stated reason.',
        ],
        bullets: [
          'An approved amount cannot exceed the proportional original line total for the returned quantity.',
          'An inspector may approve a lower amount where the supported outcome and applicable law permit.',
          'An item declared unopened or unused is restocked only if inspection approves it as sellable.',
          'If no item passes inspection, the return is rejected and no refund is initiated.',
        ],
      },
      {
        type: 'clause',
        title: '8. Partial returns and mixed decisions',
        paragraphs: [
          'A request may cover selected items or quantities. Different items in one request may receive different inspection decisions or resolutions. The approved total is the sum of item-level approved amounts, not automatically the full order value.',
        ],
      },
      {
        type: 'clause',
        title: '9. Completion',
        paragraphs: [
          'A return approved for refund cannot be manually completed until the payment refund has been initiated through the controlled refund workflow. A non-refund resolution may be completed with an administrative reference and note. The customer account will show the available status record.',
        ],
      },
      {
        type: 'clause',
        title: '10. Misuse and statutory rights',
        paragraphs: [
          'We may reject fraudulent, duplicated, altered or unsupported requests and may restrict misuse of return facilities. This does not remove remedies that cannot be excluded under applicable consumer law. Where a product is defective, wrong or materially not as described, the facts and mandatory legal rights will be considered in the final decision.',
        ],
      },
    ],
  },
  {
    key: 'refunds',
    number: '05',
    title: 'Refund Policy',
    subtitle: 'Inspection approval, amount calculation, HDFC/Juspay initiation, verification, and customer status.',
    blocks: [
      {
        type: 'callout',
        title: 'Refund trigger',
        text: 'For a product return, a refund is initiated by an authorised administrator only after the returned item is received and inspection approves the item, refund resolution and amount. Gateway confirmation, not a button click or webhook alone, determines final success.',
      },
      {
        type: 'clause',
        title: '1. When a refund is eligible',
        bullets: [
          'The related return must have reached inspected status.',
          'At least one returned item must be inspection-approved with refund as its resolution and an approved amount greater than zero.',
          'The original HDFC/Juspay payment must be captured or partially refunded and have a valid transaction reference.',
          'The requested refund must not exceed the remaining refundable captured amount.',
          'Other approved cancellation or reconciliation cases must pass the separate controlled administrative workflow.',
        ],
      },
      {
        type: 'clause',
        title: '2. Refund amount',
        paragraphs: [
          'For an inspected return, the refund amount must equal the sum of item-level approved amounts. For each item, the maximum is the proportional original line total for the approved returned quantity. This calculation preserves the order\'s recorded price, discount and tax rather than recalculating the product at a later catalog price.',
          'Current standard checkout shipping is INR 0, so there is no separate standard shipping fee in the order total to refund. Bank charges imposed independently by a customer\'s provider are outside the order amount unless law requires otherwise.',
        ],
      },
      {
        type: 'clause',
        title: '3. Initiation and processing',
        paragraphs: [
          'The refund request is sent against the original verified payment through HDFC/Juspay. The initial result may be successful, processing or failed. A processing result changes the return to refund initiated; it does not mean the customer\'s bank has posted the credit.',
        ],
      },
      {
        type: 'clause',
        title: '4. Status verification',
        paragraphs: [
          'Gateway status verification is authoritative. Payment callbacks or webhooks are treated as notifications and are verified against the gateway record before the Platform marks a refund successful. On verified success, the payment is updated to partially refunded or refunded and the related return and order records are updated as applicable.',
        ],
      },
      {
        type: 'clause',
        title: '5. Bank posting time',
        paragraphs: [
          'The Platform does not set a fixed bank posting time. After gateway confirmation, the time taken for the credit to appear depends on HDFC/Juspay, the payment network, the issuing bank, the UPI participant or wallet provider. Customers should use the refund and transaction reference when asking their provider to trace a confirmed credit.',
        ],
      },
      {
        type: 'clause',
        title: '6. Failed, pending or reversed status',
        paragraphs: [
          'A failed or pending refund is not silently treated as complete. It remains available for status checking, reconciliation or a permitted retry by an authorised operator. Do not create repeated support requests for the same transaction without sharing the existing refund reference.',
        ],
      },
      {
        type: 'clause',
        title: '7. Partial refunds',
        paragraphs: [
          'A refund may be partial where only selected items or quantities pass inspection, where an approved amount is lower than the line maximum, or where part of a captured payment was already refunded. The cumulative refunded amount will not exceed the captured payment.',
        ],
      },
      {
        type: 'clause',
        title: '8. Store credit',
        paragraphs: [
          'Where store credit was requested and approved instead of a payment refund, the resolution is completed through the applicable administrative confirmation or reference. Store credit is distinct from an HDFC/Juspay refund and follows any validity or use conditions communicated with that credit.',
        ],
      },
      {
        type: 'clause',
        title: '9. Notifications and support',
        paragraphs: [
          'The customer may view available refund records linked to their account and may receive status notifications. For support, provide the order ID, return ID, refund reference, payment transaction reference and date. Never provide a full card number, CVV, password or OTP.',
        ],
      },
      {
        type: 'clause',
        title: '10. Chargebacks and duplicate recovery',
        paragraphs: [
          'If a chargeback, bank dispute or duplicate credit relates to an amount already refunded or settled, the transaction may be investigated and records shared with the relevant payment provider as permitted by law. Fraudulent or duplicate recovery attempts may result in account restriction and legal action.',
        ],
      },
    ],
  },
  {
    key: 'buyback',
    number: '06',
    title: 'Buyback Policy',
    subtitle: 'Eligibility, fixed-value calculation, appointment, inspection, offer acceptance, and offline settlement.',
    blocks: [
      {
        type: 'callout',
        title: 'Current default buyback terms',
        text: 'Eligible jewellery currently has a default buyback rate of 65% of its proportional original invoice line total, within 12 calendar months from the recorded purchase date. The rate, window and policy version stored when a request is created govern that request.',
      },
      {
        type: 'clause',
        title: '1. Nature of the program',
        paragraphs: [
          'Buyback is a voluntary post-purchase program for qualifying jewellery. It is separate from return, refund, exchange, warranty and statutory consumer remedies. Submission of a request is not an unconditional promise to purchase the jewellery.',
        ],
      },
      {
        type: 'clause',
        title: '2. Eligibility',
        bullets: [
          'The original order must be delivered or closed, with a recorded delivered date and delivered fulfilment for the item.',
          'An original invoice record must exist for the order.',
          'The product type must be jewellery.',
          'The request must be within the applicable policy window measured from the purchase date recorded as order confirmation date or, if unavailable, order creation date.',
          'The requested quantity must remain available after active returns and other reserved or completed buyback requests.',
          'Product, invoice, certificate, ownership and condition checks must pass at in-person inspection.',
        ],
      },
      {
        type: 'clause',
        title: '3. Calculation',
        paragraphs: [
          'The estimated and offer amount is calculated from the proportional original invoice line total for the requested quantity multiplied by the applicable buyback rate. The original line total reflects the saved transaction price, discount and tax allocation. It is not a live market-price, metal-rate or catalog-price calculation.',
        ],
      },
      {
        type: 'formula',
        text: 'Buyback amount = (original invoice line total / original quantity) x requested quantity x applicable rate',
      },
      {
        type: 'clause',
        title: '4. Required submission',
        bullets: [
          'At least one current product image.',
          'At least one image of the original IGI certificate.',
          'The IGI certificate number.',
          'One to three preferred future shop appointment slots, each not longer than four hours.',
          'Acceptance of all declarations: the jewellery is in the same condition, the original IGI certificate is available, the original invoice is available, and this Policy is accepted.',
        ],
      },
      {
        type: 'clause',
        title: '5. Appointment and check-in',
        paragraphs: [
          'An accepted request is scheduled for an in-person shop appointment. The normal sequence is requested, appointment scheduled, checked in and under inspection. Bring the jewellery, original invoice, original IGI certificate and identity or ownership information reasonably required for verification.',
        ],
      },
      {
        type: 'clause',
        title: '6. Inspection checklist',
        paragraphs: [
          'The offer can proceed only if each required check is passed: identity verified, ownership verified, original invoice presented, original IGI certificate presented, certificate in good condition, jewellery in the declared same condition, and product matched to the transaction record.',
          'If any required check fails, the request is rejected with a reason. A failed buyback inspection does not determine a separate statutory defect claim, which must be raised through the appropriate support or return channel.',
        ],
      },
      {
        type: 'clause',
        title: '7. Offer',
        paragraphs: [
          'When every inspection check passes, the Platform produces a fixed offer using the request\'s stored estimated amount and rate. The customer may accept or decline. Acceptance records the policy version, time and network address for transaction evidence.',
        ],
      },
      {
        type: 'clause',
        title: '8. Cancellation, withdrawal and no-show',
        bullets: [
          'The customer may cancel while the request is requested or appointment scheduled.',
          'After check-in and before settlement, the customer may request withdrawal while checked in, under inspection or offer ready.',
          'A declined, rejected or withdrawn request is closed after the item is handed back and the handover is recorded.',
          'A missed appointment may be closed as a no-show. A new request remains subject to then-current eligibility and quantity availability.',
        ],
      },
      {
        type: 'clause',
        title: '9. Settlement',
        paragraphs: [
          'Settlement begins only after customer acceptance and is completed by an authorised administrator. Supported offline modes may include NEFT, IMPS, cheque, cash or store credit. A settlement reference is required and proof may be attached. The availability of a mode is subject to legal, accounting, security and operational checks.',
          'No fixed settlement posting time is promised in this Policy. Bank and instrument processing times may vary. The recorded settlement reference should be used for any follow-up.',
        ],
      },
      {
        type: 'clause',
        title: '10. Evidence, privacy and fraud prevention',
        paragraphs: [
          'Buyback images and documents are stored as controlled private media and accessed using signed links. We may retain the request, inspection, acceptance and settlement record for audit, fraud prevention, tax, accounting, legal and dispute purposes.',
          'Altered certificates, false ownership claims, substituted products, duplicate requests or other fraud may result in rejection, account restriction and reporting to relevant authorities.',
        ],
      },
      {
        type: 'clause',
        title: '11. Interaction with returns',
        paragraphs: [
          'A quantity reserved in an active return is not simultaneously available for buyback, and a quantity reserved or completed in buyback is not available for return. This prevents duplicate recovery against the same purchased unit.',
        ],
      },
      {
        type: 'clause',
        title: '12. Policy changes',
        paragraphs: [
          'The default rate, eligibility window and version may be updated prospectively. The policy snapshot stored on an existing request controls its calculation and eligibility deadline, subject to mandatory law and correction of manifest system error.',
        ],
      },
    ],
  },
];

const generateCustomerPoliciesPdf = () => {
const doc = new PDFDocument({
  autoFirstPage: false,
  bufferPages: true,
  compress: true,
  info: {
    Title: `Bruce & Walsh ${DOCUMENT_TITLE}`,
    Author: profile.companyName,
    Subject: 'Terms, privacy, shipping, return, refund and buyback policies',
    Keywords: 'Bruce & Walsh, terms, privacy, shipping, return, refund, buyback',
    CreationDate: new Date('2026-07-28T00:00:00+05:30'),
    ModDate: new Date('2026-07-28T00:00:00+05:30'),
  },
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const stream = fs.createWriteStream(outputPath);
doc.pipe(stream);

let currentSection = '';
let currentPageNumber = 0;
const sectionPages = {};
const tocAnchors = [];

const setFont = (size = 9.3, color = COLOR.ink, bold = false) => {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
};

const drawHeader = () => {
  const y = 28;
  if (fs.existsSync(profile.logoPath)) {
    doc.image(profile.logoPath, PAGE.left, 20, { fit: [28, 28], align: 'center', valign: 'center' });
  }
  setFont(7.4, COLOR.brown, true);
  doc.text('BRUCE & WALSH', PAGE.left + 38, y, { width: 130, lineBreak: false });
  setFont(7.2, COLOR.soft, false);
  doc.text(DOCUMENT_TITLE.toUpperCase(), PAGE.width - PAGE.right - 190, y, {
    width: 190,
    align: 'right',
    lineBreak: false,
  });
  doc
    .moveTo(PAGE.left, 52)
    .lineTo(PAGE.width - PAGE.right, 52)
    .lineWidth(0.8)
    .strokeColor(COLOR.line)
    .stroke();
};

const addPage = ({ header = true, section = currentSection, background = COLOR.white } = {}) => {
  doc.addPage({ size: 'A4', margins: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.left, right: PAGE.right } });
  currentPageNumber += 1;
  currentSection = section;
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(background);
  if (header) drawHeader();
  doc.x = PAGE.left;
  doc.y = header ? PAGE.top : PAGE.left;
};

const ensureSpace = (height, options = {}) => {
  if (doc.y + height <= PAGE.contentBottom) return;
  addPage({ section: currentSection });
  if (options.repeatTitle && currentSection) {
    setFont(8.2, COLOR.orangeDark, true);
    doc.text(currentSection.toUpperCase(), PAGE.left, PAGE.top, { width: PAGE.contentWidth });
    doc.y += 12;
  }
};

const addParagraph = (text, options = {}) => {
  const width = options.width || PAGE.contentWidth;
  const size = options.size || 9.3;
  const lineGap = options.lineGap === undefined ? 2.1 : options.lineGap;
  const after = options.after === undefined ? 8 : options.after;
  setFont(size, options.color || COLOR.ink, Boolean(options.bold));
  const height = doc.heightOfString(text, { width, lineGap, align: options.align || 'left' });
  ensureSpace(height + after);
  doc.text(text, PAGE.left, doc.y, {
    width,
    lineGap,
    align: options.align || 'left',
    link: options.link,
    underline: options.underline,
  });
  doc.y += after;
};

const addClauseHeading = (title, leadContentHeight = 32) => {
  setFont(11.2, COLOR.brown, true);
  const height = doc.heightOfString(title, { width: PAGE.contentWidth });
  ensureSpace(height + 27 + leadContentHeight);
  doc.text(title, PAGE.left, doc.y, { width: PAGE.contentWidth });
  doc.y += 7;
  doc
    .moveTo(PAGE.left, doc.y)
    .lineTo(PAGE.left + 28, doc.y)
    .lineWidth(1.6)
    .strokeColor(COLOR.orange)
    .stroke();
  doc.y += 9;
};

const addBullets = (items) => {
  for (const item of items) {
    setFont(9.2, COLOR.ink, false);
    const textWidth = PAGE.contentWidth - 22;
    const height = doc.heightOfString(item, { width: textWidth, lineGap: 2 });
    ensureSpace(height + 6);
    const startY = doc.y;
    doc.circle(PAGE.left + 4, startY + 5, 2.1).fill(COLOR.orange);
    setFont(9.2, COLOR.ink, false);
    doc.text(item, PAGE.left + 16, startY, { width: textWidth, lineGap: 2 });
    doc.y = startY + height + 6;
  }
  doc.y += 2;
};

const addCallout = (title, text) => {
  const innerWidth = PAGE.contentWidth - 30;
  setFont(8.5, COLOR.brown, true);
  const titleHeight = doc.heightOfString(title.toUpperCase(), { width: innerWidth });
  setFont(9.2, COLOR.ink, false);
  const textHeight = doc.heightOfString(text, { width: innerWidth, lineGap: 2 });
  const total = titleHeight + textHeight + 31;
  ensureSpace(total + 12);
  const y = doc.y;
  doc.roundedRect(PAGE.left, y, PAGE.contentWidth, total, 4).fillAndStroke(COLOR.orangePale, COLOR.line);
  setFont(8.5, COLOR.brown, true);
  doc.text(title.toUpperCase(), PAGE.left + 15, y + 11, { width: innerWidth });
  setFont(9.2, COLOR.ink, false);
  doc.text(text, PAGE.left + 15, y + 11 + titleHeight + 7, { width: innerWidth, lineGap: 2 });
  doc.y = y + total + 14;
};

const addFormula = (text) => {
  setFont(10, COLOR.brown, true);
  const height = doc.heightOfString(text, { width: PAGE.contentWidth - 36, align: 'center' });
  ensureSpace(height + 34);
  const y = doc.y;
  doc.roundedRect(PAGE.left, y, PAGE.contentWidth, height + 24, 4).fill(COLOR.brownPale);
  setFont(10, COLOR.brown, true);
  doc.text(text, PAGE.left + 18, y + 12, { width: PAGE.contentWidth - 36, align: 'center' });
  doc.y = y + height + 36;
};

const renderBlocks = (blocks) => {
  for (const block of blocks) {
    if (block.type === 'callout') {
      addCallout(block.title, block.text);
      continue;
    }
    if (block.type === 'formula') {
      addFormula(block.text);
      continue;
    }
    let leadContentHeight = 32;
    if (block.paragraphs && block.paragraphs.length) {
      setFont(9.3, COLOR.ink, false);
      leadContentHeight = doc.heightOfString(block.paragraphs[0], {
        width: PAGE.contentWidth,
        lineGap: 2.1,
      });
    } else if (block.bullets && block.bullets.length) {
      setFont(9.2, COLOR.ink, false);
      leadContentHeight = doc.heightOfString(block.bullets[0], {
        width: PAGE.contentWidth - 22,
        lineGap: 2,
      });
    }
    addClauseHeading(block.title, Math.min(leadContentHeight, 105));
    for (const paragraph of block.paragraphs || []) addParagraph(paragraph);
    if (block.bullets) addBullets(block.bullets);
    doc.y += 4;
  }
};

const drawCover = () => {
  addPage({ header: false, section: 'Cover', background: COLOR.paper });
  doc.rect(0, 0, 17, PAGE.height).fill(COLOR.orange);
  doc.rect(17, 0, 5, PAGE.height).fill(COLOR.brown);

  if (fs.existsSync(profile.logoPath)) {
    doc.image(profile.logoPath, PAGE.left + 8, 78, { fit: [108, 108], align: 'center', valign: 'center' });
  }

  setFont(10, COLOR.orangeDark, true);
  doc.text('BRUCE & WALSH', PAGE.left + 8, 206, { width: PAGE.contentWidth - 16, characterSpacing: 1.2 });
  setFont(32, COLOR.brown, true);
  doc.text('Customer Policies', PAGE.left + 8, 235, { width: PAGE.contentWidth - 16 });
  doc.text('& Terms', PAGE.left + 8, 275, { width: PAGE.contentWidth - 16 });
  doc
    .moveTo(PAGE.left + 8, 334)
    .lineTo(PAGE.left + 118, 334)
    .lineWidth(4)
    .strokeColor(COLOR.orange)
    .stroke();

  setFont(11.5, COLOR.ink, false);
  doc.text('Terms and Conditions  |  Privacy  |  Shipping', PAGE.left + 8, 362, { width: PAGE.contentWidth - 16 });
  doc.text('Returns  |  Refunds  |  Buyback', PAGE.left + 8, 383, { width: PAGE.contentWidth - 16 });

  doc.roundedRect(PAGE.left + 8, 476, PAGE.contentWidth - 16, 108, 4).fillAndStroke(COLOR.white, COLOR.line);
  setFont(8, COLOR.soft, true);
  doc.text('ISSUED BY', PAGE.left + 25, 495, { width: 190 });
  setFont(11, COLOR.brown, true);
  doc.text(profile.companyName, PAGE.left + 25, 512, { width: PAGE.contentWidth - 50 });
  setFont(8.7, COLOR.ink, false);
  doc.text(`Version ${DOCUMENT_VERSION}  |  Effective ${EFFECTIVE_DATE}`, PAGE.left + 25, 548, {
    width: PAGE.contentWidth - 50,
  });

  setFont(8, COLOR.muted, false);
  doc.text(
    'Customer-facing policy document. Order-specific records, accepted terms and mandatory law prevail where applicable.',
    PAGE.left + 8,
    718,
    { width: PAGE.contentWidth - 16, lineGap: 2 },
  );
  setFont(7.5, COLOR.brown, true);
  doc.text(`GSTIN ${profile.gstin}  |  CIN ${profile.cin}`, PAGE.left + 8, 744, {
    width: PAGE.contentWidth - 16,
  });
};

const drawOverview = () => {
  addPage({ section: 'Document Overview' });
  setFont(8.5, COLOR.orangeDark, true);
  doc.text('DOCUMENT  /  VERSION 1.0', PAGE.left, PAGE.top, { width: PAGE.contentWidth });
  doc.y += 10;
  setFont(24, COLOR.brown, true);
  doc.text('Document Overview', PAGE.left, doc.y, { width: PAGE.contentWidth });
  doc.y += 14;
  addParagraph(
    'This handbook consolidates the customer terms and operational policies used by Bruce & Walsh. It is designed to keep the public explanation consistent with checkout, tax, order, logistics, return inspection, refund and buyback records.',
    { size: 10.2, lineGap: 3, after: 16 },
  );

  addCallout(
    'Important hierarchy',
    'Mandatory law prevails. For a specific transaction, the accepted checkout details, product listing, invoice, stored tax breakup, request-specific policy snapshot and written support confirmation apply together with this document.',
  );

  addClauseHeading('Current operational settings');
  const rows = [
    ['Standard shipping', 'INR 0 at current checkout'],
    ['Return request window', '7 calendar days from recorded delivery (current default)'],
    ['Return decision', 'Item-level inspection after receipt'],
    ['Payment refund route', 'Original verified HDFC/Juspay transaction'],
    ['Buyback rate', '65% of proportional original invoice line total (current default)'],
    ['Buyback window', '12 calendar months from recorded purchase date (current default)'],
    ['GST place of supply', 'Maharashtra: CGST + SGST; other states: IGST'],
  ];
  const leftWidth = 168;
  for (let index = 0; index < rows.length; index += 1) {
    const [label, value] = rows[index];
    setFont(8.5, COLOR.brown, true);
    const h1 = doc.heightOfString(label, { width: leftWidth - 16 });
    setFont(8.7, COLOR.ink, false);
    const h2 = doc.heightOfString(value, { width: PAGE.contentWidth - leftWidth - 20 });
    const rowHeight = Math.max(h1, h2) + 18;
    ensureSpace(rowHeight);
    const y = doc.y;
    doc.rect(PAGE.left, y, PAGE.contentWidth, rowHeight).fill(index % 2 ? COLOR.white : COLOR.paper);
    doc
      .moveTo(PAGE.left, y + rowHeight)
      .lineTo(PAGE.width - PAGE.right, y + rowHeight)
      .lineWidth(0.5)
      .strokeColor(COLOR.lightLine)
      .stroke();
    setFont(8.5, COLOR.brown, true);
    doc.text(label, PAGE.left + 8, y + 9, { width: leftWidth - 16 });
    setFont(8.7, COLOR.ink, false);
    doc.text(value, PAGE.left + leftWidth + 8, y + 9, { width: PAGE.contentWidth - leftWidth - 16 });
    doc.y = y + rowHeight;
  }
  doc.y += 15;
  addParagraph(
    'Configurable settings may change prospectively. A return or buyback request stores or applies the value in force for that request, and the customer-facing transaction record should be checked for the applicable terms.',
    { size: 8.7, color: COLOR.muted },
  );
};

const drawContents = () => {
  addPage({ section: 'Contents' });
  setFont(8.5, COLOR.orangeDark, true);
  doc.text('NAVIGATION', PAGE.left, PAGE.top, { width: PAGE.contentWidth });
  doc.y += 10;
  setFont(24, COLOR.brown, true);
  doc.text('Contents', PAGE.left, doc.y, { width: PAGE.contentWidth });
  doc.y += 25;

  const entries = [
    ['terms', '01', 'Terms and Conditions', 'Accounts, products, price, tax, payment and use'],
    ['privacy', '02', 'Privacy Policy', 'Data lifecycle, security, sharing and customer rights'],
    ['shipping', '03', 'Shipping Policy', 'Serviceability, Blue Dart, tracking and delivery'],
    ['returns', '04', 'Return Policy', 'Eligibility, reverse pickup and item inspection'],
    ['refunds', '05', 'Refund Policy', 'Approved amount, HDFC/Juspay and status verification'],
    ['buyback', '06', 'Buyback Policy', '65% default, 12-month window and in-person inspection'],
    ['contact', '07', 'Contact & Legal Framework', 'Support, grievance contact and governing references'],
  ];

  for (const [key, number, title, description] of entries) {
    const y = doc.y;
    doc.circle(PAGE.left + 18, y + 19, 17).fill(COLOR.orangePale);
    setFont(9, COLOR.brown, true);
    doc.text(number, PAGE.left + 7, y + 14, { width: 22, align: 'center', lineBreak: false });
    setFont(11, COLOR.ink, true);
    doc.text(title, PAGE.left + 50, y + 4, { width: 300, lineBreak: false });
    setFont(8.3, COLOR.muted, false);
    doc.text(description, PAGE.left + 50, y + 23, { width: 350, lineBreak: false });
    doc
      .moveTo(PAGE.left + 50, y + 47)
      .lineTo(PAGE.width - PAGE.right, y + 47)
      .lineWidth(0.5)
      .strokeColor(COLOR.lightLine)
      .stroke();
    tocAnchors.push({ key, pageIndex: currentPageNumber - 1, x: PAGE.width - PAGE.right - 38, y: y + 14 });
    doc.y = y + 62;
  }
};

const drawSectionStart = (section) => {
  addPage({ section: section.title, background: COLOR.paper });
  sectionPages[section.key] = currentPageNumber;

  setFont(58, COLOR.orangePale, true);
  doc.text(section.number, PAGE.width - PAGE.right - 130, 83, { width: 130, align: 'right' });
  setFont(8.5, COLOR.orangeDark, true);
  doc.text(`POLICY ${section.number}`, PAGE.left, 98, { width: 120 });
  setFont(26, COLOR.brown, true);
  doc.text(section.title, PAGE.left, 128, { width: PAGE.contentWidth - 80 });
  setFont(10.3, COLOR.muted, false);
  doc.text(section.subtitle, PAGE.left, 174, { width: PAGE.contentWidth - 35, lineGap: 3 });
  doc
    .moveTo(PAGE.left, 229)
    .lineTo(PAGE.left + 92, 229)
    .lineWidth(4)
    .strokeColor(COLOR.orange)
    .stroke();
  doc.y = 257;
  renderBlocks(section.blocks);
};

const drawContact = () => {
  addPage({ section: 'Contact & Legal Framework', background: COLOR.paper });
  sectionPages.contact = currentPageNumber;
  setFont(8.5, COLOR.orangeDark, true);
  doc.text('POLICY 07', PAGE.left, 98, { width: 120 });
  setFont(26, COLOR.brown, true);
  doc.text('Contact & Legal Framework', PAGE.left, 128, { width: PAGE.contentWidth });
  setFont(10.3, COLOR.muted, false);
  doc.text('Customer support, privacy grievance contact, corporate identity and applicable framework.', PAGE.left, 174, {
    width: PAGE.contentWidth - 35,
    lineGap: 3,
  });
  doc
    .moveTo(PAGE.left, 229)
    .lineTo(PAGE.left + 92, 229)
    .lineWidth(4)
    .strokeColor(COLOR.orange)
    .stroke();
  doc.y = 257;

  addClauseHeading('Customer support and grievance contact');
  addParagraph(profile.companyName, { size: 11, color: COLOR.brown, bold: true, after: 5 });
  for (const line of profile.addressLines) addParagraph(line, { size: 9.1, after: 2 });
  addParagraph(`Email: ${profile.email}`, { size: 9.1, after: 2 });
  addParagraph(`Phone: +91 ${profile.phone}`, { size: 9.1, after: 2 });
  addParagraph('Designation: Customer Support / Grievance Contact', { size: 9.1, after: 12 });

  addCallout(
    'What to include',
    'Provide your registered name and contact, order or request ID, relevant waybill or transaction reference, a concise issue description, and supporting evidence. Never send a password, OTP, CVV or full card number.',
  );

  addClauseHeading('Corporate information');
  addBullets([
    `GSTIN: ${profile.gstin}`,
    `CIN: ${profile.cin}`,
    `PAN: ${profile.pan}`,
    `State: ${profile.stateName} (${profile.stateCode})`,
    `Jurisdiction: ${profile.jurisdiction}, subject to mandatory consumer and statutory jurisdiction`,
  ]);

  addPage({ section: 'Contact & Legal Framework' });
  setFont(8.2, COLOR.orangeDark, true);
  doc.text('LEGAL REFERENCES & CHANGE CONTROL', PAGE.left, PAGE.top, { width: PAGE.contentWidth });
  doc.y += 18;

  addClauseHeading('Legal and regulatory framework');
  addParagraph(
    'This document is intended to operate in accordance with applicable Indian law, including the Consumer Protection Act, 2019, the Consumer Protection (E-Commerce) Rules, 2020, the Information Technology Act, 2000, and the Digital Personal Data Protection Act, 2023 and Digital Personal Data Protection Rules, 2025 as their relevant provisions are brought into force and apply.',
  );
  addParagraph(
    'Official consumer law reference: https://www.indiacode.nic.in/handle/123456789/17038',
    { size: 8, color: COLOR.muted, link: 'https://www.indiacode.nic.in/handle/123456789/17038', underline: true },
  );
  addParagraph(
    'Official data protection reference: https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa',
    {
      size: 8,
      color: COLOR.muted,
      link: 'https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa',
      underline: true,
    },
  );

  addClauseHeading('Review and change control');
  addParagraph(
    'This is version 1.0, effective on the date shown. Operational settings, provider capabilities and law may change. The Platform should publish the current version, preserve accepted transaction records, and route material changes through authorised business and legal review before they take effect.',
  );
  addCallout(
    'End of document',
    'These policies are written as a single consistent customer handbook. No clause removes a right or remedy that cannot lawfully be excluded.',
  );
};

const applyContentsPageNumbers = () => {
  for (const anchor of tocAnchors) {
    const pageNumber = sectionPages[anchor.key];
    doc.switchToPage(anchor.pageIndex);
    setFont(10, COLOR.orangeDark, true);
    doc.text(String(pageNumber).padStart(2, '0'), anchor.x, anchor.y, {
      width: 38,
      align: 'right',
      lineBreak: false,
    });
  }
};

const applyFooters = () => {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.page.margins.bottom = 0;
    const pageNo = index + 1;
    doc
      .moveTo(PAGE.left, PAGE.height - 45)
      .lineTo(PAGE.width - PAGE.right, PAGE.height - 45)
      .lineWidth(0.6)
      .strokeColor(index === 0 ? COLOR.line : COLOR.lightLine)
      .stroke();
    setFont(7.2, COLOR.muted, false);
    doc.text(`Version ${DOCUMENT_VERSION}  |  Effective ${EFFECTIVE_DATE}`, PAGE.left, PAGE.height - 34, {
      width: 220,
      lineBreak: false,
    });
    setFont(7.4, COLOR.brown, true);
    doc.text(`${String(pageNo).padStart(2, '0')} / ${String(range.count).padStart(2, '0')}`, PAGE.width - PAGE.right - 80, PAGE.height - 34, {
      width: 80,
      align: 'right',
      lineBreak: false,
    });
  }
};

drawCover();
drawOverview();
drawContents();
for (const section of sections) drawSectionStart(section);
drawContact();
applyContentsPageNumbers();
applyFooters();
doc.end();

stream.on('finish', () => {
  process.stdout.write(`${outputPath}\n`);
});
};

if (require.main === module) generateCustomerPoliciesPdf();

module.exports = {
  DOCUMENT_VERSION,
  EFFECTIVE_DATE,
  generateCustomerPoliciesPdf,
  sections,
};
