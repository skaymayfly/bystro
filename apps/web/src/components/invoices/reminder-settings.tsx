"use client";

import { REMINDER_AFTER_DAYS_OPTIONS, REMINDER_REPEAT_DAYS_OPTIONS } from "@bystro/core";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { daysLabel } from "@/lib/invoice-labels";

const selectClass =
  "h-10 rounded-control border border-line-strong bg-card px-3 text-sm text-ink outline-none focus:border-link focus:shadow-focus";

/** When Bystro proposes reminders: after how many days overdue, and how often again. */
export function ReminderSettingsForm({
  afterDays,
  repeatDays,
  canEdit,
}: {
  afterDays: number;
  repeatDays: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("saving");
    const response = await fetch("/api/organizations/reminder-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        afterDays: Number(form.get("afterDays")),
        repeatDays: Number(form.get("repeatDays")),
      }),
    }).catch(() => null);
    setState(response?.ok === true ? "saved" : "error");
    router.refresh();
  }

  const options = (values: readonly number[], current: number) =>
    [...new Set([...values, current])].sort((a, b) => a - b);

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1.5 text-[13px] text-ink-3">
        Navrhnout připomínku po splatnosti
        <select
          name="afterDays"
          defaultValue={afterDays}
          disabled={!canEdit}
          className={selectClass}
        >
          {options(REMINDER_AFTER_DAYS_OPTIONS, afterDays).map((days) => (
            <option key={days} value={days}>
              {days === 1 ? "po 1 dni" : `po ${days} dnech`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-ink-3">
        Další připomínka nejdřív za
        <select
          name="repeatDays"
          defaultValue={repeatDays}
          disabled={!canEdit}
          className={selectClass}
        >
          {options(REMINDER_REPEAT_DAYS_OPTIONS, repeatDays).map((days) => (
            <option key={days} value={days}>
              {daysLabel(days)}
            </option>
          ))}
        </select>
      </label>
      {canEdit && (
        <Button type="submit" size="sm" disabled={state === "saving"}>
          {state === "saving" ? "Ukládám…" : "Uložit"}
        </Button>
      )}
      {state === "saved" && (
        <p role="status" className="text-xs text-success-strong">
          Uloženo.
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="text-xs text-danger-strong">
          Uložit se nepovedlo.
        </p>
      )}
    </form>
  );
}
