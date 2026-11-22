import { CredentialsForm } from '../../components/account/CredentialsForm';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; native?: string | string[] }>;
}) {
  const { next, native } = await searchParams;
  return (
    <CredentialsForm
      mode="register"
      next={typeof next === 'string' ? next : null}
      nativeUnavailable={native === 'unavailable'}
    />
  );
}
