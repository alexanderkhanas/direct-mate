import { Link } from 'react-router-dom';
import { MessageSquare, ArrowLeft } from 'lucide-react';

function LegalFooter() {
  return (
    <footer className="border-t border-gray-100 py-8 mt-16">
      <div className="max-w-3xl mx-auto px-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-400">
          <MessageSquare className="h-4 w-4" />
          <span className="text-sm">DirectMate</span>
        </div>
        <div className="flex items-center gap-6">
          <Link to="/privacy" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Privacy Policy</Link>
          <Link to="/terms" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Terms and Conditions</Link>
          <Link to="/data-deletion" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Data Deletion</Link>
          <span className="text-xs text-gray-400">&copy; 2026</span>
        </div>
      </div>
    </footer>
  );
}

function LegalNav() {
  return (
    <nav className="border-b border-gray-100 bg-white sticky top-0 z-10">
      <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
        <Link to="/welcome" className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors text-sm">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-gray-900" />
          <span className="text-lg font-bold text-gray-900">DirectMate</span>
        </div>
      </div>
    </nav>
  );
}

const style = {
  h1: 'text-3xl font-bold text-gray-900 mb-1',
  date: 'text-sm text-gray-400 mb-10',
  h2: 'text-lg font-semibold text-gray-900 mt-10 mb-3',
  h3: 'text-sm font-semibold text-gray-700 mt-6 mb-2',
  p: 'text-sm text-gray-600 leading-relaxed mb-3',
  ul: 'list-disc pl-5 text-sm text-gray-600 leading-relaxed mb-3 space-y-1',
  a: 'text-indigo-600 hover:text-indigo-800 underline underline-offset-2',
  section: 'border-b border-gray-100 pb-8 last:border-0',
};

export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <LegalNav />
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className={style.h1}>Privacy Policy</h1>
        <p className={style.date}>Effective date: April 16, 2026</p>

        <div className={style.section}>
          <p className={style.p}>DirectMate ("DirectMate", "we", "us", or "our") provides software that helps businesses manage customer conversations and sales workflows through Instagram Direct Messages and related integrations.</p>
          <p className={style.p}>This Privacy Policy explains how we collect, use, store, and share information when merchants, store owners, their team members, and end users interact with our website, platform, and services.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>1. Who we are</h2>
          <p className={style.p}>DirectMate is operated by <strong>Oleksandr Khanas</strong>, sole proprietor, operating under the product name <strong>DirectMate</strong>.</p>
          <ul className={style.ul}>
            <li><strong>Email:</strong> <a href="mailto:hello@directmate.app" className={style.a}>hello@directmate.app</a></li>
            <li><strong>Website:</strong> <a href="https://directmate.app" className={style.a}>https://directmate.app</a></li>
          </ul>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>2. Scope</h2>
          <p className={style.p}>This Privacy Policy applies to:</p>
          <ul className={style.ul}>
            <li>visitors of our website</li>
            <li>merchants and businesses using DirectMate</li>
            <li>team members invited to use DirectMate</li>
            <li>customer conversations and data processed through integrations such as Instagram</li>
          </ul>
          <p className={style.p}>This Privacy Policy does not apply to third-party platforms we integrate with, including Meta, Instagram, Shopify, payment providers, and other third-party services. Their own terms and privacy policies also apply.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>3. Information we collect</h2>

          <h3 className={style.h3}>a. Business account information</h3>
          <ul className={style.ul}>
            <li>name, business name, email address, phone number</li>
            <li>billing-related details</li>
            <li>store or company information</li>
            <li>connected platform identifiers</li>
          </ul>

          <h3 className={style.h3}>b. Authentication and account access data</h3>
          <p className={style.p}>Login credentials or authentication tokens, user roles and permissions, account settings, and technical access logs.</p>

          <h3 className={style.h3}>c. Integration data</h3>
          <p className={style.p}>If you connect DirectMate with third-party services such as Instagram or e-commerce systems, we may process account IDs, page or business account identifiers, product catalog information, order-related information, conversation metadata, and message content needed to provide the service.</p>

          <h3 className={style.h3}>d. Customer communication data</h3>
          <ul className={style.ul}>
            <li>Instagram direct messages</li>
            <li>customer usernames or identifiers</li>
            <li>product inquiries and shopping preferences</li>
            <li>order-related details voluntarily provided by the customer</li>
          </ul>

          <h3 className={style.h3}>e. Website and device information</h3>
          <p className={style.p}>IP address, browser type, device information, operating system, pages visited, referring URLs, approximate usage analytics, and cookies or similar technologies.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>4. How we use information</h2>
          <ul className={style.ul}>
            <li>provide, operate, and maintain DirectMate</li>
            <li>authenticate users and secure accounts</li>
            <li>process and manage integrations</li>
            <li>generate automated responses and sales assistance features</li>
            <li>support product recommendations and order workflows</li>
            <li>improve product performance and user experience</li>
            <li>monitor reliability, prevent abuse, and troubleshoot issues</li>
            <li>communicate with users about service, support, updates, and legal matters</li>
            <li>comply with legal obligations and enforce our Terms of Service</li>
          </ul>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>5. Legal basis for processing</h2>
          <p className={style.p}>Depending on the user and applicable law, we process information on the basis of performance of a contract, legitimate interests in operating and improving the service, compliance with legal obligations, and consent where required.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>6. How we share information</h2>
          <p className={style.p}>We do not sell personal information. We may share information with:</p>
          <ul className={style.ul}>
            <li>service providers that help us host, secure, maintain, and support the platform</li>
            <li>integration partners and APIs necessary for the service to function (including Meta/Instagram APIs for messaging)</li>
            <li>AI providers (such as OpenAI) to generate automated responses</li>
            <li>analytics, infrastructure, and communication providers</li>
            <li>legal or regulatory authorities when required by law</li>
            <li>a successor entity in the event of a merger, acquisition, or business transfer</li>
          </ul>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>7. Instagram and Meta integration</h2>
          <p className={style.p}>DirectMate integrates with the Instagram Messaging API provided by Meta Platforms, Inc. When a business connects their Instagram account to DirectMate:</p>
          <ul className={style.ul}>
            <li>we receive and process Instagram Direct Messages sent to the connected business account</li>
            <li>we use page access tokens (encrypted with AES-256-GCM) to send responses on behalf of the business</li>
            <li>we store Instagram account identifiers and business profile information necessary to operate the service</li>
            <li>message content may be sent to AI providers to generate automated replies</li>
          </ul>
          <p className={style.p}>Use of data received from Meta APIs complies with the Meta Platform Terms and Meta Developer Policies.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>8. Data retention</h2>
          <p className={style.p}>We retain information for as long as necessary to provide the service, comply with legal obligations, resolve disputes, enforce agreements, and maintain security and fraud-prevention records. When data is no longer needed, we will delete or anonymize it within a reasonable period.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>9. Data security</h2>
          <p className={style.p}>We take reasonable technical and organizational measures to protect information from unauthorized access, disclosure, alteration, or destruction, including encryption of sensitive tokens (AES-256-GCM), secure HTTPS connections, and access controls. However, no method of transmission or storage is completely secure.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>10. International data transfers</h2>
          <p className={style.p}>Depending on the tools and providers used, data may be processed in countries other than the user's country of residence. Where required, we take reasonable steps to ensure appropriate safeguards are in place.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>11. Your rights</h2>
          <ul className={style.ul}>
            <li>request access to your data</li>
            <li>request correction of inaccurate data</li>
            <li>request deletion of data</li>
            <li>object to or restrict certain processing</li>
            <li>request data portability</li>
            <li>withdraw consent where processing is based on consent</li>
          </ul>
          <p className={style.p}>To exercise these rights, contact us at <a href="mailto:privacy@directmate.app" className={style.a}>privacy@directmate.app</a>.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>12. Data deletion requests</h2>
          <p className={style.p}>If you want us to delete your data, see our <Link to="/data-deletion" className={style.a}>Data Deletion Request</Link> page or contact <a href="mailto:privacy@directmate.app" className={style.a}>privacy@directmate.app</a>.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>13. Children's privacy</h2>
          <p className={style.p}>DirectMate is intended for business use and is not directed to children under the age of 13. We do not knowingly collect personal information directly from children.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>14. Changes to this Privacy Policy</h2>
          <p className={style.p}>We may update this Privacy Policy from time to time. When we do, we will update the "Effective date" above.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>15. Contact us</h2>
          <ul className={style.ul}>
            <li><strong>Email:</strong> <a href="mailto:privacy@directmate.app" className={style.a}>privacy@directmate.app</a></li>
            <li><strong>Website:</strong> <a href="https://directmate.app" className={style.a}>https://directmate.app</a></li>
          </ul>
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}

export function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <LegalNav />
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className={style.h1}>Terms and Conditions</h1>
        <p className={style.date}>Effective date: April 16, 2026</p>

        <div className={style.section}>
          <p className={style.p}>These Terms of Service ("Terms") govern your access to and use of DirectMate, including our website, software, integrations, and related services. By accessing or using DirectMate, you agree to these Terms.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>1. About DirectMate</h2>
          <p className={style.p}>DirectMate is a software platform designed to help businesses manage customer conversations, product recommendations, and sales workflows through Instagram Direct Messages and related integrations.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>2. Eligibility</h2>
          <ul className={style.ul}>
            <li>you are legally able to enter into a binding agreement</li>
            <li>you use the service for lawful business purposes</li>
            <li>you have authority to act on behalf of the business using the service</li>
          </ul>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>3. Account registration</h2>
          <p className={style.p}>To use certain features, you may need to create an account and provide accurate information. You are responsible for maintaining the confidentiality of your credentials, all activity under your account, and ensuring that your connected accounts and integrations are lawfully used.</p>
          <p className={style.p}>You must promptly notify us if you believe your account has been compromised.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>4. Acceptable use</h2>
          <p className={style.p}>You agree not to:</p>
          <ul className={style.ul}>
            <li>use DirectMate for unlawful, fraudulent, deceptive, abusive, or harmful purposes</li>
            <li>violate the rights of customers, third parties, or platform providers</li>
            <li>send spam or unauthorized automated messages</li>
            <li>use DirectMate in a way that violates Meta, Instagram, Shopify, or other third-party platform rules</li>
            <li>attempt to disrupt, reverse engineer, or interfere with the service</li>
            <li>upload malicious code or misuse the platform</li>
          </ul>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>5. Customer data and business responsibility</h2>
          <p className={style.p}>You are responsible for the legality of the data you submit or process through DirectMate; obtaining any necessary notices, permissions, and consents; your communications with customers; your product claims, offers, prices, and order-related content; and compliance with applicable laws.</p>
          <p className={style.p}>DirectMate acts as a software provider and does not independently verify the accuracy or legality of your business content.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>6. Integrations and third-party services</h2>
          <p className={style.p}>DirectMate may rely on third-party services and integrations. We are not responsible for third-party platform outages, API limitations, policy changes, or third-party data handling outside our control.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>7. AI and automation features</h2>
          <p className={style.p}>DirectMate may provide automated suggestions, message generation, reply assistance, product recommendations, and workflow automation. You understand that automated outputs may not always be accurate, human review may be necessary, and you remain responsible for the final use of replies and actions taken through your business account.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>8. Fees and payments</h2>
          <p className={style.p}>If DirectMate offers paid plans, you agree to pay applicable fees. Fees may be billed on a recurring basis. Unless otherwise stated, fees are non-refundable. Failure to pay may result in suspension or limitation of service.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>9. Intellectual property</h2>
          <p className={style.p}>DirectMate and its related software, branding, design, content, and technology are owned by or licensed to us. We grant you a limited, non-exclusive, non-transferable, revocable right to use the service in accordance with these Terms.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>10. Confidentiality</h2>
          <p className={style.p}>Each party may receive confidential information from the other. You agree not to disclose our confidential information, and we will take reasonable steps to protect confidential business information you provide.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>11. Suspension and termination</h2>
          <p className={style.p}>We may suspend or terminate access if you violate these Terms, your use creates risk, a required integration becomes unavailable, or we are required to do so by law. You may stop using the service at any time.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>12. Disclaimers</h2>
          <p className={style.p}>DirectMate is provided on an "as is" and "as available" basis. To the maximum extent permitted by law, we disclaim all warranties, express or implied. We do not guarantee uninterrupted or error-free operation, specific sales results, or compatibility with all external services at all times.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>13. Limitation of liability</h2>
          <p className={style.p}>To the maximum extent permitted by law, DirectMate will not be liable for any indirect, incidental, special, consequential, or lost profits damages. Our total liability will not exceed the amount you paid to us in the 3 months before the event, or 100 USD if no payment was made.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>14. Indemnification</h2>
          <p className={style.p}>You agree to defend, indemnify, and hold harmless DirectMate from claims arising from your use of the service, your business operations, your violation of these Terms, or your violation of applicable law or third-party rights.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>15. Governing law</h2>
          <p className={style.p}>These Terms are governed by the laws of <strong>Ukraine</strong>, unless otherwise required by applicable law.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>16. Changes to these Terms</h2>
          <p className={style.p}>We may update these Terms from time to time. Continued use of the service after updated Terms take effect means you accept the updated Terms.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>17. Contact</h2>
          <ul className={style.ul}>
            <li><strong>Email:</strong> <a href="mailto:hello@directmate.app" className={style.a}>hello@directmate.app</a></li>
            <li><strong>Website:</strong> <a href="https://directmate.app" className={style.a}>https://directmate.app</a></li>
          </ul>
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}

export function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-white">
      <LegalNav />
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className={style.h1}>Data Deletion Request</h1>
        <p className={style.date}>Effective date: April 16, 2026</p>

        <div className={style.section}>
          <p className={style.p}>If you want DirectMate to delete your account data or data associated with your business, please send a request to:</p>
          <p className="text-base font-medium text-gray-900 mb-6">
            <a href="mailto:privacy@directmate.app" className={style.a}>privacy@directmate.app</a>
          </p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>What to include in your request</h2>
          <ul className={style.ul}>
            <li>your full name</li>
            <li>your business or store name</li>
            <li>the email address associated with your account</li>
            <li>the Instagram account or connected platform account related to the request</li>
            <li>a short description of what data you want deleted</li>
          </ul>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>What happens next</h2>
          <p className={style.p}>We may ask for additional information to verify your identity and protect account security.</p>
          <p className={style.p}>After verification, we will process your request within a reasonable time, unless we are required to retain certain data for legal, tax, security, fraud-prevention, or dispute-resolution purposes.</p>
        </div>

        <div className={style.section}>
          <h2 className={style.h2}>Contact</h2>
          <ul className={style.ul}>
            <li><strong>Email:</strong> <a href="mailto:privacy@directmate.app" className={style.a}>privacy@directmate.app</a></li>
            <li><strong>Website:</strong> <a href="https://directmate.app" className={style.a}>https://directmate.app</a></li>
          </ul>
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}
