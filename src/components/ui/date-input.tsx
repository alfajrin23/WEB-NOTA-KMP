"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDateIndonesia, parseDateInputToIso } from "@/utils/format";

type DateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  onInvalidDate?: () => void;
};

export function DateInput({
  value,
  onValueChange,
  onInvalidDate,
  className,
  placeholder = "dd/mm/yyyy",
  onBlur,
  onKeyDown,
  ...props
}: DateInputProps) {
  const [draft, setDraft] = React.useState(formatDateIndonesia(value));

  React.useEffect(() => {
    setDraft(formatDateIndonesia(value));
  }, [value]);

  const commit = React.useCallback(() => {
    const parsed = parseDateInputToIso(draft);
    if (parsed === null) {
      onInvalidDate?.();
      setDraft(formatDateIndonesia(value));
      return;
    }

    onValueChange(parsed);
    setDraft(formatDateIndonesia(parsed));
  }, [draft, onInvalidDate, onValueChange, value]);

  return (
    <Input
      {...props}
      type="text"
      value={draft}
      inputMode="numeric"
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        commit();
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
          return;
        }
        onKeyDown?.(event);
      }}
      className={cn("tabular-nums", className)}
    />
  );
}
