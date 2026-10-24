import { LegalPage, List, P, Strong } from "./legal-page.tsx";

const SECTIONS = [
  {
    title: "The service",
    body: (
      <P>
        Mayarin is a clearing layer: a merchant prices in a local currency, a payer pays with a
        supported asset, and Mayarin routes, converts and settles the payment into the stablecoin
        the merchant chose. By using the website, dashboard, API or SDK you agree to these terms.
      </P>
    ),
  },
  {
    title: "Eligibility and accounts",
    body: (
      <List>
        <li>You must be at least 18 and able to enter a binding agreement.</li>
        <li>If you sign up for a business, you confirm you can bind it to these terms.</li>
        <li>
          You are responsible for your credentials, two-factor device, recovery codes and API keys,
          and for everything done with them.
        </li>
        <li>Give us accurate information and keep it up to date.</li>
      </List>
    ),
  },
  {
    title: "Fees",
    body: (
      <P>
        Each payment carries a protocol fee plus a network-gas fee, as shown on our website and in
        your dashboard. The fee that applies to a payment is the one in force when it is created. We
        may change fees with notice to account holders, and a change never applies to a payment
        already created.
      </P>
    ),
  },
  {
    title: "Non-custodial settlement",
    body: (
      <>
        <P>
          Settlements go to a wallet you control. Mayarin does not hold your settled funds, and our
          fee goes to a separate treasury, never into your wallet.
        </P>
        <P>
          You are responsible for the wallet you give us: its address, its keys and its access. A
          payment sent to the address you set cannot be recovered by us.
        </P>
      </>
    ),
  },
  {
    title: "Payments are final",
    body: (
      <P>
        A payment confirmed on-chain cannot be reversed by the payer, and Mayarin offers no
        chargebacks. Refunds are between you and your customer. Where a refund is supported by the
        product, it is a new payment you choose to make.
      </P>
    ),
  },
  {
    title: "Acceptable use",
    body: (
      <>
        <P>You agree not to use Mayarin to:</P>
        <List>
          <li>break the law, or process payments for illegal goods or services;</li>
          <li>launder money, evade sanctions or finance crime;</li>
          <li>defraud, deceive or harm payers or other users;</li>
          <li>probe, overload or interfere with the service, or bypass its security;</li>
          <li>misuse API keys, or share your account with people you have not authorized.</li>
        </List>
      </>
    ),
  },
  {
    title: "Compliance and taxes",
    body: (
      <P>
        You are responsible for the licenses, reporting and taxes that apply to your business and
        your sales. We may ask for information to meet our own legal duties, and may refuse or pause
        a payment where the law requires it.
      </P>
    ),
  },
  {
    title: "Third-party services and networks",
    body: (
      <P>
        Mayarin depends on blockchains, wallet providers, payment partners and infrastructure we do
        not control. Network congestion, chain halts, partner outages and changes in those systems
        can delay or prevent a payment, and we are not responsible for them.
      </P>
    ),
  },
  {
    title: "Availability",
    body: (
      <P>
        We work to keep the service running and publish its live state on our status page, but we do
        not promise it will be uninterrupted or error-free. We may change or retire features.
      </P>
    ),
  },
  {
    title: "Disclaimers and liability",
    body: (
      <>
        <P>
          The service is provided <Strong>as is</Strong> and <Strong>as available</Strong>, without
          warranties of any kind, to the fullest extent the law allows.
        </P>
        <P>
          To the fullest extent the law allows, Mayarin is not liable for indirect, incidental or
          consequential losses, lost profits, or losses from market movement, and our total
          liability for any claim is limited to the fees you paid us in the three months before it
          arose.
        </P>
      </>
    ),
  },
  {
    title: "Suspension and termination",
    body: (
      <P>
        You may stop using Mayarin at any time. We may suspend or end your access if you break these
        terms, if we must by law, or to protect users and the service. Sections that by their nature
        should survive, such as fees owed and liability limits, do.
      </P>
    ),
  },
  {
    title: "Changes",
    body: (
      <P>
        We may update these terms. The date at the top shows the latest version, and continuing to
        use Mayarin after a change means you accept it. We will tell account holders about material
        changes.
      </P>
    ),
  },
  {
    title: "Governing law",
    body: <P>[Governing law and venue to be confirmed by counsel.]</P>,
  },
  {
    title: "Contact",
    body: (
      <P>
        Questions about these terms:{" "}
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

export function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="24 October 2026"
      intro="These terms govern your use of Mayarin. Please read them before you build on it or accept a payment."
      sections={SECTIONS}
    />
  );
}
