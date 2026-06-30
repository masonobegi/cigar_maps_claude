import BackButton from '../components/BackButton';

export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <BackButton />
      <h1 className="text-2xl font-bold text-stone-100 mb-1">Privacy Policy</h1>
      <p className="text-xs text-stone-500 mb-8">Last updated: June 2025</p>

      <div className="space-y-8 text-stone-300 text-sm leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">1. Information We Collect</h2>
          <p>When you create an account, we collect your name and email address. When you use the app, we collect information you provide directly — reviews, humidor entries, smoke list items, and store follows. We do not collect payment information.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">2. How We Use Your Information</h2>
          <p className="mb-2">We use the information we collect to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Operate and improve the CigarBuddy platform</li>
            <li>Send notifications about cigars and stores you follow</li>
            <li>Display your public profile and reviews to other users</li>
            <li>Aggregate anonymous data to show popular cigars and ratings</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">3. Information Sharing</h2>
          <p>We do not sell your personal information. Your reviews and public profile are visible to other CigarBuddy users. Your email address is never shared publicly. We may share aggregate, anonymized data (e.g., "most popular cigars in Miami") with cigar shops and partners.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">4. Store Accounts</h2>
          <p>If you register as a store, your store name, city, state, and inventory are publicly visible to all users. Contact information you provide (phone, website) is displayed on your store profile.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">4a. Store-Uploaded Images</h2>
          <p>Verified store accounts may upload photographs of cigars to enrich the CigarBuddy catalog. By uploading an image, you represent that you own the image or have all necessary rights to license it. You grant CigarBuddy a perpetual, irrevocable, royalty-free, worldwide license to use, display, reproduce, and distribute that image across the CigarBuddy platform, including as the default thumbnail for the depicted cigar visible to all users. Images may be displayed on any device or medium through which CigarBuddy is accessed.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">5. Data Storage</h2>
          <p>Your data is stored on secure servers. Passwords are hashed using bcrypt and are never stored in plain text. We retain your account data for as long as your account is active. You may request deletion of your account and associated data by contacting us.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">6. Cookies</h2>
          <p>We use your browser's localStorage to store your authentication token. We do not use third-party tracking cookies or advertising cookies.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">7. Age Requirement</h2>
          <p>CigarBuddy is intended for users who are of legal age to purchase tobacco products in their jurisdiction (21+ in the United States). By creating an account, you confirm you meet this requirement.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">8. Changes to This Policy</h2>
          <p>We may update this policy from time to time. We will notify users of significant changes via the app. Continued use after changes constitutes acceptance of the updated policy.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-stone-200 mb-2">9. Contact</h2>
          <p>Questions about this privacy policy? Contact us at <a href="mailto:support@cigarbuddy.app" className="text-amber-500 hover:text-amber-400">support@cigarbuddy.app</a>.</p>
        </section>
      </div>
    </div>
  );
}
