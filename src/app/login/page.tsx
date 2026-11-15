import { CredentialsForm } from '../../components/account/CredentialsForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] | undefined }>;
}) {
  const { next } = await searchParams;
  return <CredentialsForm mode="login" next={typeof next === 'string' ? next : null} />;
}
