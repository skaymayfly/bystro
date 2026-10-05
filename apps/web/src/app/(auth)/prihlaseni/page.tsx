import type { Metadata } from "next";

import { AuthPage } from "../auth-page";

export const metadata: Metadata = { title: "Přihlášení – Bystro" };

export default function SignInPage(props: PageProps<"/prihlaseni">) {
  return <AuthPage mode="login" searchParams={props.searchParams} />;
}
