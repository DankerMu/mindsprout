import { CredentialsForm } from '../../components/account/CredentialsForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; native?: string | string[] }>;
}) {
  const { next: nextParam, native } = await searchParams;
  const next = typeof nextParam === 'string' ? nextParam : null;
  return <CredentialsForm mode="login" next={next} native={native === '1'} />;
}
