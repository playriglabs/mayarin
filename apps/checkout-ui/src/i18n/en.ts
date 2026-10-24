/**
 * Every string the translated checkout pages show, in English. The other
 * locales are typed `Messages`, so a key added here is a compile error in each
 * of them until it is translated.
 *
 * `{name}` marks a value filled in at render time.
 */
export const en = {
  // Page chrome
  testnetBanner: "Mayarin Testnet ─ Payments use test assets and have no real-world value",
  poweredBy: "Powered by",
  language: "Language",
  paymentDetails: "Payment details",

  // Order summary
  orderSummary: "Order summary",
  total: "Total",
  moreItem: "+{count} more item",
  moreItems: "+{count} more items",

  // Choose how to pay
  chooseHowToPay: "Choose how to pay",
  payMerchant: "Pay {merchant}.",
  payMerchantWith: "Pay {merchant} with {rail}.",
  selectAssetAndNetwork: "Select an asset and network to pay {merchant}.",
  amount: "Amount",
  assetOnChain: "{asset} on {chain}",
  payWith: "Pay with",
  change: "Change",
  choose: "Choose",
  searchAssetOrNetwork: "Search asset or network",

  // The estimate
  estimatedTotalIn: "Estimated total in {asset}",
  enterAnAmount: "Enter an amount",
  calculating: "Calculating…",
  unavailable: "Unavailable",
  quoteUnavailable:
    "This payment method cannot be priced right now. Choose another option or refresh the page.",
  quoteRequestFailed:
    "We couldn't calculate this price. Check your connection, then refresh the page.",
  refreshPrice: "Refresh price",
  refreshPriceAuto: "Refresh price, updates automatically in {seconds} seconds",
  retry: "Retry",

  // The button and what surrounds it
  preparingPayment: "Preparing payment…",
  paymentUnavailable: "Payment unavailable",
  enterAmountToContinue: "Enter an amount to continue",
  calculatingPrice: "Calculating price…",
  continueWith: "Continue with {asset}",
  priceLockNote:
    "The exact price is locked for {minutes} minutes on the next step. Only send {rail} to the address shown there.",
  enterAmountFirst: "Enter an amount first.",
  unableToCreatePayment: "Unable to create the payment",
  unableToLockPrice: "Unable to lock the price",
  priceCouldNotBeLocked: "The price could not be locked",
  networkError: "Network error. Please try again.",
  noPaymentMethod: "This merchant has no payment method available",
  linkUnavailable: "This payment link is no longer available",
  contactMerchantForLink: "Contact the merchant for a new payment link.",
  contactMerchantToComplete: "Contact the merchant to complete this order.",

  // Return address
  returnAddress: "Return address",
  optional: "optional",
  aboutReturnAddress: "About the return address",
  returnAddressHint:
    "If the payment fails after you have sent the funds, they go back to this address. Use a wallet you control, not an exchange deposit address.",
  useWallet: "Use wallet",
  invalidAddress: "That is not a valid 0x address.",
  unableToConnectWallet: "Unable to connect a wallet",

  // Crypto or local currency
  paymentMethod: "Payment method",
  methodCrypto: "Crypto",
  methodCryptoHint: "From a wallet",
  methodLocal: "Local currency",
  methodLocalHint: "GCash, QRIS, FPX",
  localCurrencyIntro:
    "Pay in your own currency with an e-wallet, QRIS or bank transfer. We take the payment and deliver it to the merchant for you — there is no wallet to connect.",
  deliveredAs: "Delivered to the merchant as {rail}.",
  continueInLocal: "Continue in local currency",
  localLockNote:
    "The exact price is locked for {minutes} minutes on the next step, where you choose your method and confirm your details.",

  // Buyer protection
  buyerProtection: "Buyer protection",
  heldUntilConfirm: "Held {duration} until you confirm delivery",
  protectionOn: "On · wallet",
  connectWallet: "Connect wallet",
  remove: "Remove",
  howItWorks: "How it works",
  protectionExplain:
    "Your payment is held for {duration} until you confirm delivery, then released to the merchant. Disputes are decided by {arbiter}; if undecided, you're refunded.",
  bondNote:
    "Opening a dispute takes a bond of {percent}% of the payment, returned if your claim holds and paid to the merchant if it doesn't.",
  connectToRelease: "Connect the wallet you pay from to release or dispute later.",
  connectToTurnOn: "Connect the wallet you pay from to turn it on.",
  protectionRequired:
    "This payment requires buyer protection, which this wallet can no longer use.",
  protectionUnavailable:
    "Buyer protection isn't available for this wallet. You can still pay — the merchant is paid directly.",
  oneDay: "1 day",
  days: "{count} days",
  oneHour: "1 hour",
  hours: "{count} hours",

  // The live payment page
  paymentInstructions: "Payment instructions",
  completeYourPayment: "Complete your payment",
  timeLeft: "Time left",
  expired: "expired",
  preparingAddress: "Preparing your payment address…",
  priceBeingLocked: "Your price is being locked. Keep this page open.",
  payWithCryptoInstead: "Pay with crypto instead",
  pageUpdatesAutomatically: "This page updates automatically.",
  referenceId: "Reference ID",

  // The progress timeline and the outcome
  paymentProgress: "Payment progress",
  stepWaiting: "Waiting for payment",
  stepProcessing: "Processing payment",
  stepSuccessful: "Payment successful",
  stepSuccess: "Success",
  paymentFailed: "Payment failed",
  paymentExpired: "Payment expired",
  paymentCompleted: "Payment completed",
  paymentProcessing: "Payment processing",
  assetArrived: "Your {asset} on {chain} arrived.",
  amountReceived: "{amount} {asset} received on {chain}.",
  confirmingNow: "Confirming it now, usually under a minute.",
  noteEscrowHeld: "Your payment is held in escrow until you release it or the hold ends.",
  noteMerchantPaid: "The merchant has been paid. You can safely close this page.",
  noteExpired:
    "The time to pay ran out before a payment arrived. Start a new payment to try again.",
  noteFailed: "Start a new payment to try again.",
  alreadySentFunds:
    "Already sent funds? We recommend contacting {merchant} or your wallet or exchange provider's customer service, and sharing the Reference ID below.",
  downloadInvoice: "Download invoice",
  downloadReceipt: "Download receipt",

  // The deposit card
  qrAlt: "QR address for {asset} at {chain}",
  sendExactly: "Send exactly",
  amountCopied: "Amount copied",
  copyAmount: "Copy the amount {amount}",
  network: "Network",
  onlyAssetCounts: "Only {asset} on this network counts.",
  address: "Address",
  addressCopied: "Address copied",
  copyAddress: "Copy payment address",
  copied: "Copied",
  copy: "Copy",
  localPrice: "Local price",
  amountReceivedLabel: "Amount received",
  keyThingsToNote: "Key things to note",
  noteSendExact: "Send the exact amount before the timer runs out. The price is locked until then.",
  noteSentTooLittle:
    "Sent too little? Send the rest to the same address before the timer ends — transfers add up.",
  noteExchangeFee:
    "Don't send from an exchange that deducts its fee from the amount — the payment would arrive short.",

  // Escrow
  releasePayment: "Release payment",
  openDispute: "Open a dispute",
  statusHeld: "Held",
  statusDisputed: "Disputed",
  statusReleased: "Released",
  statusSplit: "Split",
  statusRefunded: "Refunded",
  paidToMerchant: "Paid to the merchant",
  splitByArbiter: "Split by the arbiter",
  refundedToWallet: "Refunded to your wallet",
  refundedIfUndecided: "Refunded to you if undecided by {date}",
  releasesOn: "Releases to the merchant on {date}",
  releaseStoppedMerchant: "The automatic release is stopped. The merchant can refund you.",
  releaseStoppedArbiter:
    "The automatic release is stopped. The arbiter decides, or the merchant refunds you.",
  gotWhatYouPaid: "Got what you paid for? Release it now. Something wrong? Open a dispute first.",
  gotWhatYouPaidBond:
    "Got what you paid for? Release it now. Something wrong? Open a dispute first. It takes a bond, returned if your claim holds.",
  holdEnded: "The hold has ended. It releases to the merchant shortly.",
  switchWallet: "Switch to the wallet you paid with, {address}.",
  walletRefused: "The wallet refused the transaction",
  authorYou: "You",
  authorMerchant: "Merchant",
  quoteDisputeBefore: "Quote dispute",
  quoteDisputeAfter: "if you contact support.",
  addToCase: "Add to your case",
  tellArbiter: "Tell the arbiter what went wrong",
  tellArbiterHint:
    "Tell the arbiter what went wrong: what you ordered, what arrived, any tracking.",
  signing: "Signing…",
  signAndSend: "Sign and send",
  messageNotSent: "The message was not sent",

  // Paying in local currency
  localUnavailable: "Local payment is unavailable right now",
  networkErrorTryAgain: "Network error. Try again.",
  loadingMethods: "Loading payment methods…",
  couldNotStartPayment: "We could not start this payment",
  emailNotConfirmed: "Your email is not confirmed yet. Open the link we sent, then try again.",
  methodCouldNotOpen: "This payment method could not be opened. Try another.",
  enterBirthDate: "Enter your date of birth as day, month and year.",
  confirmYourEmail: "Confirm your email",
  sentLinkTo:
    "We sent a link to {email}. Open it to confirm, then come back and continue. The link works for 10 minutes.",
  checking: "Checking…",
  iHaveConfirmed: "I have confirmed — continue",
  payIn: "Pay in",
  payingIn: "Paying in {market}",
  amountTooSmall:
    "No local payment method takes an amount this small in {currency}. Choose another currency, or pay with crypto instead.",
  bankTransfer: "Bank transfer",
  bank: "Bank",
  chooseYourBank: "Choose your bank",
  continue: "Continue",
  yourDetails: "Your details",
  email: "Email",
  firstName: "First name",
  lastName: "Last name",
  city: "City",
  phone: "Phone",
  openingPayment: "Opening payment…",
  payNow: "Pay now",
  partnerNote:
    "Our payment partner verifies your identity and takes the payment. Mayarin passes these details on and keeps none of them.",
  payInLocalCurrency: "Pay in local currency",
  localIntro: "Pay with an e-wallet, QRIS or bank transfer — no crypto wallet needed.",
  payInLocalInstead: "Pay in local currency instead",
  scanToPay: "Scan to pay",
  qrToPayAlt: "QR code to pay",
  scanWithApp: "Open your e-wallet or banking app and scan this code.",
  waitingForYourPayment: "Waiting for your payment",
  transferToAccount: "Transfer to this account",
  virtualAccount: "Virtual account",
  accountCopied: "Account number copied",
  copyAccount: "Copy the account number",
  payExactly: "Pay exactly",
  updatesByItself:
    "This page updates by itself once your payment arrives. You do not need to do anything else.",
  dateOfBirth: "Date of birth",
  day: "Day",
  month: "Month",
  year: "Year",
  back: "Back",

  // The invoice
  invoiceNumber: "Invoice {number}",
  draftNumber: "(draft)",
  invoiceLabel: "Invoice",
  invoiceDraft: "Draft",
  invoiceUnpaid: "Unpaid",
  invoicePartiallyPaid: "Partially paid",
  invoicePaid: "Paid",
  invoiceOverdue: "Overdue",
  invoiceVoid: "Void",
  issuedOn: "Issued {date}",
  dueOn: "Due {date}",
  notYetIssued: "Not yet issued",
  from: "From",
  billTo: "Bill to",
  billedTo: "Billed to",
  taxId: "Tax ID",
  taxIdValue: "Tax ID {value}",
  description: "Description",
  quantity: "Quantity",
  unitPrice: "Unit price",
  subtotal: "Subtotal",
  amountPaid: "Amount paid",
  amountDue: "Amount due",
  due: "Due",
  issued: "Issued",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
  perWeek: "/ wk",
  perMonth: "/ mo",
  perYear: "/ yr",
  subscription: "Subscription",
  payThisInvoice: "Pay this invoice",
  payableWith: "Payable with {rail}.",
  chooseHeldAsset: "Choose the asset and network you hold.",
  unableToStartPayment: "Unable to start the payment",
  payAmount: "Pay {amount}",
  exactAmountLocked:
    "The exact amount is locked on the next step, and you send {rail} to the address shown there.",
  paidWith: "Paid with",
  offChain: "Off-chain",
  onChain: "on {chain}",

  // The browser wallet
  walletNotFound: "No browser wallet found. Install MetaMask or open this page in a wallet.",
  walletNoAccount: "The wallet returned no account.",
  wrongNetwork: "Your wallet is on another network. Switch it to chain {chain} and try again.",
  txReverted: "The transaction reverted on chain.",
  txPending: "The transaction is still pending. Refresh this page in a minute.",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
