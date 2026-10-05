import type { Metadata } from "next";

import { AuthPage } from "../auth-page";

export const metadata: Metadata = { title: "Registrace – Bystro" };

export default function SignUpPage(props: PageProps<"/registrace">) {
  return <AuthPage mode="signup" searchParams={props.searchParams} />;
}
