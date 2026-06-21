import BackButton from '../components/BackButton';

export default function TermsOfService() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <BackButton />
      <h1 className="text-2xl font-bold text-stone-100 mb-1">Terms of Service</h1>
      <p className="text-xs text-stone-500 mb-8">Last updated: June 2025</p>

      <div className="space-y-8 text-stone-300 text-sm leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">1. Acceptance of Terms</h2>
          <p>By accessing or using CigarBuddy, you agree to be bound by these Terms of Service. If you do not agree, do not use the platform.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">2. Eligibility</h2>
          <p>You must be of legal age to purchase tobacco products in your jurisdiction (21 years or older in the United States) to use CigarBuddy. By registering, you represent that you meet this requirement.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">3. User Accounts</h2>
          <p className="mb-2">You are responsible for maintaining the security of your account and password. You agree to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide accurate information when registering</li>
            <li>Not share your account credentials with others</li>
            <li>Notify us immediately of any unauthorized use of your account</li>
            <li>Not create multiple accounts to circumvent suspensions or bans</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">4. User Content</h2>
          <p className="mb-2">You retain ownership of reviews and other content you submit. By posting content, you grant CigarBuddy a non-exclusive, royalty-free license to display and distribute that content on the platform. You agree not to post content that:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Is false, misleading, or fraudulent</li>
            <li>Harasses, threatens, or demeans other users</li>
            <li>Violates any applicable law or regulation</li>
            <li>Infringes on the intellectual property rights of others</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">5. Store Accounts</h2>
          <p>Store owners who register on CigarBuddy agree to provide accurate inventory and pricing information. Deliberately posting false stock levels or fraudulent deals may result in account termination. CigarBuddy does not guarantee the accuracy of store-provided inventory data.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">6. Prohibited Conduct</h2>
          <p className="mb-2">You may not:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Use the platform for any unlawful purpose</li>
            <li>Scrape, crawl, or systematically extract data from the platform</li>
            <li>Attempt to gain unauthorized access to any part of the platform</li>
            <li>Interfere with the platform's operation or other users' experience</li>
            <li>Use automated tools to submit fake reviews or manipulate ratings</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">7. Disclaimers</h2>
          <p>CigarBuddy is provided "as is" without warranties of any kind. We do not guarantee the accuracy of cigar ratings, store inventory, pricing, or hours of operation. Tobacco products are harmful to health — nothing on this platform constitutes health advice.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">8. Limitation of Liability</h2>
          <p>To the fullest extent permitted by law, CigarBuddy shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the platform, including but not limited to reliance on store inventory data.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">9. Termination</h2>
          <p>We reserve the right to suspend or terminate accounts that violate these terms, at our sole discretion. You may delete your account at any time by contacting us.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">10. Changes to Terms</h2>
          <p>We may modify these terms at any time. Continued use of the platform after changes constitutes acceptance. We will notify users of material changes via the app.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">11. Contact</h2>
          <p>Questions about these terms? Contact us at <a href="mailto:support@cigarbuddy.app" className="text-amber-500 hover:text-amber-400">support@cigarbuddy.app</a>.</p>
        </section>
      </div>
    </div>
  );
}
