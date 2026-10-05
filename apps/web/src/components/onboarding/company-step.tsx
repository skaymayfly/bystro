"use client";

import { isValidIco, normalizeIco } from "@bystro/core";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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
    <form onSubmit={onSubmit} className="flex flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] font-semibold text-ink-3">Krok 1 ze 3</p>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-4xl">
          Ahoj! Jak se jmenuje tvoje firma?
        </h1>
        <p className="text-base leading-normal text-ink-2">
          Podle IČO si dohledám základní údaje, ať je nemusíš vypisovat.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3.5">
        <Label className="min-w-[200px] flex-1">
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
          variant="secondary"
          size="lg"
          onClick={onLookup}
          disabled={lookup === "loading"}
        >
          {lookup === "loading" ? "Hledám…" : "Dohledat v ARES"}
        </Button>
      </div>

      {detailsVisible && (
        <>
          <p role="status" className="rounded-field bg-secondary px-4 py-3 text-sm text-ink">
            {LOOKUP_MESSAGES[lookup]}
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3.5">
            <Label>
              Název firmy
              <Input
                name="name"
                required
                maxLength={200}
                value={fields.name}
                onChange={(event) => setField("name", event.target.value)}
              />
            </Label>
            <Label>
              DIČ
              <Input
                name="dic"
                placeholder="CZ08123456"
                value={fields.dic}
                onChange={(event) => setField("dic", event.target.value)}
              />
            </Label>
            <Label>
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
          </div>
          <label className="flex items-center gap-3 text-[15px] font-medium text-ink">
            <input
              type="checkbox"
              name="vatPayer"
              className="size-5 accent-brand"
              checked={fields.vatPayer}
              onChange={(event) => setField("vatPayer", event.target.checked)}
            />
            Jsme plátci DPH
          </label>
        </>
      )}

      {error !== null && (
        <p role="alert" className="rounded-field bg-brand-soft px-4 py-3 text-sm text-brand-strong">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2.5 pt-2">
        <SignOutButton label="Odhlásit se" className="px-2 text-sm" />
        <Button type="submit" size="lg" className="px-7" disabled={!detailsVisible || saving}>
          Pokračovat
        </Button>
      </div>
    </form>
  );
}
