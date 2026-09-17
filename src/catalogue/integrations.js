// SequentDraw's integration catalogue: the pool the suggestion step picks from
// (docs/design/suggestion-agent.md, owner decision A, 2026-09-17).
//
// WHAT THIS LIST IS
// A list SequentDraw writes itself. Every entry holds only:
//   id          our own stable kebab-case key (not any other project's identifier)
//   name        the product's name, a public fact
//   category    one of SequentDraw's own categories (./categories.js)
//   description one line, at most 120 characters, written by SequentDraw
//   icon        a Simple Icons slug (CC0), or null when Simple Icons has no mark
//               for the brand. Never a guessed or nearby-looking icon.
//
// WHAT THIS LIST MUST NEVER HOLD
// Nothing from n8n's source code, node definitions, descriptions, node type
// ids, icons or credential schemas, and no popularity data. The repository is
// public and MIT, and n8n is under the Sustainable Use License, so none of it
// may be republished here. No budget, price, cost, plan or region data either:
// suggestions are workflow improvements only, and the user decides what fits.
// tests/catalogue.test.js enforces the shape and these exclusions.
//
// HOW EACH NAME WAS VERIFIED (2026-09-17)
// Every entry's product exists as an n8n integration. Checked by requesting
// n8n's public integration page, https://n8n.io/integrations/<page>/, and
// confirming an HTTP 200 whose <title> names the product. Only the product
// name was read from the page; nothing else was kept. The page path is
// usually the lowercased, hyphenated name (for example `google-sheets`).
// Exceptions: trigger-only integrations end in `-trigger` (Typeform, Jotform,
// Tally, Postmark, Acuity Scheduling, Facebook Lead Ads; Cal.com is
// `cal-trigger`), and Help Scout is `helpscout`, Monday.com `mondaycom`,
// Microsoft Excel 365 `microsoft-excel`, X (Formerly Twitter) `twitter`.
// Names whose page returned 404 were left out rather than guessed.
// Re-verify any entry you add the same way before committing it.

const INTEGRATIONS = Object.freeze([
  // --- payments ---
  { id: 'stripe', name: 'Stripe', category: 'payments', description: 'Takes card payments online and runs subscriptions, refunds and payouts.', icon: 'stripe' },
  { id: 'paypal', name: 'PayPal', category: 'payments', description: 'Accepts wallet and card payments and sends payouts to people.', icon: 'paypal' },
  { id: 'chargebee', name: 'Chargebee', category: 'payments', description: 'Manages recurring billing: subscriptions, renewals, invoices and dunning.', icon: null },
  { id: 'paddle', name: 'Paddle', category: 'payments', description: 'Sells software and digital products, handling checkout and sales tax as the merchant.', icon: 'paddle' },
  { id: 'mollie', name: 'Mollie', category: 'payments', description: 'Takes online payments through cards and local European payment methods.', icon: null },

  // --- accounting ---
  { id: 'quickbooks-online', name: 'QuickBooks Online', category: 'accounting', description: 'Keeps the books: invoices, bills, expenses and customer balances.', icon: 'quickbooks' },
  { id: 'xero', name: 'Xero', category: 'accounting', description: 'Bookkeeping for invoices, bills, bank reconciliation and contacts.', icon: 'xero' },
  { id: 'zoho-books', name: 'Zoho Books', category: 'accounting', description: 'Accounting for invoices, estimates, expenses and payments received.', icon: 'zoho' },
  { id: 'invoice-ninja', name: 'Invoice Ninja', category: 'accounting', description: 'Creates and sends invoices and quotes, and records payments against them.', icon: 'invoiceninja' },
  { id: 'invoiced', name: 'Invoiced', category: 'accounting', description: 'Sends invoices and follows up on accounts receivable until they are paid.', icon: null },

  // --- crm ---
  { id: 'hubspot', name: 'HubSpot', category: 'crm', description: 'Tracks contacts, companies and deals, with forms and email follow-up.', icon: 'hubspot' },
  { id: 'salesforce', name: 'Salesforce', category: 'crm', description: 'Records leads, accounts, opportunities and cases for a sales team.', icon: 'salesforce' },
  { id: 'pipedrive', name: 'Pipedrive', category: 'crm', description: 'A sales pipeline of deals moving through stages, with activities and reminders.', icon: null },
  { id: 'zoho-crm', name: 'Zoho CRM', category: 'crm', description: 'Keeps leads, contacts and deals, with tasks for the people who chase them.', icon: 'zoho' },
  { id: 'keap', name: 'Keap', category: 'crm', description: 'Contact records and follow-up sequences for small service businesses.', icon: null },
  { id: 'highlevel', name: 'HighLevel', category: 'crm', description: 'Contacts, opportunities and appointments for agencies and their clients.', icon: null },

  // --- email ---
  { id: 'gmail', name: 'Gmail', category: 'email', description: 'Sends, reads and labels email in a Google mailbox.', icon: 'gmail' },
  { id: 'microsoft-outlook', name: 'Microsoft Outlook', category: 'email', description: 'Sends, reads and files email in a Microsoft 365 mailbox.', icon: null },
  { id: 'sendgrid', name: 'SendGrid', category: 'email', description: 'Sends transactional email such as receipts, resets and notifications from an app.', icon: 'sendgrid' },
  { id: 'mailgun', name: 'Mailgun', category: 'email', description: 'Sends and receives email through an API for application messages.', icon: 'mailgun' },
  { id: 'postmark', name: 'Postmark', category: 'email', description: 'Delivers transactional email and reports bounces and opens back to the app.', icon: null },

  // --- email-marketing ---
  { id: 'mailchimp', name: 'Mailchimp', category: 'email-marketing', description: 'Keeps a mailing list and sends newsletters and campaigns to it.', icon: 'mailchimp' },
  { id: 'brevo', name: 'Brevo', category: 'email-marketing', description: 'Email and SMS campaigns to contact lists, plus transactional sends.', icon: 'brevo' },
  { id: 'activecampaign', name: 'ActiveCampaign', category: 'email-marketing', description: 'Email campaigns and automated follow-up sequences triggered by contact behaviour.', icon: null },
  { id: 'convertkit', name: 'ConvertKit', category: 'email-marketing', description: 'Subscriber lists, sign-up forms and email sequences for creators.', icon: null },
  { id: 'mailerlite', name: 'MailerLite', category: 'email-marketing', description: 'Newsletters, subscriber groups and simple automated email flows.', icon: null },

  // --- messaging ---
  { id: 'slack', name: 'Slack', category: 'messaging', description: 'Team chat in channels; posts alerts and collects replies from staff.', icon: 'slack' },
  { id: 'microsoft-teams', name: 'Microsoft Teams', category: 'messaging', description: 'Team chat and channel messages inside Microsoft 365.', icon: null },
  { id: 'discord', name: 'Discord', category: 'messaging', description: 'Community chat servers; posts messages to channels.', icon: 'discord' },
  { id: 'telegram', name: 'Telegram', category: 'messaging', description: 'Messaging app with bots that send and receive messages from customers or staff.', icon: 'telegram' },
  { id: 'whatsapp-business-cloud', name: 'WhatsApp Business Cloud', category: 'messaging', description: 'Sends and receives WhatsApp messages with customers from a business number.', icon: 'whatsapp' },
  { id: 'twilio', name: 'Twilio', category: 'messaging', description: 'Sends SMS and places voice calls from code.', icon: 'twilio' },

  // --- calendar-booking ---
  { id: 'google-calendar', name: 'Google Calendar', category: 'calendar-booking', description: 'Creates, moves and reads events on shared Google calendars.', icon: 'googlecalendar' },
  { id: 'calendly', name: 'Calendly', category: 'calendar-booking', description: 'Lets customers book a meeting slot from a link, and reports new bookings.', icon: 'calendly' },
  { id: 'cal-com', name: 'Cal.com', category: 'calendar-booking', description: 'Open-source booking pages that report bookings, reschedules and cancellations.', icon: 'caldotcom' },
  { id: 'acuity-scheduling', name: 'Acuity Scheduling', category: 'calendar-booking', description: 'Appointment booking for client services, with intake questions.', icon: null },
  { id: 'zoom', name: 'Zoom', category: 'calendar-booking', description: 'Schedules video meetings and webinars and hands out the join links.', icon: 'zoom' },

  // --- forms ---
  { id: 'typeform', name: 'Typeform', category: 'forms', description: 'Conversational forms and surveys that report each new response.', icon: 'typeform' },
  { id: 'jotform', name: 'Jotform', category: 'forms', description: 'Online forms for orders, sign-ups and applications, reporting each submission.', icon: null },
  { id: 'google-forms', name: 'Google Forms', category: 'forms', description: 'Simple forms and quizzes whose answers collect in a Google account.', icon: 'googleforms' },
  { id: 'tally', name: 'Tally', category: 'forms', description: 'Document-style forms that report each submission as it arrives.', icon: null },
  { id: 'facebook-lead-ads', name: 'Facebook Lead Ads', category: 'forms', description: 'Lead forms inside Facebook ads that hand over each new lead.', icon: 'facebook' },

  // --- file-storage ---
  { id: 'google-drive', name: 'Google Drive', category: 'file-storage', description: 'Stores and shares files and folders in a Google account.', icon: 'googledrive' },
  { id: 'dropbox', name: 'Dropbox', category: 'file-storage', description: 'Cloud folders for storing, syncing and sharing files.', icon: 'dropbox' },
  { id: 'microsoft-onedrive', name: 'Microsoft OneDrive', category: 'file-storage', description: 'File storage and sharing inside Microsoft 365.', icon: null },
  { id: 'box', name: 'Box', category: 'file-storage', description: 'Managed file storage and sharing for teams and outside collaborators.', icon: 'box' },
  { id: 'microsoft-sharepoint', name: 'Microsoft SharePoint', category: 'file-storage', description: 'Team sites with document libraries and lists in Microsoft 365.', icon: null },

  // --- spreadsheets ---
  { id: 'google-sheets', name: 'Google Sheets', category: 'spreadsheets', description: 'Shared spreadsheets; reads, appends and updates rows.', icon: 'googlesheets' },
  { id: 'microsoft-excel-365', name: 'Microsoft Excel 365', category: 'spreadsheets', description: 'Workbooks in Microsoft 365; reads and writes tables and rows.', icon: null },
  { id: 'airtable', name: 'Airtable', category: 'spreadsheets', description: 'Spreadsheet-like database of linked records with views for each team.', icon: 'airtable' },
  { id: 'baserow', name: 'Baserow', category: 'spreadsheets', description: 'Open-source table database that can be self-hosted.', icon: 'baserow' },

  // --- e-commerce ---
  { id: 'shopify', name: 'Shopify', category: 'e-commerce', description: 'Online store for products, orders, customers and fulfilment.', icon: 'shopify' },
  { id: 'woocommerce', name: 'WooCommerce', category: 'e-commerce', description: 'Store plugin for WordPress: products, orders and customers.', icon: 'woocommerce' },
  { id: 'magento-2', name: 'Magento 2', category: 'e-commerce', description: 'Self-hosted store platform for catalogues, orders and customers.', icon: null },
  { id: 'gumroad', name: 'Gumroad', category: 'e-commerce', description: 'Sells digital products and memberships and reports each sale.', icon: 'gumroad' },

  // --- websites ---
  { id: 'wordpress', name: 'WordPress', category: 'websites', description: 'Website and blog; creates and updates posts, pages and users.', icon: 'wordpress' },
  { id: 'webflow', name: 'Webflow', category: 'websites', description: 'Visually built website with a content collection and form submissions.', icon: 'webflow' },

  // --- customer-support ---
  { id: 'zendesk', name: 'Zendesk', category: 'customer-support', description: 'Support tickets from email, chat and web, assigned to agents.', icon: 'zendesk' },
  { id: 'freshdesk', name: 'Freshdesk', category: 'customer-support', description: 'Help desk that turns customer requests into tracked tickets.', icon: null },
  { id: 'intercom', name: 'Intercom', category: 'customer-support', description: 'Live chat and messaging with customers, tied to their contact record.', icon: 'intercom' },
  { id: 'help-scout', name: 'Help Scout', category: 'customer-support', description: 'Shared inbox for customer email, with conversations assigned to people.', icon: 'helpscout' },
  { id: 'crisp', name: 'Crisp', category: 'customer-support', description: 'Website chat widget and shared inbox for customer conversations.', icon: null },

  // --- project-management ---
  { id: 'asana', name: 'Asana', category: 'project-management', description: 'Tasks and projects with owners, due dates and status.', icon: 'asana' },
  { id: 'trello', name: 'Trello', category: 'project-management', description: 'Boards of cards moved through lists as work progresses.', icon: 'trello' },
  { id: 'clickup', name: 'ClickUp', category: 'project-management', description: 'Tasks, lists and docs for planning and tracking team work.', icon: 'clickup' },
  { id: 'jira-software', name: 'Jira Software', category: 'project-management', description: 'Issue tracking for software teams: bugs, stories and sprints.', icon: 'jirasoftware' },
  { id: 'monday-com', name: 'Monday.com', category: 'project-management', description: 'Boards of items with columns for owner, status and dates.', icon: null },
  { id: 'todoist', name: 'Todoist', category: 'project-management', description: 'Personal and shared to-do lists with due dates and reminders.', icon: 'todoist' },

  // --- documents ---
  { id: 'google-docs', name: 'Google Docs', category: 'documents', description: 'Creates documents from text or templates and edits them in place.', icon: 'googledocs' },
  { id: 'notion', name: 'Notion', category: 'documents', description: 'Pages and databases used as a team wiki, tracker or content calendar.', icon: 'notion' },

  // --- marketing ---
  { id: 'linkedin', name: 'LinkedIn', category: 'marketing', description: 'Publishes posts to a personal profile or company page.', icon: null },
  { id: 'x', name: 'X (Formerly Twitter)', category: 'marketing', description: 'Publishes posts and replies from a business account.', icon: 'x' },
  { id: 'google-analytics', name: 'Google Analytics', category: 'marketing', description: 'Website traffic and conversion reports.', icon: 'googleanalytics' },

  // --- hr-and-time ---
  { id: 'bamboohr', name: 'BambooHR', category: 'hr-and-time', description: 'Employee records, time off and onboarding for a small team.', icon: null },
  { id: 'clockify', name: 'Clockify', category: 'hr-and-time', description: 'Tracks time spent per project and client.', icon: 'clockify' },
  { id: 'harvest', name: 'Harvest', category: 'hr-and-time', description: 'Tracks billable hours and turns them into client invoices.', icon: null },
].map(Object.freeze));

module.exports = { INTEGRATIONS };
