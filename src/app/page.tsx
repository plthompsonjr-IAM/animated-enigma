import { redirect } from 'next/navigation';

export default function Home() {
  // The authenticated dashboard is the app's home. Auth gating + a marketing
  // landing page are added in later tasks; for now, route straight in.
  redirect('/dashboard');
}
