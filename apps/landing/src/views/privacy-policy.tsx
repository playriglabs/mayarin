import { LegalPage, List, P, Strong } from "./legal-page.tsx";

const SECTIONS = [
  {
    title: "What we collect",
    body: (
      <>
        <P>We collect only what we need to run the service.</P>
        <List>
          <li>
            <Strong>Contact details.</Strong> The details you give us when you book a demo or write
            to us, such as your name, email address and company.
          </li>
          <li>
            <Strong>Account details.</Strong> If you are a merchant, your login, business details,
            settlement wallet address and the settings you choose in the dashboard.
          </li>
          <li>
            <Strong>Payment records.</Strong> The amounts, assets, chains, wallet addresses and
            transaction hashes of payments that run through Mayarin.
          </li>
          <li>
            <Strong>Technical data.</Strong> IP address, browser type and error reports, collected
            to keep the service secure and working.
          </li>
        </List>
      </>
    ),
  },
  {
    title: "What we don't collect",
    body: (
      <List>
        <li>We never ask for your wallet's private key or seed phrase.</li>
        <li>We do not sell your personal information.</li>
        <li>We do not use your data to show you third-party advertising.</li>
      </List>
    ),
  },
  {
    title: "Public records and private transactions",
    body: (
      <P>
        Blockchain transactions are public by design. Once a payment is confirmed on-chain, its
        details are visible to anyone and cannot be edited or removed by us or by you. Records that
        sit in Mayarin's own systems, such as your account and contact details, are private and are
        handled as described in this policy.
      </P>
    ),
  },
  {
    title: "How we use your information",
    body: (
      <List>
        <li>
          To provide, secure and improve the service, including clearing and settling payments.
        </li>
        <li>To verify sign-ins and protect accounts, including two-factor authentication.</li>
        <li>To respond to your questions, demo requests and support needs.</li>
        <li>To detect fraud and abuse, and to meet our legal and regulatory obligations.</li>
        <li>To tell you about product changes, if you asked to hear from us.</li>
      </List>
    ),
  },
  {
    title: "Who we share it with",
    body: (
      <>
        <P>
          We share data only with providers that help us run Mayarin, and only what they need to do
          that job:
        </P>
        <List>
          <li>Hosting, networking and storage providers, such as Cloudflare and AWS.</li>
          <li>Monitoring and error-reporting tools, such as Sentry and UptimeRobot.</li>
          <li>Wallet and key-management infrastructure, such as Turnkey.</li>
          <li>Payment partners that carry local payment methods into stablecoins.</li>
        </List>
        <P>
          We may also disclose information when the law requires it, or to protect the security and
          rights of Mayarin and its users.
        </P>
      </>
    ),
  },
  {
    title: "How long we keep it",
    body: (
      <P>
        We keep personal information for as long as it is needed for the purposes above and to meet
        legal, accounting and audit obligations. Contact emails are kept until you ask us to remove
        them. Payment records are kept for as long as the law and our audit trail require.
      </P>
    ),
  },
  {
    title: "Your choices",
    body: (
      <>
        <P>
          You can ask us to access, correct or delete the personal information we hold about you, or
          to stop contacting you, by writing to the address below. Where the law gives you further
          rights, such as under the Indonesian Personal Data Protection Law or the GDPR, we will
          honor them.
        </P>
        <P>
          We cannot remove data that is already recorded on a public blockchain, and we may keep
          what we are required to keep by law.
        </P>
      </>
    ),
  },
  {
    title: "Children",
    body: (
      <P>
        Mayarin is built for businesses and is not directed at anyone under 18. We do not knowingly
        collect information from children.
      </P>
    ),
  },
  {
    title: "Changes",
    body: (
      <P>
        We may update this policy as the product or the law changes. The date at the top shows when
        it last changed, and we will tell account holders about material changes.
      </P>
    ),
  },
  {
    title: "Contact",
    body: (
      <P>
        Questions or requests about your data:{" "}
        <a
          class="text-ink underline underline-offset-4 hover:text-brand"
          href="mailto:hello@mayarin.xyz"
        >
          hello@mayarin.xyz
        </a>
        .
      </P>
    ),
  },
] as const;

export function PrivacyPolicy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="24 October 2026"
      intro="This policy explains what Mayarin collects, why, and the choices you have. We keep it short on purpose."
      sections={SECTIONS}
    />
  );
}
