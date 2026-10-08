"use client";

import { isValidIco, normalizeIco } from "@bystro/core";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authStyles, FormError } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { SignOutButton } from "../sign-out-button";

interface CompanyFields {
  name: string;
  dic: string;
  street: string;
  city: string;
  postalCode: string;
  vatPayer: boolean;
}

const EMPTY_FIELDS: CompanyFields = {
  name: "",
  dic: "",
  street: "",
  city: "",
  postalCode: "",
  vatPayer: false,
};

type LookupState = "idle" | "loading" | "found" | "not_found" | "unavailable";

const LOOKUP_MESSAGES: Record<Exclude<LookupState, "idle" | "loading">, string> = {
  found: "Našlo se v ARES. Zkontroluj údaje a případně je uprav.",
  not_found: "Tohle IČO v ARES není. Zkontroluj ho, nebo vyplň údaje ručně.",
  unavailable: "ARES teď neodpovídá. Vyplň údaje ručně.",
};

const FIELD_LABELS: Record<string, string> = {
  name: "název firmy",
  ico: "IČO",
  dic: "DIČ",
  street: "ulici",
  city: "město",
  postalCode: "PSČ",
};

interface LookupResponse {
  status: "found" | "not_found" | "unavailable";
  company?: {
    name: string;
    dic: string | null;
    street: string | null;
    city: string | null;
    postalCode: string | null;
    vatPayer: boolean;
  };
}

/** Onboarding step 1: find the company by IČO, confirm the details, create it. */
export function CompanyStep() {
  const router = useRouter();
  const [ico, setIco] = useState("");
  const [lookup, setLookup] = useState<LookupState>("idle");
  const [fields, setFields] = useState<CompanyFields>(EMPTY_FIELDS);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const detailsVisible = lookup === "found" || lookup === "not_found" || lookup === "unavailable";
  const setField = <K extends keyof CompanyFields>(key: K, value: CompanyFields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));

  async function onLookup() {
    const normalized = normalizeIco(ico);
    if (!isValidIco(normalized)) {
      setError("IČO má 8 číslic. Tohle nevypadá správně.");
      return;
    }
    setError(null);
    setLookup("loading");

    let result: LookupResponse = { status: "unavailable" };
    try {
      const response = await fetch(`/api/companies/lookup?ico=${normalized}`);
      if (response.ok) {
        result = (await response.json()) as LookupResponse;
      }
    } catch {
      // Network trouble: fall back to manual entry.
    }

    if (result.status === "found" && result.company !== undefined) {
      const { company } = result;
      setFields({
        name: company.name,
        dic: company.dic ?? "",
        street: company.street ?? "",
        city: company.city ?? "",
        postalCode: company.postalCode ?? "",
        vatPayer: company.vatPayer,
      });
    } else {
      setFields(EMPTY_FIELDS);
    }
    setIco(normalized);
    setLookup(result.status);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detailsVisible) {
      await onLookup();
      return;
    }
    setError(null);
    setSaving(true);

    let response: Response;
    try {
      response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, ico }),
      });
    } catch {
      setError("Nepodařilo se spojit se serverem. Zkus to prosím znovu.");
      setSaving(false);
      return;
    }

    // 409 = the company already exists (e.g. a double click): just continue.
    if (response.ok || response.status === 409) {
      router.push("/onboarding?krok=2");
      router.refresh();
      return;
    }
    if (response.status === 400) {
      const body = (await response.json().catch(() => ({}))) as { fields?: string[] };
      const names = (body.fields ?? []).map((field) => FIELD_LABELS[field] ?? field);
      setError(
        names.length > 0
          ? `Zkontroluj prosím: ${names.join(", ")}.`
          : "Některý údaj nevypadá správně. Zkontroluj je prosím.",
      );
    } else {
      setError("Něco se nepovedlo. Zkus to prosím znovu.");
    }
    setSaving(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex items-end gap-3">
        <Label className="min-w-0 flex-1">
          IČO
          <Input
            name="ico"
            inputMode="numeric"
            autoComplete="off"
            required
            placeholder="08123456"
            value={ico}
            onChange={(event) => {
              setIco(event.target.value);
              // A different IČO invalidates what was found for the previous one.
              if (detailsVisible) {
                setLookup("idle");
              }
            }}
          />
        </Label>
        <Button
          type="button"
          variant="outline"
          size="form"
          className="w-auto flex-none"
          onClick={onLookup}
          disabled={lookup === "loading"}
        >
          {lookup === "loading" ? "Hledám…" : "Dohledat v ARES"}
        </Button>
      </div>

      {detailsVisible && (
        <>
          <p role="status" className={authStyles.notice}>
            {LOOKUP_MESSAGES[lookup]}
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-5">
            <Label className="col-span-2">
              Název firmy
              <Input
                name="name"
                required
                maxLength={200}
                value={fields.name}
                onChange={(event) => setField("name", event.target.value)}
              />
            </Label>
            <Label className="col-span-2">
              Ulice a číslo
              <Input
                name="street"
                maxLength={200}
                autoComplete="street-address"
                value={fields.street}
                onChange={(event) => setField("street", event.target.value)}
              />
            </Label>
            <Label>
              Město
              <Input
                name="city"
                maxLength={200}
                autoComplete="address-level2"
                value={fields.city}
                onChange={(event) => setField("city", event.target.value)}
              />
            </Label>
            <Label>
              PSČ
              <Input
                name="postalCode"
                inputMode="numeric"
                autoComplete="postal-code"
                value={fields.postalCode}
                onChange={(event) => setField("postalCode", event.target.value)}
              />
            </Label>
            <Label className="col-span-2">
              DIČ
              <Input
                name="dic"
                placeholder="CZ08123456"
                value={fields.dic}
                onChange={(event) => setField("dic", event.target.value)}
              />
            </Label>
          </div>
          <label className="flex items-center gap-3 pl-0.5 text-[15px] text-ink-2">
            <input
              type="checkbox"
              name="vatPayer"
              className="size-5 accent-ink"
              checked={fields.vatPayer}
              onChange={(event) => setField("vatPayer", event.target.checked)}
            />
            Jsme plátci DPH
          </label>
        </>
      )}

      {error !== null && <FormError>{error}</FormError>}

      <Button type="submit" size="form" className="mt-3.5" disabled={!detailsVisible || saving}>
        Pokračovat
      </Button>
      <div className="flex justify-center">
        <SignOutButton label="Odhlásit se" className={`text-base ${authStyles.link}`} />
      </div>
    </form>
  );
}
