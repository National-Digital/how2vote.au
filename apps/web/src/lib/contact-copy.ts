/** The contact page's title, which heads the page and its top bar. */
export const CONTACT_TITLE = "Contact";

/**
 * The contact form's wording: its fields, its button, and what it says once a message is sent or
 * fails to send. The contact page renders them, and the build renders each once into
 * `states/contact-form.html` for the iOS app to draw the same words from (ADR 0019 D4b).
 */
export const CONTACT_COPY = {
  name: "Name",
  email: "Email",
  message: "Message",
  offline:
    "You're offline. This site works without a connection, but sending a message needs one — please try again once you're back online.",
  error: "Sorry, that didn't send. Please check your connection and try again.",
  send: "Send message",
  sending: "Sending…",
  sent: "Thanks for getting in touch — your message has been sent. If you left an email, we'll reply there.",
  challenge:
    "This form is protected by a privacy-preserving anti-spam check computed on your device — no third-party CAPTCHA or tracker is loaded. Your message is sent to us by email through our hosting provider and is not stored by this site.",
} as const;
