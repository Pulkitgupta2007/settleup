import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../src/lib/auth';

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  
  if (session?.user) {
    redirect('/dashboard');
  } else {
    redirect('/login');
  }
}
