"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatThousands, numericInputValue } from "@/utils/format";

type CurrencyInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string | number | null | undefined;
  onValueChange: (value: string) => void;
};

export function CurrencyInput({
  value,
  onValueChange,
  className,
  inputMode = "numeric",
  placeholder,
  ...props
}: CurrencyInputProps) {
  const [display, setDisplay] = React.useState(formatThousands(value));

  React.useEffect(() => {
    setDisplay(formatThousands(value));
  }, [value]);

  return (
    <Input
      {...props}
      type="text"
      value={display}
      inputMode={inputMode}
      placeholder={placeholder ? formatThousands(placeholder) || placeholder : undefined}
      onChange={(event) => {
        const raw = numericInputValue(event.target.value);
        setDisplay(formatThousands(raw));
        onValueChange(raw);
      }}
      className={cn("text-right tabular-nums", className)}
    />
  );
}
