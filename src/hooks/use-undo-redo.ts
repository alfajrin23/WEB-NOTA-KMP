"use client";

import { useCallback, useState } from "react";

export function useUndoRedo<T>(initialValue: T) {
  const [past, setPast] = useState<T[]>([]);
  const [present, setPresent] = useState(initialValue);
  const [future, setFuture] = useState<T[]>([]);

  const commit = useCallback((value: T) => {
    setPast((current) => [...current, present].slice(-50));
    setPresent(value);
    setFuture([]);
  }, [present]);

  const undo = useCallback(() => {
    setPast((current) => {
      const previous = current.at(-1);
      if (!previous) return current;
      setFuture((items) => [present, ...items]);
      setPresent(previous);
      return current.slice(0, -1);
    });
  }, [present]);

  const redo = useCallback(() => {
    setFuture((current) => {
      const next = current[0];
      if (!next) return current;
      setPast((items) => [...items, present]);
      setPresent(next);
      return current.slice(1);
    });
  }, [present]);

  return { present, commit, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
